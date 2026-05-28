/**
 * Testes e2e do fluxo de onboarding v2 (5 Atos).
 * Ativa via process.env.ONBOARDING_V2 = 'true' antes de importar o service.
 *
 * Cobre:
 *   - Fluxo feliz completo: ACT1 → ACT2 → ACT3 → ACT4 → ACT5 (encerramento)
 *   - Correção de venda (resposta negativa em ACT2_SALE_CONFIRM)
 *   - Correção de custo (resposta negativa em ACT3_COST_CONFIRM)
 *   - Valor monetário inválido em ACT2 e ACT3
 *   - Fallback de segurança ACT5_CTA (estado orfão)
 */

process.env.NODE_ENV = 'test';
process.env.ONBOARDING_V2 = 'true';

// Mocks de infraestrutura
jest.mock('../../src/services/analyticsService', () => ({ track: jest.fn().mockResolvedValue(true) }));
jest.mock('../../src/services/evolutionService', () => ({ sendMessage: jest.fn().mockResolvedValue(true) }));
jest.mock('../../src/services/onboardingService', () => ({
  getWhatsappState: jest.fn().mockResolvedValue(null),
  upsertWhatsappState: jest.fn().mockResolvedValue(true),
  clearWhatsappState: jest.fn().mockResolvedValue(true),
  ensureState: jest.fn().mockResolvedValue({}),
  getState: jest.fn().mockResolvedValue(null)
}));
jest.mock('../../src/services/trialAccountService', () => ({
  trialAccountService: {
    saveRevenue: jest.fn().mockResolvedValue(true),
    saveCost: jest.fn().mockResolvedValue(true),
    saveReferralSummary: jest.fn().mockResolvedValue(true),
  },
  saveReferralSummary: jest.fn().mockResolvedValue(true),
  createTrialAccount: jest.fn().mockResolvedValue({ id: 'trial_user_001' }),
  buildForwardSummary: jest.fn().mockReturnValue('Resumo do teste'),
  computeGhostSummary: jest.fn().mockReturnValue({ entradas: 0, custosFixos: 0, custosVariaveis: 0, saldoParcial: 0 })
}));
jest.mock('../../src/controllers/userController', () => ({
  createUserFromOnboarding: jest.fn().mockResolvedValue({
    user: {
      id: 'created_user_001',
      nome_completo: 'Cliente Lumiz',
      nome_clinica: 'Clínica em teste'
    }
  }),
  findUserByPhone: jest.fn().mockResolvedValue(null)
}));
jest.mock('../../src/services/clinicMemberService', () => ({
  addMember: jest.fn().mockResolvedValue({ success: true })
}));
jest.mock('../../src/controllers/transactionController', () => ({
  createAtendimento: jest.fn().mockResolvedValue({ id: 'atend_001' }),
  createContaPagar: jest.fn().mockResolvedValue({ id: 'conta_001' })
}));
jest.mock('../../src/db/supabase', () => ({
  from: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null })
  })
}));

const transactionController = require('../../src/controllers/transactionController');
const userController = require('../../src/controllers/userController');
const onboardingFlowService = require('../../src/services/onboardingFlowService');

const PHONE_RAW = '5511988880002';
const { normalizePhone } = require('../../src/utils/phone');
const PHONE = normalizePhone(PHONE_RAW) || PHONE_RAW; // "+5511988880002"

function clearState() {
  onboardingFlowService.onboardingStates?.delete(PHONE);
  onboardingFlowService.persistTimers?.delete(PHONE);
}

async function send(msg) {
  return onboardingFlowService.processOnboarding(PHONE_RAW, msg);
}

beforeEach(() => {
  clearState();
  jest.clearAllMocks();
});

afterEach(() => {
  clearState();
});

// ─── Fluxo feliz ─────────────────────────────────────────────────────────────

describe('Onboarding v2 — fluxo feliz completo', () => {
  test('ACT1: boas-vindas ao iniciar', async () => {
    const res = await onboardingFlowService.startIntroFlow(PHONE);
    expect(res).toBeTruthy();
    const state = onboardingFlowService.onboardingStates.get(PHONE);
    expect(state.step).toBe('ACT1_ROLE');
  });

  test('ACT1 → ACT2: escolha "dona" avança para pedido de venda', async () => {
    await onboardingFlowService.startIntroFlow(PHONE);
    const res = await send('dona');
    expect(res).toBeTruthy();
    const state = onboardingFlowService.onboardingStates.get(PHONE);
    expect(state.step).toBe('ACT2_SALE');
    expect(state.data.role).toBe('owner');
  });

  test('ACT2 → ACT2_CONFIRM: extrai venda em texto livre', async () => {
    await onboardingFlowService.startIntroFlow(PHONE);
    await send('dona');
    const res = await send('Botox R$ 900 pix');
    expect(res).toBeTruthy();
    const state = onboardingFlowService.onboardingStates.get(PHONE);
    expect(state.step).toBe('ACT2_SALE_CONFIRM');
    expect(state.data.act2_pending?.valor).toBe(900);
  });

  test('ACT2_CONFIRM → ACT3: confirma venda e avança para custo', async () => {
    await onboardingFlowService.startIntroFlow(PHONE);
    await send('dona');
    await send('Botox 900 pix');
    const res = await send('sim');
    expect(res).toBeTruthy();
    const state = onboardingFlowService.onboardingStates.get(PHONE);
    expect(state.step).toBe('ACT3_COST');
    expect(state.data.userId).toBe('created_user_001');
    expect(userController.createUserFromOnboarding).toHaveBeenCalledTimes(1);
    expect(transactionController.createAtendimento).toHaveBeenCalledTimes(1);
  });

  test('ACT3 → ACT3_CONFIRM: extrai custo em texto livre', async () => {
    await onboardingFlowService.startIntroFlow(PHONE);
    await send('dona');
    await send('Botox 900 pix');
    await send('sim');
    const res = await send('Insumos R$ 200');
    expect(res).toBeTruthy();
    const state = onboardingFlowService.onboardingStates.get(PHONE);
    expect(state.step).toBe('ACT3_COST_CONFIRM');
    expect(state.data.act3_pending?.valor).toBe(200);
  });

  test('ACT3_CONFIRM → ACT4: confirma custo, exibe insight', async () => {
    await onboardingFlowService.startIntroFlow(PHONE);
    onboardingFlowService.onboardingStates.get(PHONE).data.userId = 'test_user_001';
    await send('dona');
    await send('Botox 900 pix');
    await send('sim');
    await send('Insumos 200');
    const res = await send('sim');
    expect(res).toBeTruthy();
    const state = onboardingFlowService.onboardingStates.get(PHONE);
    expect(state.step).toBe('ACT4_AHA');
    expect(transactionController.createContaPagar).toHaveBeenCalledTimes(1);
  });

  test('ACT4 → encerramento: qualquer resposta encerra o onboarding', async () => {
    await onboardingFlowService.startIntroFlow(PHONE);
    await send('dona');
    await send('Botox 900 pix');
    await send('sim');
    await send('Insumos 200');
    await send('sim');
    const res = await send('show');
    expect(res).toBeTruthy();
    expect(onboardingFlowService.onboardingStates.has(PHONE)).toBe(false);
  });
});

// ─── Correções ───────────────────────────────────────────────────────────────

describe('Onboarding v2 — correções mid-flow', () => {
  test('ACT2_CONFIRM: "não" volta para ACT2_SALE', async () => {
    await onboardingFlowService.startIntroFlow(PHONE);
    await send('dona');
    await send('Botox 900');
    const res = await send('não');
    const state = onboardingFlowService.onboardingStates.get(PHONE);
    expect(state.step).toBe('ACT2_SALE');
    expect(transactionController.createAtendimento).not.toHaveBeenCalled();
  });

  test('ACT3_CONFIRM: "não" volta para ACT3_COST', async () => {
    await onboardingFlowService.startIntroFlow(PHONE);
    await send('dona');
    await send('Botox 900');
    await send('sim');
    await send('Insumos 200');
    const res = await send('não');
    const state = onboardingFlowService.onboardingStates.get(PHONE);
    expect(state.step).toBe('ACT3_COST');
    expect(transactionController.createContaPagar).not.toHaveBeenCalled();
  });
});

// ─── Valores inválidos ───────────────────────────────────────────────────────

describe('Onboarding v2 — inputs inválidos', () => {
  test('ACT2: sem valor monetário pede nova tentativa', async () => {
    await onboardingFlowService.startIntroFlow(PHONE);
    await send('dona');
    const res = await send('fiz um procedimento hoje');
    const state = onboardingFlowService.onboardingStates.get(PHONE);
    expect(state.step).toBe('ACT2_SALE');
    expect(res).toBeTruthy();
  });

  test('ACT3: sem valor monetário pede nova tentativa', async () => {
    await onboardingFlowService.startIntroFlow(PHONE);
    await send('dona');
    await send('Botox 900');
    await send('sim');
    const res = await send('comprei uns insumos');
    const state = onboardingFlowService.onboardingStates.get(PHONE);
    expect(state.step).toBe('ACT3_COST');
    expect(res).toBeTruthy();
  });
});

// ─── Fallback ACT5_CTA ───────────────────────────────────────────────────────

describe('Onboarding v2 — fallback ACT5_CTA', () => {
  test('estado orfão ACT5_CTA encerra o onboarding sem lostState', async () => {
    // Simula estado persistido com step=ACT5_CTA (crash antes do clear)
    onboardingFlowService.onboardingStates.set(PHONE, {
      step: 'ACT5_CTA',
      startTime: Date.now(),
      data: { role: 'owner', telefone: PHONE }
    });

    const res = await send('oi');
    expect(res).toBeTruthy();
    expect(res).not.toContain('me perdi');
    expect(onboardingFlowService.onboardingStates.has(PHONE)).toBe(false);
  });
});
