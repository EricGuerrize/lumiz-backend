/**
 * Fase 16 — Endpoint público de feature flags do produto.
 *
 * Responsabilidade única: expor para o frontend o estado das flags conhecidas
 * (whitelist em `src/config/featureFlagsRegistry.js`) já resolvidas pela
 * camada de precedência do `featureFlagService` (user → global → env JSON →
 * env booleano → default false).
 *
 * Auth: opcional. Quando o request traz `Authorization: Bearer <token>`
 * válido, sobrepõe-se com flags por usuário; caso contrário, devolve apenas
 * flags globais/env. Nunca devolve 401 para o frontend pode chamar antes do
 * login (kill switches universais como `mfa_required` precisam estar
 * disponíveis nessa janela).
 *
 * Nunca expõe flags fora da whitelist (mesmo que registradas no DB), evitando
 * vazamento de flags internas/experimentais.
 *
 * Dependências externas:
 *   - `featureFlagService.listForUser(userId|null)` — Supabase + env.
 *   - `supabase.auth.getUser(token)` — somente para best-effort enriquecimento.
 */

const express = require('express');
const supabase = require('../db/supabase');
const featureFlagService = require('../services/featureFlagService');
const {
  getDefaultsObject,
  getDescriptions,
  listKnownFlagNames
} = require('../config/featureFlagsRegistry');

const router = express.Router();

/**
 * Tenta resolver `req.user.id` via Bearer token sem bloquear caso falhe.
 * @private
 */
async function _bestEffortUserId(req) {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return null;
    const parts = authHeader.split(' ');
    const token = parts.length === 2 ? parts[1] : null;
    if (!token) return null;
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user.id || null;
  } catch (err) {
    console.warn('[CONFIG_FEATURES] best-effort auth falhou:', err.message);
    return null;
  }
}

/**
 * Filtra um mapa de flags retornadas pelo service para a whitelist conhecida.
 * Aplica defaults para flags não presentes no service.
 * @private
 */
function _projectKnownFlags(serviceFlags) {
  const defaults = getDefaultsObject();
  const out = { ...defaults };
  for (const name of listKnownFlagNames()) {
    if (Object.prototype.hasOwnProperty.call(serviceFlags, name)) {
      out[name] = Boolean(serviceFlags[name]);
    }
  }
  return out;
}

/**
 * GET /api/config/features
 * Resposta:
 *   {
 *     flags: { alter_enabled: true, excel_import: false, ... },
 *     descriptions: { alter_enabled: 'Roteamento Alter ...', ... },
 *     resolvedFor: { user_id: string|null },
 *     meta: { generated_at: ISO8601 }
 *   }
 *
 * Em caso de falha no DB, devolve defaults da whitelist (degradação segura).
 */
router.get('/features', async (req, res) => {
  const userId = await _bestEffortUserId(req);

  let flags;
  try {
    const all = await featureFlagService.listForUser(userId);
    flags = _projectKnownFlags(all || {});
  } catch (err) {
    console.error('[CONFIG_FEATURES] listForUser falhou — devolvendo defaults:', err.message);
    flags = getDefaultsObject();
  }

  res.json({
    flags,
    descriptions: getDescriptions(),
    resolvedFor: { user_id: userId },
    meta: { generated_at: new Date().toISOString() }
  });
});

module.exports = router;
