const onboardingService = require('./onboardingService');
const geminiService = require('./geminiService');

class OnboardingFlowService {
    constructor() {
        // Armazena dados de onboarding em andamento
        this.onboardingStates = new Map();
        // Maintain alias for compatibility if any old code checks 'onboardingData'
        this.onboardingData = this.onboardingStates;
    }

    isOnboarding(phone) {
        return this.onboardingStates.has(phone);
    }

    getOnboardingStep(phone) {
        const data = this.onboardingStates.get(phone);
        return data ? data.step : null;
    }

    // Inicia o fluxo simplificado de introdução (Vídeo + Convite)
    async startIntroFlow(phone) {
        // 1. Define estado inicial
        this.onboardingStates.set(phone, {
            step: 'reg_step_1_type', // Desta vez vai direto para cadastro
            startTime: Date.now(),
            data: {
                telefone: phone // CRITICAL: Salva o telefone para usar no cadastro
            }
        });

        const evolutionService = require('./evolutionService');

        // Envia sequencia inicial (Vídeo apenas)
        await evolutionService.sendMessage(phone, 'Oi! Eu sou a Lumiz, sua assistente financeira para clínicas de estética. 💜');

        // TODO: Substituir pela URL real do vídeo
        const videoUrl = 'https://www.w3schools.com/html/mov_bbb.mp4';
        await evolutionService.sendVideo(phone, videoUrl, 'Em poucos minutos te ajudo a organizar receitas, custos e lucro da sua clínica – direto aqui no WhatsApp.');

        // MENSAGEM DE TRANSIÇÃO DIRETA PARA CADASTRO
        return `Pra começar, me conta: Qual é o tipo da sua clínica?\n\n1️⃣ Clínica de estética\n2️⃣ Clínica odontológica\n3️⃣ Outros procedimentos`;
    }

    async startOnboarding(phone) {
        // Alias to startIntroFlow for now, or keep separate if needed
        return this.startIntroFlow(phone);
    }

    // Alias para manter compatibilidade
    async startNewOnboarding(phone) {
        return this.startIntroFlow(phone);
    }

    async processOnboarding(phone, message) {
        const onboarding = this.onboardingStates.get(phone); // Use onboardingStates consistently
        if (!onboarding) return null;

        const messageTrimmed = message.trim();
        const messageLower = messageTrimmed.toLowerCase();
        const userController = require('../controllers/userController');
        const evolutionService = require('./evolutionService');
        const geminiService = require('./geminiService'); // Certifique-se de importar

        // Escape hatch global
        if (messageLower.includes('ajuda') || messageLower.includes('falar com') || messageLower.includes('humano')) {
            return 'Sem problema, eu chamo alguém do time Lumiz pra falar com você aqui mesmo 😉\n\nEm alguns minutos nossa equipe continua com você.';
        }

        switch (onboarding.step) {
            // =================================================================
            // 0. INTRODUÇÃO & TESTE (Novo Fluxo)
            // =================================================================
            case 'intro_test_confirmation':
                if (messageLower.includes('confirm') || messageLower.includes('sim') || messageLower.includes('ok')) {
                    onboarding.step = 'reg_step_1_type';
                    return `Show! Venda de teste registrada ✅\n\nViu como é fácil? Agora vamos criar sua conta de verdade.\n\nPra começar, me conta: Qual é o tipo da sua clínica?\n\n1️⃣ Clínica de estética\n2️⃣ Clínica odontológica\n3️⃣ Outros procedimentos`;
                } else {
                    return `Pra avançar, preciso que você confirme o teste acima. 👇\n\nDigite *Confirmar* para ver a mágica acontecer!`;
                }

            // =================================================================
            // 2. CADASTRO DA CLÍNICA (Mantido, mas agora vem DEPOIS do teste)
            // =================================================================
            case 'reg_step_1_type':
                let type = 'Outros';
                if (messageLower.includes('1') || messageLower.includes('estetica')) type = 'Estética';
                else if (messageLower.includes('2') || messageLower.includes('odonto')) type = 'Odontologia';

                onboarding.data.tipo_clinica = type;
                onboarding.step = 'reg_step_2_name';
                return `Ótimo! Agora, alguns dados rápidos:\n\n✏️ Qual o nome da clínica? (pode ser o nome fantasia)`;

            case 'reg_step_2_name':
                if (messageTrimmed.length < 2) return 'Nome muito curto. Digite novamente:';
                onboarding.data.nome_clinica = messageTrimmed;
                onboarding.step = 'reg_step_3_city';
                return `Obrigado! E qual cidade/UF você atende?\n(Ex: Cuiabá – MT)`;

            case 'reg_step_3_city':
                if (messageTrimmed.length < 3) return 'Digite cidade e estado, por favor.';
                onboarding.data.cidade = messageTrimmed;
                onboarding.step = 'reg_step_4_owner';
                return `Quem é o responsável pelas finanças da clínica? Pode ser você mesmo(a) 😊\n\n✏️ Me manda o nome completo e CPF/CNPJ.`;

            case 'reg_step_4_owner':
                // Validação de CPF/CNPJ (Básica: números suficientes)
                const numeros = messageTrimmed.replace(/\D/g, '');
                if (numeros.length < 11) {
                    return 'Ops! Preciso que você digite também o CPF ou CNPJ (pelo menos os números) junto com o nome. Tente novamente:';
                }
                if (messageTrimmed.length < 5) return 'Preciso de um nome válido também.';

                onboarding.data.responsavel_info = messageTrimmed;
                // Tenta extrair nome para usar depois
                onboarding.data.nome_completo = messageTrimmed.split(' ')[0];

                // LINHA DIRETA: Pula a pergunta de "quer completar?"
                onboarding.step = 'reg_step_full_email';
                return `Beleza! Digite seu melhor email:`;

            // =================================================================
            // 2.1 CADASTRO COMPLETO (SÓ SE ESCOLHER COMPLETAR)
            // =================================================================
            case 'reg_step_full_email':
                onboarding.data.email = messageTrimmed;
                onboarding.step = 'reg_step_full_whatsapp';
                return `Qual seu WhatsApp para contato?\n(Digite "este" para usar o atual)`;

            case 'reg_step_full_whatsapp':
                if (messageLower.includes('este') || messageLower.includes('atual') || messageLower.includes('mesmo')) {
                    onboarding.data.whatsapp = onboarding.data.telefone;
                } else {
                    onboarding.data.whatsapp = messageTrimmed;
                }
                try {
                    const result = await userController.createUserFromOnboarding(onboarding.data);
                    onboarding.data.userId = result.user.id;

                    // FIM CADASTRO -> TESTE ESTÁTICO (Substitui Julia Dinâmica)
                    onboarding.step = 'game_test_offer';
                    return `Cadastro completo! 🎉\n\n👀 *Vamos ver como funciona?*\n\nPara a Lumiz cuidar do seu financeiro é simples:\n1️⃣ Você envia o texto ou foto da venda.\n2️⃣ A IA entende e registra tudo sozinha.\n\n*Já criei um exemplo de venda TESTE, confirma pra mim?* 👇\n\n🧾 *Venda Teste:*\n\n👤 Cliente: Cliente Teste\n💉 Procedimento: Harmonização\n💰 Valor: R$ 300,00\n💳 Pagamento: PIX\n📅 Data: Hoje\n\n👇 Digite *Confirmar*`;

                } catch (e) {
                    console.error(e);
                    return `Erro ao criar cadastro. Tente novamente.`;
                }

            // =================================================================
            // 3. ONBOARDING GAMIFICADO
            // =================================================================
            // =================================================================
            // 3. TESTE FINAL (Estático)
            // =================================================================
            case 'game_test_offer':
                if (messageLower.includes('sim') || messageLower.includes('confirm') || messageLower.includes('ok')) {
                    onboarding.step = 'game_test_dash';
                    // Retorna mini dash
                    return `Pronto! Essa venda já entrou no seu financeiro.\n\nSe esse fosse seu mês de novembro, por exemplo, você veria algo assim:\n\n📊 *Resumo Financeiro*\n• Receitas: R$ 85.000\n• Custos: R$ 32.000\n• *Lucro: R$ 53.000 (62%)*\n\nTudo isso calculado automaticamente com base nas vendas e despesas que você manda pra mim.\n\nDigite "Uau" ou "Próximo" para continuar ✨`;
                } else {
                    return `Pra avançar, preciso que você confirme o teste acima. 👇\n\nDigite *Confirmar* para ver a mágica acontecer!`;
                }

            case 'game_test_dash':
                // FIM DO ONBOARDING
                this.onboardingStates.delete(phone);
                return `A qualquer momento, você pode pedir:\n_"Lumiz, me dá um resumo financeiro do meu mês."_\n\nEu te devolvo tudo de forma simples e clara, em segundos. ✨\n\nAgora é com você! Pode começar a mandar suas vendas e custos reais. 😉`;

            case 'game_finish':
                // Fallback caso alguém caia aqui
                this.onboardingStates.delete(phone);
                return 'Estou pronta para organizar seu financeiro! 💜';

            default:
                return 'Ops, me perdi. Digite "Oi" para recomeçar.';
        }
    }
}

module.exports = new OnboardingFlowService();
