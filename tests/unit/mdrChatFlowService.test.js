jest.mock('../../src/services/mdrService', () => ({
  getLatestConfig: jest.fn(),
  saveManualConfig: jest.fn(),
  confirmConfig: jest.fn(),
  requestOcr: jest.fn()
}));

jest.mock('../../src/services/onboardingService', () => ({
  savePhaseData: jest.fn()
}));

const mdrService = require('../../src/services/mdrService');
const mdrChatFlowService = require('../../src/services/mdrChatFlowService');

describe('mdrChatFlowService - roteamento contextual', () => {
  beforeEach(() => {
    mdrChatFlowService.states.clear();
    jest.clearAllMocks();
  });

  it('nao deve capturar "sim" fora de contexto MDR ativo', async () => {
    const response = await mdrChatFlowService.handleMessageIfNeeded({
      phone: '5565999999999',
      user: { id: 'user-1' },
      message: 'sim'
    });

    expect(response).toBeNull();
    expect(mdrService.getLatestConfig).not.toHaveBeenCalled();
  });

  it('deve tratar "revisar taxas" como follow-up explicito de MDR', async () => {
    mdrService.getLatestConfig.mockResolvedValue(null);

    await mdrChatFlowService.handleMessageIfNeeded({
      phone: '5565999999999',
      user: { id: 'user-1' },
      message: 'revisar taxas'
    });

    expect(mdrService.getLatestConfig).toHaveBeenCalledTimes(1);
  });
});
