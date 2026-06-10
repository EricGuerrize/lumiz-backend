const supabase = require('../../db/supabase');
const alterAdapter = require('./alterAdapter');
const alterRecebiveisService = require('./alterRecebiveisService');

/**
 * Onda 3.B — antecipacaoService.
 *
 * Math layer da antecipação spot. Usa o adapter atual via factory para a
 * simulação real (descontos por horizonte, ordenação por D+N) e adiciona
 * lógica de recomendação: dado o caixa esperado (entradas - saídas) num
 * horizonte X, calcula quanto antecipar para não estourar o saldo.
 *
 * Não faz nada para o modo "automática": o produto Lumiz orienta o cliente a
 * parar a automática e manter só spot. Persistimos esse desligamento via
 * `feature_flags` (pode evoluir para flag por usuário).
 */

const DEFAULT_HORIZONTE_DIAS = 30;
const SAFETY_BUFFER_PCT = Number(process.env.ALTER_RECOMEND_SAFETY_PCT || 0.10);

function _round2(n) {
  return Math.round(n * 100) / 100;
}

function _round4(n) {
  return Math.round(n * 10000) / 10000;
}

function _toNumber(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function _addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function _dateStr(d) {
  return new Date(d).toISOString().split('T')[0];
}

class AntecipacaoService {
  constructor(adapter = alterAdapter, recebiveisService = alterRecebiveisService) {
    this.adapter = adapter;
    this.recebiveisService = recebiveisService;
  }

  /**
   * Simulação spot: delega ao adapter (que conhece a regra de fee), mas
   * normaliza a saída e adiciona campos de UI.
   */
  async simular(userId, params = {}) {
    if (!userId) throw new Error('userId obrigatório.');
    const valorAlvo = Math.max(0, _toNumber(params.valor_alvo));
    const horizonte = Math.max(1, Math.min(365, _toNumber(params.horizonte_dias) || DEFAULT_HORIZONTE_DIAS));

    const sim = await this.adapter.simulateAntecipacaoSpot(userId, {
      valor_alvo: valorAlvo,
      horizonte_dias: horizonte
    });

    return {
      valor_solicitado: _round2(sim.valor_solicitado),
      valor_liquido_recebido: _round2(sim.valor_liquido_recebido),
      custo_antecipacao: _round2(sim.custo_antecipacao),
      taxa_efetiva_pct: _round4(sim.taxa_efetiva_pct),
      cobre_alvo: sim.cobre_alvo ?? (sim.valor_liquido_recebido >= valorAlvo),
      gap_versus_alvo: _round2(sim.gap_versus_alvo ?? Math.max(0, valorAlvo - sim.valor_liquido_recebido)),
      recebiveis_ids: sim.recebiveis_ids || [],
      horizonte_dias: horizonte,
      status: sim.status || 'simulada'
    };
  }

  /**
   * Executa a antecipação (mock cria registro em alter_antecipacoes e marca
   * recebíveis como antecipado).
   */
  async executar(userId, params = {}) {
    if (!userId) throw new Error('userId obrigatório.');
    const sim = params.simulacao || await this.simular(userId, params);
    const result = await this.adapter.executeAntecipacaoSpot(userId, {
      valor_alvo: sim.valor_solicitado,
      horizonte_dias: sim.horizonte_dias,
      simulacao: sim
    });
    return result;
  }

  /**
   * Calcula caixa esperado em [hoje, hoje+horizonte]:
   *   entradas = soma de alter_recebiveis livre/comprometido com data_disponivel <= horizonte
   *   saidas   = soma de contas_pagar com data_vencimento <= horizonte e status pendente
   *
   * Retorna recomendação: se saldo previsto < 0 (ou < buffer), sugerir
   * antecipar abs(saldo) + buffer; senão, recomendar não antecipar.
   */
  async recomendar(userId, options = {}) {
    if (!userId) throw new Error('userId obrigatório.');
    const horizonte = Math.max(7, Math.min(180, _toNumber(options.horizonte_dias) || DEFAULT_HORIZONTE_DIAS));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const limite = _addDays(today, horizonte);
    const limiteStr = _dateStr(limite);
    const todayStr = _dateStr(today);

    const recebiveis = await this.recebiveisService.list(userId, {
      from: todayStr,
      to: limiteStr
    });
    const entradas = recebiveis
      .filter((r) => ['livre', 'comprometido'].includes(r.status))
      .reduce((sum, r) => sum + _toNumber(r.valor_liquido), 0);

    const { data: contasPagar, error: cpError } = await supabase
      .from('contas_pagar')
      .select('valor, data_vencimento, status_pagamento')
      .eq('user_id', userId)
      .eq('status_pagamento', 'pendente')
      .gte('data_vencimento', todayStr)
      .lte('data_vencimento', limiteStr);
    if (cpError) throw cpError;

    const saidas = (contasPagar || []).reduce((sum, c) => sum + _toNumber(c.valor), 0);

    const saldoPrevisto = entradas - saidas;
    const buffer = Math.max(0, saidas * SAFETY_BUFFER_PCT);
    const aperto = saldoPrevisto - buffer;

    let recomendacao = null;
    let simulacao = null;
    if (aperto < 0) {
      const valorRecomendado = _round2(Math.abs(aperto));
      simulacao = await this.simular(userId, {
        valor_alvo: valorRecomendado,
        horizonte_dias: horizonte
      });
      recomendacao = {
        deve_antecipar: true,
        valor_alvo: valorRecomendado,
        horizonte_dias: horizonte,
        motivo: 'Saldo previsto fica negativo no período. Antecipar evita aperto.'
      };
    } else {
      recomendacao = {
        deve_antecipar: false,
        valor_alvo: 0,
        horizonte_dias: horizonte,
        motivo: 'Saldo previsto positivo com margem. Não compensa pagar custo de antecipação.'
      };
    }

    return {
      janela: {
        from: todayStr,
        to: limiteStr,
        horizonte_dias: horizonte
      },
      entradas: _round2(entradas),
      saidas: _round2(saidas),
      saldo_previsto: _round2(saldoPrevisto),
      buffer_seguranca: _round2(buffer),
      aperto: _round2(aperto),
      recomendacao,
      simulacao,
      meta: {
        is_empty: entradas === 0 && saidas === 0,
        hint: entradas === 0 && saidas === 0
          ? 'Não tenho entradas e saídas suficientes para sugerir antecipação.'
          : null
      }
    };
  }

  /**
   * "Parar antecipação automática": no mock é no-op; persistimos a intenção
   * em feature_flags para o real adapter respeitar quando ligar.
   */
  async pararAutomatica(userId) {
    if (!userId) throw new Error('userId obrigatório.');
    const adapterResult = await this.adapter.cancelAutomatica(userId);

    const { error } = await supabase
      .from('feature_flags')
      .upsert({
        user_id: userId,
        name: 'alter_antecipacao_automatica_off',
        enabled: true,
        meta: { setAt: new Date().toISOString() }
      }, { onConflict: 'user_id,name' });
    if (error) throw error;

    return {
      ...adapterResult,
      persistido: true
    };
  }
}

const instance = new AntecipacaoService();
module.exports = instance;
module.exports.AntecipacaoService = AntecipacaoService;
module.exports._helpers = { _round2, _round4, _toNumber };
