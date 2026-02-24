/**
 * E2E Onboarding (sem banco)
 *
 * Objetivo:
 * - Validar o fluxo completo do onboarding via WhatsApp do passo 0 ate o final
 * - Garantir que branches principais continuam funcionais
 * - Rodar de forma repetivel sem precisar limpar dados no banco
 */

jest.mock('../../src/services/analyticsService', () => ({
  track: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../src/services/onboardingService', () => {
  const inMemory = new Map();
  return {
    getWhatsappState: jest.fn().mockImplementation(async (phone) => inMemory.get(phone) || null),
    upsertWhatsappState: jest.fn().mockImplementation(async (phone, payload) => {
      inMemory.set(phone, {
        ...payload,
        startTime: Date.now()
      });
      return true;
    }),
    clearWhatsappState: jest.fn().mockImplementation(async (phone) => {
      inMemory.delete(phone);
      return true;
    })
  };
});

jest.mock('../../src/services/cacheService', () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(true),
  delete: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../src/controllers/userController', () => ({
  createUserFromOnboarding: jest.fn().mockResolvedValue({ user: { id: 'e2e-user-123' } }),
  findUserByPhone: jest.fn().mockResolvedValue({ id: 'e2e-user-123' })
}));

jest.mock('../../src/controllers/transactionController', () => ({
  createAtendimento: jest.fn().mockResolvedValue({ id: 'e2e-atendimento-123' }),
  createContaPagar: jest.fn().mockResolvedValue({ id: 'e2e-conta-123' })
}));

jest.mock('../../src/services/clinicMemberService', () => ({
  addMember: jest.fn().mockResolvedValue({ success: true })
}));

jest.mock('../../src/services/knowledgeService', () => ({
  saveInteraction: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../src/services/registrationTokenService', () => ({
  generateSetupToken: jest.fn().mockResolvedValue({
    registrationLink: 'https://app.lumiz.com/setup/e2e-link-24h'
  })
}));

jest.mock('../../src/services/intentHeuristicService', () => ({
  detectIntent: jest.fn().mockResolvedValue(null)
}));

jest.mock('../../src/services/documentService', () => ({
  processImage: jest.fn().mockResolvedValue({ transacoes: [] }),
  processDocumentFromBuffer: jest.fn().mockResolvedValue({ transacoes: [] })
}));

const onboardingFlowService = require('../../src/services/onboardingFlowService');
const userController = require('../../src/controllers/userController');
const transactionController = require('../../src/controllers/transactionController');
const registrationTokenService = require('../../src/services/registrationTokenService');

function resetOnboardingState(phone) {
  if (!phone) return;

  const timer = onboardingFlowService.persistTimers?.get(phone);
  if (timer) {
    clearTimeout(timer);
    onboardingFlowService.persistTimers.delete(phone);
  }

  onboardingFlowService.onboardingStates?.delete(phone);
}

describe('Onboarding E2E (sem banco)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (onboardingFlowService.persistTimers) {
      for (const timer of onboardingFlowService.persistTimers.values()) {
        clearTimeout(timer);
      }
      onboardingFlowService.persistTimers.clear();
    }
    if (onboardingFlowService.onboardingStates) {
      onboardingFlowService.onboardingStates.clear();
    }
  });

  test('deve completar o fluxo completo do passo 0 ao fim com link de dashboard', async () => {
    const phone = `5511${Date.now().toString().slice(-8)}`;
    resetOnboardingState(phone);

    let response = await onboardingFlowService.startIntroFlow(phone);
    expect(response).toContain('Oi! Eu sou a Lumiz');
    expect(response).toContain('Posso começar?');

    response = await onboardingFlowService.processOnboarding(phone, '1');
    expect(response).toContain('posso usar os dados');

    response = await onboardingFlowService.processOnboarding(phone, '1');
    expect(response).toContain('qual seu nome');

    response = await onboardingFlowService.processOnboarding(phone, 'Maria Silva');
    expect(response).toContain('nome da sua clínica');

    response = await onboardingFlowService.processOnboarding(phone, 'Clinica Estetica Bela');
    expect(response).toContain('dona/gestora');

    response = await onboardingFlowService.processOnboarding(phone, '1');
    expect(response).toContain('usar a Lumiz mais pra');

    response = await onboardingFlowService.processOnboarding(phone, '1');
    expect(response).toContain('recebe mais por');

    response = await onboardingFlowService.processOnboarding(phone, '1');
    expect(response).toContain('Me manda uma venda real');

    response = await onboardingFlowService.processOnboarding(phone, 'Botox 2800 pix hoje');
    expect(response).toContain('*VENDA*');
    expect(response).toContain('R$ 2.800,00');

    response = await onboardingFlowService.processOnboarding(phone, '1');
    expect(response).toContain('Venda registrada (teste)');
    expect(response).toContain('Me envie um custo');

    response = await onboardingFlowService.processOnboarding(phone, 'Insumos 500');
    expect(response).toContain('*CUSTO*');
    expect(response).toContain('Variável');

    response = await onboardingFlowService.processOnboarding(phone, '1');
    expect(response).toContain('custo fixo');

    response = await onboardingFlowService.processOnboarding(phone, 'Aluguel 1200');
    expect(response).toContain('*CUSTO*');
    expect(response).toContain('Fixo');

    response = await onboardingFlowService.processOnboarding(phone, '1');
    expect(response).toContain('Resumo parcial do mês');
    expect(response).toContain('Entradas: R$ 2.800,00');
    expect(response).toContain('Custos fixos: R$ 1.200,00');
    expect(response).toContain('Custos variáveis: R$ 500,00');
    expect(response).toContain('Quer me mandar o saldo que você tem hoje');

    response = await onboardingFlowService.processOnboarding(phone, '2');
    expect(response).toContain('Onboarding feito');
    expect(response).toContain('Configuração 100% finalizada');
    expect(response).toContain('Seu dashboard já está liberado');
    expect(response).toContain('https://app.lumiz.com/setup/e2e-link-24h');

    expect(userController.createUserFromOnboarding).toHaveBeenCalledTimes(1);
    expect(registrationTokenService.generateSetupToken).toHaveBeenCalledTimes(1);

    // Durante onboarding atual, transacoes sao simuladas e nao salvas no banco
    expect(transactionController.createAtendimento).not.toHaveBeenCalled();
    expect(transactionController.createContaPagar).not.toHaveBeenCalled();

    expect(onboardingFlowService.onboardingStates.has(phone)).toBe(false);
  });

  test('deve cobrir branches de validacao no inicio (como funciona, negar consentimento, nome invalido)', async () => {
    const phone = `5511${(Date.now() + 1).toString().slice(-8)}`;
    resetOnboardingState(phone);

    let response = await onboardingFlowService.startIntroFlow(phone);
    expect(response).toContain('Posso começar?');

    response = await onboardingFlowService.processOnboarding(phone, '2');
    expect(response).toContain('Em 3 minutos você me manda 1 venda e 1 custo');

    response = await onboardingFlowService.processOnboarding(phone, '1');
    expect(response).toContain('posso usar os dados');

    response = await onboardingFlowService.processOnboarding(phone, '2');
    expect(response).toContain('preciso da sua confirmação');

    response = await onboardingFlowService.processOnboarding(phone, '1');
    expect(response).toContain('qual seu nome');

    response = await onboardingFlowService.processOnboarding(phone, '123');
    expect(response).toContain('Nome inválido');

    response = await onboardingFlowService.processOnboarding(phone, 'Maria');
    expect(response).toContain('nome da sua clínica');
  });

  test('deve manter compatibilidade com steps legados de custo', async () => {
    const phone = '+5511998877665';
    resetOnboardingState(phone);

    onboardingFlowService.onboardingStates.set(phone, {
      step: 'AHA_COSTS_INTRO',
      startTime: Date.now(),
      data: {
        telefone: phone,
        pending_cost: { valor: 100, descricao: 'teste', tipo: null }
      }
    });

    let response = await onboardingFlowService.processOnboarding(phone, 'ok');
    expect(response).toContain('Me envie um custo');

    onboardingFlowService.onboardingStates.set(phone, {
      step: 'AHA_COSTS_DOCUMENT_TYPE',
      startTime: Date.now(),
      data: {
        telefone: phone,
        pending_cost: { valor: 100, descricao: 'aluguel', tipo: null }
      }
    });

    response = await onboardingFlowService.processOnboarding(phone, '1');
    expect(response).toContain('Beleza → fixo');
    expect(response).toContain('isso entra mais como');
  });
});
