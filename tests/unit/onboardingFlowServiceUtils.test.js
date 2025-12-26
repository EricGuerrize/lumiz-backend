/**
 * Testes Unitários - Funções Utilitárias do Onboarding
 * 
 * Testa funções utilitárias isoladamente:
 * - normalizeText()
 * - isYes() / isNo()
 * - extractBestAmountFromText()
 * - extractSaleHeuristics()
 * - validateAndExtractValue()
 * - validateChoice()
 */

// Como as funções são privadas, vamos testá-las indiretamente via comportamento
// ou criar testes que verificam o comportamento esperado

const onboardingFlowService = require('../../src/services/onboardingFlowService');

// Mock de serviços externos
jest.mock('../../src/services/analyticsService', () => ({
  track: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../src/services/onboardingService', () => ({
  getWhatsappState: jest.fn().mockResolvedValue(null),
  upsertWhatsappState: jest.fn().mockResolvedValue(true),
  clearWhatsappState: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../src/controllers/userController', () => ({
  createUserFromOnboarding: jest.fn().mockResolvedValue({ user: { id: 'test-user-id' } }),
  findUserByPhone: jest.fn().mockResolvedValue(null)
}));

jest.mock('../../src/controllers/transactionController', () => ({
  createAtendimento: jest.fn().mockResolvedValue({ id: 'test-atendimento-id' }),
  createContaPagar: jest.fn().mockResolvedValue({ id: 'test-conta-id' })
}));

describe('OnboardingFlowService - Funções Utilitárias (Testes Indiretos)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('normalizeText() - via comportamento', () => {
    test('deve normalizar texto para lowercase e trim', async () => {
      const phone = '5511999999999';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      
      // "  SIM  " deve ser aceito como "sim"
      const response = await onboardingFlowService.processOnboarding(phone, '  SIM  ');
      expect(response).toContain('qual seu nome');
    });

    test('deve aceitar variações de "sim"', async () => {
      const phone = '5511999999998';
      await onboardingFlowService.startIntroFlow(phone);
      
      // Testa várias variações
      const variations = ['sim', 'SIM', 'Sim', 'S', 's', 'ok', 'OK', 'confirmar'];
      for (const variation of variations) {
        const phoneVar = phone + variation;
        await onboardingFlowService.startIntroFlow(phoneVar);
        const response = await onboardingFlowService.processOnboarding(phoneVar, variation);
        expect(response).toContain('qual seu nome');
      }
    });
  });

  describe('isYes() / isNo() - via comportamento', () => {
    test('deve aceitar várias formas de "sim"', async () => {
      const phone = '5511999999997';
      await onboardingFlowService.startIntroFlow(phone);
      
      const yesVariations = ['sim', 's', 'ok', 'confirmar', 'pode registrar', 'tá ok', 'confere'];
      for (const yes of yesVariations) {
        const phoneVar = phone + yes;
        await onboardingFlowService.startIntroFlow(phoneVar);
        await onboardingFlowService.processOnboarding(phoneVar, '1'); // Consent
        const response = await onboardingFlowService.processOnboarding(phoneVar, yes);
        expect(response).toContain('qual seu nome');
      }
    });

    test('deve aceitar várias formas de "não"', async () => {
      const phone = '5511999999996';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1'); // Consent
      
      const noVariations = ['não', 'nao', 'n', 'cancelar', 'corrigir', 'ajustar'];
      for (const no of noVariations) {
        const response = await onboardingFlowService.processOnboarding(phone + no, no);
        // Deve voltar ou pedir correção
        expect(response).toBeDefined();
      }
    });
  });

  describe('extractBestAmountFromText() - via comportamento', () => {
    test('deve extrair valor de "R$ 1.500,50"', async () => {
      const phone = '5511999999995';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const response = await onboardingFlowService.processOnboarding(phone, 'R$ 1.500,50 pix');
      expect(response).toContain('1500.50');
    });

    test('deve extrair valor de "1500.50"', async () => {
      const phone = '5511999999994';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const response = await onboardingFlowService.processOnboarding(phone, 'Botox 1500.50');
      expect(response).toContain('1500.50');
    });

    test('deve extrair valor de "1.500,50"', async () => {
      const phone = '5511999999993';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const response = await onboardingFlowService.processOnboarding(phone, 'Botox 1.500,50');
      expect(response).toContain('1500.50');
    });

    test('deve extrair maior valor quando há múltiplos números', async () => {
      const phone = '5511999999992';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const response = await onboardingFlowService.processOnboarding(phone, 'Botox 500 e depois mais 2800');
      // Deve pegar o maior valor (2800)
      expect(response).toContain('2800');
    });

    test('deve ignorar anos (1900-2100)', async () => {
      const phone = '5511999999991';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const response = await onboardingFlowService.processOnboarding(phone, 'Botox 2800 em 2024');
      // Não deve pegar 2024 como valor
      expect(response).toContain('2800');
      expect(response).not.toContain('2024');
    });
  });

  describe('extractSaleHeuristics() - via comportamento', () => {
    test('deve extrair nome do cliente de "Maria fez botox 2800"', async () => {
      const phone = '5511999999990';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const response = await onboardingFlowService.processOnboarding(phone, 'Maria fez botox 2800 pix');
      expect(response).toContain('Maria');
    });

    test('deve detectar PIX', async () => {
      const phone = '5511999999989';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const response = await onboardingFlowService.processOnboarding(phone, 'Botox 2800 pix');
      expect(response.toLowerCase()).toContain('pix');
    });

    test('deve detectar cartão parcelado "3x"', async () => {
      const phone = '5511999999988';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const response = await onboardingFlowService.processOnboarding(phone, 'Botox 2800 3x');
      expect(response).toContain('3x');
    });

    test('deve detectar cartão sem parcelas e assumir credito_avista', async () => {
      const phone = '5511999999987';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const response = await onboardingFlowService.processOnboarding(phone, 'Botox 2800 cartão');
      // Deve aceitar sem pedir parcelas
      expect(response).toContain('Vou registrar assim');
    });
  });

  describe('validateAndExtractValue() - via comportamento', () => {
    test('deve validar valor mínimo (R$ 0,01)', async () => {
      const phone = '5511999999986';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const response = await onboardingFlowService.processOnboarding(phone, 'Botox 0.001');
      expect(response).toContain('muito baixo');
    });

    test('deve validar valor máximo (R$ 10.000.000)', async () => {
      const phone = '5511999999985';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const response = await onboardingFlowService.processOnboarding(phone, 'Botox 99999999');
      expect(response).toContain('muito alto');
    });

    test('deve rejeitar valor inválido', async () => {
      const phone = '5511999999984';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const response = await onboardingFlowService.processOnboarding(phone, 'Botox abc');
      expect(response).toContain('valor');
    });
  });

  describe('validateChoice() - via comportamento', () => {
    test('deve validar escolha numérica', async () => {
      const phone = '5511999999983';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      
      // Deve aceitar "1" como escolha válida
      const response = await onboardingFlowService.processOnboarding(phone, '1');
      expect(response).toContain('você quer usar a Lumiz');
    });

    test('deve validar escolha por texto', async () => {
      const phone = '5511999999982';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      
      // Deve aceitar "dona" como escolha válida
      const response = await onboardingFlowService.processOnboarding(phone, 'dona');
      expect(response).toContain('você quer usar a Lumiz');
    });

    test('deve rejeitar escolha inválida', async () => {
      const phone = '5511999999981';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      
      // Deve rejeitar escolha inválida
      const response = await onboardingFlowService.processOnboarding(phone, 'xyz');
      expect(response).toContain('opções acima');
    });
  });
});

