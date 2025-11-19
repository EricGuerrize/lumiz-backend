const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const messageController = require('../controllers/messageController');
const evolutionService = require('../services/evolutionService');

// Rate limiting específico para webhook (30 req/min por IP)
const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 30, // máximo 30 mensagens por minuto por IP
  message: 'Muitas mensagens recebidas, aguarde um momento.',
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/webhook', webhookLimiter, async (req, res) => {
  try {
    // Validação de entrada
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ status: 'error', reason: 'Invalid request body' });
    }

    const { event, data } = req.body;

    // Valida tamanho máximo do body (proteção adicional)
    const bodySize = JSON.stringify(req.body).length;
    if (bodySize > 10 * 1024 * 1024) { // 10MB
      return res.status(413).json({ status: 'error', reason: 'Request too large' });
    }

    if (event === 'messages.upsert') {
      if (!data || typeof data !== 'object') {
        return res.status(200).json({ status: 'ignored', reason: 'invalid data structure' });
      }

      const key = data?.key;
      const message = data?.message;

      if (!key || !message) {
        console.log('[WEBHOOK] Mensagem sem estrutura válida');
        return res.status(200).json({ status: 'ignored', reason: 'invalid structure' });
      }

      if (key.fromMe) {
        return res.status(200).json({ status: 'ignored', reason: 'own message' });
      }

      // Valida e sanitiza telefone
      const phone = key.remoteJid?.split('@')[0];
      if (!phone || phone.length < 10 || phone.length > 20) {
        console.log('[WEBHOOK] Telefone inválido:', phone);
        return res.status(200).json({ status: 'ignored', reason: 'invalid phone' });
      }

      // Extrai texto da mensagem (sanitiza)
      const messageText = (message.conversation ||
                          message.extendedTextMessage?.text ||
                          '').substring(0, 5000); // Limita tamanho

      // Verifica se é imagem ou documento
      const imageMessage = message.imageMessage;
      const documentMessage = message.documentMessage;

      if (phone) {
        // Processa e envia resposta
        try {
          let response = '';

          if (imageMessage) {
            // Mensagem com imagem
            console.log(`[IMG] ${phone}: Imagem recebida`);
            const mediaUrl = imageMessage.url || imageMessage.directPath;
            const caption = imageMessage.caption || '';

            response = await messageController.handleImageMessage(phone, mediaUrl, caption);
          } else if (documentMessage) {
            // Mensagem com documento (PDF, etc)
            console.log(`[DOC] ${phone}: Documento recebido - ${documentMessage.fileName}`);
            const mediaUrl = documentMessage.url || documentMessage.directPath;
            const fileName = documentMessage.fileName || 'documento';

            response = await messageController.handleDocumentMessage(phone, mediaUrl, fileName);
          } else if (messageText) {
            // Mensagem de texto normal
            console.log(`[MSG] ${phone}: ${messageText.substring(0, 50)}`);
            response = await messageController.handleIncomingMessage(phone, messageText);
          }

          if (response) {
            await evolutionService.sendMessage(phone, response);
          }
        } catch (error) {
          console.error('Erro webhook:', error.message);
        }
      }
    }

    res.status(200).json({ status: 'received' });
  } catch (error) {
    console.error('Erro no webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/test/send-setup-email - Testa envio de email (apenas para desenvolvimento)
router.post('/test/send-setup-email', async (req, res) => {
  try {
    // Apenas em desenvolvimento
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Endpoint desabilitado em produção' });
    }

    const { email, nome } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email é obrigatório' });
    }

    const emailService = require('../services/emailService');
    const result = await emailService.sendSetupEmail(email, nome || '');

    if (result) {
      res.json({
        success: true,
        message: 'Email enviado com sucesso',
        setupLink: result.setupLink
      });
    } else {
      res.status(500).json({ error: 'Erro ao enviar email' });
    }
  } catch (error) {
    console.error('Erro ao testar email:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/test', async (req, res) => {
  try {
    const { phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({ error: 'Phone and message are required' });
    }

    const result = await messageController.handleIncomingMessage(phone, message);

    res.status(200).json({
      status: 'success',
      result
    });
  } catch (error) {
    console.error('Erro ao testar:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
