const onboardingFlowService = require('../src/services/onboardingFlowService');
const { normalizePhone } = require('../src/utils/phone');

async function simulateOnboarding() {
    const phone = '5511777776666';
    const normalizedPhone = normalizePhone(phone);

    console.log(`\n🚀 INICIANDO SIMULAÇÃO DE ONBOARDING PARA: ${phone}\n`);

    const runStep = async (message) => {
        console.log(`👤 USUÁRIO: "${message}"`);
        const response = await onboardingFlowService.processOnboarding(normalizedPhone, message);
        console.log(`🤖 LUMIZ:\n${response}\n---\n`);
        return response;
    };

    // 1. Início
    await onboardingFlowService.startIntroFlow(normalizedPhone);

    // 2. Consentimento
    await runStep('1'); // Inicia -> Consent

    // 3. Autorizar
    await runStep('1'); // Sim -> Nome

    // 4. Nome
    await runStep('Eric Teste'); // -> Clínica

    // 5. Clínica
    await runStep('Minha Clínica'); // -> Role

    // 6. Função (Dona)
    await runStep('1'); // -> Add member

    // 7. Add member (Pular)
    await runStep('2'); // -> Context Why

    // 8. Por que usar (Clareza)
    await runStep('2'); // -> Context How

    // 9. Como recebe (Pix)
    await runStep('1'); // -> Aha Revenue

    // 10. Registrar Receita
    await runStep('Venda 5000 no pix'); // -> Confirm Revenue

    // 11. Confirmar Receita
    await runStep('1'); // -> Aha Costs Intro

    // 12. Registrar CUSTO (O desafio do 2000)
    console.log('🧪 TESTANDO RECONHECIMENTO DE "2000"...');
    await runStep('Luz 2000'); // -> Classify Question

    // 13. Classificar Custo (Fixo)
    console.log('🧪 TESTANDO CLASSIFICAÇÃO "1"...');
    await runStep('1'); // -> Category Question

    // 14. Categoria (Luz)
    await runStep('1'); // -> Confirm Cost

    // 15. Confirmar Custo
    await runStep('1'); // -> Summary or next cost

    console.log('\n✅ SIMULAÇÃO CONCLUÍDA COM SUCESSO!');
}

simulateOnboarding().catch(err => {
    console.error('\n❌ ERRO NA SIMULAÇÃO:', err);
    process.exit(1);
});
