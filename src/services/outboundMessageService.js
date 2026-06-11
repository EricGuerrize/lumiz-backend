/**
 * Fase 17 — Envio resiliente de mensagens WhatsApp.
 * Encapsula o envio oficial pela Meta Cloud API e, quando Redis/BullMQ está
 * disponível, agenda reenvio de mensagens que falharam por instabilidade
 * temporária. A Evolution permanece apenas como fallback legado explicitamente
 * habilitado por EVOLUTION_FALLBACK_ENABLED=true.
 */

const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const evolutionService = require('./evolutionService');
const metaWhatsappService = require('./metaWhatsappService');
const messageReliabilityService = require('./messageReliabilityService');

const OUTBOUND_QUEUE_NAME = 'whatsapp-outbound';

class OutboundMessageService {
  constructor({
    evolution = evolutionService,
    meta = metaWhatsappService,
    reliability = messageReliabilityService,
    redisUrl = process.env.REDIS_URL,
    queueEnabled = readFlag('WHATSAPP_OUTBOUND_QUEUE_ENABLED', !!process.env.REDIS_URL),
    workerEnabled = readFlag('WHATSAPP_OUTBOUND_WORKER_ENABLED', true),
    evolutionFallbackEnabled = readFlag('EVOLUTION_FALLBACK_ENABLED', false)
  } = {}) {
    this.evolution = evolution;
    this.meta = meta;
    this.reliability = reliability;
    this.evolutionFallbackEnabled = Boolean(evolutionFallbackEnabled);
    this.redisUrl = redisUrl;
    this.queueEnabled = false;
    this.queue = null;
    this.worker = null;
    this.connection = null;
    this.maxReconnectAttempts = Number(process.env.REDIS_MAX_RECONNECT_ATTEMPTS || 5);
    this._lastErrorLogAt = 0;

    if (!queueEnabled || !redisUrl) {
      console.warn('[WA_OUTBOUND] Fila de reenvio desabilitada.');
      return;
    }

    try {
      this.connection = new IORedis(redisUrl, {
        maxRetriesPerRequest: null,
        connectTimeout: 5000,
        enableOfflineQueue: false,
        retryStrategy: (times) => {
          if (times > this.maxReconnectAttempts) {
            this.queueEnabled = false;
            this._logRedisError('[WA_OUTBOUND] Limite de reconexão Redis atingido. Fila desativada.');
            return null;
          }
          return Math.min(times * 100, 3000);
        }
      });

      this.connection.on('ready', () => {
        this.queueEnabled = true;
        console.log('[WA_OUTBOUND] Redis pronto para reenvio WhatsApp');
      });
      this.connection.on('error', (err) => {
        this.queueEnabled = false;
        this._logRedisError(`[WA_OUTBOUND] Erro Redis: ${err.message}`);
      });
      this.connection.on('close', () => {
        this.queueEnabled = false;
        this._logRedisError('[WA_OUTBOUND] Conexão Redis fechada. Reenvio em modo degradado.');
      });

      this.queue = new Queue(OUTBOUND_QUEUE_NAME, { connection: this.connection });
      this.queue.on('error', (err) => {
        this.queueEnabled = false;
        this._logRedisError(`[WA_OUTBOUND] Queue error: ${err.message}`);
      });

      if (workerEnabled) {
        this.worker = new Worker(
          OUTBOUND_QUEUE_NAME,
          async (job) => this._processRetryJob(job),
          { connection: this.connection, concurrency: 2 }
        );

        this.worker.on('completed', (job) => {
          console.log(`[WA_OUTBOUND] Reenvio concluído job=${job.id}`);
        });
        this.worker.on('failed', (job, err) => {
          this.reliability.recordFailure({
            kind: 'outbound_retry_failed',
            phase: 'send',
            phone: job?.data?.phone,
            messageId: job?.data?.messageId,
            reason: err?.message || 'retry_failed',
            queued: false,
            attempts: job?.attemptsMade || null
          });
        });
        this.worker.on('error', (err) => {
          this.queueEnabled = false;
          this._logRedisError(`[WA_OUTBOUND] Worker error: ${err.message}`);
        });
      }

      this.queueEnabled = true;
      console.log('[WA_OUTBOUND] Fila de reenvio WhatsApp iniciada');
    } catch (error) {
      this.queueEnabled = false;
      console.error('[WA_OUTBOUND] Falha ao iniciar fila:', error.message);
    }
  }

  /**
   * Envia texto para WhatsApp e agenda reenvio se o provedor falhar.
   * @param {string} phone
   * @param {string} message
   * @param {Object} metadata
   * @returns {Promise<{status: 'sent'|'queued'|'failed', queued?: boolean, error?: string}>}
   */
  async sendText(phone, message, metadata = {}) {
    try {
      const result = await this._sendTextViaPreferredProvider(phone, message, metadata);
      return { status: 'sent', result, provider: result?.provider || null };
    } catch (error) {
      const queued = await this.enqueueText(phone, message, metadata, error);
      this.reliability.recordFailure({
        kind: queued ? 'outbound_send_queued' : 'outbound_send_failed',
        phase: 'send',
        phone,
        messageId: metadata.messageId,
        messageType: metadata.messageType || 'text',
        reason: error?.message || 'send_failed',
        queued
      });

      if (queued) {
        return { status: 'queued', queued: true, error: error?.message || 'send_failed' };
      }

      throw error;
    }
  }

  /**
   * Envia documento para WhatsApp pelo provedor preferencial.
   * @param {string} phone
   * @param {Buffer} buffer
   * @param {string} fileName
   * @param {string} mimeType
   * @param {Object} metadata
   * @returns {Promise<{status: 'sent'|'failed', provider?: string, error?: string}>}
   */
  async sendDocument(phone, buffer, fileName, mimeType = 'application/pdf', metadata = {}) {
    try {
      const result = await this._sendDocumentViaPreferredProvider(phone, buffer, fileName, mimeType, metadata);
      return { status: 'sent', result, provider: result?.provider || null };
    } catch (error) {
      this.reliability.recordFailure({
        kind: 'outbound_send_failed',
        phase: 'send',
        phone,
        messageId: metadata.messageId,
        messageType: metadata.messageType || 'document',
        reason: error?.message || 'document_send_failed',
        queued: false
      });
      throw error;
    }
  }

  /**
   * Envia botões interativos quando possível, com fallback para texto simples.
   * @param {string} phone
   * @param {string} body
   * @param {Array<{id: string, title: string}>} buttons
   * @param {string} fallbackText
   * @param {Object} metadata
   * @returns {Promise<{status: 'sent'|'queued'|'failed', provider?: string, error?: string}>}
   */
  async sendInteractiveButtons(phone, body, buttons = [], fallbackText = body, metadata = {}) {
    const metaAvailable = typeof this.meta?.isOutboundConfigured === 'function'
      ? this.meta.isOutboundConfigured()
      : false;

    if (metaAvailable && typeof this.meta?.sendInteractiveButtons === 'function') {
      try {
        const result = await this.meta.sendInteractiveButtons(phone, body, buttons);
        return { status: 'sent', result, provider: 'meta' };
      } catch (metaError) {
        console.error(`[WA_OUTBOUND] Meta botões falhou, usando fallback texto: ${metaError.message}`);
        this.reliability.recordFailure({
          kind: 'outbound_interactive_failed',
          phase: 'send',
          phone,
          messageId: metadata.messageId,
          messageType: metadata.messageType || 'interactive',
          reason: metaError?.message || 'interactive_send_failed',
          queued: false
        });
      }
    }

    return this.sendText(phone, fallbackText || body, {
      ...metadata,
      messageType: metadata.messageType || 'interactive_fallback'
    });
  }

  /**
   * Agenda reenvio no Redis/BullMQ quando disponível.
   * @param {string} phone
   * @param {string} message
   * @param {Object} metadata
   * @param {Error} originalError
   * @returns {Promise<boolean>}
   */
  async enqueueText(phone, message, metadata = {}, originalError = null) {
    if (!this.queueEnabled || !this.queue) return false;

    try {
      const jobId = metadata.messageId
        ? `wa-outbound-${metadata.messageId}`
        : `wa-outbound-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      await this.queue.add(
        'send_text',
        {
          phone,
          message,
          messageId: metadata.messageId || null,
          messageType: metadata.messageType || 'text',
          originalError: originalError?.message || null
        },
        {
          jobId,
          attempts: 5,
          backoff: { type: 'exponential', delay: 3000 },
          removeOnComplete: true,
          removeOnFail: { count: 100 }
        }
      );

      return true;
    } catch (error) {
      console.error('[WA_OUTBOUND] Falha ao enfileirar reenvio:', error.message);
      return false;
    }
  }

  async _processRetryJob(job) {
    if (job.name !== 'send_text') return { ignored: true };

    const { phone, message } = job.data;
    await this._sendTextViaPreferredProvider(phone, message, job.data || {});
    return { sent: true };
  }

  /**
   * Evolution (legado) só participa do fallback quando explicitamente
   * habilitada. Isso evita que envs antigas façam o backend enviar para uma
   * instância desligada quando a Meta falhar.
   * @returns {boolean}
   */
  _evolutionAvailable() {
    if (!this.evolutionFallbackEnabled) return false;
    if (!this.evolution) return false;
    if (typeof this.evolution.isConfigured === 'function') {
      return this.evolution.isConfigured();
    }
    return true;
  }

  async _sendTextViaPreferredProvider(phone, message, metadata = {}) {
    const metaAvailable = typeof this.meta?.isOutboundConfigured === 'function'
      ? this.meta.isOutboundConfigured()
      : false;

    let metaFailure = null;
    if (metaAvailable && typeof this.meta?.sendText === 'function') {
      try {
        const result = await this.meta.sendText(phone, message);
        return { provider: 'meta', response: result };
      } catch (metaError) {
        metaFailure = metaError;
        console.error(`[WA_OUTBOUND] Meta falhou: ${metaError.message}`);
        this.reliability.recordFailure({
          kind: 'outbound_provider_failed',
          phase: 'send',
          phone,
          messageId: metadata.messageId,
          messageType: metadata.messageType || 'text',
          reason: `meta_text_failed: ${metaError?.message || 'unknown'}`,
          queued: false
        });
      }
    }

    if (!this._evolutionAvailable()) {
      throw metaFailure || new Error('Nenhum provedor WhatsApp configurado (WA_ACCESS_TOKEN/WA_PHONE_NUMBER_ID ausentes)');
    }

    const result = await this.evolution.sendMessage(phone, message);
    return { provider: 'evolution', response: result };
  }

  async _sendDocumentViaPreferredProvider(phone, buffer, fileName, mimeType, metadata = {}) {
    const metaAvailable = typeof this.meta?.isOutboundConfigured === 'function'
      ? this.meta.isOutboundConfigured()
      : false;

    let metaFailure = null;
    if (metaAvailable && typeof this.meta?.sendDocumentBuffer === 'function') {
      try {
        const result = await this.meta.sendDocumentBuffer(phone, buffer, fileName, mimeType);
        return { provider: 'meta', response: result };
      } catch (metaError) {
        metaFailure = metaError;
        console.error(`[WA_OUTBOUND] Meta documento falhou: ${metaError.message}`);
        this.reliability.recordFailure({
          kind: 'outbound_provider_failed',
          phase: 'send',
          phone,
          messageId: metadata.messageId,
          messageType: metadata.messageType || 'document',
          reason: `meta_document_failed: ${metaError?.message || 'unknown'}`,
          queued: false
        });
      }
    }

    if (!this._evolutionAvailable()) {
      throw metaFailure || new Error('Nenhum provedor WhatsApp configurado (WA_ACCESS_TOKEN/WA_PHONE_NUMBER_ID ausentes)');
    }

    const base64 = Buffer.isBuffer(buffer) ? buffer.toString('base64') : String(buffer || '');
    const result = await this.evolution.sendDocument(phone, base64, fileName, mimeType);
    return { provider: 'evolution', response: result };
  }

  _logRedisError(message) {
    const now = Date.now();
    if (now - this._lastErrorLogAt > 15000) {
      console.error(message);
      this._lastErrorLogAt = now;
    }
  }

  async close() {
    if (this.worker) await this.worker.close();
    if (this.queue) await this.queue.close();
    if (this.connection) await this.connection.quit();
  }
}

function readFlag(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

module.exports = new OutboundMessageService();
module.exports.OutboundMessageService = OutboundMessageService;
