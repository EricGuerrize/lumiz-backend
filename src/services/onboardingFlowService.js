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
        // 1. Define estado inicial para esperar confirmação do teste
        this.onboardingStates.set(phone, {
            step: 'intro_test_confirmation',
            startTime: Date.now(),
            data: {
                telefone: phone // CRITICAL: Salva o telefone para usar no cadastro
            }
        });

        const evolutionService = require('./evolutionService');

        // Envia sequencia inicial
        await evolutionService.sendMessage(phone, 'Oi! Eu sou a Lumiz, sua assistente financeira para clínicas de estética. 💜');

        // TODO: Substituir pela URL real do vídeo
        const videoUrl = 'https://www.w3schools.com/html/mov_bbb.mp4';
        await evolutionService.sendVideo(phone, videoUrl, 'Em poucos minutos te ajudo a organizar receitas, custos e lucro da sua clínica – direto aqui no WhatsApp.');

        // Nova Abordagem: Já manda o exemplo direto!

        const msgExplicacao = `👀 *Vamos ver como funciona?*\n\nPara a Lumiz cuidar do seu financeiro é simples:\n1️⃣ Você envia o texto ou foto da venda.\n2️⃣ A IA entende e registra tudo sozinha.\n\n*Já criamos um TESTE, agora é só confirmar abaixo* 👇`;

        await evolutionService.sendMessage(phone, msgExplicacao);

        // Manda o "Card" de teste
        const msgTeste = `🧾 *Venda Teste:*\n\n👤 Cliente: Cliente Teste\n💉 Procedimento: Harmonização\n💰 Valor: R$ 300,00\n💳 Pagamento: PIX\n📅 Data: Hoje\n\n*Confirma a criação dessa venda?*\n👇 Digite *Confirmar*`;

        return msgTeste;
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

                onboarding.step = 'reg_step_5_shortcut';
                return `Quer preencher mais detalhes agora ou prefere ir direto pra parte de testar a Lumiz?\n\n1️⃣ Completar cadastro\n2️⃣ Pular e testar agora`;

            case 'reg_step_5_shortcut':
                if (messageLower.includes('1') || messageLower.includes('completar')) {
                    onboarding.step = 'reg_step_full_email';
                    return `Beleza! Digite seu melhor email:`;
                } else {
                    // PULA para Gamificação - Cria usuário temporário/simples
                    try {
                        const result = await userController.createUserFromOnboarding(onboarding.data);
                        onboarding.data.userId = result.user.id;
                        onboarding.step = 'game_sim_venda';
                        return `Vamos fazer um teste rápido, combinado?\n\nMe manda uma venda fictícia nesse estilo:\n\n_"Júlia fez um full face com 10ml, pagou R$ 5.000, cartão em 6x."_`;
                    } catch (e) {
                        console.error(e);
                        return `Erro ao criar cadastro. Tente novamente.`;
                    }
                }

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
                    onboarding.step = 'game_sim_venda';
                    return `Cadastro completo! 🎉\n\nVamos fazer um teste rápido?\n\nMe manda uma venda fictícia nesse estilo:\n\n_"Júlia fez um full face com 10ml, pagou R$ 5.000, cartão em 6x."_`;
                } catch (e) {
                    console.error(e);
                    return `Erro ao criar cadastro. Tente novamente.`;
                }

            // =================================================================
            // 3. ONBOARDING GAMIFICADO
            // =================================================================
            case 'game_sim_venda':
                onboarding.step = 'game_sim_confirm';

                // MODO DINÂMICO USANDO GEMINI
                try {
                    // Chama o Gemini para extrair os dados da mensagem
                    const geminiResponse = await geminiService.processMessage(messageTrimmed);

                    // O geminiService retorna { intencao, dados: { ... } }
                    // Vamos usar os dados extraídos se existirem
                    const dados = geminiResponse.dados || {};

                    // Defaults se falhar
                    let cliente = dados.nome_cliente || dados.descricao;

                    // Fallback: Se não achou cliente mas a mensagem começa com nome (Ex: "Romulo botox...")
                    if ((!cliente || cliente === 'Cliente Identificado') && messageTrimmed.length > 5) {
                        const firstWord = messageTrimmed.split(' ')[0];
                        // Se primeira letra maiuscula e não é um valor/comando
                        if (firstWord[0] === firstWord[0].toUpperCase() && isNaN(parseInt(firstWord))) {
                            cliente = firstWord;
                        } else {
                            cliente = 'Cliente Identificado';
                        }
                    }

                    const valor = dados.valor ? `R$ ${dados.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : 'R$ 0,00';
                    const procedimento = dados.categoria || 'Procedimento';

                    let pgto = 'À vista';
                    if (dados.forma_pagamento === 'pix') pgto = 'PIX';
                    else if (dados.forma_pagamento === 'parcelado') pgto = `Cartão ${dados.parcelas}x`;
                    else if (dados.forma_pagamento === 'credito_avista') pgto = 'Crédito à vista';
                    else if (dados.forma_pagamento === 'debito') pgto = 'Débito';
                    else if (dados.forma_pagamento === 'dinheiro') pgto = 'Dinheiro';

                    // Salva no contexto para uso posterior se precisar (embora aqui seja só visual)
                    onboarding.data.simulacao = { cliente, valor, procedimento, pgto };

                    return `Entendi assim 👇\n\n👤 Paciente: ${cliente}\n💉 Procedimento: ${procedimento}\n💰 Valor total: ${valor}\n💳 Pagamento: ${pgto}\n\nEstá certo?\n\n1️⃣ Sim, pode registrar\n2️⃣ Corrigir`;

                } catch (err) {
                    console.error('Erro na simulacao Gemini:', err);
                    // Fallback visual
                    return `Entendi assim 👇\n\n👤 Paciente: Cliente Identificado\n💉 Procedimento: Procedimento\n💰 Valor total: R$ 0,00\n\nEstá certo?\n\n1️⃣ Sim, pode registrar\n2️⃣ Corrigir`;
                }

            case 'game_sim_confirm':
                if (messageLower.includes('sim') || messageLower.includes('pode') || messageLower.includes('1')) {
                    onboarding.step = 'game_mini_dash';
                    // Simula envio de imagem (opcional) ou texto
                    return `Pronto! Essa venda já entrou no seu financeiro.\n\nSe esse fosse seu mês de novembro, por exemplo, você veria algo assim:\n\n📊 *Resumo Financeiro*\n• Receitas: R$ 85.000\n• Custos: R$ 32.000\n• *Lucro: R$ 53.000 (62%)*\n\nTudo isso calculado automaticamente com base nas vendas e despesas que você manda pra mim.\n\nDigite "Uau" ou "Próximo" para continuar ✨`;
                } else {
                    onboarding.step = 'game_sim_venda';
                    return `Sem problemas. Digite a venda novamente:`;
                }

            case 'game_mini_dash':
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
