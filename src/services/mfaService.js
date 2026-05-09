// Fase 18 — MFA (TOTP) via Supabase Auth.
//
// O enrollment e o verify do TOTP acontecem no frontend via supabase-js
// (`supabase.auth.mfa.enroll/challenge/verify/unenroll`). O backend cumpre
// três papéis:
//
//   1. Status — devolve para o frontend o estado atual do usuário (aal +
//      factores) para a UI decidir se mostra "ative MFA" ou liberou tudo.
//   2. Enforcement — middleware `requireMFA` que bloqueia mutações sensíveis
//      quando a flag `mfa_required` está ativa para o usuário e a sessão
//      não atingiu `aal2` (TOTP não verificado nesta sessão).
//   3. Auditoria — frontend reporta `enrolled/verified/unenrolled` via
//      POST /api/user/mfa/event; backend grava no audit_log para
//      compliance.
//
// AAL: Authentication Assurance Level (Supabase Auth).
//   - aal1 = senha ou OAuth, sem segundo fator.
//   - aal2 = senha + TOTP verificado nesta sessão.
//
// O `aal` vem como claim do JWT. Não precisamos validar a assinatura aqui
// (o middleware authenticateToken já chamou supabase.auth.getUser e
// validou); só decodificamos o payload para extrair o claim.

const supabase = require('../db/supabase');
const featureFlagService = require('./featureFlagService');
const auditLogService = require('./auditLogService');

const VALID_AAL_VALUES = new Set(['aal1', 'aal2', 'aal3']);
const VALID_EVENT_ACTIONS = new Set([
  'mfa_enrolled',
  'mfa_verified',
  'mfa_unenrolled',
  'mfa_challenge_failed',
]);

/**
 * Decodifica um JWT (header.payload.signature → payload) sem validar.
 * Confiamos que o middleware authenticateToken já chamou getUser e
 * validou. Aqui só queremos os claims (aal, amr, etc.).
 *
 * Retorna {} em caso de qualquer erro — fail-safe; chamadores devem
 * decidir o comportamento por valor ausente.
 */
function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return {};
  const parts = token.split('.');
  if (parts.length !== 3) return {};
  try {
    const payload = parts[1];
    // base64url → base64
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '==='.slice((b64.length + 3) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf-8');
    return JSON.parse(json) || {};
  } catch (err) {
    return {};
  }
}

/**
 * Extrai o AAL do JWT. Devolve uma string `aal1|aal2|aal3` ou null.
 * Tenta primeiro o claim `aal` direto; cai para inferência via `amr`.
 */
function extractAal(token) {
  const claims = decodeJwtPayload(token);
  if (claims.aal && VALID_AAL_VALUES.has(claims.aal)) return claims.aal;

  // Fallback: amr (authentication methods reference) — se contém algum
  // método "totp", tratamos como aal2.
  if (Array.isArray(claims.amr)) {
    const methods = claims.amr.map(m => (m && m.method) || m).filter(Boolean);
    if (methods.includes('totp')) return 'aal2';
    if (methods.includes('password') || methods.includes('otp') || methods.includes('oauth')) return 'aal1';
  }

  return null;
}

/**
 * Lista factores MFA do usuário via admin API.
 * Retorna [] em caso de erro (graceful degradation).
 */
async function _listFactors(userId) {
  if (!userId) return [];
  try {
    if (!supabase.auth?.admin?.mfa?.listFactors) return [];
    const { data, error } = await supabase.auth.admin.mfa.listFactors({ userId });
    if (error) {
      console.warn(`[MFA] Falha ao listar factors: ${error.message}`);
      return [];
    }
    const factors = Array.isArray(data?.factors) ? data.factors : (Array.isArray(data) ? data : []);
    return factors.map(f => ({
      id: f.id,
      friendly_name: f.friendly_name || null,
      factor_type: f.factor_type || 'totp',
      status: f.status || 'unverified',
      created_at: f.created_at || null,
      updated_at: f.updated_at || null,
    }));
  } catch (err) {
    console.warn(`[MFA] Exceção ao listar factors: ${err.message}`);
    return [];
  }
}

/**
 * Resolve a flag `mfa_required` para o usuário. Layered: per-user override
 * → flag global → false default. Reusa featureFlagService para manter
 * consistência com o resto do sistema.
 */
async function isMfaRequiredFor(userId) {
  try {
    const flags = await featureFlagService.listForUser(userId);
    return Boolean(flags && flags.mfa_required);
  } catch (err) {
    console.warn(`[MFA] Falha ao resolver mfa_required: ${err.message}`);
    return false;
  }
}

/**
 * Status MFA do usuário para a UI.
 *
 * Resposta:
 *   {
 *     aal: 'aal1' | 'aal2' | null,
 *     mfa_required: boolean,
 *     enrolled: boolean,           // tem ao menos 1 factor verified
 *     factors: [{id, friendly_name, factor_type, status, ...}]
 *   }
 *
 * Frontend usa para:
 *   - decidir se mostra banner "Ative o MFA" quando required && !enrolled.
 *   - decidir se mostra prompt de re-verify quando enrolled && aal !== 'aal2'.
 */
async function getStatus({ userId, accessToken } = {}) {
  if (!userId) throw new Error('userId é obrigatório');

  const [factors, mfaRequired] = await Promise.all([
    _listFactors(userId),
    isMfaRequiredFor(userId),
  ]);

  const enrolled = factors.some(f => f.status === 'verified');
  const aal = accessToken ? extractAal(accessToken) : null;

  return {
    aal,
    mfa_required: mfaRequired,
    enrolled,
    factors,
  };
}

/**
 * Verdadeiro quando deve bloquear o request:
 *   - flag `mfa_required` ativa para o usuário, E
 *   - sessão não está em aal2 (não verificou TOTP nesta sessão).
 *
 * Se a flag não está ativa, nunca bloqueia (modo opt-in).
 */
async function shouldBlock({ userId, accessToken } = {}) {
  if (!userId) return false;
  const required = await isMfaRequiredFor(userId);
  if (!required) return false;
  const aal = accessToken ? extractAal(accessToken) : null;
  return aal !== 'aal2';
}

/**
 * Loga evento de MFA no audit_log. Frontend dispara isso depois de
 * enroll/verify/unenroll bem-sucedido. Idempotente do ponto de vista
 * do auditLogService (que é fire-and-forget).
 */
function logEvent({ userId, action, factorId = null, friendlyName = null, req = null }) {
  if (!userId) return;
  const safeAction = VALID_EVENT_ACTIONS.has(action) ? action : null;
  if (!safeAction) {
    console.warn(`[MFA] Ação inválida ignorada: ${action}`);
    return;
  }
  auditLogService.log({
    userId,
    action: safeAction,
    entityType: 'mfa_factor',
    entityId: factorId || null,
    newValue: friendlyName ? { friendly_name: friendlyName } : null,
    req,
  });
}

module.exports = {
  // Internos exportados para teste
  decodeJwtPayload,
  extractAal,
  VALID_AAL_VALUES,
  VALID_EVENT_ACTIONS,

  // API pública
  getStatus,
  isMfaRequiredFor,
  shouldBlock,
  logEvent,
};
