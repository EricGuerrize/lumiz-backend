/**
 * Script de Demonstração E2E do Onboarding (sem dependência de banco)
 * - Simula conversa completa do passo 0 até finalização
 * - Gera transcript em docs/onboarding-transcript-latest.txt
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');

const originalRequire = Module.prototype.require;
const inMemoryWhatsappState = new Map();

const mockAnalytics = {
  track: async () => true
};

const mockOnboardingService = {
  getWhatsappState: async (phone) => inMemoryWhatsappState.get(phone) || null,
  upsertWhatsappState: async (phone, state) => {
    inMemoryWhatsappState.set(phone, {
      ...state,
      startTime: Date.now()
    });
    return true;
  },
  clearWhatsappState: async (phone) => {
    inMemoryWhatsappState.delete(phone);
    return true;
  }
};

const mockUserController = {
  createUserFromOnboarding: async () => ({ user: { id: 'demo-user-123' } }),
  findUserByPhone: async () => ({ id: 'demo-user-123' })
};

const mockTransactionController = {
  createAtendimento: async () => ({ id: 'demo-atendimento-123', valor_total: 2800 }),
  createContaPagar: async () => ({ id: 'demo-conta-123', valor: 500 })
};

const mockRegistrationTokenService = {
  generateSetupToken: async () => ({
    registrationLink: 'https://app.lumiz.com/setup/demo-link-24h'
  })
};

const mockKnowledgeService = {
  saveInteraction: async () => true
};

const mockClinicMemberService = {
  addMember: async () => ({ success: true })
};

const mockCacheService = {
  delete: async () => true,
  get: async () => null,
  set: async () => true
};

const mockIntentHeuristicService = {
  detectIntent: async () => null
};

const mockDocumentService = {
  processImage: async () => ({ transacoes: [] }),
  processDocumentFromBuffer: async () => ({ transacoes: [] })
};

Module.prototype.require = function (...args) {
  const moduleName = args[0];

  if (moduleName.includes('analyticsService')) return mockAnalytics;
  if (moduleName.includes('onboardingService') && !moduleName.includes('onboardingFlowService')) return mockOnboardingService;
  if (moduleName.includes('userController')) return mockUserController;
  if (moduleName.includes('transactionController')) return mockTransactionController;
  if (moduleName.includes('registrationTokenService')) return mockRegistrationTokenService;
  if (moduleName.includes('knowledgeService')) return mockKnowledgeService;
  if (moduleName.includes('clinicMemberService')) return mockClinicMemberService;
  if (moduleName.includes('cacheService')) return mockCacheService;
  if (moduleName.includes('intentHeuristicService')) return mockIntentHeuristicService;
  if (moduleName.includes('documentService')) return mockDocumentService;

  return originalRequire.apply(this, args);
};

const onboardingFlowService = require('../src/services/onboardingFlowService');

function cleanupPhoneState(phone) {
  const timer = onboardingFlowService.persistTimers?.get(phone);
  if (timer) {
    clearTimeout(timer);
    onboardingFlowService.persistTimers.delete(phone);
  }

  onboardingFlowService.onboardingStates?.delete(phone);
  inMemoryWhatsappState.delete(phone);
}

async function runHappyPathScenario() {
  const phone = `5511${Date.now().toString().slice(-8)}`;
  cleanupPhoneState(phone);

  const transcript = [];

  const push = (actor, text) => {
    transcript.push(`${actor}: ${text}`);
  };

  push('USUARIO', '(inicia conversa)');
  let response = await onboardingFlowService.startIntroFlow(phone);
  push('LUMIZ', response);

  const steps = [
    '1',
    '1',
    'Maria Silva',
    'Clinica Estetica Beleza',
    '1',
    '1',
    '1',
    'Botox 2800 pix hoje',
    '1',
    'Insumos 500',
    '1',
    'Aluguel 1200',
    '1',
    '2'
  ];

  for (const message of steps) {
    push('USUARIO', message);
    response = await onboardingFlowService.processOnboarding(phone, message);
    push('LUMIZ', response);
  }

  return { phone, transcript };
}

async function runValidationBranchScenario() {
  const phone = `5511${(Date.now() + 1).toString().slice(-8)}`;
  cleanupPhoneState(phone);

  const transcript = [];
  const push = (actor, text) => transcript.push(`${actor}: ${text}`);

  push('USUARIO', '(inicia conversa)');
  let response = await onboardingFlowService.startIntroFlow(phone);
  push('LUMIZ', response);

  const steps = [
    '2',
    '1',
    '2',
    '1',
    '123',
    'Maria',
    'Clinica X',
    '9',
    '1'
  ];

  for (const message of steps) {
    push('USUARIO', message);
    response = await onboardingFlowService.processOnboarding(phone, message);
    push('LUMIZ', response);
  }

  return { phone, transcript };
}

function saveTranscript(allScenarios) {
  const outputDir = path.join(__dirname, '..', 'docs');
  const outputFile = path.join(outputDir, 'onboarding-transcript-latest.txt');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const lines = [];
  lines.push('TRANSCRIPT ONBOARDING E2E (SEM BANCO)');
  lines.push(`Gerado em: ${new Date().toISOString()}`);
  lines.push('');

  for (const scenario of allScenarios) {
    lines.push('='.repeat(100));
    lines.push(`CENARIO: ${scenario.title}`);
    lines.push(`PHONE DE TESTE: ${scenario.phone}`);
    lines.push('='.repeat(100));
    lines.push('');
    lines.push(...scenario.transcript);
    lines.push('');
  }

  fs.writeFileSync(outputFile, lines.join('\n'), 'utf8');
  return outputFile;
}

async function demonstrarOnboarding() {
  console.log('='.repeat(100));
  console.log('ONBOARDING E2E - DEMONSTRACAO COMPLETA (SEM BANCO)');
  console.log('='.repeat(100));

  const happyPath = await runHappyPathScenario();
  const validationPath = await runValidationBranchScenario();

  const scenarios = [
    { title: 'Happy Path Completo (passo 0 ate final)', ...happyPath },
    { title: 'Branches de validacao (como funciona, negacao consent, nome invalido, opcao invalida)', ...validationPath }
  ];

  for (const scenario of scenarios) {
    console.log('\n' + '='.repeat(100));
    console.log(`CENARIO: ${scenario.title}`);
    console.log('='.repeat(100) + '\n');

    for (const line of scenario.transcript) {
      console.log(line);
      console.log('');
    }
  }

  const transcriptPath = saveTranscript(scenarios);

  console.log('='.repeat(100));
  console.log('VALIDACAO FINAL');
  console.log('='.repeat(100));
  console.log(`Transcript salvo em: ${transcriptPath}`);
  console.log('Sem necessidade de apagar dados no banco para repetir teste.');
}

if (require.main === module) {
  demonstrarOnboarding()
    .then(() => {
      console.log('\nOK: teste E2E concluido com sucesso.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\nERRO no teste E2E:', error);
      process.exit(1);
    });
}

module.exports = { demonstrarOnboarding };
