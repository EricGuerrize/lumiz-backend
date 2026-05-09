/**
 * Fase 17 — PostHog analytics service.
 *
 * Garantias:
 *   1. Sem POSTHOG_API_KEY o serviço é no-op silencioso (graceful degradation).
 *   2. Com chave, capture/identify chamam o cliente PostHog corretamente.
 *   3. Erros do cliente NUNCA derrubam quem chama (fire-and-forget).
 *   4. Flag `posthog_enabled` controla envio por user/global.
 *   5. shutdown chama flush() do cliente.
 */

describe('Fase 17 — posthogService', () => {
  const ORIGINAL_ENV = { ...process.env };
  let posthogService;
  let captureMock;
  let identifyMock;
  let shutdownMock;
  let isEnabledMock;
  let PostHogCtorMock;

  beforeEach(() => {
    jest.resetModules();

    captureMock = jest.fn();
    identifyMock = jest.fn();
    shutdownMock = jest.fn().mockResolvedValue();
    isEnabledMock = jest.fn().mockResolvedValue(true);

    PostHogCtorMock = jest.fn().mockImplementation(() => ({
      capture: captureMock,
      identify: identifyMock,
      shutdown: shutdownMock,
      on: jest.fn(),
    }));

    jest.doMock('posthog-node', () => ({
      PostHog: PostHogCtorMock,
    }));

    jest.doMock('../../src/services/featureFlagService', () => ({
      isEnabled: isEnabledMock,
    }));
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
  });

  describe('graceful degradation (sem POSTHOG_API_KEY)', () => {
    beforeEach(() => {
      delete process.env.POSTHOG_API_KEY;
      delete process.env.POSTHOG_HOST;
      posthogService = require('../../src/services/posthogService');
    });

    it('isConfigured retorna false quando POSTHOG_API_KEY ausente', () => {
      expect(posthogService.isConfigured()).toBe(false);
    });

    it('init() não instancia cliente quando sem chave', () => {
      const ok = posthogService.init();
      expect(ok).toBe(false);
      expect(PostHogCtorMock).not.toHaveBeenCalled();
    });

    it('capture() é no-op (não chama cliente, não lança)', async () => {
      await expect(
        posthogService.capture({
          distinctId: 'user-1',
          event: 'transaction_created',
          properties: { valor: 100 },
        })
      ).resolves.toBeUndefined();
      expect(captureMock).not.toHaveBeenCalled();
    });

    it('identify() é no-op', async () => {
      await expect(
        posthogService.identify({
          distinctId: 'user-1',
          properties: { name: 'NB Clinic' },
        })
      ).resolves.toBeUndefined();
      expect(identifyMock).not.toHaveBeenCalled();
    });

    it('shutdown() é no-op (não lança)', async () => {
      await expect(posthogService.shutdown()).resolves.toBeUndefined();
      expect(shutdownMock).not.toHaveBeenCalled();
    });
  });

  describe('com POSTHOG_API_KEY configurada', () => {
    beforeEach(() => {
      process.env.POSTHOG_API_KEY = 'phc_fake_test_key';
      process.env.POSTHOG_HOST = 'https://us.i.posthog.com';
      posthogService = require('../../src/services/posthogService');
    });

    it('isConfigured retorna true', () => {
      expect(posthogService.isConfigured()).toBe(true);
    });

    it('init() instancia cliente com host customizado', () => {
      const ok = posthogService.init();
      expect(ok).toBe(true);
      expect(PostHogCtorMock).toHaveBeenCalledTimes(1);
      expect(PostHogCtorMock).toHaveBeenCalledWith(
        'phc_fake_test_key',
        expect.objectContaining({ host: 'https://us.i.posthog.com' })
      );
    });

    it('init() é idempotente (não recria cliente)', () => {
      posthogService.init();
      posthogService.init();
      posthogService.init();
      expect(PostHogCtorMock).toHaveBeenCalledTimes(1);
    });

    it('capture() chama cliente com event + properties + sourceTag', async () => {
      await posthogService.capture({
        distinctId: 'user-123',
        event: 'transaction_created',
        properties: { valor: 1500, source: 'whatsapp' },
      });

      expect(isEnabledMock).toHaveBeenCalledWith('posthog_enabled', 'user-123');
      expect(captureMock).toHaveBeenCalledTimes(1);
      const call = captureMock.mock.calls[0][0];
      expect(call.distinctId).toBe('user-123');
      expect(call.event).toBe('transaction_created');
      expect(call.properties).toMatchObject({
        valor: 1500,
        source: 'whatsapp',
        $lib: 'lumiz-backend',
      });
    });

    it('capture() respeita flag posthog_enabled OFF (não envia)', async () => {
      isEnabledMock.mockResolvedValue(false);
      await posthogService.capture({
        distinctId: 'user-123',
        event: 'transaction_created',
      });
      expect(captureMock).not.toHaveBeenCalled();
    });

    it('capture() sem distinctId mas com event ainda envia (eventos anônimos do webhook)', async () => {
      await posthogService.capture({
        event: 'whatsapp_inbound',
        properties: { phone_hash: 'abc' },
      });
      expect(captureMock).toHaveBeenCalledTimes(1);
      const call = captureMock.mock.calls[0][0];
      expect(call.distinctId).toBeTruthy();
      expect(call.event).toBe('whatsapp_inbound');
    });

    it('capture() ignora chamadas sem event', async () => {
      await posthogService.capture({ distinctId: 'user-1' });
      expect(captureMock).not.toHaveBeenCalled();
    });

    it('capture() não lança quando cliente PostHog throws', async () => {
      captureMock.mockImplementation(() => {
        throw new Error('PostHog ingestion failure');
      });
      await expect(
        posthogService.capture({
          distinctId: 'user-1',
          event: 'transaction_created',
        })
      ).resolves.toBeUndefined();
    });

    it('identify() chama cliente com traits', async () => {
      await posthogService.identify({
        distinctId: 'user-123',
        properties: { tier: 'paid', clinic_name: 'NB Clinic' },
      });
      expect(identifyMock).toHaveBeenCalledTimes(1);
      const call = identifyMock.mock.calls[0][0];
      expect(call.distinctId).toBe('user-123');
      expect(call.properties).toMatchObject({
        tier: 'paid',
        clinic_name: 'NB Clinic',
      });
    });

    it('identify() ignora quando flag posthog_enabled OFF', async () => {
      isEnabledMock.mockResolvedValue(false);
      await posthogService.identify({
        distinctId: 'user-123',
        properties: { tier: 'paid' },
      });
      expect(identifyMock).not.toHaveBeenCalled();
    });

    it('identify() exige distinctId', async () => {
      await posthogService.identify({ properties: { tier: 'paid' } });
      expect(identifyMock).not.toHaveBeenCalled();
    });

    it('identify() não lança em erro do cliente', async () => {
      identifyMock.mockImplementation(() => { throw new Error('boom'); });
      await expect(
        posthogService.identify({ distinctId: 'u', properties: {} })
      ).resolves.toBeUndefined();
    });

    it('shutdown() chama shutdown() do cliente', async () => {
      posthogService.init();
      await posthogService.shutdown();
      expect(shutdownMock).toHaveBeenCalledTimes(1);
    });

    it('shutdown() não lança em erro', async () => {
      shutdownMock.mockRejectedValue(new Error('flush failed'));
      posthogService.init();
      await expect(posthogService.shutdown()).resolves.toBeUndefined();
    });

    it('mascara propriedades sensíveis (cpf, password, token, pix_chave)', async () => {
      await posthogService.capture({
        distinctId: 'u',
        event: 'profile_updated',
        properties: {
          cpf: '12345678900',
          password: 'secret',
          access_token: 'jwt-aqui',
          pix_chave: 'minha@pix.com',
          phone: '+5566912345678',
          valor: 100,
        },
      });
      const props = captureMock.mock.calls[0][0].properties;
      expect(props.cpf).toBe('[REDACTED]');
      expect(props.password).toBe('[REDACTED]');
      expect(props.access_token).toBe('[REDACTED]');
      expect(props.pix_chave).toBe('[REDACTED]');
      expect(props.valor).toBe(100);
    });
  });

  describe('integração com analyticsService.track (espelhamento)', () => {
    let analyticsService;
    let supabaseInsertMock;

    beforeEach(() => {
      process.env.POSTHOG_API_KEY = 'phc_fake_test_key';
      supabaseInsertMock = jest.fn().mockResolvedValue({ error: null });

      jest.doMock('../../src/db/supabase', () => ({
        from: jest.fn().mockReturnValue({ insert: supabaseInsertMock }),
      }));
      jest.doMock('posthog-node', () => ({ PostHog: PostHogCtorMock }));
      jest.doMock('../../src/services/featureFlagService', () => ({
        isEnabled: isEnabledMock,
      }));

      analyticsService = require('../../src/services/analyticsService');
    });

    it('analyticsService.track espelha evento no PostHog quando userId presente', async () => {
      await analyticsService.track('transaction_created', {
        userId: 'user-abc',
        phone: '+5566912345678',
        source: 'whatsapp',
        properties: { valor: 100 },
      });

      expect(supabaseInsertMock).toHaveBeenCalledTimes(1);
      expect(captureMock).toHaveBeenCalledTimes(1);
      const phEvent = captureMock.mock.calls[0][0];
      expect(phEvent.event).toBe('transaction_created');
      expect(phEvent.distinctId).toBe('user-abc');
      expect(phEvent.properties).toMatchObject({ valor: 100, source: 'whatsapp' });
    });

    it('analyticsService.track ainda salva no Supabase mesmo se PostHog estiver off', async () => {
      delete process.env.POSTHOG_API_KEY;
      jest.resetModules();
      jest.doMock('../../src/db/supabase', () => ({
        from: jest.fn().mockReturnValue({ insert: supabaseInsertMock }),
      }));
      analyticsService = require('../../src/services/analyticsService');

      await analyticsService.track('transaction_created', {
        userId: 'user-abc',
        properties: { valor: 100 },
      });

      expect(supabaseInsertMock).toHaveBeenCalledTimes(1);
    });
  });
});
