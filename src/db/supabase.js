const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Retry fetch wrapper para lidar com falhas intermitentes de rede
const fetchWithRetry = async (url, options, retries = 3, delay = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      return response;
    } catch (error) {
      // Se é o último retry, lança o erro
      if (i === retries - 1) {
        console.error(`[SUPABASE] Falha após ${retries} tentativas: ${error.message}`);
        throw error;
      }
      
      // Log do retry (apenas se for erro de rede)
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.message.includes('fetch failed')) {
        console.log(`[SUPABASE] Retry ${i + 1}/${retries} após erro de rede: ${error.message}`);
        // Espera antes de tentar novamente (backoff exponencial)
        await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
      } else {
        // Se não for erro de rede, não tenta novamente
        throw error;
      }
    }
  }
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    global: {
      fetch: fetchWithRetry
    }
  }
);

module.exports = supabase;
