/**
 * Copy para confirmações quando a IA está em dúvida (low confidence capture).
 * Usado pelo transactionHandler e documentHandler quando confidence_score < 0.8.
 */

const LOW_CONFIDENCE_THRESHOLD = Number(process.env.CAPTURE_LOW_CONFIDENCE_THRESHOLD || 0.8);

/**
 * Decide se a captura precisa de aviso de baixa confiança.
 * Aceita tanto `confidence_score` quanto `confianca` (PT-BR usado pelos prompts atuais).
 * @param {number|undefined} score
 * @returns {boolean}
 */
function isLowConfidence(score) {
  const value = typeof score === 'number' ? score : null;
  if (value === null || Number.isNaN(value)) return false;
  return value < LOW_CONFIDENCE_THRESHOLD;
}

/**
 * Banner curto a inserir no topo da mensagem de confirmação quando a IA está incerta.
 */
function lowConfidenceBanner() {
  return '🤔 *Não tenho 100% de certeza, confere por favor:*';
}

/**
 * Mensagem usada quando a transcrição/extração não conseguiu campos críticos
 * (ex: valor, tipo). Usada antes de pedir reenvio.
 */
function captureMissingCriticalField(field = null) {
  const fieldText = field ? ` (${field})` : '';
  return `Não consegui identificar tudo${fieldText} 🤔\n\nMe manda assim: "Botox R$ 2800" ou "Insumos R$ 3200".`;
}

module.exports = {
  LOW_CONFIDENCE_THRESHOLD,
  isLowConfidence,
  lowConfidenceBanner,
  captureMissingCriticalField
};
