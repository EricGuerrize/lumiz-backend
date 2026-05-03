const supabase = require('../db/supabase');

// Market benchmarks per procedure category (BRL)
const MARKET_BENCHMARKS = {
  botox: { min: 800, avg: 1500, label: 'Botox/Toxina Botulínica' },
  preenchimento: { min: 1200, avg: 2000, label: 'Preenchimento' },
  limpeza: { min: 150, avg: 300, label: 'Limpeza de Pele' },
  peeling: { min: 200, avg: 500, label: 'Peeling' },
  laser: { min: 400, avg: 900, label: 'Laser' },
  massagem: { min: 120, avg: 250, label: 'Massagem' },
  depilacao: { min: 80, avg: 200, label: 'Depilação a Laser' },
  micropigmentacao: { min: 600, avg: 1200, label: 'Micropigmentação' },
  default: { min: 200, avg: 500, label: 'Procedimento' },
};

function matchBenchmark(procedureName) {
  const name = (procedureName || '').toLowerCase();
  for (const [key, bench] of Object.entries(MARKET_BENCHMARKS)) {
    if (key !== 'default' && name.includes(key)) return { key, ...bench };
  }
  return { key: 'default', ...MARKET_BENCHMARKS.default };
}

class PricingIntelligenceService {
  async analyze(userId, { months = 3 } = {}) {
    const since = new Date();
    since.setMonth(since.getMonth() - months);
    const sinceStr = since.toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('atendimentos')
      .select('procedimento, valor')
      .eq('user_id', userId)
      .gte('data_atendimento', sinceStr)
      .not('procedimento', 'is', null);

    if (error) throw error;

    // Group by procedure name
    const groups = {};
    for (const row of data || []) {
      const proc = (row.procedimento || '').trim();
      if (!proc) continue;
      if (!groups[proc]) groups[proc] = { count: 0, total: 0 };
      groups[proc].count++;
      groups[proc].total += parseFloat(row.valor) || 0;
    }

    const procedures = Object.entries(groups).map(([name, { count, total }]) => {
      const avgTicket = total / count;
      const bench = matchBenchmark(name);
      const vsMarket = bench.avg > 0 ? ((avgTicket - bench.avg) / bench.avg) * 100 : 0;
      const abaixoMercado = avgTicket < bench.min;

      return {
        procedimento: name,
        count,
        avgTicket: parseFloat(avgTicket.toFixed(2)),
        benchmark: { min: bench.min, avg: bench.avg, categoria: bench.label },
        vsMarketPct: parseFloat(vsMarket.toFixed(1)),
        abaixoMercado,
        recomendacao: abaixoMercado
          ? `Seu ticket médio de R$${avgTicket.toFixed(0)} está abaixo do mínimo de mercado (R$${bench.min}). Considere reajustar.`
          : null,
      };
    });

    procedures.sort((a, b) => b.count - a.count);

    const abaixoCount = procedures.filter(p => p.abaixoMercado).length;

    return {
      period: { months, since: sinceStr },
      procedures,
      summary: {
        totalProcedures: procedures.length,
        abaixoMercado: abaixoCount,
        alertas: abaixoCount > 0
          ? `${abaixoCount} procedimento(s) com ticket abaixo do mercado`
          : 'Precificação dentro do mercado',
      },
    };
  }
}

module.exports = new PricingIntelligenceService();
