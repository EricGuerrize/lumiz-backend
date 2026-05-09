// Fase 18 — Middleware de enforcement MFA.
//
// Bloqueia mutações sensíveis quando:
//   - feature flag `mfa_required` resolvida para true para o usuário
//   - AAL da sessão atual não é `aal2` (TOTP não verificado nesta sessão)
//
// Comportamento:
//   - Quando flag está OFF (padrão): passa direto, zero overhead percebido.
//   - Quando flag está ON e sessão é aal1: 403 com `code: MFA_REQUIRED`,
//     frontend deve direcionar para o flow de TOTP.
//
// IMPORTANTE: este middleware deve vir DEPOIS de `authenticateToken`
// (req.user e req.authUser já populados). Caso contrário, libera tudo
// (fail-safe para rotas públicas).

const mfaService = require('../services/mfaService');

function _extractAccessToken(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  if (!authHeader || typeof authHeader !== 'string') return null;
  const parts = authHeader.split(' ');
  if (parts.length !== 2) return null;
  return parts[1] || null;
}

async function requireMFA(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      // Sem auth, este middleware não tem como decidir — deixa passar
      // (a rota deve ter outro guard antes).
      return next();
    }

    const accessToken = _extractAccessToken(req);
    const block = await mfaService.shouldBlock({ userId, accessToken });
    if (!block) return next();

    return res.status(403).json({
      error: 'Esta operação requer verificação de segundo fator (MFA).',
      code: 'MFA_REQUIRED',
      hint: 'Verifique seu código TOTP e tente novamente.',
    });
  } catch (err) {
    // Em caso de erro inesperado, NÃO bloquear — log + pass. MFA é
    // proteção extra, não pode quebrar fluxos críticos por erro de
    // resolução.
    console.warn(`[MFA_MIDDLEWARE] Falha inesperada: ${err.message}`);
    return next();
  }
}

module.exports = { requireMFA };
