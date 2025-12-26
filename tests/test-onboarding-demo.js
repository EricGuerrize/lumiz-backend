/**
 * Script de Demonstração do Onboarding
 * Simula uma conversa completa e mostra as respostas
 */

// Mock dos serviços antes de importar
const mockAnalytics = {
  track: async () => true
};

const mockOnboardingService = {
  getWhatsappState: async () => null,
  upsertWhatsappState: async () => true,
  clearWhatsappState: async () => true
};

const mockUserController = {
  createUserFromOnboarding: async () => ({ 
    user: { id: 'demo-user-123' } 
  }),
  findUserByPhone: async () => null
};

const mockTransactionController = {
  createAtendimento: async () => ({ 
    id: 'demo-atendimento-123',
    valor_total: 2800
  }),
  createContaPagar: async () => ({ 
    id: 'demo-conta-123',
    valor: 500
  })
};

// Mock dos módulos
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function(...args) {
  const moduleName = args[0];
  
  if (moduleName.includes('analyticsService')) {
    return mockAnalytics;
  }
  if (moduleName.includes('onboardingService') && !moduleName.includes('onboardingFlowService')) {
    return mockOnboardingService;
  }
  if (moduleName.includes('userController')) {
    return mockUserController;
  }
  if (moduleName.includes('transactionController')) {
    return mockTransactionController;
  }
  
  return originalRequire.apply(this, args);
};

const onboardingFlowService = require('../src/services/onboardingFlowService');

async function demonstrarOnboarding() {
  console.log('='.repeat(80));
  console.log('DEMONSTRAÇÃO DO ONBOARDING - CONVERSA COMPLETA');
  console.log('='.repeat(80));
  console.log('');

  const phone = '5511999999999';

  try {
    // 1. Início
    console.log('📱 USUÁRIO: (inicia conversa)');
    let response = await onboardingFlowService.startIntroFlow(phone);
    console.log('🤖 LUMIZ:', response);
    console.log('');

    // 2. Consentimento
    console.log('📱 USUÁRIO: "1" (Sim, pode começar)');
    response = await onboardingFlowService.processOnboarding(phone, '1');
    console.log('🤖 LUMIZ:', response);
    console.log('');

    // 3. Autoriza consentimento
    console.log('📱 USUÁRIO: "sim" (Autorizo)');
    response = await onboardingFlowService.processOnboarding(phone, 'sim');
    console.log('🤖 LUMIZ:', response);
    console.log('');

    // 4. Nome
    console.log('📱 USUÁRIO: "Maria Silva"');
    response = await onboardingFlowService.processOnboarding(phone, 'Maria Silva');
    console.log('🤖 LUMIZ:', response);
    console.log('');

    // 5. Clínica
    console.log('📱 USUÁRIO: "Clínica Estética Beleza"');
    response = await onboardingFlowService.processOnboarding(phone, 'Clínica Estética Beleza');
    console.log('🤖 LUMIZ:', response);
    console.log('');

    // 6. Role
    console.log('📱 USUÁRIO: "1" (Dona/gestora)');
    response = await onboardingFlowService.processOnboarding(phone, '1');
    console.log('🤖 LUMIZ:', response);
    console.log('');

    // 7. Context Why
    console.log('📱 USUÁRIO: "1" (Organizar o dia a dia)');
    response = await onboardingFlowService.processOnboarding(phone, '1');
    console.log('🤖 LUMIZ:', response);
    console.log('');

    // 8. Context How
    console.log('📱 USUÁRIO: "1" (Mais PIX)');
    response = await onboardingFlowService.processOnboarding(phone, '1');
    console.log('🤖 LUMIZ:', response);
    console.log('');

    // 9. Primeira Venda
    console.log('📱 USUÁRIO: "Botox 2800 pix hoje"');
    response = await onboardingFlowService.processOnboarding(phone, 'Botox 2800 pix hoje');
    console.log('🤖 LUMIZ:', response);
    console.log('');

    // 10. Confirma Venda
    console.log('📱 USUÁRIO: "1" (Tá ok)');
    response = await onboardingFlowService.processOnboarding(phone, '1');
    console.log('🤖 LUMIZ:', response);
    console.log('');

    // 11. Tipo de Custo
    console.log('📱 USUÁRIO: "2" (Variável)');
    response = await onboardingFlowService.processOnboarding(phone, '2');
    console.log('🤖 LUMIZ:', response);
    console.log('');

    // 12. Registra Custo
    console.log('📱 USUÁRIO: "Insumos R$ 500,00"');
    response = await onboardingFlowService.processOnboarding(phone, 'Insumos R$ 500,00');
    console.log('🤖 LUMIZ:', response);
    console.log('');

    // 13. Categoria do Custo
    console.log('📱 USUÁRIO: "1" (Insumos / materiais)');
    response = await onboardingFlowService.processOnboarding(phone, '1');
    console.log('🤖 LUMIZ:', response);
    console.log('');

    // 14. Confirma Custo
    console.log('📱 USUÁRIO: "1" (Confere)');
    response = await onboardingFlowService.processOnboarding(phone, '1');
    console.log('🤖 LUMIZ:', response);
    console.log('');

    // 15. Resumo
    console.log('📱 USUÁRIO: (vê resumo)');
    response = await onboardingFlowService.processOnboarding(phone, '');
    console.log('🤖 LUMIZ:', response);
    console.log('');

    console.log('='.repeat(80));
    console.log('✅ ONBOARDING COMPLETO COM SUCESSO!');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('❌ Erro durante demonstração:', error);
    console.error(error.stack);
  }
}

// Executa se chamado diretamente
if (require.main === module) {
  demonstrarOnboarding()
    .then(() => {
      console.log('\n✅ Teste concluído!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Erro no teste:', error);
      process.exit(1);
    });
}

module.exports = { demonstrarOnboarding };

