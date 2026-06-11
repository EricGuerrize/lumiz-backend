const supabase = require('../db/supabase');

/**
 * Onda 2.C — Contas a Receber.
 *
 * Agrega parcelas em aberto (parcelas.paga = false) com aging por faixa:
 *   - vencidas
 *   - hoje
 *   - 1–7 dias
 *   - 8–30 dias
 *   - 31–60 dias
 *   - 61–90 dias
 *   - 90+ dias
 *
 * Também devolve mix por método de pagamento (forma_pagamento herdado do atendimento)
 * para alimentar UI de fluxo de caixa.
 */

const AGING_BUCKETS = [
  { id: 'vencidas', label: 'Vencidas', min: -Infinity, max: -1 },
  { id: 'hoje', label: 'Hoje', min: 0, max: 0 },
  { id: '1_7', label: '1-7 dias', min: 1, max: 7 },
  { id: '8_30', label: '8-30 dias', min: 8, max: 30 },
  { id: '31_60', label: '31-60 dias', min: 31, max: 60 },
  { id: '61_90', label: '61-90 dias', min: 61, max: 90 },
  { id: '90_mais', label: '90+ dias', min: 91, max: Infinity }
];

function _dateStr(d) { return d.toISOString().split('T')[0]; }

function _bucketFor(diffDays) {
  for (const bucket of AGING_BUCKETS) {
    if (diffDays >= bucket.min && diffDays <= bucket.max) return bucket.id;
  }
  return '90_mais';
}

class ContasReceberService {
  /**
   * @param {string} userId
   * @param {Object} options
   * @param {string} [options.from] - YYYY-MM-DD (filtro inicial; default: sem limite no passado)
   * @param {string} [options.to]   - YYYY-MM-DD (filtro final; default: +180 dias)
   * @param {string} [options.adquirente]
   * @returns {Promise<Object>} payload
   */
  async getOverview(userId, options = {}) {
    if (!userId) throw new Error('userId obrigatório.');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = _dateStr(today);

    const fromStr = options.from || null;
    const toDate = options.to ? new Date(options.to) : (() => {
      const d = new Date(today);
      d.setDate(d.getDate() + 180);
      return d;
    })();
    const toStr = _dateStr(toDate);

    let query = supabase
      .from('parcelas')
      .select(`
        id,
        numero,
        valor,
        valor_liquido,
        data_vencimento,
        paga,
        atendimentos!inner (
          id,
          user_id,
          forma_pagamento,
          bandeira_cartao,
          parcelas,
          valor_total,
          data,
          clientes (id, nome)
        )
      `)
      .eq('paga', false)
      .eq('atendimentos.user_id', userId)
      .or('is_test.is.null,is_test.eq.false', { foreignTable: 'atendimentos' })
      .lte('data_vencimento', toStr)
      .order('data_vencimento', { ascending: true });

    if (fromStr) query = query.gte('data_vencimento', fromStr);

    const { data, error } = await query;
    if (error) throw error;

    const rows = data || [];

    const aging = AGING_BUCKETS.reduce((acc, b) => {
      acc[b.id] = { id: b.id, label: b.label, count: 0, valor: 0, parcelas: [] };
      return acc;
    }, {});

    const mixForma = new Map();
    let total = 0;
    let totalVencido = 0;
    let totalAReceber30Dias = 0;

    for (const row of rows) {
      const venc = row.data_vencimento;
      if (!venc) continue;
      const vencDate = new Date(`${venc}T12:00:00`);
      const diffDays = Math.floor((vencDate - today) / 86400000);
      const bucketId = _bucketFor(diffDays);
      const valor = parseFloat(row.valor_liquido ?? row.valor) || 0;
      const formaPg = row.atendimentos?.forma_pagamento || 'desconhecida';

      total += valor;
      if (diffDays < 0) totalVencido += valor;
      if (diffDays >= 0 && diffDays <= 30) totalAReceber30Dias += valor;

      const bucketKey = bucketId in aging ? bucketId : '90_mais';
      aging[bucketKey].count += 1;
      aging[bucketKey].valor += valor;
      aging[bucketKey].parcelas.push({
        id: row.id,
        numero: row.numero,
        valor,
        data_vencimento: venc,
        atendimento_id: row.atendimentos?.id,
        cliente_nome: row.atendimentos?.clientes?.nome || null,
        forma_pagamento: formaPg,
        bandeira_cartao: row.atendimentos?.bandeira_cartao || null
      });

      const mixKey = formaPg === 'parcelado'
        ? `parcelado_${row.atendimentos?.parcelas || '?'}x`
        : formaPg;
      if (!mixForma.has(mixKey)) {
        mixForma.set(mixKey, { forma_pagamento: mixKey, count: 0, valor: 0 });
      }
      const mixEntry = mixForma.get(mixKey);
      mixEntry.count += 1;
      mixEntry.valor += valor;
    }

    const mix = Array.from(mixForma.values()).sort((a, b) => b.valor - a.valor);
    const agingArr = AGING_BUCKETS.map((b) => aging[b.id]);

    return {
      data: rows,
      aging: agingArr,
      mix,
      total: Math.round(total * 100) / 100,
      total_vencido: Math.round(totalVencido * 100) / 100,
      total_a_receber_30_dias: Math.round(totalAReceber30Dias * 100) / 100,
      janela: { from: fromStr, to: toStr, today: todayStr },
      meta: {
        is_empty: rows.length === 0,
        hint: rows.length === 0
          ? 'Você ainda não tem parcelas em aberto. Conforme registrar vendas parceladas, aparecem aqui.'
          : null
      }
    };
  }
}

module.exports = new ContasReceberService();
module.exports.ContasReceberService = ContasReceberService;
module.exports.AGING_BUCKETS = AGING_BUCKETS;
module.exports._helpers = { _bucketFor };
