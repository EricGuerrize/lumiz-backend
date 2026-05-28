/**
 * Fase 17 — Confiabilidade do WhatsApp.
 * Mantem uma janela recente de falhas críticas e espelha eventos em analytics
 * para diagnosticar mensagens que falharam no processamento ou envio.
 */

const analyticsService = require('./analyticsService');

class MessageReliabilityService {
  constructor() {
    this.maxEvents = 100;
    this.failures = [];
  }

  /**
   * Registra uma falha relacionada a mensagem WhatsApp sem expor telefone completo.
   * @param {Object} event
   * @returns {Object}
   */
  recordFailure(event = {}) {
    const payload = {
      kind: event.kind || 'unknown',
      phase: event.phase || 'unknown',
      phoneSuffix: event.phone ? String(event.phone).slice(-4) : null,
      messageId: event.messageId || null,
      messageType: event.messageType || null,
      reason: event.reason ? String(event.reason).slice(0, 240) : null,
      queued: Boolean(event.queued),
      attempts: Number.isFinite(Number(event.attempts)) ? Number(event.attempts) : null,
      createdAt: new Date().toISOString()
    };

    this.failures.unshift(payload);
    if (this.failures.length > this.maxEvents) {
      this.failures.length = this.maxEvents;
    }

    console.warn(
      `[WA_RELIABILITY] kind=${payload.kind} phase=${payload.phase}` +
      ` phone=...${payload.phoneSuffix || '----'} queued=${payload.queued}` +
      ` reason=${payload.reason || '-'}`
    );

    analyticsService
      .track('whatsapp_message_failure', {
        phone: event.phone || null,
        source: 'whatsapp_webhook',
        properties: payload
      })
      .catch(() => {});

    return payload;
  }

  /**
   * Retorna snapshot sem telefone completo para diagnóstico admin.
   * @returns {{summary: Object, recent: Array}}
   */
  snapshot() {
    const byKind = {};
    const byPhase = {};

    for (const failure of this.failures) {
      byKind[failure.kind] = (byKind[failure.kind] || 0) + 1;
      byPhase[failure.phase] = (byPhase[failure.phase] || 0) + 1;
    }

    return {
      summary: {
        totalFailures: this.failures.length,
        queuedFailures: this.failures.filter((failure) => failure.queued).length,
        byKind,
        byPhase
      },
      recent: this.failures.slice(0, 20)
    };
  }
}

module.exports = new MessageReliabilityService();
module.exports.MessageReliabilityService = MessageReliabilityService;
