const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const messageController = require('../controllers/messageController');
const evolutionService = require('../services/evolutionService');
const userController = require('../controllers/userController');
const registrationTokenService = require('../services/registrationTokenService');

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

          if (response && response.trim() !== '') {
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

// POST /api/user/link-email - Vincula email ao perfil existente (chamado pelo frontend após cadastro)
router.post('/user/link-email', async (req, res) => {
  try {
    const { phone, token, email, password } = req.body;

    if (!phone || !token || !email || !password) {
      return res.status(400).json({ 
        error: 'phone, token, email e password são obrigatórios' 
      });
    }

    // Valida o token de cadastro
    const tokenValidation = await registrationTokenService.validateRegistrationToken(token);
    
    if (!tokenValidation.valid || tokenValidation.phone !== phone) {
      return res.status(400).json({ 
        error: 'Token inválido ou expirado' 
      });
    }

    // Busca o perfil existente pelo telefone
    const supabase = require('../db/supabase');
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('telefone', phone)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({ 
        error: 'Perfil não encontrado para este telefone' 
      });
    }

    // Verifica se já existe usuário com este email
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(u => u.email === email);

    if (existingUser) {
      return res.status(400).json({ 
        error: 'Este email já está cadastrado' 
      });
    }

    // Cria usuário no Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true,
      user_metadata: {
        nome_completo: profile.nome_completo,
        nome_clinica: profile.nome_clinica,
        telefone: phone
      }
    });

    if (authError) {
      console.error('[LINK_EMAIL] Erro ao criar usuário Auth:', authError);
      return res.status(500).json({ 
        error: 'Erro ao criar conta. Tente novamente.' 
      });
    }

    const userId = authData.user.id;

    // Cria novo perfil com o ID do Auth (não podemos atualizar ID de chave primária)
    const { error: createError } = await supabase
      .from('profiles')
      .insert([{
        id: userId,
        nome_completo: profile.nome_completo,
        nome_clinica: profile.nome_clinica,
        telefone: profile.telefone,
        email: email,
        cnpj: profile.cnpj,
        is_active: true
      }]);

    if (createError) {
      // Se der erro (ex: ID já existe), tenta atualizar o perfil existente
      if (createError.code === '23505') {
        // Perfil já existe com este ID, apenas atualiza email
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ email: email })
          .eq('id', userId);

        if (updateError) {
          await supabase.auth.admin.deleteUser(userId);
          console.error('[LINK_EMAIL] Erro ao atualizar perfil:', updateError);
          return res.status(500).json({ 
            error: 'Erro ao vincular email ao perfil' 
          });
        }
      } else {
        // Outro erro, deleta usuário Auth
        await supabase.auth.admin.deleteUser(userId);
        console.error('[LINK_EMAIL] Erro ao criar perfil:', createError);
        return res.status(500).json({ 
          error: 'Erro ao vincular email ao perfil' 
        });
      }
    } else {
      // Se criou novo perfil, deleta o perfil temporário antigo
      if (profile.id !== userId) {
        await supabase
          .from('profiles')
          .delete()
          .eq('id', profile.id);
      }
    }

    // Cria role de admin
    await supabase
      .from('user_roles')
      .insert([{
        user_id: userId,
        role: 'admin'
      }]);

    // Marca token como usado
    await registrationTokenService.markTokenAsUsed(tokenValidation.tokenId);

    // Envia mensagem de confirmação via WhatsApp
    try {
      const confirmationMessage = `*CADASTRO CONCLUÍDO COM SUCESSO!*\n\n` +
        `Seu email foi vinculado ao seu WhatsApp!\n\n` +
        `Agora você tem acesso completo:\n` +
        `🌐 lumiz-financeiro.vercel.app\n\n` +
        `*Pronto pra começar?* 🚀\n\n` +
        `Me manda sua primeira venda assim:\n` +
        `_"Botox 2800 paciente Maria"_\n\n` +
        `Ou manda "ajuda" que te mostro tudo que sei fazer! 😊`;

      await evolutionService.sendMessage(phone, confirmationMessage);
    } catch (whatsappError) {
      console.error('[LINK_EMAIL] Erro ao enviar mensagem WhatsApp (não crítico):', whatsappError);
    }

    res.json({
      success: true,
      message: 'Email vinculado com sucesso',
      userId: userId
    });
  } catch (error) {
    console.error('[LINK_EMAIL] Erro:', error);
    res.status(500).json({ error: error.message || 'Erro interno' });
  }
});

module.exports = router;
