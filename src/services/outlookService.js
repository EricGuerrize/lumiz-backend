const supabase = require('../db/supabase');

/** @param {number} n @param {number} lo @param {number} hi */
function clampInt(n, lo, hi) {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) return lo;
  return Math.min(Math.max(x, lo), hi);
}

/**
 * Últimos `months` meses de calendário (inclui o mês corrente), do mais antigo ao mais recente.
 * @returns {{ year: number, month: number }[]}
 */
function buildOutlookMonths(months) {
  const now = new Date();
  const list = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    list.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  return list;
}

function monthStartEnd(year, month) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

class OutlookService {
  /**
   * Visão multi-mês simplificada (PDF §3a–c): receita por atendimentos, custos pelo mesmo
   * agregado do relatório mensal do dashboard (`view_monthly_report` / ledger).
   *
   * @param {string} userId
   * @param {number} [months=6] número de meses (1–24), default 6
   */
  async getOutlook(userId, months = 6) {
    const m = clampInt(months, 1, 24);
    const keys = buildOutlookMonths(m);
    if (!keys.length) {
      return {
        months: m,
        meses: [],
        nota:
          'Sem período. Receita = soma de atendimentos.valor_total no mês (data do atendimento). Custos = despesas do mês no livro financeiro (mesma base do GET /api/dashboard/monthly-report). Não é CMV contábil completo.',
      };
    }

    const first = keys[0];
    const last = keys[keys.length - 1];
    const rangeStart = monthStartEnd(first.year, first.month).start;
    const rangeEnd = monthStartEnd(last.year, last.month).end;

    const [atendResult, contasResult] = await Promise.all([
      supabase
        .from('atendimentos')
        .select('data, valor_total')
        .eq('user_id', userId)
        .gte('data', rangeStart)
        .lte('data', rangeEnd),
      supabase
        .from('contas_pagar')
        .select('data_vencimento, valor, is_pro_labore')
        .eq('user_id', userId)
        .gte('data_vencimento', rangeStart)
        .lte('data_vencimento', rangeEnd),
    ]);

    if (atendResult.error) throw atendResult.error;
    if (contasResult.error) throw contasResult.error;

    const receitaByKey = {};
    for (const k of keys) {
      receitaByKey[`${k.year}-${String(k.month).padStart(2, '0')}`] = 0;
    }

    for (const row of atendResult.data || []) {
      if (!row.data) continue;
      const mk = row.data.slice(0, 7);
      if (Object.prototype.hasOwnProperty.call(receitaByKey, mk)) {
        receitaByKey[mk] += parseFloat(row.valor_total) || 0;
      }
    }

    const despesasByKey = {};
    const prolaboreByKey = {};
    for (const k of keys) {
      const mk = `${k.year}-${String(k.month).padStart(2, '0')}`;
      despesasByKey[mk] = 0;
      prolaboreByKey[mk] = 0;
    }

    for (const row of contasResult.data || []) {
      if (!row.data_vencimento) continue;
      const mk = String(row.data_vencimento).slice(0, 7);
      if (!Object.prototype.hasOwnProperty.call(despesasByKey, mk)) continue;
      const valor = parseFloat(row.valor) || 0;
      if (row.is_pro_labore) {
        prolaboreByKey[mk] += valor;
      } else {
        despesasByKey[mk] += valor;
      }
    }

    const meses = keys.map((k) => {
      const mk = `${k.year}-${String(k.month).padStart(2, '0')}`;
      const receita = receitaByKey[mk] || 0;
      const custos_operacionais = despesasByKey[mk] || 0;
      const pro_labore = prolaboreByKey[mk] || 0;
      const custos = custos_operacionais;
      const lucro = receita - custos;
      const margem_pct = receita > 0 ? parseFloat(((lucro / receita) * 100).toFixed(1)) : 0;

      return {
        year: k.year,
        month: k.month,
        receita: parseFloat(receita.toFixed(2)),
        custos_operacionais: parseFloat(custos_operacionais.toFixed(2)),
        pro_labore: parseFloat(pro_labore.toFixed(2)),
        custos: parseFloat(custos.toFixed(2)),
        lucro: parseFloat(lucro.toFixed(2)),
        margem_pct,
      };
    });

    return {
      months: m,
      meses,
      nota:
        'Receita = soma de atendimentos.valor_total no mês civil. Custos operacionais = contas_pagar do mês com is_pro_labore=false. pro_labore é exposto em linha separada e não entra em custos operacionais/margem. Não inclui CMV detalhado por produto.',
    };
  }
}

module.exports = new OutlookService();
