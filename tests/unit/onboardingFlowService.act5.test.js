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

jest.mock('../../src/controllers/transactionController', () => ({
  createAtendimento: jest.fn().mockResolvedValue({ id: 'atendimento-test' }),
  createContaPagar: jest.fn().mockResolvedValue({ id: 'conta-test' })
}));

jest.mock('../../src/services/documentService', () => ({
  processImage: jest.fn().mockResolvedValue({ transacoes: [] })
}));

jest.mock('../../src/services/intentHeuristicService', () => ({
  detectIntent: jest.fn().mockResolvedValue(null)
}));

jest.mock('../../src/services/clinicMemberService', () => ({
  addMember: jest.fn().mockResolvedValue({ success: true })
}));

jest.mock('../../src/services/registrationTokenService', () => ({
  generateSetupToken: jest.fn().mockResolvedValue({
    registrationLink: 'https://lumiz.test/setup'
  })
}));

jest.mock('../../src/services/trialAccountService', () => ({
  trialAccountService: {
    saveRevenue: jest.fn().mockResolvedValue(true),
    saveCost: jest.fn().mockResolvedValue(true),
    setInitialBalance: jest.fn().mockResolvedValue(true),
    saveReferralSummary: jest.fn().mockResolvedValue(true)
  },
  buildForwardSummary: jest.fn().mockImplementation(({ clinicName }) => `Resumo pronto da ${clinicName}`),
  computeGhostSummary: jest.fn().mockReturnValue({
    entradas: 4800,
    custosFixos: 0,
    custosVariaveis: 16579.65,
    saldoParcial: -11779.65
  })
}));

jest.mock('../../src/services/subscriptionService', () => ({
  startTrial: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../src/services/evolutionService', () => ({
  sendMessage: jest.fn().mockResolvedValue(true)
}));

describe('OnboardingFlowService - Ato 5 CTA', () => {
  let onboardingFlowService;

  beforeEach(() => {
    jest.resetModules();
    onboardingFlowService = require('../../src/services/onboardingFlowService');
    onboardingFlowService.onboardingStates.clear();
    onboardingFlowService.persistTimers.clear();
  });

  afterEach(() => {
    onboardingFlowService.onboardingStates.clear();
    onboardingFlowService.persistTimers.clear();
    jest.clearAllMocks();
  });

  test('gera CTA de assinatura para dona/gestora', () => {
    const messages = onboardingFlowService.handlers._buildAct5Messages({
      data: {
        role: 'dona_gestora',
        nome: 'Marina',
        clinica: 'NB Clinic',
        userId: 'test-user-id',
        pending_sale: { saved: true, valor: 4800, procedimento: 'Full face' },
        saved_costs: [{ saved: true, valor: 16579.65, tipo: 'variavel', categoria: 'Insumos', parcelas: 3 }]
      }
    });

    expect(messages.join('\n\n')).toContain('ASSINAR');
    expect(messages.join('\n\n')).not.toContain('Resumo pronto');
  });

  test('gera resumo encaminhável para secretária', () => {
    const messages = onboardingFlowService.handlers._buildAct5Messages({
      data: {
        role: 'secretaria',
        nome: 'Paula',
        clinica: 'NB Clinic',
        userId: 'test-user-id',
        pending_sale: { saved: true, valor: 4800, procedimento: 'Full face' },
        saved_costs: [{ saved: true, valor: 16579.65, tipo: 'variavel', categoria: 'Insumos', parcelas: 3 }]
      }
    });

    expect(messages.join('\n\n')).toContain('Resumo pronto da NB Clinic');
    expect(messages.join('\n\n')).not.toContain('ASSINAR');
  });
});
