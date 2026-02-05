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

jest.mock('../../src/services/cacheService', () => ({
  delete: jest.fn().mockResolvedValue(true),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../src/controllers/userController', () => ({
  createUserFromOnboarding: jest.fn().mockResolvedValue({ user: { id: 'test-user-id' } }),
  findUserByPhone: jest.fn().mockResolvedValue(null)
}));

jest.mock('../../src/services/clinicMemberService', () => ({
  addMember: jest.fn().mockResolvedValue({ success: true })
}));

jest.mock('../../src/services/documentService', () => ({
  processImage: jest.fn().mockResolvedValue({ transacoes: [] })
}));

jest.mock('../../src/services/intentHeuristicService', () => ({
  detectIntent: jest.fn().mockResolvedValue(null)
}));

// Funções utilitárias não exportadas - testamos indiretamente via comportamento
// Mas podemos testar funções públicas e fluxos

describe('OnboardingFlowService - Funções Utilitárias', () => {
  describe('Validação de valores', () => {
    test('deve extrair valor de "Botox 2800"', async () => {
      const phone = '5511999999999';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1'); // Consent
      await onboardingFlowService.processOnboarding(phone, 'Maria Silva'); // Nome
      await onboardingFlowService.processOnboarding(phone, 'Clínica Teste'); // Clínica
      await onboardingFlowService.processOnboarding(phone, '1'); // Role
      await onboardingFlowService.processOnboarding(phone, '1'); // Context why
      await onboardingFlowService.processOnboarding(phone, '1'); // Context how

      const response = await onboardingFlowService.processOnboarding(phone, 'Botox 2800 pix');
      expect(response).toContain('2800');
      expect(response).toContain('Vou registrar assim');
    });

    test('deve extrair valor de "2000" mesmo parecendo ano', async () => {
      // Mock para simular o comportamento de extração (já que é testado indiretamente via fluxo acima)
      // Mas o ideal seria testar a função isolada se ela fosse exportada.
      // Como não é, vamos simular via fluxo mesmo.
      const phone = '5511999999977';
      await onboardingFlowService.startIntroFlow(phone);
      // Pula steps iniciais
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'T');
      await onboardingFlowService.processOnboarding(phone, 'C');
      await onboardingFlowService.processOnboarding(phone, '1'); // Context
      await onboardingFlowService.processOnboarding(phone, '1'); // Context
      await onboardingFlowService.processOnboarding(phone, '1'); // Context

      const response = await onboardingFlowService.processOnboarding(phone, 'Consultoria 2000');
      expect(response).toContain('2000');
    });

    test('deve extrair valor de "R$ 1.500,50"', async () => {
      const phone = '5511999999998';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'João Silva');
      await onboardingFlowService.processOnboarding(phone, 'Clínica Teste');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');

      const response = await onboardingFlowService.processOnboarding(phone, 'R$ 1.500,50 pix');
      expect(response).toContain('1500.50');
    });

    test('deve rejeitar valor muito alto (> R$ 10.000.000)', async () => {
      const phone = '5511999999997';
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

    test('deve rejeitar valor muito baixo (< R$ 0,01)', async () => {
      const phone = '5511999999996';
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
  });

  describe('Validação de nomes', () => {
    test('deve rejeitar nome muito curto', async () => {
      const phone = '5511999999995';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');

      const response = await onboardingFlowService.processOnboarding(phone, 'A');
      expect(response).toContain('muito curto');
    });

    test('deve rejeitar nome só com números', async () => {
      const phone = '5511999999994';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');

      const response = await onboardingFlowService.processOnboarding(phone, '123');
      expect(response).toContain('inválido');
    });

    test('deve rejeitar nome só com símbolos', async () => {
      const phone = '5511999999993';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');

      const response = await onboardingFlowService.processOnboarding(phone, '!!!');
      expect(response).toContain('inválido');
    });

    test('deve aceitar nome válido', async () => {
      const phone = '5511999999992';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');

      const response = await onboardingFlowService.processOnboarding(phone, 'Maria Silva');
      expect(response).toContain('nome da sua clínica');
    });
  });

  describe('Extração de informações de venda', () => {
    test('deve extrair nome do cliente de "Maria botox 2800"', async () => {
      const phone = '5511999999991';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');

      const response = await onboardingFlowService.processOnboarding(phone, 'Maria botox 2800 pix');
      expect(response).toContain('Maria');
    });

    test('deve detectar forma de pagamento PIX', async () => {
      const phone = '5511999999990';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');

      const response = await onboardingFlowService.processOnboarding(phone, 'Botox 2800 pix');
      expect(response).toContain('pix');
    });

    test('deve detectar parcelas de "Botox 2800 3x"', async () => {
      const phone = '5511999999989';
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
  });
});
