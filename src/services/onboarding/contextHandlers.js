/**
 * Handlers para a fase de contexto do onboarding
 * Etapas: CONTEXT_WHY, CONTEXT_HOW
 */

const onboardingCopy = require('../../copy/onboardingWhatsappCopy');
const analyticsService = require('../analyticsService');

function normalizeCtxText(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Aceita 1/2/3, combinações ("1 e 2", "1,2,3"), "todos", "tudo", "os 3".
 * @param {string} messageTrimmed
 * @param {Record<string, string>} map
 * @returns {string|null} texto agregado ou null para usar fallback raw
 */
function resolveMultiChoiceMotivation(messageTrimmed, map) {
  const t = normalizeCtxText(messageTrimmed);
  if (!t) return null;

  const allLabels = [map['1'], map['2'], map['3']].filter(Boolean);
  const isAll =
    t === 'todos' ||
    t === 'tudo' ||
    t === 'os3' ||
    t === 'os 3' ||
    t === '123' ||
    t === '1 2 3' ||
    t === '1,2,3' ||
    /\b(todos|todas)\s+(os|as)?\s*(3|tres|três)\b/.test(t) ||
    /^[123][,\s+e]+[23][,\s+e]+3$/.test(t.replace(/\s+/g, ''));

  if (isAll) {
    return allLabels.join(' | ');
  }

  const digitTokens = t.match(/\b[1-3]\b/g) || [];
  const uniq = [...new Set(digitTokens)];
  if (uniq.length > 1) {
    return uniq.map((d) => map[d]).filter(Boolean).join(' | ');
  }

  return map[messageTrimmed] || map[t] || null;
}

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
    const resolved = resolveMultiChoiceMotivation(messageTrimmed, motiveMap);
    onboarding.data.motivo = resolved || messageTrimmed;
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
    const resolved = resolveMultiChoiceMotivation(messageTrimmed, howMap);
    onboarding.data.como_controla = resolved || messageTrimmed;
    onboarding.step = 'AHA_REVENUE';

    await analyticsService.track('onboarding_act_entered', {
      phone: normalizedPhone,
      source: 'whatsapp',
      properties: { act: '2', step: 'AHA_REVENUE' }
    }).catch(() => {});
    
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

module.exports = { contextHandlers, resolveMultiChoiceMotivation };
