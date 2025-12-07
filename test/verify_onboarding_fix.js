
require('dotenv').config();
const messageController = require('../src/controllers/messageController');
const onboardingFlowService = require('../src/services/onboardingFlowService');
const userController = require('../src/controllers/userController');
const supabase = require('../src/db/supabase');

// Mock services to avoid real side effects
const mockEvolutionService = {
    sendMessage: async (phone, text) => {
        console.log(`[MOCK WHATSAPP] To ${phone}: ${text.substring(0, 50)}...`);
        return true;
    },
    sendDocument: async () => true,
    sendVideo: async (phone, url, caption) => {
        console.log(`[MOCK WHATSAPP] VIDEO To ${phone}: ${url} | ${caption}`);
        return true;
    }
};

// Monkey patch require if possible or just rely on env
// NOTE: Since services are singletons, we can't easily mock injected dependencies without a DI container.
// We assume local env has valid Supabase/Gemini keys or mocks them itself.

async function runTest() {
    console.log('=== INICIANDO TESTE DE FLUXO LINEAR ===');

    const TEST_PHONE = '5511999997777'; // Novo numero para evitar cache

    // 1. Limpeza
    console.log('1. Limpando usuário de teste...');
    const existingUser = await userController.findUserByPhone(TEST_PHONE);
    if (existingUser) {
        await supabase.from('profiles').delete().eq('id', existingUser.id);
        console.log('   Usuário deletado.');
    } else {
        await supabase.from('profiles').delete().eq('telefone', TEST_PHONE);
        console.log('   Limpeza preventiva ok.');
    }

    try {
        console.log('\n--- PASSO 1: Iniciar Onboarding ---');
        // O user inicia. 
        let response = await messageController.handleIncomingMessage(TEST_PHONE, 'começar meu cadastro');
        console.log('Bot Response:', response ? response.substring(0, 50) + '...' : 'VAZIO');

        // Verifica estado interno: deve ser Reg Step 1
        let state = onboardingFlowService.onboardingStates.get(TEST_PHONE);
        if (state && state.step === 'reg_step_1_type') {
            console.log('✅ ESTADO INICIAL OK: reg_step_1_type (Foi direto pro cadastro)');
        } else {
            console.error('❌ ERRO ESTADO: Esperado reg_step_1_type, obtido:', state?.step);
            process.exit(1);
        }

        console.log('\n--- PASSO 2: Tipo Clínica ---');
        response = await messageController.handleIncomingMessage(TEST_PHONE, '1'); // Estética

        console.log('\n--- PASSO 3: Nome Clínica ---');
        response = await messageController.handleIncomingMessage(TEST_PHONE, 'Clínica Teste Linear');

        console.log('\n--- PASSO 4: Cidade ---');
        response = await messageController.handleIncomingMessage(TEST_PHONE, 'Curitiba PR');

        console.log('\n--- PASSO 5: Responsável + CPF ---');
        response = await messageController.handleIncomingMessage(TEST_PHONE, 'Eric Teste 12345678900');

        // Verifica se pulou o menu de "Completar"
        if (response.includes('email')) {
            console.log('✅ FLUXO DIRETO OK: Foi para email.');
        } else {
            console.error('❌ ERRO FLUXO: Não pediu email.', response);
        }

        console.log('\n--- PASSO 6: Email ---');
        response = await messageController.handleIncomingMessage(TEST_PHONE, 'teste@linear.com');

        console.log('\n--- PASSO 7: WhatsApp ---');
        // Testar 'este' de novo, só pra garantir
        response = await messageController.handleIncomingMessage(TEST_PHONE, 'esse mesmo');

        // Agora deve vir o Teste Estático
        // "Venda Teste: ... Confirma?"
        if (response.includes('Venda Teste') && response.includes('Confirmar')) {
            console.log('✅ TESTE FINAL OFERECIDO OK');
        } else {
            console.error('❌ ERRO TESTE FINAL: Não ofereceu teste.', response);
            process.exit(1);
        }

        console.log('\n--- VERIFICAÇÃO BANCO ---');
        const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('telefone', TEST_PHONE)
            .single();

        if (profile) console.log('✅ PERFIL CRIADO:', profile.id);
        else console.error('❌ PERFIL NÃO CRIADO');

        console.log('\n--- PASSO 8: Confirmar Teste Estático ---');
        response = await messageController.handleIncomingMessage(TEST_PHONE, 'Confirmar');
        // Bot: "Pronto! ... Mini Dash ... Digite Próximo"
        if (response.includes('Resumo Financeiro')) {
            console.log('✅ MINI DASH OK');
        } else {
            console.error('❌ ERRO MINI DASH:', response);
        }

        console.log('\n--- PASSO 9: Finalizar ---');
        response = await messageController.handleIncomingMessage(TEST_PHONE, 'Proximo');

        // Verifica se limpou estado
        state = onboardingFlowService.onboardingStates.get(TEST_PHONE);
        if (!state) {
            console.log('✅ ESTADO LIMPO OK');
        } else {
            console.error('❌ ERRO: Estado ainda existe.', state);
        }

        console.log('\n--- PASSO 10: Teste Persistência ---');
        response = await messageController.handleIncomingMessage(TEST_PHONE, 'resumo');

        if (response && (response.includes('ainda não tem movimentações') || response.includes('Olha só como tá seu financeiro'))) {
            console.log('✅ PERSISTÊNCIA OK: Bot reconheceu usuário.');
        } else {
            console.error('❌ LOOP DETECTADO:', response.substring(0, 100));
        }

    } catch (err) {
        console.error('Crash durante teste:', err);
    }

    console.log('\n=== TESTE FINALIZADO ===');
    process.exit(0);
}

runTest();
