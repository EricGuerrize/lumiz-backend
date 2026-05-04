let transactionController;
let simulatorService;

beforeEach(() => {
  jest.resetModules();
  jest.mock('../../src/controllers/transactionController');
  transactionController = require('../../src/controllers/transactionController');
  simulatorService = require('../../src/services/simulatorService');

  transactionController.getMonthlyReport = jest.fn().mockResolvedValue({ entradas: 10000, saidas: 6000, transactions: [] });
  transactionController.getBalance = jest.fn().mockResolvedValue({ saldo: 5000, entradas: 10000, saidas: 6000 });
});

describe('simulatorService.runScenario', () => {
  it('baseline matches report data', async () => {
    const result = await simulatorService.runScenario('user-1');
    expect(result.baseline.entradas).toBe(10000);
    expect(result.baseline.saidas).toBe(6000);
    expect(result.baseline.lucro).toBe(4000);
    expect(result.baseline.saldo).toBe(5000);
  });

  it('extra revenue increases projected entradas', async () => {
    const result = await simulatorService.runScenario('user-1', { extraRevenue: 2000 });
    expect(result.projection.entradas).toBe(12000);
    expect(result.projection.lucro).toBe(6000);
  });

  it('cut expense 50% reduces saidas by half', async () => {
    const result = await simulatorService.runScenario('user-1', { cutExpensePct: 50 });
    expect(result.projection.saidas).toBeCloseTo(3000);
    expect(result.projection.lucro).toBeCloseTo(7000);
  });

  it('new fixed cost adds to projected saidas', async () => {
    const result = await simulatorService.runScenario('user-1', { newFixedCost: 1000 });
    expect(result.projection.saidas).toBeCloseTo(7000);
  });

  it('deltaLucro is difference between projected and baseline lucro', async () => {
    const result = await simulatorService.runScenario('user-1', { extraRevenue: 3000 });
    expect(result.projection.deltaLucro).toBeCloseTo(3000);
  });

  it('margem projetada is correct percentage', async () => {
    const result = await simulatorService.runScenario('user-1');
    // baseline: 10000 entradas, 4000 lucro = 40%
    expect(result.projection.margem).toBeCloseTo(40, 0);
  });
});

describe('simulatorService presets', () => {
  it('price_hike aplica percentual default sobre entradas do mês', async () => {
    const r = await simulatorService.runScenarioPreset('u1', 'price_hike', { month: 5, year: 2026 });
    expect(r.preset).toBe('price_hike');
    expect(r.inputsUsados.price_hike_pct).toBe(5);
    expect(r.projection.entradas).toBeCloseTo(10500);
  });

  it('extra_staff usa custo fixo passado', async () => {
    const r = await simulatorService.runScenarioPreset('u1', 'extra_staff', {
      month: 5,
      year: 2026,
      staffMonthlyCost: 4000,
    });
    expect(r.inputsUsados.staff_monthly_cost).toBe(4000);
    expect(r.projection.saidas).toBeCloseTo(10000);
  });

  it('runAllPresets devolve três cenários', async () => {
    const r = await simulatorService.runAllPresets('u1', { month: 4, year: 2026 });
    expect(r.month).toBe(4);
    expect(r.year).toBe(2026);
    expect(r.cenários).toHaveLength(3);
    expect(r.cenários.map((c) => c.preset)).toEqual(['extra_staff', 'price_hike', 'second_room']);
  });
});
