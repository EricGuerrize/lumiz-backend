/**
 * GET /api/user/whoami — devolve identidade + is_admin para o front
 * decidir se renderiza o grupo "Administração" no sidebar.
 *
 * Garantias:
 *   1. Sem auth → 401.
 *   2. Auth válido + is_user_admin RPC=true → 200 com is_admin: true.
 *   3. Auth válido + is_user_admin RPC=false → 200 com is_admin: false.
 *   4. RPC falha → 200 com is_admin: false (degradação segura — nunca eleva).
 */

const express = require('express');
const supertest = require('supertest');

describe('GET /api/user/whoami', () => {
  const ORIGINAL_ENV = { ...process.env };
  let rpcMock;

  function mountApp({ rpcResult = { data: false, error: null }, authUser = null } = {}) {
    jest.resetModules();

    rpcMock = jest.fn().mockImplementation(async () => {
      if (rpcResult instanceof Error) throw rpcResult;
      return rpcResult;
    });

    jest.doMock('../../src/db/supabase', () => ({
      rpc: rpcMock,
    }));

    // Auth middleware: simula authenticateToken — se header presente, injeta user.
    jest.doMock('../../src/middleware/authMiddleware', () => ({
      authenticateToken: (req, res, next) => {
        if (!req.headers.authorization) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        req.user = authUser || { id: 'user-uuid-1', email: 'admin@lumiz.com' };
        return next();
      },
      authenticateFlexible: (req, res, next) => next(),
    }));

    // Mocks adicionais para evitar side-effects da rota
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

    const router = require('../../src/routes/user.routes');
    const app = express();
    app.use(express.json());
    app.use('/api/user', router);
    return app;
  }

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
  });

  it('sem auth → 401', async () => {
    const app = mountApp();
    const res = await supertest(app).get('/api/user/whoami');
    expect(res.status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('auth + RPC retorna true → 200 com is_admin: true', async () => {
    const app = mountApp({
      rpcResult: { data: true, error: null },
      authUser: { id: 'user-admin', email: 'admin@lumiz.com' },
    });

    const res = await supertest(app)
      .get('/api/user/whoami')
      .set('Authorization', 'Bearer fake-jwt');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      user_id: 'user-admin',
      email: 'admin@lumiz.com',
      is_admin: true,
    });
    expect(rpcMock).toHaveBeenCalledWith('is_user_admin', { p_user_id: 'user-admin' });
  });

  it('auth + RPC retorna false → 200 com is_admin: false', async () => {
    const app = mountApp({
      rpcResult: { data: false, error: null },
      authUser: { id: 'user-regular', email: 'nathalia@nbclinic.com' },
    });

    const res = await supertest(app)
      .get('/api/user/whoami')
      .set('Authorization', 'Bearer fake-jwt');

    expect(res.status).toBe(200);
    expect(res.body.is_admin).toBe(false);
    expect(res.body.user_id).toBe('user-regular');
  });

  it('RPC retorna error → 200 com is_admin: false (degradação segura)', async () => {
    const app = mountApp({
      rpcResult: { data: null, error: { message: 'rpc unavailable' } },
    });

    const res = await supertest(app)
      .get('/api/user/whoami')
      .set('Authorization', 'Bearer fake-jwt');

    expect(res.status).toBe(200);
    expect(res.body.is_admin).toBe(false);
  });

  it('RPC throw → 200 com is_admin: false (nunca eleva)', async () => {
    const app = mountApp({ rpcResult: new Error('exploded') });

    const res = await supertest(app)
      .get('/api/user/whoami')
      .set('Authorization', 'Bearer fake-jwt');

    expect(res.status).toBe(200);
    expect(res.body.is_admin).toBe(false);
  });

  it('email pode ser null', async () => {
    const app = mountApp({
      rpcResult: { data: false, error: null },
      authUser: { id: 'user-x' }, // sem email
    });

    const res = await supertest(app)
      .get('/api/user/whoami')
      .set('Authorization', 'Bearer fake-jwt');

    expect(res.status).toBe(200);
    expect(res.body.email).toBeNull();
  });
});
