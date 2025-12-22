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

    // Validações específicas
    this.validateUrl('SUPABASE_URL');
    this.validateUrl('EVOLUTION_API_URL');
    if (process.env.REDIS_URL) {
      this.validateRedisUrl('REDIS_URL');
    }

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

