const express = require('express');
const paymentService = require('../services/paymentService');

const router = express.Router();

/**
 * Webhook Asaas — handler de eventos de billing/assinatura.
 *
 * Hardening:
 *   - Em NODE_ENV=production, ASAAS_WEBHOOK_SECRET é OBRIGATÓRIA. Sem ela,
 *     respondemos 503 (fail-closed). Não há "modo aberto" implícito em prod —
 *     evita fraude de billing caso a env var seja esquecida no deploy.
 *   - Em production COM secret: token errado → 401, token correto → 200.
 *   - Em development/test SEM secret: log de warning + processa normalmente
 *     (ergonomia local). Em DEV COM secret, ainda exigimos token correto
 *     para que dev espelhe prod.
 *
 * O handler responde 200 imediatamente (sem aguardar `paymentService.handleWebhook`)
 * porque o Asaas usa retentativas agressivas em timeout — o processamento é
 * fire-and-forget no servidor.
 */
router.post('/asaas', async (req, res) => {
  const env = process.env.NODE_ENV || 'development';
  const secret = process.env.ASAAS_WEBHOOK_SECRET;
  const token = req.headers['asaas-access-token'];

  // Fail-closed em produção sem secret configurado.
  if (env === 'production' && !secret) {
    console.error(
      '[WEBHOOK/ASAAS] BLOQUEADO: ASAAS_WEBHOOK_SECRET não configurada em produção. ' +
      'Configure a env var para liberar o webhook.'
    );
    return res.status(503).json({
      error: 'asaas_webhook_secret_not_configured',
      message: 'Webhook indisponível: secret não configurada no servidor.',
    });
  }

  // Quando há secret configurado (prod ou dev/test), exige token correto.
  if (secret && token !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Em dev/test sem secret, avisa mas segue.
  if (!secret && env !== 'production') {
    console.warn(
      `[WEBHOOK/ASAAS] ASAAS_WEBHOOK_SECRET não configurada (${env}). ` +
      `Aceitando webhook sem validação — NÃO USE EM PRODUÇÃO.`
    );
  }

  // Responde imediatamente para o Asaas não retentar.
  res.status(200).json({ received: true });

  try {
    await paymentService.handleWebhook(req.body);
  } catch (e) {
    console.error('[WEBHOOK/ASAAS] Falha ao processar payload:', e?.message);
  }
});

module.exports = router;
