const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const evolutionService = require('../services/evolutionService');

router.post('/webhook', async (req, res) => {
  try {
    // Reduzido para evitar rate limit do Railway
    const { event, data } = req.body;

    if (event === 'messages.upsert') {
      const key = data?.key;
      const message = data?.message;

      if (!key || !message) {
        console.log('Mensagem sem estrutura válida');
        return res.status(200).json({ status: 'ignored', reason: 'invalid structure' });
      }

      if (key.fromMe) {
        return res.status(200).json({ status: 'ignored', reason: 'own message' });
      }

      const phone = key.remoteJid?.split('@')[0];

      // Extrai texto da mensagem
      const messageText = message.conversation ||
                          message.extendedTextMessage?.text ||
                          '';

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
