/**
 * Testes de Edge Cases e Validações - Onboarding
 * 
 * Testa casos extremos e validações:
 * - Validação de entrada (nomes, valores, mensagens)
 * - Detecção de forma de pagamento
 * - Extração de valores em diferentes formatos
 * - Estados inconsistentes
 */

const onboardingFlowService = require('../../src/services/onboardingFlowService');

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

describe('Onboarding - Edge Cases e Validações', () => {
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

  describe('Validação de Entrada', () => {
    test('deve aceitar nome com caracteres especiais (acentos, ç)', async () => {
      await onboardingFlowService.startIntroFlow(testPhone);
      await onboardingFlowService.processOnboarding(testPhone, '1');
      
      const response = await onboardingFlowService.processOnboarding(testPhone, 'José da Silva');
      expect(response).toContain('nome da sua clínica');
      
      const state = onboardingFlowService.onboardingStates.get(testPhone);
      expect(state.data.nome).toBe('José da Silva');
    });

    test('deve aceitar nome da clínica com caracteres especiais', async () => {
      await onboardingFlowService.startIntroFlow(testPhone);
      await onboardingFlowService.processOnboarding(testPhone, '1');
      await onboardingFlowService.processOnboarding(testPhone, 'Maria');
      
      const response = await onboardingFlowService.processOnboarding(testPhone, 'Clínica Estética & Beleza');
      expect(response).toContain('Você é a dona/gestora');
      
      const state = onboardingFlowService.onboardingStates.get(testPhone);
      expect(state.data.clinica).toBe('Clínica Estética & Beleza');
    });

    test('deve rejeitar nome muito curto (< 2 caracteres)', async () => {
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

    test('deve rejeitar nome muito longo (> 100 caracteres)', async () => {
      await onboardingFlowService.startIntroFlow(testPhone);
      await onboardingFlowService.processOnboarding(testPhone, '1');
      
      const longName = 'A'.repeat(101);
      const response = await onboardingFlowService.processOnboarding(testPhone, longName);
      expect(response).toContain('muito longo');
    });

    test('deve lidar com mensagem vazia', async () => {
      await onboardingFlowService.startIntroFlow(testPhone);
      
      const response = await onboardingFlowService.processOnboarding(testPhone, '');
      expect(response).toBeDefined();
      expect(response.length).toBeGreaterThan(0);
    });

    test('deve lidar com mensagem só com espaços', async () => {
      await onboardingFlowService.startIntroFlow(testPhone);
      
      const response = await onboardingFlowService.processOnboarding(testPhone, '   ');
      expect(response).toBeDefined();
    });

    test('deve truncar mensagem muito longa (> 5000 chars)', async () => {
      await onboardingFlowService.startIntroFlow(testPhone);
      await onboardingFlowService.processOnboarding(testPhone, '1');
      
      const longMessage = 'A'.repeat(6000);
      const response = await onboardingFlowService.processOnboarding(testPhone, longMessage);
      // Deve processar (truncado internamente) ou rejeitar
      expect(response).toBeDefined();
    });
  });

  describe('Detecção de Forma de Pagamento', () => {
    test('deve assumir "avista" quando não menciona forma de pagamento', async () => {
      const phone = '5511999999989';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const response = await onboardingFlowService.processOnboarding(phone, 'Botox 2800');
      
      expect(response).toContain('Vou registrar assim');
      const state = onboardingFlowService.onboardingStates.get(phone);
      expect(state.data.pending_sale.forma_pagamento).toBe('avista');
    });

    test('deve assumir "credito_avista" quando menciona cartão sem parcelas', async () => {
      const phone = '5511999999988';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const response = await onboardingFlowService.processOnboarding(phone, 'Botox 2800 cartão');
      
      expect(response).toContain('Vou registrar assim');
      const state = onboardingFlowService.onboardingStates.get(phone);
      expect(state.data.pending_sale.forma_pagamento).toBe('credito_avista');
    });

    test('deve detectar parcelado quando menciona "3x"', async () => {
      const phone = '5511999999987';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const response = await onboardingFlowService.processOnboarding(phone, 'Botox 2800 3x');
      
      expect(response).toContain('3x');
      const state = onboardingFlowService.onboardingStates.get(phone);
      expect(state.data.pending_sale.forma_pagamento).toBe('parcelado');
      expect(state.data.pending_sale.parcelas).toBe(3);
    });

    test('deve detectar PIX quando mencionado', async () => {
      const phone = '5511999999986';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const response = await onboardingFlowService.processOnboarding(phone, 'Botox 2800 pix');
      
      expect(response).toContain('Vou registrar assim');
      const state = onboardingFlowService.onboardingStates.get(phone);
      expect(state.data.pending_sale.forma_pagamento).toBe('pix');
    });

    test('deve detectar dinheiro quando mencionado', async () => {
      const phone = '5511999999985';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const response = await onboardingFlowService.processOnboarding(phone, 'Botox 2800 dinheiro');
      
      expect(response).toContain('Vou registrar assim');
      const state = onboardingFlowService.onboardingStates.get(phone);
      expect(state.data.pending_sale.forma_pagamento).toBe('dinheiro');
    });

    test('deve priorizar forma de pagamento mais específica quando múltiplas são mencionadas', async () => {
      const phone = '5511999999984';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      // Menciona múltiplas formas - deve priorizar a mais específica (parcelado)
      const response = await onboardingFlowService.processOnboarding(phone, 'Botox 2800 pix cartão 3x');
      
      expect(response).toContain('Vou registrar assim');
      const state = onboardingFlowService.onboardingStates.get(phone);
      // Parcelado é mais específico que pix
      expect(state.data.pending_sale.forma_pagamento).toBe('parcelado');
      expect(state.data.pending_sale.parcelas).toBe(3);
    });
  });

  describe('Extração de Valores', () => {
    test('deve extrair valor de "R$ 1.500,00"', async () => {
      const phone = '5511999999983';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const response = await onboardingFlowService.processOnboarding(phone, 'Botox R$ 1.500,00');
      
      expect(response).toContain('Vou registrar assim');
      const state = onboardingFlowService.onboardingStates.get(phone);
      expect(state.data.pending_sale.valor).toBe(1500);
    });

    test('deve extrair valor de "1500.50"', async () => {
      const phone = '5511999999982';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const response = await onboardingFlowService.processOnboarding(phone, 'Botox 1500.50');
      
      expect(response).toContain('Vou registrar assim');
      const state = onboardingFlowService.onboardingStates.get(phone);
      expect(state.data.pending_sale.valor).toBe(1500.50);
    });

    test('deve extrair valor de "1.500,50" (formato brasileiro)', async () => {
      const phone = '5511999999981';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const response = await onboardingFlowService.processOnboarding(phone, 'Botox 1.500,50');
      
      expect(response).toContain('Vou registrar assim');
      const state = onboardingFlowService.onboardingStates.get(phone);
      expect(state.data.pending_sale.valor).toBe(1500.50);
    });

    test('deve extrair valor de "Insumos R$ 500,00"', async () => {
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
      
      const response = await onboardingFlowService.processOnboarding(phone, 'Insumos R$ 500,00');
      
      expect(response).toContain('Pra eu organizar certinho');
      const state = onboardingFlowService.onboardingStates.get(phone);
      expect(state.data.pending_cost.valor).toBe(500);
    });

    test('deve rejeitar valor negativo', async () => {
      const phone = '5511999999979';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const response = await onboardingFlowService.processOnboarding(phone, 'Botox -100');
      
      // Deve rejeitar ou não encontrar valor
      expect(response).toMatch(/valor|não encontrei|informe/i);
    });

    test('deve rejeitar valor muito alto (> R$ 10 milhões)', async () => {
      const phone = '5511999999978';
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const response = await onboardingFlowService.processOnboarding(phone, 'Botox 15000000');
      
      expect(response).toContain('muito alto');
    });

    test('deve rejeitar valor muito baixo (< R$ 0,01)', async () => {
      const phone = '5511999999977';
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

  describe('Estados Inconsistentes', () => {
    test('deve lidar com step inválido ou desconhecido', async () => {
      const phone = '5511999999976';
      
      await onboardingFlowService.startIntroFlow(phone);
      const state = onboardingFlowService.onboardingStates.get(phone);
      
      // Injeta step inválido
      state.step = 'INVALID_STEP_UNKNOWN';
      
      const response = await onboardingFlowService.processOnboarding(phone, 'teste');
      
      // Deve lidar graciosamente (retornar mensagem de erro ou resetar)
      expect(response).toBeDefined();
      expect(response.length).toBeGreaterThan(0);
    });

    test('deve lidar com dados faltando em onboarding.data', async () => {
      const phone = '5511999999975';
      
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const state = onboardingFlowService.onboardingStates.get(phone);
      // Remove dados críticos
      delete state.data.nome;
      state.step = 'PROFILE_CLINIC';
      
      // Tenta avançar sem nome
      const response = await onboardingFlowService.processOnboarding(phone, 'Clínica');
      
      // Deve detectar problema ou continuar
      expect(response).toBeDefined();
    });

    test('deve lidar com pending_sale sem campos obrigatórios', async () => {
      const phone = '5511999999974';
      
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const state = onboardingFlowService.onboardingStates.get(phone);
      state.step = 'AHA_REVENUE_CONFIRM';
      state.data.pending_sale = {
        // Sem valor!
        forma_pagamento: 'pix'
      };
      
      const response = await onboardingFlowService.processOnboarding(phone, '1');
      
      // Deve detectar problema e pedir novamente
      expect(response).toContain('Primeira venda');
    });

    test('deve lidar com pending_cost sem campos obrigatórios', async () => {
      const phone = '5511999999973';
      
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
      
      const state = onboardingFlowService.onboardingStates.get(phone);
      state.step = 'AHA_COSTS_CONFIRM';
      state.data.pending_cost = {
        // Sem valor!
        tipo: 'variavel'
      };
      
      const response = await onboardingFlowService.processOnboarding(phone, '1');
      
      // Deve detectar problema e pedir novamente
      expect(response).toMatch(/custo|valor|tente novamente/i);
    });

    test('deve lidar com múltiplos custos pendentes simultaneamente', async () => {
      const phone = '5511999999972';
      
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
      
      const state = onboardingFlowService.onboardingStates.get(phone);
      
      // Injeta múltiplos custos pendentes (não deveria acontecer, mas testa)
      state.data.pending_cost = { valor: 500, tipo: 'variavel' };
      state.data.pending_cost_document = { valor: 300, tipo: 'fixa' };
      
      const response = await onboardingFlowService.processOnboarding(phone, '1');
      
      // Deve processar um e limpar o outro
      expect(response).toBeDefined();
    });
  });
});

