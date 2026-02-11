const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const messageController = require('../controllers/messageController');
const evolutionService = require('../services/evolutionService');
const userController = require('../controllers/userController');
const registrationTokenService = require('../services/registrationTokenService');
const userRateLimit = require('../middleware/userRateLimit');

// Rate limiting específico para webhook (30 req/min por IP)
// Configuração segura que funciona mesmo com trust proxy
const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 30, // máximo 30 mensagens por minuto por IP
  message: 'Muitas mensagens recebidas, aguarde um momento.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => false,
  keyGenerator: (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const ip = forwarded.split(',')[0].trim();
      return ip;
    }
    return req.ip || req.connection.remoteAddress || 'unknown';
  }
});

// Rate limiting por telefone (30 req/min por número)
// Protege contra abuse de um único usuário enviando muitas mensagens
const phoneRateLimiter = userRateLimit.phoneRateLimitMiddleware({
  windowMs: 60 * 1000, // 1 minuto
  max: 30, // 30 mensagens por minuto por telefone
  message: 'Muitas mensagens enviadas. Aguarde um momento antes de continuar.'
});

// Handler comum para processar webhooks
const webhookHandler = async (req, res) => {
  // LOG INICIAL - sempre executa para debug
  console.log('[WEBHOOK] ========================================');
  console.log('[WEBHOOK] 📥 Webhook recebido!');
  console.log('[WEBHOOK] Timestamp:', new Date().toISOString());
  console.log('[WEBHOOK] IP:', req.ip || req.headers['x-forwarded-for'] || 'unknown');
  console.log('[WEBHOOK] Method:', req.method);
  console.log('[WEBHOOK] URL:', req.url);
  console.log('[WEBHOOK] Headers:', JSON.stringify(req.headers).substring(0, 200));
  console.log('[WEBHOOK] Body keys:', req.body ? Object.keys(req.body).join(', ') : 'NO BODY');
  console.log('[WEBHOOK] Body completo (primeiros 500 chars):', JSON.stringify(req.body).substring(0, 500));
  console.log('[WEBHOOK] ========================================');

  try {
    // Validação de entrada
    if (!req.body || typeof req.body !== 'object') {
      console.error('[WEBHOOK] ❌ Body inválido ou vazio');
      return res.status(400).json({ status: 'error', reason: 'Invalid request body' });
    }

    const { event, data } = req.body;
    console.log('[WEBHOOK] Event:', event);
    console.log('[WEBHOOK] Data presente:', !!data);

    // Valida tamanho máximo do body (proteção adicional)
    const bodySize = JSON.stringify(req.body).length;
    if (bodySize > 10 * 1024 * 1024) { // 10MB
      return res.status(413).json({ status: 'error', reason: 'Request too large' });
    }

    if (event === 'messages.upsert') {
      console.log('[WEBHOOK] ✅ Evento messages.upsert detectado');

      if (!data || typeof data !== 'object') {
        console.error('[WEBHOOK] ❌ Data inválida ou ausente');
        return res.status(200).json({ status: 'ignored', reason: 'invalid data structure' });
      }

      const key = data?.key;
      const message = data?.message;

      console.log('[WEBHOOK] Key presente:', !!key);
      console.log('[WEBHOOK] Message presente:', !!message);
      console.log('[WEBHOOK] Key completo:', JSON.stringify(key).substring(0, 300));
      console.log('[WEBHOOK] Message keys:', message ? Object.keys(message).join(', ') : 'NO MESSAGE');

      if (!key || !message) {
        console.error('[WEBHOOK] ❌ Mensagem sem estrutura válida (key ou message ausente)');
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
            console.log(`[WEBHOOK] [IMG] ${phone}: Imagem recebida`);
            console.log(`[WEBHOOK] [IMG] URL: ${imageMessage.url || imageMessage.directPath || 'N/A'}`);
            console.log(`[WEBHOOK] [IMG] directPath: ${imageMessage.directPath || 'N/A'}`);
            console.log(`[WEBHOOK] [IMG] mimetype: ${imageMessage.mimetype || 'N/A'}`);
            console.log(`[WEBHOOK] [IMG] fileLength: ${imageMessage.fileLength || 'N/A'}`);
            console.log(`[WEBHOOK] [IMG] mediaKey: ${imageMessage.mediaKey ? 'SIM' : 'NÃO'}`);

            // Debug: verifica todos os campos possíveis de base64
            console.log(`[WEBHOOK] [IMG] Tem 'media'? ${!!imageMessage.media}`);
            console.log(`[WEBHOOK] [IMG] Tem 'base64'? ${!!imageMessage.base64}`);
            console.log(`[WEBHOOK] [IMG] Tem 'mediaBase64'? ${!!imageMessage.mediaBase64}`);
            console.log(`[WEBHOOK] [IMG] Keys disponíveis:`, Object.keys(imageMessage).join(', '));

            const caption = imageMessage.caption || '';
            const messageKey = key;

            // PRIORIDADE 1: Se tem base64 no webhook (Webhook Base64 ativado), usa diretamente
            // Tenta diferentes nomes de campos que podem conter base64
            let base64Data = imageMessage.media || imageMessage.base64 || imageMessage.mediaBase64 || imageMessage.data;

            if (base64Data) {
              console.log('[WEBHOOK] [IMG] ✅✅✅ BASE64 ENCONTRADO NO WEBHOOK! ✅✅✅');
              console.log('[WEBHOOK] [IMG] Campo usado:',
                imageMessage.media ? 'media' :
                  imageMessage.base64 ? 'base64' :
                    imageMessage.mediaBase64 ? 'mediaBase64' : 'data');
              console.log('[WEBHOOK] [IMG] Tamanho base64:', base64Data.length, 'caracteres');
              console.log('[WEBHOOK] [IMG] Primeiros 100 chars do base64:', base64Data.substring(0, 100));

              try {
                // Remove data URL prefix se existir (data:image/jpeg;base64,)
                if (typeof base64Data === 'string' && base64Data.includes(',')) {
                  base64Data = base64Data.split(',')[1];
                }

                const imageBuffer = Buffer.from(base64Data, 'base64');
                const mimeType = imageMessage.mimetype || 'image/jpeg';

                console.log('[WEBHOOK] [IMG] Buffer criado do base64, tamanho:', imageBuffer.length, 'bytes');
                console.log('[WEBHOOK] [IMG] MIME type:', mimeType);

                // Processa diretamente com o buffer
                response = await messageController.handleImageMessageWithBuffer(phone, imageBuffer, mimeType, caption, messageKey);
              } catch (imgError) {
                console.error(`[WEBHOOK] [IMG] ❌ Erro ao processar base64:`, imgError.message);
                console.error(`[WEBHOOK] [IMG] Stack:`, imgError.stack);
                response = 'Erro ao processar imagem 😢\n\nTente enviar novamente ou registre manualmente.';
              }
            } else {
              // PRIORIDADE 2: Tenta URL ou download via API (quando Webhook Base64 está desativado)
              const mediaUrl = imageMessage.url || imageMessage.directPath;

              console.log('[WEBHOOK] [IMG] ⚠️ Base64 NÃO encontrado - tentando baixar via Evolution API');
              console.log('[WEBHOOK] [IMG] URL disponível:', mediaUrl || 'NENHUMA');
              console.log('[WEBHOOK] [IMG] MessageKey:', JSON.stringify(messageKey));

              if (!mediaUrl) {
                console.error('[WEBHOOK] [IMG] ❌ Erro: URL, directPath e base64 estão vazios!');
                console.error('[WEBHOOK] [IMG] imageMessage completo:', JSON.stringify(imageMessage, null, 2).substring(0, 1000));
                response = 'Não consegui acessar a imagem 😢\n\nA Evolution API não forneceu a mídia.\n\nVerifique a configuração do webhook na Evolution API.\n\nTente enviar novamente ou registre manualmente.';
              } else {
                try {
                  response = await messageController.handleImageMessage(phone, mediaUrl, caption, messageKey);
                } catch (imgError) {
                  console.error(`[WEBHOOK] [IMG] ❌ Erro ao processar imagem:`, imgError.message);
                  console.error(`[WEBHOOK] [IMG] Stack:`, imgError.stack);
                  response = 'Erro ao processar imagem 😢\n\nTente enviar novamente ou registre manualmente.';
                }
              }
            }
          } else if (documentMessage) {
            // Mensagem com documento (PDF, etc)
            console.log(`[WEBHOOK] [DOC] ${phone}: Documento recebido - ${documentMessage.fileName}`);
            console.log(`[WEBHOOK] [DOC] URL: ${documentMessage.url || documentMessage.directPath || 'N/A'}`);
            console.log(`[WEBHOOK] [DOC] MimeType: ${documentMessage.mimetype || 'N/A'}`);

            const caption = documentMessage.caption || '';
            const fileName = documentMessage.fileName || 'documento';
            const messageKey = key;

            // Tenta obter Base64 (igual imagens)
            let base64Data = documentMessage.media || documentMessage.base64 || documentMessage.mediaBase64 || documentMessage.data;

            if (base64Data) {
              console.log('[WEBHOOK] [DOC] ✅✅✅ BASE64 ENCONTRADO NO DOCUMENTO! ✅✅✅');
              try {
                // Remove data URL prefix
                if (typeof base64Data === 'string' && base64Data.includes(',')) {
                  base64Data = base64Data.split(',')[1];
                }

                const docBuffer = Buffer.from(base64Data, 'base64');
                const mimeType = documentMessage.mimetype || 'application/pdf';

                console.log('[WEBHOOK] [DOC] Buffer criado, tamanho:', docBuffer.length);

                response = await messageController.handleDocumentMessageWithBuffer(phone, docBuffer, mimeType, fileName, messageKey);
              } catch (docError) {
                console.error(`[WEBHOOK] [DOC] ❌ Erro ao processar base64:`, docError.message);
                response = 'Erro ao processar documento 😢';
              }
            } else {
              // Fallback URL
              const mediaUrl = documentMessage.url || documentMessage.directPath;
              try {
                response = await messageController.handleDocumentMessage(phone, mediaUrl, fileName, messageKey);
              } catch (docError) {
                console.error(`[WEBHOOK] [DOC] Erro ao processar documento:`, docError.message);
                response = 'Erro ao processar documento 😢\n\nTente enviar uma foto ou registre manualmente.';
              }
            }
          } else if (messageText) {
            // Mensagem de texto normal
            console.log(`[WEBHOOK] [MSG] ${phone}: ${messageText.substring(0, 50)}`);
            try {
              response = await messageController.handleIncomingMessage(phone, messageText);
            } catch (msgError) {
              console.error(`[WEBHOOK] [MSG] Erro ao processar mensagem:`, msgError.message);
              response = 'Erro ao processar mensagem 😢\n\nTente novamente.';
            }
          }

          // Garante que response é uma string válida antes de enviar
          if (response && typeof response === 'string' && response.trim().length > 0) {
            try {
              await evolutionService.sendMessage(phone, response);
              console.log(`[WEBHOOK] ✅ Resposta enviada para ${phone}`);
            } catch (sendError) {
              // Não tenta enviar mensagem de erro se o número é inválido
              if (sendError.code === 'INVALID_PHONE') {
                console.error(`[WEBHOOK] ❌ Número de telefone inválido: ${phone}`);
              } else {
                console.error(`[WEBHOOK] ❌ Erro ao enviar resposta:`, sendError.message);
                // Só tenta enviar mensagem de erro se o número é válido
                if (evolutionService.validatePhoneNumber(phone)) {
                  try {
                    await evolutionService.sendMessage(phone, 'Ops, tive um probleminha 😅\n\nTente novamente em alguns instantes.');
                  } catch (retryError) {
                    console.error('[WEBHOOK] ❌ Erro ao enviar mensagem de erro:', retryError.message);
                  }
                }
              }
            }
          } else {
            console.warn(`[WEBHOOK] ⚠️ Resposta vazia ou inválida para ${phone}:`, typeof response, response);
          }
        } catch (error) {
          console.error('[WEBHOOK] ❌ Erro geral no processamento:', error.message);
          console.error('[WEBHOOK] Stack:', error.stack);
          // Tenta enviar mensagem de erro genérica apenas se o número é válido
          if (phone && evolutionService.validatePhoneNumber(phone)) {
            try {
              await evolutionService.sendMessage(phone, 'Ops, tive um probleminha 😅\n\nTente novamente em alguns instantes.');
            } catch (sendError) {
              console.error('[WEBHOOK] ❌ Erro ao enviar mensagem de erro:', sendError.message);
            }
          } else {
            console.error('[WEBHOOK] ❌ Número de telefone inválido, não é possível enviar mensagem de erro');
          }
        }
      }
    }

    console.log('[WEBHOOK] ✅ Webhook processado com sucesso');
    res.status(200).json({ status: 'received' });
  } catch (error) {
    console.error('[WEBHOOK] ❌❌❌ ERRO CRÍTICO NO WEBHOOK ❌❌❌');
    console.error('[WEBHOOK] Erro:', error.message);
    console.error('[WEBHOOK] Stack:', error.stack);
    console.error('[WEBHOOK] Body que causou erro:', JSON.stringify(req.body).substring(0, 500));
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Rota padrão: /api/webhook (quando Webhook by Events está desativado)
// Aplica rate limit por IP e por telefone (proteção dupla)
router.post('/webhook', webhookLimiter, phoneRateLimiter, webhookHandler);

// Rota específica: /api/webhook/messages-upsert (quando Webhook by Events está ativado)
router.post('/webhook/messages-upsert', webhookLimiter, phoneRateLimiter, webhookHandler);

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
