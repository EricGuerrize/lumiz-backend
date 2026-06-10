/**
 * Env hardening — Asaas opcional no rollout inicial.
 *
 * O backend precisa subir em produção sem ASAAS_WEBHOOK_SECRET quando billing
 * Asaas ainda não está habilitado. O endpoint /api/webhooks/asaas continua
 * fail-closed (503) sem secret; esta suite cobre apenas a validação de startup.
 */

describe('EnvValidator — ASAAS_WEBHOOK_SECRET opcional na startup', () => {
  const ORIGINAL_ENV = { ...process.env };

  function loadValidator(overrides = {}) {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'production',
      SUPABASE_URL: 'https://lumiz.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'prod-service-role-key-real',
      WA_PHONE_NUMBER_ID: '123456789012345',
      WA_ACCESS_TOKEN: 'prod-meta-access-token-real',
      ...overrides,
    };
    if (overrides.ASAAS_WEBHOOK_SECRET === undefined) {
      delete process.env.ASAAS_WEBHOOK_SECRET;
    }
    return require('../../src/config/env').validator;
  }

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
  });

  it('não bloqueia startup em produção sem ASAAS_WEBHOOK_SECRET', () => {
    delete process.env.ASAAS_WEBHOOK_SECRET;
    const validator = loadValidator({ ASAAS_WEBHOOK_SECRET: undefined });

    const result = validator.validate();

    expect(result.valid).toBe(true);
    expect(result.errors).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining('ASAAS_WEBHOOK_SECRET é obrigatória'),
      ])
    );
  });

  it('continua rejeitando placeholder quando ASAAS_WEBHOOK_SECRET é configurada', () => {
    expect(() => loadValidator({ ASAAS_WEBHOOK_SECRET: 'change_me' })).toThrow(
      'Variáveis de ambiente obrigatórias não configuradas'
    );
  });
});
