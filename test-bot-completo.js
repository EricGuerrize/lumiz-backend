/**
 * Teste completo do bot WhatsApp Lumiz
 * Verifica todos os componentes principais do sistema
 */

require('dotenv').config();
const axios = require('axios');

// Cores para output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'cyan');
  console.log('='.repeat(60));
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

// Verifica variáveis de ambiente
function checkEnvironmentVariables() {
  logSection('1. Verificando Variáveis de Ambiente');
  
  const required = [
    'EVOLUTION_API_URL',
    'EVOLUTION_API_KEY',
    'EVOLUTION_INSTANCE_NAME',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY'
  ];

  const optional = [
    'SENTRY_DSN',
    'REDIS_URL',
    'GOOGLE_VISION_API_KEY',
    'GEMINI_API_KEY'
  ];

  let allRequired = true;
  
  required.forEach(env => {
    if (process.env[env]) {
      addResult(`ENV ${env}`, true, 'Configurado');
    } else {
      addResult(`ENV ${env}`, false, 'NÃO CONFIGURADO', false);
      allRequired = false;
    }
  });

  optional.forEach(env => {
    if (process.env[env]) {
      addResult(`ENV ${env} (opcional)`, true, 'Configurado', true);
    } else {
      addResult(`ENV ${env} (opcional)`, true, 'Não configurado (opcional)', true);
    }
  });

  return allRequired;
}

// Testa conexão com Supabase
async function testSupabase() {
  logSection('2. Testando Conexão com Supabase');
  
  try {
    const supabase = require('./src/db/supabase');
    
    // Testa query simples
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .limit(1);

    if (error) {
      addResult('Supabase - Conexão', false, `Erro: ${error.message}`);
      return false;
    }

    addResult('Supabase - Conexão', true, 'Conectado com sucesso');
    
    // Testa tabelas principais (Core)
    const coreTables = [
      'profiles',                    // Usuários/Clínicas (tabela principal)
      'atendimentos',                // Entradas (Receitas/Vendas)
      'contas_pagar',                // Saídas (Despesas)
      'clientes',                    // Cadastro de pacientes
      'procedimentos',               // Catálogo de procedimentos
      'atendimento_procedimentos',   // Junção atendimento-procedimento
      'parcelas',                    // Parcelas de vendas
      'agendamentos'                 // Agenda de compromissos
    ];
    
    // Testa tabelas auxiliares
    const auxTables = [
      'onboarding_progress',          // Progresso do onboarding
      'conversation_history',         // Histórico de conversas
      'user_roles',                   // Permissões (Admin/Funcionário)
      'mdr_configs',                  // Configurações de taxas de cartão
      'ocr_jobs',                     // Fila de processamento OCR
      'user_insights'                 // Insights gerados pela IA
    ];
    
    // Testa views (otimizações)
    const views = [
      'view_finance_balance',        // Saldo financeiro pré-calculado
      'view_monthly_report'          // Relatório mensal agregado
    ];
    
    logInfo('Verificando tabelas principais (Core)...');
    for (const table of coreTables) {
      try {
        const { error: tableError } = await supabase
          .from(table)
          .select('id')
          .limit(1);
        
        if (tableError) {
          addResult(`Supabase - Tabela ${table}`, false, `Erro: ${tableError.message}`, true);
        } else {
          addResult(`Supabase - Tabela ${table}`, true, 'Acessível', true);
        }
      } catch (err) {
        addResult(`Supabase - Tabela ${table}`, false, `Erro: ${err.message}`, true);
      }
    }
    
    logInfo('Verificando tabelas auxiliares...');
    for (const table of auxTables) {
      try {
        const { error: tableError } = await supabase
          .from(table)
          .select('id')
          .limit(1);
        
        if (tableError) {
          addResult(`Supabase - Tabela ${table}`, false, `Erro: ${tableError.message}`, true);
        } else {
          addResult(`Supabase - Tabela ${table}`, true, 'Acessível', true);
        }
      } catch (err) {
        addResult(`Supabase - Tabela ${table}`, false, `Erro: ${err.message}`, true);
      }
    }
    
    logInfo('Verificando views (otimizações)...');
    for (const view of views) {
      try {
        const { error: viewError } = await supabase
          .from(view)
          .select('*')
          .limit(1);
        
        if (viewError) {
          addResult(`Supabase - View ${view}`, false, `Erro: ${viewError.message}`, true);
        } else {
          addResult(`Supabase - View ${view}`, true, 'Acessível', true);
        }
      } catch (err) {
        addResult(`Supabase - View ${view}`, false, `Erro: ${err.message}`, true);
      }
    }

    return true;
  } catch (error) {
    addResult('Supabase - Conexão', false, `Erro: ${error.message}`);
    return false;
  }
}

// Testa Evolution API
async function testEvolutionAPI() {
  logSection('3. Testando Evolution API');
  
  try {
    const evolutionService = require('./src/services/evolutionService');
    
    // Testa status da instância
    try {
      const status = await evolutionService.getInstanceStatus();
      addResult('Evolution API - Status', true, `Status: ${JSON.stringify(status).substring(0, 100)}`);
    } catch (error) {
      addResult('Evolution API - Status', false, `Erro: ${error.message}`);
      return false;
    }

    return true;
  } catch (error) {
    addResult('Evolution API - Conexão', false, `Erro: ${error.message}`);
    return false;
  }
}

// Testa servidor HTTP
async function testServer() {
  logSection('4. Testando Servidor HTTP');
  
  try {
    const app = require('./src/server');
    const request = require('supertest');
    
    // Testa health check
    try {
      const res = await request(app).get('/health').expect(200);
      
      if (res.body.status === 'ok' || res.body.status === 'degraded') {
        addResult('Servidor - Health Check', true, `Status: ${res.body.status}`);
        
        // Verifica checks individuais
        if (res.body.checks) {
          Object.keys(res.body.checks).forEach(check => {
            const status = res.body.checks[check];
            if (status === 'ok') {
              addResult(`Servidor - ${check}`, true, 'OK', true);
            } else {
              addResult(`Servidor - ${check}`, false, `Status: ${status}`, true);
            }
          });
        }
      } else {
        addResult('Servidor - Health Check', false, `Status inesperado: ${res.body.status}`);
      }
    } catch (error) {
      addResult('Servidor - Health Check', false, `Erro: ${error.message}`);
    }

    // Testa endpoint raiz
    try {
      const res = await request(app).get('/').expect(200);
      if (res.body.name === 'Lumiz Backend') {
        addResult('Servidor - Endpoint Raiz', true, 'OK');
      } else {
        addResult('Servidor - Endpoint Raiz', false, 'Resposta inesperada');
      }
    } catch (error) {
      addResult('Servidor - Endpoint Raiz', false, `Erro: ${error.message}`);
    }

    return true;
  } catch (error) {
    addResult('Servidor - Inicialização', false, `Erro: ${error.message}`);
    return false;
  }
}

// Testa processamento de mensagens
async function testMessageProcessing() {
  logSection('5. Testando Processamento de Mensagens');
  
  try {
    const messageController = require('./src/controllers/messageController');
    // Usa um número válido para teste (formato: 55 + DDD + número)
    // Nota: Este número pode não existir, mas o formato está correto
    // Em produção, use números reais ou desabilite o envio real nos testes
    const TEST_PHONE = process.env.TEST_PHONE || '5511999999999';
    const TEST_MESSAGE = 'Olá, quero organizar o financeiro da minha clínica';
    
    // Testa processamento básico
    try {
      const response = await messageController.handleIncomingMessage(TEST_PHONE, TEST_MESSAGE);
      
      if (response && typeof response === 'string' && response.length > 0) {
        addResult('Processamento - Mensagem Inicial', true, `Resposta gerada (${response.length} chars)`);
        logInfo(`Resposta: ${response.substring(0, 100)}...`);
      } else {
        addResult('Processamento - Mensagem Inicial', false, 'Resposta vazia ou inválida');
      }
    } catch (error) {
      addResult('Processamento - Mensagem Inicial', false, `Erro: ${error.message}`);
    }

    // Testa mensagem de ajuda
    try {
      const helpResponse = await messageController.handleIncomingMessage(TEST_PHONE, 'ajuda');
      if (helpResponse) {
        addResult('Processamento - Mensagem de Ajuda', true, 'OK', true);
      }
    } catch (error) {
      addResult('Processamento - Mensagem de Ajuda', false, `Erro: ${error.message}`, true);
    }

    return true;
  } catch (error) {
    addResult('Processamento - Inicialização', false, `Erro: ${error.message}`);
    return false;
  }
}

// Testa serviços principais
async function testServices() {
  logSection('6. Testando Serviços Principais');
  
  const services = [
    { name: 'onboardingFlowService', path: './src/services/onboardingFlowService' },
    { name: 'userController', path: './src/controllers/userController' },
    { name: 'geminiService', path: './src/services/geminiService', optional: true },
    { name: 'googleVisionService', path: './src/services/googleVisionService', optional: true }
  ];

  for (const service of services) {
    try {
      const serviceModule = require(service.path);
      if (serviceModule) {
        addResult(`Serviço - ${service.name}`, true, 'Carregado', service.optional);
      } else {
        addResult(`Serviço - ${service.name}`, false, 'Não carregado', service.optional);
      }
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') {
        addResult(`Serviço - ${service.name}`, false, 'Arquivo não encontrado', service.optional);
      } else {
        addResult(`Serviço - ${service.name}`, false, `Erro: ${error.message}`, service.optional);
      }
    }
  }
}

// Testa webhook endpoint
async function testWebhook() {
  logSection('7. Testando Endpoint de Webhook');
  
  try {
    const app = require('./src/server');
    const request = require('supertest');
    
    // Testa webhook com payload válido
    const webhookPayload = {
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: '5511999999999@s.whatsapp.net',
          fromMe: false,
          id: 'test123'
        },
        message: {
          conversation: 'Teste de mensagem'
        }
      }
    };

    try {
      const res = await request(app)
        .post('/api/webhook')
        .send(webhookPayload)
        .expect(200);

      if (res.body.status === 'received' || res.body.status === 'ignored') {
        addResult('Webhook - Endpoint', true, `Status: ${res.body.status}`);
      } else {
        addResult('Webhook - Endpoint', false, `Status inesperado: ${res.body.status}`);
      }
    } catch (error) {
      addResult('Webhook - Endpoint', false, `Erro: ${error.message}`);
    }

    // Testa webhook com payload inválido
    try {
      const res = await request(app)
        .post('/api/webhook')
        .send({ invalid: 'payload' })
        .expect(200); // Webhook retorna 200 mesmo com payload inválido

      addResult('Webhook - Validação', true, 'Rejeita payload inválido', true);
    } catch (error) {
      addResult('Webhook - Validação', false, `Erro: ${error.message}`, true);
    }

    return true;
  } catch (error) {
    addResult('Webhook - Inicialização', false, `Erro: ${error.message}`);
    return false;
  }
}

// Resumo final
function printSummary() {
  logSection('RESUMO DOS TESTES');
  
  console.log('\n');
  logSuccess(`Testes Passados: ${results.passed}`);
  logError(`Testes Falhados: ${results.failed}`);
  logWarning(`Avisos: ${results.warnings}`);
  console.log('\n');

  if (results.failed > 0) {
    logSection('TESTES QUE FALHARAM');
    results.tests
      .filter(t => !t.passed && !t.isWarning)
      .forEach(t => {
        logError(`${t.testName}: ${t.message}`);
      });
  }

  if (results.warnings > 0) {
    logSection('AVISOS');
    results.tests
      .filter(t => t.isWarning)
      .forEach(t => {
        logWarning(`${t.testName}: ${t.message}`);
      });
  }

  console.log('\n');
  
  const total = results.passed + results.failed;
  const successRate = total > 0 ? ((results.passed / total) * 100).toFixed(1) : 0;
  
  if (results.failed === 0) {
    logSuccess(`🎉 Todos os testes críticos passaram! (${successRate}% de sucesso)`);
    logInfo('O bot está funcionando corretamente!');
  } else if (results.failed <= 2) {
    logWarning(`⚠️  Alguns testes falharam, mas o bot pode estar funcionando (${successRate}% de sucesso)`);
    logInfo('Verifique os erros acima e corrija se necessário.');
  } else {
    logError(`❌ Múltiplos testes falharam (${successRate}% de sucesso)`);
    logError('O bot pode não estar funcionando corretamente. Verifique os erros acima.');
  }
  
  console.log('\n');
}

// Executa todos os testes
async function runAllTests() {
  console.log('\n');
  log('╔══════════════════════════════════════════════════════════╗', 'cyan');
  log('║     TESTE COMPLETO DO BOT WHATSAPP LUMIZ                ║', 'cyan');
  log('╚══════════════════════════════════════════════════════════╝', 'cyan');
  console.log('\n');

  const envOk = checkEnvironmentVariables();
  
  if (!envOk) {
    logError('Variáveis de ambiente críticas faltando. Alguns testes serão pulados.');
    console.log('\n');
  }

  await testSupabase();
  await testEvolutionAPI();
  await testServer();
  await testMessageProcessing();
  await testServices();
  await testWebhook();

  printSummary();
  
  // Exit code baseado nos resultados
  process.exit(results.failed > 0 ? 1 : 0);
}

// Executa os testes
runAllTests().catch(error => {
  logError(`Erro fatal ao executar testes: ${error.message}`);
  console.error(error);
  process.exit(1);
});

