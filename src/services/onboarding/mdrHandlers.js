/**
 * Handlers para a fase de configuração de MDR do onboarding
 * Etapas: MDR_SETUP_INTRO, MDR_SETUP_QUESTION, MDR_SETUP_UPLOAD, MDR_SETUP_COMPLETE
 */

const onboardingCopy = require('../../copy/onboardingWhatsappCopy');
const analyticsService = require('../analyticsService');
const mdrOcrService = require('../mdrOcrService');
const mdrService = require('../mdrService');
const { isYes, isNo } = require('./profileHandlers');

/**
 * Handlers da fase de MDR
 */
const mdrHandlers = {
  /**
   * Handler: MDR_SETUP_INTRO
   * Introdução à configuração de MDR
   */
  async handleMdrSetupIntro(onboarding, messageTrimmed, respond, respondAndClear) {
    const normalized = messageTrimmed.toLowerCase();
    
    if (normalized.includes('sim') || normalized === '1' || normalized === 's') {
      onboarding.step = 'MDR_SETUP_QUESTION';
      return await respond(onboardingCopy.mdrSetupQuestion());
    }
    
    if (normalized.includes('não') || normalized.includes('nao') || normalized === '2' || normalized === 'n') {
      return await respondAndClear(onboardingCopy.onboardingComplete());
    }
    
    return await respond(onboardingCopy.invalidChoice());
  },

  /**
   * Handler: MDR_SETUP_QUESTION
   * Pergunta sobre o tipo de maquininha
   */
  async handleMdrSetupQuestion(onboarding, messageTrimmed, respond) {
    onboarding.data.mdrProvider = messageTrimmed;
    onboarding.step = 'MDR_SETUP_UPLOAD';
    return await respond(onboardingCopy.mdrUploadRequest());
  },

  /**
   * Handler: MDR_SETUP_UPLOAD
   * Processa upload de print de taxas
   */
  async handleMdrSetupUpload(onboarding, mediaUrl, respond) {
    if (!mediaUrl) {
      return await respond(onboardingCopy.mdrUploadMissing());
    }

    try {
      const rates = await mdrOcrService.extractRates({
        imageUrl: mediaUrl,
        provider: onboarding.data.mdrProvider
      });

      if (rates && rates.provider) {
        // Salva as taxas
        const userId = onboarding.data.userId;
        if (userId) {
          await mdrService.saveRates(userId, rates);
        }

        onboarding.data.mdrRates = rates;
        onboarding.step = 'MDR_SETUP_COMPLETE';
        return await respond(onboardingCopy.mdrExtracted(rates));
      } else {
        return await respond(onboardingCopy.mdrExtractionFailed());
      }
    } catch (error) {
      console.error('[ONBOARDING] Erro ao extrair MDR:', error);
      return await respond(onboardingCopy.mdrExtractionFailed());
    }
  },

  /**
   * Handler: MDR_SETUP_COMPLETE
   * Finaliza configuração de MDR
   */
  async handleMdrSetupComplete(respond, respondAndClear) {
    return await respondAndClear(onboardingCopy.onboardingComplete());
  }
};

module.exports = { mdrHandlers };
