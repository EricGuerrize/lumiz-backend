describe('KnowledgeService', () => {
  let knowledgeService;
  let supabase;
  let embeddingService;

  beforeEach(() => {
    jest.resetModules();

    process.env.KNOWLEDGE_ENABLED = 'true';
    process.env.KNOWLEDGE_ROLLOUT_PERCENT = '100';

    jest.doMock('../../src/db/supabase', () => ({
      from: jest.fn(),
      rpc: jest.fn()
    }));

    jest.doMock('../../src/services/embeddingService', () => ({
      generate: jest.fn()
    }));

    knowledgeService = require('../../src/services/knowledgeService');
    supabase = require('../../src/db/supabase');
    embeddingService = require('../../src/services/embeddingService');

    knowledgeService._tableAvailable = true;
  });

  afterEach(() => {
    delete process.env.KNOWLEDGE_ENABLED;
    delete process.env.KNOWLEDGE_ROLLOUT_PERCENT;
  });

  test('saveInteraction salva clinic_id corretamente', async () => {
    embeddingService.generate.mockResolvedValue([0.1, 0.2, 0.3]);

    const maybeSingle = jest.fn().mockResolvedValue({
      data: { id: 'knowledge-1' },
      error: null
    });
    const select = jest.fn(() => ({ maybeSingle }));
    const insert = jest.fn(() => ({ select }));
    supabase.from.mockReturnValue({ insert });

    const result = await knowledgeService.saveInteraction(
      'botox 2800 pix',
      'registrar_receita',
      { categoria: 'Botox' },
      'clinic-123'
    );

    expect(supabase.from).toHaveBeenCalledWith('learned_knowledge');
    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({
        clinic_id: 'clinic-123',
        is_global: false,
        intent_name: 'registrar_receita'
      })
    ]);
    expect(result).toEqual({ id: 'knowledge-1' });
  });

  test('searchSimilarity busca por RPC quando feature ligada e clinic no rollout', async () => {
    embeddingService.generate.mockResolvedValue([0.1, 0.2, 0.3]);
    supabase.rpc.mockResolvedValue({
      data: [{ id: 'k1', similarity: 0.96 }],
      error: null
    });

    const result = await knowledgeService.searchSimilarity('texto', 'clinic-123', 0.95);

    expect(embeddingService.generate).toHaveBeenCalledWith('texto');
    expect(supabase.rpc).toHaveBeenCalledWith('match_learned_knowledge', {
      query_embedding: [0.1, 0.2, 0.3],
      match_threshold: 0.95,
      match_count: 3,
      p_clinic_id: 'clinic-123'
    });
    expect(result).toEqual([{ id: 'k1', similarity: 0.96 }]);
  });

  test('searchSimilarity nao roda quando KNOWLEDGE_ENABLED=false', async () => {
    process.env.KNOWLEDGE_ENABLED = 'false';

    const result = await knowledgeService.searchSimilarity('texto', 'clinic-123', 0.95);

    expect(result).toEqual([]);
    expect(embeddingService.generate).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  test('searchSimilarity desativa quando tabela nao existe', async () => {
    embeddingService.generate.mockResolvedValue([0.1, 0.2, 0.3]);
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'relation "learned_knowledge" does not exist' }
    });

    const first = await knowledgeService.searchSimilarity('texto', 'clinic-123', 0.95);
    expect(first).toEqual([]);
    expect(knowledgeService._tableAvailable).toBe(false);

    supabase.rpc.mockClear();
    embeddingService.generate.mockClear();

    const second = await knowledgeService.searchSimilarity('texto', 'clinic-123', 0.95);
    expect(second).toEqual([]);
    expect(embeddingService.generate).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  test('searchSimilarity respeita rollout 0%', async () => {
    process.env.KNOWLEDGE_ROLLOUT_PERCENT = '0';

    const result = await knowledgeService.searchSimilarity('texto', 'clinic-123', 0.95);

    expect(result).toEqual([]);
    expect(embeddingService.generate).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
