/**
 * Wrapper para adicionar timeout a promises
 * @param {Promise} promise - Promise a ser executada
 * @param {number} timeoutMs - Timeout em milissegundos
 * @param {string} errorMessage - Mensagem de erro personalizada
 * @returns {Promise}
 */
function withTimeout(promise, timeoutMs, errorMessage = 'Operação excedeu o tempo limite') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    )
  ]);
}

/**
 * Retry com exponential backoff
 * @param {Function} fn - Função async a ser executada
 * @param {number} maxRetries - Número máximo de tentativas
 * @param {number} initialDelayMs - Delay inicial em ms
 * @returns {Promise}
 */
async function retryWithBackoff(fn, maxRetries = 3, initialDelayMs = 1000) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Não retry em erros 4xx (client errors)
      if (error.response && error.response.status >= 400 && error.response.status < 500) {
        throw error;
      }
      
      if (attempt < maxRetries - 1) {
        const delay = initialDelayMs * Math.pow(2, attempt);
        console.log(`[RETRY] Tentativa ${attempt + 1}/${maxRetries} falhou, aguardando ${delay}ms antes de retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

module.exports = {
  withTimeout,
  retryWithBackoff
};

