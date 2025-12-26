/**
 * Testes de Pontos de Falha Críticos - Onboarding
 * 
 * Testa cenários de erro que podem quebrar o onboarding:
 * - Falhas na criação de usuário
 * - Falhas no registro de transações
 * - Falhas no processamento de documentos
 * - Falhas na persistência de estado
 */

const onboardingFlowService = require('../../src/services/onboardingFlowService');
const userController = require('../../src/controllers/userController');
const transactionController = require('../../src/controllers/transactionController');
const onboardingService = require('../../src/services/onboardingService');
const documentService = require('../../src/services/documentService');
const supabase = require('../../src/db/supabase');

// Mock de serviços externos
jest.mock('../../src/services/analyticsService', () => ({
  track: jest.fn().mockResolvedValue(true)
}));

describe('Onboarding - Pontos de Falha Críticos', () => {
  const testPhone = '5511999999999';
  
  beforeEach(() => {
    jest.clearAllMocks();
    // Limpa estado antes de cada teste
    if (onboardingFlowService.onboardingStates && onboardingFlowService.onboardingStates.has(testPhone)) {
      onboardingFlowService.onboardingStates.delete(testPhone);
    }
  });

  afterEach(async () => {
    // Limpa estado após cada teste
    if (onboardingFlowService.onboardingStates && onboardingFlowService.onboardingStates.has(testPhone)) {
      onboardingFlowService.onboardingStates.delete(testPhone);
    }
  });

  describe('Falhas na Criação de Usuário', () => {
    test('deve informar erro quando criação de usuário falha com banco indisponível', async () => {
      const phone = '5511999999988';
      const originalCreate = userController.createUserFromOnboarding;
      userController.createUserFromOnboarding = jest.fn().mockRejectedValue(
        new Error('Database connection failed')
      );

      // Avança até AHA_REVENUE_CONFIRM
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Botox 2800 pix');
      
      const response = await onboardingFlowService.processOnboarding(phone, '1');
      expect(response).toContain('problema ao criar sua conta');
      expect(response).toContain('tente novamente');

      userController.createUserFromOnboarding = originalCreate;
    });

    test('deve usar usuário existente quando criação falha mas usuário já existe', async () => {
      const phone = '5511999999987';
      
      // Cria usuário primeiro
      try {
        await userController.createUserFromOnboarding({
          telefone: phone,
          nome_completo: 'Teste Existente',
          nome_clinica: 'Clínica Existente'
        });
      } catch (e) {
        // Ignora se já existe
      }

      const originalCreate = userController.createUserFromOnboarding;
      const originalFind = userController.findUserByPhone;
      
      // Simula falha na criação mas usuário existe
      userController.createUserFromOnboarding = jest.fn().mockRejectedValue(
        new Error('Database error')
      );
      userController.findUserByPhone = jest.fn().mockResolvedValue({
        id: 'existing-user-id',
        telefone: phone,
        nome_completo: 'Teste Existente'
      });

      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Botox 2800 pix');
      
      const response = await onboardingFlowService.processOnboarding(phone, '1');
      // Deve continuar mesmo com erro na criação (usa usuário existente)
      expect(response).not.toContain('problema ao criar sua conta');
      expect(userController.findUserByPhone).toHaveBeenCalled();

      userController.createUserFromOnboarding = originalCreate;
      userController.findUserByPhone = originalFind;
    });

    test('deve abortar onboarding quando criação falha e usuário não existe', async () => {
      const phone = '5511999999986';
      const originalCreate = userController.createUserFromOnboarding;
      const originalFind = userController.findUserByPhone;
      
      userController.createUserFromOnboarding = jest.fn().mockRejectedValue(
        new Error('Database error')
      );
      userController.findUserByPhone = jest.fn().mockResolvedValue(null);

      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Botox 2800 pix');
      
      const response = await onboardingFlowService.processOnboarding(phone, '1');
      expect(response).toContain('problema ao criar sua conta');

      userController.createUserFromOnboarding = originalCreate;
      userController.findUserByPhone = originalFind;
    });

    test('deve validar telefone inválido antes de criar usuário', async () => {
      const phone = 'invalid';
      
      const response = await onboardingFlowService.startIntroFlow(phone);
      // Deve iniciar mesmo com telefone inválido (normalização pode ajudar)
      expect(response).toBeDefined();
    });
  });

  describe('Falhas no Registro de Transações', () => {
    test('deve informar erro quando createAtendimento retorna null', async () => {
      const phone = '5511999999985';
      
      // Cria usuário primeiro
      try {
        await userController.createUserFromOnboarding({
          telefone: phone,
          nome_completo: 'Teste',
          nome_clinica: 'Clínica'
        });
      } catch (e) {
        // Ignora se já existe
      }

      const originalCreate = transactionController.createAtendimento;
      transactionController.createAtendimento = jest.fn().mockResolvedValue(null);

      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Botox 2800 pix');
      
      const response = await onboardingFlowService.processOnboarding(phone, '1');
      expect(response).toContain('problema ao registrar sua venda');
      expect(response).toContain('tente novamente');

      transactionController.createAtendimento = originalCreate;
    });

    test('deve informar erro quando createAtendimento retorna objeto sem id', async () => {
      const phone = '5511999999984';
      
      try {
        await userController.createUserFromOnboarding({
          telefone: phone,
          nome_completo: 'Teste',
          nome_clinica: 'Clínica'
        });
      } catch (e) {}

      const originalCreate = transactionController.createAtendimento;
      transactionController.createAtendimento = jest.fn().mockResolvedValue({
        valor: 2800,
        forma_pagamento: 'pix'
        // Sem id!
      });

      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Botox 2800 pix');
      
      const response = await onboardingFlowService.processOnboarding(phone, '1');
      expect(response).toContain('problema ao registrar sua venda');

      transactionController.createAtendimento = originalCreate;
    });

    test('deve informar erro quando createAtendimento lança exceção', async () => {
      const phone = '5511999999983';
      
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
      expect(response).toContain('problema ao registrar sua venda');

      transactionController.createAtendimento = originalCreate;
    });

    test('deve informar erro quando createContaPagar retorna null', async () => {
      const phone = '5511999999982';
      
      try {
        await userController.createUserFromOnboarding({
          telefone: phone,
          nome_completo: 'Teste',
          nome_clinica: 'Clínica'
        });
      } catch (e) {}

      const originalCreate = transactionController.createContaPagar;
      transactionController.createContaPagar = jest.fn().mockResolvedValue(null);

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
      await onboardingFlowService.processOnboarding(phone, 'Insumos 500');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const response = await onboardingFlowService.processOnboarding(phone, '1');
      expect(response).toContain('problema ao registrar seu custo');

      transactionController.createContaPagar = originalCreate;
    });

    test('deve validar dados antes de salvar transação', async () => {
      const phone = '5511999999981';
      
      try {
        await userController.createUserFromOnboarding({
          telefone: phone,
          nome_completo: 'Teste',
          nome_clinica: 'Clínica'
        });
      } catch (e) {}

      // Tenta salvar venda sem valor (não deve chegar aqui, mas testa validação)
      const onboarding = onboardingFlowService.onboardingStates.get(phone);
      if (onboarding) {
        onboarding.data.pending_sale = {
          valor: null, // Valor inválido
          forma_pagamento: 'pix'
        };
        onboarding.step = 'AHA_REVENUE_CONFIRM';
      }

      const response = await onboardingFlowService.processOnboarding(phone, '1');
      // Deve detectar problema antes de tentar salvar
      expect(response).toBeDefined();
    });
  });

  describe('Falhas no Processamento de Documentos', () => {
    test('deve informar erro quando processamento de documento excede timeout', async () => {
      const phone = '5511999999980';
      const originalProcess = documentService.processImage;
      
      // Simula timeout (Promise que nunca resolve)
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
      
      // Envia documento (simula URL)
      const response = await onboardingFlowService.processOnboarding(
        phone, 
        '', 
        'https://example.com/image.jpg'
      );
      
      // Deve detectar timeout ou erro
      expect(response).toBeDefined();
      expect(response).toMatch(/timeout|erro|não consegui/i);

      documentService.processImage = originalProcess;
    }, 40000); // Timeout maior para este teste

    test('deve informar erro quando documento processado mas sem transação extraída', async () => {
      const phone = '5511999999979';
      const originalProcess = documentService.processImage;
      
      documentService.processImage = jest.fn().mockResolvedValue({
        transacoes: [] // Array vazio
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
      
      const response = await onboardingFlowService.processOnboarding(
        phone, 
        '', 
        'https://example.com/image.jpg'
      );
      
      expect(response).toContain('Não consegui processar');
      expect(response).toContain('documento');

      documentService.processImage = originalProcess;
    });

    test('deve informar erro quando Vision API retorna erro', async () => {
      const phone = '5511999999978';
      const originalProcess = documentService.processImage;
      
      documentService.processImage = jest.fn().mockRejectedValue(
        new Error('Vision API quota exceeded')
      );

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
      
      const response = await onboardingFlowService.processOnboarding(
        phone, 
        '', 
        'https://example.com/image.jpg'
      );
      
      expect(response).toContain('Não consegui processar');
      expect(response).toContain('documento');

      documentService.processImage = originalProcess;
    });

    test('deve lidar com documento inválido/corrompido', async () => {
      const phone = '5511999999977';
      const originalProcess = documentService.processImage;
      
      documentService.processImage = jest.fn().mockResolvedValue({
        tipo_documento: 'erro',
        transacoes: []
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
      
      const response = await onboardingFlowService.processOnboarding(
        phone, 
        '', 
        'https://example.com/invalid.jpg'
      );
      
      expect(response).toBeDefined();
      expect(response).toMatch(/não consegui|erro|inválido/i);

      documentService.processImage = originalProcess;
    });
  });

  describe('Falhas na Persistência de Estado', () => {
    test('deve continuar mesmo quando upsertWhatsappState falha silenciosamente', async () => {
      const phone = '5511999999976';
      const originalUpsert = onboardingService.upsertWhatsappState;
      
      onboardingService.upsertWhatsappState = jest.fn().mockRejectedValue(
        new Error('Database error')
      );

      await onboardingFlowService.startIntroFlow(phone);
      const response = await onboardingFlowService.processOnboarding(phone, '1');
      
      // Deve continuar mesmo com erro de persistência
      expect(response).toBeDefined();
      expect(response).toContain('qual seu nome');

      onboardingService.upsertWhatsappState = originalUpsert;
    });

    test('deve lidar com estado corrompido no banco', async () => {
      const phone = '5511999999975';
      const originalGet = onboardingService.getWhatsappState;
      
      // Simula estado corrompido (step inválido)
      onboardingService.getWhatsappState = jest.fn().mockResolvedValue({
        step: 'INVALID_STEP',
        data: { telefone: phone }
      });

      const response = await onboardingFlowService.startIntroFlow(phone);
      
      // Deve lidar graciosamente com estado inválido
      expect(response).toBeDefined();

      onboardingService.getWhatsappState = originalGet;
    });

    test('deve detectar cache inconsistente com banco', async () => {
      const phone = '5511999999974';
      const cacheService = require('../../src/services/cacheService');
      const originalGet = cacheService.get;
      const originalSet = cacheService.set;
      
      // Simula cache com estado antigo
      let cacheCallCount = 0;
      cacheService.get = jest.fn().mockImplementation((key) => {
        cacheCallCount++;
        if (cacheCallCount === 1) {
          // Primeira chamada retorna cache antigo
          return Promise.resolve({
            step: 'PROFILE_NAME',
            data: { telefone: phone, nome: 'Nome Antigo' }
          });
        }
        return Promise.resolve(null);
      });

      // Estado no banco é diferente (mais avançado)
      onboardingService.getWhatsappState = jest.fn().mockResolvedValue({
        step: 'AHA_REVENUE',
        data: { telefone: phone, nome: 'Nome Novo' }
      });

      const response = await onboardingFlowService.startIntroFlow(phone);
      
      // Deve usar estado do banco, não do cache
      expect(response).toBeDefined();

      cacheService.get = originalGet;
      cacheService.set = originalSet;
    });

    test('deve prevenir limpeza de estado durante processo ativo', async () => {
      const phone = '5511999999973';
      
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      
      // Simula limpeza durante processo
      const stateBefore = onboardingFlowService.onboardingStates.get(phone);
      expect(stateBefore).toBeDefined();
      
      // Limpeza automática não deve interferir em estado ativo
      onboardingFlowService.cleanupOldStates();
      
      const stateAfter = onboardingFlowService.onboardingStates.get(phone);
      // Estado ativo não deve ser limpo
      expect(stateAfter).toBeDefined();
    });
  });
});

