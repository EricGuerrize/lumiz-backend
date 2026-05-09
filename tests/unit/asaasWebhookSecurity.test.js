/**
 * Hardening do webhook Asaas — fail-closed em produção.
 *
 * Garantias:
 *   1. NODE_ENV=production sem ASAAS_WEBHOOK_SECRET → 503 (fail-closed).
 *   2. NODE_ENV=production com SECRET correto → 200 + handleWebhook chamado.
 *   3. NODE_ENV=production com SECRET errado → 401 + handleWebhook NÃO chamado.
 *   4. NODE_ENV=development sem SECRET → 200 + warn (fail-open ergonômico).
 *   5. NODE_ENV=test sem SECRET → 200 (não polui suite com 503).
 *   6. SECRET ausente em produção é tratado como erro de config (503), não como
 *      "modo aberto".
 */

const express = require('express');
const supertest = require('supertest');

describe('Hardening — POST /api/webhooks/asaas', () => {
  const ORIGINAL_ENV = { ...process.env };
  let handleWebhookMock;

  function mountApp() {
    jest.resetModules();
    handleWebhookMock = jest.fn().mockResolvedValue(undefined);
    jest.doMock('../../src/services/paymentService', () => ({
      handleWebhook: handleWebhookMock,
    }));
    const router = require('../../src/routes/webhooks');
    const app = express();
    app.use(express.json());
    app.use('/api/webhooks', router);
    return app;
  }

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
  });

  describe('NODE_ENV=production', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    it('SEM ASAAS_WEBHOOK_SECRET → 503 (fail-closed) e não chama handler', async () => {
      delete process.env.ASAAS_WEBHOOK_SECRET;
      const app = mountApp();

      const res = await supertest(app)
        .post('/api/webhooks/asaas')
        .set('asaas-access-token', 'qualquer-coisa')
        .send({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } });

      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ error: expect.any(String) });
      expect(handleWebhookMock).not.toHaveBeenCalled();
    });

    it('COM SECRET correto → 200 + handler chamado', async () => {
      process.env.ASAAS_WEBHOOK_SECRET = 'segredo-prod-real';
      const app = mountApp();

      const res = await supertest(app)
        .post('/api/webhooks/asaas')
        .set('asaas-access-token', 'segredo-prod-real')
        .send({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ received: true });
      // handleWebhook é fire-and-forget; mas neste fluxo é chamado.
      // Aguardar microtask para garantir que dispatch ocorreu.
      await new Promise((r) => setImmediate(r));
      expect(handleWebhookMock).toHaveBeenCalledTimes(1);
      expect(handleWebhookMock).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'PAYMENT_RECEIVED' })
      );
    });

    it('COM SECRET configurado mas token ERRADO → 401 + handler NÃO chamado', async () => {
      process.env.ASAAS_WEBHOOK_SECRET = 'segredo-prod-real';
      const app = mountApp();

      const res = await supertest(app)
        .post('/api/webhooks/asaas')
        .set('asaas-access-token', 'token-forjado')
        .send({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } });

      expect(res.status).toBe(401);
      expect(handleWebhookMock).not.toHaveBeenCalled();
    });

    it('COM SECRET configurado mas SEM header → 401 + handler NÃO chamado', async () => {
      process.env.ASAAS_WEBHOOK_SECRET = 'segredo-prod-real';
      const app = mountApp();

      const res = await supertest(app)
        .post('/api/webhooks/asaas')
        .send({ event: 'PAYMENT_RECEIVED' });

      expect(res.status).toBe(401);
      expect(handleWebhookMock).not.toHaveBeenCalled();
    });
  });

  describe('NODE_ENV=development', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it('SEM SECRET → 200 + handler chamado (fail-open ergonômico)', async () => {
      delete process.env.ASAAS_WEBHOOK_SECRET;
      const app = mountApp();

      const res = await supertest(app)
        .post('/api/webhooks/asaas')
        .send({ event: 'PAYMENT_RECEIVED' });

      expect(res.status).toBe(200);
      await new Promise((r) => setImmediate(r));
      expect(handleWebhookMock).toHaveBeenCalledTimes(1);
    });

    it('COM SECRET errado → 401 mesmo em dev (consistência)', async () => {
      process.env.ASAAS_WEBHOOK_SECRET = 'segredo-dev';
      const app = mountApp();

      const res = await supertest(app)
        .post('/api/webhooks/asaas')
        .set('asaas-access-token', 'forjado')
        .send({ event: 'PAYMENT_RECEIVED' });

      expect(res.status).toBe(401);
      expect(handleWebhookMock).not.toHaveBeenCalled();
    });
  });

  describe('NODE_ENV=test', () => {
    it('SEM SECRET → 200 (não polui suite)', async () => {
      process.env.NODE_ENV = 'test';
      delete process.env.ASAAS_WEBHOOK_SECRET;
      const app = mountApp();

      const res = await supertest(app)
        .post('/api/webhooks/asaas')
        .send({ event: 'PAYMENT_RECEIVED' });

      expect(res.status).toBe(200);
    });
  });
});
