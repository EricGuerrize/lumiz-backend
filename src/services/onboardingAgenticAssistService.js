/**
 * Assistência LLM opcional no onboarding (flag `agentic_onboarding_enabled`).
 * Híbrido: fluxo por atos permanece; enriquece extração em texto livre na primeira venda.
 */

const featureFlagService = require('./featureFlagService');
const geminiService = require('./geminiService');

/**
 * @param {string|null|undefined} userId
 * @returns {Promise<boolean>}
 */
async function isAssistEnabled(userId) {
  if (userId) {
    const u = await featureFlagService.isEnabled('agentic_onboarding_enabled', userId);
    if (u) return true;
  }
  return featureFlagService.isEnabled('agentic_onboarding_enabled', null);
}

/**
 * @param {object} onboarding
 * @param {string} messageTrimmed
 * @returns {Promise<{ valor: number, categoria: string, cliente: string|null }|null>}
 */
async function enrichSaleFromFreeText(onboarding, messageTrimmed) {
  const uid = onboarding?.data?.userId || null;
  if (!(await isAssistEnabled(uid))) return null;
  try {
    return await geminiService.extractOnboardingSaleJson(messageTrimmed);
  } catch (e) {
    console.warn('[ONBOARDING_AGENTIC_ASSIST]', e?.message || e);
    return null;
  }
}

module.exports = {
  isAssistEnabled,
  enrichSaleFromFreeText
};
