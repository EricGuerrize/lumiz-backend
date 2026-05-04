let supabase;
let pricingIntelligenceService;

function buildChain(data) {
  const chain = {};
  ['select', 'eq', 'gte', 'not'].forEach(m => { chain[m] = jest.fn(() => chain); });
  chain.then = resolve => Promise.resolve({ data, error: null }).then(resolve);
  return chain;
}

beforeEach(() => {
  jest.resetModules();
  jest.mock('../../src/db/supabase');
  supabase = require('../../src/db/supabase');
  pricingIntelligenceService = require('../../src/services/pricingIntelligenceService');
});

describe('pricingIntelligenceService.analyze', () => {
  it('groups procedures and computes avgTicket', async () => {
    supabase.from = jest.fn(() => buildChain([
      { observacoes: 'Botox', valor_total: '1500' },
      { observacoes: 'Botox', valor_total: '1000' },
    ]));
    const result = await pricingIntelligenceService.analyze('user-1');
    const botox = result.procedures.find(p => p.procedimento === 'Botox');
    expect(botox.count).toBe(2);
    expect(botox.avgTicket).toBeCloseTo(1250);
  });

  it('marks abaixoMercado true when ticket below benchmark min', async () => {
    supabase.from = jest.fn(() => buildChain([
      { observacoes: 'limpeza de pele', valor_total: '100' }, // below min 150
    ]));
    const result = await pricingIntelligenceService.analyze('user-1');
    expect(result.procedures[0].abaixoMercado).toBe(true);
    expect(result.procedures[0].recomendacao).not.toBeNull();
  });

  it('marks abaixoMercado false when ticket above benchmark min', async () => {
    supabase.from = jest.fn(() => buildChain([
      { observacoes: 'Botox', valor_total: '2000' },
    ]));
    const result = await pricingIntelligenceService.analyze('user-1');
    expect(result.procedures[0].abaixoMercado).toBe(false);
    expect(result.procedures[0].recomendacao).toBeNull();
  });

  it('summary.diasComEventos counts abaixoMercado procedures', async () => {
    supabase.from = jest.fn(() => buildChain([
      { observacoes: 'limpeza', valor_total: '50' },
      { observacoes: 'Botox', valor_total: '2000' },
    ]));
    const result = await pricingIntelligenceService.analyze('user-1');
    expect(result.summary.abaixoMercado).toBe(1);
  });

  it('returns empty procedures when no data', async () => {
    supabase.from = jest.fn(() => buildChain([]));
    const result = await pricingIntelligenceService.analyze('user-1');
    expect(result.procedures).toHaveLength(0);
    expect(result.summary.abaixoMercado).toBe(0);
  });
});
