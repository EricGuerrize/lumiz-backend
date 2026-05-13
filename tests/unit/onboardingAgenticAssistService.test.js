/**
 * Assistência LLM opcional no onboarding (flag `agentic_onboarding_enabled`).
 */

jest.mock('../../src/services/featureFlagService', () => ({
  isEnabled: jest.fn()
}));

jest.mock('../../src/services/geminiService', () => ({
  extractOnboardingSaleJson: jest.fn()
}));

const featureFlagService = require('../../src/services/featureFlagService');
const geminiService = require('../../src/services/geminiService');
const onboardingAgenticAssistService = require('../../src/services/onboardingAgenticAssistService');

describe('onboardingAgenticAssistService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('não chama Gemini quando a flag está desligada', async () => {
    featureFlagService.isEnabled.mockResolvedValue(false);
    const r = await onboardingAgenticAssistService.enrichSaleFromFreeText(
      { data: { userId: 'u1' } },
      'fiz um botox por 800'
    );
    expect(r).toBeNull();
    expect(geminiService.extractOnboardingSaleJson).not.toHaveBeenCalled();
  });

  it('delega ao Gemini quando a flag está ligada', async () => {
    featureFlagService.isEnabled.mockImplementation((flag) =>
      Promise.resolve(flag === 'agentic_onboarding_enabled')
    );
    geminiService.extractOnboardingSaleJson.mockResolvedValue({
      valor: 800,
      categoria: 'Botox',
      cliente: 'Maria'
    });

    const r = await onboardingAgenticAssistService.enrichSaleFromFreeText(
      { data: { userId: 'u1' } },
      'fiz um botox por 800'
    );

    expect(geminiService.extractOnboardingSaleJson).toHaveBeenCalledWith('fiz um botox por 800');
    expect(r).toEqual({ valor: 800, categoria: 'Botox', cliente: 'Maria' });
  });
});
