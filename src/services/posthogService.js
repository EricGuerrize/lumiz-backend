/**
 * Fase 17 — Serviço PostHog (analytics de produto).
 *
 * Espelha eventos do `analyticsService.track` para o PostHog quando configurado.
 * Sem `POSTHOG_API_KEY` o serviço é no-op silencioso (graceful degradation).
 *
 * Decisões:
 *   - Cliente é lazy-init (só instancia se houver chave + flag pronta).
 *   - Toda função é fire-and-forget; nunca lança.
 *   - Flag `posthog_enabled` (Fase 16) controla por user/global. Se a flag estiver
 *     OFF para o user, o evento NÃO é enviado (mas continua sendo gravado em
 *     `analytics_events` no Supabase).
 *   - Propriedades sensíveis (cpf, password, token, pix_chave, …) são
 *     mascaradas antes do envio.
 *   - distinctId padrão "anonymous" para eventos sem user (ex.: webhook).
 */

const featureFlagService = require('./featureFlagService');

const SENSITIVE_KEYS = [
  'senha', 'password', 'pwd',
  'token', 'access_token', 'refresh_token', 'jwt', 'authorization',
  'cpf', 'rg', 'pix_chave',
  'cartao', 'cartao_numero', 'cartao_cvv', 'cvv',
];

const REDACTED = '[REDACTED]';

function isSensitiveKey(key) {
  if (!key || typeof key !== 'string') return false;
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.some((needle) => lower === needle || lower.includes(needle));
}

function maskProperties(props, depth = 0) {
  if (depth > 4 || !props || typeof props !== 'object') return props;
  const out = Array.isArray(props) ? [] : {};
  for (const [key, value] of Object.entries(props)) {
    if (isSensitiveKey(key)) {
      out[key] = REDACTED;
    } else if (value && typeof value === 'object') {
      out[key] = maskProperties(value, depth + 1);
    } else {
      out[key] = value;
    }
  }
  return out;
}

class PosthogService {
  constructor() {
    this._client = null;
    this._initAttempted = false;
  }

  isConfigured() {
    return Boolean(process.env.POSTHOG_API_KEY && String(process.env.POSTHOG_API_KEY).trim().length > 0);
  }

  init() {
    if (this._client) return true;
    if (this._initAttempted && !this._client) return false;
    this._initAttempted = true;

    if (!this.isConfigured()) {
      return false;
    }

    try {
      const { PostHog } = require('posthog-node');
      const host = process.env.POSTHOG_HOST || 'https://us.i.posthog.com';
      const flushAt = parseInt(process.env.POSTHOG_FLUSH_AT || '20', 10);
      const flushInterval = parseInt(process.env.POSTHOG_FLUSH_INTERVAL_MS || '10000', 10);

      this._client = new PostHog(process.env.POSTHOG_API_KEY, {
        host,
        flushAt: Number.isFinite(flushAt) ? flushAt : 20,
        flushInterval: Number.isFinite(flushInterval) ? flushInterval : 10000,
      });

      if (typeof this._client.on === 'function') {
        try {
          this._client.on('error', (err) => {
            console.warn('[POSTHOG] Erro do cliente:', err?.message || err);
          });
        } catch (_) { /* alguns mocks não implementam on() */ }
      }

      return true;
    } catch (err) {
      console.warn('[POSTHOG] Falha ao inicializar cliente:', err?.message || err);
      this._client = null;
      return false;
    }
  }

  /**
   * Verifica se o envio para PostHog está habilitado para este user.
   * Layered: flag posthog_enabled per-user / global / default false.
   */
  async _shouldSendFor(userId) {
    if (!this.isConfigured()) return false;
    try {
      const enabled = await featureFlagService.isEnabled('posthog_enabled', userId || null);
      return Boolean(enabled);
    } catch (err) {
      console.warn('[POSTHOG] Falha ao resolver flag posthog_enabled:', err?.message || err);
      return false;
    }
  }

  /**
   * Envia um evento de captura.
   * @param {object} input
   * @param {string} [input.distinctId] — id estável do user; cai pra "anonymous" se vazio.
   * @param {string}  input.event       — nome do evento.
   * @param {object} [input.properties] — propriedades arbitrárias (mascaradas).
   */
  async capture({ distinctId, event, properties = {} } = {}) {
    if (!event || typeof event !== 'string') return;

    const shouldSend = await this._shouldSendFor(distinctId);
    if (!shouldSend) return;

    if (!this.init() || !this._client) return;

    try {
      const sanitized = maskProperties(properties || {});
      this._client.capture({
        distinctId: distinctId || 'anonymous',
        event,
        properties: {
          ...sanitized,
          $lib: 'lumiz-backend',
          $lib_version: require('../../package.json').version || 'unknown',
        },
      });
    } catch (err) {
      console.warn('[POSTHOG] Falha ao capturar evento:', err?.message || err);
    }
  }

  /**
   * Identifica/atualiza traits de um user no PostHog.
   */
  async identify({ distinctId, properties = {} } = {}) {
    if (!distinctId) return;

    const shouldSend = await this._shouldSendFor(distinctId);
    if (!shouldSend) return;

    if (!this.init() || !this._client) return;

    try {
      const sanitized = maskProperties(properties || {});
      this._client.identify({
        distinctId,
        properties: sanitized,
      });
    } catch (err) {
      console.warn('[POSTHOG] Falha ao identificar user:', err?.message || err);
    }
  }

  /**
   * Garante flush + shutdown — chamado no graceful shutdown.
   */
  async shutdown() {
    if (!this._client) return;
    try {
      await this._client.shutdown();
    } catch (err) {
      console.warn('[POSTHOG] Falha em shutdown:', err?.message || err);
    } finally {
      this._client = null;
      this._initAttempted = false;
    }
  }
}

module.exports = new PosthogService();
