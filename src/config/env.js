/**
 * Validação centralizada de variáveis de ambiente
 * Valida todas as variáveis obrigatórias e opcionais na startup
 */

class EnvValidator {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }

  /**
   * Valida todas as variáveis de ambiente
   */
  validate() {
    this.errors = [];
    this.warnings = [];

    // Variáveis obrigatórias
    this.validateRequired('SUPABASE_URL', 'URL do Supabase');
    this.validateRequired('SUPABASE_SERVICE_ROLE_KEY', 'Service Role Key do Supabase');
    this.validateRequired('EVOLUTION_API_URL', 'URL da Evolution API');
    this.validateRequired('EVOLUTION_API_KEY', 'API Key da Evolution API');
    this.validateRequired('EVOLUTION_INSTANCE_NAME', 'Nome da instância Evolution API');

    // Variáveis opcionais mas recomendadas
    this.validateOptional('GEMINI_API_KEY', 'API Key do Google Gemini (opcional)');
    this.validateOptional('GOOGLE_VISION_API_KEY', 'API Key do Google Vision (opcional)');
    this.validateOptional('REDIS_URL', 'URL do Redis (opcional, mas recomendado para cache/filas)');
    this.validateOptional('SENTRY_DSN', 'DSN do Sentry (opcional, mas recomendado para produção)');
    this.validateOptional('CRON_SECRET', 'Segredo para endpoints de cron (recomendado em produção)');
    this.validateOptional('RESEND_API_KEY', 'API key do Resend para envio de e-mails de relatório');
    this.validateOptional(
      'PRICING_BENCHMARK_JSON',
      'JSON opcional para sobrescrever benchmarks de precificação (dashboard)'
    );
    this.validateOptional('METRICS_TOKEN', 'Token para endpoint de métricas (recomendado em produção)');
    this.validateOptional('POSTHOG_API_KEY', 'API Key do PostHog (Fase 17 — analytics de produto)');
    this.validateOptional('POSTHOG_HOST', 'Host do PostHog (default https://us.i.posthog.com)');
    this.validateOptional('LUMIZ_TERMS_VERSION', 'Versão dos Termos de Uso vigente (LGPD)');
    this.validateOptional('LUMIZ_PRIVACY_VERSION', 'Versão da Política de Privacidade vigente (LGPD)');
    this.validateOptional(
      'ASAAS_WEBHOOK_SECRET',
      'Secret do webhook Asaas (opcional enquanto billing Asaas estiver desativado; sem ela o webhook fica 503)'
    );
    this.validateOptional('ALTER_CLIENT_ID',     'Client ID OAuth2 da Alter (obrigatório quando ALTER_CLIENT_SECRET definido)');
    this.validateOptional('ALTER_CLIENT_SECRET',  'Client Secret OAuth2 da Alter (ativa realAlterAdapter quando definido junto com ALTER_CLIENT_ID)');
    this.validateOptional('ALTER_WEBHOOK_SECRET', 'Secret HMAC para webhooks Alter (fornecido pela Alter em canal privado; sem ele o webhook fica 503 em produção)');
    this.validateOptional('WA_WEBHOOK_VERIFY_TOKEN', 'Token de verificação do webhook Meta Cloud API (necessário ao migrar para API oficial do WhatsApp)');
    this.validateOptional('WA_PHONE_NUMBER_ID', 'ID do número WhatsApp no painel Meta Cloud API');
    this.validateOptional('WA_ACCESS_TOKEN', 'Token permanente da Meta Cloud API para envio/download de mídia');
    this.validateOptional('WABA_ID', 'WhatsApp Business Account ID');
    this.validateOptional('WA_GRAPH_API_VERSION', 'Versão do Graph API para Cloud API (ex: v23.0)');
    this.validateOptional('META_APP_SECRET', 'App Secret da Meta para validar X-Hub-Signature-256 em webhooks');
    this.validateOptional('EVOLUTION_WEBHOOK_SECRET', 'Segredo compartilhado para validar POSTs da Evolution no webhook');

    // Validações específicas
    this.validateUrl('SUPABASE_URL');
    this.validateUrl('EVOLUTION_API_URL');
    if (process.env.REDIS_URL) {
      this.validateRedisUrl('REDIS_URL');
    }
    this.validateSensitivePlaceholders();

    // Retorna resultado
    return {
      valid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings
    };
  }

  /**
   * Valida variável obrigatória
   */
  validateRequired(key, description) {
    if (!process.env[key]) {
      this.errors.push(`❌ ${key} (${description}) é obrigatória mas não está configurada`);
    }
  }

  /**
   * Valida variável opcional
   */
  validateOptional(key, description) {
    if (!process.env[key]) {
      this.warnings.push(`⚠️  ${key} (${description}) não está configurada (opcional)`);
    }
  }

  /**
   * Valida formato de URL
   */
  validateUrl(key) {
    const value = process.env[key];
    if (!value) return;

    try {
      new URL(value);
    } catch (error) {
      this.errors.push(`❌ ${key} não é uma URL válida: ${value}`);
    }
  }

  /**
   * Valida formato de URL do Redis
   */
  validateRedisUrl(key) {
    const value = process.env[key];
    if (!value) return;

    // Aceita: redis://, rediss://, redis://user:pass@host:port
    if (!value.match(/^redis(s)?:\/\//)) {
      this.warnings.push(`⚠️  ${key} pode não estar no formato correto. Formato esperado: redis://host:port ou redis://user:pass@host:port`);
    }
  }

  /**
   * Detecta placeholders inseguros como "sua_chave_aqui" ou "change_me"
   */
  isPlaceholder(value) {
    if (!value || typeof value !== 'string') return false;
    const normalized = value.trim().toLowerCase();
    const known = [
      'sua_chave_aqui',
      'sua_chave_evolution',
      'nome_da_instancia',
      'https://sua-evolution-api.com',
      'https://seu-projeto.supabase.co',
      'sua_key',
      'sua_secret',
      'change_me',
      'changeme',
      'replace_me',
      'test',
      'example'
    ];

    if (known.includes(normalized)) return true;
    return normalized.includes('sua_') || normalized.includes('example') || normalized.includes('placeholder');
  }

  validateNotPlaceholder(key, description) {
    const value = process.env[key];
    if (!value) return;
    if (this.isPlaceholder(value)) {
      this.errors.push(`❌ ${key} (${description}) está com valor placeholder/inseguro`);
    }
  }

  validateSensitivePlaceholders() {
    if (process.env.NODE_ENV !== 'production') return;

    this.validateNotPlaceholder('SUPABASE_SERVICE_ROLE_KEY', 'Service Role Key do Supabase');
    this.validateNotPlaceholder('EVOLUTION_API_KEY', 'API Key da Evolution API');
    this.validateNotPlaceholder('GEMINI_API_KEY', 'API Key do Gemini');
    this.validateNotPlaceholder('OPENAI_API_KEY', 'API Key da OpenAI');
    this.validateNotPlaceholder('CRON_SECRET', 'Segredo de cron');
    this.validateNotPlaceholder('METRICS_TOKEN', 'Token de métricas');
    // Asaas ainda pode ficar desativado no rollout inicial. Sem secret, a app
    // deve subir e o endpoint /api/webhooks/asaas permanece fail-closed (503).
    if (process.env.ASAAS_WEBHOOK_SECRET) {
      this.validateNotPlaceholder('ASAAS_WEBHOOK_SECRET', 'Secret do webhook Asaas');
    }
    if (process.env.META_APP_SECRET) {
      this.validateNotPlaceholder('META_APP_SECRET', 'App Secret da Meta');
    }
    if (process.env.EVOLUTION_WEBHOOK_SECRET) {
      this.validateNotPlaceholder('EVOLUTION_WEBHOOK_SECRET', 'Secret do webhook Evolution');
    }
  }

  /**
   * Valida e retorna erro se inválido
   */
  validateOrThrow() {
    const result = this.validate();

    if (!result.valid) {
      console.error('\n❌ ERRO: Variáveis de ambiente obrigatórias não configuradas:\n');
      result.errors.forEach(err => console.error(`  ${err}`));
      console.error('\nConfigure as variáveis no arquivo .env\n');
      throw new Error('Variáveis de ambiente obrigatórias não configuradas');
    }

    if (result.warnings.length > 0) {
      console.warn('\n⚠️  AVISOS: Variáveis opcionais não configuradas:\n');
      result.warnings.forEach(warn => console.warn(`  ${warn}`));
      console.warn('');
    }

    return result;
  }

  /**
   * Retorna configurações validadas
   */
  getConfig() {
    return {
      supabase: {
        url: process.env.SUPABASE_URL,
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
      },
      evolution: {
        url: process.env.EVOLUTION_API_URL,
        apiKey: process.env.EVOLUTION_API_KEY,
        instanceName: process.env.EVOLUTION_INSTANCE_NAME
      },
      gemini: {
        apiKey: process.env.GEMINI_API_KEY || null
      },
      vision: {
        apiKey: process.env.GOOGLE_VISION_API_KEY || null,
        credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS || null
      },
      redis: {
        url: process.env.REDIS_URL || null
      },
      sentry: {
        dsn: process.env.SENTRY_DSN || null
      },
      security: {
        cronSecret: process.env.CRON_SECRET || null,
        metricsToken: process.env.METRICS_TOKEN || null
      },
      posthog: {
        apiKey: process.env.POSTHOG_API_KEY || null,
        host: process.env.POSTHOG_HOST || null
      },
      legal: {
        termsVersion: process.env.LUMIZ_TERMS_VERSION || null,
        privacyVersion: process.env.LUMIZ_PRIVACY_VERSION || null
      },
      asaas: {
        webhookSecret: process.env.ASAAS_WEBHOOK_SECRET || null
      },
      whatsappCloudApi: {
        verifyToken: process.env.WA_WEBHOOK_VERIFY_TOKEN || null,
        phoneNumberId: process.env.WA_PHONE_NUMBER_ID || null,
        accessToken: process.env.WA_ACCESS_TOKEN || null,
        wabaId: process.env.WABA_ID || null,
        graphApiVersion: process.env.WA_GRAPH_API_VERSION || 'v23.0',
        appSecret: process.env.META_APP_SECRET || null,
        evolutionWebhookSecret: process.env.EVOLUTION_WEBHOOK_SECRET || null
      },
      nodeEnv: process.env.NODE_ENV || 'development',
      port: parseInt(process.env.PORT || '3000', 10)
    };
  }
}

// Valida na importação
const validator = new EnvValidator();

// Em desenvolvimento, apenas avisa. Em produção, lança erro.
if (process.env.NODE_ENV !== 'test') {
  const result = validator.validate();
  
  if (!result.valid) {
    console.error('\n❌ ERRO: Variáveis de ambiente obrigatórias não configuradas:\n');
    result.errors.forEach(err => console.error(`  ${err}`));
    console.error('\nConfigure as variáveis no arquivo .env\n');
    
    // Em produção, lança erro. Em desenvolvimento, apenas avisa.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Variáveis de ambiente obrigatórias não configuradas');
    }
  }

  if (result.warnings.length > 0) {
    console.warn('\n⚠️  AVISOS: Variáveis opcionais não configuradas:\n');
    result.warnings.forEach(warn => console.warn(`  ${warn}`));
    console.warn('');
  }
}

module.exports = {
  validator,
  config: validator.getConfig(),
  validate: () => validator.validateOrThrow()
};
