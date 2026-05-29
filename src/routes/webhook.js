const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const messageController = require('../controllers/messageController');
const evolutionService = require('../services/evolutionService');
const userController = require('../controllers/userController');
const registrationTokenService = require('../services/registrationTokenService');
const userRateLimit = require('../middleware/userRateLimit');
const audioTranscriptionService = require('../services/audioTranscriptionService');
const whatsappLatencyService = require('../services/whatsappLatencyService');
const outboundMessageService = require('../services/outboundMessageService');
const messageReliabilityService = require('../services/messageReliabilityService');
const { extractPhoneFromWebhookBody } = require('../utils/phone');

// Deduplicação de mensagens: previne double-send quando a Evolution API dispara o webhook
// nas duas rotas (/webhook e /webhook/messages-upsert) para a mesma mensagem, ou reenvia
// por timeout. Usa Set atômico de IDs + fallback por phone+conteúdo (janela 3s).
const _processedMsgIds = new Set();
const _processedMsgTimes = new Map(); // key -> timestamp (para TTL)
const MSG_DEDUP_TTL = 5 * 60 * 1000; // 5 minutos
const PRESENCE_ENABLED = process.env.WHATSAPP_PRESENCE_ENABLED !== 'false';
const WEBHOOK_FALLBACK_MESSAGE = 'Recebi sua mensagem, mas não consegui concluir a leitura agora 😅\n\nMe manda de novo em alguns instantes ou escreve de um jeito mais direto, tipo: "botox 500 no pix".';

const _dedupCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of _processedMsgTimes.entries()) {
    if (now - ts > MSG_DEDUP_TTL) {
      _processedMsgIds.delete(id);
      _processedMsgTimes.delete(id);
    }
  }
}, MSG_DEDUP_TTL).unref();

function isMessageAlreadyProcessed(messageId, phone, messageText) {
  // Chave primária: messageId da Evolution
  if (messageId && _processedMsgIds.has(messageId)) return true;
  // Chave secundária: phone + conteúdo truncado (janela 3s) — cobre double-fire com IDs diferentes
  const contentKey = `${phone}::${String(messageText || '').substring(0, 100)}`;
  const lastSeen = _processedMsgTimes.get(contentKey);
  if (lastSeen && Date.now() - lastSeen < 3000) return true;
  // Registra ambas as chaves
  if (messageId) { _processedMsgIds.add(messageId); _processedMsgTimes.set(messageId, Date.now()); }
  _processedMsgTimes.set(contentKey, Date.now());
  return false;
}

// Rate limiting específico para webhook (limitado por IP)
// Usado principalmente para evitar DDoS, mas deve ser alto o suficiente
// porque todo o tráfego legítimo vem de 1 ou poucos IPs da Evolution API.
const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 300, // aumentado de 30 para 300 para não bloquear a Evolution API
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
function normalizeFromMeFlag(value) {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return false;
}

function normalizeEvolutionWebhookBody(rawBody) {
  if (!rawBody || typeof rawBody !== 'object') {
    return { ok: false, reason: 'invalid_body', event: null, data: null, body: rawBody };
  }

  // Formato 1 (esperado historicamente): { event, data }
  if (typeof rawBody.event === 'string' && rawBody.data && typeof rawBody.data === 'object') {
    return { ok: true, reason: 'event_data', event: rawBody.event, data: rawBody.data, body: rawBody };
  }

  // Formato 2: { data: { key, message } } sem event (algumas configs não enviam event)
  if (rawBody.data && typeof rawBody.data === 'object' && rawBody.data.key && rawBody.data.message) {
    return { ok: true, reason: 'data_key_message', event: 'messages.upsert', data: rawBody.data, body: rawBody };
  }

  // Formato 3: payload “flat”: { key, message }
  if (rawBody.key && rawBody.message) {
    return { ok: true, reason: 'flat_key_message', event: 'messages.upsert', data: rawBody, body: rawBody };
  }

  // Formato 4: alguns providers enviam array/messages
  const firstMessage = Array.isArray(rawBody.messages) ? rawBody.messages[0] : null;
  if (firstMessage && firstMessage.key && firstMessage.message) {
    return { ok: true, reason: 'messages_array', event: 'messages.upsert', data: firstMessage, body: rawBody };
  }

  // Formato 5: Meta Cloud API — { object: “whatsapp_business_account”, entry: [...] }
  if (rawBody.object === 'whatsapp_business_account') {
    return normalizeMetaWebhookBody(rawBody);
  }

  return { ok: false, reason: 'unrecognized_shape', event: null, data: null, body: rawBody };
}

// Normaliza o formato nativo da Meta Cloud API para o formato interno usado pelo webhookHandler.
// Usado quando a Meta envia o webhook diretamente (sem passar pela Evolution API como intermediário).
function normalizeMetaWebhookBody(rawBody) {
  const change = rawBody?.entry?.[0]?.changes?.find(c => c.field === 'messages');
  if (!change) {
    // Pode ser update de status (delivered, read) — ignorar silenciosamente
    return { ok: false, reason: 'meta_no_messages_field', event: null, data: null, body: rawBody };
  }

  const value = change.value;
  const msg = value?.messages?.[0];
  if (!msg) {
    return { ok: false, reason: 'meta_no_message', event: null, data: null, body: rawBody };
  }

  const from = msg.from;
  const type = msg.type;

  const data = {
    key: {
      id: msg.id,
      remoteJid: `${from}@s.whatsapp.net`,
      fromMe: false,
    },
    message: {}
  };

  if (type === 'text') {
    data.message.conversation = msg.text?.body || '';
  } else if (type === 'image') {
    data.message.imageMessage = {
      caption: msg.image?.caption || '',
      mimetype: msg.image?.mime_type || 'image/jpeg',
      meta_media_id: msg.image?.id,
    };
  } else if (type === 'document') {
    data.message.documentMessage = {
      fileName: msg.document?.filename || 'documento',
      mimetype: msg.document?.mime_type || 'application/pdf',
      meta_media_id: msg.document?.id,
    };
  } else if (type === 'audio') {
    data.message.audioMessage = {
      mimetype: msg.audio?.mime_type || 'audio/ogg',
      voice: msg.audio?.voice || false,
      meta_media_id: msg.audio?.id,
    };
  } else {
    return { ok: false, reason: `meta_unsupported_type:${type}`, event: null, data: null, body: rawBody };
  }

  return { ok: true, reason: 'meta_cloud_api', event: 'messages.upsert', data, body: rawBody };
}

const webhookHandler = async (req, res) => {
  const receivedAt = Date.now();
  try {
    // Validação de entrada
    if (!req.body || typeof req.body !== 'object') {
      console.error('[WEBHOOK] ❌ Body inválido ou vazio');
      return res.status(400).json({ status: 'error', reason: 'Invalid request body' });
    }

    const normalized = normalizeEvolutionWebhookBody(req.body);
    if (!normalized.ok) {
      console.error('[WEBHOOK] ❌ Payload não reconhecido. reason=', normalized.reason, 'keys=', Object.keys(req.body || {}).slice(0, 30));
      return res.status(200).json({ status: 'ignored', reason: 'unrecognized payload shape' });
    }

    const { event, data } = normalized;

    // Valida tamanho máximo do body (proteção adicional)
    const bodySize = JSON.stringify(req.body).length;
    if (bodySize > 10 * 1024 * 1024) { // 10MB
      return res.status(413).json({ status: 'error', reason: 'Request too large' });
    }

    const incomingKey = data?.key;
    const fromMeFlag = normalizeFromMeFlag(incomingKey?.fromMe);
    console.error('[WEBHOOK] evento recebido:', event, '| remoteJid:', incomingKey?.remoteJid, '| fromMe:', fromMeFlag, '| rawFromMe:', incomingKey?.fromMe);

    if (event === 'messages.upsert') {
      if (!data || typeof data !== 'object') {
        console.error('[WEBHOOK] ❌ Data inválida ou ausente');
        return res.status(200).json({ status: 'ignored', reason: 'invalid data structure' });
      }

      const key = data?.key;
      const message = data?.message;

      if (!key || !message) {
        console.error('[WEBHOOK] ❌ Mensagem sem estrutura válida (key ou message ausente)');
        return res.status(200).json({ status: 'ignored', reason: 'invalid structure' });
      }

      const isFromMe = normalizeFromMeFlag(key?.fromMe);
      if (isFromMe) {
        return res.status(200).json({ status: 'ignored', reason: 'own message' });
      }

      // Valida e sanitiza telefone (suporta payloads com remoteJid=@lid)
      const phone = extractPhoneFromWebhookBody(normalized.body);
      if (!phone) {
        const isLid = String(key.remoteJid).endsWith('@lid');
        if (isLid) {
          console.error('[WEBHOOK] ❌ @lid sem phone resolvido. Payload completo:', JSON.stringify(req.body).substring(0, 2000));
        }
        console.error('[WEBHOOK] ❌ Telefone inválido. remoteJid:', key.remoteJid, 'senderPn:', key.senderPn || 'N/A', 'sender:', JSON.stringify(req.body.sender)?.substring(0, 100));
        return res.status(200).json({ status: 'ignored', reason: 'invalid phone' });
      }

      // Extrai texto da mensagem (sanitiza)
      const messageText = (message.conversation ||
        message.extendedTextMessage?.text ||
        '').substring(0, 5000); // Limita tamanho

      // Dedup: ignora mensagens já processadas.
      // Checa por key.id (Evolution reenvia após timeout) E por phone+conteúdo (janela 3s —
      // cobre o caso em que /webhook e /webhook/messages-upsert recebem o mesmo evento).
      if (isMessageAlreadyProcessed(key.id, phone, messageText)) {
        console.error(`[WEBHOOK] ⚠️ Mensagem duplicada ignorada: id=${key.id}`);
        return res.status(200).json({ status: 'ignored', reason: 'duplicate message' });
      }

      // Verifica se é imagem, documento ou áudio
      const imageMessage = message.imageMessage;
      const documentMessage = message.documentMessage;
      const audioMessage = message.audioMessage || message.pttMessage || null;
      const messageType = imageMessage ? 'image' : documentMessage ? 'document' : audioMessage ? 'audio' : 'text';

      if (phone) {
        // Responde 200 OK imediatamente para a Evolution API
        // Isso previne timeouts, reenvios e o erro "Aguardando mensagem" no WhatsApp
        res.status(200).json({ status: 'received' });
        const acknowledgedAt = Date.now();

        // Processa em segundo plano para não segurar a conexão
        (async () => {
          const processingStartedAt = Date.now();
          let processingFinishedAt = null;
          let sendStartedAt = null;
          let sendFinishedAt = null;
          let finalStatus = 'ok';
          let finalError = null;
          let response = '';
          try {
            if (
              PRESENCE_ENABLED &&
              typeof evolutionService.sendPresenceUpdate === 'function' &&
              evolutionService.validatePhoneNumber(phone)
            ) {
              evolutionService
                .sendPresenceUpdate(phone, audioMessage ? 'recording' : 'composing')
                .catch(() => {});
            }

            if (imageMessage) {
              // Mensagem com imagem
              const caption = imageMessage.caption || '';
              const messageKey = key;
              let base64Data = imageMessage.media || imageMessage.base64 || imageMessage.mediaBase64 || imageMessage.data;

              if (base64Data) {
                try {
                  if (typeof base64Data === 'string' && base64Data.includes(',')) {
                    base64Data = base64Data.split(',')[1];
                  }
                  const imageBuffer = Buffer.from(base64Data, 'base64');
                  const mimeType = imageMessage.mimetype || 'image/jpeg';
                  response = await messageController.handleImageMessageWithBuffer(phone, imageBuffer, mimeType, caption, messageKey);
                } catch (imgError) {
                  console.error(`[WEBHOOK] [IMG] ❌ Erro ao processar base64:`, imgError.message);
                  response = 'Erro ao processar imagem 😢\n\nTente enviar novamente ou registre manualmente.';
                }
              } else {
                const mediaUrl = imageMessage.url || imageMessage.directPath;
                if (!mediaUrl) {
                  response = 'Não consegui acessar a imagem 😢\n\nA Evolution API não forneceu a mídia.';
                } else {
                  try {
                    response = await messageController.handleImageMessage(phone, mediaUrl, caption, messageKey);
                  } catch (imgError) {
                    console.error(`[WEBHOOK] [IMG] ❌ Erro ao processar imagem:`, imgError.message);
                    response = 'Erro ao processar imagem 😢';
                  }
                }
              }
            } else if (documentMessage) {
              // Mensagem com documento
              const fileName = documentMessage.fileName || 'documento';
              const messageKey = key;
              let base64Data = documentMessage.media || documentMessage.base64 || documentMessage.mediaBase64 || documentMessage.data;

              if (base64Data) {
                try {
                  if (typeof base64Data === 'string' && base64Data.includes(',')) {
                    base64Data = base64Data.split(',')[1];
                  }
                  const docBuffer = Buffer.from(base64Data, 'base64');
                  const mimeType = documentMessage.mimetype || 'application/pdf';
                  response = await messageController.handleDocumentMessageWithBuffer(phone, docBuffer, mimeType, fileName, messageKey);
                } catch (docError) {
                  console.error(`[WEBHOOK] [DOC] ❌ Erro ao processar base64:`, docError.message);
                  response = 'Erro ao processar documento 😢';
                }
              } else {
                const mediaUrl = documentMessage.url || documentMessage.directPath;
                try {
                  response = await messageController.handleDocumentMessage(phone, mediaUrl, fileName, messageKey);
                } catch (docError) {
                  console.error(`[WEBHOOK] [DOC] Erro ao processar documento:`, docError.message);
                  response = 'Erro ao processar documento 😢';
                }
              }
            } else if (audioMessage) {
              // Mensagem de áudio: transcreve com Whisper e injeta no fluxo de texto
              try {
                if (!audioTranscriptionService.isEnabled()) {
                  response = 'Ainda não consigo entender áudios por aqui 😅\n\nPode me mandar a mesma informação por texto?';
                } else {
                  let base64Data = audioMessage.media || audioMessage.base64 || audioMessage.mediaBase64 || audioMessage.data;
                  if (!base64Data) {
                    response = 'Não consegui acessar o áudio 😢\n\nTente enviar novamente ou me mande por texto.';
                  } else {
                    if (typeof base64Data === 'string' && base64Data.includes(',')) {
                      base64Data = base64Data.split(',')[1];
                    }
                    const audioBuffer = Buffer.from(base64Data, 'base64');
                    const mimeType = audioMessage.mimetype || audioMessage.mimeType || 'audio/ogg';

                    if (!audioTranscriptionService.isSupportedMimeType(mimeType)) {
                      console.warn('[WEBHOOK] [AUDIO] MIME não suportado, tentando como audio/ogg:', mimeType);
                    }

                    const { text: transcribedText, durationMs } = await audioTranscriptionService.transcribe(audioBuffer, mimeType);
                    console.log(`[WEBHOOK] [AUDIO] Transcrição em ${durationMs}ms (${transcribedText.length} chars)`);

                    if (!transcribedText || transcribedText.trim().length === 0) {
                      response = 'Não consegui entender o áudio 🤔\n\nTente falar de novo ou me mande por texto.';
                    } else {
                      const innerResponse = await messageController.handleIncomingMessage(phone, transcribedText);
                      const transcricaoResumo = transcribedText.length > 240
                        ? `${transcribedText.slice(0, 240).trim()}…`
                        : transcribedText.trim();
                      const header = `🎤 _Entendi assim:_ "${transcricaoResumo}"`;
                      if (innerResponse && typeof innerResponse === 'string' && innerResponse.trim().length > 0) {
                        response = `${header}\n\n${innerResponse}`;
                      } else {
                        response = header;
                      }
                    }
                  }
                }
              } catch (audioError) {
                console.error(`[WEBHOOK] [AUDIO] Erro ao processar áudio:`, audioError.message);
                response = 'Erro ao processar áudio 😢\n\nTente novamente ou me mande por texto.';
              }
            } else if (messageText) {
              // Mensagem de texto normal
              try {
                response = await messageController.handleIncomingMessage(phone, messageText);
              } catch (msgError) {
                console.error(`[WEBHOOK] [MSG] Erro ao processar mensagem:`, msgError.message);
                messageReliabilityService.recordFailure({
                  kind: 'inbound_processing_failed',
                  phase: 'process',
                  phone,
                  messageId: key.id,
                  messageType,
                  reason: msgError.message
                });
                response = WEBHOOK_FALLBACK_MESSAGE;
              }
            }

            if (!response || typeof response !== 'string' || response.trim().length === 0) {
              response = WEBHOOK_FALLBACK_MESSAGE;
              finalStatus = 'fallback';
              messageReliabilityService.recordFailure({
                kind: 'empty_bot_response',
                phase: 'process',
                phone,
                messageId: key.id,
                messageType,
                reason: 'empty_response'
              });
            }

            // Envia a resposta final
            if (response && typeof response === 'string' && response.trim().length > 0) {
              processingFinishedAt = Date.now();
              sendStartedAt = Date.now();
              const sendResult = await outboundMessageService.sendText(phone, response, {
                messageId: key.id,
                messageType,
                source: 'webhook_response'
              });
              sendFinishedAt = Date.now();
              if (sendResult?.status === 'queued') {
                finalStatus = 'queued';
              }
            }

          } catch (bgError) {
            finalStatus = 'error';
            finalError = bgError.message;
            console.error('[WEBHOOK] [BG] ❌ Erro no processamento em segundo plano:', bgError.message);
            messageReliabilityService.recordFailure({
              kind: 'background_processing_failed',
              phase: 'background',
              phone,
              messageId: key.id,
              messageType,
              reason: bgError.message
            });
            if (evolutionService.validatePhoneNumber(phone)) {
              sendStartedAt = sendStartedAt || Date.now();
              try {
                const fallbackResult = await outboundMessageService.sendText(phone, WEBHOOK_FALLBACK_MESSAGE, {
                  messageId: `${key.id || Date.now()}-fallback`,
                  messageType,
                  source: 'webhook_background_fallback'
                });
                if (fallbackResult?.status === 'queued') {
                  finalStatus = 'queued';
                }
              } catch (fallbackError) {
                finalError = `${bgError.message}; fallback_send_failed=${fallbackError.message}`;
                messageReliabilityService.recordFailure({
                  kind: 'fallback_send_failed',
                  phase: 'send',
                  phone,
                  messageId: key.id,
                  messageType,
                  reason: fallbackError.message
                });
              }
              sendFinishedAt = Date.now();
            }
          } finally {
            const finishedAt = Date.now();
            processingFinishedAt = processingFinishedAt || sendStartedAt || finishedAt;
            whatsappLatencyService.record({
              messageId: key.id,
              phone,
              event,
              messageType,
              webhookAckMs: acknowledgedAt - receivedAt,
              processingMs: processingFinishedAt - processingStartedAt,
              sendMs: sendStartedAt && sendFinishedAt ? sendFinishedAt - sendStartedAt : 0,
              totalMs: finishedAt - receivedAt,
              responseChars: typeof response === 'string' ? response.length : 0,
              status: finalStatus,
              error: finalError
            });
          }
        })();

        return; // Sai do handler principal (já respondeu 200)
      }
    }

    res.status(200).json({ status: 'received' });
  } catch (error) {
    console.error('[WEBHOOK] ❌❌❌ ERRO CRÍTICO NO WEBHOOK ❌❌❌');
    console.error('[WEBHOOK] Erro:', error.message);
    console.error('[WEBHOOK] Stack:', error.stack);
    console.error('[WEBHOOK] Body que causou erro:', JSON.stringify(req.body).substring(0, 500));
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Verificação de webhook da Meta Cloud API (GET /api/webhook)
// A Meta envia este GET ao cadastrar o webhook no painel de desenvolvedores.
// Deve responder com hub.challenge para confirmar ownership da URL.
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.WA_WEBHOOK_VERIFY_TOKEN;

  if (!verifyToken) {
    console.warn('[WEBHOOK] ⚠️ WA_WEBHOOK_VERIFY_TOKEN não configurado — verificação Meta desativada');
    return res.status(403).send('Verification token not configured');
  }

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('[WEBHOOK] ✅ Meta webhook verification OK');
    return res.status(200).send(challenge);
  }

  console.warn('[WEBHOOK] ❌ Meta webhook verification falhou. token recebido:', token);
  return res.status(403).send('Forbidden');
});

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
