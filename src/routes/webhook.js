const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const evolutionService = require('../services/evolutionService');

router.post('/webhook', async (req, res) => {
  try {
    console.log('Webhook recebido:', JSON.stringify(req.body, null, 2));

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
      const messageText = message.conversation ||
                          message.extendedTextMessage?.text ||
                          '';

      if (phone && messageText) {
        console.log(`Processando mensagem de ${phone}: ${messageText}`);

        // Processa e envia resposta
        try {
          const response = await messageController.handleIncomingMessage(phone, messageText);
          console.log(`Resposta gerada: ${response}`);

          if (response) {
            await evolutionService.sendMessage(phone, response);
            console.log('Resposta enviada com sucesso');
          }
        } catch (error) {
          console.error('Erro ao processar mensagem:', error);
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
