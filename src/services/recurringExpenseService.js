/**
 * WhatsApp-first financeiro — criação de contas recorrentes.
 *
 * Mantém a recorrência como múltiplas linhas futuras em `contas_pagar`,
 * sem criar um modelo novo agora. Isso permite usar os calendários e alertas
 * existentes sem refatoração estrutural.
 */
const transactionController = require('../controllers/transactionController');

function _dateStr(date) {
  return date.toISOString().split('T')[0];
}

function _daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function _addMonthsClamped(baseDate, monthsToAdd, preferredDay) {
  const d = new Date(baseDate);
  const targetMonth = d.getMonth() + monthsToAdd;
  const year = d.getFullYear();
  const day = Math.min(preferredDay || d.getDate(), _daysInMonth(year, targetMonth));
  return new Date(year, targetMonth, day, 12, 0, 0, 0);
}

class RecurringExpenseService {
  parseRecurrenceFromText(text) {
    const raw = String(text || '');
    const normalized = raw
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const isRecurring =
      /\b(todo mes|todo mês|mensal|recorrente|fixo|fixa|sempre|por mes|por mês)\b/i.test(raw);

    if (!isRecurring) return null;

    const monthsMatch =
      normalized.match(/\b(?:por|durante|em)\s+(\d{1,2})\s+(?:meses|mes)\b/) ||
      normalized.match(/\b(\d{1,2})\s*x\s*(?:mensal|meses|mes)?\b/);
    const months = monthsMatch ? Math.min(Math.max(Number(monthsMatch[1]) || 12, 1), 24) : 12;

    const dueDayMatch =
      normalized.match(/\b(?:vence|vencimento|dia|todo dia)\s*(?:todo\s*)?(?:dia\s*)?([0-2]?\d|3[01])\b/) ||
      normalized.match(/\b([0-2]?\d|3[01])\s*(?:de cada mes|todo mes|todo mês)\b/i);
    const dueDay = dueDayMatch ? Math.min(Math.max(Number(dueDayMatch[1]), 1), 31) : null;

    return { months, dueDay };
  }

  isFixedCostText(text) {
    return /\b(aluguel|internet|energia|luz|agua|água|telefone|software|contador|salario|salário|condominio|condomínio)\b/i
      .test(String(text || ''));
  }

  async createRecurring(userId, dados, traceability = {}) {
    const recurrence = dados.recurrence || {};
    const months = Math.min(Math.max(Number(recurrence.months) || 12, 1), 24);
    const base = new Date(`${dados.data || _dateStr(new Date())}T12:00:00`);
    const dueDay = recurrence.dueDay || base.getDate();
    const created = [];

    for (let i = 0; i < months; i += 1) {
      const dueDate = _addMonthsClamped(base, i, dueDay);
      const dueStr = _dateStr(dueDate);
      const conta = await transactionController.createContaPagar(userId, {
        valor: Math.abs(Number(dados.valor) || 0),
        descricao: dados.descricao || dados.categoria || 'Despesa recorrente',
        categoria: dados.categoria || 'Outros',
        data: dueStr,
        tipo: 'fixa',
        status_pagamento: 'pendente',
        observacoes: `Recorrência WhatsApp ${i + 1}/${months}`,
        ...traceability,
        metadata: {
          ...(traceability.metadata || {}),
          recurring: true,
          recurring_index: i + 1,
          recurring_total: months
        }
      });
      created.push(conta);
    }

    return { created, months, dueDay };
  }
}

module.exports = new RecurringExpenseService();
