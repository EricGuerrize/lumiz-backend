let cashflowService;
let evolutionService;
let emergencyModeService;

beforeEach(() => {
  jest.resetModules();
  jest.mock('../../src/db/supabase');
  jest.mock('../../src/services/cashflowService');
  jest.mock('../../src/services/evolutionService');
  cashflowService = require('../../src/services/cashflowService');
  evolutionService = require('../../src/services/evolutionService');
  emergencyModeService = require('../../src/services/emergencyModeService');
});

describe('emergencyModeService.getStatus', () => {
  it('alert=false when all days stay positive', async () => {
    cashflowService.getCashflowProjection = jest.fn().mockResolvedValue({
      saldoAtual: 5000,
      days: [
        { date: '2026-05-04', entradas: 1000, saidas: 500 },
        { date: '2026-05-05', entradas: 0, saidas: 200 },
      ],
      summary: {},
    });
    const result = await emergencyModeService.getStatus('user-1');
    expect(result.alert).toBe(false);
    expect(result.saldoMinimo).toBeGreaterThanOrEqual(0);
  });

  it('alert=true when running balance goes negative', async () => {
    cashflowService.getCashflowProjection = jest.fn().mockResolvedValue({
      saldoAtual: 500,
      days: [
        { date: '2026-05-04', entradas: 0, saidas: 800 }, // goes to -300
      ],
      summary: {},
    });
    const result = await emergencyModeService.getStatus('user-1');
    expect(result.alert).toBe(true);
    expect(result.saldoMinimo).toBeLessThan(0);
    expect(result.dataRisco).toBe('2026-05-04');
  });

  it('saldoMinimo tracks the lowest running balance', async () => {
    cashflowService.getCashflowProjection = jest.fn().mockResolvedValue({
      saldoAtual: 1000,
      days: [
        { date: '2026-05-04', entradas: 0, saidas: 1500 }, // -500
        { date: '2026-05-05', entradas: 200, saidas: 0 },  // -300
      ],
      summary: {},
    });
    const result = await emergencyModeService.getStatus('user-1');
    expect(result.saldoMinimo).toBeCloseTo(-500);
    expect(result.dataRisco).toBe('2026-05-04');
  });
});
