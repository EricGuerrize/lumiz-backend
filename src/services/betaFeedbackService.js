const supabase = require('../db/supabase');
const { normalizePhone } = require('../utils/phone');

class BetaFeedbackService {
  /**
   * Registra um feedback passivo ou explícito.
   * @param {object} params
   * @param {string} params.phone
   * @param {'explicit'|'failed_intent'|'repeated_message'} params.type
   * @param {string} [params.message]
   * @param {string} [params.intent]
   * @param {string} [params.botResponse]
   * @param {object} [params.metadata]
   */
  async capture({ phone, type, message, intent = null, botResponse = null, metadata = {} }) {
    try {
      const normalized = normalizePhone(phone) || phone;

      // Resolve user_id a partir do telefone (sem quebrar se não encontrar)
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('telefone', normalized)
        .maybeSingle();

      await supabase.from('beta_feedback').insert({
        user_id:      profile?.id || null,
        phone:        normalized,
        type,
        message:      message ? String(message).substring(0, 1000) : null,
        intent:       intent || null,
        bot_response: botResponse ? String(botResponse).substring(0, 1000) : null,
        metadata
      });
    } catch (err) {
      // Nunca deixa o feedback quebrar o fluxo principal
      console.warn('[BETA_FEEDBACK] Erro ao salvar:', err.message);
    }
  }

  /**
   * Lista feedbacks para o painel admin.
   * @param {{ limit?: number, offset?: number, type?: string }} options
   */
  async list({ limit = 50, offset = 0, type = null } = {}) {
    let query = supabase
      .from('beta_feedback')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (type) query = query.eq('type', type);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  /**
   * Contagem por tipo para os cards de estatísticas.
   */
  async stats() {
    const { data, error } = await supabase
      .from('beta_feedback')
      .select('type');

    if (error) throw error;

    const counts = { explicit: 0, failed_intent: 0, repeated_message: 0 };
    for (const row of data || []) {
      if (counts[row.type] !== undefined) counts[row.type]++;
    }
    return counts;
  }
}

module.exports = new BetaFeedbackService();
