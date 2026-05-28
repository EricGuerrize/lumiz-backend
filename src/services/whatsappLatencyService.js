/**
 * Fase 17 — Observabilidade do WhatsApp.
 * Mantem uma janela pequena de latencias recentes para diagnosticar atrasos
 * entre webhook, processamento do bot e envio pela Evolution API.
 */
class WhatsappLatencyService {
  constructor() {
    this.maxEvents = 100;
    this.events = [];
    this.thresholds = {
      processingMs: Number(process.env.WHATSAPP_PROCESSING_WARN_MS || 5000),
      sendMs: Number(process.env.WHATSAPP_SEND_WARN_MS || 3000),
      totalMs: Number(process.env.WHATSAPP_TOTAL_WARN_MS || 7000)
    };
  }

  /**
   * Registra uma medicao completa de uma mensagem recebida via webhook.
   * @param {Object} event
   * @returns {Object}
   */
  record(event) {
    const payload = {
      messageId: event.messageId || null,
      phoneSuffix: event.phone ? String(event.phone).slice(-4) : null,
      event: event.event || null,
      messageType: event.messageType || 'text',
      webhookAckMs: this._num(event.webhookAckMs),
      processingMs: this._num(event.processingMs),
      sendMs: this._num(event.sendMs),
      totalMs: this._num(event.totalMs),
      responseChars: this._num(event.responseChars),
      status: event.status || 'ok',
      error: event.error ? String(event.error).slice(0, 240) : null,
      createdAt: new Date().toISOString()
    };

    this.events.unshift(payload);
    if (this.events.length > this.maxEvents) {
      this.events.length = this.maxEvents;
    }

    this._log(payload);
    return payload;
  }

  /**
   * Retorna snapshot para diagnostico admin sem expor telefone completo.
   * @returns {{thresholds: Object, summary: Object, recent: Array}}
   */
  snapshot() {
    const okEvents = this.events.filter((event) => event.status === 'ok');
    const avg = (field) => {
      const values = okEvents
        .map((event) => event[field])
        .filter((value) => Number.isFinite(value));
      if (!values.length) return null;
      return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
    };

    return {
      thresholds: this.thresholds,
      summary: {
        totalEvents: this.events.length,
        okEvents: okEvents.length,
        errorEvents: this.events.length - okEvents.length,
        avgProcessingMs: avg('processingMs'),
        avgSendMs: avg('sendMs'),
        avgTotalMs: avg('totalMs')
      },
      recent: this.events.slice(0, 20)
    };
  }

  _num(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : null;
  }

  _log(event) {
    const line =
      `[WA_LATENCY] phone=...${event.phoneSuffix || '----'} type=${event.messageType}` +
      ` status=${event.status} ack_ms=${event.webhookAckMs ?? '-'}` +
      ` processing_ms=${event.processingMs ?? '-'} send_ms=${event.sendMs ?? '-'}` +
      ` total_ms=${event.totalMs ?? '-'} chars=${event.responseChars ?? 0}`;

    const slow =
      (event.processingMs || 0) > this.thresholds.processingMs ||
      (event.sendMs || 0) > this.thresholds.sendMs ||
      (event.totalMs || 0) > this.thresholds.totalMs;

    if (event.status !== 'ok' || slow) {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
}

module.exports = new WhatsappLatencyService();
