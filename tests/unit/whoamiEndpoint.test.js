/**
 * GET /api/user/whoami — devolve identidade + is_admin para o front
 * decidir se renderiza o grupo "Administração" no sidebar, e devolve
 * `name`/`clinic_name` para renderizar brand row + profile row sem
 * outra request.
 *
 * Garantias:
 *   1. Sem auth → 401.
 *   2. Auth válido + user_roles=admin → 200 com is_admin: true.
 *   3. Auth válido sem role admin → 200 com is_admin: false.
 *   4. Busca de role falha → 200 com is_admin: false (degradação segura — nunca eleva).
 *   5. Profile do usuário devolve nome_completo/nome_clinica → 200 com name/clinic_name.
 *   6. Profile não existe → 200 com name=null/clinic_name=null.
 *   7. Falha ao buscar profile → 200 com name/clinic_name nulos (nunca quebra).
 */

const express = require('express');
const supertest = require('supertest');

describe('GET /api/user/whoami', () => {
  const ORIGINAL_ENV = { ...process.env };
  let fromMock;

  function mountApp({
    roleResult = { data: null, error: null },
    profileResult = { data: null, error: null },
    profileThrows = false,
    roleThrows = false,
    authUser = null,
  } = {}) {
    jest.resetModules();

    const roleMaybeSingleMock = jest.fn().mockImplementation(async () => {
      if (roleThrows) throw new Error('role lookup down');
      return roleResult;
    });
    const profileMaybeSingleMock = jest.fn().mockImplementation(async () => {
      if (profileThrows) throw new Error('supabase down');
      return profileResult;
    });
    fromMock = jest.fn((table) => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: table === 'user_roles' ? roleMaybeSingleMock : profileMaybeSingleMock,
        })),
      })),
    }));

    jest.doMock('../../src/db/supabase', () => ({
      from: fromMock,
    }));

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
    jest.doMock('../../src/services/auditLogService', () => ({
      log: jest.fn().mockResolvedValue(undefined),
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
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('auth + user_roles admin → 200 com is_admin: true e name/clinic_name', async () => {
    const app = mountApp({
      roleResult: { data: { role: 'admin' }, error: null },
      profileResult: {
        data: { nome_completo: 'Eric Guerrize', nome_clinica: 'Lumiz Clínica' },
        error: null,
      },
      authUser: { id: 'user-admin', email: 'admin@lumiz.com' },
    });

    const res = await supertest(app)
      .get('/api/user/whoami')
      .set('Authorization', 'Bearer fake-jwt');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      user_id: 'user-admin',
      email: 'admin@lumiz.com',
      name: 'Eric Guerrize',
      clinic_name: 'Lumiz Clínica',
      is_admin: true,
    });
    expect(fromMock).toHaveBeenCalledWith('user_roles');
  });

  it('auth sem role admin → 200 com is_admin: false', async () => {
    const app = mountApp({
      roleResult: { data: null, error: null },
      profileResult: {
        data: { nome_completo: 'Nathalia B.', nome_clinica: 'NB Clinic' },
        error: null,
      },
      authUser: { id: 'user-regular', email: 'nathalia@nbclinic.com' },
    });

    const res = await supertest(app)
      .get('/api/user/whoami')
      .set('Authorization', 'Bearer fake-jwt');

    expect(res.status).toBe(200);
    expect(res.body.is_admin).toBe(false);
    expect(res.body.user_id).toBe('user-regular');
    expect(res.body.name).toBe('Nathalia B.');
    expect(res.body.clinic_name).toBe('NB Clinic');
  });

  it('busca de role retorna error → 200 com is_admin: false (degradação segura)', async () => {
    const app = mountApp({
      roleResult: { data: null, error: { message: 'role unavailable' } },
    });

    const res = await supertest(app)
      .get('/api/user/whoami')
      .set('Authorization', 'Bearer fake-jwt');

    expect(res.status).toBe(200);
    expect(res.body.is_admin).toBe(false);
  });

  it('busca de role throw → 200 com is_admin: false (nunca eleva)', async () => {
    const app = mountApp({ roleThrows: true });

    const res = await supertest(app)
      .get('/api/user/whoami')
      .set('Authorization', 'Bearer fake-jwt');

    expect(res.status).toBe(200);
    expect(res.body.is_admin).toBe(false);
  });

  it('email pode ser null', async () => {
    const app = mountApp({
      authUser: { id: 'user-x' },
    });

    const res = await supertest(app)
      .get('/api/user/whoami')
      .set('Authorization', 'Bearer fake-jwt');

    expect(res.status).toBe(200);
    expect(res.body.email).toBeNull();
  });

  it('profile não encontrado → name/clinic_name nulos sem 500', async () => {
    const app = mountApp({
      profileResult: { data: null, error: null },
    });

    const res = await supertest(app)
      .get('/api/user/whoami')
      .set('Authorization', 'Bearer fake-jwt');

    expect(res.status).toBe(200);
    expect(res.body.name).toBeNull();
    expect(res.body.clinic_name).toBeNull();
  });

  it('falha ao buscar profile → name/clinic_name nulos (nunca quebra)', async () => {
    const app = mountApp({
      profileThrows: true,
    });

    const res = await supertest(app)
      .get('/api/user/whoami')
      .set('Authorization', 'Bearer fake-jwt');

    expect(res.status).toBe(200);
    expect(res.body.name).toBeNull();
    expect(res.body.clinic_name).toBeNull();
  });

  it('profile com campos vazios/null → name/clinic_name viram null', async () => {
    const app = mountApp({
      profileResult: { data: { nome_completo: '', nome_clinica: null }, error: null },
    });

    const res = await supertest(app)
      .get('/api/user/whoami')
      .set('Authorization', 'Bearer fake-jwt');

    expect(res.status).toBe(200);
    expect(res.body.name).toBeNull();
    expect(res.body.clinic_name).toBeNull();
  });
});
