describe('IntentHeuristicService - tokens de opcao nao viram valor', () => {
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
        const raw = String(text || '').trim();
        const m = raw.match(/^(\d+(?:[.,]\d+)?)$/);
        if (!m) return null;
        return Number.parseFloat(m[1].replace(',', '.'));
      }),
      extractInstallments: jest.fn().mockReturnValue(null),
      extractMixedPaymentSplit: jest.fn().mockReturnValue(null)
    }));

    intentHeuristicService = require('../../src/services/intentHeuristicService');
  });

  test.each(['1', '2', '3', '4'])('token "%s" nao classifica como apenas_valor', async (token) => {
    const result = await intentHeuristicService.detectIntent(token, 'clinic-1');
    expect(result).toBeNull();
  });

  test.each(['100', '2800', '1500,50'])('numero real "%s" continua como apenas_valor', async (token) => {
    const result = await intentHeuristicService.detectIntent(token, 'clinic-1');
    expect(result).toEqual(expect.objectContaining({
      intencao: 'apenas_valor',
      source: 'heuristic'
    }));
    expect(result.dados.valor).toBeGreaterThan(0);
  });
});
