describe('IntentHeuristicService', () => {
  let intentHeuristicService;
  let knowledgeService;

  beforeEach(() => {
    jest.resetModules();

    jest.doMock('../../src/services/cacheService', () => ({
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true)
    }));

    jest.doMock('../../src/services/knowledgeService', () => ({
      searchSimilarity: jest.fn()
    }));

    jest.doMock('../../src/utils/moneyParser', () => ({
      extractPrimaryMonetaryValue: jest.fn().mockReturnValue(null),
      extractInstallments: jest.fn().mockReturnValue(null),
      extractMixedPaymentSplit: jest.fn().mockReturnValue(null)
    }));

    jest.doMock('../../src/utils/procedureKeywords', () => ({
      PROCEDURE_KEYWORDS: ['botox'],
      sanitizeClientName: jest.fn(name => name)
    }));

    intentHeuristicService = require('../../src/services/intentHeuristicService');
    knowledgeService = require('../../src/services/knowledgeService');
  });

  test('detectIntent usa clinicId na busca semantica e retorna source learned', async () => {
    knowledgeService.searchSimilarity.mockResolvedValue([
      {
        id: 'learned-1',
        content: 'gastei 120 em marketing',
        intent_name: 'registrar_saida',
        metadata: { categoria: 'Marketing' },
        similarity: 0.98
      }
    ]);

    const result = await intentHeuristicService.detectIntent('gastei 120 em marketing', 'clinic-abc');

    expect(knowledgeService.searchSimilarity).toHaveBeenCalledWith('gastei 120 em marketing', 'clinic-abc', 0.95);
    expect(result).toEqual(expect.objectContaining({
      intencao: 'registrar_saida',
      source: 'learned',
      confidence: 0.98
    }));
    expect(result.dados).toEqual(expect.objectContaining({
      categoria: 'Marketing',
      learned: true
    }));
  });
});
