#!/usr/bin/env node

/**
 * Script de diagnóstico para testar conexão com Supabase
 * Rode este script no Railway para verificar se as variáveis estão corretas
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function testSupabaseConnection() {
  console.log('=== DIAGNÓSTICO DE CONEXÃO SUPABASE ===\n');

  // 1. Verificar variáveis de ambiente
  console.log('1️⃣ Verificando variáveis de ambiente...');
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    console.error('❌ SUPABASE_URL não configurada');
    process.exit(1);
  }
  if (!supabaseKey) {
    console.error('❌ SUPABASE_SERVICE_ROLE_KEY não configurada');
    process.exit(1);
  }

  console.log(`✅ SUPABASE_URL: ${supabaseUrl}`);
  console.log(`✅ SUPABASE_SERVICE_ROLE_KEY: ${supabaseKey.substring(0, 20)}...`);
  console.log('');

  // 2. Testar URL válida
  console.log('2️⃣ Validando URL...');
  try {
    const url = new URL(supabaseUrl);
    console.log(`✅ URL válida: ${url.hostname}`);
  } catch (error) {
    console.error(`❌ URL inválida: ${error.message}`);
    process.exit(1);
  }
  console.log('');

  // 3. Testar DNS resolution
  console.log('3️⃣ Testando resolução DNS...');
  try {
    const dns = require('dns').promises;
    const hostname = new URL(supabaseUrl).hostname;
    const addresses = await dns.resolve4(hostname);
    console.log(`✅ DNS resolvido: ${addresses.join(', ')}`);
  } catch (error) {
    console.error(`❌ Falha ao resolver DNS: ${error.message}`);
    console.error('   Isso pode indicar problema de rede no Railway');
  }
  console.log('');

  // 4. Testar conexão HTTP simples
  console.log('4️⃣ Testando conexão HTTP...');
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    });
    console.log(`✅ HTTP conectou: status ${response.status}`);
  } catch (error) {
    console.error(`❌ Falha na conexão HTTP: ${error.message}`);
    console.error(`   Código: ${error.code || 'N/A'}`);
    console.error(`   Causa: ${error.cause?.message || 'N/A'}`);
    process.exit(1);
  }
  console.log('');

  // 5. Testar query real no Supabase
  console.log('5️⃣ Testando query no Supabase...');
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase
      .from('profiles')
      .select('count')
      .limit(1);

    if (error) {
      console.error(`❌ Erro na query: ${error.message}`);
      console.error(`   Código: ${error.code || 'N/A'}`);
      console.error(`   Detalhes: ${error.details || 'N/A'}`);
      process.exit(1);
    }

    console.log('✅ Query executada com sucesso');
    console.log(`   Resultado: ${JSON.stringify(data)}`);
  } catch (error) {
    console.error(`❌ Erro ao executar query: ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
    process.exit(1);
  }
  console.log('');

  console.log('✅ TODOS OS TESTES PASSARAM!');
  console.log('   A conexão com Supabase está funcionando corretamente.');
  process.exit(0);
}

// Executar testes
testSupabaseConnection().catch(error => {
  console.error('❌ ERRO FATAL:', error);
  process.exit(1);
});
