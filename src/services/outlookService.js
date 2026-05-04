const supabase = require('../db/supabase');
const transactionController = require('../controllers/transactionController');

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

    const [atendResult, ...reports] = await Promise.all([
      supabase
        .from('atendimentos')
        .select('data, valor_total')
        .eq('user_id', userId)
        .gte('data', rangeStart)
        .lte('data', rangeEnd),
      ...keys.map(({ year, month }) => transactionController.getMonthlyReport(userId, year, month)),
    ]);

    if (atendResult.error) throw atendResult.error;

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

    const meses = keys.map((k, idx) => {
      const mk = `${k.year}-${String(k.month).padStart(2, '0')}`;
      const report = reports[idx];
      const receita = receitaByKey[mk] || 0;
      const custos = report ? parseFloat(report.saidas) || 0 : 0;
      const lucro = receita - custos;
      const margem_pct = receita > 0 ? parseFloat(((lucro / receita) * 100).toFixed(1)) : 0;

      return {
        year: k.year,
        month: k.month,
        receita: parseFloat(receita.toFixed(2)),
        custos: parseFloat(custos.toFixed(2)),
        lucro: parseFloat(lucro.toFixed(2)),
        margem_pct,
      };
    });

    return {
      months: m,
      meses,
      nota:
        'Receita = soma de atendimentos.valor_total no mês civil (campo data do atendimento). Custos = despesas (saídas) do mesmo mês no livro financeiro consolidado — mesma base numérica do GET /api/dashboard/monthly-report e dos cards que usam relatório mensal. Não inclui CMV detalhado por produto; margem e lucro são indicativos quando houver receitas lançadas só no ledger ou só em atendimentos.',
    };
  }
}

module.exports = new OutlookService();
