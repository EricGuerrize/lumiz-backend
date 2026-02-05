const onboardingFlowService = require('../src/services/onboardingFlowService');
const supabase = require('../src/db/supabase');

// Telefone aleatório para teste
const testPhone = '551199999' + Math.floor(Math.random() * 10000);

async function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function simulateFlow() {
    console.log(`\n🤖 --- INICIANDO SIMULAÇÃO DE VERIFICAÇÃO (FIX MENU vs VALUE) ---`);
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

            return { response, step };
        } catch (e) {
            console.error('❌ ERRO:', e);
            throw e;
        }
    }

    try {
        // 1. Início
        await send('/start', 'System Trigger');
        await send('1'); // Sim (Start)
        await send('1'); // Autorizo (Consent)
        await send('Maria Teste'); // Nome
        await send('Clínica Fix'); // Clínica
        await send('1'); // Dona (Role)
        await send('2'); // Não adicionar membro (AddMember)
        await send('1'); // Contexto Why
        await send('2'); // Contexto How

        // 10. Primeira Venda (Entrando no passo crítico)
        console.log('--- TESTANDO REGRA DE VALOR ---');
        // Envia descrição sem valor claro
        await send('Botox da Carla');

        // Bot deve perguntar o valor.
        // TENTATIVA 1: Enviar "1" (que antes poderia ser interpretado como R$ 1,00, mas agora deve ser ignorado ou rejeitado)
        console.log('➡️ Tentando enviar "1" como valor (deve ser rejeitado/ignorado como valor monetário)...');
        const res1 = await send('1');

        // Se o fix funcionou, o bot NÃO deve ter avançado para CONFIRM, ou deve ter dito que não entendeu o valor
        // Ou, se "1" não foi capturado como valor, ele vai cair no fallback: "Qual foi o valor total?"

        if (res1.response.includes('Qual foi o valor total?') || res1.response.includes('inválido') || res1.response.includes('Não consegui identificar')) {
            console.log('✅ SUCESSO: "1" foi rejeitado corretamente como valor monetário.');
        } else if (res1.response.includes('Venda:')) {
            // Se mostrou resumo da venda, extraiu algo
            if (res1.response.includes('R$ 1,00')) {
                console.error('❌ FALHA: "1" foi interpretado como R$ 1,00!');
            } else {
                console.log('⚠️ ALERTA: Extraiu algum valor, verificar: ' + res1.response);
            }
        }

        // TENTATIVA 2: Enviar "R$ 1" (agora deve aceitar)
        console.log('➡️ Tentando enviar "R$ 1" (deve ser ACEITO)...');
        const res2 = await send('R$ 1');

        if (res2.response.includes('Venda:') && res2.response.includes('R$ 1,00')) {
            console.log('✅ SUCESSO: "R$ 1" foi aceito corretamente.');
        } else {
            console.error('❌ FALHA: "R$ 1" não foi aceito corretamente.');
        }

        // Continua fluxo para limpar
        await send('1'); // Confirma venda

        console.log('✅ Verificação concluída!');

    } catch (error) {
        console.error('❌ Simulador parou com erro:', error);
    }
}

simulateFlow();
