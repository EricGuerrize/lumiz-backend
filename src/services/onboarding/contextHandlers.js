/**
 * Handlers para a fase de contexto do onboarding
 * Etapas: CONTEXT_WHY, CONTEXT_HOW
 */

const onboardingCopy = require('../../copy/onboardingWhatsappCopy');
const analyticsService = require('../analyticsService');

/**
 * Handlers da fase de contexto
 */
const contextHandlers = {
  /**
   * Handler: CONTEXT_WHY
   * Coleta a motivação do usuário
   */
  async handleContextWhy(onboarding, messageTrimmed, respond) {
    const motiveMap = {
      '1': 'Quero saber quanto entra e sai',
      '2': 'Preciso pagar menos imposto',
      '3': 'Quero parar de usar planilhas'
    };
    onboarding.data.motivo = motiveMap[messageTrimmed] || messageTrimmed;
    onboarding.step = 'CONTEXT_HOW';
    return await respond(onboardingCopy.howQuestion(), true);
  },

  /**
   * Handler: CONTEXT_HOW
   * Coleta como o usuário controla as finanças atualmente
   */
  async handleContextHow(onboarding, messageTrimmed, normalizedPhone, respond) {
    const howMap = {
      '1': 'Planilha',
      '2': 'Contador',
      '3': 'Não controlo'
    };
    onboarding.data.como_controla = howMap[messageTrimmed] || messageTrimmed;
    onboarding.step = 'AHA_REVENUE';
    
    await analyticsService.track('onboarding_profile_completed', {
      phone: normalizedPhone,
      source: 'whatsapp',
      properties: {
        nome: onboarding.data.nome,
        clinica: onboarding.data.clinica,
        cargo: onboarding.data.cargo,
        motivo: onboarding.data.motivo,
        como_controla: onboarding.data.como_controla
      }
    });

    const nomeUsuario = onboarding.data.nome || 'você';
    return await respond(onboardingCopy.ahaRevenueIntro(nomeUsuario), true);
  }
};

module.exports = { contextHandlers };
