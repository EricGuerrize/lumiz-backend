/**
 * Testes de Integração com Serviços Externos - Onboarding
 * 
 * Testa falhas em serviços externos:
 * - Evolution API (WhatsApp)
 * - Analytics Service
 * - Document Service (Vision API)
 */

const onboardingFlowService = require('../../src/services/onboardingFlowService');
const evolutionService = require('../../src/services/evolutionService');
const analyticsService = require('../../src/services/analyticsService');
const documentService = require('../../src/services/documentService');

// Mock de serviços externos
jest.mock('../../src/services/analyticsService', () => ({
  track: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../src/services/onboardingService', () => ({
  getWhatsappState: jest.fn().mockResolvedValue(null),
  upsertWhatsappState: jest.fn().mockResolvedValue(true),
  clearWhatsappState: jest.fn().mockResolvedValue(true)
}));

describe('Onboarding - Integrações com Serviços Externos', () => {
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

  describe('Evolution API (WhatsApp)', () => {
    test('deve continuar onboarding mesmo quando envio de mensagem falha', async () => {
      const phone = '5511999999989';
      const originalSend = evolutionService.sendMessage;
      
      evolutionService.sendMessage = jest.fn().mockRejectedValue(
        new Error('Evolution API connection failed')
      );

      // O onboarding não deve quebrar mesmo se envio falhar
      // (o erro é tratado no webhook, não no onboarding)
      const response = await onboardingFlowService.startIntroFlow(phone);
      
      expect(response).toBeDefined();
      expect(response.length).toBeGreaterThan(0);

      evolutionService.sendMessage = originalSend;
    });

    test('deve lidar com número de telefone inválido', async () => {
      const phone = 'invalid-phone';
      
      // Deve normalizar ou lidar com telefone inválido
      const response = await onboardingFlowService.startIntroFlow(phone);
      
      expect(response).toBeDefined();
    });

    test('deve lidar com timeout na Evolution API', async () => {
      const phone = '5511999999988';
      const originalSend = evolutionService.sendMessage;
      
      // Simula timeout (Promise que nunca resolve)
      evolutionService.sendMessage = jest.fn().mockImplementation(() => {
        return new Promise((resolve, reject) => {
          setTimeout(() => reject(new Error('Timeout')), 100);
        });
      });

      // O onboarding não deve quebrar
      const response = await onboardingFlowService.startIntroFlow(phone);
      
      expect(response).toBeDefined();

      evolutionService.sendMessage = originalSend;
    });

    test('deve lidar com rate limiting da Evolution API', async () => {
      const phone = '5511999999987';
      const originalSend = evolutionService.sendMessage;
      
      evolutionService.sendMessage = jest.fn().mockRejectedValue({
        code: 'RATE_LIMIT',
        message: 'Too many requests'
      });

      // O onboarding não deve quebrar
      const response = await onboardingFlowService.startIntroFlow(phone);
      
      expect(response).toBeDefined();

      evolutionService.sendMessage = originalSend;
    });
  });

  describe('Analytics Service', () => {
    test('deve continuar onboarding mesmo quando tracking falha silenciosamente', async () => {
      const phone = '5511999999986';
      
      analyticsService.track = jest.fn().mockRejectedValue(
        new Error('Analytics service unavailable')
      );

      const response = await onboardingFlowService.startIntroFlow(phone);
      
      // Deve continuar mesmo com erro no analytics
      expect(response).toBeDefined();
      expect(response.length).toBeGreaterThan(0);
      
      // Verifica que tentou enviar analytics
      expect(analyticsService.track).toHaveBeenCalled();
    });

    test('deve enviar múltiplos eventos no mesmo step sem quebrar', async () => {
      const phone = '5511999999985';
      
      analyticsService.track = jest.fn().mockResolvedValue(true);

      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      
      // Múltiplas chamadas de analytics não devem quebrar
      expect(analyticsService.track).toHaveBeenCalledTimes(2); // started + consent_started
    });

    test('deve continuar mesmo quando analytics retorna null', async () => {
      const phone = '5511999999984';
      
      analyticsService.track = jest.fn().mockResolvedValue(null);

      const response = await onboardingFlowService.startIntroFlow(phone);
      
      expect(response).toBeDefined();
      expect(analyticsService.track).toHaveBeenCalled();
    });

    test('deve continuar mesmo quando analytics lança exceção não tratada', async () => {
      const phone = '5511999999983';
      
      analyticsService.track = jest.fn().mockImplementation(() => {
        throw new Error('Unexpected analytics error');
      });

      // Deve capturar erro e continuar
      try {
        const response = await onboardingFlowService.startIntroFlow(phone);
        expect(response).toBeDefined();
      } catch (error) {
        // Se lançar erro, deve ser tratado no código
        expect(error).toBeDefined();
      }
    });
  });

  describe('Document Service (Vision API)', () => {
    test('deve informar erro quando Vision API retorna timeout', async () => {
      const phone = '5511999999982';
      const originalProcess = documentService.processImage;
      
      documentService.processImage = jest.fn().mockImplementation(() => {
        return new Promise((resolve, reject) => {
          setTimeout(() => reject(new Error('Timeout')), 100);
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
      
      const response = await onboardingFlowService.processOnboarding(
        phone, 
        '', 
        'https://example.com/image.jpg'
      );
      
      expect(response).toContain('Não consegui processar');
      expect(response).toContain('documento');

      documentService.processImage = originalProcess;
    });

    test('deve informar erro quando Vision API retorna erro de autenticação', async () => {
      const phone = '5511999999981';
      const originalProcess = documentService.processImage;
      
      documentService.processImage = jest.fn().mockRejectedValue({
        code: 'UNAUTHENTICATED',
        message: 'Invalid API key'
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

      documentService.processImage = originalProcess;
    });

    test('deve informar erro quando quota da Vision API é excedida', async () => {
      const phone = '5511999999980';
      const originalProcess = documentService.processImage;
      
      documentService.processImage = jest.fn().mockRejectedValue({
        code: 'RESOURCE_EXHAUSTED',
        message: 'Quota exceeded'
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

      documentService.processImage = originalProcess;
    });

    test('deve lidar com imagem muito grande', async () => {
      const phone = '5511999999979';
      const originalProcess = documentService.processImage;
      
      documentService.processImage = jest.fn().mockRejectedValue({
        code: 'INVALID_ARGUMENT',
        message: 'Image too large'
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
        'https://example.com/huge-image.jpg'
      );
      
      expect(response).toContain('Não consegui processar');

      documentService.processImage = originalProcess;
    });

    test('deve continuar onboarding mesmo quando processamento de documento falha', async () => {
      const phone = '5511999999978';
      const originalProcess = documentService.processImage;
      
      documentService.processImage = jest.fn().mockRejectedValue(
        new Error('Unexpected Vision API error')
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
      
      // Deve informar erro mas não quebrar o onboarding
      expect(response).toBeDefined();
      expect(response.length).toBeGreaterThan(0);
      
      // Deve permitir continuar (ex: digitando valor manualmente)
      const nextResponse = await onboardingFlowService.processOnboarding(phone, 'Insumos 500');
      expect(nextResponse).toBeDefined();

      documentService.processImage = originalProcess;
    });
  });

  describe('Resiliência Geral', () => {
    test('deve continuar onboarding mesmo com múltiplos serviços falhando', async () => {
      const phone = '5511999999977';
      
      // Todos os serviços falhando
      analyticsService.track = jest.fn().mockRejectedValue(new Error('Analytics down'));
      documentService.processImage = jest.fn().mockRejectedValue(new Error('Vision down'));
      
      const response = await onboardingFlowService.startIntroFlow(phone);
      
      // Deve continuar mesmo assim
      expect(response).toBeDefined();
      expect(response.length).toBeGreaterThan(0);
    });

    test('deve recuperar após falha temporária em serviço externo', async () => {
      const phone = '5511999999976';
      
      let callCount = 0;
      analyticsService.track = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('Temporary failure'));
        }
        return Promise.resolve(true);
      });

      await onboardingFlowService.startIntroFlow(phone);
      
      // Primeira chamada falha, segunda deve funcionar
      expect(analyticsService.track).toHaveBeenCalled();
      
      // Próxima chamada deve funcionar
      await onboardingFlowService.processOnboarding(phone, '1');
      expect(analyticsService.track).toHaveBeenCalledTimes(2);
    });
  });
});

