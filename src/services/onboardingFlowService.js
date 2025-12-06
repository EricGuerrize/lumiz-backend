const onboardingService = require('./onboardingService');
const geminiService = require('./geminiService');

class OnboardingFlowService {
    constructor() {
        // Armazena dados de onboarding em andamento
        this.onboardingData = new Map();
    }

    isOnboarding(phone) {
        return this.onboardingData.has(phone);
    }

    getOnboardingStep(phone) {
        const data = this.onboardingData.get(phone);
        return data ? data.step : null;
    }

    async startOnboarding(phone) {
        // Inicia com o menu principal
        this.onboardingData.set(phone, {
            step: 'intro_menu',
            data: {
                telefone: phone
            },
            timestamp: Date.now()
        });
    }

    // Alias para manter compatibilidade
    async startNewOnboarding(phone) {
        return this.startOnboarding(phone);
    }

    async processOnboarding(phone, message) {
        const onboarding = this.onboardingData.get(phone);
        if (!onboarding) return null;

        const messageTrimmed = message.trim();
        const messageLower = messageTrimmed.toLowerCase();

        // Importa userController sob demanda
        const userController = require('../controllers/userController');

        switch (onboarding.step) {
            // =================================================================
            // 0. CONFIRMAÇÃO DO INÍCIO (Fluxo Simplificado)
            // =================================================================
            case 'awaiting_start_confirmation': {
                const intent = messageLower;
                if (intent.includes('sim') || intent.includes('vamos') || intent.includes('quero') || intent.includes('começar') || intent.includes('bora')) {
                    onboarding.step = 'reg_step_1';
                    return `Ótimo! 🚀\n\nQual o tipo da sua clínica?\n\nDigite o número:\n1 - Estética facial\n2 - Estética corporal\n3 - Estética facial e corporal\n4 - Odontologia estética\n5 - Outro tipo`;
                } else {
                    return `Para começarmos a organizar seu financeiro, preciso criar seu cadastro rapidinho.\n\nVamos começar? (Sim / Não)`;
                }
            }

            // =================================================================
            // 1. PRIMEIRA INTERAÇÃO & MENU
            // =================================================================
            case 'intro_menu': {
                if (messageLower.includes('1') || messageLower.includes('conhecer')) {
                    onboarding.step = 'understand_1';
                    return `📊 *Gestão financeira simplificada*\n\nVocê registra suas vendas e custos aqui no WhatsApp.\nEu organizo tudo automaticamente: receitas, despesas, lucro e margem.\n\nDigite "próximo" para continuar`;
                } else if (messageLower.includes('2') || messageLower.includes('começar') || messageLower.includes('cadastro')) {
                    onboarding.step = 'reg_step_1';
                    return `Vamos começar! 🚀\n\nQual o tipo da sua clínica?\n\nDigite o número:\n1 - Estética facial\n2 - Estética corporal\n3 - Estética facial e corporal\n4 - Odontologia estética\n5 - Outro tipo`;
                } else {
                    return `Como posso te ajudar?\n\nDigite:\n1 - Conhecer a Lumiz\n2 - Começar cadastro`;
                }
            }

            // =================================================================
            // 2. FLUXO "ENTENDER COMO FUNCIONA"
            // =================================================================
            case 'understand_1': {
                onboarding.step = 'understand_2';
                return `💬 *Registro super fácil*\n\nÉ só me mandar:\n_"Cliente Maria fez botox, R$ 1.200, cartão em 3x"_\n\nEu entendo e organizo tudo sozinha.\n\nDigite "próximo" para continuar`;
            }

            case 'understand_2': {
                onboarding.step = 'understand_3';
                return `📈 *Relatórios instantâneos*\n\n*Lumiz, como foi meu mês?*\n\nResumo de Novembro 💜\n- Entrou: R$ 42.800\n- Saiu: R$ 18.600\n- Lucro: R$ 24.200\n- Margem: 56,5%\n\nTop procedimentos:\n1. Harmonização: R$ 18.000\n2. Botox: R$ 12.400\n3. Skinbooster: R$ 8.200\n\nDigite "próximo" para continuar`;
            }

            case 'understand_3': {
                onboarding.step = 'understand_4';
                return `📄 *Leio seus documentos*\n\nMe envie boletos, notas fiscais ou extratos.\nEu leio tudo e registro como custo automaticamente.\n\nVocê só confirma e pronto!\n\nDigite "próximo" para continuar`;
            }

            case 'understand_4': {
                onboarding.step = 'intro_menu'; // Volta pro menu ou pergunta cadastro
                return `✨ *Teste grátis por 7 dias*\n\nExperimente todas as funcionalidades.\nDepois, apenas R$ 97/mês para clínicas com até 50 procedimentos.\n\nDigite "cadastrar" para começar ou "menu" para voltar.`;
            }

            // =================================================================
            // 3. FLUXO DE CADASTRO (7 PASSOS)
            // =================================================================
            case 'reg_step_1': { // Tipo de clínica
                const validTypes = ['1', '2', '3', '4', '5'];
                // Aceita texto também se contiver palavras chave
                let type = null;
                if (validTypes.includes(messageTrimmed)) {
                    const typesMap = { '1': 'Facial', '2': 'Corporal', '3': 'Facial e Corporal', '4': 'Odontologia', '5': 'Outro' };
                    type = typesMap[messageTrimmed];
                } else if (messageLower.includes('facial') && messageLower.includes('corporal')) type = 'Facial e Corporal';
                else if (messageLower.includes('facial')) type = 'Facial';
                else if (messageLower.includes('corporal')) type = 'Corporal';
                else if (messageLower.includes('odonto')) type = 'Odontologia';
                else type = 'Outro';

                onboarding.data.tipo_clinica = type;
                onboarding.step = 'reg_step_2';
                return `Perfeito! Agora me conta:\n\nQual o nome da sua clínica?\n(Pode ser o nome fantasia)\n\nDigite o nome:`;
            }

            case 'reg_step_2': { // Nome da clínica
                if (messageTrimmed.length < 2) return 'O nome precisa ter pelo menos 2 letras. Por favor, digite novamente o nome da sua clínica:';
                onboarding.data.nome_clinica = messageTrimmed;
                onboarding.step = 'reg_step_3';
                return `Ótimo! ${messageTrimmed} 💜\n\nEm qual cidade você atende?\n\nDigite cidade e estado (ex: Cuiabá - MT):`;
            }

            case 'reg_step_3': { // Cidade
                if (messageTrimmed.length < 3) return 'Preciso que você digite a cidade e o estado. Exemplo: "São Paulo - SP". Tente novamente:';
                onboarding.data.cidade = messageTrimmed;
                onboarding.step = 'reg_step_4';
                return `Quem é o responsável pelo financeiro?\n\nDigite seu nome completo:`;
            }

            case 'reg_step_4': { // Responsável (Nome Completo)
                if (messageTrimmed.length < 3 || !messageTrimmed.includes(' ')) return 'Por favor, digite seu nome e sobrenome para que eu possa te identificar.';
                onboarding.data.nome_completo = messageTrimmed; // Mapeia para nome_completo do profile
                onboarding.step = 'reg_step_5_email';
                return `Prazer, ${messageTrimmed.split(' ')[0]}! \n\nAgora seus dados de contato.\n\nDigite seu melhor email:`;
            }

            case 'reg_step_5_email': { // Email
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(messageTrimmed)) return 'Esse email não parece válido. Tente digitar no formato: nome@exemplo.com';
                onboarding.data.email = messageTrimmed;
                onboarding.step = 'reg_step_6_procedimentos';
                return `Perfeito! E qual seu WhatsApp?\n\n(Pode confirmar este mesmo número digitando "este" ou digite outro)`;
            }

            case 'reg_step_5_whatsapp': { // WhatsApp (Opcional/Confirmação) - *Step skipped in logic above, merging*
                // Actually the script asks for email then whatsapp.
                // Let's handle whatsapp here if we split the step, but I merged it in the prompt response above?
                // Wait, previous return was: "Perfeito! E qual seu WhatsApp?..."
                // So this case handles the ANSWER to that question.

                // Logic to validate phone or accept "este"
                let phone = messageTrimmed.replace(/\D/g, '');
                if (messageLower.includes('este') || messageLower.includes('mesmo') || phone === '') {
                    onboarding.data.whatsapp_contato = onboarding.data.telefone;
                } else {
                    if (phone.length < 10) return 'Por favor, digite um número válido com DDD ou "este".';
                    onboarding.data.whatsapp_contato = phone;
                }

                onboarding.step = 'reg_step_6_procedimentos';
                return `Quase lá! Me conta um pouco mais:\n\nQuantos procedimentos vocês fazem por mês em média?\n\nDigite o número aproximado:`;
            }

            // Correction: I returned 'reg_step_6_procedimentos' in 'reg_step_5_email' but the text asked for WhatsApp.
            // I need to fix the next step pointer in 'reg_step_5_email'.
            // Let's fix it in the code below (I will rewrite the case 'reg_step_5_email' correctly).

            case 'reg_step_6_procedimentos': { // Procedimentos/mês
                // This case handles the answer to "Quantos procedimentos..."
                // Wait, I need to fix the flow sequence.
                // Step 4 asks Name -> goes to 5_email.
                // Step 5_email asks Email -> goes to 5_whatsapp.
                // Step 5_whatsapp asks Whatsapp -> goes to 6_procedimentos.
                // Step 6_procedimentos asks Number -> goes to 6_ticket.
                // Step 6_ticket asks Value -> goes to 7_confirm.

                const num = parseInt(messageTrimmed.replace(/\D/g, ''));
                if (isNaN(num)) return 'Por favor, digite um número aproximado.';
                onboarding.data.procedimentos_mes = num;
                onboarding.step = 'reg_step_6_ticket';
                return `E qual o ticket médio dos seus procedimentos?\n\nDigite o valor médio (ex: 800):`;
            }

            case 'reg_step_6_ticket': { // Ticket médio
                const val = parseFloat(messageTrimmed.replace(',', '.').replace(/[^\d.]/g, ''));
                if (isNaN(val)) return 'Por favor, digite um valor numérico.';
                onboarding.data.ticket_medio = val;
                onboarding.step = 'reg_step_7_confirm';

                // Build confirmation message
                const d = onboarding.data;
                let msg = `Excelente! Vamos confirmar seus dados:\n\n`;
                msg += `🏥 Clínica: ${d.nome_clinica}\n`;
                msg += `📍 Cidade: ${d.cidade}\n`;
                msg += `👤 Responsável: ${d.nome_completo}\n`;
                msg += `📧 Email: ${d.email}\n`;
                msg += `📱 WhatsApp: ${d.whatsapp_contato || d.telefone}\n`;
                msg += `💉 Procedimentos/mês: ${d.procedimentos_mes}\n`;
                msg += `💰 Ticket médio: R$ ${d.ticket_medio}\n\n`;
                msg += `Digite "confirmar" para finalizar ou "corrigir" para ajustar`;
                return msg;
            }

            case 'reg_step_7_confirm': { // Confirmação
                if (messageLower.includes('confirm') || messageLower.includes('sim') || messageLower.includes('ok')) {
                    // CRIA O USUÁRIO
                    try {
                        const result = await userController.createUserFromOnboarding(onboarding.data);

                        // Inicia Tutorial
                        onboarding.step = 'tutorial_welcome';
                        onboarding.data.userId = result.user.id; // Save ID for context if needed

                        return `🎉 *Cadastro aprovado! Bem-vinda à Lumiz!*\n\nVou te mostrar como é fácil na prática.\n\nVamos fazer um teste rápido?\n\nDigite "sim" para começar ou "depois" para fazer mais tarde`;
                    } catch (e) {
                        console.error(e);
                        return `Erro ao criar cadastro: ${e.message}. Tente novamente.`;
                    }
                } else {
                    // Reinicia cadastro? Ou pergunta o que corrigir?
                    // Simplificação: Reinicia do passo 1
                    onboarding.step = 'reg_step_1';
                    return `Tudo bem, vamos corrigir. Qual o tipo da sua clínica?\n1 - Estética facial\n2 - Estética corporal\n3 - Estética facial e corporal\n4 - Odontologia estética\n5 - Outro tipo`;
                }
            }

            // =================================================================
            // 4. ONBOARDING PRÁTICO (TUTORIAL)
            // =================================================================
            case 'tutorial_welcome': {
                if (messageLower.includes('sim') || messageLower.includes('bora') || messageLower.includes('vamos')) {
                    onboarding.step = 'tutorial_step_1';
                    return `Ótimo! Vamos simular uma venda.\n\nMe manda assim:\n_"Maria fez harmonização facial, pagou R$ 3.500 no cartão em 2x"_\n\nOu invente qualquer venda da sua clínica.\nDigite a venda:`;
                } else {
                    // Pula tutorial
                    this.onboardingData.delete(phone);
                    return `Tudo bem! Quando quiser usar, é só me chamar.\n\nDica: Comece enviando uma venda ou custo!`;
                }
            }

            case 'tutorial_step_1': { // Simula Venda
                // Mock response (don't actually save to DB to avoid polluting, or save and delete? Script says "Vou registrar")
                // Let's just mock the response to be safe and fast.
                onboarding.step = 'tutorial_step_2';
                return `Entendi! Vou registrar:\n\n💉 Procedimento: Harmonização facial\n👤 Cliente: Maria\n💰 Valor: R$ 3.500\n💳 Pagamento: Cartão 2x\n📅 Data: Hoje\n\nDigite "confirmar" para salvar ou "editar" para corrigir`;
            }

            case 'tutorial_step_2': { // Confirma Venda -> Pede Custo
                // User says "confirmar"
                onboarding.step = 'tutorial_step_3';
                return `Perfeito! Venda registrada ✅\n\nAgora vamos registrar um custo.\n\nMe envie:\n- Uma foto de boleto ou nota fiscal\n- Ou digite: "Paguei R$ 1.200 de Botox para estoque"\n\nComo preferir!`;
            }

            case 'tutorial_step_3': { // Simula Custo
                // User sends cost
                onboarding.step = 'tutorial_step_4';
                return `Registrei seu custo:\n\n📦 Descrição: Botox (estoque)\n💰 Valor: R$ 1.200\n📅 Data: Hoje\n🏷️ Categoria: Insumos\n\nDigite "confirmar" para salvar`;
            }

            case 'tutorial_step_4': { // Confirma Custo -> Pede Relatório
                onboarding.step = 'tutorial_finish';
                return `Excelente! Agora veja como é fácil consultar.\n\nDigite: "resumo do dia" ou "como está meu mês"`;
            }

            case 'tutorial_finish': { // Mostra Relatório e Finaliza
                this.onboardingData.delete(phone); // FIM DO ONBOARDING
                return `Resumo de Hoje 💜\n\n✅ Receitas: R$ 3.500\n📦 Custos: R$ 1.200\n💰 Resultado: R$ 2.300\n📊 Margem: 65,7%\n\nProcedimentos realizados:\n- Harmonização facial - R$ 3.500\n\nDigite "detalhes" para mais informações\n\n---\n\nPronto! Você já sabe o essencial 🎯\n\nPode começar a usar pra valer agora! O que quer fazer?`;
            }

            default:
                return 'Ops, me perdi. Digite "Oi" para recomeçar.';
        }
    }

    // Fix for the email step flow logic I missed above
    // I need to override the processOnboarding method with the corrected one.
}

// Re-implementing the class with corrected flow logic for step 5
class OnboardingFlowServiceCorrected {
    constructor() {
        this.onboardingData = new Map();
    }

    isOnboarding(phone) {
        return this.onboardingData.has(phone);
    }

    getOnboardingStep(phone) {
        const data = this.onboardingData.get(phone);
        return data ? data.step : null;
    }

    // Inicia o fluxo simplificado de introdução (Vídeo + Convite)
    async startIntroFlow(phone) {
        // 1. Define estado inicial
        this.onboardingStates.set(phone, {
            step: 'awaiting_start_confirmation',
            startTime: Date.now(),
            data: {}
        });

        try {
            // 2. Envia saudação inicial
            const evolutionService = require('./evolutionService');
            await evolutionService.sendMessage(phone, 'Oi, prazer! Sou a Lumiz 👋\n\nSou a IA que vai organizar o financeiro da sua clínica — direto pelo WhatsApp.');

            // 3. Envia vídeo explicativo
            // TODO: Substituir pela URL real do vídeo fornecida pelo usuário
            const videoUrl = 'https://www.w3schools.com/html/mov_bbb.mp4';
            await evolutionService.sendVideo(phone, videoUrl, 'Assista rapidinho para entender como facilito sua vida! 💜');

            // 4. Retorna a pergunta final para ser enviada pelo controller (ou envia aqui mesmo)
            return 'Vamos começar seu teste gratuito agora?';
        } catch (error) {
            console.error('[ONBOARDING] Erro ao enviar intro:', error);
            return 'Oi! Sou a Lumiz. Vamos começar seu cadastro?';
        }
    }

    async startOnboarding(phone) {
        this.onboardingData.set(phone, {
            step: 'intro_menu',
            data: { telefone: phone },
            timestamp: Date.now()
        });
    }

    async startNewOnboarding(phone) {
        return this.startOnboarding(phone);
    }

    async processOnboarding(phone, message) {
        const onboarding = this.onboardingData.get(phone);
        if (!onboarding) return null;

        const messageTrimmed = message.trim();
        const messageLower = messageTrimmed.toLowerCase();
        const userController = require('../controllers/userController');

        switch (onboarding.step) {
            case 'intro_menu':
                if (messageLower.includes('1') || messageLower.includes('conhecer')) {
                    onboarding.step = 'understand_1';
                    return `📊 *Gestão financeira simplificada*\n\nVocê registra suas vendas e custos aqui no WhatsApp.\nEu organizo tudo automaticamente: receitas, despesas, lucro e margem.\n\nDigite "próximo" para continuar`;
                } else if (messageLower.includes('2') || messageLower.includes('começar') || messageLower.includes('cadastro')) {
                    onboarding.step = 'reg_step_1';
                    return `Vamos começar! 🚀\n\nQual o tipo da sua clínica?\n\nDigite o número:\n1 - Estética facial\n2 - Estética corporal\n3 - Estética facial e corporal\n4 - Odontologia estética\n5 - Outro tipo`;
                } else {
                    return `Como posso te ajudar?\n\nDigite:\n1 - Conhecer a Lumiz\n2 - Começar cadastro`;
                }

            case 'understand_1':
                onboarding.step = 'understand_2';
                return `💬 *Registro super fácil*\n\nÉ só me mandar:\n_"Cliente Maria fez botox, R$ 1.200, cartão em 3x"_\n\nEu entendo e organizo tudo sozinha.\n\nDigite "próximo" para continuar`;

            case 'understand_2':
                onboarding.step = 'understand_3';
                return `📈 *Relatórios instantâneos*\n\n*Lumiz, como foi meu mês?*\n\nResumo de Novembro 💜\n- Entrou: R$ 42.800\n- Saiu: R$ 18.600\n- Lucro: R$ 24.200\n- Margem: 56,5%\n\nTop procedimentos:\n1. Harmonização: R$ 18.000\n2. Botox: R$ 12.400\n3. Skinbooster: R$ 8.200\n\nDigite "próximo" para continuar`;

            case 'understand_3':
                onboarding.step = 'understand_4';
                return `📄 *Leio seus documentos*\n\nMe envie boletos, notas fiscais ou extratos.\nEu leio tudo e registro como custo automaticamente.\n\nVocê só confirma e pronto!\n\nDigite "próximo" para continuar`;

            case 'understand_4':
                onboarding.step = 'intro_menu';
                return `✨ *Teste grátis por 7 dias*\n\nExperimente todas as funcionalidades.\nDepois, apenas R$ 97/mês para clínicas com até 50 procedimentos.\n\nDigite "cadastrar" para começar ou "menu" para voltar.`;

            case 'reg_step_1': // Tipo
                const validTypes = ['1', '2', '3', '4', '5'];
                let type = 'Outro';
                if (validTypes.includes(messageTrimmed)) {
                    const typesMap = { '1': 'Facial', '2': 'Corporal', '3': 'Facial e Corporal', '4': 'Odontologia', '5': 'Outro' };
                    type = typesMap[messageTrimmed];
                } else if (messageLower.includes('facial') && messageLower.includes('corporal')) type = 'Facial e Corporal';
                else if (messageLower.includes('facial')) type = 'Facial';
                else if (messageLower.includes('corporal')) type = 'Corporal';
                else if (messageLower.includes('odonto')) type = 'Odontologia';

                onboarding.data.tipo_clinica = type;
                onboarding.step = 'reg_step_2';
                return `Perfeito! Agora me conta:\n\nQual o nome da sua clínica?\n(Pode ser o nome fantasia)\n\nDigite o nome:`;

            case 'reg_step_2': // Nome Clínica
                if (messageTrimmed.length < 2) return 'Por favor, digite um nome válido.';
                onboarding.data.nome_clinica = messageTrimmed;
                onboarding.step = 'reg_step_3';
                return `Ótimo! ${messageTrimmed} 💜\n\nEm qual cidade você atende?\n\nDigite cidade e estado (ex: Cuiabá - MT):`;

            case 'reg_step_3': // Cidade
                if (messageTrimmed.length < 3) return 'Por favor, digite sua cidade e estado.';
                onboarding.data.cidade = messageTrimmed;
                onboarding.step = 'reg_step_4';
                return `Quem é o responsável pelo financeiro?\n\nDigite seu nome completo:`;

            case 'reg_step_4': // Nome Responsável
                if (messageTrimmed.length < 3) return 'Por favor, digite seu nome completo.';
                onboarding.data.nome_completo = messageTrimmed;
                onboarding.step = 'reg_step_5_email';
                return `Prazer, ${messageTrimmed.split(' ')[0]}! \n\nAgora seus dados de contato.\n\nDigite seu melhor email:`;

            case 'reg_step_5_email': // Email
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(messageTrimmed)) return 'Por favor, digite um email válido.';
                onboarding.data.email = messageTrimmed;
                onboarding.step = 'reg_step_5_whatsapp'; // Vai para whatsapp
                return `Perfeito! E qual seu WhatsApp?\n\n(Pode confirmar este mesmo número digitando "este" ou digite outro)`;

            case 'reg_step_5_whatsapp': // WhatsApp
                let phoneInput = messageTrimmed.replace(/\D/g, '');
                if (messageLower.includes('este') || messageLower.includes('mesmo') || (phoneInput === '' && messageTrimmed.length < 5)) {
                    onboarding.data.whatsapp_contato = onboarding.data.telefone;
                } else {
                    if (phoneInput.length < 10) return 'O número precisa ter o DDD. Exemplo: 11999999999. Digite novamente ou "este" para usar o atual.';
                    onboarding.data.whatsapp_contato = phoneInput;
                }
                onboarding.step = 'reg_step_6_procedimentos';
                return `Quase lá! Me conta um pouco mais:\n\nQuantos procedimentos vocês fazem por mês em média?\n\nDigite o número aproximado:`;

            case 'reg_step_6_procedimentos': // Procedimentos
                const num = parseInt(messageTrimmed.replace(/\D/g, ''));
                if (isNaN(num)) return 'Preciso que você digite apenas o número aproximado. Exemplo: "50".';
                onboarding.data.procedimentos_mes = num;
                onboarding.step = 'reg_step_6_ticket';
                return `E qual o ticket médio dos seus procedimentos?\n\nDigite o valor médio (ex: 800):`;

            case 'reg_step_6_ticket': // Ticket
                const val = parseFloat(messageTrimmed.replace(',', '.').replace(/[^\d.]/g, ''));
                if (isNaN(val)) return 'Não entendi o valor. Digite algo como "150" ou "150,00".';
                onboarding.data.ticket_medio = val;
                onboarding.step = 'reg_step_7_confirm';

                const d = onboarding.data;
                let msg = `Excelente! Vamos confirmar seus dados:\n\n`;
                msg += `🏥 Clínica: ${d.nome_clinica}\n`;
                msg += `📍 Cidade: ${d.cidade}\n`;
                msg += `👤 Responsável: ${d.nome_completo}\n`;
                msg += `📧 Email: ${d.email}\n`;
                msg += `📱 WhatsApp: ${d.whatsapp_contato || d.telefone}\n`;
                msg += `💉 Procedimentos/mês: ${d.procedimentos_mes}\n`;
                msg += `💰 Ticket médio: R$ ${d.ticket_medio}\n\n`;
                msg += `Digite "confirmar" para finalizar ou "corrigir" para ajustar`;
                return msg;

            case 'reg_step_7_confirm': // Confirmação
                if (messageLower.includes('confirm') || messageLower.includes('sim') || messageLower.includes('ok')) {
                    try {
                        const result = await userController.createUserFromOnboarding(onboarding.data);
                        onboarding.data.userId = result.user.id;
                        onboarding.step = 'tutorial_welcome';
                        return `🎉 *Cadastro aprovado! Bem-vinda à Lumiz!*\n\nVou te mostrar como é fácil na prática.\n\nVamos fazer um teste rápido?\n\nDigite "sim" para começar ou "depois" para fazer mais tarde`;
                    } catch (e) {
                        console.error(e);
                        return `Erro ao criar cadastro: ${e.message}. Tente novamente.`;
                    }
                } else if (messageLower.includes('corrigir') || messageLower.includes('editar')) {
                    onboarding.step = 'reg_correction_select';
                    return `Tudo bem, vamos corrigir. Qual informação você deseja alterar?\n\n(Ex: nome, cidade, email, whatsapp, procedimentos, ticket)`;
                } else {
                    return `Não entendi. Se os dados estiverem certos, digite "confirmar". Se quiser mudar algo, digite "corrigir".`;
                }

            case 'reg_correction_select': // Seleciona o campo
                let field = null;
                let prompt = '';

                if (messageLower.includes('nome') && messageLower.includes('clinica')) { field = 'nome_clinica'; prompt = 'Qual o novo nome da clínica?'; }
                else if (messageLower.includes('cidade')) { field = 'cidade'; prompt = 'Qual a nova cidade e estado?'; }
                else if (messageLower.includes('responsavel') || (messageLower.includes('nome') && !messageLower.includes('clinica'))) { field = 'nome_completo'; prompt = 'Qual o nome do responsável?'; }
                else if (messageLower.includes('email')) { field = 'email'; prompt = 'Qual o novo email?'; }
                else if (messageLower.includes('whats') || messageLower.includes('telefone')) { field = 'whatsapp_contato'; prompt = 'Qual o novo número de WhatsApp?'; }
                else if (messageLower.includes('procedimento')) { field = 'procedimentos_mes'; prompt = 'Qual a nova quantidade média de procedimentos por mês?'; }
                else if (messageLower.includes('ticket') || messageLower.includes('valor')) { field = 'ticket_medio'; prompt = 'Qual o novo ticket médio?'; }
                else {
                    return `Não entendi qual campo você quer corrigir. Tente digitar: "email", "cidade", "procedimentos", etc.`;
                }

                onboarding.correctionField = field;
                onboarding.step = 'reg_correction_input';
                return `Certo, ${prompt}`;

            case 'reg_correction_input': // Recebe o novo valor
                const fieldToUpdate = onboarding.correctionField;

                // Validações básicas (reutilizando lógica anterior simplificada)
                if (fieldToUpdate === 'email') {
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    if (!emailRegex.test(messageTrimmed)) return 'Email inválido. Tente novamente:';
                }
                if (fieldToUpdate === 'procedimentos_mes') {
                    const num = parseInt(messageTrimmed.replace(/\D/g, ''));
                    if (isNaN(num)) return 'Digite um número válido.';
                    onboarding.data[fieldToUpdate] = num;
                } else if (fieldToUpdate === 'ticket_medio') {
                    const val = parseFloat(messageTrimmed.replace(',', '.').replace(/[^\d.]/g, ''));
                    if (isNaN(val)) return 'Digite um valor válido.';
                    onboarding.data[fieldToUpdate] = val;
                } else if (fieldToUpdate === 'whatsapp_contato') {
                    let phoneInput = messageTrimmed.replace(/\D/g, '');
                    if (phoneInput.length < 10) return 'Número inválido. Digite com DDD.';
                    onboarding.data[fieldToUpdate] = phoneInput;
                } else {
                    // Texto livre (nome, cidade, etc)
                    if (messageTrimmed.length < 2) return 'Muito curto. Tente novamente:';
                    onboarding.data[fieldToUpdate] = messageTrimmed;
                }

                // Volta para confirmação
                onboarding.step = 'reg_step_7_confirm';

                // Mostra resumo atualizado
                const d2 = onboarding.data;
                let msg2 = `Atualizado! Vamos confirmar seus dados:\n\n`;
                msg2 += `🏥 Clínica: ${d2.nome_clinica}\n`;
                msg2 += `📍 Cidade: ${d2.cidade}\n`;
                msg2 += `👤 Responsável: ${d2.nome_completo}\n`;
                msg2 += `📧 Email: ${d2.email}\n`;
                msg2 += `📱 WhatsApp: ${d2.whatsapp_contato || d2.telefone}\n`;
                msg2 += `💉 Procedimentos/mês: ${d2.procedimentos_mes}\n`;
                msg2 += `💰 Ticket médio: R$ ${d2.ticket_medio}\n\n`;
                msg2 += `Digite "confirmar" para finalizar ou "corrigir" para ajustar mais algo`;
                return msg2;

            case 'tutorial_welcome':
                if (messageLower.includes('sim') || messageLower.includes('bora') || messageLower.includes('vamos')) {
                    onboarding.step = 'tutorial_step_1';
                    return `Ótimo! Vamos simular uma venda.\n\nMe manda assim:\n_"Maria fez harmonização facial, pagou R$ 3.500 no cartão em 2x"_\n\nOu invente qualquer venda da sua clínica.\nDigite a venda:`;
                } else {
                    this.onboardingData.delete(phone);
                    return `Tudo bem! Quando quiser usar, é só me chamar.\n\nDica: Comece enviando uma venda ou custo!`;
                }

            case 'tutorial_step_1': // Venda
                onboarding.step = 'tutorial_step_2';
                return `Entendi! Vou registrar:\n\n💉 Procedimento: Harmonização facial\n👤 Cliente: Maria\n💰 Valor: R$ 3.500\n💳 Pagamento: Cartão 2x\n📅 Data: Hoje\n\nDigite "confirmar" para salvar ou "editar" para corrigir`;

            case 'tutorial_step_2': // Confirma Venda
                if (messageLower.includes('editar') || messageLower.includes('corrigir')) {
                    onboarding.step = 'tutorial_step_1';
                    return `Tudo bem! Vamos corrigir.\n\nDigite novamente a venda:\n_"Maria fez harmonização facial, pagou R$ 3.500 no cartão em 2x"_`;
                } else if (messageLower.includes('confirm') || messageLower.includes('sim') || messageLower.includes('ok')) {
                    onboarding.step = 'tutorial_step_3';
                    return `Perfeito! Venda registrada ✅\n\nAgora vamos registrar um custo.\n\nMe envie:\n- Uma foto de boleto ou nota fiscal\n- Ou digite: "Paguei R$ 1.200 de Botox para estoque"\n\nComo preferir!`;
                } else {
                    return `Não entendi. Digite "confirmar" para salvar ou "editar" para corrigir.`;
                }

            case 'tutorial_step_3': // Custo
                onboarding.step = 'tutorial_step_4';
                return `Registrei seu custo:\n\n📦 Descrição: Botox (estoque)\n💰 Valor: R$ 1.200\n📅 Data: Hoje\n🏷️ Categoria: Insumos\n\nDigite "confirmar" para salvar`;

            case 'tutorial_step_4': // Confirma Custo
                if (messageLower.includes('editar') || messageLower.includes('corrigir')) {
                    onboarding.step = 'tutorial_step_3';
                    return `Sem problemas! Vamos corrigir.\n\nDigite novamente o custo:\n_"Paguei R$ 1.200 de Botox para estoque"_`;
                } else if (messageLower.includes('confirm') || messageLower.includes('sim') || messageLower.includes('ok')) {
                    onboarding.step = 'tutorial_finish';
                    return `Excelente! Agora veja como é fácil consultar.\n\nDigite: "resumo do dia" ou "como está meu mês"`;
                } else {
                    return `Não entendi. Digite "confirmar" para salvar ou "editar" para corrigir.`;
                }

            case 'tutorial_finish': // Relatório
                this.onboardingData.delete(phone);
                return `Resumo de Hoje 💜\n\n✅ Receitas: R$ 3.500\n📦 Custos: R$ 1.200\n💰 Resultado: R$ 2.300\n📊 Margem: 65,7%\n\nProcedimentos realizados:\n- Harmonização facial - R$ 3.500\n\nDigite "detalhes" para mais informações\n\n---\n\nPronto! Você já sabe o essencial 🎯\n\nPode começar a usar pra valer agora! O que quer fazer?`;

            default:
                return 'Ops, me perdi. Digite "Oi" para recomeçar.';
        }
    }
}

module.exports = new OnboardingFlowServiceCorrected();
