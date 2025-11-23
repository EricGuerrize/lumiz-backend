const supabase = require('../db/supabase');

class EmailService {
  /**
   * Envia email de setup de conta para novo usuário
   */
  async sendSetupEmail(email, nome) {
    try {
      console.log(`[EMAIL] Enviando email de setup para ${email}`);

      // Verifica se Edge Function está disponível
      if (!supabase.functions) {
        console.warn('[EMAIL] Supabase Functions não disponível. Edge Functions podem não estar deployadas.');
        return null;
      }

      // Chama a Edge Function do Supabase
      const { data, error } = await supabase.functions.invoke('enviar-email-setup', {
        body: {
          email,
          nome: nome || ''
        }
      });

      if (error) {
        console.error('[EMAIL] Erro ao chamar Edge Function:', error);
        console.error('[EMAIL] Detalhes do erro:', JSON.stringify(error, null, 2));

        // Se a função não existe, avisa mas não quebra
        if (error.message && error.message.includes('not found')) {
          console.warn('[EMAIL] Edge Function não encontrada. Faça deploy: supabase functions deploy enviar-email-setup');
        }

        return null;
      }

      if (data && data.error) {
        console.error('[EMAIL] Erro retornado pela Edge Function:', data.error);
        return null;
      }

      console.log('[EMAIL] Email enviado com sucesso:', data);
      return data;
    } catch (error) {
      console.error('[EMAIL] Erro ao enviar email:', error);
      console.error('[EMAIL] Stack:', error.stack);
      // Não lança erro para não quebrar o fluxo de criação de usuário
      // O email pode ser reenviado depois
      return null;
    }
  }

  /**
   * Envia email de boas-vindas após cadastro completo
   */
  async sendWelcomeEmail(email, nome) {
    try {
      console.log(`[EMAIL] Enviando email de boas-vindas para ${email}`);

      if (!supabase.functions) {
        return null;
      }

      const { data, error } = await supabase.functions.invoke('enviar-email-boas-vindas', {
        body: {
          email,
          nome: nome || ''
        }
      });

      if (error) {
        console.warn('[EMAIL] Erro ao enviar email de boas-vindas (não crítico):', error.message);
        return null;
      }

      console.log('[EMAIL] Email de boas-vindas enviado com sucesso');
      return data;
    } catch (error) {
      console.error('[EMAIL] Erro ao enviar email de boas-vindas:', error);
      return null;
    }
  }

  /**
   * Valida token de setup
   */
  async validateSetupToken(email, token) {
    try {
      const { data, error } = await supabase.functions.invoke('validar-token-setup', {
        body: {
          email,
          token
        }
      });

      if (error) {
        console.error('[EMAIL] Erro ao validar token:', error);
        return { valid: false, message: 'Erro ao validar token' };
      }

      return data;
    } catch (error) {
      console.error('[EMAIL] Erro ao validar token:', error);
      return { valid: false, message: 'Erro ao validar token' };
    }
  }
}

module.exports = new EmailService();

