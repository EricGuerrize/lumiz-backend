const express = require('express');
const paymentService = require('../services/paymentService');

const router = express.Router();

router.post('/asaas', async (req, res) => {
  const token = req.headers['asaas-access-token'];
  if (process.env.ASAAS_WEBHOOK_SECRET && token !== process.env.ASAAS_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Responde imediatamente para o Asaas não retentar
  res.status(200).json({ received: true });

  try {
    await paymentService.handleWebhook(req.body);
  } catch (e) {
    console.error('[WEBHOOK/ASAAS] Falha ao processar payload:', e?.message);
  }
});

module.exports = router;
