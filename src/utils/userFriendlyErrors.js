/**
 * Utilitário para converter erros técnicos em mensagens amigáveis ao usuário
 * Usado principalmente para respostas via WhatsApp
 */

// Mapeamento de códigos de erro para mensagens amigáveis
const ERROR_MESSAGES = {
  // Erros de conexão/rede
  'ECONNRESET': {
    message: '🔌 Tive um probleminha de conexão. Pode tentar de novo?',
    retry: true
  },
  'ETIMEDOUT': {
    message: '⏳ Demorou mais do que deveria. Vamos tentar novamente?',
    retry: true
  },
  'ECONNREFUSED': {
    message: '🔌 Não consegui me conectar ao servidor. Tente novamente em instantes.',
    retry: true
  },
  'ENOTFOUND': {
    message: '🔌 Estou com problemas de conexão. Já estamos verificando!',
    retry: false
  },
  'CIRCUIT_OPEN': {
    message: '⚠️ Estamos com problemas temporários. Tente novamente em 1 minuto.',
    retry: true
  },
  
  // Erros de banco de dados (Supabase)
  'PGRST116': {
    message: '🔍 Não encontrei o que você procura.',
    retry: false
  },
  'PGRST201': {
    message: '❌ Dados inválidos. Verifique as informações e tente novamente.',
    retry: false
  },
  'PGRST205': {
    message: '⚠️ Estamos atualizando o sistema. Tente novamente em alguns minutos.',
    retry: true
  },
  '23505': { // Unique constraint violation
    message: '⚠️ Este registro já existe.',
    retry: false
  },
  '23503': { // Foreign key violation
    message: '❌ Referência inválida. Verifique os dados informados.',
    retry: false
  },
  
  // Erros de validação
  'VALIDATION_ERROR': {
    message: '📝 Algo não ficou certo. Pode verificar as informações?',
    retry: false
  },
  'INVALID_PHONE': {
    message: '📱 O número de telefone não parece correto.',
    retry: false
  },
  'INVALID_VALUE': {
    message: '💰 O valor informado não é válido. Use o formato: R$ 1500 ou 1500',
    retry: false
  },
  
  // Erros de autenticação/autorização
  'UNAUTHORIZED': {
    message: '🔒 Você precisa estar cadastrado para isso. Digite "Oi" para começar!',
    retry: false
  },
  'FORBIDDEN': {
    message: '🚫 Você não tem permissão para fazer isso.',
    retry: false
  },
  
  // Erros de serviços externos
  'GEMINI_ERROR': {
    message: '🤖 Tive um probleminha ao processar. Vamos tentar de novo?',
    retry: true
  },
  'VISION_ERROR': {
    message: '👁️ Não consegui ler a imagem. Tenta enviar uma mais nítida?',
    retry: false
  },
  'OCR_FAILED': {
    message: '📄 Não consegui ler o documento. Tenta uma foto mais clara ou digita manualmente.',
    retry: false
  },
  
  // Erros de rate limiting
  'TOO_MANY_REQUESTS': {
    message: '⏳ Muitas mensagens de uma vez! Aguarde um momento.',
    retry: true
  },
  'RATE_LIMIT_EXCEEDED': {
    message: '⏳ Calma! Vamos devagar para eu processar tudo direitinho.',
    retry: true
  },
  
  // Erros de documento
  'IMAGE_TOO_SMALL': {
    message: '📷 A imagem é muito pequena. Envie uma com melhor resolução.',
    retry: false
  },
  'IMAGE_TOO_LARGE': {
    message: '📷 A imagem é muito grande. Envie uma menor (até 20MB).',
    retry: false
  },
  'INVALID_FILE_TYPE': {
    message: '📄 Formato não suportado. Envie JPEG, PNG ou PDF.',
    retry: false
  }
};

// Mensagem padrão quando o erro não é reconhecido
const DEFAULT_ERROR = {
  message: '😅 Ops! Algo deu errado. Vamos tentar de novo?',
  retry: true
};

/**
 * Converte um erro técnico em mensagem amigável para o usuário
 * @param {Error} error - Erro capturado
 * @returns {{ message: string, retry: boolean }}
 */
function getUserFriendlyError(error) {
  // Verifica código do erro
  if (error.code && ERROR_MESSAGES[error.code]) {
    return ERROR_MESSAGES[error.code];
  }
  
  // Verifica se é erro de Supabase/PostgreSQL
  if (error.code && error.code.startsWith('PGRST')) {
    return ERROR_MESSAGES['PGRST201'] || DEFAULT_ERROR;
  }
  
  // Verifica mensagem do erro para padrões conhecidos
  const errorMessage = error.message?.toLowerCase() || '';
  
  if (errorMessage.includes('fetch failed') || errorMessage.includes('network')) {
    return ERROR_MESSAGES['ECONNRESET'];
  }
  
  if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
    return ERROR_MESSAGES['ETIMEDOUT'];
  }
  
  if (errorMessage.includes('rate limit') || errorMessage.includes('too many')) {
    return ERROR_MESSAGES['TOO_MANY_REQUESTS'];
  }
  
  if (errorMessage.includes('validation') || errorMessage.includes('invalid')) {
    return ERROR_MESSAGES['VALIDATION_ERROR'];
  }
  
  if (errorMessage.includes('unauthorized') || errorMessage.includes('unauthenticated')) {
    return ERROR_MESSAGES['UNAUTHORIZED'];
  }
  
  if (errorMessage.includes('forbidden') || errorMessage.includes('permission')) {
    return ERROR_MESSAGES['FORBIDDEN'];
  }
  
  // Se não reconhecer, retorna mensagem padrão
  return DEFAULT_ERROR;
}

/**
 * Formata resposta de erro para WhatsApp
 * @param {Error} error - Erro capturado
 * @param {Object} options - Opções de formatação
 * @returns {string} Mensagem formatada para WhatsApp
 */
function formatErrorForWhatsApp(error, options = {}) {
  const { 
    includeRetryTip = true,
    includeContactSupport = false,
    customSuffix = null
  } = options;
  
  const friendlyError = getUserFriendlyError(error);
  let message = friendlyError.message;
  
  if (includeRetryTip && friendlyError.retry) {
    message += '\n\n💡 _Dica: Tente enviar novamente em alguns instantes._';
  }
  
  if (includeContactSupport) {
    message += '\n\n📞 _Se o problema persistir, fale com o suporte._';
  }
  
  if (customSuffix) {
    message += '\n\n' + customSuffix;
  }
  
  return message;
}

/**
 * Analisa erro e decide se deve fazer retry
 * @param {Error} error 
 * @returns {boolean}
 */
function shouldRetryAfterError(error) {
  const friendlyError = getUserFriendlyError(error);
  return friendlyError.retry;
}

/**
 * Classifica o erro para logging/analytics
 * @param {Error} error 
 * @returns {string}
 */
function classifyError(error) {
  const code = error.code || '';
  const message = error.message?.toLowerCase() || '';
  
  if (code.startsWith('PGRST') || code.startsWith('23') || message.includes('database')) {
    return 'database';
  }
  
  if (['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND'].includes(code) || 
      message.includes('network') || message.includes('fetch failed')) {
    return 'network';
  }
  
  if (message.includes('validation') || message.includes('invalid') || code === 'VALIDATION_ERROR') {
    return 'validation';
  }
  
  if (message.includes('unauthorized') || message.includes('forbidden') || 
      ['UNAUTHORIZED', 'FORBIDDEN'].includes(code)) {
    return 'auth';
  }
  
  if (message.includes('gemini') || message.includes('vision') || message.includes('ocr')) {
    return 'external_service';
  }
  
  if (message.includes('rate') || message.includes('limit')) {
    return 'rate_limit';
  }
  
  return 'unknown';
}

module.exports = {
  getUserFriendlyError,
  formatErrorForWhatsApp,
  shouldRetryAfterError,
  classifyError,
  ERROR_MESSAGES,
  DEFAULT_ERROR
};
