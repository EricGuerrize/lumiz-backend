const supabase = require('../db/supabase');
const transactionController = require('../controllers/transactionController');

class CashflowService {
  _dateStr(date) {
    return date.toISOString().split('T')[0];
  }

  _addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  _priorityLabel(diasAtraso) {
    if (diasAtraso > 0) return 'vencida';
    if (diasAtraso === 0) return 'hoje';
    if (diasAtraso >= -7) return 'proximo';
    return 'futuro';
  }

  async getContasPagarPriority(userId, { status = 'pendente', daysAhead = 60, limit = 50, offset = 0 } = {}) {
    const today = new Date();
    const endDate = this._dateStr(this._addDays(today, daysAhead));
    const todayStr = this._dateStr(today);

    const { data, error, count } = await supabase
      .from('contas_pagar')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .eq('status_pagamento', status)
      .or(`data_vencimento.lte.${endDate},data_vencimento.is.null`)
      .order('data_vencimento', { ascending: true, nullsFirst: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const items = (data || []).map(conta => {
      const vencimento = conta.data_vencimento;
      const diasAtraso = vencimento
        ? Math.floor((new Date(todayStr) - new Date(vencimento)) / 86400000)
        : null;

      return {
        id: conta.id,
        descricao: conta.descricao,
        valor: parseFloat(conta.valor),
        data_vencimento: vencimento,
        tipo: conta.tipo,
        categoria: conta.categoria,
        status_pagamento: conta.status_pagamento,
        diasAtraso,
        prioridade: diasAtraso !== null ? this._priorityLabel(diasAtraso) : 'futuro',
      };
    });

    const valorTotal = items.reduce((sum, i) => sum + i.valor, 0);

    return { total: count || items.length, valorTotal, items };
  }

  async getCashflowProjection(userId, days = 30) {
    const today = new Date();
    const todayStr = this._dateStr(today);
    const endStr = this._dateStr(this._addDays(today, days));

    const [balanceResult, parcelasResult, contasResult] = await Promise.all([
      transactionController.getBalance(userId),
      supabase
        .from('parcelas')
        .select('id, numero, valor, valor_liquido, data_vencimento, atendimentos!inner(user_id, clientes(nome))')
        .eq('paga', false)
        .eq('atendimentos.user_id', userId)
        .gte('data_vencimento', todayStr)
        .lte('data_vencimento', endStr),
      supabase
        .from('contas_pagar')
        .select('id, descricao, valor, data_vencimento, categoria')
        .eq('user_id', userId)
        .eq('status_pagamento', 'pendente')
        .gte('data_vencimento', todayStr)
        .lte('data_vencimento', endStr),
    ]);

    if (parcelasResult.error) throw parcelasResult.error;
    if (contasResult.error) throw contasResult.error;

    const saldoAtual = balanceResult.saldo || 0;
    const buckets = {};

    for (const p of parcelasResult.data || []) {
      const d = p.data_vencimento;
      if (!buckets[d]) buckets[d] = { entradas: 0, saidas: 0, eventos: [] };
      const valor = parseFloat(p.valor_liquido || p.valor);
      buckets[d].entradas += valor;
      buckets[d].eventos.push({
        tipo: 'entrada',
        descricao: `Parcela ${p.numero} — ${p.atendimentos?.clientes?.nome || 'Cliente'}`,
        valor,
      });
    }

    for (const c of contasResult.data || []) {
      const d = c.data_vencimento;
      if (!d) continue;
      if (!buckets[d]) buckets[d] = { entradas: 0, saidas: 0, eventos: [] };
      const valor = parseFloat(c.valor);
      buckets[d].saidas += valor;
      buckets[d].eventos.push({
        tipo: 'saida',
        descricao: c.descricao || c.categoria || 'Conta a pagar',
        valor,
      });
    }

    const sortedDates = Object.keys(buckets).sort();
    let saldoAcumulado = saldoAtual;
    const days_arr = sortedDates.map(data => {
      const b = buckets[data];
      saldoAcumulado += b.entradas - b.saidas;
      return { data, entradas: b.entradas, saidas: b.saidas, saldoAcumulado, eventos: b.eventos };
    });

    const totalEntradas = days_arr.reduce((s, d) => s + d.entradas, 0);
    const totalSaidas = days_arr.reduce((s, d) => s + d.saidas, 0);

    return {
      saldoAtual,
      projectionDays: days,
      summary: { totalEntradas, totalSaidas, saldoFinal: saldoAtual + totalEntradas - totalSaidas },
      days: days_arr,
    };
  }

  async getFinancialCalendar(userId, startDate, endDate) {
    const startStr = startDate instanceof Date ? this._dateStr(startDate) : startDate;
    const endStr = endDate instanceof Date ? this._dateStr(endDate) : endDate;

    const [parcelasResult, contasResult, fixasResult] = await Promise.all([
      supabase
        .from('parcelas')
        .select('id, numero, valor, valor_liquido, data_vencimento, atendimentos!inner(user_id, clientes(nome))')
        .eq('paga', false)
        .eq('atendimentos.user_id', userId)
        .gte('data_vencimento', startStr)
        .lte('data_vencimento', endStr),
      supabase
        .from('contas_pagar')
        .select('id, descricao, valor, data_vencimento, categoria, status_pagamento')
        .eq('user_id', userId)
        .eq('status_pagamento', 'pendente')
        .gte('data_vencimento', startStr)
        .lte('data_vencimento', endStr),
      supabase
        .from('contas_pagar')
        .select('valor, categoria, data_vencimento')
        .eq('user_id', userId)
        .eq('tipo', 'fixa')
        .lt('data_vencimento', startStr),
    ]);

    const events = {};

    const addEvent = (date, event) => {
      if (!events[date]) events[date] = [];
      events[date].push(event);
    };

    for (const p of parcelasResult.data || []) {
      addEvent(p.data_vencimento, {
        tipo: 'entrada', id: p.id,
        descricao: `Parcela ${p.numero} — ${p.atendimentos?.clientes?.nome || 'Cliente'}`,
        valor: parseFloat(p.valor_liquido || p.valor),
        status: 'pendente', predicted: false,
      });
    }

    for (const c of contasResult.data || []) {
      if (!c.data_vencimento) continue;
      addEvent(c.data_vencimento, {
        tipo: 'saida', id: c.id,
        descricao: c.descricao || c.categoria || 'Conta a pagar',
        valor: parseFloat(c.valor),
        status: c.status_pagamento, predicted: false,
      });
    }

    // Predictive recurring fixed costs
    const fixasByCat = {};
    for (const f of fixasResult.data || []) {
      if (!f.categoria || !f.data_vencimento) continue;
      if (!fixasByCat[f.categoria]) fixasByCat[f.categoria] = { valores: [], dias: [] };
      fixasByCat[f.categoria].valores.push(parseFloat(f.valor));
      fixasByCat[f.categoria].dias.push(new Date(f.data_vencimento + 'T12:00:00').getDate());
    }

    const start = new Date(startStr + 'T12:00:00');
    const end = new Date(endStr + 'T12:00:00');

    for (const [categoria, { valores, dias }] of Object.entries(fixasByCat)) {
      const medianValor = valores.sort((a, b) => a - b)[Math.floor(valores.length / 2)];
      const modalDia = dias.sort((a, b) =>
        dias.filter(d => d === b).length - dias.filter(d => d === a).length
      )[0];

      const cursor = new Date(start);
      while (cursor <= end) {
        if (cursor.getDate() === modalDia) {
          const dateStr = this._dateStr(cursor);
          const alreadyExists = (events[dateStr] || []).some(
            e => e.tipo === 'saida' && !e.predicted && e.descricao?.includes(categoria)
          );
          if (!alreadyExists) {
            addEvent(dateStr, {
              tipo: 'saida', descricao: categoria,
              valor: medianValor, predicted: true,
            });
          }
        }
        cursor.setMonth(cursor.getMonth() + 1);
      }
    }

    const allEvents = Object.values(events).flat();
    const totalEntradasPrevistas = allEvents.filter(e => e.tipo === 'entrada').reduce((s, e) => s + e.valor, 0);
    const totalSaidasPrevistas = allEvents.filter(e => e.tipo === 'saida').reduce((s, e) => s + e.valor, 0);

    return {
      period: { start: startStr, end: endStr },
      summary: { totalEntradasPrevistas, totalSaidasPrevistas, diasComEventos: Object.keys(events).length },
      events,
    };
  }
}

module.exports = new CashflowService();
