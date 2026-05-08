/**
 * Fase 16 — Smoke do endpoint GET /api/config/features.
 *
 * Garante que:
 *   1. Resposta sempre traz a whitelist completa (defaults aplicados).
 *   2. Flags fora da whitelist são silenciosamente descartadas.
 *   3. Sem token, `resolvedFor.user_id` é null e `listForUser(null)` é chamado.
 *   4. Com token válido, `resolvedFor.user_id` reflete o usuário.
 *   5. Falha do service degrada para defaults sem 5xx.
 */

const express = require('express');
const request = require('supertest');

const REGISTRY_PATH = '../../src/config/featureFlagsRegistry';

describe('Fase 16 — GET /api/config/features', () => {
  let listForUserMock;
  let getUserMock;
  let app;

  function buildApp() {
    jest.resetModules();

    listForUserMock = jest.fn();
    getUserMock = jest.fn();

    jest.doMock('../../src/db/supabase', () => ({
      auth: { getUser: (...args) => getUserMock(...args) }
    }));
    jest.doMock('../../src/services/featureFlagService', () => ({
      listForUser: (...args) => listForUserMock(...args)
    }));

    const router = require('../../src/routes/config.routes');
    const a = express();
    a.use('/api/config', router);
    app = a;
  }

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('retorna whitelist completa com defaults aplicados quando service responde {}', async () => {
    buildApp();
    listForUserMock.mockResolvedValue({});

    const res = await request(app).get('/api/config/features').expect(200);

    const { listKnownFlagNames, getDefaultsObject } = require(REGISTRY_PATH);
    const expectedKeys = listKnownFlagNames();
    expect(Object.keys(res.body.flags).sort()).toEqual(expectedKeys.slice().sort());
    expect(res.body.flags).toEqual(getDefaultsObject());
    expect(res.body.descriptions.alter_enabled).toMatch(/alter/i);
    expect(typeof res.body.meta.generated_at).toBe('string');
    expect(res.body.resolvedFor.user_id).toBeNull();
  });

  it('descarta flags fora da whitelist e respeita as conhecidas', async () => {
    buildApp();
    listForUserMock.mockResolvedValue({
      alter_enabled: true,
      excel_import: true,
      flag_interna_secreta: true,
      another_unknown: false
    });

    const res = await request(app).get('/api/config/features').expect(200);

    expect(res.body.flags.alter_enabled).toBe(true);
    expect(res.body.flags.excel_import).toBe(true);
    expect(res.body.flags.flag_interna_secreta).toBeUndefined();
    expect(res.body.flags.another_unknown).toBeUndefined();
    expect(res.body.flags.multi_tenant).toBe(false);
  });

  it('sem Authorization header, chama listForUser com null', async () => {
    buildApp();
    listForUserMock.mockResolvedValue({});

    await request(app).get('/api/config/features').expect(200);

    expect(getUserMock).not.toHaveBeenCalled();
    expect(listForUserMock).toHaveBeenCalledWith(null);
  });

  it('com Bearer token válido, propaga user_id e o devolve em resolvedFor', async () => {
    buildApp();
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null });
    listForUserMock.mockResolvedValue({ alter_enabled: true });

    const res = await request(app)
      .get('/api/config/features')
      .set('Authorization', 'Bearer abc.def.ghi')
      .expect(200);

    expect(getUserMock).toHaveBeenCalledWith('abc.def.ghi');
    expect(listForUserMock).toHaveBeenCalledWith('user-123');
    expect(res.body.resolvedFor.user_id).toBe('user-123');
    expect(res.body.flags.alter_enabled).toBe(true);
  });

  it('Bearer token inválido NÃO bloqueia: degrada para anônimo (200)', async () => {
    buildApp();
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });
    listForUserMock.mockResolvedValue({});

    const res = await request(app)
      .get('/api/config/features')
      .set('Authorization', 'Bearer invalido')
      .expect(200);

    expect(listForUserMock).toHaveBeenCalledWith(null);
    expect(res.body.resolvedFor.user_id).toBeNull();
  });

  it('quando listForUser dá erro, degrada para defaults sem 5xx', async () => {
    buildApp();
    listForUserMock.mockRejectedValue(new Error('db down'));

    const res = await request(app).get('/api/config/features').expect(200);

    const { getDefaultsObject } = require(REGISTRY_PATH);
    expect(res.body.flags).toEqual(getDefaultsObject());
  });
});
