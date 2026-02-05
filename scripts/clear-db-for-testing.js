/**
 * Script para limpar dados do banco para testes de onboarding
 * Uso: node scripts/clear-db-for-testing.js [--all]
 *
 * Sem argumentos: limpa apenas dados de onboarding
 * --all: limpa todos os dados do usuário
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function clearOnboardingData() {
  console.log('🧹 Limpando dados de onboarding...');

  // Limpar tabela onboarding_progress
  const { error: onboardingError } = await supabase
    .from('onboarding_progress')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000'); // Deleta todos

  if (onboardingError) {
    console.error('❌ Erro ao limpar onboarding_progress:', onboardingError.message);
  } else {
    console.log('✅ onboarding_progress limpo');
  }

  // Limpar nudges de onboarding
  const { error: nudgesError } = await supabase
    .from('onboarding_nudges')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');

  if (nudgesError && !nudgesError.message.includes('does not exist')) {
    console.error('❌ Erro ao limpar onboarding_nudges:', nudgesError.message);
  } else {
    console.log('✅ onboarding_nudges limpo');
  }
}

async function clearAllUserData() {
  console.log('🧹 Limpando TODOS os dados de usuário...');

  // Ordem importa por causa de foreign keys
  const tables = [
    'parcelas',
    'atendimento_procedimentos',
    'atendimentos',
    'contas_pagar',
    'agendamentos',
    'procedimentos',
    'clientes',
    'conversation_history',
    'analytics_events',
    'user_insights',
    'clinic_members',
    'onboarding_nudges',
    'onboarding_progress',
    'profiles'
  ];

  for (const table of tables) {
    const { error } = await supabase
      .from(table)
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (error && !error.message.includes('does not exist')) {
      console.error(`❌ Erro ao limpar ${table}:`, error.message);
    } else {
      console.log(`✅ ${table} limpo`);
    }
  }
}

async function main() {
  const clearAll = process.argv.includes('--all');

  console.log('');
  console.log('='.repeat(50));
  console.log(clearAll
    ? '⚠️  LIMPEZA TOTAL DO BANCO DE DADOS'
    : '🔄 Limpeza de dados de onboarding');
  console.log('='.repeat(50));
  console.log('');

  if (clearAll) {
    await clearAllUserData();
  } else {
    await clearOnboardingData();
  }

  console.log('');
  console.log('✨ Limpeza concluída! Pronto para testar onboarding.');
  console.log('');
}

main().catch(console.error);
