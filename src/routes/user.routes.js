const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validationMiddleware');
const { linkEmailSchema } = require('../validators/user.validators');
const lgpdService = require('../services/lgpdService');
const lgpdEmailCopy = require('../copy/lgpdEmailCopy');

// Rota pública para vincular email (finalizar cadastro)
router.post('/link-email', validate(linkEmailSchema), (req, res) => {
  return userController.linkEmail(req, res);
});

// ============================================================================
// Fase 19 — LGPD: portabilidade + esquecimento
// ============================================================================

function _hasResend() {
  return Boolean(process.env.RESEND_API_KEY);
}

async function _sendEmail({ to, from, subject, html, attachments }) {
  if (!_hasResend()) {
    console.warn('[LGPD] RESEND_API_KEY ausente; email NÃO enviado.');
    return { skipped: true, reason: 'missing_api_key' };
  }
  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const payload = { from, to, subject, html };
  if (attachments) payload.attachments = attachments;
  await resend.emails.send(payload);
  return { sent: true };
}

/**
 * GET /api/user/export-data
 * Direito à portabilidade (LGPD Art. 18, V).
 *
 * Coleta todos os dados do usuário e envia por email em anexo JSON.
 * Não retorna o dump no body — força o trânsito autenticado por email para
 * deixar trilha auditável e evitar timeout em payloads grandes.
 *
 * Query opcional ?download=true → devolve o JSON inline (útil para teste/admin).
 */
router.get('/export-data', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const dump = await lgpdService.collectUserData(userId);
    const totalRows = Object.values(dump.summary || {}).reduce((acc, n) => acc + (Number(n) || 0), 0);

    if (req.query.download === 'true') {
      const filename = `lumiz-export-${userId}-${dump.generated_at.split('T')[0]}.json`;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).send(JSON.stringify(dump, null, 2));
    }

    if (!req.user?.email) {
      return res.status(400).json({
        error: 'Usuário sem email cadastrado. Vincule um email antes de solicitar export.',
      });
    }

    const json = JSON.stringify(dump, null, 2);
    const filename = `lumiz-export-${userId}-${dump.generated_at.split('T')[0]}.json`;
    const mail = lgpdEmailCopy.exportEmail({
      profile: req.user,
      generatedAt: dump.generated_at,
      totalRows,
    });

    let emailResult = { skipped: true, reason: 'unknown' };
    try {
      emailResult = await _sendEmail({
        to: req.user.email,
        from: mail.from,
        subject: mail.subject,
        html: mail.html,
        attachments: [
          {
            filename,
            content: Buffer.from(json, 'utf-8').toString('base64'),
          },
        ],
      });
    } catch (mailErr) {
      console.error('[LGPD] Falha ao enviar email de export:', mailErr.message);
      return res.status(202).json({
        success: true,
        delivered: false,
        warning: 'Export gerado mas envio do email falhou. Tente novamente em instantes.',
        summary: dump.summary,
      });
    }

    return res.status(202).json({
      success: true,
      delivered: !emailResult.skipped,
      to: emailResult.skipped ? null : req.user.email,
      summary: dump.summary,
      generated_at: dump.generated_at,
    });
  } catch (err) {
    console.error('[LGPD] Erro em GET /export-data:', err);
    return res.status(500).json({ error: 'Erro ao gerar export de dados' });
  }
});

/**
 * DELETE /api/user/account
 * Solicitação de exclusão (LGPD Art. 18, VI).
 * Não exclui imediatamente — gera token de confirmação com TTL 24h e manda
 * um email com o link de confirmação (frontend chama POST .../confirm-delete).
 */
router.delete('/account', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    if (!req.user?.email) {
      return res.status(400).json({
        error: 'Usuário sem email cadastrado. Vincule um email antes de excluir a conta.',
      });
    }

    const { token, expira_em, reused } = await lgpdService.requestDeletionToken(userId, req);

    const mail = lgpdEmailCopy.deletionConfirmEmail({
      profile: req.user,
      token,
      expiraEm: expira_em,
    });

    let emailResult = { skipped: true, reason: 'unknown' };
    try {
      emailResult = await _sendEmail({
        to: req.user.email,
        from: mail.from,
        subject: mail.subject,
        html: mail.html,
      });
    } catch (mailErr) {
      console.error('[LGPD] Falha ao enviar email de confirmação:', mailErr.message);
    }

    return res.status(202).json({
      success: true,
      message: 'Email de confirmação enviado. Confirme em 24h para finalizar a exclusão.',
      delivered: !emailResult.skipped,
      reused,
      expira_em,
    });
  } catch (err) {
    console.error('[LGPD] Erro em DELETE /account:', err);
    return res.status(500).json({ error: 'Erro ao iniciar exclusão de conta' });
  }
});

/**
 * POST /api/user/account/confirm-delete
 * Body: { token: string }
 * Endpoint público (autenticado pelo próprio token, não pelo Bearer JWT) —
 * o link do email pode ser aberto em qualquer dispositivo, sem login.
 */
router.post('/account/confirm-delete', async (req, res) => {
  try {
    const token = req.body?.token || req.query?.token;
    if (!token) return res.status(400).json({ error: 'Token de confirmação é obrigatório' });

    let userId;
    try {
      ({ userId } = await lgpdService.consumeDeletionToken(token));
    } catch (tokenErr) {
      const status = tokenErr.code === 'TOKEN_EXPIRED' ? 410 : 400;
      return res.status(status).json({ error: tokenErr.message, code: tokenErr.code });
    }

    const report = await lgpdService.executeDeletion(userId);

    return res.status(200).json({
      success: true,
      message: 'Conta excluída. Sentiremos sua falta.',
      summary: {
        subscription: report.steps.subscription,
        audit_log: report.steps.audit_log,
        profile: report.steps.profile,
        purged_tables: Object.fromEntries(
          Object.entries(report.steps.purge || {}).map(([k, v]) => [k, v.rowsAffected || 0]),
        ),
      },
    });
  } catch (err) {
    console.error('[LGPD] Erro em POST /account/confirm-delete:', err);
    return res.status(500).json({ error: 'Erro ao confirmar exclusão de conta' });
  }
});

module.exports = router;
