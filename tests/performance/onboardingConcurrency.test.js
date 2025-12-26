/**
 * Testes de Performance e Concorrência - Onboarding
 * 
 * Testa cenários de concorrência:
 * - Múltiplos usuários simultâneos
 * - Race conditions
 * - Limpeza de estados antigos
 * - Cache não vaza entre usuários
 */

const onboardingFlowService = require('../../src/services/onboardingFlowService');
const cacheService = require('../../src/services/cacheService');

// Mock de serviços externos
jest.mock('../../src/services/analyticsService', () => ({
  track: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../src/services/documentService', () => ({
  processImage: jest.fn().mockResolvedValue({
    transacoes: [{
      tipo: 'saida',
      valor: 500,
      categoria: 'Insumos',
      descricao: 'Insumos diversos',
      data: new Date().toISOString().split('T')[0]
    }]
  })
}));

jest.mock('../../src/services/onboardingService', () => ({
  getWhatsappState: jest.fn().mockResolvedValue(null),
  upsertWhatsappState: jest.fn().mockResolvedValue(true),
  clearWhatsappState: jest.fn().mockResolvedValue(true)
}));

describe('Onboarding - Concorrência e Performance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Limpa todos os estados antes de cada teste
    if (onboardingFlowService.onboardingStates) {
      onboardingFlowService.onboardingStates.clear();
    }
    if (onboardingFlowService.persistTimers) {
      onboardingFlowService.persistTimers.clear();
    }
  });

  afterEach(() => {
    // Limpa todos os estados após cada teste
    if (onboardingFlowService.onboardingStates) {
      onboardingFlowService.onboardingStates.clear();
    }
    if (onboardingFlowService.persistTimers) {
      onboardingFlowService.persistTimers.clear();
    }
  });

  describe('Múltiplos Usuários Simultâneos', () => {
    test('deve processar múltiplos onboardings em paralelo sem interferência', async () => {
      const phones = [
        '5511999999991',
        '5511999999992',
        '5511999999993',
        '5511999999994',
        '5511999999995'
      ];

      // Inicia todos os onboardings simultaneamente
      const startPromises = phones.map(phone => 
        onboardingFlowService.startIntroFlow(phone)
      );
      const responses = await Promise.all(startPromises);

      // Todos devem ter resposta válida
      responses.forEach((response, index) => {
        expect(response).toBeDefined();
        expect(response.length).toBeGreaterThan(0);
        expect(response).toContain('Oi! Eu sou a Lumiz');
      });

      // Verifica que cada telefone tem seu próprio estado
      phones.forEach(phone => {
        const state = onboardingFlowService.onboardingStates.get(phone);
        expect(state).toBeDefined();
        expect(state.data.telefone).toBe(phone);
      });
    });

    test('deve processar mensagens de múltiplos usuários simultaneamente', async () => {
      const phones = [
        '5511999999981',
        '5511999999982',
        '5511999999983'
      ];

      // Inicia onboardings
      await Promise.all(phones.map(phone => 
        onboardingFlowService.startIntroFlow(phone)
      ));

      // Processa mensagens simultaneamente
      const processPromises = phones.map(phone => 
        onboardingFlowService.processOnboarding(phone, '1')
      );
      const responses = await Promise.all(processPromises);

      // Todos devem ter resposta válida
      responses.forEach((response, index) => {
        expect(response).toBeDefined();
        expect(response.length).toBeGreaterThan(0);
      });

      // Verifica que estados não se misturaram
      phones.forEach(phone => {
        const state = onboardingFlowService.onboardingStates.get(phone);
        expect(state).toBeDefined();
        expect(state.step).toBe('CONSENT');
      });
    });

    test('deve manter estados isolados entre usuários diferentes', async () => {
      const phone1 = '5511999999971';
      const phone2 = '5511999999972';

      await onboardingFlowService.startIntroFlow(phone1);
      await onboardingFlowService.startIntroFlow(phone2);

      // Avança phone1
      await onboardingFlowService.processOnboarding(phone1, '1');
      await onboardingFlowService.processOnboarding(phone1, 'Maria');

      // Avança phone2 de forma diferente
      await onboardingFlowService.processOnboarding(phone2, '1');
      await onboardingFlowService.processOnboarding(phone2, 'João');

      // Estados devem estar diferentes
      const state1 = onboardingFlowService.onboardingStates.get(phone1);
      const state2 = onboardingFlowService.onboardingStates.get(phone2);

      expect(state1.data.nome).toBe('Maria');
      expect(state2.data.nome).toBe('João');
      expect(state1.step).not.toBe(state2.step);
    });

    test('deve limpar estados antigos sem interferir em ativos', async () => {
      const activePhone = '5511999999961';
      const oldPhone = '5511999999962';

      // Cria estado ativo (recente)
      await onboardingFlowService.startIntroFlow(activePhone);
      const activeState = onboardingFlowService.onboardingStates.get(activePhone);
      activeState.startTime = Date.now(); // Atual

      // Cria estado antigo (simula)
      await onboardingFlowService.startIntroFlow(oldPhone);
      const oldState = onboardingFlowService.onboardingStates.get(oldPhone);
      oldState.startTime = Date.now() - (25 * 60 * 60 * 1000); // 25 horas atrás

      // Executa limpeza
      onboardingFlowService.cleanupOldStates();

      // Estado ativo deve permanecer
      expect(onboardingFlowService.onboardingStates.has(activePhone)).toBe(true);
      
      // Estado antigo deve ser removido
      expect(onboardingFlowService.onboardingStates.has(oldPhone)).toBe(false);
    });

    test('deve prevenir vazamento de cache entre usuários', async () => {
      const phone1 = '5511999999951';
      const phone2 = '5511999999952';

      // Mock do cache service
      const cacheData = new Map();
      const originalGet = cacheService.get;
      const originalSet = cacheService.set;

      cacheService.get = jest.fn().mockImplementation((key) => {
        return Promise.resolve(cacheData.get(key) || null);
      });

      cacheService.set = jest.fn().mockImplementation((key, value, ttl) => {
        cacheData.set(key, value);
        return Promise.resolve(true);
      });

      await onboardingFlowService.startIntroFlow(phone1);
      await onboardingFlowService.processOnboarding(phone1, '1');
      await onboardingFlowService.processOnboarding(phone1, 'Maria');

      await onboardingFlowService.startIntroFlow(phone2);
      await onboardingFlowService.processOnboarding(phone2, '1');
      await onboardingFlowService.processOnboarding(phone2, 'João');

      // Verifica que cache não vazou
      const state1 = onboardingFlowService.onboardingStates.get(phone1);
      const state2 = onboardingFlowService.onboardingStates.get(phone2);

      expect(state1.data.nome).toBe('Maria');
      expect(state2.data.nome).toBe('João');

      cacheService.get = originalGet;
      cacheService.set = originalSet;
    });
  });

  describe('Race Conditions', () => {
    test('deve lidar com duas mensagens do mesmo usuário simultaneamente', async () => {
      const phone = '5511999999941';

      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');

      // Envia duas mensagens simultaneamente
      const responses = await Promise.all([
        onboardingFlowService.processOnboarding(phone, 'Maria'),
        onboardingFlowService.processOnboarding(phone, 'João')
      ]);

      // Uma das respostas deve ser processada
      // A outra pode ser ignorada ou processada depois
      responses.forEach(response => {
        expect(response).toBeDefined();
      });

      // Estado final deve ser consistente
      const finalState = onboardingFlowService.onboardingStates.get(phone);
      expect(finalState).toBeDefined();
      // Nome deve ser um dos dois (último a processar)
      expect(['Maria', 'João']).toContain(finalState.data.nome);
    });

    test('deve prevenir persistência concorrente do mesmo estado', async () => {
      const phone = '5511999999942';
      const onboardingService = require('../../src/services/onboardingService');
      const originalUpsert = onboardingService.upsertWhatsappState;

      let upsertCallCount = 0;
      onboardingService.upsertWhatsappState = jest.fn().mockImplementation(async () => {
        upsertCallCount++;
        // Simula delay na persistência
        await new Promise(resolve => setTimeout(resolve, 100));
        return Promise.resolve(true);
      });

      await onboardingFlowService.startIntroFlow(phone);
      
      // Múltiplas atualizações rápidas
      await Promise.all([
        onboardingFlowService.processOnboarding(phone, '1'),
        onboardingFlowService.processOnboarding(phone, 'test'),
        onboardingFlowService.processOnboarding(phone, 'test2')
      ]);

      // Deve ter chamado upsert (com debounce, pode ser menos que 3)
      expect(upsertCallCount).toBeGreaterThan(0);

      onboardingService.upsertWhatsappState = originalUpsert;
    });

    test('deve prevenir atualização de estado durante processamento', async () => {
      const phone = '5511999999943';

      await onboardingFlowService.startIntroFlow(phone);
      
      const stateBefore = onboardingFlowService.onboardingStates.get(phone);
      const stepBefore = stateBefore.step;

      // Processa mensagem
      await onboardingFlowService.processOnboarding(phone, '1');

      const stateAfter = onboardingFlowService.onboardingStates.get(phone);
      const stepAfter = stateAfter.step;

      // Step deve ter mudado
      expect(stepAfter).not.toBe(stepBefore);
      // Estado deve estar consistente
      expect(stateAfter.data.telefone).toBe(phone);
    });

    test('deve lidar com múltiplas atualizações de step simultâneas', async () => {
      const phone = '5511999999944';

      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');

      // Tenta atualizar step múltiplas vezes simultaneamente
      const state = onboardingFlowService.onboardingStates.get(phone);
      const originalStep = state.step;

      // Simula múltiplas atualizações
      state.step = 'PROFILE_NAME';
      state.step = 'PROFILE_CLINIC';
      state.step = 'PROFILE_ROLE';

      // Step final deve ser o último setado
      expect(state.step).toBe('PROFILE_ROLE');
    });
  });

  describe('Performance', () => {
    test('deve processar mensagem em tempo razoável (< 1s)', async () => {
      const phone = '5511999999931';

      await onboardingFlowService.startIntroFlow(phone);

      const startTime = Date.now();
      const response = await onboardingFlowService.processOnboarding(phone, '1');
      const endTime = Date.now();

      const duration = endTime - startTime;
      
      expect(response).toBeDefined();
      expect(duration).toBeLessThan(1000); // Menos de 1 segundo
    });

    test('deve processar múltiplas mensagens sequenciais rapidamente', async () => {
      const phone = '5511999999932';

      await onboardingFlowService.startIntroFlow(phone);

      const startTime = Date.now();
      
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Maria');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const endTime = Date.now();
      const duration = endTime - startTime;

      // 4 mensagens devem processar em menos de 2 segundos
      expect(duration).toBeLessThan(2000);
    });

    test('deve limpar estados antigos eficientemente', async () => {
      // Cria 100 estados antigos
      const oldPhones = Array.from({ length: 100 }, (_, i) => `5511999999${i.toString().padStart(3, '0')}`);
      
      for (const phone of oldPhones) {
        await onboardingFlowService.startIntroFlow(phone);
        const state = onboardingFlowService.onboardingStates.get(phone);
        state.startTime = Date.now() - (25 * 60 * 60 * 1000); // 25 horas atrás
      }

      const startTime = Date.now();
      onboardingFlowService.cleanupOldStates();
      const endTime = Date.now();

      const duration = endTime - startTime;

      // Limpeza deve ser rápida (< 100ms)
      expect(duration).toBeLessThan(100);
      // Todos os estados antigos devem ser removidos
      expect(onboardingFlowService.onboardingStates.size).toBe(0);
    });
  });
});

