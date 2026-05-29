/**
 * Fase WhatsApp produção — controla a confirmação explícita de modo real.
 * Responsabilidade: impedir que o primeiro lançamento pós-onboarding seja salvo
 * sem o usuário aceitar que as próximas mensagens podem virar dados financeiros reais.
 */
const supabase = require('../db/supabase');
const cacheService = require('./cacheService');
const conversationRuntimeStateService = require('./conversationRuntimeStateService');
const { normalizePhone } = require('../utils/phone');

const FLOW = 'real_mode_confirm';
const CONFIRMED_FLOW = 'real_mode_confirmed';
const TTL_MS = 30 * 60 * 1000;
const CONFIRMED_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000;

class RealModeService {
  /**
   * @param {object|null} user
   * @param {string} [phone]
   * @returns {Promise<boolean>}
   */
  async needsConfirmation(user, phone = null) {
    if (!user?.id) return false;
    if (!Object.prototype.hasOwnProperty.call(user, 'whatsapp_real_mode_confirmed_at')) {
      if (process.env.NODE_ENV === 'test') return false;
      const confirmed = await conversationRuntimeStateService.get(phone, CONFIRMED_FLOW);
      return !confirmed?.payload?.confirmed_at;
    }
    return !user.whatsapp_real_mode_confirmed_at;
  }

  /**
   * @param {string} phone
   * @param {{ intent: object, message: string }} payload
   * @returns {Promise<boolean>}
   */
  async setPending(phone, payload) {
    return conversationRuntimeStateService.upsert(phone, FLOW, payload, TTL_MS);
  }

  /**
   * @param {string} phone
   * @returns {Promise<object|null>}
   */
  async getPending(phone) {
    const row = await conversationRuntimeStateService.get(phone, FLOW);
    return row?.payload || null;
  }

  /**
   * @param {string} phone
   * @returns {Promise<boolean>}
   */
  async clearPending(phone) {
    return conversationRuntimeStateService.clear(phone, FLOW);
  }

  /**
   * @param {object} user
   * @param {string} phone
   * @returns {Promise<string>} ISO timestamp persisted in profiles.
   */
  async confirm(user, phone) {
    if (!user?.id) throw new Error('Usuário ausente para confirmar modo real');

    const confirmedAt = new Date().toISOString();
    const { error } = await supabase
      .from('profiles')
      .update({ whatsapp_real_mode_confirmed_at: confirmedAt })
      .eq('id', user.id);

    if (error && !this.isMissingRealModeColumnError(error)) throw error;

    await conversationRuntimeStateService.upsert(
      phone,
      CONFIRMED_FLOW,
      { confirmed_at: confirmedAt, user_id: user.id },
      CONFIRMED_TTL_MS
    );

    user.whatsapp_real_mode_confirmed_at = confirmedAt;
    await cacheService.invalidateUser(user.id).catch(() => {});
    await cacheService.invalidatePhone(normalizePhone(phone) || phone).catch(() => {});
    return confirmedAt;
  }

  /**
   * @param {object} error
   * @returns {boolean}
   */
  isMissingRealModeColumnError(error) {
    const message = String(error?.message || error?.details || '');
    return error?.code === 'PGRST204' || message.includes('whatsapp_real_mode_confirmed_at');
  }

  /**
   * @param {string} message
   * @returns {'yes'|'no'|null}
   */
  parseConfirmation(message) {
    const normalized = String(message || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    if (['sim', 's', 'ok', 'confirmo', 'confirmar', 'pode', 'pode salvar', 'modo real', 'ativar modo real', '1'].includes(normalized)) {
      return 'yes';
    }
    if (['nao', 'n', 'cancelar', 'cancela', 'deixa', '2'].includes(normalized)) {
      return 'no';
    }
    return null;
  }

  /**
   * @returns {string}
   */
  buildPrompt() {
    return (
      `Antes de salvar lançamentos reais, preciso da sua confirmação.\n\n` +
      `A partir de agora, mensagens como “Botox R$ 1200 pix” ou “Luvas R$ 600” podem entrar no financeiro real da clínica.\n\n` +
      `Responda *sim* para ativar o modo real ou *não* para cancelar esse lançamento.`
    );
  }
}

module.exports = new RealModeService();
module.exports.RealModeService = RealModeService;
module.exports.REAL_MODE_FLOW = FLOW;
