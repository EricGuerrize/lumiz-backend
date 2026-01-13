/**
 * Script Node.js para limpar todos os dados de usuários do banco
 * ⚠️ ATENÇÃO: Este script apaga TODOS os dados de usuários!
 * Use apenas em ambiente de desenvolvimento/teste
 */

require('dotenv').config();
const supabase = require('../src/db/supabase');

async function clearAllUserData() {
  console.log('='.repeat(80));
  console.log('⚠️  LIMPEZA DE DADOS DE USUÁRIOS');
  console.log('='.repeat(80));
  console.log('');

  try {
    // Conta registros antes
    console.log('📊 Contando registros antes da limpeza...');
    const { count: profilesCount } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true });
    
    const { count: atendimentosCount } = await supabase
      .from('atendimentos')
      .select('*', { count: 'exact', head: true });
    
    const { count: contasCount } = await supabase
      .from('contas_pagar')
      .select('*', { count: 'exact', head: true });
    
    const { count: clientesCount } = await supabase
      .from('clientes')
      .select('*', { count: 'exact', head: true });

    console.log(`   Usuários: ${profilesCount || 0}`);
    console.log(`   Atendimentos: ${atendimentosCount || 0}`);
    console.log(`   Contas a pagar: ${contasCount || 0}`);
    console.log(`   Clientes: ${clientesCount || 0}`);
    console.log('');

    // Confirmação
    console.log('⚠️  Você está prestes a apagar TODOS os dados de usuários!');
    console.log('   Isso inclui:');
    console.log('   - Todos os usuários (profiles)');
    console.log('   - Todos os atendimentos');
    console.log('   - Todas as contas a pagar');
    console.log('   - Todos os clientes');
    console.log('   - Todos os procedimentos');
    console.log('   - Todo o histórico de onboarding');
    console.log('   - Todas as configurações MDR');
    console.log('   - Todos os insights');
    console.log('   - Todo o histórico de conversas');
    console.log('');

    // Executa limpeza na ordem correta (respeitando foreign keys)
    console.log('🗑️  Executando limpeza...');
    console.log('');

    // 1. Tabelas filhas que dependem de outras tabelas filhas
    const tables = [
      'parcelas',
      'atendimento_procedimentos',
      'atendimentos',
      'contas_pagar',
      'agendamentos',
      'procedimentos',
      'clientes',
      'user_roles',
      'onboarding_progress',
      'mdr_configs',
      'ocr_jobs',
      'user_insights',
      'conversation_history',
      'whatsapp_states'
    ];

    for (const table of tables) {
      try {
        const { error, count } = await supabase
          .from(table)
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000')
          .select('*', { count: 'exact', head: true });
        
        if (error) {
          // Ignora erro se tabela não existir
          if (!error.message.includes('does not exist') && !error.message.includes('relation') && !error.message.includes('permission')) {
            console.log(`   ⚠️  ${table}: ${error.message}`);
          } else {
            console.log(`   ⏭️  ${table}: tabela não existe ou sem permissão`);
          }
        } else {
          console.log(`   ✅ ${table} apagado`);
        }
      } catch (e) {
        // Ignora erros de tabela não existente
        if (!e.message.includes('does not exist') && !e.message.includes('relation')) {
          console.log(`   ⚠️  ${table}: ${e.message}`);
        }
      }
    }

    // 2. Apaga profiles por último
    console.log('');
    const { error: profilesError } = await supabase
      .from('profiles')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    
    if (profilesError) {
      console.error('   ❌ Erro ao apagar profiles:', profilesError.message);
    } else {
      console.log('   ✅ Profiles apagados');
    }

    // Verifica resultado
    console.log('');
    console.log('📊 Verificando resultado...');
    const { count: finalProfilesCount } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true });

    const { count: finalAtendimentosCount } = await supabase
      .from('atendimentos')
      .select('*', { count: 'exact', head: true });

    console.log('');
    console.log('='.repeat(80));
    if (finalProfilesCount === 0 && finalAtendimentosCount === 0) {
      console.log('✅ LIMPEZA CONCLUÍDA COM SUCESSO!');
      console.log('   Todos os dados de usuários foram apagados.');
      console.log('   Agora você pode testar o onboarding como um usuário novo.');
    } else {
      console.log('⚠️  Ainda existem alguns registros no banco.');
      console.log(`   Profiles restantes: ${finalProfilesCount || 0}`);
      console.log(`   Atendimentos restantes: ${finalAtendimentosCount || 0}`);
    }
    console.log('='.repeat(80));

  } catch (error) {
    console.error('');
    console.error('❌ Erro durante limpeza:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Executa se chamado diretamente
if (require.main === module) {
  clearAllUserData()
    .then(() => {
      console.log('');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Erro fatal:', error);
      process.exit(1);
    });
}

module.exports = { clearAllUserData };

