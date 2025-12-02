const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const messageController = require('../controllers/messageController');
const evolutionService = require('../services/evolutionService');
const userController = require('../controllers/userController');
const registrationTokenService = require('../services/registrationTokenService');

// Rate limiting específico para webhook (30 req/min por IP)
// Configuração segura que funciona mesmo com trust proxy
const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 30, // máximo 30 mensagens por minuto por IP
  message: 'Muitas mensagens recebidas, aguarde um momento.',
  standardHeaders: true,
  legacyHeaders: false,
  // Usa o IP real mesmo com trust proxy configurado
  // Isso previne bypass do rate limiting
  skip: (req) => {
    // Em produção, pode adicionar lógica adicional se necessário
    return false;
  },
  // Garante que usa o IP correto mesmo com proxy
  keyGenerator: (req) => {
    // Tenta pegar o IP real do header X-Forwarded-For ou usa req.ip
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      // Pega o primeiro IP da lista (IP real do cliente)
      const ip = forwarded.split(',')[0].trim();
      return ip;
    }
    return req.ip || req.connection.remoteAddress || 'unknown';
  }
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
              console.log('[WEBHOOK] [IMG] ✅ Mídia base64 encontrada no webhook - processando diretamente');
              console.log('[WEBHOOK] [IMG] Campo usado:', 
                imageMessage.media ? 'media' : 
                imageMessage.base64 ? 'base64' : 
                imageMessage.mediaBase64 ? 'mediaBase64' : 'data');
              console.log('[WEBHOOK] [IMG] Tamanho base64:', base64Data.length, 'caracteres');
              
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
                response = await messageController.handleImageMessageWithBuffer(phone, imageBuffer, mimeType, caption);
              } catch (imgError) {
                console.error(`[WEBHOOK] [IMG] ❌ Erro ao processar base64:`, imgError.message);
                console.error(`[WEBHOOK] [IMG] Stack:`, imgError.stack);
                response = 'Erro ao processar imagem 😢\n\nTente enviar novamente ou registre manualmente.';
              }
            } else {
              // PRIORIDADE 2: Tenta URL ou download via API (quando Webhook Base64 está desativado)
              const mediaUrl = imageMessage.url || imageMessage.directPath;
              
              console.log('[WEBHOOK] [IMG] Base64 não encontrado - usando URL/directPath');
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
            const mediaUrl = documentMessage.url || documentMessage.directPath;
            const fileName = documentMessage.fileName || 'documento';
            // Passa messageKey completo para download correto da mídia
            const messageKey = key;

            try {
            response = await messageController.handleDocumentMessage(phone, mediaUrl, fileName, messageKey);
            } catch (docError) {
              console.error(`[WEBHOOK] [DOC] Erro ao processar documento:`, docError.message);
              console.error(`[WEBHOOK] [DOC] Stack:`, docError.stack);
              response = 'Erro ao processar documento 😢\n\nTente enviar uma foto ou registre manualmente.';
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

          if (response) {
            try {
            await evolutionService.sendMessage(phone, response);
              console.log(`[WEBHOOK] ✅ Resposta enviada para ${phone}`);
            } catch (sendError) {
              console.error(`[WEBHOOK] ❌ Erro ao enviar resposta:`, sendError.message);
            }
          }
        } catch (error) {
          console.error('[WEBHOOK] ❌ Erro geral no processamento:', error.message);
          console.error('[WEBHOOK] Stack:', error.stack);
          // Tenta enviar mensagem de erro genérica
          try {
            await evolutionService.sendMessage(phone, 'Ops, tive um probleminha 😅\n\nTente novamente em alguns instantes.');
          } catch (sendError) {
            console.error('[WEBHOOK] ❌ Erro ao enviar mensagem de erro:', sendError.message);
          }
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
