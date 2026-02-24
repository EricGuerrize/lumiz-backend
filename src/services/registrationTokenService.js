const { v4: uuidv4 } = require('uuid');
const supabase = require('../db/supabase');
const { normalizePhone } = require('../utils/phone');

class RegistrationTokenService {
  getDashboardBaseUrl() {
    return process.env.DASHBOARD_URL || 'https://lumiz-financeiro.vercel.app';
  }

  getDashboardSetupRoute() {
    const configuredRoute = String(process.env.DASHBOARD_SETUP_ROUTE || '').trim();
    if (!configuredRoute) return '/setup-account';
    return configuredRoute.startsWith('/') ? configuredRoute : `/${configuredRoute}`;
  }

  buildModernSetupLink(token) {
    return `${this.getDashboardBaseUrl()}/setup?token=${encodeURIComponent(token)}`;
  }

  buildLegacySetupLink(phone, token) {
    return `${this.getDashboardBaseUrl()}/setup-account?phone=${encodeURIComponent(phone)}&token=${token}`;
  }

  buildSetupLink(phone, token) {
    const route = this.getDashboardSetupRoute();

    if (route === '/setup') {
      return this.buildModernSetupLink(token);
    }

    // Rota legada /setup-account exige phone+token.
    if (route === '/setup-account') {
      return this.buildLegacySetupLink(phone, token);
    }

    const baseUrl = this.getDashboardBaseUrl();
    const url = new URL(`${baseUrl}${route}`);
    url.searchParams.set('token', token);
    if (phone) {
      url.searchParams.set('phone', phone);
    }
    return url.toString();
  }

  /**
   * Gera um token de cadastro vinculado ao telefone/perfil da clinica.
   * O token e de uso unico e expira por padrao em 24h.
   */
  async generateSetupToken(phone, clinicId = null, expiresInHours = 24) {
    try {
      const normalizedPhone = normalizePhone(phone) || phone;
      const token = uuidv4();
      const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
      const emailMarker = clinicId
        ? `phone_${normalizedPhone}|clinic_${clinicId}`
        : `phone_${normalizedPhone}`;

      const { data, error } = await supabase
        .from('setup_tokens')
        .insert({
          email: emailMarker,
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

      console.log(`[REG_TOKEN] Token gerado para telefone ${normalizedPhone}, expira em ${expiresInHours}h`);

      return {
        id: data.id,
        token,
        phone: normalizedPhone,
        clinicId,
        expiresAt: expiresAt.toISOString(),
        registrationLink: this.buildSetupLink(normalizedPhone, token),
        modernRegistrationLink: this.buildModernSetupLink(token),
        legacyRegistrationLink: this.buildLegacySetupLink(normalizedPhone, token)
      };
    } catch (error) {
      console.error('[REG_TOKEN] Erro ao gerar token de cadastro:', error);
      throw error;
    }
  }

  /**
   * Valida um token de cadastro e retorna o telefone associado
   */
  async validateSetupToken(token) {
    try {
      const { data, error } = await supabase
        .from('setup_tokens')
        .select('*')
        .eq('token', token)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('[REG_TOKEN] Erro ao buscar token:', error);
        return { valid: false, phone: null, clinicId: null, expired: false, reason: 'lookup_error' };
      }

      if (!data) {
        return { valid: false, phone: null, clinicId: null, expired: false, reason: 'not_found' };
      }

      if (data.usado) {
        return {
          valid: false,
          phone: null,
          clinicId: null,
          expired: false,
          reason: 'already_used'
        };
      }

      const expiresAt = data.expira_em ? new Date(data.expira_em) : null;
      const isExpired = !expiresAt || Number.isNaN(expiresAt.getTime())
        ? true
        : expiresAt.getTime() <= Date.now();

      if (isExpired) {
        return {
          valid: false,
          phone: null,
          clinicId: null,
          expired: true,
          reason: 'expired',
          expiresAt: data.expira_em || null
        };
      }

      // Extrai dados do formato:
      // phone_5511999999999
      // phone_5511999999999|clinic_<uuid>
      const phoneMatch = data.email?.match(/^phone_([^|]+)(?:\|clinic_(.+))?$/);
      if (!phoneMatch) {
        return { valid: false, phone: null, clinicId: null, expired: false, reason: 'invalid_marker_format' };
      }

      return {
        valid: true,
        phone: phoneMatch[1],
        clinicId: phoneMatch[2] || null,
        token,
        tokenId: data.id,
        expiresAt: data.expira_em || null,
        expired: false,
        reason: null
      };
    } catch (error) {
      console.error('[REG_TOKEN] Erro ao validar token:', error);
      return { valid: false, phone: null, clinicId: null, expired: false, reason: 'unexpected_error' };
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

  async invalidateByToken(token) {
    try {
      await supabase
        .from('setup_tokens')
        .update({ usado: true })
        .eq('token', token);
    } catch (error) {
      console.error('[REG_TOKEN] Erro ao invalidar token:', error);
    }
  }

  // Compatibilidade retroativa
  async generateRegistrationToken(phone, expiresInHours = 24) {
    return this.generateSetupToken(phone, null, expiresInHours);
  }

  // Compatibilidade retroativa
  async validateRegistrationToken(token) {
    return this.validateSetupToken(token);
  }
}

module.exports = new RegistrationTokenService();
