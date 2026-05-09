/**
 * Fase 18 — MFA (TOTP) backend.
 *
 * Garante:
 *   1. Extração de AAL a partir de JWT Supabase (claim `aal` e fallback `amr`).
 *   2. Status combina AAL + factores + flag `mfa_required`.
 *   3. Enforcement bloqueia somente quando flag ativa e sessão não é `aal2`.
 *   4. Eventos de MFA são enviados ao audit_log.
 *   5. Middleware `requireMFA` devolve 403/MFA_REQUIRED no caso bloqueado e
 *      faz bypass quando flag off / aal2 / sem user.
 */

function makeJwt(payload) {
  const enc = (obj) => Buffer.from(JSON.stringify(obj))
    .toString('base64url');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc(payload)}.signature`;
}

describe('Fase 18 — mfaService', () => {
  let mfaService;
  let listFactorsMock;
  let listForUserMock;
  let auditLogMock;

  beforeEach(() => {
    jest.resetModules();
    listFactorsMock = jest.fn();
    listForUserMock = jest.fn();
    auditLogMock = jest.fn();

    jest.doMock('../../src/db/supabase', () => ({
      auth: {
        admin: {
          mfa: {
            listFactors: listFactorsMock,
          },
        },
      },
    }));

    jest.doMock('../../src/services/featureFlagService', () => ({
      listForUser: listForUserMock,
    }));

    jest.doMock('../../src/services/auditLogService', () => ({
      log: auditLogMock,
    }));

    mfaService = require('../../src/services/mfaService');
  });

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  describe('decodeJwtPayload/extractAal', () => {
    it('extrai claim aal direto do JWT', () => {
      expect(mfaService.extractAal(makeJwt({ aal: 'aal2' }))).toBe('aal2');
      expect(mfaService.extractAal(makeJwt({ aal: 'aal1' }))).toBe('aal1');
    });

    it('ignora aal inválido e retorna null quando não consegue inferir', () => {
      expect(mfaService.extractAal(makeJwt({ aal: 'weird' }))).toBeNull();
      expect(mfaService.extractAal('not-a-jwt')).toBeNull();
      expect(mfaService.extractAal(null)).toBeNull();
    });

    it('infere aal2 quando amr contém totp', () => {
      const token = makeJwt({ amr: [{ method: 'password' }, { method: 'totp' }] });
      expect(mfaService.extractAal(token)).toBe('aal2');
    });

    it('infere aal1 quando amr contém password sem totp', () => {
      const token = makeJwt({ amr: [{ method: 'password' }] });
      expect(mfaService.extractAal(token)).toBe('aal1');
    });
  });

  describe('getStatus()', () => {
    it('combina factors verificados, aal e flag mfa_required', async () => {
      listFactorsMock.mockResolvedValue({
        data: {
          factors: [
            {
              id: 'factor-1',
              friendly_name: 'iPhone',
              factor_type: 'totp',
              status: 'verified',
              created_at: '2026-01-01T00:00:00Z',
            },
          ],
        },
        error: null,
      });
      listForUserMock.mockResolvedValue({ mfa_required: true });

      const status = await mfaService.getStatus({
        userId: 'user-1',
        accessToken: makeJwt({ aal: 'aal2' }),
      });

      expect(status).toEqual({
        aal: 'aal2',
        mfa_required: true,
        enrolled: true,
        factors: [
          {
            id: 'factor-1',
            friendly_name: 'iPhone',
            factor_type: 'totp',
            status: 'verified',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: null,
          },
        ],
      });
      expect(listFactorsMock).toHaveBeenCalledWith({ userId: 'user-1' });
      expect(listForUserMock).toHaveBeenCalledWith('user-1');
    });

    it('degrada factors para [] quando Supabase admin falha', async () => {
      listFactorsMock.mockResolvedValue({ data: null, error: { message: 'auth down' } });
      listForUserMock.mockResolvedValue({ mfa_required: false });

      const status = await mfaService.getStatus({
        userId: 'user-1',
        accessToken: makeJwt({ aal: 'aal1' }),
      });

      expect(status.factors).toEqual([]);
      expect(status.enrolled).toBe(false);
      expect(status.aal).toBe('aal1');
    });

    it('lança quando userId é vazio', async () => {
      await expect(mfaService.getStatus({ userId: null })).rejects.toThrow('userId é obrigatório');
    });
  });

  describe('shouldBlock()', () => {
    it('não bloqueia quando flag mfa_required está off', async () => {
      listForUserMock.mockResolvedValue({ mfa_required: false });
      await expect(mfaService.shouldBlock({
        userId: 'user-1',
        accessToken: makeJwt({ aal: 'aal1' }),
      })).resolves.toBe(false);
    });

    it('bloqueia quando flag está on e sessão é aal1', async () => {
      listForUserMock.mockResolvedValue({ mfa_required: true });
      await expect(mfaService.shouldBlock({
        userId: 'user-1',
        accessToken: makeJwt({ aal: 'aal1' }),
      })).resolves.toBe(true);
    });

    it('não bloqueia quando flag está on e sessão é aal2', async () => {
      listForUserMock.mockResolvedValue({ mfa_required: true });
      await expect(mfaService.shouldBlock({
        userId: 'user-1',
        accessToken: makeJwt({ aal: 'aal2' }),
      })).resolves.toBe(false);
    });

    it('não bloqueia se resolver flag falha (fail-open controlado)', async () => {
      listForUserMock.mockRejectedValue(new Error('flags down'));
      await expect(mfaService.shouldBlock({
        userId: 'user-1',
        accessToken: makeJwt({ aal: 'aal1' }),
      })).resolves.toBe(false);
    });
  });

  describe('logEvent()', () => {
    it('envia evento válido ao audit_log com entityType mfa_factor', () => {
      mfaService.logEvent({
        userId: 'user-1',
        action: 'mfa_enrolled',
        factorId: 'factor-1',
        friendlyName: 'iPhone',
        req: { ip: '127.0.0.1' },
      });

      expect(auditLogMock).toHaveBeenCalledWith({
        userId: 'user-1',
        action: 'mfa_enrolled',
        entityType: 'mfa_factor',
        entityId: 'factor-1',
        newValue: { friendly_name: 'iPhone' },
        req: { ip: '127.0.0.1' },
      });
    });

    it('ignora action inválido sem gravar audit_log', () => {
      mfaService.logEvent({
        userId: 'user-1',
        action: 'mfa_unknown',
      });
      expect(auditLogMock).not.toHaveBeenCalled();
    });
  });
});

describe('Fase 18 — mfaMiddleware.requireMFA', () => {
  let requireMFA;
  let shouldBlockMock;

  function makeReq({ user = { id: 'user-1' }, token = 'jwt-token' } = {}) {
    return {
      user,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    };
  }

  function makeRes() {
    return {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  }

  beforeEach(() => {
    jest.resetModules();
    shouldBlockMock = jest.fn();
    jest.doMock('../../src/services/mfaService', () => ({
      shouldBlock: shouldBlockMock,
    }));
    ({ requireMFA } = require('../../src/middleware/mfaMiddleware'));
  });

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('faz bypass quando não existe req.user (rota pública ou auth ausente)', async () => {
    const req = makeReq({ user: null });
    const res = makeRes();
    const next = jest.fn();

    await requireMFA(req, res, next);

    expect(shouldBlockMock).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('chama next quando shouldBlock=false', async () => {
    shouldBlockMock.mockResolvedValue(false);
    const req = makeReq({ token: 'token-aal2' });
    const res = makeRes();
    const next = jest.fn();

    await requireMFA(req, res, next);

    expect(shouldBlockMock).toHaveBeenCalledWith({
      userId: 'user-1',
      accessToken: 'token-aal2',
    });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('retorna 403 MFA_REQUIRED quando shouldBlock=true', async () => {
    shouldBlockMock.mockResolvedValue(true);
    const req = makeReq({ token: 'token-aal1' });
    const res = makeRes();
    const next = jest.fn();

    await requireMFA(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Esta operação requer verificação de segundo fator (MFA).',
      code: 'MFA_REQUIRED',
      hint: 'Verifique seu código TOTP e tente novamente.',
    });
  });

  it('fail-open: em erro inesperado chama next', async () => {
    shouldBlockMock.mockRejectedValue(new Error('boom'));
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    await requireMFA(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
