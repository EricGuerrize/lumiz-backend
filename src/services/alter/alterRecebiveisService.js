const supabase = require('../../db/supabase');
const alterAdapter = require('./alterAdapter');

/**
 * Onda 3.B — alterRecebiveisService.
 *
 * Service de domínio que consome SEMPRE a tabela `alter_recebiveis` (snapshot
 * mantido pelo `alterAdapter` em uso). Não chama Alter direto — abstrai aging,
 * mix por adquirente, mix por parcelas e KPIs agregados.
 *
 * Aging por D+N (dias até `data_disponivel`):
 *   - hoje (D+0)
 *   - D+1 a D+7
 *   - D+8 a D+30
 *   - D+31 a D+60
 *   - D+61 a D+90
 *   - D+90+
 *   - vencido (data_disponivel passada e ainda não liquidado)
 */

const AGING_BUCKETS = [
  { id: 'vencido', label: 'Vencido', min: -Infinity, max: -1 },
  { id: 'hoje', label: 'Hoje (D+0)', min: 0, max: 0 },
  { id: 'd1_d7', label: 'D+1 a D+7', min: 1, max: 7 },
  { id: 'd8_d30', label: 'D+8 a D+30', min: 8, max: 30 },
  { id: 'd31_d60', label: 'D+31 a D+60', min: 31, max: 60 },
  { id: 'd61_d90', label: 'D+61 a D+90', min: 61, max: 90 },
  { id: 'd90_mais', label: 'D+90+', min: 91, max: Infinity }
];

function _bucketFor(diffDays) {
  for (const b of AGING_BUCKETS) {
    if (diffDays >= b.min && diffDays <= b.max) return b.id;
  }
  return 'd90_mais';
}

function _toNumber(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function _round2(n) {
  return Math.round(n * 100) / 100;
}

class AlterRecebiveisService {
  constructor(adapter = alterAdapter) {
    this.adapter = adapter;
  }

  async _ensureSync(userId) {
    if (typeof this.adapter.syncFromParcelas === 'function') {
      try {
        await this.adapter.syncFromParcelas(userId);
      } catch (_e) {
        // Se sync falhar, seguimos com o que estiver em alter_recebiveis.
        // Logado pelo caller; service não decide UX.
      }
    }
  }

  /**
   * Lista recebíveis com filtros opcionais (status, adquirente, from, to).
   */
  async list(userId, filters = {}) {
    if (!userId) throw new Error('userId obrigatório.');
    await this._ensureSync(userId);

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

  /**
   * Posição agregada: livre, comprometido, antecipado.
   * Inclui contagem de recebíveis e MDR médio ponderado.
   */
  async getPosicao(userId) {
    const recebiveis = await this.list(userId);
    const aggr = {
      livre: { valor: 0, count: 0 },
      comprometido: { valor: 0, count: 0 },
      antecipado: { valor: 0, count: 0 },
      liquidado_30d: { valor: 0, count: 0 },
      total_geral: 0
    };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let mdrPonderadoNumerador = 0;
    let mdrPonderadoDenominador = 0;

    for (const r of recebiveis) {
      const valor = _toNumber(r.valor_liquido);
      const valorBruto = _toNumber(r.valor_bruto);
      mdrPonderadoNumerador += _toNumber(r.mdr) * valorBruto;
      mdrPonderadoDenominador += valorBruto;

      if (r.status === 'livre') {
        aggr.livre.valor += valor;
        aggr.livre.count += 1;
      } else if (r.status === 'comprometido') {
        aggr.comprometido.valor += valor;
        aggr.comprometido.count += 1;
      } else if (r.status === 'antecipado') {
        aggr.antecipado.valor += valor;
        aggr.antecipado.count += 1;
      }

      if (r.status === 'liquidado' && r.data_disponivel) {
        const liq = new Date(`${r.data_disponivel}T12:00:00`);
        if ((today - liq) / 86400000 <= 30) {
          aggr.liquidado_30d.valor += valor;
          aggr.liquidado_30d.count += 1;
        }
      }
      aggr.total_geral += valor;
    }

    const mdrMedio = mdrPonderadoDenominador > 0
      ? mdrPonderadoNumerador / mdrPonderadoDenominador
      : 0;

    return {
      livre: { valor: _round2(aggr.livre.valor), count: aggr.livre.count },
      comprometido: { valor: _round2(aggr.comprometido.valor), count: aggr.comprometido.count },
      antecipado: { valor: _round2(aggr.antecipado.valor), count: aggr.antecipado.count },
      liquidado_30d: { valor: _round2(aggr.liquidado_30d.valor), count: aggr.liquidado_30d.count },
      total_geral: _round2(aggr.total_geral),
      mdr_medio_ponderado: Math.round(mdrMedio * 10000) / 10000
    };
  }

  /**
   * Aging por D+N. Considera apenas recebíveis com status livre|comprometido
   * (ainda não realizados); antecipado não entra no aging por já ter sido
   * convertido em caixa.
   */
  async getAging(userId, options = {}) {
    const recebiveis = await this.list(userId);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const buckets = AGING_BUCKETS.reduce((acc, b) => {
      acc[b.id] = { id: b.id, label: b.label, count: 0, valor: 0 };
      return acc;
    }, {});

    let total = 0;
    for (const r of recebiveis) {
      if (!['livre', 'comprometido'].includes(r.status)) continue;
      if (!r.data_disponivel) continue;

      const dataDisp = new Date(`${r.data_disponivel}T12:00:00`);
      const diffDays = Math.floor((dataDisp - today) / 86400000);
      const bucketId = _bucketFor(diffDays);
      const valor = _toNumber(r.valor_liquido);
      buckets[bucketId].count += 1;
      buckets[bucketId].valor += valor;
      total += valor;
    }

    const arr = AGING_BUCKETS.map((b) => ({
      ...buckets[b.id],
      valor: _round2(buckets[b.id].valor)
    }));

    return {
      buckets: arr,
      total: _round2(total),
      meta: {
        is_empty: total === 0,
        hint: total === 0
          ? 'Sem recebíveis em aberto. Quando começar a vender no cartão, a agenda aparece aqui.'
          : null
      },
      janela: options.from || options.to ? { from: options.from || null, to: options.to || null } : null
    };
  }

  /**
   * Mix por adquirente e por número de parcelas.
   */
  async getMix(userId) {
    const recebiveis = await this.list(userId);

    const porAdquirente = new Map();
    const porParcelas = new Map();
    let total = 0;

    for (const r of recebiveis) {
      const valor = _toNumber(r.valor_liquido);
      total += valor;

      const adq = r.adquirente || 'desconhecida';
      if (!porAdquirente.has(adq)) {
        porAdquirente.set(adq, { adquirente: adq, count: 0, valor: 0 });
      }
      const adqEntry = porAdquirente.get(adq);
      adqEntry.count += 1;
      adqEntry.valor += valor;

      const parc = r.parcelas_total || 1;
      const key = `${parc}x`;
      if (!porParcelas.has(key)) {
        porParcelas.set(key, { parcelas: parc, label: key, count: 0, valor: 0 });
      }
      const parcEntry = porParcelas.get(key);
      parcEntry.count += 1;
      parcEntry.valor += valor;
    }

    const finalize = (entry) => ({
      ...entry,
      valor: _round2(entry.valor),
      pct: total > 0 ? Math.round((entry.valor / total) * 10000) / 100 : 0
    });

    return {
      por_adquirente: Array.from(porAdquirente.values()).map(finalize).sort((a, b) => b.valor - a.valor),
      por_parcelas: Array.from(porParcelas.values()).map(finalize).sort((a, b) => a.parcelas - b.parcelas),
      total: _round2(total),
      meta: {
        is_empty: total === 0,
        hint: total === 0 ? 'Mix vai aparecer quando houver recebíveis no cartão.' : null
      }
    };
  }
}

const instance = new AlterRecebiveisService();
module.exports = instance;
module.exports.AlterRecebiveisService = AlterRecebiveisService;
module.exports.AGING_BUCKETS = AGING_BUCKETS;
module.exports._helpers = { _bucketFor, _toNumber };
