const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// #region agent log - Debug: Log env vars on module load
const _supabaseUrl = process.env.SUPABASE_URL;
const _supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log(`[DEBUG-SUPABASE] ENV CHECK - URL exists: ${!!_supabaseUrl}, URL value: ${_supabaseUrl ? _supabaseUrl.substring(0, 30) + '...' : 'UNDEFINED'}, KEY exists: ${!!_supabaseKey}, KEY prefix: ${_supabaseKey ? _supabaseKey.substring(0, 20) + '...' : 'UNDEFINED'}`);
// #endregion

// Retry fetch wrapper para lidar com falhas intermitentes de rede
const fetchWithRetry = async (url, options, retries = 3, delay = 1000) => {
  // #region agent log - Debug: Log fetch attempt details
  const urlObj = typeof url === 'string' ? new URL(url) : url;
  console.log(`[DEBUG-SUPABASE] FETCH ATTEMPT - Host: ${urlObj.hostname}, Path: ${urlObj.pathname}, Full URL length: ${url.toString().length}`);
  // #endregion
  
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      // #region agent log - Debug: Log successful response
      console.log(`[DEBUG-SUPABASE] FETCH SUCCESS - Status: ${response.status}, Attempt: ${i + 1}`);
      // #endregion
      return response;
    } catch (error) {
      // #region agent log - Debug: Log detailed error info
      console.log(`[DEBUG-SUPABASE] FETCH ERROR - Attempt: ${i + 1}, Message: ${error.message}, Code: ${error.code || 'N/A'}, Cause: ${error.cause?.message || 'N/A'}, CauseCode: ${error.cause?.code || 'N/A'}, Stack: ${error.stack?.split('\n')[1]?.trim() || 'N/A'}`);
      // #endregion
      
      // Se é o último retry, lança o erro
      if (i === retries - 1) {
        console.error(`[SUPABASE] Falha após ${retries} tentativas: ${error.message}`);
        throw error;
      }
      
      // Log do retry (apenas em desenvolvimento ou se for erro de rede)
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

// #region agent log - Debug: Test DNS resolution on startup
const dns = require('dns').promises;
const testHost = _supabaseUrl ? new URL(_supabaseUrl).hostname : null;
if (testHost) {
  dns.resolve4(testHost).then(addresses => {
    console.log(`[DEBUG-SUPABASE] DNS RESOLVED - Host: ${testHost}, IPs: ${addresses.join(', ')}`);
  }).catch(err => {
    console.log(`[DEBUG-SUPABASE] DNS FAILED - Host: ${testHost}, Error: ${err.message}, Code: ${err.code}`);
  });
}
// #endregion

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
