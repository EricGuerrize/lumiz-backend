/**
 * Testes de Integração - Fluxo Completo do Onboarding
 * 
 * Testa o fluxo completo do onboarding, incluindo:
 * - Criação de usuário
 * - Registro de venda
 * - Registro de custo
 * - Cálculo de resumo
 * - Tratamento de erros
 */

const onboardingFlowService = require('../../src/services/onboardingFlowService');
const userController = require('../../src/controllers/userController');
const transactionController = require('../../src/controllers/transactionController');

// Mock de serviços externos para testes
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
      data: '2025-12-22'
    }]
  })
}));

describe('OnboardingFlowService - Fluxo Completo', () => {
  const testPhone = '5511999999999';
  
  beforeEach(() => {
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

  describe('Fluxo Happy Path', () => {
    test('deve completar onboarding completo com sucesso', async () => {
      // 1. Inicia onboarding
      let response = await onboardingFlowService.startIntroFlow(testPhone);
      expect(response).toContain('Oi! Eu sou a Lumiz');

      // 2. Responde consentimento
      response = await onboardingFlowService.processOnboarding(testPhone, '1');
      expect(response).toContain('qual seu nome');

      // 3. Informa nome
      response = await onboardingFlowService.processOnboarding(testPhone, 'Maria Silva');
      expect(response).toContain('nome da sua clínica');

      // 4. Informa clínica
      response = await onboardingFlowService.processOnboarding(testPhone, 'Clínica Estética');
      expect(response).toContain('Você é a dona/gestora');

      // 5. Informa role
      response = await onboardingFlowService.processOnboarding(testPhone, '1');
      expect(response).toContain('você quer usar a Lumiz');

      // 6. Informa contexto why
      response = await onboardingFlowService.processOnboarding(testPhone, '1');
      expect(response).toContain('sua clínica recebe mais por');

      // 7. Informa contexto how
      response = await onboardingFlowService.processOnboarding(testPhone, '1');
      expect(response).toContain('Primeira venda');

      // 8. Registra venda
      response = await onboardingFlowService.processOnboarding(testPhone, 'Botox 2800 pix');
      expect(response).toContain('Vou registrar assim');

      // 9. Confirma venda
      response = await onboardingFlowService.processOnboarding(testPhone, '1');
      expect(response).toContain('Venda registrada');

      // 10. Informa tipo de custo
      response = await onboardingFlowService.processOnboarding(testPhone, '2');
      expect(response).toContain('variável');

      // 11. Registra custo
      response = await onboardingFlowService.processOnboarding(testPhone, 'Insumos 500');
      expect(response).toContain('Pra eu organizar certinho');

      // 12. Informa categoria
      response = await onboardingFlowService.processOnboarding(testPhone, '1');
      expect(response).toContain('Registrando');

      // 13. Confirma custo
      response = await onboardingFlowService.processOnboarding(testPhone, '1');
      expect(response).toContain('Resumo parcial do mês');

      // 14. Vê resumo e completa
      response = await onboardingFlowService.processOnboarding(testPhone, '');
      expect(response).toContain('Agora é só me usar no dia a dia');
    });
  });

  describe('Validações de Entrada', () => {
    test('deve rejeitar nome muito curto', async () => {
      await onboardingFlowService.startIntroFlow(testPhone);
      await onboardingFlowService.processOnboarding(testPhone, '1');
      const response = await onboardingFlowService.processOnboarding(testPhone, 'A');
      expect(response).toContain('muito curto');
    });

    test('deve rejeitar nome só com números', async () => {
      await onboardingFlowService.startIntroFlow(testPhone);
      await onboardingFlowService.processOnboarding(testPhone, '1');
      const response = await onboardingFlowService.processOnboarding(testPhone, '123');
      expect(response).toContain('inválido');
    });

    test('deve rejeitar nome só com símbolos', async () => {
      await onboardingFlowService.startIntroFlow(testPhone);
      await onboardingFlowService.processOnboarding(testPhone, '1');
      const response = await onboardingFlowService.processOnboarding(testPhone, '!!!');
      expect(response).toContain('inválido');
    });

    test('deve rejeitar valor muito alto', async () => {
      await onboardingFlowService.startIntroFlow(testPhone);
      await onboardingFlowService.processOnboarding(testPhone, '1');
      await onboardingFlowService.processOnboarding(testPhone, 'Teste');
      await onboardingFlowService.processOnboarding(testPhone, 'Clínica');
      await onboardingFlowService.processOnboarding(testPhone, '1');
      await onboardingFlowService.processOnboarding(testPhone, '1');
      await onboardingFlowService.processOnboarding(testPhone, '1');
      
      const response = await onboardingFlowService.processOnboarding(testPhone, 'Botox 99999999');
      expect(response).toContain('muito alto');
    });

    test('deve rejeitar valor muito baixo', async () => {
      await onboardingFlowService.startIntroFlow(testPhone);
      await onboardingFlowService.processOnboarding(testPhone, '1');
      await onboardingFlowService.processOnboarding(testPhone, 'Teste');
      await onboardingFlowService.processOnboarding(testPhone, 'Clínica');
      await onboardingFlowService.processOnboarding(testPhone, '1');
      await onboardingFlowService.processOnboarding(testPhone, '1');
      await onboardingFlowService.processOnboarding(testPhone, '1');
      
      const response = await onboardingFlowService.processOnboarding(testPhone, 'Botox 0.001');
      expect(response).toContain('muito baixo');
    });
  });

  describe('Tratamento de Erros', () => {
    test('deve informar usuário se criação de usuário falhar', async () => {
      const phone = '5511999999988';
      const originalCreate = userController.createUserFromOnboarding;
      userController.createUserFromOnboarding = jest.fn().mockRejectedValue(new Error('Database error'));

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

      userController.createUserFromOnboarding = originalCreate;
    });

    test('deve informar usuário se registro de venda falhar', async () => {
      const phone = '5511999999987';
      const originalCreate = transactionController.createAtendimento;
      transactionController.createAtendimento = jest.fn().mockRejectedValue(new Error('Database error'));

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
      expect(response).toContain('problema ao registrar sua venda');

      transactionController.createAtendimento = originalCreate;
    });

    test('deve informar usuário se registro de custo falhar', async () => {
      const phone = '5511999999986';
      const originalCreate = transactionController.createContaPagar;
      transactionController.createContaPagar = jest.fn().mockRejectedValue(new Error('Database error'));

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

      // Avança até AHA_COSTS_CONFIRM
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Botox 2800 pix');
      await onboardingFlowService.processOnboarding(phone, '1'); // Confirma venda
      await onboardingFlowService.processOnboarding(phone, '2'); // Custo variável
      await onboardingFlowService.processOnboarding(phone, 'Insumos 500');
      await onboardingFlowService.processOnboarding(phone, '1'); // Categoria
      
      const response = await onboardingFlowService.processOnboarding(phone, '1');
      expect(response).toContain('problema ao registrar seu custo');

      transactionController.createContaPagar = originalCreate;
    });

    test('deve informar usuário se processamento de documento falhar', async () => {
      const phone = '5511999999985';
      const documentService = require('../../src/services/documentService');
      const originalProcess = documentService.processImage;
      documentService.processImage = jest.fn().mockRejectedValue(new Error('Vision API error'));

      // Avança até AHA_COSTS_UPLOAD
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Botox 2800 pix');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '2'); // Custo variável
      
      const response = await onboardingFlowService.processOnboarding(phone, '', 'https://example.com/image.jpg');
      expect(response).toContain('Não consegui processar esse documento');

      documentService.processImage = originalProcess;
    });
  });

  describe('Edge Cases', () => {
    test('deve lidar com "Botox 2800" sem forma de pagamento (assume avista)', async () => {
      const phone = '5511999999984';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const response = await onboardingFlowService.processOnboarding(phone, 'Botox 2800');
      // Deve aceitar e assumir 'avista'
      expect(response).toContain('Vou registrar assim');
    });

    test('deve lidar com "Botox 2800 cartão" sem parcelas (assume credito_avista)', async () => {
      const phone = '5511999999983';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const response = await onboardingFlowService.processOnboarding(phone, 'Botox 2800 cartão');
      // Deve aceitar e assumir 'credito_avista'
      expect(response).toContain('Vou registrar assim');
    });

    test('deve lidar com "Botox 2800 3x" sem mencionar cartão (detecta parcelado)', async () => {
      const phone = '5511999999982';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const response = await onboardingFlowService.processOnboarding(phone, 'Botox 2800 3x');
      // Deve detectar parcelado
      expect(response).toContain('3x');
    });

    test('deve extrair valor de "Insumos R$ 500,00"', async () => {
      const phone = '5511999999981';
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
      
      const response = await onboardingFlowService.processOnboarding(phone, 'Insumos R$ 500,00');
      expect(response).toContain('500');
    });

    test('deve extrair valor de "Insumos 500.50"', async () => {
      const phone = '5511999999980';
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
      
      const response = await onboardingFlowService.processOnboarding(phone, 'Insumos 500.50');
      expect(response).toContain('500.50');
    });

    test('deve extrair valor de "Insumos 1.500,50"', async () => {
      const phone = '5511999999979';
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
      
      const response = await onboardingFlowService.processOnboarding(phone, 'Insumos 1.500,50');
      expect(response).toContain('1500.50');
    });
  });

  describe('Estados Inconsistentes', () => {
    test('deve retomar onboarding após reinício do servidor', async () => {
      const phone = '5511999999978';
      const onboardingService = require('../../src/services/onboardingService');
      
      // Simula estado persistido
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
      // Deve retomar do passo AHA_REVENUE
      expect(response).toContain('Primeira venda');
    });

    test('deve lidar com estado em memória diferente do banco', async () => {
      const phone = '5511999999977';
      const onboardingService = require('../../src/services/onboardingService');
      
      // Estado em memória
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      
      // Estado no banco diferente (mais avançado)
      onboardingService.getWhatsappState = jest.fn().mockResolvedValue({
        step: 'AHA_REVENUE',
        data: {
          telefone: phone,
          nome: 'Teste',
          clinica: 'Clínica'
        }
      });

      // Ao reiniciar, deve usar estado do banco
      const response = await onboardingFlowService.startIntroFlow(phone);
      expect(response).toContain('Primeira venda');
    });
  });

  describe('Cálculo de Resumo', () => {
    test('deve calcular resumo corretamente após salvar venda e custo', async () => {
      const phone = '5511999999976';
      
      // Completa onboarding
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Botox 2800 pix');
      await onboardingFlowService.processOnboarding(phone, '1'); // Confirma venda
      await onboardingFlowService.processOnboarding(phone, '2'); // Custo variável
      await onboardingFlowService.processOnboarding(phone, 'Insumos 500');
      await onboardingFlowService.processOnboarding(phone, '1'); // Categoria
      
      const response = await onboardingFlowService.processOnboarding(phone, '1'); // Confirma custo
      
      // Deve mostrar resumo com valores corretos
      expect(response).toContain('Resumo parcial do mês');
      expect(response).toContain('2800'); // Entrada
      expect(response).toContain('500'); // Custo variável
      expect(response).toContain('2300'); // Saldo parcial (2800 - 500)
    });

    test('deve calcular resumo apenas com dados salvos (flag saved)', async () => {
      const phone = '5511999999975';
      const transactionController = require('../../src/controllers/transactionController');
      const originalCreate = transactionController.createAtendimento;
      
      // Simula falha ao salvar venda
      transactionController.createAtendimento = jest.fn().mockResolvedValue(null);
      
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Botox 2800 pix');
      
      // Deve informar erro e não avançar
      const response = await onboardingFlowService.processOnboarding(phone, '1');
      expect(response).toContain('problema ao registrar sua venda');
      
      transactionController.createAtendimento = originalCreate;
    });
  });
});
