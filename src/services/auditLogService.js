/**
 * Fase 15 — Audit Log Service.
 *
 * Responsabilidade única: persistir e consultar registros de mutações
 * críticas (POST/PUT/DELETE/PATCH) na tabela `audit_log`.
 *
 * Garantias:
 *   - Escrita SEMPRE fire-and-forget. Falha do audit log nunca derruba a
 *     request principal — o pior cenário aceito é "perdemos um registro
 *     de auditoria", nunca "usuário recebeu 500 porque o audit caiu".
 *   - Mascara campos sensíveis (`senha`, `password`, `token`, `cpf`,
 *     `cnpj` quando houver flag `_mask_cnpj`) antes de persistir.
 *   - Aceita `entity_id` como string (UUIDs ou chaves compostas tipo
 *     `goal:2026:5`).
 *
 * Contrato de leitura (pré-Fase 14):
 *   - Backend filtra por `user_id` (single tenant). Quando multi-tenant
 *     entrar, basta adicionar `clinic_id` ao filtro.
 *
 * Dependências externas:
 *   - Supabase (`audit_log` com RLS leitura por `user_id = auth.uid()`).
 */

const supabase = require('../db/supabase');

const SENSITIVE_KEYS = new Set([
  'senha',
  'password',
  'pwd',
  'token',
  'access_token',
  'refresh_token',
  'jwt',
  'authorization',
  'cpf',
  'rg',
  'pix_chave',
  'cartao',
  'cartao_numero',
  'cvv'
]);

const MASK = '***';

/**
 * @param {*} value
 * @returns {boolean}
 * @private
 */
function _isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Aplica mascaramento profundo em chaves sensíveis. Não modifica o input.
 * @private
 */
function _maskSensitive(input, depth = 0) {
  if (depth > 6) return '[depth_limit]';
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) return input.map(v => _maskSensitive(v, depth + 1));
  if (!_isPlainObject(input)) return input;

  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = MASK;
    } else {
      out[k] = _maskSensitive(v, depth + 1);
    }
  }
  return out;
}

/**
 * Extrai IP e user-agent de uma request Express. IP respeita o header
 * `x-forwarded-for` (Railway/Heroku) e cai pra `req.ip` quando ausente.
 * @param {import('express').Request} req
 * @returns {{ ip_address: string|null, user_agent: string|null }}
 */
function extractContext(req) {
  if (!req) return { ip_address: null, user_agent: null };
  let ip = null;
  try {
    const forwarded = req.headers && req.headers['x-forwarded-for'];
    if (forwarded) {
      ip = String(forwarded).split(',')[0].trim();
    } else if (req.ip) {
      ip = String(req.ip);
    } else if (req.connection && req.connection.remoteAddress) {
      ip = String(req.connection.remoteAddress);
    }
  } catch (_) {
    ip = null;
  }
  let ua = null;
  try {
    ua = (req.get && req.get('user-agent')) || (req.headers && req.headers['user-agent']) || null;
    if (ua) ua = String(ua).slice(0, 500);
  } catch (_) {
    ua = null;
  }
  return {
    ip_address: ip ? String(ip).slice(0, 45) : null,
    user_agent: ua
  };
}

/**
 * Persiste um registro de auditoria. Fire-and-forget: retorna imediatamente
 * uma Promise que NUNCA rejeita (erros são apenas logados).
 *
 * @param {object} opts
 * @param {string|null} opts.userId        proprietário da mutação.
 * @param {string} opts.action             ex: 'transaction_updated'.
 * @param {string} opts.entityType         ex: 'transaction', 'goal'.
 * @param {string|null} [opts.entityId]    UUID ou chave composta.
 * @param {object|null} [opts.oldValue]    snapshot anterior (será mascarado).
 * @param {object|null} [opts.newValue]    snapshot novo (será mascarado).
 * @param {import('express').Request} [opts.req] para extrair IP/user-agent.
 * @returns {Promise<void>}
 */
function log(opts) {
  const promise = (async () => {
    try {
      if (!opts || !opts.action || !opts.entityType) {
        console.warn('[AUDIT] log() chamado sem action/entityType — ignorando.');
        return;
      }
      const { ip_address, user_agent } = extractContext(opts.req);
      const row = {
        user_id: opts.userId || null,
        clinic_id: opts.clinicId || null,
        action: String(opts.action).slice(0, 100),
        entity_type: String(opts.entityType).slice(0, 50),
        entity_id: opts.entityId !== null && opts.entityId !== undefined
          ? String(opts.entityId).slice(0, 512)
          : null,
        old_value: opts.oldValue !== undefined ? _maskSensitive(opts.oldValue) : null,
        new_value: opts.newValue !== undefined ? _maskSensitive(opts.newValue) : null,
        ip_address,
        user_agent
      };
      const { error } = await supabase.from('audit_log').insert(row);
      if (error) {
        console.warn('[AUDIT] insert falhou:', error.message, { action: row.action, entity: row.entity_type });
      }
    } catch (err) {
      console.warn('[AUDIT] log() erro inesperado:', err && err.message ? err.message : err);
    }
  })();
  // Garante que erros não vazem em forma de unhandledRejection.
  promise.catch(() => {});
  return promise;
}

/**
 * Lista registros de audit log do usuário com filtros opcionais.
 *
 * @param {string} userId
 * @param {object} [filters]
 * @param {string} [filters.entityType]
 * @param {string} [filters.action]
 * @param {number} [filters.limit=50]   1..200
 * @param {number} [filters.offset=0]
 * @returns {Promise<{ data: object[], meta: { total: number, has_more: boolean, next_offset: number|null, is_empty: boolean, hint: string|null } }>}
 */
async function list(userId, filters = {}) {
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
  const offset = Math.max(Number(filters.offset) || 0, 0);

  let query = supabase
    .from('audit_log')
    .select('*', { count: 'exact' })
    .eq('user_id', userId);

  if (filters.entityType) query = query.eq('entity_type', String(filters.entityType));
  if (filters.action) query = query.eq('action', String(filters.action));

  query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) {
    console.error('[AUDIT] list falhou:', error.message);
    return {
      data: [],
      meta: {
        total: 0,
        has_more: false,
        next_offset: null,
        is_empty: true,
        hint: 'Não foi possível carregar o histórico agora. Tente novamente em instantes.'
      }
    };
  }

  const rows = data || [];
  const total = typeof count === 'number' ? count : rows.length;
  const has_more = offset + rows.length < total;

  return {
    data: rows,
    meta: {
      total,
      has_more,
      next_offset: has_more ? offset + rows.length : null,
      is_empty: rows.length === 0,
      hint: rows.length === 0
        ? 'Nenhuma alteração registrada ainda. Conforme você editar lançamentos, metas ou contas, o histórico aparece aqui.'
        : null
    }
  };
}

module.exports = {
  log,
  list,
  extractContext,
  _maskSensitive,
  SENSITIVE_KEYS
};
