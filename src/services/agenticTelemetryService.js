/**
 * Telemetria do fluxo agentic (cap. 13 lumizchatbotdesign.md).
 * Centraliza nomes de eventos e garante que falhas de analytics nunca quebrem o bot.
 */

const analyticsService = require('./analyticsService');

/**
 * @param {string} eventName
 * @param {{ phone?: string|null, userId?: string|null, properties?: object }} payload
 */
function safeAgenticTrack(eventName, { phone = null, userId = null, properties = {} } = {}) {
  if (!eventName) return;
  return analyticsService
    .track(eventName, {
      phone: phone || null,
      userId: userId || null,
      source: 'whatsapp',
      properties: typeof properties === 'object' && properties ? properties : {}
    })
    .catch(() => {});
}

module.exports = {
  safeAgenticTrack
};
