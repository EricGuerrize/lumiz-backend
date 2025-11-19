const supabase = require('../db/supabase');

class EmailService {
  /**
   * Envia email de setup de conta para novo usuário
   */
  async sendSetupEmail(email, nome) {
    try {
      console.log(`[EMAIL] Enviando email de setup para ${email}`);

      // Chama a Edge Function do Supabase
      const { data, error } = await supabase.functions.invoke('enviar-email-setup', {
        body: {
          email,
          nome: nome || ''
        }
      });

      if (error) {
        console.error('[EMAIL] Erro ao chamar Edge Function:', error);
        throw error;
      }

      console.log('[EMAIL] Email enviado com sucesso:', data);
      return data;
    } catch (error) {
      console.error('[EMAIL] Erro ao enviar email:', error);
      // Não lança erro para não quebrar o fluxo de criação de usuário
      // O email pode ser reenviado depois
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

