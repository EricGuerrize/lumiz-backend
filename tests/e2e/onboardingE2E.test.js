/**
 * Testes End-to-End - Simulação Completa do Onboarding
 * 
 * Simula conversa completa via WhatsApp:
 * - Verifica que dados são salvos corretamente no banco
 * - Verifica que resumo está correto
 * - Verifica que analytics são enviados
 * - Testa fluxo completo com múltiplos cenários
 */

const onboardingFlowService = require('../../src/services/onboardingFlowService');
const userController = require('../../src/controllers/userController');
const transactionController = require('../../src/controllers/transactionController');
const supabase = require('../../src/db/supabase');

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

describe('Onboarding E2E - Simulação Completa', () => {
  const testPhone = '5511999999999';
  let createdUserId = null;
  let createdAtendimentoId = null;
  let createdContaId = null;

  beforeEach(() => {
    jest.clearAllMocks();
    // Limpa estado antes de cada teste
    if (onboardingFlowService.onboardingStates && onboardingFlowService.onboardingStates.has(testPhone)) {
      onboardingFlowService.onboardingStates.delete(testPhone);
    }
  });

  afterEach(async () => {
    // Limpa dados de teste do banco
    if (createdAtendimentoId) {
      try {
        await supabase.from('atendimentos').delete().eq('id', createdAtendimentoId);
      } catch (e) {
        console.error('Erro ao limpar atendimento:', e);
      }
    }
    if (createdContaId) {
      try {
        await supabase.from('contas_pagar').delete().eq('id', createdContaId);
      } catch (e) {
        console.error('Erro ao limpar conta:', e);
      }
    }
    if (createdUserId) {
      try {
        await supabase.from('users').delete().eq('id', createdUserId);
      } catch (e) {
        console.error('Erro ao limpar usuário:', e);
      }
    }
  });

  describe('Fluxo Completo Happy Path', () => {
    test('deve completar onboarding e salvar dados no banco', async () => {
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
      expect(response).toContain('2800');

      // 9. Confirma venda
      // Mock do createAtendimento para capturar o ID criado
      const originalCreateAtendimento = transactionController.createAtendimento;
      transactionController.createAtendimento = jest.fn().mockImplementation(async (userId, data) => {
        const result = await originalCreateAtendimento(userId, data);
        createdUserId = userId;
        if (result && result.id) {
          createdAtendimentoId = result.id;
        }
        return result;
      });

      response = await onboardingFlowService.processOnboarding(testPhone, '1');
      expect(response).toContain('Venda registrada');

      // Verifica que createAtendimento foi chamado
      expect(transactionController.createAtendimento).toHaveBeenCalled();
      const atendimentoCall = transactionController.createAtendimento.mock.calls[0];
      expect(atendimentoCall[1].valor).toBe(2800);
      expect(atendimentoCall[1].forma_pagamento).toBe('pix');

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
      // Mock do createContaPagar para capturar o ID criado
      const originalCreateConta = transactionController.createContaPagar;
      transactionController.createContaPagar = jest.fn().mockImplementation(async (userId, data) => {
        const result = await originalCreateConta(userId, data);
        if (result && result.id) {
          createdContaId = result.id;
        }
        return result;
      });

      response = await onboardingFlowService.processOnboarding(testPhone, '1');
      expect(response).toContain('Resumo parcial do mês');
      expect(response).toContain('2800'); // Entrada
      expect(response).toContain('500'); // Custo variável
      expect(response).toContain('2300'); // Saldo parcial

      // Verifica que createContaPagar foi chamado
      expect(transactionController.createContaPagar).toHaveBeenCalled();
      const contaCall = transactionController.createContaPagar.mock.calls[0];
      expect(contaCall[1].valor).toBe(500);
      expect(contaCall[1].tipo).toBe('variavel');

      // 14. Vê resumo e completa
      response = await onboardingFlowService.processOnboarding(testPhone, '');
      expect(response).toContain('Agora é só me usar no dia a dia');

      // Restaura mocks
      transactionController.createAtendimento = originalCreateAtendimento;
      transactionController.createContaPagar = originalCreateConta;
    });
  });

  describe('Verificação de Dados no Banco', () => {
    test('deve verificar que venda foi salva corretamente', async () => {
      const phone = '5511999999998';
      
      // Avança até confirmar venda
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Botox 2800 pix');
      
      // Mock para capturar dados salvos
      let savedAtendimento = null;
      const originalCreate = transactionController.createAtendimento;
      transactionController.createAtendimento = jest.fn().mockImplementation(async (userId, data) => {
        savedAtendimento = { userId, ...data };
        return { id: 'test-id', ...data };
      });

      await onboardingFlowService.processOnboarding(phone, '1');

      // Verifica dados salvos
      expect(savedAtendimento).not.toBeNull();
      expect(savedAtendimento.valor).toBe(2800);
      expect(savedAtendimento.forma_pagamento).toBe('pix');
      expect(savedAtendimento.categoria).toBe('Procedimento');

      transactionController.createAtendimento = originalCreate;
    });

    test('deve verificar que custo foi salvo corretamente', async () => {
      const phone = '5511999999997';
      
      // Avança até confirmar custo
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
      
      // Mock para capturar dados salvos
      let savedConta = null;
      const originalCreate = transactionController.createContaPagar;
      transactionController.createContaPagar = jest.fn().mockImplementation(async (userId, data) => {
        savedConta = { userId, ...data };
        return { id: 'test-id', ...data };
      });

      await onboardingFlowService.processOnboarding(phone, '1');

      // Verifica dados salvos
      expect(savedConta).not.toBeNull();
      expect(savedConta.valor).toBe(500);
      expect(savedConta.tipo).toBe('variavel');
      expect(savedConta.categoria).toBe('Insumos / materiais');

      transactionController.createContaPagar = originalCreate;
    });
  });

  describe('Verificação de Analytics', () => {
    test('deve enviar analytics em momentos chave', async () => {
      const analyticsService = require('../../src/services/analyticsService');
      const phone = '5511999999996';
      
      await onboardingFlowService.startIntroFlow(phone);
      expect(analyticsService.track).toHaveBeenCalledWith(
        'onboarding_whatsapp_started',
        expect.objectContaining({ phone, source: 'whatsapp' })
      );

      await onboardingFlowService.processOnboarding(phone, '1');
      expect(analyticsService.track).toHaveBeenCalledWith(
        'onboarding_consent_started',
        expect.objectContaining({ phone, source: 'whatsapp' })
      );

      await onboardingFlowService.processOnboarding(phone, 'sim');
      expect(analyticsService.track).toHaveBeenCalledWith(
        'onboarding_consent_given',
        expect.objectContaining({ phone, source: 'whatsapp' })
      );
    });
  });

  describe('Verificação de Resumo', () => {
    test('deve calcular resumo corretamente com dados salvos', async () => {
      const phone = '5511999999995';
      
      // Completa onboarding
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Botox 2800 pix');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1'); // Custo fixo
      await onboardingFlowService.processOnboarding(phone, 'Aluguel 1500');
      await onboardingFlowService.processOnboarding(phone, '2'); // Categoria Aluguel
      await onboardingFlowService.processOnboarding(phone, '1');
      
      const response = await onboardingFlowService.processOnboarding(phone, '1');
      
      // Verifica resumo
      expect(response).toContain('Resumo parcial do mês');
      expect(response).toContain('2800'); // Entrada
      expect(response).toContain('1500'); // Custo fixo
      expect(response).toContain('1300'); // Saldo parcial (2800 - 1500)
    });
  });

  describe('Persistência de Estado', () => {
    test('deve retomar onboarding após reinício do servidor', async () => {
      const phone = '5511999999994';
      const onboardingService = require('../../src/services/onboardingService');
      
      // Simula estado persistido no banco
      onboardingService.getWhatsappState = jest.fn().mockResolvedValue({
        step: 'AHA_REVENUE',
        data: {
          telefone: phone,
          nome: 'Maria',
          clinica: 'Clínica Estética',
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
      expect(state.data.nome).toBe('Maria');
    });

    test('deve sincronizar estado em memória com banco', async () => {
      const phone = '5511999999993';
      const onboardingService = require('../../src/services/onboardingService');
      
      let upsertCalls = [];
      onboardingService.upsertWhatsappState = jest.fn().mockImplementation(async (phone, data) => {
        upsertCalls.push({ phone, ...data });
        return Promise.resolve(true);
      });

      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Maria');
      
      // Deve ter persistido estado
      expect(upsertCalls.length).toBeGreaterThan(0);
      
      // Última chamada deve ter o estado atualizado
      const lastCall = upsertCalls[upsertCalls.length - 1];
      expect(lastCall.step).toBe('PROFILE_CLINIC');
      expect(lastCall.data.nome).toBe('Maria');
    });

    test('deve limpar estado após conclusão do onboarding', async () => {
      const phone = '5511999999992';
      const onboardingService = require('../../src/services/onboardingService');
      
      let clearCalled = false;
      onboardingService.clearWhatsappState = jest.fn().mockImplementation(async () => {
        clearCalled = true;
        return Promise.resolve(true);
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
      await onboardingFlowService.processOnboarding(phone, 'Insumos 500');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      // Ao escolher opção que finaliza onboarding
      await onboardingFlowService.processOnboarding(phone, '1'); // Registrar venda
      
      // Deve ter chamado clearWhatsappState
      expect(clearCalled).toBe(true);
      
      // Estado em memória deve ser removido
      expect(onboardingFlowService.onboardingStates.has(phone)).toBe(false);
    });

    test('deve recuperar estado após timeout/erro', async () => {
      const phone = '5511999999991';
      const onboardingService = require('../../src/services/onboardingService');
      
      // Simula estado salvo antes de timeout
      onboardingService.getWhatsappState = jest.fn().mockResolvedValue({
        step: 'AHA_REVENUE_CONFIRM',
        data: {
          telefone: phone,
          nome: 'Maria',
          clinica: 'Clínica',
          role: 'dona_gestora',
          context_why: 'organizar_dia_a_dia',
          context_how: 'mais_pix',
          pending_sale: {
            valor: 2800,
            forma_pagamento: 'pix'
          }
        },
        startTime: Date.now()
      });

      const response = await onboardingFlowService.startIntroFlow(phone);
      
      // Deve retomar do step de confirmação
      const state = onboardingFlowService.onboardingStates.get(phone);
      expect(state.step).toBe('AHA_REVENUE_CONFIRM');
      expect(state.data.pending_sale.valor).toBe(2800);
    });
  });

  describe('Múltiplos Custos (Fixo + Variável)', () => {
    test('deve coletar e salvar custo fixo e variável corretamente', async () => {
      const phone = '5511999999990';
      let savedCosts = [];
      
      const originalCreateConta = transactionController.createContaPagar;
      transactionController.createContaPagar = jest.fn().mockImplementation(async (userId, data) => {
        const result = await originalCreateConta(userId, data);
        savedCosts.push({ userId, ...data });
        if (result && result.id) {
          createdContaId = result.id;
        }
        return result;
      });

      // Completa onboarding até custos
      await onboardingFlowService.startIntroFlow(phone);
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Teste');
      await onboardingFlowService.processOnboarding(phone, 'Clínica');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, 'Botox 2800 pix');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      // Primeiro custo: variável
      await onboardingFlowService.processOnboarding(phone, '2'); // Variável
      await onboardingFlowService.processOnboarding(phone, 'Insumos 500');
      await onboardingFlowService.processOnboarding(phone, '1'); // Categoria
      await onboardingFlowService.processOnboarding(phone, '1'); // Confirma
      
      // Segundo custo: fixo
      await onboardingFlowService.processOnboarding(phone, 'Aluguel 1500');
      await onboardingFlowService.processOnboarding(phone, '2'); // Categoria Aluguel
      await onboardingFlowService.processOnboarding(phone, '1'); // Confirma
      
      // Verifica que ambos foram salvos
      expect(savedCosts.length).toBe(2);
      
      const custoVariavel = savedCosts.find(c => c.tipo === 'variavel');
      const custoFixo = savedCosts.find(c => c.tipo === 'fixa');
      
      expect(custoVariavel).toBeDefined();
      expect(custoVariavel.valor).toBe(500);
      expect(custoFixo).toBeDefined();
      expect(custoFixo.valor).toBe(1500);
      
      // Verifica resumo final
      const response = await onboardingFlowService.processOnboarding(phone, '');
      expect(response).toContain('Resumo parcial do mês');
      expect(response).toContain('2800'); // Entrada
      expect(response).toContain('500'); // Custo variável
      expect(response).toContain('1500'); // Custo fixo
      expect(response).toContain('800'); // Saldo (2800 - 500 - 1500)

      transactionController.createContaPagar = originalCreateConta;
    });

    test('deve calcular resumo apenas com custos salvos (flag saved)', async () => {
      const phone = '5511999888888';
      
      const originalCreateConta = transactionController.createContaPagar;
      let savedCostsCount = 0;
      
      transactionController.createContaPagar = jest.fn().mockImplementation(async (userId, data) => {
        savedCostsCount++;
        // Primeiro custo salva com sucesso, segundo falha
        if (savedCostsCount === 1) {
          return { id: 'success-id', ...data };
        } else {
          return null; // Simula falha
        }
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
      
      // Primeiro custo: salva com sucesso
      await onboardingFlowService.processOnboarding(phone, '2');
      await onboardingFlowService.processOnboarding(phone, 'Insumos 500');
      await onboardingFlowService.processOnboarding(phone, '1');
      await onboardingFlowService.processOnboarding(phone, '1');
      
      // Segundo custo: falha ao salvar
      await onboardingFlowService.processOnboarding(phone, 'Aluguel 1500');
      await onboardingFlowService.processOnboarding(phone, '2');
      const response = await onboardingFlowService.processOnboarding(phone, '1');
      
      // Deve informar erro e não incluir custo não salvo no resumo
      expect(response).toContain('problema ao registrar seu custo');
      
      // Resumo (se mostrado) deve incluir apenas custo salvo
      const state = onboardingFlowService.onboardingStates.get(phone);
      if (state.data.saved_costs) {
        expect(state.data.saved_costs.length).toBe(1);
        expect(state.data.saved_costs[0].valor).toBe(500);
      }

      transactionController.createContaPagar = originalCreateConta;
    });
  });

  describe('Sincronização Estado/Banco', () => {
    test('deve usar estado do banco quando mais recente que memória', async () => {
      const phone = '5511999777777';
      const onboardingService = require('../../src/services/onboardingService');
      
      // Estado no banco (mais avançado)
      onboardingService.getWhatsappState = jest.fn().mockResolvedValue({
        step: 'AHA_COSTS_INTRO',
        data: {
          telefone: phone,
          nome: 'Maria',
          clinica: 'Clínica',
          role: 'dona_gestora',
          context_why: 'organizar_dia_a_dia',
          context_how: 'mais_pix',
          pending_sale: {
            valor: 2800,
            forma_pagamento: 'pix',
            saved: true
          }
        },
        startTime: Date.now()
      });

      // Estado em memória (mais antigo)
      await onboardingFlowService.startIntroFlow(phone);
      const stateInMemory = onboardingFlowService.onboardingStates.get(phone);
      stateInMemory.step = 'PROFILE_NAME'; // Step mais antigo
      
      // Ao reiniciar, deve usar estado do banco
      const response = await onboardingFlowService.startIntroFlow(phone);
      
      const finalState = onboardingFlowService.onboardingStates.get(phone);
      expect(finalState.step).toBe('AHA_COSTS_INTRO'); // Deve usar do banco
    });

    test('deve persistir estado crítico imediatamente após salvar transação', async () => {
      const phone = '5511999666666';
      const onboardingService = require('../../src/services/onboardingService');
      
      let upsertCalls = [];
      onboardingService.upsertWhatsappState = jest.fn().mockImplementation(async (phone, data) => {
        upsertCalls.push({ phone, ...data });
        return Promise.resolve(true);
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
      
      // Confirma venda (deve persistir imediatamente)
      await onboardingFlowService.processOnboarding(phone, '1');
      
      // Deve ter persistido estado após salvar venda
      const lastCall = upsertCalls[upsertCalls.length - 1];
      expect(lastCall.step).toBe('AHA_COSTS_INTRO');
      expect(lastCall.data.pending_sale.saved).toBe(true);
    });
  });
});


