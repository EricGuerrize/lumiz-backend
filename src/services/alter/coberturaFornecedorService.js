const supabase = require('../../db/supabase');
const alterRecebiveisService = require('./alterRecebiveisService');

/**
 * Onda 3.B — coberturaFornecedorService.
 *
 * Para cada fornecedor com `contas_pagar` futuras, cruza com `alter_recebiveis`
 * (livres + comprometidos) e calcula:
 *   - total_a_pagar (no horizonte)
 *   - total_recebivel_disponivel (no horizonte)
 *   - cobertura_pct = recebivel / a_pagar (clamped 0..1+)
 *   - gap_dias = quantos dias até ter recebível suficiente (NaN se cobertura completa)
 *   - status: 'ok' (>=1.0), 'apertado' (0.7..0.99), 'risco' (0.4..0.69), 'critico' (<0.4)
 *
 * Persistência opcional: snapshots em `alter_cobertura_snapshots` por
 * (user_id, fornecedor_id, data_snapshot) para histórico/insight.
 */

const DEFAULT_HORIZONTE_DIAS = 90;

function _toNumber(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function _round2(n) {
  return Math.round(n * 100) / 100;
}

function _round4(n) {
  return Math.round(n * 10000) / 10000;
}

function _dateStr(d) {
  return new Date(d).toISOString().split('T')[0];
}

function _addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function _classify(coberturaPct) {
  if (coberturaPct >= 1.0) return 'ok';
  if (coberturaPct >= 0.7) return 'apertado';
  if (coberturaPct >= 0.4) return 'risco';
  return 'critico';
}

class CoberturaFornecedorService {
  constructor(recebiveisService = alterRecebiveisService) {
    this.recebiveisService = recebiveisService;
  }

  /**
   * Calcula cobertura para todos os fornecedores com contas a pagar no
   * horizonte. Retorna lista ordenada por gravidade (cobertura asc).
   *
   * @param {string} userId
   * @param {Object} options
   * @param {number} [options.horizonte_dias=90]
   * @param {boolean} [options.persistSnapshot=false] - se true, grava em alter_cobertura_snapshots
   */
  async calcular(userId, options = {}) {
    if (!userId) throw new Error('userId obrigatório.');
    const horizonte = Math.max(7, Math.min(365, _toNumber(options.horizonte_dias) || DEFAULT_HORIZONTE_DIAS));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const limite = _addDays(today, horizonte);
    const todayStr = _dateStr(today);
    const limiteStr = _dateStr(limite);

    const { data: contas, error: cpError } = await supabase
      .from('contas_pagar')
      .select(`
        id, valor, data_vencimento, status, fornecedor_id,
        fornecedores (id, nome, cnpj)
      `)
      .eq('user_id', userId)
      .eq('status', 'pendente')
      .gte('data_vencimento', todayStr)
      .lte('data_vencimento', limiteStr)
      .order('data_vencimento', { ascending: true });
    if (cpError) throw cpError;

    const recebiveis = await this.recebiveisService.list(userId, {
      from: todayStr,
      to: limiteStr
    });
    const recebiveisDisponiveis = recebiveis.filter((r) => ['livre', 'comprometido'].includes(r.status));

    const totalRecebivelGlobal = recebiveisDisponiveis.reduce(
      (sum, r) => sum + _toNumber(r.valor_liquido),
      0
    );

    const porFornecedor = new Map();
    let totalAPagar = 0;

    for (const conta of contas || []) {
      const fornecedor = conta.fornecedores || { id: null, nome: 'Sem fornecedor', cnpj: null };
      const fornecedorId = fornecedor.id || conta.fornecedor_id || '_sem_fornecedor';
      const valor = _toNumber(conta.valor);
      totalAPagar += valor;

      if (!porFornecedor.has(fornecedorId)) {
        porFornecedor.set(fornecedorId, {
          fornecedor_id: fornecedor.id,
          fornecedor_nome: fornecedor.nome || 'Sem fornecedor',
          cnpj: fornecedor.cnpj || null,
          total_a_pagar: 0,
          contas_count: 0,
          proximo_vencimento: null,
          contas: []
        });
      }
      const entry = porFornecedor.get(fornecedorId);
      entry.total_a_pagar += valor;
      entry.contas_count += 1;
      entry.contas.push({
        id: conta.id,
        valor,
        data_vencimento: conta.data_vencimento
      });
      if (!entry.proximo_vencimento || conta.data_vencimento < entry.proximo_vencimento) {
        entry.proximo_vencimento = conta.data_vencimento;
      }
    }

    const fornecedores = [];
    for (const f of porFornecedor.values()) {
      const cobertura = totalAPagar > 0
        ? Math.min(2, totalRecebivelGlobal / totalAPagar) // proxy global; refinaremos abaixo
        : 0;

      const gapDias = await this._calcGapDias(f.proximo_vencimento, recebiveisDisponiveis, f.total_a_pagar);

      const item = {
        ...f,
        total_a_pagar: _round2(f.total_a_pagar),
        recebivel_disponivel_proxy: _round2(totalRecebivelGlobal),
        cobertura_pct: _round4(cobertura),
        gap_dias: gapDias,
        status: _classify(cobertura)
      };
      fornecedores.push(item);
    }

    fornecedores.sort((a, b) => a.cobertura_pct - b.cobertura_pct);

    const topRisco = fornecedores.filter((f) => ['risco', 'critico'].includes(f.status)).slice(0, 5);

    if (options.persistSnapshot) {
      await this._persistSnapshots(userId, fornecedores, totalRecebivelGlobal);
    }

    return {
      total_a_pagar: _round2(totalAPagar),
      total_recebivel_disponivel: _round2(totalRecebivelGlobal),
      cobertura_global_pct: totalAPagar > 0 ? _round4(totalRecebivelGlobal / totalAPagar) : 0,
      fornecedores,
      top_em_risco: topRisco,
      janela: { from: todayStr, to: limiteStr, horizonte_dias: horizonte },
      meta: {
        is_empty: fornecedores.length === 0,
        hint: fornecedores.length === 0
          ? 'Sem contas a pagar com fornecedor no horizonte. Quando subir uma NF/boleto, a cobertura aparece aqui.'
          : null
      }
    };
  }

  /**
   * Estima gap em dias até cumular recebíveis suficientes para o próximo
   * vencimento do fornecedor. Soma recebíveis em ordem cronológica e devolve
   * o número de dias até o ponto onde a soma cobre `total_a_pagar`.
   */
  async _calcGapDias(proximoVencimento, recebiveis, totalAPagar) {
    if (!proximoVencimento || totalAPagar <= 0) return null;
    const venc = new Date(`${proximoVencimento}T12:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let acumulado = 0;
    let dataCobertura = null;
    for (const r of recebiveis) {
      acumulado += _toNumber(r.valor_liquido);
      if (acumulado >= totalAPagar) {
        dataCobertura = new Date(`${r.data_disponivel}T12:00:00`);
        break;
      }
    }
    if (!dataCobertura) return Number.POSITIVE_INFINITY;
    const diff = Math.floor((dataCobertura - venc) / 86400000);
    return diff;
  }

  /**
   * Persiste snapshot diário em alter_cobertura_snapshots.
   */
  async _persistSnapshots(userId, fornecedores, totalRecebivelGlobal) {
    const today = _dateStr(new Date());
    const rows = fornecedores
      .filter((f) => f.fornecedor_id)
      .map((f) => ({
        user_id: userId,
        fornecedor_id: f.fornecedor_id,
        data_snapshot: today,
        total_a_pagar: f.total_a_pagar,
        total_recebivel_disponivel: totalRecebivelGlobal,
        cobertura_pct: f.cobertura_pct,
        gap_dias: Number.isFinite(f.gap_dias) ? f.gap_dias : null,
        payload: { contas_count: f.contas_count, status: f.status }
      }));
    if (rows.length === 0) return;
    const { error } = await supabase
      .from('alter_cobertura_snapshots')
      .upsert(rows, { onConflict: 'user_id,fornecedor_id,data_snapshot' });
    if (error) throw error;
  }
}

const instance = new CoberturaFornecedorService();
module.exports = instance;
module.exports.CoberturaFornecedorService = CoberturaFornecedorService;
module.exports._helpers = { _classify, _toNumber, _round2 };
