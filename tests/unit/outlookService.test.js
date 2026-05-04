let outlookService;
let supabase;
let transactionController;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-05-15T12:00:00.000Z'));
  jest.resetModules();
  jest.mock('../../src/db/supabase');
  jest.mock('../../src/controllers/transactionController');
  supabase = require('../../src/db/supabase');
  transactionController = require('../../src/controllers/transactionController');
  outlookService = require('../../src/services/outlookService');
});

afterEach(() => {
  jest.useRealTimers();
});

describe('outlookService.getOutlook', () => {
  it('agrega receita por mês e custos pelo monthly report', async () => {
    supabase.from = jest.fn(() => ({
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
    }));

    let monthCalls = 0;
    transactionController.getMonthlyReport = jest.fn().mockImplementation(() => {
      monthCalls += 1;
      return Promise.resolve({ saidas: monthCalls * 100 });
    });

    const out = await outlookService.getOutlook('user-1', 3);
    expect(out.months).toBe(3);
    expect(out.meses).toHaveLength(3);
    expect(out.meses[0]).toMatchObject({ year: 2026, month: 3 });
    expect(out.meses[0].receita).toBe(1500);
    expect(out.meses[0].custos).toBe(100);
    expect(out.meses[0].lucro).toBe(1400);
    expect(out.meses[1].receita).toBe(200);
    expect(out.nota).toContain('atendimentos');
    expect(out.nota).toContain('monthly-report');
    expect(transactionController.getMonthlyReport).toHaveBeenCalledTimes(3);
  });
});
