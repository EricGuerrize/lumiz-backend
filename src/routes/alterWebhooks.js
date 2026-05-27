/**
 * Webhook Alter — recebe eventos opt_in.confirmed / opt_in.failed.
 *
 * Verificação HMAC-SHA256 (spec Alter):
 *   Header X-Alter-Timestamp: Unix timestamp (segundos)
 *   Header X-Alter-Signature: t={ts},v1={hmac_sha256}
 *   Payload HMAC = sha256(timestamp + "." + raw_body, ALTER_WEBHOOK_SECRET)
 *   Janela de tolerância: ±300 s.
 *
 * Behavior:
 *   - Sem secret em produção → 503 fail-closed.
 *   - Sem secret em dev → aceita com warning (ergonomia local).
 *   - Signature inválida → 401.
 *   - Evento desconhecido → 200 (tolerância a futuros event types).
 *   - Responde 200 imediatamente; processamento é fire-and-forget.
 *
 * Env: ALTER_WEBHOOK_SECRET (fornecida pela Alter em canal privado após
 *   registrar a URL via realAlterAdapter.setWebhookUrl()).
 */

const crypto = require('crypto');
const express = require('express');
const supabase = require('../db/supabase');

const router = express.Router();

// Alter exige raw body para verificação HMAC — capturamos antes do JSON parser.
router.post(
  '/alter',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const env = process.env.NODE_ENV || 'development';
    const secret = process.env.ALTER_WEBHOOK_SECRET;

    if (env === 'production' && !secret) {
      console.error(
        '[WEBHOOK/ALTER] BLOQUEADO: ALTER_WEBHOOK_SECRET não configurada em produção.'
      );
      return res.status(503).json({
        error: 'alter_webhook_secret_not_configured',
        message: 'Webhook indisponível: secret não configurada no servidor.'
      });
    }

    if (secret) {
      const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : '';
      const timestamp = req.headers['x-alter-timestamp'];
      const signatureHeader = req.headers['x-alter-signature'] || '';

      // Extrai v1={hmac} do header
      const match = signatureHeader.match(/v1=([a-f0-9]+)/);
      const received = match?.[1] || '';
      const expected = crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');

      if (!crypto.timingSafeEqual(Buffer.from(received, 'hex').length === 0
        ? Buffer.alloc(32)
        : Buffer.from(received, 'hex'),
        Buffer.from(expected, 'hex')
      )) {
        return res.status(401).json({ error: 'invalid_signature' });
      }

      // Rejeita replay fora da janela de 300 s
      const ts = Number(timestamp);
      if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) {
        return res.status(401).json({ error: 'timestamp_out_of_window' });
      }
    } else {
      console.warn(
        `[WEBHOOK/ALTER] ALTER_WEBHOOK_SECRET não configurada (${env}). Aceitando sem validação.`
      );
    }

    // Responde imediatamente — Alter usa at-least-once com retentativas agressivas.
    res.status(200).json({ received: true });

    try {
      const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : '{}';
      const payload = JSON.parse(rawBody);
      await _handleEvent(payload);
    } catch (e) {
      console.error('[WEBHOOK/ALTER] Falha ao processar payload:', e?.message);
    }
  }
);

async function _handleEvent(payload) {
  const { type, data } = payload || {};

  if (type === 'opt_in.confirmed') {
    const bpId = data?.business_partner?.id;
    const optInStatus = data?.business_partner?.nuclea_opt_in?.status || 'active';
    if (!bpId) return;
    const { error } = await supabase
      .from('profiles')
      .update({ alter_opt_in_status: optInStatus })
      .eq('alter_bp_id', bpId);
    if (error) console.error('[WEBHOOK/ALTER] Erro ao atualizar opt_in confirmed:', error.message);
    else console.info(`[WEBHOOK/ALTER] opt_in.confirmed para BP ${bpId} → status ${optInStatus}`);
    return;
  }

  if (type === 'opt_in.failed') {
    const bpId = data?.business_partner?.id;
    if (!bpId) return;
    const { error } = await supabase
      .from('profiles')
      .update({ alter_opt_in_status: 'failed' })
      .eq('alter_bp_id', bpId);
    if (error) console.error('[WEBHOOK/ALTER] Erro ao atualizar opt_in failed:', error.message);
    else console.info(`[WEBHOOK/ALTER] opt_in.failed para BP ${bpId}. Razão: ${data?.reason}`);
    return;
  }

  // Evento desconhecido — ignora graciosamente (spec Alter: novos tipos sem version bump)
  console.info(`[WEBHOOK/ALTER] Evento desconhecido ignorado: ${type}`);
}

module.exports = router;
