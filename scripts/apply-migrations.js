#!/usr/bin/env node
/**
 * Script para aplicar as migrations de segurança via Supabase API
 * Requer: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Erro: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devem estar configurados no .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function applyMigration(filePath) {
  console.log(`\n📄 Aplicando: ${path.basename(filePath)}`);
  
  try {
    const sql = fs.readFileSync(filePath, 'utf8');
    
    // Remove comentários e quebras de linha desnecessárias para melhor legibilidade
    const cleanSql = sql.trim();
    
    // Executa o SQL via RPC (usando função exec_sql se disponível) ou via query direta
    const { data, error } = await supabase.rpc('exec_sql', { query_text: cleanSql });
    
    if (error) {
      // Se exec_sql não existir, tenta executar diretamente via query
      // Nota: Supabase JS client não suporta execução direta de SQL arbitrário
      // Vamos usar uma abordagem diferente
      console.log('⚠️  Função exec_sql não disponível. Use o Supabase Dashboard para aplicar.');
      console.log(`   Arquivo: ${filePath}`);
      return false;
    }
    
    console.log('✅ Migration aplicada com sucesso!');
    return true;
  } catch (error) {
    console.error(`❌ Erro ao aplicar migration:`, error.message);
    return false;
  }
}

async function main() {
  console.log('🚀 Aplicando migrations de segurança...\n');
  console.log('⚠️  NOTA: O Supabase JS client não suporta execução direta de SQL.');
  console.log('   Use o Supabase Dashboard (SQL Editor) para aplicar as migrations.\n');
  
  const migrations = [
    path.join(__dirname, '../supabase/migrations/20251216000000_enable_rls_security.sql'),
    path.join(__dirname, '../supabase/migrations/20251216000001_fix_sql_functions_security.sql')
  ];
  
  console.log('📋 Migrations a aplicar:');
  migrations.forEach(m => console.log(`   - ${path.basename(m)}`));
  
  console.log('\n📝 Para aplicar manualmente:');
  console.log('   1. Acesse: https://supabase.com/dashboard/project/whmbyfnwnlbrfmgdwdfw/sql/new');
  console.log('   2. Abra o arquivo: scripts/apply-new-migrations.sql');
  console.log('   3. Copie e cole o conteúdo no SQL Editor');
  console.log('   4. Clique em "Run"\n');
  
  // Tenta verificar se as tabelas existem
  console.log('🔍 Verificando tabelas...');
  const tables = ['onboarding_progress', 'mdr_configs', 'ocr_jobs', 'setup_tokens'];
  
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('*').limit(1);
    if (error && error.code !== 'PGRST116') {
      console.log(`   ⚠️  Tabela ${table}: ${error.message}`);
    } else {
      console.log(`   ✅ Tabela ${table} existe`);
    }
  }
}

main().catch(console.error);

