// Build a chainable Supabase mock
function buildQueryMock(resolveValue) {
  const chain = {};
  ['select','eq','or','not','gte','lte','lt','gt','order','range'].forEach(m => {
    chain[m] = jest.fn(() => chain);
  });
  chain.then = (resolve) => Promise.resolve(resolveValue).then(resolve);
  Object.defineProperty(chain, Symbol.toStringTag, { value: 'MockQuery' });
  return chain;
}

let cashflowService;
let supabase;
let transactionController;

beforeEach(() => {
  jest.resetModules();
  jest.mock('../../src/db/supabase');
  jest.mock('../../src/controllers/transactionController');
  supabase = require('../../src/db/supabase');
  transactionController = require('../../src/controllers/transactionController');
  cashflowService = require('../../src/services/cashflowService');
});

// Helper: today + N days as YYYY-MM-DD
function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

describe('getContasPagarPriority', () => {
  function setupMock(contas) {
    const chain = buildQueryMock({ data: contas, error: null, count: contas.length });
    supabase.from = jest.fn(() => chain);
  }

  it('classifica conta vencida ontem como "vencida" com diasAtraso positivo', async () => {
    setupMock([{ id: '1', descricao: 'Aluguel', valor: '3000', data_vencimento: dateOffset(-1), status_pagamento: 'pendente' }]);
    const result = await cashflowService.getContasPagarPriority('user-1');
    expect(result.items[0].prioridade).toBe('vencida');
    expect(result.items[0].diasAtraso).toBeGreaterThan(0);
  });

  it('classifica conta vencendo hoje como "hoje" com diasAtraso 0', async () => {
    setupMock([{ id: '2', descricao: 'Internet', valor: '150', data_vencimento: dateOffset(0), status_pagamento: 'pendente' }]);
    const result = await cashflowService.getContasPagarPriority('user-1');
    expect(result.items[0].prioridade).toBe('hoje');
    expect(result.items[0].diasAtraso).toBe(0);
  });

  it('classifica conta em 3 dias como "proximo"', async () => {
    setupMock([{ id: '3', descricao: 'Energia', valor: '500', data_vencimento: dateOffset(3), status_pagamento: 'pendente' }]);
    const result = await cashflowService.getContasPagarPriority('user-1');
    expect(result.items[0].prioridade).toBe('proximo');
  });

  it('classifica conta em 30 dias como "futuro"', async () => {
    setupMock([{ id: '4', descricao: 'Seguro', valor: '800', data_vencimento: dateOffset(30), status_pagamento: 'pendente' }]);
    const result = await cashflowService.getContasPagarPriority('user-1');
    expect(result.items[0].prioridade).toBe('futuro');
  });

  it('calcula valorTotal corretamente', async () => {
    setupMock([
      { id: '1', descricao: 'A', valor: '1000', data_vencimento: dateOffset(1), status_pagamento: 'pendente' },
      { id: '2', descricao: 'B', valor: '500',  data_vencimento: dateOffset(5), status_pagamento: 'pendente' },
    ]);
    const result = await cashflowService.getContasPagarPriority('user-1');
    expect(result.valorTotal).toBeCloseTo(1500);
  });
});

describe('getCashflowProjection', () => {
  const tomorrow = dateOffset(1);

  beforeEach(() => {
    transactionController.getBalance = jest.fn().mockResolvedValue({ saldo: 8000, entradas: 10000, saidas: 2000 });

    let callCount = 0;
    supabase.from = jest.fn(() => {
      callCount++;
      if (callCount === 2) {
        return buildQueryMock({ data: [{ id: 'p1', numero: 1, valor: '700', valor_liquido: '680', data_vencimento: tomorrow, atendimentos: { user_id: 'user-1', clientes: { nome: 'Maria' } } }], error: null });
      }
      if (callCount === 3) {
        return buildQueryMock({ data: [{ id: 'c1', descricao: 'Aluguel', valor: '3000', data_vencimento: tomorrow, categoria: 'fixo' }], error: null });
      }
      return buildQueryMock({ data: [], error: null });
    });
  });

  it('invariante: saldoFinal = saldoAtual + totalEntradas - totalSaidas', async () => {
    const result = await cashflowService.getCashflowProjection('user-1', 30);
    const expected = result.saldoAtual + result.summary.totalEntradas - result.summary.totalSaidas;
    expect(Math.abs(result.summary.saldoFinal - expected)).toBeLessThan(0.01);
  });

  it('usa saldo atual real como ponto de partida', async () => {
    const result = await cashflowService.getCashflowProjection('user-1', 30);
    expect(result.saldoAtual).toBe(8000);
  });

  it('dias sem eventos não aparecem no array days', async () => {
    const result = await cashflowService.getCashflowProjection('user-1', 30);
    expect(result.days.every(d => d.entradas > 0 || d.saidas > 0)).toBe(true);
  });
});

describe('getFinancialCalendar', () => {
  const start = dateOffset(0);
  const end = dateOffset(30);

  beforeEach(() => {
    let callCount = 0;
    supabase.from = jest.fn(() => {
      callCount++;
      if (callCount === 1) {
        return buildQueryMock({ data: [{ id: 'p1', numero: 1, valor: '500', valor_liquido: '490', data_vencimento: dateOffset(5), atendimentos: { user_id: 'user-1', clientes: { nome: 'João' } } }], error: null });
      }
      if (callCount === 2) {
        return buildQueryMock({ data: [{ id: 'c1', descricao: 'Energia', valor: '300', data_vencimento: dateOffset(3), categoria: 'fixo', status_pagamento: 'pendente' }], error: null });
      }
      if (callCount === 3) {
        return buildQueryMock({ data: [], error: null });
      }
      return buildQueryMock({ data: [], error: null });
    });
  });

  it('eventos reais aparecem com predicted: false', async () => {
    const result = await cashflowService.getFinancialCalendar('user-1', start, end);
    const allEvents = Object.values(result.events).flat();
    const realEvents = allEvents.filter(e => !e.predicted);
    expect(realEvents.length).toBeGreaterThan(0);
    realEvents.forEach(e => expect(e.predicted).toBe(false));
  });

  it('summary.diasComEventos bate com Object.keys(events).length', async () => {
    const result = await cashflowService.getFinancialCalendar('user-1', start, end);
    expect(result.summary.diasComEventos).toBe(Object.keys(result.events).length);
  });

  it('retorna period com start e end corretos', async () => {
    const result = await cashflowService.getFinancialCalendar('user-1', start, end);
    expect(result.period.start).toBe(start);
    expect(result.period.end).toBe(end);
  });
});
