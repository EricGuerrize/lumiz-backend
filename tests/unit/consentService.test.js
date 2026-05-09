/**
 * LGPD compliance — persistência de consentimento.
 *
 * Garantias:
 *   1. recordConsent persiste consent_given_at + terms_version + privacy_version
 *      em profiles para o telefone informado.
 *   2. Persiste consent_ip e consent_user_agent quando req fornecido.
 *   3. Grava entry em audit_log (action='consent_given', entity_type='profile').
 *   4. Não sobrescreve consent_given_at se já existir e versões iguais
 *      (idempotente).
 *   5. Re-grava se a versão dos termos mudou (re-consent obrigatório).
 *   6. Fire-and-forget — falha de DB nunca derruba o caller.
 *   7. Versão usada vem de getActiveVersions() (env-overridable).
 */

describe('LGPD — consentService', () => {
  const ORIGINAL_ENV = { ...process.env };
  let consentService;
  let supabaseMock;
  let auditLogMock;

  // FakeChain: simula a API do supabase-js (chainable + thenable).
  function makeChain(resolveValue) {
    let resolver = resolveValue;
    const chain = {
      from: jest.fn().mockReturnValue(undefined),
      select: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      upsert: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue(resolver),
      single: jest.fn().mockResolvedValue(resolver),
      then: (fn) => Promise.resolve(resolver).then(fn),
    };
    return chain;
  }

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    process.env.LUMIZ_TERMS_VERSION = '2026-05-09';
    process.env.LUMIZ_PRIVACY_VERSION = '2026-05-09';

    auditLogMock = jest.fn().mockResolvedValue();

    jest.doMock('../../src/services/auditLogService', () => ({
      log: auditLogMock,
    }));

    // Mock supabase: from(table) volta um chain configurável por chamada.
    const profilesByPhone = new Map();
    let lastUpdatePayload = null;
    let lastInsertPayload = null;
    supabaseMock = {
      _state: { profilesByPhone, lastUpdatePayload: null, lastInsertPayload: null },
      from: jest.fn((table) => {
        const chain = {
          _table: table,
          _filters: {},
          _payload: null,
          _operation: null,
          select: jest.fn(function () { this._operation = this._operation || 'select'; return this; }),
          update: jest.fn(function (payload) { this._operation = 'update'; this._payload = payload; return this; }),
          insert: jest.fn(function (payload) { this._operation = 'insert'; this._payload = payload; return this; }),
          upsert: jest.fn(function (payload) { this._operation = 'upsert'; this._payload = payload; return this; }),
          eq: jest.fn(function (col, val) { this._filters[col] = val; return this; }),
          maybeSingle: jest.fn(async function () {
            if (this._table === 'profiles' && this._operation === 'select') {
              const phone = this._filters.telefone;
              const profile = phone != null ? profilesByPhone.get(phone) : null;
              return { data: profile || null, error: null };
            }
            return { data: null, error: null };
          }),
          single: jest.fn(async function () {
            return { data: this._payload || null, error: null };
          }),
          then: function (fn) {
            // Quando o chain é awaitado direto (sem .single/.maybeSingle),
            // resolve com null e dispara side effects.
            if (this._operation === 'update' && this._table === 'profiles') {
              const filters = this._filters;
              // Aceita update via .eq('telefone', ...) OU via .eq('id', ...).
              if (filters.telefone != null) {
                const existing = profilesByPhone.get(filters.telefone);
                profilesByPhone.set(filters.telefone, {
                  ...(existing || {}),
                  telefone: filters.telefone,
                  ...this._payload,
                });
              } else if (filters.id != null) {
                // Resolve phone reverso buscando o profile por id no Map.
                for (const [phone, prof] of profilesByPhone.entries()) {
                  if (prof?.id === filters.id) {
                    profilesByPhone.set(phone, { ...prof, ...this._payload });
                    break;
                  }
                }
              }
              supabaseMock._state.lastUpdatePayload = this._payload;
            }
            if (this._operation === 'insert' && this._table === 'profiles') {
              supabaseMock._state.lastInsertPayload = this._payload;
            }
            return Promise.resolve({ data: null, error: null }).then(fn);
          },
        };
        return chain;
      }),
    };

    jest.doMock('../../src/db/supabase', () => supabaseMock);

    consentService = require('../../src/services/consentService');
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
  });

  function seedProfile(phone, fields = {}) {
    supabaseMock._state.profilesByPhone.set(phone, {
      id: fields.id || 'user-uuid-1',
      telefone: phone,
      nome: fields.nome || 'NB Clinic',
      consent_given_at: fields.consent_given_at || null,
      terms_version: fields.terms_version || null,
      privacy_version: fields.privacy_version || null,
    });
  }

  describe('getActiveVersions()', () => {
    it('lê de env vars LUMIZ_TERMS_VERSION e LUMIZ_PRIVACY_VERSION', () => {
      const v = consentService.getActiveVersions();
      expect(v).toEqual({
        termsVersion: '2026-05-09',
        privacyVersion: '2026-05-09',
      });
    });

    it('aplica defaults quando env ausente', () => {
      jest.resetModules();
      delete process.env.LUMIZ_TERMS_VERSION;
      delete process.env.LUMIZ_PRIVACY_VERSION;
      const fresh = require('../../src/services/consentService');
      const v = fresh.getActiveVersions();
      expect(typeof v.termsVersion).toBe('string');
      expect(typeof v.privacyVersion).toBe('string');
      expect(v.termsVersion.length).toBeGreaterThan(0);
      expect(v.privacyVersion.length).toBeGreaterThan(0);
    });
  });

  describe('recordConsent()', () => {
    it('persiste consent_given_at + versions em profiles para o telefone', async () => {
      seedProfile('+5566912345678');

      await consentService.recordConsent({
        phone: '+5566912345678',
        req: {
          ip: '177.10.20.30',
          headers: { 'user-agent': 'WhatsApp/2.24' },
        },
      });

      const updated = supabaseMock._state.profilesByPhone.get('+5566912345678');
      expect(updated.consent_given_at).toBeTruthy();
      expect(new Date(updated.consent_given_at).toString()).not.toBe('Invalid Date');
      expect(updated.terms_version).toBe('2026-05-09');
      expect(updated.privacy_version).toBe('2026-05-09');
      expect(updated.consent_ip).toBe('177.10.20.30');
      expect(updated.consent_user_agent).toBe('WhatsApp/2.24');
    });

    it('grava audit_log com action=consent_given e entityType=profile', async () => {
      seedProfile('+5566912345678');

      await consentService.recordConsent({
        phone: '+5566912345678',
        req: { ip: '1.2.3.4', headers: { 'user-agent': 'WhatsApp/2.24' } },
      });

      expect(auditLogMock).toHaveBeenCalledTimes(1);
      const call = auditLogMock.mock.calls[0][0];
      expect(call.action).toBe('consent_given');
      expect(call.entityType).toBe('profile');
      expect(call.userId).toBe('user-uuid-1');
      expect(call.newValue).toMatchObject({
        terms_version: '2026-05-09',
        privacy_version: '2026-05-09',
      });
    });

    it('idempotente: já existe consent com versões iguais → não regrava nem audita', async () => {
      seedProfile('+5566912345678', {
        consent_given_at: '2026-05-08T10:00:00.000Z',
        terms_version: '2026-05-09',
        privacy_version: '2026-05-09',
      });

      const res = await consentService.recordConsent({
        phone: '+5566912345678',
        req: { ip: '1.2.3.4', headers: {} },
      });

      expect(res.skipped).toBe(true);
      expect(auditLogMock).not.toHaveBeenCalled();
      const updated = supabaseMock._state.profilesByPhone.get('+5566912345678');
      expect(updated.consent_given_at).toBe('2026-05-08T10:00:00.000Z');
    });

    it('re-consent: termos mudaram → atualiza e audita novamente', async () => {
      seedProfile('+5566912345678', {
        consent_given_at: '2026-04-01T10:00:00.000Z',
        terms_version: '2026-04-01',
        privacy_version: '2026-04-01',
      });

      await consentService.recordConsent({
        phone: '+5566912345678',
        req: { ip: '1.2.3.4', headers: {} },
      });

      const updated = supabaseMock._state.profilesByPhone.get('+5566912345678');
      expect(updated.terms_version).toBe('2026-05-09');
      expect(updated.privacy_version).toBe('2026-05-09');
      expect(updated.consent_given_at).not.toBe('2026-04-01T10:00:00.000Z');
      expect(auditLogMock).toHaveBeenCalledTimes(1);
      expect(auditLogMock.mock.calls[0][0].oldValue).toMatchObject({
        terms_version: '2026-04-01',
        privacy_version: '2026-04-01',
      });
    });

    it('telefone sem perfil cadastrado: não lança e não audita (mas avisa)', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const res = await consentService.recordConsent({
        phone: '+5500000000000',
        req: { ip: '1.2.3.4', headers: {} },
      });

      expect(res.skipped).toBe(true);
      expect(res.reason).toMatch(/profile/i);
      expect(auditLogMock).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('phone null/vazio: rejeita silenciosamente', async () => {
      const res = await consentService.recordConsent({ phone: null });
      expect(res.skipped).toBe(true);
    });

    it('fire-and-forget: erro de DB não lança', async () => {
      // Substitui from() para sempre rejeitar
      supabaseMock.from = jest.fn(() => {
        throw new Error('DB exploded');
      });

      await expect(
        consentService.recordConsent({
          phone: '+5566912345678',
          req: { ip: '1.2.3.4', headers: {} },
        })
      ).resolves.toBeDefined();
    });

    it('extrai IP de x-forwarded-for quando req.ip ausente', async () => {
      seedProfile('+5566912345678');

      await consentService.recordConsent({
        phone: '+5566912345678',
        req: {
          headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1', 'user-agent': 'WhatsApp' },
        },
      });

      const updated = supabaseMock._state.profilesByPhone.get('+5566912345678');
      expect(updated.consent_ip).toBe('203.0.113.5');
    });
  });

  describe('hasGivenConsent()', () => {
    it('retorna true quando consent_given_at presente e versões batem com as ativas', async () => {
      seedProfile('+5566912345678', {
        consent_given_at: '2026-05-09T10:00:00.000Z',
        terms_version: '2026-05-09',
        privacy_version: '2026-05-09',
      });
      const ok = await consentService.hasGivenConsent({ phone: '+5566912345678' });
      expect(ok).toBe(true);
    });

    it('retorna false quando consent_given_at ausente', async () => {
      seedProfile('+5566912345678');
      const ok = await consentService.hasGivenConsent({ phone: '+5566912345678' });
      expect(ok).toBe(false);
    });

    it('retorna false quando versão de termos diferente da ativa', async () => {
      seedProfile('+5566912345678', {
        consent_given_at: '2026-04-01T10:00:00.000Z',
        terms_version: '2026-04-01',
        privacy_version: '2026-04-01',
      });
      const ok = await consentService.hasGivenConsent({ phone: '+5566912345678' });
      expect(ok).toBe(false);
    });
  });
});
