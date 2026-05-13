/**
 * Garante que FEATURE_FLAGS JSON liga o rollout agentic global quando não há linhas no DB.
 */
jest.mock('../../src/db/supabase', () => ({
  from: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null })
  }))
}));

const featureFlagService = require('../../src/services/featureFlagService');

describe('featureFlagService — FEATURE_FLAGS agentic global', () => {
  const origFlags = process.env.FEATURE_FLAGS;

  afterEach(() => {
    if (origFlags === undefined) {
      delete process.env.FEATURE_FLAGS;
    } else {
      process.env.FEATURE_FLAGS = origFlags;
    }
    featureFlagService.resetCache();
  });

  it('habilita router + tools e desliga shadow a partir do JSON', async () => {
    process.env.FEATURE_FLAGS = JSON.stringify({
      agentic_router_enabled: true,
      agentic_tools_enabled: true,
      agentic_shadow_mode: false
    });
    featureFlagService.resetCache();

    await expect(
      featureFlagService.isEnabled('agentic_tools_enabled', '11111111-1111-1111-1111-111111111111')
    ).resolves.toBe(true);
    await expect(
      featureFlagService.isEnabled('agentic_router_enabled', '11111111-1111-1111-1111-111111111111')
    ).resolves.toBe(true);
    await expect(
      featureFlagService.isEnabled('agentic_shadow_mode', '11111111-1111-1111-1111-111111111111')
    ).resolves.toBe(false);
  });
});
