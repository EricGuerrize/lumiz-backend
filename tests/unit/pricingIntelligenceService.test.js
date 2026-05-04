function mockSupabaseAtendimentos(rows) {
  const end = { data: rows, error: null };
  const chain = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    gte: jest.fn(() => chain),
    not: jest.fn(() => Promise.resolve(end)),
  };
  return chain;
}

describe('pricingIntelligenceService (sem env merge)', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.PRICING_BENCHMARK_JSON;
    jest.doMock('../../src/db/supabase', () => ({
      from: jest.fn(() =>
        mockSupabaseAtendimentos([{ observacoes: 'Botox teste', valor_total: '900' }])
      ),
    }));
  });

  it('usa summary.fonteBenchmark estatico', async () => {
    const svc = require('../../src/services/pricingIntelligenceService');
    const r = await svc.analyze('user-1', { months: 1 });
    expect(r.summary.fonteBenchmark).toBe('estatico');
    expect(r.procedures.length).toBeGreaterThanOrEqual(1);
  });
});

describe('pricingIntelligenceService (PRICING_BENCHMARK_JSON)', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.PRICING_BENCHMARK_JSON = JSON.stringify({
      botox: { min: 999, avg: 1999, label: 'Botox QA' },
    });
    jest.doMock('../../src/db/supabase', () => ({
      from: jest.fn(() =>
        mockSupabaseAtendimentos([{ observacoes: 'Botox teste', valor_total: '1500' }])
      ),
    }));
  });

  afterEach(() => {
    delete process.env.PRICING_BENCHMARK_JSON;
  });

  it('mescla benchmarks a partir do env', async () => {
    const svc = require('../../src/services/pricingIntelligenceService');
    const r = await svc.analyze('user-1', { months: 1 });
    expect(r.summary.fonteBenchmark).toBe('estatico+env');
    const b = r.procedures.find((p) => String(p.procedimento).toLowerCase().includes('botox'));
    expect(b).toBeTruthy();
    expect(b.benchmark.min).toBe(999);
    expect(b.benchmark.avg).toBe(1999);
  });
});
