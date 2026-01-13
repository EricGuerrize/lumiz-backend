/**
 * Handlers para a fase de perfil do onboarding
 * Etapas: START, CONSENT, PROFILE_NAME, PROFILE_CLINIC, PROFILE_ROLE
 */

const onboardingCopy = require('../../copy/onboardingWhatsappCopy');
const analyticsService = require('../analyticsService');

// Constantes
const MIN_NAME_LENGTH = 2;
const MIN_CLINIC_NAME_LENGTH = 2;

/**
 * Funções utilitárias
 */
function normalizeText(value = '') {
  return String(value).trim().toLowerCase();
}

function isYes(value = '') {
  const v = normalizeText(value);
  const result = v === '1' || v === 'sim' || v === 's' || v === 'ok' || v === 'confirmar' || 
         v.includes('pode registrar') || v.includes('tá ok') || v.includes('ta ok') || 
         v.includes('confere') || v.includes('autorizo') || v.includes('autorizar');
  return result;
}

function isNo(value = '') {
  const v = normalizeText(value);
  return v === '2' || v === 'nao' || v === 'não' || v === 'n' || v === 'cancelar' || 
         v.includes('corrigir') || v.includes('ajustar') || v.includes('editar');
}

/**
 * Handlers da fase de perfil
 */
const profileHandlers = {
  /**
   * Handler: START
   * Primeiro contato após mensagem inicial
   */
  async handleStart(onboarding, messageTrimmed, normalizedPhone, respond) {
    onboarding.step = 'CONSENT';
    await analyticsService.track('onboarding_started', {
      phone: normalizedPhone,
      source: 'whatsapp'
    });
    return await respond(onboardingCopy.consentRequest(), true);
  },

  /**
   * Handler: CONSENT
   * Solicita autorização do usuário
   */
  async handleConsent(onboarding, messageTrimmed, normalizedPhone, respond) {
    const choseAuthorize = isYes(messageTrimmed);
    const choseDeny = isNo(messageTrimmed);

    if (choseDeny) {
      return await respond(onboardingCopy.consentDenied());
    }

    if (choseAuthorize) {
      onboarding.step = 'PROFILE_NAME';
      await analyticsService.track('onboarding_consent_given', {
        phone: normalizedPhone,
        source: 'whatsapp'
      });
      const questionText = onboardingCopy.profileNameQuestion();
      return await respond(questionText, true);
    }

    return await respond(onboardingCopy.invalidChoice());
  },

  /**
   * Handler: PROFILE_NAME
   * Coleta o nome do profissional
   */
  async handleProfileName(onboarding, messageTrimmed, respond) {
    if (messageTrimmed.length < MIN_NAME_LENGTH) {
      return await respond(onboardingCopy.nameTooShort());
    }
    
    // Valida que tem pelo menos uma letra (não só números ou símbolos)
    if (!/[a-zA-ZÀ-ÿ]/.test(messageTrimmed)) {
      return await respond(onboardingCopy.invalidName());
    }
    
    // Valida comprimento máximo
    if (messageTrimmed.length > 100) {
      return await respond('Nome muito longo. Por favor, use até 100 caracteres.');
    }
    
    onboarding.data.nome = messageTrimmed;
    onboarding.step = 'PROFILE_CLINIC';
    return await respond(onboardingCopy.clinicNameQuestion(), true);
  },

  /**
   * Handler: PROFILE_CLINIC
   * Coleta o nome da clínica
   */
  async handleProfileClinic(onboarding, messageTrimmed, respond) {
    if (messageTrimmed.length < MIN_CLINIC_NAME_LENGTH) {
      return await respond(onboardingCopy.clinicNameTooShort());
    }
    
    // Valida comprimento máximo
    if (messageTrimmed.length > 150) {
      return await respond('Nome da clínica muito longo. Por favor, use até 150 caracteres.');
    }
    
    onboarding.data.clinica = messageTrimmed;
    onboarding.step = 'PROFILE_ROLE';
    return await respond(onboardingCopy.roleQuestion(), true);
  },

  /**
   * Handler: PROFILE_ROLE
   * Coleta o cargo do profissional
   */
  async handleProfileRole(onboarding, messageTrimmed, respond) {
    const roleMap = {
      '1': 'Dentista',
      '2': 'Esteticista',
      '3': 'Gestor'
    };
    const role = roleMap[messageTrimmed] || messageTrimmed;
    
    // Valida que é um cargo válido
    if (!['1', '2', '3'].includes(messageTrimmed) && messageTrimmed.length < 2) {
      return await respond(onboardingCopy.invalidRole());
    }
    
    onboarding.data.cargo = role;
    onboarding.step = 'CONTEXT_WHY';
    return await respond(onboardingCopy.whyQuestion(), true);
  }
};

module.exports = {
  profileHandlers,
  isYes,
  isNo,
  normalizeText,
  MIN_NAME_LENGTH,
  MIN_CLINIC_NAME_LENGTH
};
