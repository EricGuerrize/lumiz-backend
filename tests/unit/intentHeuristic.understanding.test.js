describe('IntentHeuristicService - entendimento de custos recorrentes', () => {
  let intentHeuristicService;

  beforeEach(() => {
    jest.resetModules();

    jest.doMock('../../src/services/cacheService', () => ({
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true)
    }));

    jest.doMock('../../src/services/knowledgeService', () => ({
      searchSimilarity: jest.fn().mockResolvedValue([])
    }));

    jest.doMock('../../src/utils/procedureKeywords', () => ({
      PROCEDURE_KEYWORDS: ['botox', 'preenchimento'],
      sanitizeClientName: jest.fn((name) => name)
    }));

    jest.doMock('../../src/utils/moneyParser', () => ({
      extractPrimaryMonetaryValue: jest.fn((text) => {
        const raw = String(text || '');
        const match = raw.match(/(\d+(?:[.,]\d+)?)/);
        if (!match) return null;
        const normalized = match[1].replace(/\./g, '').replace(',', '.');
        const parsed = Number.parseFloat(normalized);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
      }),
      extractInstallments: jest.fn().mockReturnValue(null),
      extractMixedPaymentSplit: jest.fn().mockReturnValue(null)
    }));

    intentHeuristicService = require('../../src/services/intentHeuristicService');
  });

  test.each([
    ['luz 1000 reais', 'Energia'],
    ['agua 200', 'Energia'],
    ['telefone 300', 'Internet'],
    ['gas 90', 'Energia'],
    ['condominio 800', 'Outros'],
    ['manutencao 450', 'Outros']
  ])('detecta %s como registrar_saida (%s)', async (message, expectedCategory) => {
    const result = await intentHeuristicService.detectIntent(message, 'clinic-1');

    expect(result).toEqual(expect.objectContaining({
      intencao: 'registrar_saida',
      source: 'heuristic'
    }));

    expect(result.dados).toEqual(expect.objectContaining({
      tipo: 'saida',
      categoria: expectedCategory
    }));

    expect(result.dados.valor).toBeGreaterThan(0);
  });

  test('extractCostInfo mapeia telefone para Internet', () => {
    const costInfo = intentHeuristicService.extractCostInfo('Conta de telefone do consultório');
    expect(costInfo).toEqual({ categoria: 'Internet' });
  });

  test('continua exigindo valor para confirmar intent de saída', async () => {
    const result = await intentHeuristicService.detectIntent('gasto luz', 'clinic-1');
    expect(result).toBeNull();
  });
});
