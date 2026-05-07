const supabase = require('../db/supabase');

/**
 * Onda 3.A / Fase 16 — Feature Flag Service.
 *
 * Resolução em camadas (ordem de precedência):
 *   1) tabela `feature_flags` (linha por user_id quando preenchida).
 *   2) tabela `feature_flags` (linha global, user_id IS NULL).
 *   3) env var `FEATURE_FLAGS` (JSON; ex: `{"alter_enabled":true}`).
 *   4) env var simples (ex: `ALTER_ENABLED=true`).
 *   5) default (false).
 *
 * Cache em memória de 60s para evitar hit constante no DB.
 */

const CACHE_TTL_MS = 60_000;
const cache = new Map(); // key: `${flag}:${userId|''}`

let envFlagsCache = null;
function _readEnvFlags() {
  if (envFlagsCache !== null) return envFlagsCache;
  const raw = process.env.FEATURE_FLAGS;
  if (!raw) return (envFlagsCache = {});
  try {
    envFlagsCache = JSON.parse(raw);
  } catch (e) {
    console.warn('[FEATURE_FLAGS] FEATURE_FLAGS env inválido (esperado JSON):', e.message);
    envFlagsCache = {};
  }
  return envFlagsCache;
}

function _readEnvBoolean(flagName) {
  const envKey = flagName.toUpperCase();
  const raw = process.env[envKey];
  if (raw === undefined || raw === null) return null;
  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off', ''].includes(normalized)) return false;
  return null;
}

class FeatureFlagService {
  /**
   * @param {string} flag
   * @param {string|null} [userId]
   * @returns {Promise<boolean>}
   */
  async isEnabled(flag, userId = null) {
    if (!flag) return false;
    const cacheKey = `${flag}:${userId || ''}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    let value = false;

    try {
      if (userId) {
        const { data, error } = await supabase
          .from('feature_flags')
          .select('enabled')
          .eq('user_id', userId)
          .eq('name', flag)
          .maybeSingle();
        if (!error && data) {
          value = Boolean(data.enabled);
          cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
          return value;
        }
      }

      const { data: globalRow, error: globalError } = await supabase
        .from('feature_flags')
        .select('enabled')
        .is('user_id', null)
        .eq('name', flag)
        .maybeSingle();
      if (!globalError && globalRow) {
        value = Boolean(globalRow.enabled);
        cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
        return value;
      }
    } catch (err) {
      console.warn(`[FEATURE_FLAGS] DB lookup falhou para ${flag}:`, err.message);
    }

    const envJson = _readEnvFlags();
    if (Object.prototype.hasOwnProperty.call(envJson, flag)) {
      value = Boolean(envJson[flag]);
      cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      return value;
    }

    const envBool = _readEnvBoolean(flag);
    if (envBool !== null) {
      cache.set(cacheKey, { value: envBool, expiresAt: Date.now() + CACHE_TTL_MS });
      return envBool;
    }

    cache.set(cacheKey, { value: false, expiresAt: Date.now() + CACHE_TTL_MS });
    return false;
  }

  /**
   * Lista todas as flags conhecidas (env + DB) para um user.
   */
  async listForUser(userId = null) {
    const all = new Map();
    Object.entries(_readEnvFlags()).forEach(([k, v]) => all.set(k, Boolean(v)));

    try {
      const { data: globalRows } = await supabase
        .from('feature_flags')
        .select('name, enabled')
        .is('user_id', null);
      (globalRows || []).forEach((row) => all.set(row.name, Boolean(row.enabled)));

      if (userId) {
        const { data: userRows } = await supabase
          .from('feature_flags')
          .select('name, enabled')
          .eq('user_id', userId);
        (userRows || []).forEach((row) => all.set(row.name, Boolean(row.enabled)));
      }
    } catch (err) {
      console.warn('[FEATURE_FLAGS] listForUser DB falhou:', err.message);
    }

    return Object.fromEntries(all.entries());
  }

  /**
   * Limpa cache em memória. Útil para testes.
   */
  resetCache() {
    cache.clear();
    envFlagsCache = null;
  }
}

const instance = new FeatureFlagService();

/**
 * Middleware para proteger rotas atrás de uma feature flag.
 * Uso: `router.use('/alter', requireFeature('alter_enabled'), alterRouter)`.
 */
function requireFeature(flag) {
  return async (req, res, next) => {
    try {
      const enabled = await instance.isEnabled(flag, req.user?.id || null);
      if (!enabled) {
        return res.status(403).json({
          error: 'feature_disabled',
          flag,
          message: `Feature ${flag} está desabilitada para este usuário.`
        });
      }
      next();
    } catch (err) {
      console.error('[FEATURE_FLAGS] Erro no middleware requireFeature:', err.message);
      res.status(500).json({ error: 'feature_flag_check_failed' });
    }
  };
}

module.exports = instance;
module.exports.FeatureFlagService = FeatureFlagService;
module.exports.requireFeature = requireFeature;
module.exports._helpers = { _readEnvFlags, _readEnvBoolean };
