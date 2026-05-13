/**
 * NPS conversacional (cap. 13.4) — captura mensagens tipo "nps: 9" ou "nps 10 adorei".
 */

const supabase = require('../db/supabase');
const analyticsService = require('./analyticsService');

const NPS_LINE = /^\s*nps\s*[:\-]?\s*(\d{1,2})\b(.*)$/i;

/**
 * @param {object} params
 * @param {string|null} params.userId
 * @param {string} params.phone
 * @param {string} params.message
 * @returns {Promise<string|null>} resposta WhatsApp ou null se não for NPS
 */
async function tryConsumeNpsMessage({ userId, phone, message }) {
  const raw = String(message || '').trim();
  const m = raw.match(NPS_LINE);
  if (!m) return null;

  const score = parseInt(m[1], 10);
  if (!Number.isFinite(score) || score < 0 || score > 10) {
    return null;
  }

  const comment = String(m[2] || '').trim() || null;

  try {
    const { error } = await supabase.from('conversational_nps_responses').insert([
      {
        user_id: userId || null,
        phone,
        score,
        comment,
        raw_message: raw,
        source: 'whatsapp'
      }
    ]);

    if (error && error.code !== '42P01') {
      console.warn('[NPS] Falha ao persistir:', error.message);
    }
  } catch (e) {
    console.warn('[NPS]', e?.message || e);
  }

  await analyticsService.track('conversational_nps_submitted', {
    phone,
    userId: userId || null,
    source: 'whatsapp',
    properties: { score, has_comment: Boolean(comment) }
  });

  return `Obrigada pelo NPS *${score}/10*! ${comment ? 'Anotamos seu comentário.' : ''} Isso ajuda muito a melhorar a Lumiz.`;
}

module.exports = {
  tryConsumeNpsMessage,
  NPS_LINE
};
