/**
 * Fase Agentic — decisões de roteamento alinhadas às intenções do classificador.
 */

jest.mock('../../src/services/featureFlagService', () => ({
  isEnabled: jest.fn()
}));

const featureFlagService = require('../../src/services/featureFlagService');
const agentRouterService = require('../../src/services/agentic/agentRouterService');

describe('agentRouterService', () => {
  const baseUser = { id: 'user-1' };

  beforeEach(() => {
    jest.clearAllMocks();
    featureFlagService.isEnabled.mockImplementation(async (flag) => {
      if (flag === 'agentic_shadow_mode') return false;
      if (flag === 'agentic_router_enabled') return true;
      return false;
    });
    agentRouterService.clearLog();
  });

  it('roteia agentic para consultar_saldo (nome alinhado ao prompt)', async () => {
    const d = await agentRouterService.decide({
      message: 'quanto tenho de saldo?',
      intent: { intencao: 'consultar_saldo', confidence: 0.95 },
      user: baseUser,
      phone: '5511999999999',
      context: {}
    });
    expect(d.route).toBe('agentic');
    expect(d.reason).toBe('agentic_capable_intent');
  });

  it('normaliza confidence_score no objeto de decisão', async () => {
    const d = await agentRouterService.decide({
      message: 'meu histórico',
      intent: { intencao: 'consultar_historico', confidence_score: 0.95 },
      user: baseUser,
      phone: '5511999999999',
      context: {}
    });
    expect(d.route).toBe('agentic');
    expect(d.factors).toBeDefined();
  });

  it('roteia agentic quando confiança baixa (<0.6) para intenção fora do conjunto capaz', async () => {
    const d = await agentRouterService.decide({
      message: 'algo confuso xyz',
      intent: { intencao: 'intencao_desconhecida', confidence_score: 0.55 },
      user: baseUser,
      phone: '5511999999999',
      context: {}
    });
    expect(d.route).toBe('agentic');
    expect(d.reason).toBe('low_confidence_intent');
  });

  it('mantém determinístico para ajuda', async () => {
    const d = await agentRouterService.decide({
      message: 'ajuda',
      intent: { intencao: 'ajuda', confidence: 0.99 },
      user: baseUser,
      phone: '5511999999999',
      context: {}
    });
    expect(d.route).toBe('deterministic');
    expect(d.reason).toBe('deterministic_only_intent');
  });

  it('mantém determinístico para enviar_documento', async () => {
    const d = await agentRouterService.decide({
      message: 'segue a nota',
      intent: { intencao: 'enviar_documento', confidence: 0.9 },
      user: baseUser,
      phone: '5511999999999',
      context: {}
    });
    expect(d.route).toBe('deterministic');
    expect(d.reason).toBe('deterministic_only_intent');
  });

  it('prefere agentic para intenção fora das listas (comportamento agente)', async () => {
    const d = await agentRouterService.decide({
      message: 'me explica meu fluxo de caixa dessa semana',
      intent: { intencao: 'pergunta_aberta_xyz', confidence: 0.95 },
      user: baseUser,
      phone: '5511999999999',
      context: {}
    });
    expect(d.route).toBe('agentic');
    expect(d.reason).toBe('default_agentic_preferred');
  });

  it('mantém determinístico para adicionar_numero (fluxo membro)', async () => {
    const d = await agentRouterService.decide({
      message: 'quero adicionar um número',
      intent: { intencao: 'adicionar_numero', confidence: 0.99 },
      user: baseUser,
      phone: '5511999999999',
      context: {}
    });
    expect(d.route).toBe('deterministic');
    expect(d.reason).toBe('deterministic_only_intent');
  });

  it('shadow_mode força deterministic mas preserva shadowDecision', async () => {
    featureFlagService.isEnabled.mockImplementation(async (flag) => {
      if (flag === 'agentic_shadow_mode') return true;
      if (flag === 'agentic_router_enabled') return false;
      return false;
    });

    const d = await agentRouterService.decide({
      message: 'saldo',
      intent: { intencao: 'consultar_saldo', confidence: 0.95 },
      user: baseUser,
      phone: '5511999999999',
      context: {}
    });
    expect(d.route).toBe('deterministic');
    expect(d.shadowDecision?.route).toBe('agentic');
  });
});
