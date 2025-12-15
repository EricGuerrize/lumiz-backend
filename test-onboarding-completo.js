#!/usr/bin/env node

/**
 * Teste Completo do Onboarding e Bot Lumiz
 * Testa todo o fluxo desde o onboarding até envio de imagens
 */

require('dotenv').config();
const messageController = require('./src/controllers/messageController');
const onboardingFlowService = require('./src/services/onboardingFlowService');
const userController = require('./src/controllers/userController');
const supabase = require('./src/db/supabase');

// Cores para output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(70));
  log(title, 'cyan');
  console.log('='.repeat(70));
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

function logStep(step, message) {
  log(`\n[${step}] ${message}`, 'magenta');
}

// Resultados dos testes
const results = {
  passed: 0,
  failed: 0,
  warnings: 0,
  tests: []
};

function addResult(testName, passed, message = '', isWarning = false) {
  results.tests.push({ testName, passed, message, isWarning });
  if (isWarning) {
    results.warnings++;
    logWarning(`${testName}: ${message}`);
  } else if (passed) {
    results.passed++;
    logSuccess(`${testName}: ${message || 'OK'}`);
  } else {
    results.failed++;
    logError(`${testName}: ${message || 'FALHOU'}`);
  }
}

// Gera telefone de teste único
const testPhone = `5511999${Math.floor(Math.random() * 100000)}`;

// Limpa dados de teste anteriores
async function cleanupTestData() {
  logSection('🧹 Limpeza de Dados de Teste');
  
  try {
    // Remove usuário de teste se existir
    const { data: users } = await supabase
      .from('profiles')
      .select('id')
      .eq('telefone', testPhone);
    
    if (users && users.length > 0) {
      const userId = users[0].id;
      
      // Remove dados relacionados
      await supabase.from('atendimentos').delete().eq('user_id', userId);
      await supabase.from('contas_pagar').delete().eq('user_id', userId);
      await supabase.from('onboarding_progress').delete().eq('phone', testPhone);
      
      // Remove usuário
      await supabase.from('profiles').delete().eq('id', userId);
      
      logSuccess(`Dados de teste anteriores removidos para ${testPhone}`);
    } else {
      logInfo('Nenhum dado anterior encontrado');
    }
    
    // Limpa estado de onboarding em memória
    if (onboardingFlowService.isOnboarding(testPhone)) {
      onboardingFlowService.onboardingStates.delete(testPhone);
    }
    
    addResult('Limpeza', true, 'Dados anteriores removidos');
  } catch (error) {
    addResult('Limpeza', false, error.message);
  }
}

// Testa variáveis de ambiente
function testEnvironment() {
  logSection('🔧 Verificação de Ambiente');
  
  const required = [
    'EVOLUTION_API_URL',
    'EVOLUTION_API_KEY',
    'EVOLUTION_INSTANCE_NAME',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'GEMINI_API_KEY'
  ];
  
  let allOk = true;
  required.forEach(env => {
    if (process.env[env]) {
      addResult(`ENV ${env}`, true, 'Configurado');
    } else {
      addResult(`ENV ${env}`, false, 'NÃO CONFIGURADO');
      allOk = false;
    }
  });
  
  return allOk;
}

// Testa conexão com Supabase
async function testSupabaseConnection() {
  logSection('🗄️  Teste de Conexão Supabase');
  
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .limit(1);
    
    if (error) throw error;
    
    addResult('Conexão Supabase', true, 'Conectado com sucesso');
    return true;
  } catch (error) {
    addResult('Conexão Supabase', false, error.message);
    return false;
  }
}

// Limpa transações pendentes
function clearPendingTransactions() {
  if (messageController.pendingTransactions) {
    messageController.pendingTransactions.delete(testPhone);
  }
  if (messageController.pendingDocumentTransactions) {
    messageController.pendingDocumentTransactions.delete(testPhone);
  }
  if (messageController.pendingEdits) {
    messageController.pendingEdits.delete(testPhone);
  }
  if (messageController.awaitingData) {
    messageController.awaitingData.delete(testPhone);
  }
}

// Simula envio de mensagem
async function sendMessage(message, isImage = false, imageUrl = null) {
  logStep('USUÁRIO', message);
  
  try {
    let response;
    
    if (isImage && imageUrl) {
      // Simula envio de imagem
      response = await messageController.handleImageMessage(testPhone, imageUrl, message || '');
    } else {
      // Mensagem de texto normal
      response = await messageController.handleIncomingMessage(testPhone, message);
    }
    
    if (response) {
      logStep('BOT', response.substring(0, 200) + (response.length > 200 ? '...' : ''));
    } else {
      logWarning('Bot não retornou resposta');
    }
    
    return response;
  } catch (error) {
    logError(`Erro ao processar mensagem: ${error.message}`);
    console.error(error);
    return null;
  }
}

// Testa fluxo completo de onboarding
async function testOnboardingFlow() {
  logSection('📋 Teste do Fluxo de Onboarding');
  
  const steps = [
    {
      name: 'Início do Onboarding',
      message: 'quero organizar',
      expected: ['tipo', 'clínica', 'estética', 'odonto'],
      allowError: true // Permite erro de envio de mensagem (número de teste não existe no WhatsApp)
    },
    {
      name: 'Seleção de Tipo',
      message: '1',
      expected: ['nome', 'clínica']
    },
    {
      name: 'Nome da Clínica',
      message: 'Clínica Teste Automatizado',
      expected: ['cidade']
    },
    {
      name: 'Cidade',
      message: 'São Paulo - SP',
      expected: ['responsável', 'CPF', 'CNPJ']
    },
    {
      name: 'Responsável com CPF',
      message: 'João Silva 12345678901',
      expected: ['email']
    },
    {
      name: 'Email',
      message: 'teste@lumiz.com.br',
      expected: ['WhatsApp', 'contato']
    },
    {
      name: 'WhatsApp',
      message: 'este',
      expected: ['cadastro', 'completo', 'teste']
    },
    {
      name: 'Confirmação do Teste',
      message: 'confirmar',
      expected: ['resumo', 'financeiro', 'receitas']
    },
    {
      name: 'Finalização',
      message: 'uau',
      expected: ['pronto', 'começar']
    }
  ];
  
  let allPassed = true;
  
  for (const step of steps) {
    logStep('TESTE', step.name);
    
    const response = await sendMessage(step.message);
    
    if (!response) {
      if (step.allowError) {
        // Se permite erro e não há resposta, verifica se o estado foi criado
        const isOnboarding = onboardingFlowService.isOnboarding(testPhone);
        if (isOnboarding) {
          addResult(`Onboarding: ${step.name}`, true, 'Estado criado (erro de envio ignorado)', true);
        } else {
          addResult(`Onboarding: ${step.name}`, false, 'Sem resposta e estado não criado');
          allPassed = false;
        }
      } else {
        addResult(`Onboarding: ${step.name}`, false, 'Sem resposta do bot');
        allPassed = false;
      }
      continue;
    }
    
    const responseLower = response.toLowerCase();
    const hasExpected = step.expected.some(exp => responseLower.includes(exp));
    
    // Se resposta contém erro mas permite erro, verifica se estado foi criado
    if (responseLower.includes('erro') && step.allowError) {
      const isOnboarding = onboardingFlowService.isOnboarding(testPhone);
      if (isOnboarding) {
        addResult(`Onboarding: ${step.name}`, true, 'Estado criado (erro de envio ignorado)', true);
      } else {
        addResult(`Onboarding: ${step.name}`, false, 'Erro e estado não criado');
        allPassed = false;
      }
    } else if (hasExpected) {
      addResult(`Onboarding: ${step.name}`, true, 'Resposta correta');
    } else {
      addResult(`Onboarding: ${step.name}`, false, `Resposta não contém palavras esperadas: ${step.expected.join(', ')}`);
      allPassed = false;
    }
    
    // Pequeno delay entre mensagens
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Verifica se usuário foi criado
  try {
    const user = await userController.findUserByPhone(testPhone);
    if (user) {
      addResult('Onboarding: Usuário Criado', true, `ID: ${user.id}`);
    } else {
      addResult('Onboarding: Usuário Criado', false, 'Usuário não foi criado no banco');
      allPassed = false;
    }
  } catch (error) {
    addResult('Onboarding: Usuário Criado', false, error.message);
    allPassed = false;
  }
  
  return allPassed;
}

// Limpa transações pendentes
function clearPendingTransactions() {
  if (messageController.pendingTransactions) {
    messageController.pendingTransactions.delete(testPhone);
  }
  if (messageController.pendingDocumentTransactions) {
    messageController.pendingDocumentTransactions.delete(testPhone);
  }
  if (messageController.pendingEdits) {
    messageController.pendingEdits.delete(testPhone);
  }
  if (messageController.awaitingData) {
    messageController.awaitingData.delete(testPhone);
  }
}

// Testa funcionalidades do bot após onboarding
async function testBotFeatures() {
  logSection('🤖 Teste de Funcionalidades do Bot');
  
  // Aguarda um pouco para garantir que onboarding terminou
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Limpa qualquer transação pendente antes de começar
  clearPendingTransactions();
  
  const features = [
    {
      name: 'Registrar Venda',
      message: 'vendi 500 reais de botox no pix',
      expected: ['confirmar', 'registrado', 'venda', 'entrada', 'sucesso'],
      needsConfirmation: true
    },
    {
      name: 'Confirmar Venda',
      message: 'sim',
      expected: ['registrado', 'sucesso', 'venda', 'receita'],
      skipIfNoPending: true
    },
    {
      name: 'Registrar Custo',
      message: 'gastei 200 de insumos',
      expected: ['confirmar', 'registrado', 'custo', 'saída', 'sucesso'],
      needsConfirmation: true
    },
    {
      name: 'Confirmar Custo',
      message: 'sim',
      expected: ['registrado', 'sucesso', 'custo'],
      skipIfNoPending: true
    },
    {
      name: 'Consultar Saldo',
      message: 'qual meu saldo?',
      expected: ['saldo', 'receitas', 'custos', 'lucro', 'movimentações']
    },
    {
      name: 'Histórico',
      message: 'mostra meu histórico',
      expected: ['histórico', 'transações', 'venda', 'custo', 'movimentações', 'últimas']
    }
  ];
  
  let allPassed = true;
  
  for (const feature of features) {
    logStep('TESTE', feature.name);
    
    // Se precisa de confirmação pendente mas não tem, pula
    if (feature.skipIfNoPending) {
      const hasPending = messageController.pendingTransactions?.has(testPhone);
      if (!hasPending) {
        logInfo(`Pulando ${feature.name} - nenhuma transação pendente`);
        addResult(`Bot: ${feature.name}`, true, 'Pulado (sem pendência)', true);
        continue;
      }
    }
    
    const response = await sendMessage(feature.message);
    
    if (!response) {
      addResult(`Bot: ${feature.name}`, false, 'Sem resposta');
      allPassed = false;
      continue;
    }
    
    const responseLower = response.toLowerCase();
    const hasExpected = feature.expected.some(exp => responseLower.includes(exp));
    
    if (hasExpected) {
      addResult(`Bot: ${feature.name}`, true, 'Funcionou corretamente');
    } else {
      // Se está esperando confirmação, pode ser que a resposta seja a confirmação
      if (feature.needsConfirmation && (responseLower.includes('confirmar') || responseLower.includes('sim') || responseLower.includes('não'))) {
        addResult(`Bot: ${feature.name}`, true, 'Aguardando confirmação (esperado)');
      } else {
        addResult(`Bot: ${feature.name}`, false, `Resposta não contém: ${feature.expected.join(', ')}. Resposta: ${response.substring(0, 100)}`);
        allPassed = false;
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  return allPassed;
}

// Testa processamento de imagem
async function testImageProcessing() {
  logSection('🖼️  Teste de Processamento de Imagem');
  
  // URL de imagem de teste (comprovante PIX exemplo)
  const testImageUrl = 'https://via.placeholder.com/800x600.png?text=Comprovante+PIX+Teste';
  
  logInfo('Nota: Este teste requer imagem real. Usando placeholder para estrutura.');
  
  try {
    // Verifica se serviços de imagem estão configurados
    const hasGoogleVision = !!process.env.GOOGLE_VISION_API_KEY || !!process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const hasGemini = !!process.env.GEMINI_API_KEY;
    
    if (!hasGoogleVision && !hasGemini) {
      addResult('Imagem: Configuração', false, 'Google Vision ou Gemini não configurado');
      return false;
    }
    
    addResult('Imagem: Configuração', true, hasGoogleVision ? 'Google Vision configurado' : 'Gemini configurado');
    
    // Tenta processar imagem (pode falhar com placeholder, mas testa estrutura)
    const response = await sendMessage('Analise esta imagem', true, testImageUrl);
    
    if (response) {
      // Verifica se resposta indica processamento
      const responseLower = response.toLowerCase();
      if (responseLower.includes('erro') || responseLower.includes('não foi possível')) {
        addResult('Imagem: Processamento', false, 'Erro ao processar imagem');
        logWarning('Isso é esperado com imagem placeholder. Teste com imagem real.');
      } else {
        addResult('Imagem: Processamento', true, 'Estrutura de resposta OK');
      }
    } else {
      addResult('Imagem: Processamento', false, 'Sem resposta');
    }
    
    return true;
  } catch (error) {
    addResult('Imagem: Processamento', false, error.message);
    return false;
  }
}

// Verifica dados no banco
async function verifyDatabaseData() {
  logSection('💾 Verificação de Dados no Banco');
  
  try {
    const user = await userController.findUserByPhone(testPhone);
    
    if (!user) {
      addResult('Banco: Usuário', false, 'Usuário não encontrado');
      return false;
    }
  
    addResult('Banco: Usuário', true, `Encontrado: ${user.nome_completo || user.nome_clinica}`);
    
    // Verifica atendimentos
    const { data: atendimentos, error: errAtend } = await supabase
      .from('atendimentos')
      .select('*')
      .eq('user_id', user.id);
    
    if (errAtend) {
      addResult('Banco: Atendimentos', false, errAtend.message);
    } else {
      addResult('Banco: Atendimentos', true, `${atendimentos?.length || 0} registros encontrados`);
    }
    
    // Verifica contas a pagar
    const { data: contas, error: errContas } = await supabase
      .from('contas_pagar')
      .select('*')
      .eq('user_id', user.id);
    
    if (errContas) {
      addResult('Banco: Contas a Pagar', false, errContas.message);
    } else {
      addResult('Banco: Contas a Pagar', true, `${contas?.length || 0} registros encontrados`);
    }
    
    return true;
  } catch (error) {
    addResult('Banco: Verificação', false, error.message);
    return false;
  }
}

// Função principal
async function runTests() {
  console.log('\n');
  log('╔════════════════════════════════════════════════════════════════╗', 'cyan');
  log('║     TESTE COMPLETO DO ONBOARDING E BOT LUMIZ                  ║', 'cyan');
  log('╚════════════════════════════════════════════════════════════════╝', 'cyan');
  log(`\n📱 Telefone de teste: ${testPhone}\n`, 'yellow');
  
  // 1. Verifica ambiente
  const envOk = testEnvironment();
  if (!envOk) {
    logError('Variáveis de ambiente faltando. Teste pode falhar.');
  }
  
  // 2. Testa conexão
  const dbOk = await testSupabaseConnection();
  if (!dbOk) {
    logError('Não foi possível conectar ao banco. Abortando testes.');
    return;
  }
  
  // 3. Limpa dados anteriores
  await cleanupTestData();
  
  // 4. Testa onboarding
  const onboardingOk = await testOnboardingFlow();
  
  // Continua com testes mesmo se houver erro no primeiro passo (erro de envio é esperado em testes)
  const hasCriticalError = results.tests.some(t => 
    !t.passed && 
    !t.isWarning && 
    t.testName.includes('Onboarding:') && 
    !t.testName.includes('Início do Onboarding')
  );
  
  if (hasCriticalError) {
    logError('Onboarding falhou em etapas críticas. Pulando testes de funcionalidades.');
  } else {
    // 5. Testa funcionalidades do bot
    await testBotFeatures();
    
    // 6. Testa processamento de imagem
    await testImageProcessing();
    
    // 7. Verifica dados no banco
    await verifyDatabaseData();
  }
  
  // Resumo final
  logSection('📊 Resumo dos Testes');
  
  logInfo(`Total de testes: ${results.tests.length}`);
  logSuccess(`Passou: ${results.passed}`);
  logError(`Falhou: ${results.failed}`);
  logWarning(`Avisos: ${results.warnings}`);
  
  console.log('\n');
  log('═'.repeat(70), 'cyan');
  log('Detalhes dos Testes:', 'cyan');
  log('═'.repeat(70), 'cyan');
  
  results.tests.forEach(test => {
    const icon = test.passed ? '✅' : (test.isWarning ? '⚠️' : '❌');
    const color = test.passed ? 'green' : (test.isWarning ? 'yellow' : 'red');
    log(`${icon} ${test.testName}: ${test.message || (test.passed ? 'OK' : 'FALHOU')}`, color);
  });
  
  console.log('\n');
  
  if (results.failed === 0) {
    log('🎉 TODOS OS TESTES PASSARAM!', 'green');
  } else {
    log(`⚠️  ${results.failed} teste(s) falharam. Verifique os erros acima.`, 'yellow');
  }
  
  console.log('\n');
}

// Executa testes
runTests().catch(error => {
  logError(`Erro fatal: ${error.message}`);
  console.error(error);
  process.exit(1);
});
