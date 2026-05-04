/**
 * Contratos do plano Lumiz (multi-mês, entrega mensal) sem subir servidor HTTP.
 * Complementa testes unitários e smoke `tests/apiSmoke.test.js` (requer env).
 */

describe('Dashboard plan contracts', () => {
  it('simulatorService.runScenarioMultiMonth devolve série', async () => {
    jest.resetModules();
    jest.mock('../../src/controllers/transactionController');
    const tc = require('../../src/controllers/transactionController');
    tc.getMonthlyReport = jest.fn().mockResolvedValue({
      entradas: 10000,
      saidas: 6000,
      transactions: [],
    });
    tc.getBalance = jest.fn().mockResolvedValue({ saldo: 5000, entradas: 10000, saidas: 6000 });
    const simulatorService = require('../../src/services/simulatorService');
    const r = await simulatorService.runScenarioMultiMonth(
      'user-plan',
      { month: 10, year: 2025, extraRevenue: 100, cutExpensePct: 0, newFixedCost: 0 },
      4
    );
    expect(r.projectionMonths).toBe(4);
    expect(r.meses).toHaveLength(4);
    expect(r.meses[0].year).toBe(2025);
    expect(r.meses[0].month).toBe(10);
  });

  it('monthlyReportDeliveryService exporta função deliver', () => {
    const mod = require('../../src/services/monthlyReportDeliveryService');
    expect(typeof mod.deliverPreviousMonthSummaries).toBe('function');
  });
});
