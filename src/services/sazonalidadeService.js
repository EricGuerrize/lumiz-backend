const supabase = require('../db/supabase');

class SazonalidadeService {
  _dateStr(date) {
    return date.toISOString().split('T')[0];
  }

  _monthKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  _buildMonthSeries(months) {
    const now = new Date();
    const series = [];
    for (let i = months - 1; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      series.push(this._monthKey(d));
    }
    return series;
  }

  _sum(values) {
    return values.reduce((sum, item) => sum + item, 0);
  }

  async getSazonalidade(userId, months = 12) {
    const monthKeys = this._buildMonthSeries(months);
    const startMonth = monthKeys[0];
    const endMonth = monthKeys[monthKeys.length - 1];
    const startDate = `${startMonth}-01`;
    const endDate = this._dateStr(new Date(new Date(`${endMonth}-01T12:00:00`).getFullYear(), new Date(`${endMonth}-01T12:00:00`).getMonth() + 1, 0));

    const [revenuesResult, costsResult] = await Promise.all([
      supabase
        .from('atendimentos')
        .select('data, valor_total')
        .eq('user_id', userId)
        .gte('data', startDate)
        .lte('data', endDate),
      supabase
        .from('contas_pagar')
        .select('data, valor')
        .eq('user_id', userId)
        .gte('data', startDate)
        .lte('data', endDate),
    ]);

    if (revenuesResult.error) throw revenuesResult.error;
    if (costsResult.error) throw costsResult.error;

    const buckets = {};
    for (const key of monthKeys) {
      buckets[key] = { mes: key, receita: 0, custos: 0, lucro: 0 };
    }

    for (const row of revenuesResult.data || []) {
      if (!row.data) continue;
      const monthKey = row.data.slice(0, 7);
      if (!buckets[monthKey]) continue;
      buckets[monthKey].receita += parseFloat(row.valor_total) || 0;
    }

    for (const row of costsResult.data || []) {
      if (!row.data) continue;
      const monthKey = row.data.slice(0, 7);
      if (!buckets[monthKey]) continue;
      buckets[monthKey].custos += parseFloat(row.valor) || 0;
    }

    const meses = monthKeys.map((key) => {
      const item = buckets[key];
      item.lucro = item.receita - item.custos;
      return {
        mes: item.mes,
        receita: parseFloat(item.receita.toFixed(2)),
        custos: parseFloat(item.custos.toFixed(2)),
        lucro: parseFloat(item.lucro.toFixed(2)),
      };
    });

    const mesForte = meses.reduce((max, m) => (m.receita > max.receita ? m : max), meses[0] || { mes: null, receita: 0 });
    const mesFraco = meses.reduce((min, m) => (m.receita < min.receita ? m : min), meses[0] || { mes: null, receita: 0 });
    const mediaReceita = meses.length ? this._sum(meses.map((m) => m.receita)) / meses.length : 0;

    const last3 = meses.slice(-3).map((m) => m.receita);
    const prev3 = meses.slice(-6, -3).map((m) => m.receita);
    const avgLast3 = last3.length ? this._sum(last3) / last3.length : 0;
    const avgPrev3 = prev3.length ? this._sum(prev3) / prev3.length : 0;
    const variacao = avgPrev3 > 0 ? ((avgLast3 - avgPrev3) / avgPrev3) * 100 : (avgLast3 > 0 ? 100 : 0);

    let direcao = 'estavel';
    if (variacao > 5) direcao = 'alta';
    if (variacao < -5) direcao = 'queda';

    const tendencia = {
      direcao,
      variacaoPct: parseFloat(variacao.toFixed(1)),
    };

    let insight = `Seu mês mais forte foi ${mesForte.mes} e o mais fraco ${mesFraco.mes}.`;
    if (direcao === 'alta') {
      insight += ' A receita recente indica aceleração nos últimos 3 meses.';
    } else if (direcao === 'queda') {
      insight += ' Há desaceleração recente, vale revisar canais e campanhas.';
    } else {
      insight += ' O faturamento está relativamente estável no período.';
    }

    return {
      meses,
      mesForte: { mes: mesForte.mes, receita: mesForte.receita },
      mesFraco: { mes: mesFraco.mes, receita: mesFraco.receita },
      mediaReceita: parseFloat(mediaReceita.toFixed(2)),
      tendencia,
      insight,
    };
  }
}

module.exports = new SazonalidadeService();
