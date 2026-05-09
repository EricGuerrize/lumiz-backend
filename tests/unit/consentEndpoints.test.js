/**
 * Fase 19 — endpoints LGPD self-service para o web.
 *
 * GET /api/user/consent  → estado atual + flag needs_reconsent
 * POST /api/user/consent → grava re-consent (com optimistic-lock por versão)
 *
 * Garantias cobertas:
 *   - Sem auth → 401.
 *   - GET devolve { consent_given_at, accepted, active, needs_reconsent }.
 *   - GET devolve needs_reconsent=true quando o user nunca aceitou.
 *   - GET devolve needs_reconsent=true quando as versões mudaram.
 *   - GET degrada graciosamente quando o profile não é encontrado.
 *   - POST com body vazio aceita as versões ativas e responde 200.
 *   - POST com terms_version/privacy_version defasados → 409 + active no body.
 *   - POST idempotente: se já consentiu nas versões atuais, responde 200 com reused=true.
 *   - POST registra audit_log via consentService (verificado nos testes do service).
 */

const express = require('express');
const supertest = require('supertest');

describe('Fase 19 — /api/user/consent (endpoints web LGPD)', () => {
  const ORIGINAL_ENV = { ...process.env };
  let supabaseMock;
  let auditLogMock;
  let updateChain;

  function setActiveVersions({ terms = 'v2026-05-09', privacy = 'v2026-05-09' } = {}) {
    process.env.LUMIZ_TERMS_VERSION = terms;
    process.env.LUMIZ_PRIVACY_VERSION = privacy;
  }

  function buildSupabaseMock({ profile = null, selectError = null, updateError = null } = {}) {
    updateChain = {
      eq: jest.fn().mockResolvedValue({ error: updateError }),
    };

    return {
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn().mockResolvedValue({
              data: profile,
              error: selectError,
            }),
          })),
        })),
        update: jest.fn(() => updateChain),
      })),
    };
  }

  function mountApp({ profile, selectError, updateError, authUser } = {}) {
    jest.resetModules();

    supabaseMock = buildSupabaseMock({ profile, selectError, updateError });
    auditLogMock = { log: jest.fn().mockResolvedValue(undefined) };

    jest.doMock('../../src/db/supabase', () => supabaseMock);
    jest.doMock('../../src/services/auditLogService', () => auditLogMock);

    jest.doMock('../../src/middleware/authMiddleware', () => ({
      authenticateToken: (req, res, next) => {
        if (!req.headers.authorization) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        req.user = authUser || { id: 'user-uuid-1', email: 'web@lumiz.com' };
        return next();
      },
      authenticateFlexible: (req, res, next) => next(),
    }));

    jest.doMock('../../src/middleware/validationMiddleware', () => ({
      validate: () => (_req, _res, next) => next(),
    }));
    jest.doMock('../../src/validators/user.validators', () => ({
      linkEmailSchema: {},
    }));
    jest.doMock('../../src/services/lgpdService', () => ({
      collectUserData: jest.fn(),
      requestDeletionToken: jest.fn(),
      consumeDeletionToken: jest.fn(),
      executeDeletion: jest.fn(),
    }));
    jest.doMock('../../src/services/mfaService', () => ({
      getStatus: jest.fn(),
      logEvent: jest.fn(),
      VALID_EVENT_ACTIONS: new Set(['mfa_enrolled']),
    }));
    jest.doMock('../../src/controllers/userController', () => ({
      linkEmail: (_req, res) => res.json({ ok: true }),
    }));
    jest.doMock('../../src/copy/lgpdEmailCopy', () => ({
      exportEmail: jest.fn(),
      deletionConfirmEmail: jest.fn(),
    }));

    const router = require('../../src/routes/user.routes');
    const app = express();
    app.use(express.json());
    app.use('/api/user', router);
    return app;
  }

  beforeEach(() => {
    setActiveVersions();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
  });

  describe('GET /api/user/consent', () => {
    it('sem auth → 401', async () => {
      const app = mountApp();
      const res = await supertest(app).get('/api/user/consent');
      expect(res.status).toBe(401);
    });

    it('user nunca consentiu → needs_reconsent=true e accepted vazio', async () => {
      const app = mountApp({
        profile: {
          id: 'user-uuid-1',
          telefone: '+55659000',
          consent_given_at: null,
          terms_version: null,
          privacy_version: null,
        },
      });

      const res = await supertest(app)
        .get('/api/user/consent')
        .set('Authorization', 'Bearer fake');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        consent_given_at: null,
        accepted: { terms_version: null, privacy_version: null },
        active: { terms_version: 'v2026-05-09', privacy_version: 'v2026-05-09' },
        needs_reconsent: true,
      });
    });

    it('user consentiu nas versões atuais → needs_reconsent=false', async () => {
      const app = mountApp({
        profile: {
          id: 'user-uuid-1',
          telefone: '+55659000',
          consent_given_at: '2026-05-09T12:00:00Z',
          terms_version: 'v2026-05-09',
          privacy_version: 'v2026-05-09',
        },
      });

      const res = await supertest(app)
        .get('/api/user/consent')
        .set('Authorization', 'Bearer fake');

      expect(res.status).toBe(200);
      expect(res.body.needs_reconsent).toBe(false);
      expect(res.body.consent_given_at).toBe('2026-05-09T12:00:00Z');
      expect(res.body.accepted).toEqual({
        terms_version: 'v2026-05-09',
        privacy_version: 'v2026-05-09',
      });
    });

    it('versões mudaram (env atualizado) → needs_reconsent=true', async () => {
      setActiveVersions({ terms: 'v2026-06-01', privacy: 'v2026-06-01' });
      const app = mountApp({
        profile: {
          id: 'user-uuid-1',
          consent_given_at: '2026-05-09T12:00:00Z',
          terms_version: 'v2026-05-09',
          privacy_version: 'v2026-05-09',
        },
      });

      const res = await supertest(app)
        .get('/api/user/consent')
        .set('Authorization', 'Bearer fake');

      expect(res.status).toBe(200);
      expect(res.body.needs_reconsent).toBe(true);
      expect(res.body.active).toEqual({
        terms_version: 'v2026-06-01',
        privacy_version: 'v2026-06-01',
      });
      expect(res.body.accepted).toEqual({
        terms_version: 'v2026-05-09',
        privacy_version: 'v2026-05-09',
      });
    });

    it('profile não encontrado → degrada para needs_reconsent=true sem 500', async () => {
      const app = mountApp({ profile: null });

      const res = await supertest(app)
        .get('/api/user/consent')
        .set('Authorization', 'Bearer fake');

      expect(res.status).toBe(200);
      expect(res.body.needs_reconsent).toBe(true);
    });
  });

  describe('POST /api/user/consent', () => {
    it('sem auth → 401', async () => {
      const app = mountApp();
      const res = await supertest(app).post('/api/user/consent').send({});
      expect(res.status).toBe(401);
    });

    it('body vazio + user nunca consentiu → 200 grava e devolve accepted', async () => {
      const app = mountApp({
        profile: {
          id: 'user-uuid-1',
          consent_given_at: null,
          terms_version: null,
          privacy_version: null,
        },
      });

      const res = await supertest(app)
        .post('/api/user/consent')
        .set('Authorization', 'Bearer fake')
        .set('User-Agent', 'web-dashboard/1.0')
        .set('X-Forwarded-For', '203.0.113.10')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.reused).toBe(false);
      expect(res.body.accepted).toEqual({
        consent_given_at: expect.any(String),
        terms_version: 'v2026-05-09',
        privacy_version: 'v2026-05-09',
      });
      // Update foi feito via supabase.from('profiles').update(...).eq('id', ...)
      expect(updateChain.eq).toHaveBeenCalledWith('id', 'user-uuid-1');
      // Audit log foi disparado fire-and-forget
      expect(auditLogMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-uuid-1',
          action: 'consent_given',
          entityType: 'profile',
        })
      );
    });

    it('user já consentiu nas versões atuais → 200 reused=true sem regravar', async () => {
      const app = mountApp({
        profile: {
          id: 'user-uuid-1',
          consent_given_at: '2026-05-09T12:00:00Z',
          terms_version: 'v2026-05-09',
          privacy_version: 'v2026-05-09',
        },
      });

      const res = await supertest(app)
        .post('/api/user/consent')
        .set('Authorization', 'Bearer fake')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.reused).toBe(true);
      expect(updateChain.eq).not.toHaveBeenCalled();
      expect(auditLogMock.log).not.toHaveBeenCalled();
    });

    it('body com terms_version defasada → 409 + active devolvido', async () => {
      const app = mountApp({
        profile: {
          id: 'user-uuid-1',
          consent_given_at: '2026-05-09T12:00:00Z',
          terms_version: 'v2026-05-09',
          privacy_version: 'v2026-05-09',
        },
      });

      const res = await supertest(app)
        .post('/api/user/consent')
        .set('Authorization', 'Bearer fake')
        .send({ terms_version: 'v2025-01-01', privacy_version: 'v2026-05-09' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('version_mismatch');
      expect(res.body.active).toEqual({
        terms_version: 'v2026-05-09',
        privacy_version: 'v2026-05-09',
      });
      expect(updateChain.eq).not.toHaveBeenCalled();
    });

    it('body com versões batendo → grava normalmente', async () => {
      const app = mountApp({
        profile: {
          id: 'user-uuid-1',
          consent_given_at: null,
          terms_version: null,
          privacy_version: null,
        },
      });

      const res = await supertest(app)
        .post('/api/user/consent')
        .set('Authorization', 'Bearer fake')
        .send({
          terms_version: 'v2026-05-09',
          privacy_version: 'v2026-05-09',
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(updateChain.eq).toHaveBeenCalledTimes(1);
    });

    it('falha ao atualizar profile → 500 com error consent_record_failed', async () => {
      const app = mountApp({
        profile: {
          id: 'user-uuid-1',
          consent_given_at: null,
          terms_version: null,
          privacy_version: null,
        },
        updateError: { message: 'rls denied' },
      });

      const res = await supertest(app)
        .post('/api/user/consent')
        .set('Authorization', 'Bearer fake')
        .send({});

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('consent_record_failed');
    });
  });
});
