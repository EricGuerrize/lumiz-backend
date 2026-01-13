/**
 * Utilitários de resiliência: timeout, retry, circuit breaker
 */

// Erros que são retriable (erros de rede/temporários)
const RETRIABLE_ERROR_CODES = [
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ENETUNREACH',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH'
];

const RETRIABLE_HTTP_CODES = [408, 429, 500, 502, 503, 504];

/**
 * Verifica se um erro é retriable
 * @param {Error} error 
 * @returns {boolean}
 */
function isRetriableError(error) {
  // Erro de rede
  if (error.code && RETRIABLE_ERROR_CODES.includes(error.code)) {
    return true;
  }
  
  // Erro HTTP temporário
  if (error.response && RETRIABLE_HTTP_CODES.includes(error.response.status)) {
    return true;
  }
  
  // "fetch failed" genérico
  if (error.message && error.message.includes('fetch failed')) {
    return true;
  }
  
  // Timeout
  if (error.message && (error.message.includes('timeout') || error.message.includes('Timeout'))) {
    return true;
  }
  
  return false;
}

/**
 * Wrapper para adicionar timeout a promises
 * @param {Promise} promise - Promise a ser executada
 * @param {number} timeoutMs - Timeout em milissegundos
 * @param {string} errorMessage - Mensagem de erro personalizada
 * @returns {Promise}
 */
function withTimeout(promise, timeoutMs, errorMessage = 'Operação excedeu o tempo limite') {
  let timeoutId;
  
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(errorMessage);
      error.code = 'ETIMEDOUT';
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([
    promise.then(result => {
      clearTimeout(timeoutId);
      return result;
    }),
    timeoutPromise
  ]);
}

/**
 * Retry com exponential backoff
 * @param {Function} fn - Função async a ser executada
 * @param {number} maxRetries - Número máximo de tentativas
 * @param {number} initialDelayMs - Delay inicial em ms
 * @param {Object} options - Opções adicionais
 * @returns {Promise}
 */
async function retryWithBackoff(fn, maxRetries = 3, initialDelayMs = 1000, options = {}) {
  const {
    maxDelayMs = 30000,
    onRetry = null,
    shouldRetry = isRetriableError,
    jitter = true
  } = options;

  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Verifica se o erro é retriable
      if (!shouldRetry(error)) {
        throw error;
      }
      
      if (attempt < maxRetries - 1) {
        // Calcula delay com exponential backoff
        let delay = initialDelayMs * Math.pow(2, attempt);
        
        // Aplica jitter (±20%) para evitar thundering herd
        if (jitter) {
          const jitterFactor = 0.8 + Math.random() * 0.4; // 0.8 a 1.2
          delay = Math.floor(delay * jitterFactor);
        }
        
        // Limita ao máximo
        delay = Math.min(delay, maxDelayMs);
        
        console.log(`[RETRY] Tentativa ${attempt + 1}/${maxRetries} falhou (${error.message}), aguardando ${delay}ms...`);
        
        // Callback para tracking/logging
        if (onRetry) {
          onRetry(error, attempt, delay);
        }
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  // Adiciona contexto ao erro final
  lastError.retriedTimes = maxRetries;
  throw lastError;
}

/**
 * Executa com fallback em caso de erro
 * @param {Function} primaryFn - Função principal
 * @param {Function} fallbackFn - Função de fallback
 * @param {Object} options
 * @returns {Promise}
 */
async function withFallback(primaryFn, fallbackFn, options = {}) {
  const { onFallback = null } = options;
  
  try {
    return await primaryFn();
  } catch (primaryError) {
    console.warn('[FALLBACK] Função principal falhou, tentando fallback:', primaryError.message);
    
    if (onFallback) {
      onFallback(primaryError);
    }
    
    try {
      return await fallbackFn();
    } catch (fallbackError) {
      // Loga ambos erros mas lança o do fallback
      console.error('[FALLBACK] Fallback também falhou:', fallbackError.message);
      fallbackError.primaryError = primaryError;
      throw fallbackError;
    }
  }
}

/**
 * Circuit breaker simples
 * Previne chamadas repetidas a um serviço que está falhando
 */
class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeoutMs = options.resetTimeoutMs || 60000;
    this.name = options.name || 'default';
    
    this.failures = 0;
    this.lastFailureTime = null;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
  }

  async execute(fn) {
    // Verifica se o circuito deve ser resetado
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
        console.log(`[CIRCUIT_BREAKER:${this.name}] Estado: HALF_OPEN (testando)`);
      } else {
        const error = new Error(`Circuit breaker OPEN para ${this.name}`);
        error.code = 'CIRCUIT_OPEN';
        throw error;
      }
    }

    try {
      const result = await fn();
      
      // Sucesso - reseta contadores
      if (this.state === 'HALF_OPEN') {
        console.log(`[CIRCUIT_BREAKER:${this.name}] Estado: CLOSED (recuperado)`);
      }
      this.failures = 0;
      this.state = 'CLOSED';
      
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();
      
      if (this.failures >= this.failureThreshold) {
        this.state = 'OPEN';
        console.warn(`[CIRCUIT_BREAKER:${this.name}] Estado: OPEN (${this.failures} falhas)`);
      }
      
      throw error;
    }
  }

  reset() {
    this.failures = 0;
    this.state = 'CLOSED';
    this.lastFailureTime = null;
  }

  getState() {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime
    };
  }
}

// Circuit breakers pré-configurados para serviços críticos
const circuitBreakers = {
  supabase: new CircuitBreaker({ name: 'supabase', failureThreshold: 3, resetTimeoutMs: 30000 }),
  gemini: new CircuitBreaker({ name: 'gemini', failureThreshold: 5, resetTimeoutMs: 60000 }),
  vision: new CircuitBreaker({ name: 'vision', failureThreshold: 5, resetTimeoutMs: 60000 }),
  evolution: new CircuitBreaker({ name: 'evolution', failureThreshold: 5, resetTimeoutMs: 30000 })
};

module.exports = {
  withTimeout,
  retryWithBackoff,
  withFallback,
  isRetriableError,
  CircuitBreaker,
  circuitBreakers,
  RETRIABLE_ERROR_CODES,
  RETRIABLE_HTTP_CODES
};

