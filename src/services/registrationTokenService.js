const { v4: uuidv4 } = require('uuid');
const supabase = require('../db/supabase');

class RegistrationTokenService {
  /**
   * Gera um token de cadastro vinculado ao telefone
   * Este token permite que o usuário se cadastre no frontend e vincule o email ao perfil existente
   */
  async generateRegistrationToken(phone, expiresInHours = 48) {
    try {
      const token = uuidv4();
      const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

      // Salva o token no banco (usando a mesma tabela setup_tokens, mas com phone ao invés de email)
      const { data, error } = await supabase
        .from('setup_tokens')
        .insert({
          email: `phone_${phone}`, // Usa formato especial para identificar tokens de telefone
          token: token,
          expira_em: expiresAt.toISOString(),
          usado: false
        })
        .select()
        .single();

      if (error) {
        console.error('[REG_TOKEN] Erro ao gerar token:', error);
        throw error;
      }

      console.log(`[REG_TOKEN] Token gerado para telefone ${phone}, expira em ${expiresInHours}h`);
      
      return {
        token,
        expiresAt: expiresAt.toISOString(),
        registrationLink: `https://lumiz-financeiro.vercel.app/setup-account?phone=${encodeURIComponent(phone)}&token=${token}`
      };
    } catch (error) {
      console.error('[REG_TOKEN] Erro ao gerar token de cadastro:', error);
      throw error;
    }
  }

  /**
   * Valida um token de cadastro e retorna o telefone associado
   */
  async validateRegistrationToken(token) {
    try {
      const { data, error } = await supabase
        .from('setup_tokens')
        .select('*')
        .eq('token', token)
        .eq('usado', false)
        .gt('expira_em', new Date().toISOString())
        .single();

      if (error || !data) {
        return { valid: false, phone: null };
      }

      // Extrai o telefone do formato "phone_5511999999999"
      const phoneMatch = data.email?.match(/^phone_(.+)$/);
      if (!phoneMatch) {
        return { valid: false, phone: null };
      }

      return {
        valid: true,
        phone: phoneMatch[1],
        tokenId: data.id
      };
    } catch (error) {
      console.error('[REG_TOKEN] Erro ao validar token:', error);
      return { valid: false, phone: null };
    }
  }

  /**
   * Marca um token como usado após vincular email
   */
  async markTokenAsUsed(tokenId) {
    try {
      await supabase
        .from('setup_tokens')
        .update({ usado: true })
        .eq('id', tokenId);
    } catch (error) {
      console.error('[REG_TOKEN] Erro ao marcar token como usado:', error);
    }
  }
}

module.exports = new RegistrationTokenService();

