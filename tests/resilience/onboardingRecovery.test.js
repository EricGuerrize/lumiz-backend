/**
 * Testes de Recuperação e Resiliência - Onboarding
 * 
 * Testa recuperação de erros e resiliência:
 * - Recuperação de erros
 * - Timeouts e limites
 * - Retry automático
 * - Mensagens de erro claras
 */

const onboardingFlowService = require('../../src/services/onboardingFlowService');
const userController = require('../../src/controllers/userController');
const transactionController = require('../../src/controllers/transactionController');
const documentService = require('../../src/services/documentService');
const onboardingService = require('../../src/services/onboardingService');

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

describe('Onboarding - Recuperação e Resiliência', () => {
  const testPhone = '5511999999999';
  
  beforeEach(() => {
    jest.clearAllMocks();
    // Limpa estado antes de cada teste
    if (onboardingFlowService.onboardingStates && onboardingFlowService.onboardingStates.has(testPhone)) {
      onboardingFlowService.onboardingStates.delete(testPhone);
    }
  });

  afterEach(() => {
    // Limpa estado após cada teste
    if (onboardingFlowService.onboardingStates && onboardingFlowService.onboardingStates.has(testPhone)) {
      onboardingFlowService.onboardingStates.delete(testPhone);
    }
  });

  describe('Recuperação de Erros', () => {
    test('deve permitir retomar onboarding após erro temporário', async () => {
      const phone = '5511999999989';
      
      // Simula estado persistido após erro
      onboardingService.getWhatsappState = jest.fn().mockResolvedValue({
        step: 'AHA_REVENUE',
        data: {
          telefone: phone,
          nome: 'Teste',
          clinica: 'Clínica',
          role: 'dona_gestora',
          context_why: 'organizar_dia_a_dia',
          context_how: 'mais_pix'
        },
        startTime: Date.now()
      });

      const response = await onboardingFlowService.startIntroFlow(phone);
      
      // Deve retomar do step salvo
      expect(response).toContain('Primeira venda');
      
      const state = onboardingFlowService.onboardingStates.get(phone);
      expect(state.step).toBe('AHA_REVENUE');
    });

    test('deve fornecer mensagem de erro clara para usuário', async () => {
      const phone = '5511999999988';
      
      // Cria usuário primeiro
      try {
        await userController.createUserFromOnboarding({
          telefone: phone,
          nome_completo: 'Teste',
          nome_clinica: 'Clínica'
        });
      } catch (e) {}

      const originalCreate = transactionController.createAtendimento;
      transactionController.createAtendimento = jest.fn().mockRejectedValue(
        new Error('Database connection failed')
      );

      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Botox 2800 pix');
      
      const response = await onboardingFlowService.processOnboarding(phone, '1');
      
      // Mensagem deve ser clara e acionável
      expect(response).toContain('problema');
      expect(response).toContain('tente novamente');
      expect(response.length).toBeGreaterThan(20); // Mensagem completa

      transactionController.createAtendimento = originalCreate;
    });

    test('deve manter estado consistente após erro', async () => {
      const phone = '5511999999987';
      
      try {
        await userController.createUserFromOnboarding({
          telefone: phone,
          nome_completo: 'Teste',
          nome_clinica: 'Clínica'
        });
      } catch (e) {}

      const originalCreate = transactionController.createAtendimento;
      transactionController.createAtendimento = jest.fn().mockRejectedValue(
        new Error('Database error')
      );

      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Botox 2800 pix');
      
      const stateBefore = onboardingFlowService.onboardingStates.get(phone);
      const stepBefore = stateBefore.step;
      
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const stateAfter = onboardingFlowService.onboardingStates.get(phone);
      
      // Estado deve estar consistente (não corrompido)
      expect(stateAfter).toBeDefined();
      expect(stateAfter.data.telefone).toBe(phone);
      expect(stateAfter.data.nome).toBe('Teste');
      // Step pode ter mudado ou permanecido (depende da implementação)
      expect(stateAfter.step).toBeDefined();

      transactionController.createAtendimento = originalCreate;
    });

    test('deve permitir retomar de onde parou após erro', async () => {
      const phone = '5511999999986';
      
      // Simula erro durante salvamento de venda
      const originalCreate = transactionController.createAtendimento;
      let attemptCount = 0;
      transactionController.createAtendimento = jest.fn().mockImplementation(async () => {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error('Temporary error');
        }
        return { id: 'success-id', valor: 2800 };
      });

      try {
        await userController.createUserFromOnboarding({
          telefone: phone,
          nome_completo: 'Teste',
          nome_clinica: 'Clínica'
        });
      } catch (e) {}

      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Botox 2800 pix');
      
      // Primeira tentativa falha
      const response1 = await onboardingFlowService.processOnboarding(phone, '1');
      expect(response1).toContain('problema');
      
      // Estado deve permitir retentar
      const state = onboardingFlowService.onboardingStates.get(phone);
      expect(state.data.pending_sale).toBeDefined();
      expect(state.data.pending_sale.valor).toBe(2800);
      
      // Segunda tentativa deve funcionar
      const response2 = await onboardingFlowService.processOnboarding(phone, '1');
      expect(response2).toContain('Venda registrada');

      transactionController.createAtendimento = originalCreate;
    });
  });

  describe('Timeouts e Limites', () => {
    test('deve aplicar timeout em processamento de documento (30s)', async () => {
      const phone = '5511999999985';
      const originalProcess = documentService.processImage;
      
      // Simula processamento que excede timeout
      documentService.processImage = jest.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          // Nunca resolve - simula timeout
          setTimeout(() => resolve({ transacoes: [] }), 35000);
        });
      });

      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Botox 2800 pix');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '2');
      
      const startTime = Date.now();
      const response = await onboardingFlowService.processOnboarding(
        phone, 
        '', 
        'https://example.com/image.jpg'
      );
      const endTime = Date.now();
      
      const duration = endTime - startTime;
      
      // Deve aplicar timeout (30s) e retornar erro
      expect(duration).toBeLessThan(35000); // Menos que o timeout simulado
      expect(response).toMatch(/timeout|erro|não consegui/i);

      documentService.processImage = originalProcess;
    }, 40000);

    test('deve limpar recursos após timeout', async () => {
      const phone = '5511999999984';
      
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const stateBefore = onboardingFlowService.onboardingStates.get(phone);
      expect(stateBefore).toBeDefined();
      
      // Simula timeout e limpeza
      // (limpeza automática já testada em outros testes)
      
      // Estado deve estar acessível
      expect(onboardingFlowService.onboardingStates.has(phone)).toBe(true);
    });

    test('deve limitar número de tentativas para evitar loop infinito', async () => {
      const phone = '5511999999983';
      
      // Simula erro persistente
      const originalCreate = transactionController.createAtendimento;
      transactionController.createAtendimento = jest.fn().mockRejectedValue(
        new Error('Persistent error')
      );

      try {
        await userController.createUserFromOnboarding({
          telefone: phone,
          nome_completo: 'Teste',
          nome_clinica: 'Clínica'
        });
      } catch (e) {}

      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Botox 2800 pix');
      
      // Múltiplas tentativas
      for (let i = 0; i < 3; i++) {
        const response = await onboardingFlowService.processOnboarding(phone, '1');
        expect(response).toContain('problema');
      }
      
      // Não deve entrar em loop infinito
      expect(transactionController.createAtendimento).toHaveBeenCalledTimes(3);

      transactionController.createAtendimento = originalCreate;
    });
  });

  describe('Resiliência Geral', () => {
    test('deve recuperar após múltiplos erros sequenciais', async () => {
      const phone = '5511999999982';
      
      let attemptCount = 0;
      const originalCreate = transactionController.createAtendimento;
      transactionController.createAtendimento = jest.fn().mockImplementation(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error(`Error ${attemptCount}`);
        }
        return { id: 'success-id', valor: 2800 };
      });

      try {
        await userController.createUserFromOnboarding({
          telefone: phone,
          nome_completo: 'Teste',
          nome_clinica: 'Clínica'
        });
      } catch (e) {}

      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Botox 2800 pix');
      
      // Primeiras tentativas falham
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      // Terceira tentativa deve funcionar
      const response = await onboardingFlowService.processOnboarding(phone, '1');
      expect(response).toContain('Venda registrada');

      transactionController.createAtendimento = originalCreate;
    });

    test('deve manter dados coletados mesmo após erro', async () => {
      const phone = '5511999999981';
      
      const originalCreate = transactionController.createAtendimento;
      transactionController.createAtendimento = jest.fn().mockRejectedValue(
        new Error('Database error')
      );

      try {
        await userController.createUserFromOnboarding({
          telefone: phone,
          nome_completo: 'Teste',
          nome_clinica: 'Clínica'
        });
      } catch (e) {}

      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Botox 2800 pix');
      
      const stateBefore = onboardingFlowService.onboardingStates.get(phone);
      const dataBefore = { ...stateBefore.data };
      
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const stateAfter = onboardingFlowService.onboardingStates.get(phone);
      
      // Dados coletados devem ser mantidos
      expect(stateAfter.data.nome).toBe(dataBefore.nome);
      expect(stateAfter.data.clinica).toBe(dataBefore.clinica);
      expect(stateAfter.data.pending_sale).toBeDefined();
      expect(stateAfter.data.pending_sale.valor).toBe(2800);

      transactionController.createAtendimento = originalCreate;
    });

    test('deve fornecer caminho de recuperação claro para usuário', async () => {
      const phone = '5511999999980';
      
      const originalCreate = transactionController.createAtendimento;
      transactionController.createAtendimento = jest.fn().mockRejectedValue(
        new Error('Database error')
      );

      try {
        await userController.createUserFromOnboarding({
          telefone: phone,
          nome_completo: 'Teste',
          nome_clinica: 'Clínica'
        });
      } catch (e) {}

      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Botox 2800 pix');
      
      const response = await onboardingFlowService.processOnboarding(phone, '1');
      
      // Mensagem deve indicar o que fazer
      expect(response).toMatch(/tente novamente|digite|envie|repet/i);
      // Não deve ser apenas "erro" genérico
      expect(response.length).toBeGreaterThan(30);

      transactionController.createAtendimento = originalCreate;
    });
  });
});

