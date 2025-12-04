const onboardingFlowService = require('../src/services/onboardingFlowService');
const userController = require('../src/controllers/userController');
const supabase = require('../src/db/supabase');

// Mock userController to avoid real DB writes during simple flow test, 
// OR use a test phone number and let it write to DB (better for full integration test).
// Let's use a random test phone.
const testPhone = '551198888' + Math.floor(Math.random() * 10000);

async function simulateFlow() {
    console.log(`🤖 Iniciando simulação de onboarding para ${testPhone}...\n`);

    // Helper to send message and print response
    async function send(msg) {
        console.log(`👤 Usuário: "${msg}"`);
        let response;

        // Se não tem sessão, inicia
        if (!onboardingFlowService.isOnboarding(testPhone)) {
            await onboardingFlowService.startNewOnboarding(testPhone);
            // O controller normalmente mandaria a msg inicial, mas aqui chamamos o process direto
            // Na verdade, o startNewOnboarding só seta o estado.
            // O messageController é quem retorna a primeira mensagem.
            // Vamos simular o comportamento do messageController chamando processOnboarding
            // Mas o processOnboarding só responde SE já estiver no mapa.
            // O startNewOnboarding já coloca no mapa com step 'intro_menu'.
            // Então se mandarmos qualquer coisa agora, ele deve responder o menu?
            // Não, o menu é a resposta do start.
            // Vamos assumir que o usuário já recebeu o menu e agora responde.
        }

        response = await onboardingFlowService.processOnboarding(testPhone, msg);
        console.log(`🤖 Bot: "${response?.replace(/\n/g, ' ')}"`);
        console.log(`   [Step atual: ${onboardingFlowService.getOnboardingStep(testPhone)}]\n`);
        return response;
    }

    try {
        // 1. Start
        await onboardingFlowService.startNewOnboarding(testPhone);
        console.log('--- Bot enviou Menu Inicial ---\n');

        // 2. Fluxo "Conhecer"
        await send('1'); // Quero conhecer
        await send('próximo');
        await send('próximo');
        await send('próximo');
        await send('menu'); // Volta pro menu

        // 3. Fluxo "Cadastro"
        await send('2'); // Começar cadastro

        // Step 1: Tipo
        await send('1'); // Facial

        // Step 2: Nome
        await send('Clínica Teste Simulation');

        // Step 3: Cidade
        await send('São Paulo - SP');

        // Step 4: Responsável
        await send('Doutora Teste');

        // Step 5: Email
        await send('teste@simulation.com');

        // Step 5b: WhatsApp
        await send('este');

        // Step 6: Procedimentos
        await send('45');

        // Step 7: Ticket
        await send('850');

        // Step 8: Confirmar
        const confirmResponse = await send('sim');

        if (confirmResponse.includes('Erro')) {
            throw new Error('Falha ao criar usuário no banco de dados.');
        }

        // 4. Tutorial
        await send('sim'); // Vamos fazer o teste

        // Tutorial Venda
        await send('Venda teste de 500 reais');

        // Tutorial Confirma Venda
        await send('confirmar');

        // Tutorial Custo
        await send('Custo teste de 100 reais');

        // Tutorial Confirma Custo
        await send('confirmar');

        // Tutorial Fim
        await send('detalhes'); // Finaliza

        console.log('✅ Simulação concluída com sucesso!');

        // Cleanup
        console.log('🧹 Limpando usuário de teste...');
        // Need to find user ID to delete
        const { data: user } = await supabase.from('profiles').select('id').eq('telefone', testPhone).single();
        if (user) {
            await supabase.auth.admin.deleteUser(user.id);
            await supabase.from('profiles').delete().eq('id', user.id);
        }

    } catch (error) {
        console.error('❌ Erro na simulação:', error);
    }
}

simulateFlow();
