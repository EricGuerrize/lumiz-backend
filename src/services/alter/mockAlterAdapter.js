const supabase = require('../../db/supabase');
const { AlterAdapterContract } = require('./alterAdapterContract');

/**
 * MockAlterAdapter — implementação de desenvolvimento.
 *
 * Estratégia: deriva recebíveis a partir de `parcelas` + `mdr_configs`
 * (Phase 4) e expõe a mesma interface que o adapter real terá quando a Alter
 * abrir API. Persistimos snapshots em `alter_recebiveis` para que o resto do
 * sistema consuma sempre essa tabela (e não precise mudar quando trocar
 * adapter).
 *
 * Custos spot configuráveis por env:
 *   - ALTER_FEE_SPOT_PCT (default 2.5%)
 *   - ALTER_FEE_SPOT_MIN_PCT (default 1.5%)
 *   - ALTER_FEE_SPOT_MAX_PCT (default 4.5%)
 *
 * Exposto como classe + factory `mockAlterAdapter.createInstance()` para que
 * testes possam isolar instâncias.
 */

const DEFAULT_FEE_SPOT_PCT = Number(process.env.ALTER_FEE_SPOT_PCT || 0.025);
const DEFAULT_FEE_SPOT_MIN_PCT = Number(process.env.ALTER_FEE_SPOT_MIN_PCT || 0.015);
const DEFAULT_FEE_SPOT_MAX_PCT = Number(process.env.ALTER_FEE_SPOT_MAX_PCT || 0.045);

const ADQUIRENTES = ['Stone', 'Cielo', 'Rede', 'GetNet', 'Mercado Pago'];

function _addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function _dateStr(d) {
  return new Date(d).toISOString().split('T')[0];
}

function _hashAdquirente(parcelaId) {
  if (!parcelaId) return ADQUIRENTES[0];
  let sum = 0;
  for (let i = 0; i < parcelaId.length; i += 1) sum += parcelaId.charCodeAt(i);
  return ADQUIRENTES[sum % ADQUIRENTES.length];
}

class MockAlterAdapter extends AlterAdapterContract {
  /**
   * Carrega/atualiza `alter_recebiveis` a partir de `parcelas` em aberto,
   * para qualquer parcela do usuário ainda sem snapshot.
   *
   * Chamada idempotente: se já existe `parcela_id` em `alter_recebiveis`, só
   * atualiza dados; senão insere.
   */
  async syncFromParcelas(userId) {
    if (!userId) throw new Error('userId obrigatório.');
    const { data: parcelas, error } = await supabase
      .from('parcelas')
      .select(`
        id,
        valor,
        valor_liquido,
        data_vencimento,
        paga,
        atendimentos!inner (
          id, user_id, forma_pagamento, bandeira_cartao, parcelas, data
        )
      `)
      .eq('paga', false)
      .eq('atendimentos.user_id', userId);

    if (error) throw error;

    const rows = (parcelas || []).map((p) => {
      const atendimento = p.atendimentos || {};
      const valorBruto = parseFloat(p.valor) || 0;
      const valorLiquido = parseFloat(p.valor_liquido ?? p.valor) || valorBruto;
      const mdr = valorBruto > 0 ? Math.max(0, (valorBruto - valorLiquido) / valorBruto) : 0;
      const adquirente = _hashAdquirente(p.id);
      return {
        user_id: userId,
        adquirente,
        bandeira: atendimento.bandeira_cartao || null,
        parcelas_total: atendimento.parcelas || 1,
        parcela_numero: 1,
        valor_bruto: valorBruto,
        valor_liquido: valorLiquido,
        mdr,
        data_venda: atendimento.data || null,
        data_disponivel: p.data_vencimento || _dateStr(new Date()),
        status: 'livre',
        source: 'mock',
        external_id: `mock_${p.id}`,
        parcela_id: p.id
      };
    });

    if (rows.length === 0) return { synced: 0 };

    const { error: upsertError } = await supabase
      .from('alter_recebiveis')
      .upsert(rows, { onConflict: 'user_id,source,external_id' });
    if (upsertError) throw upsertError;
    return { synced: rows.length };
  }

  async listRecebiveis(userId, filters = {}) {
    if (!userId) throw new Error('userId obrigatório.');
    await this.syncFromParcelas(userId);

    let query = supabase
      .from('alter_recebiveis')
      .select('*')
      .eq('user_id', userId)
      .order('data_disponivel', { ascending: true });

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.adquirente) query = query.eq('adquirente', filters.adquirente);
    if (filters.from) query = query.gte('data_disponivel', filters.from);
    if (filters.to) query = query.lte('data_disponivel', filters.to);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async getAggregatePosition(userId) {
    const recebiveis = await this.listRecebiveis(userId);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const aggr = { livre: 0, comprometido: 0, antecipado: 0, liquidado_30d: 0 };
    for (const r of recebiveis) {
      const valor = parseFloat(r.valor_liquido) || 0;
      if (r.status === 'livre') aggr.livre += valor;
      else if (r.status === 'comprometido') aggr.comprometido += valor;
      else if (r.status === 'antecipado') aggr.antecipado += valor;
      if (r.status === 'liquidado' && r.data_disponivel) {
        const liq = new Date(`${r.data_disponivel}T12:00:00`);
        if ((today - liq) / 86400000 <= 30) aggr.liquidado_30d += valor;
      }
    }
    return aggr;
  }

  /**
   * Simulação spot determinística: ordena recebíveis livres por
   * `data_disponivel` (mais distante primeiro = maior custo) e seleciona até
   * cobrir `valor_alvo`. Custo cresce com horizonte_dias.
   */
  async simulateAntecipacaoSpot(userId, params = {}) {
    const valorAlvo = Math.max(0, Number(params.valor_alvo) || 0);
    const horizonte = Math.max(1, Math.min(365, Number(params.horizonte_dias) || 30));
    if (valorAlvo === 0) {
      return {
        valor_solicitado: 0,
        valor_liquido_recebido: 0,
        custo_antecipacao: 0,
        taxa_efetiva_pct: 0,
        recebiveis_ids: [],
        status: 'simulada'
      };
    }

    const recebiveis = await this.listRecebiveis(userId, { status: 'livre' });
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const candidatos = recebiveis
      .map((r) => {
        const data = new Date(`${r.data_disponivel}T12:00:00`);
        const diasFuturo = Math.max(0, Math.floor((data - today) / 86400000));
        const taxaSpot = Math.min(
          DEFAULT_FEE_SPOT_MAX_PCT,
          Math.max(DEFAULT_FEE_SPOT_MIN_PCT, DEFAULT_FEE_SPOT_PCT * (diasFuturo / 30))
        );
        return { ...r, _diasFuturo: diasFuturo, _taxaSpot: taxaSpot };
      })
      .sort((a, b) => a._diasFuturo - b._diasFuturo);

    let acumulado = 0;
    let custoTotal = 0;
    const escolhidos = [];
    for (const r of candidatos) {
      if (acumulado >= valorAlvo) break;
      const valorBruto = parseFloat(r.valor_liquido) || 0;
      const custo = valorBruto * r._taxaSpot;
      const liquido = valorBruto - custo;
      acumulado += liquido;
      custoTotal += custo;
      escolhidos.push(r);
    }

    const taxaEfetiva = acumulado > 0
      ? (custoTotal / (acumulado + custoTotal))
      : 0;

    return {
      valor_solicitado: valorAlvo,
      valor_liquido_recebido: Math.round(acumulado * 100) / 100,
      custo_antecipacao: Math.round(custoTotal * 100) / 100,
      taxa_efetiva_pct: Math.round(taxaEfetiva * 10000) / 10000,
      recebiveis_ids: escolhidos.map((r) => r.id),
      status: 'simulada',
      cobre_alvo: acumulado >= valorAlvo,
      gap_versus_alvo: Math.max(0, Math.round((valorAlvo - acumulado) * 100) / 100),
      horizonte_dias: horizonte
    };
  }

  async executeAntecipacaoSpot(userId, params = {}) {
    const simulacao = params.simulacao || await this.simulateAntecipacaoSpot(userId, params);
    if (!simulacao.recebiveis_ids?.length) {
      return { ...simulacao, status: 'falhou', erro: 'Sem recebíveis livres suficientes.' };
    }

    const { data: created, error: insertError } = await supabase
      .from('alter_antecipacoes')
      .insert({
        user_id: userId,
        tipo: 'spot',
        valor_solicitado: simulacao.valor_solicitado,
        valor_liquido_recebido: simulacao.valor_liquido_recebido,
        custo_antecipacao: simulacao.custo_antecipacao,
        taxa_efetiva_pct: simulacao.taxa_efetiva_pct,
        recebiveis_ids: simulacao.recebiveis_ids,
        status: 'executada',
        payload_simulacao: simulacao
      })
      .select('*')
      .single();
    if (insertError) throw insertError;

    const { error: updateError } = await supabase
      .from('alter_recebiveis')
      .update({ status: 'antecipado', updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .in('id', simulacao.recebiveis_ids);
    if (updateError) throw updateError;

    return created;
  }

  async cancelAutomatica(userId) {
    return {
      userId,
      status: 'mock_no_op',
      message: 'No mock adapter, antecipação automática nunca esteve ativa.'
    };
  }
}

const instance = new MockAlterAdapter();
module.exports = instance;
module.exports.MockAlterAdapter = MockAlterAdapter;
