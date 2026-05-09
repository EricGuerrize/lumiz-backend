/**
 * LGPD — Persistência de consentimento.
 *
 * Por que existe: a Lei Geral de Proteção de Dados brasileira (Art. 8º §1º)
 * exige que o controlador (Lumiz) mantenha **prova** do consentimento — com
 * timestamp e versão dos termos vigentes naquele momento. Antes desta camada,
 * o "Autorizo" do onboarding via WhatsApp só era registrado em `analytics_events`
 * com `event=onboarding_consent_given`, o que não é forte o suficiente para
 * uma auditoria ANPD ou disputa civil.
 *
 * Esta camada:
 *   1. Persiste em `profiles`: consent_given_at, terms_version, privacy_version,
 *      consent_ip, consent_user_agent.
 *   2. Grava entry no `audit_log` (entityType=profile, action=consent_given).
 *   3. É idempotente: se o usuário já consentiu nas versões atuais, não regrava.
 *   4. Re-consent: se as versões mudaram (env LUMIZ_TERMS_VERSION /
 *      LUMIZ_PRIVACY_VERSION), o próximo "Autorizo" gera novo timestamp.
 *   5. Fire-and-forget — falha de DB nunca derruba o onboarding.
 *
 * Uso típico:
 *   await consentService.recordConsent({ phone, req });
 */

const supabase = require('../db/supabase');
const auditLogService = require('./auditLogService');

const DEFAULT_TERMS_VERSION = '2026-05-09';
const DEFAULT_PRIVACY_VERSION = '2026-05-09';

function getActiveVersions() {
  return {
    termsVersion: (process.env.LUMIZ_TERMS_VERSION || DEFAULT_TERMS_VERSION).trim(),
    privacyVersion: (process.env.LUMIZ_PRIVACY_VERSION || DEFAULT_PRIVACY_VERSION).trim(),
  };
}

function extractIp(req) {
  if (!req) return null;
  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded) {
    return String(forwarded).split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || null;
}

function extractUserAgent(req) {
  if (!req) return null;
  const ua = req.headers?.['user-agent'];
  if (!ua) return null;
  return String(ua).slice(0, 500);
}

function _findProfileByPhone(phone) {
  return supabase
    .from('profiles')
    .select('id, telefone, consent_given_at, terms_version, privacy_version')
    .eq('telefone', phone)
    .maybeSingle();
}

/**
 * Registra consentimento LGPD para um perfil.
 *
 * @param {object} params
 * @param {string} params.phone - telefone do usuário (e.164 ou string usada em profiles.telefone)
 * @param {object} [params.req] - Express req para extrair IP/UA
 * @returns {Promise<{ ok: boolean, skipped?: boolean, reason?: string }>}
 */
async function recordConsent({ phone, req } = {}) {
  if (!phone) {
    return { ok: false, skipped: true, reason: 'missing_phone' };
  }

  try {
    const { data: profile, error: selectErr } = await _findProfileByPhone(phone);
    if (selectErr) {
      console.warn('[CONSENT] Erro ao buscar profile:', selectErr.message);
      return { ok: false, skipped: true, reason: 'profile_lookup_failed' };
    }
    if (!profile) {
      console.warn(`[CONSENT] Profile não encontrado para telefone ${phone}; consent não persistido.`);
      return { ok: false, skipped: true, reason: 'profile_not_found' };
    }

    const { termsVersion, privacyVersion } = getActiveVersions();

    const alreadyMatchesActive =
      profile.consent_given_at &&
      profile.terms_version === termsVersion &&
      profile.privacy_version === privacyVersion;

    if (alreadyMatchesActive) {
      return { ok: true, skipped: true, reason: 'already_consented' };
    }

    const ip = extractIp(req);
    const userAgent = extractUserAgent(req);
    const now = new Date().toISOString();

    const update = {
      consent_given_at: now,
      terms_version: termsVersion,
      privacy_version: privacyVersion,
      consent_ip: ip,
      consent_user_agent: userAgent,
    };

    const { error: updateErr } = await supabase
      .from('profiles')
      .update(update)
      .eq('telefone', phone);

    if (updateErr) {
      console.warn('[CONSENT] Erro ao atualizar profile:', updateErr.message);
      return { ok: false, skipped: true, reason: 'update_failed' };
    }

    auditLogService
      .log({
        userId: profile.id,
        action: 'consent_given',
        entityType: 'profile',
        entityId: profile.id,
        oldValue: profile.consent_given_at
          ? {
              consent_given_at: profile.consent_given_at,
              terms_version: profile.terms_version,
              privacy_version: profile.privacy_version,
            }
          : null,
        newValue: update,
        req: req || null,
      })
      .catch((err) => {
        console.warn('[CONSENT] Falha ao gravar audit_log:', err?.message || err);
      });

    return { ok: true };
  } catch (err) {
    // Fire-and-forget: NUNCA propaga.
    console.warn('[CONSENT] Erro inesperado ao registrar consentimento:', err?.message || err);
    return { ok: false, skipped: true, reason: 'unexpected_error' };
  }
}

/**
 * Confere se o usuário (por telefone) consentiu nas versões atuais dos termos.
 */
async function hasGivenConsent({ phone } = {}) {
  if (!phone) return false;
  try {
    const { data: profile, error } = await _findProfileByPhone(phone);
    if (error || !profile || !profile.consent_given_at) return false;
    const { termsVersion, privacyVersion } = getActiveVersions();
    return (
      profile.terms_version === termsVersion &&
      profile.privacy_version === privacyVersion
    );
  } catch (err) {
    console.warn('[CONSENT] hasGivenConsent erro:', err?.message || err);
    return false;
  }
}

module.exports = {
  recordConsent,
  hasGivenConsent,
  getActiveVersions,
};
