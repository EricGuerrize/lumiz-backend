let outlookService;
let supabase;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-05-15T12:00:00.000Z'));
  jest.resetModules();
  jest.mock('../../src/db/supabase');
  supabase = require('../../src/db/supabase');
  outlookService = require('../../src/services/outlookService');
});

afterEach(() => {
  jest.useRealTimers();
});

describe('outlookService.getOutlook', () => {
  it('agrega receita por mês e separa custos operacionais e pró-labore', async () => {
    supabase.from = jest.fn((table) => {
      if (table === 'atendimentos') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          gte: jest.fn().mockReturnThis(),
          lte: jest.fn().mockReturnThis(),
          then: (cb) =>
            Promise.resolve({
              data: [
                { data: '2026-03-10', valor_total: '1000' },
                { data: '2026-03-20', valor_total: '500' },
                { data: '2026-04-01', valor_total: '200' },
              ],
              error: null,
            }).then(cb),
        };
      }
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        lte: jest.fn().mockReturnThis(),
        then: (cb) =>
          Promise.resolve({
            data: [
              { data_vencimento: '2026-03-05', valor: '100', is_pro_labore: false },
              { data_vencimento: '2026-03-08', valor: '50', is_pro_labore: true },
              { data_vencimento: '2026-04-10', valor: '80', is_pro_labore: false },
            ],
            error: null,
          }).then(cb),
      };
    });

    const out = await outlookService.getOutlook('user-1', 3);
    expect(out.months).toBe(3);
    expect(out.meses).toHaveLength(3);
    expect(out.meses[0]).toMatchObject({ year: 2026, month: 3 });
    expect(out.meses[0].receita).toBe(1500);
    expect(out.meses[0].custos).toBe(100);
    expect(out.meses[0].lucro).toBe(1400);
    expect(out.meses[0].pro_labore).toBe(50);
    expect(out.meses[1].receita).toBe(200);
    expect(out.meses[1].custos_operacionais).toBe(80);
    expect(out.nota).toContain('atendimentos');
    expect(out.nota).toContain('is_pro_labore');
  });
});
