const onboardingFlowService = require('../src/services/onboardingFlowService');
const supabase = require('../src/db/supabase');

// Telefone aleatório para teste
const testPhone = '551199999' + Math.floor(Math.random() * 10000);

async function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function simulateFlow() {
    console.log(`\n🤖 --- INICIANDO SIMULAÇÃO DE ONBOARDING ---`);
    console.log(`📱 Telefone de teste: ${testPhone}\n`);

    // Helper para enviar mensagem e imprimir resposta
    async function send(msg, label = 'Usuário') {
        const displayMsg = msg.length > 50 ? msg.substring(0, 50) + '...' : msg;
        console.log(`👤 ${label}: "${msg}"`);

        // Simula delay de rede/digitação
        await wait(500);

        let response;
        try {
            // Se estado não iniciado, inicia
            if (!onboardingFlowService.isOnboarding(testPhone) && msg === '/start') {
                response = await onboardingFlowService.startNewOnboarding(testPhone);
            } else {
                // Processa mensagem
                response = await onboardingFlowService.processOnboarding(testPhone, msg);
            }

            const step = onboardingFlowService.getOnboardingStep(testPhone);

            console.log(`🤖 Bot (${step || 'FIM'}):`);
            console.log(`   "${response?.replace(/\n/g, '\n   ')}"\n`);

            return response;
        } catch (e) {
            console.error('❌ ERRO:', e);
            throw e;
        }
    }

    try {
        // 1. Início
        await send('/start', 'System Trigger'); // Simula gatilho inicial

        // 2. Start Menu -> Sim
        await send('1');

        // 3. Consentimento -> Sim
        await send('1');

        // 4. Nome
        await send('Maria Doutora');

        // 5. Clínica
        await send('Clínica Estética Avançada');

        // 6. Cargo (Dona)
        await send('1');

        // 7. Adicionar membro (Não)
        await send('2');

        // 8. Contexto Objetivo (Organizar)
        await send('1');

        // 9. Contexto Recebimento (Cartão)
        await send('2');

        // 10. Primeira Venda (Sem valor explícito para testar extração)
        await send('Botox da Carla');

        // Bot deve perguntar o valor
        await send('1200');

        // Bot deve perguntar pagamento se não detectou
        if (onboardingFlowService.getOnboardingStep(testPhone) === 'AHA_REVENUE' ||
            onboardingFlowService.getOnboardingStep(testPhone) === 'AHA_REVENUE_CONFIRM') {
            // Se cair aqui, talvez ele tenha pedido valor de novo ou confirmado
        }

        // Se pediu confirmação:
        await send('1'); // Confirma venda

        // 11. Introdução Custo -> Fixo
        await send('1');

        // 12. Upload Custo Fixo (Texto)
        await send('Aluguel 2500');

        // 13. Categoria (Aluguel)
        await send('2');

        // 14. Confirma Custo Fixo
        await send('1');

        // 15. Segundo Custo (Variável) -> Bot pede automaticamente
        // Envia texto de custo variável
        await send('Insumos de botox 800');

        // 16. Categoria (Insumos)
        await send('1');

        // 17. Confirma Custo Variável
        await send('1');

        // 18. Resumo Final
        // O bot deve mostrar o resumo e ir para HANDOFF

        console.log('✅ Simulação finalizada com sucesso!');
        console.log('--- Resumo do Estado Final ---');
        const state = await onboardingFlowService.onboardingStates.get(testPhone);
        console.log(JSON.stringify(state.data, null, 2));

    } catch (error) {
        console.error('❌ Simulador parou com erro:', error);
    }
}

simulateFlow();
