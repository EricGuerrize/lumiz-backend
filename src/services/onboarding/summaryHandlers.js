/**
 * Handlers para a fase de resumo e handoff do onboarding
 * Etapas: AHA_SUMMARY, HANDOFF_TO_DAILY_USE
 */

const onboardingCopy = require('../../copy/onboardingWhatsappCopy');
const analyticsService = require('../analyticsService');
const userController = require('../../controllers/userController');
const { isYes, isNo } = require('./profileHandlers');

/**
 * Handlers da fase de resumo
 */
const summaryHandlers = {
  /**
   * Handler: AHA_SUMMARY
   * Mostra resumo do onboarding
   */
  async handleAhaSummary(onboarding, normalizedPhone, respond) {
    onboarding.step = 'HANDOFF_TO_DAILY_USE';
    
    const resumo = await userController.buildResumoFinal(onboarding.data);
    
    await analyticsService.track('onboarding_summary_shown', {
      phone: normalizedPhone,
      source: 'whatsapp',
      properties: {
        total_vendas: onboarding.data.primeiraVenda ? 1 : 0,
        total_custos: onboarding.data.custos?.length || 0
      }
    });

    return await respond(resumo + '\n\n' + onboardingCopy.handoffToDailyUse());
  },

  /**
   * Handler: HANDOFF_TO_DAILY_USE
   * Transição para uso diário
   */
  async handleHandoffToDailyUse(onboarding, messageTrimmed, respond, respondAndClear) {
    return await respondAndClear(onboardingCopy.handoffToDailyUse());
  }
};

module.exports = { summaryHandlers };
