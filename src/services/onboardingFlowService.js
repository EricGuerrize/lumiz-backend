const onboardingService = require('./onboardingService');
const geminiService = require('./geminiService');

class OnboardingFlowService {
    constructor() {
        // Armazena dados de onboarding em andamento
        this.onboardingData = new Map();
    }

    maskCnpj(cnpj) {
        if (!cnpj) return null;
        return cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    }

    normalizeTeamRange(input) {
        if (!input) return null;
        const normalized = input.toString().trim().toLowerCase();

        const map = {
            '1': '1-5',
            '2': '6-10',
            '3': '11-20',
            '4': '20+',
            '1-5': '1-5',
            '1 a 5': '1-5',
            '6-10': '6-10',
            '6 a 10': '6-10',
            '11-20': '11-20',
            '11 a 20': '11-20',
            '20+': '20+',
            '20 +': '20+',
            '20 ou mais': '20+'
        };

        if (map[normalized]) {
            return map[normalized];
        }

        const number = parseInt(normalized, 10);
        if (Number.isNaN(number)) {
            return null;
        }
        if (number <= 5) return '1-5';
        if (number <= 10) return '6-10';
        if (number <= 20) return '11-20';
        return '20+';
    }

    normalizeVolumeRange(input) {
        if (!input) return null;
        const normalized = input.toString().trim().toLowerCase();

        const map = {
            '1': 'até 30',
            '2': '30-60',
            '3': '60-100',
            '4': '100+',
            'ate 30': 'até 30',
            'até 30': 'até 30',
            '30-60': '30-60',
            '60-100': '60-100',
            '100+': '100+',
            '100 +': '100+',
            '100 ou mais': '100+'
        };

        if (map[normalized]) {
            return map[normalized];
        }

        const number = parseInt(normalized, 10);
        if (Number.isNaN(number)) {
            return null;
        }
        if (number <= 30) return 'até 30';
        if (number <= 60) return '30-60';
        if (number <= 100) return '60-100';
        return '100+';
    }

    normalizeMdrChoice(input) {
        if (!input) return null;
        const normalized = input.toString().trim().toLowerCase();

        if (normalized === '1' || normalized.includes('configurar')) {
            return 'configurar_agora';
        }
        if (normalized === '2' || normalized.includes('lembrar')) {
            return 'lembrar_mais_tarde';
        }
        if (normalized === '3' || normalized.includes('nao uso') || normalized.includes('não uso')) {
            return 'nao_usa_maquininha';
        }
        return null;
    }

    getMdrChoiceMessage(choice) {
        switch (choice) {
            case 'configurar_agora':
                return 'Perfeito! Assim que finalizarmos, você pode cadastrar as taxas me enviando um print da maquininha que eu leio via OCR.';
            case 'lembrar_mais_tarde':
                return 'Sem problemas! Vou deixar anotado para te lembrar em outro momento.';
            case 'nao_usa_maquininha':
                return 'Tudo bem! Vou marcar aqui que você não utiliza maquininha/cartão.';
            default:
                return '';
        }
    }

    humanizeMdrChoice(choice) {
        switch (choice) {
            case 'configurar_agora':
                return 'Vai configurar agora';
            case 'lembrar_mais_tarde':
                return 'Lembrar mais tarde';
            case 'nao_usa_maquininha':
                return 'Não usa maquininha';
            default:
                return 'Não informado';
        }
    }

    async buildConfirmationMessage(phone, onboarding) {
        const linhas = [
            `👤 *Nome:* ${onboarding.data.nome_completo}`,
            `🏥 *Clínica:* ${onboarding.data.nome_clinica}`,
            `📱 *WhatsApp:* ${phone}`,
            `🧾 *CNPJ:* ${onboarding.data.cnpj
                ? this.maskCnpj(onboarding.data.cnpj)
                : onboarding.data.cnpj_status === 'skipped'
                    ? 'Prefere informar depois'
                    : 'Não informado'
            }`,
            `👥 *Equipe:* ${onboarding.data.team_size_range || 'Não informado'}`,
            `📈 *Volume mensal:* ${onboarding.data.volume_range || 'Não informado'}`,
            `💳 *Taxas MDR:* ${this.humanizeMdrChoice(onboarding.data.mdr_choice)}`
        ];

        const progressLabel = await onboardingService.getProgressLabel(phone);
        const progressText = progressLabel ? `\n${progressLabel}\n` : '';

        return `Perfeito! Confirma os dados antes de criar sua conta:\n\n${linhas.join('\n')}\n${progressText}\nTá tudo certo? Responde *SIM* pra criar ou *NÃO* pra ajustar.`;
    }

    isOnboarding(phone) {
        return this.onboardingData.has(phone);
    }

    getOnboardingStep(phone) {
        const data = this.onboardingData.get(phone);
        return data ? data.step : null;
    }

    async startOnboarding(phone) {
        this.onboardingData.set(phone, {
            step: 'nome_completo',
            data: {
                telefone: phone,
                cnpj_status: 'pending'
            },
            timestamp: Date.now()
        });

        try {
            await onboardingService.ensureState(phone, null, {
                stage: 'phase1',
                channel: 'whatsapp',
                abVariant: 'whatsapp_v1'
            });
            await onboardingService.updateStepStatus(phone, 'phase1_welcome', 'completed', {
                channel: 'whatsapp'
            });
        } catch (error) {
            console.error('Erro ao iniciar progresso de onboarding:', error);
        }
    }

    async startNewOnboarding(phone) {
        this.onboardingData.set(phone, {
            step: 'nome_clinica',
            data: {
                telefone: phone,
                primeira_venda: null,
                primeiro_custo: null,
                segundo_custo: null
            },
            timestamp: Date.now()
        });

        try {
            await onboardingService.ensureState(phone, null, {
                stage: 'phase1',
                channel: 'whatsapp',
                abVariant: 'whatsapp_v2'
            });
            await onboardingService.updateStepStatus(phone, 'phase1_welcome', 'completed', {
                channel: 'whatsapp'
            });
        } catch (error) {
            console.error('Erro ao iniciar novo onboarding:', error);
        }
    }

    async processOnboarding(phone, message) {
        const onboarding = this.onboardingData.get(phone);
        if (!onboarding) return null;

        const messageTrimmed = message.trim();

        // Importa userController sob demanda para evitar dependência circular
        // O userController será usado apenas para finalizar o cadastro
        const userController = require('../controllers/userController');

        switch (onboarding.step) {
            // ========== NOVO FLUXO DE ONBOARDING (TESTE GRATUITO) ==========
            case 'nome_clinica': {
                // Verifica se é novo fluxo (tem primeira_venda no data)
                if (onboarding.data.primeira_venda !== undefined) {
                    // Novo fluxo
                    if (messageTrimmed.length < 2) {
                        return 'Por favor, digite o nome da sua clínica.';
                    }
                    onboarding.data.nome_clinica = messageTrimmed;
                    onboarding.step = 'nome_completo';
                    return `Perfeito! 😄\n\nE qual o seu nome mesmo? Vou te chamar direitinho aqui 😉`;
                }
                // Fallthrough para fluxo antigo
            }

            case 'nome_completo': {
                // Verifica se é novo fluxo
                if (onboarding.data.primeira_venda !== undefined && onboarding.step === 'nome_completo') {
                    // Novo fluxo
                    if (messageTrimmed.length < 3) {
                        return 'Por favor, digite seu nome (mínimo 3 caracteres).';
                    }
                    onboarding.data.nome_completo = messageTrimmed;
                    onboarding.step = 'vendas_mes';
                    return `Prazer, ${messageTrimmed.split(' ')[0]}! 😊\n\nAgora me diz:\n\nEm média, quantas vendas você faz por mês?`;
                }
                // Fallthrough para fluxo antigo
                if (messageTrimmed.length < 3) {
                    return 'Por favor, digite seu nome completo (mínimo 3 caracteres).';
                }
                onboarding.data.nome_completo = messageTrimmed;
                onboarding.step = 'nome_clinica_legacy'; // Mudança de nome para evitar conflito
                return 'Qual o nome da sua clínica?';
            }

            case 'nome_clinica_legacy': {
                if (messageTrimmed.length < 2) {
                    return 'Por favor, digite o nome da clínica.';
                }
                onboarding.data.nome_clinica = messageTrimmed;
                onboarding.step = 'cnpj';
                return 'Qual o CNPJ da clínica? (Digite apenas números ou "pular" se preferir informar depois)';
            }

            // Steps 'funcao' and 'formas_pagamento' removed as per user request to streamline onboarding.

            case 'vendas_mes': {
                const vendas = parseInt(messageTrimmed);
                if (isNaN(vendas) || vendas < 0) {
                    return 'Por favor, digite um número válido de vendas por mês.';
                }
                onboarding.data.vendas_mes = vendas;
                onboarding.step = 'primeira_venda';
                return `Legal, já entendi seu perfil! Agora vou te mostrar na prática como eu organizo seu financeiro em segundos. Vamos lá? 🚀\n\nMe envie uma venda da sua clínica, do jeitinho que você falaria para um amigo.`;
            }

            case 'primeira_venda': {
                // Verifica se pediu exemplo
                if (messageTrimmed.toLowerCase().includes('exemplo')) {
                    return `Pode ser assim:\n\n"Júlia fez um full face com 12ml, usamos 10 Biogelis volume e 1 Juvederm. Total 15.600, pagou 3.000 no PIX e o resto em 6x no cartão."\n\nEu entendo tudo automaticamente.`;
                }

                // Processa a venda usando geminiService
                const intent = await geminiService.processMessage(messageTrimmed, {});

                if (intent.intencao === 'registrar_entrada' && intent.dados?.valor) {
                    // Salva a primeira venda
                    onboarding.data.primeira_venda = intent.dados;
                    onboarding.step = 'primeiro_custo';

                    // Confirma a venda
                    const valor = intent.dados.valor.toFixed(2);
                    const categoria = intent.dados.categoria || 'Procedimento';
                    let confirmacao = `Entrada registrada! 🟣\n\n`;
                    confirmacao += `• Valor: R$ ${valor}\n`;
                    confirmacao += `• Categoria: ${categoria}\n`;
                    if (intent.dados.nome_cliente) {
                        confirmacao += `• Cliente: ${intent.dados.nome_cliente}\n`;
                    }
                    confirmacao += `\nAgora que já sei quanto entrou, bora ver o outro lado do financeiro?\n\nMe envie agora um custo da sua clínica — pode ser algo simples como uma compra de insumo, produto ou maquininha. Se quiser, pode mandar foto do boleto, PDF, nota fiscal ou até um texto.`;

                    return confirmacao;
                } else {
                    // Fallback Momento WOW
                    return `Ops, li errado? 😅 Pode digitar o valor e a descrição corretos pra mim? Prometo aprender pro próximo!\n\nExemplo: "Botox 2800 cliente Maria"`;
                }
            }

            case 'primeiro_custo': {
                // Processa o custo usando geminiService
                const intent = await geminiService.processMessage(messageTrimmed, {});

                if (intent.intencao === 'registrar_saida' && intent.dados?.valor) {
                    onboarding.data.primeiro_custo = intent.dados;

                    // Verifica se precisa perguntar sobre parcelamento
                    if (!intent.dados.parcelas && intent.dados.forma_pagamento === 'parcelado') {
                        onboarding.step = 'primeiro_custo_parcelas';
                        return `Vi que você mencionou parcelamento. Em quantas vezes foi parcelado?`;
                    }

                    // Mostra resumo e pergunta se é fixo ou variável
                    onboarding.step = 'primeiro_custo_tipo';
                    const valor = intent.dados.valor.toFixed(2);
                    const categoria = intent.dados.categoria || intent.dados.descricao || 'Custo';
                    const quantidade = intent.dados.quantidade ? ` • Quantidade: ${intent.dados.quantidade} unidades` : '';
                    const pagamento = intent.dados.forma_pagamento === 'parcelado' && intent.dados.parcelas
                        ? `${intent.dados.parcelas}x no Cartão`
                        : intent.dados.forma_pagamento === 'pix' ? 'PIX'
                            : intent.dados.forma_pagamento === 'dinheiro' ? 'Dinheiro'
                                : 'Cartão';

                    let resumo = `Show! Aqui está o que registrei:\n\n`;
                    resumo += `• Descrição: ${categoria}${quantidade}\n`;
                    resumo += `• Valor: R$ ${valor}\n`;
                    resumo += `• Pagamento: ${pagamento}\n`;
                    resumo += `• Categoria sugerida: Compra de insumo\n\n`;
                    resumo += `Agora me diz: esse custo é fixo ou variável?\n\nDigite 1 para Variável ou 2 para Fixo`;

                    return resumo;
                } else {
                    return `Ops, li errado? 😅 Pode digitar o valor e a descrição corretos pra mim? Prometo aprender pro próximo!\n\nExemplo: "Comprei 6 frascos de Biogeli, paguei 1.800 no cartão."`;
                }
            }

            case 'primeiro_custo_parcelas': {
                const parcelas = parseInt(messageTrimmed);
                if (isNaN(parcelas) || parcelas < 1) {
                    return 'Por favor, digite o número de parcelas.';
                }
                onboarding.data.primeiro_custo.parcelas = parcelas;
                onboarding.step = 'primeiro_custo_tipo';

                const valor = onboarding.data.primeiro_custo.valor.toFixed(2);
                const categoria = onboarding.data.primeiro_custo.categoria || onboarding.data.primeiro_custo.descricao || 'Custo';
                const quantidade = onboarding.data.primeiro_custo.quantidade ? ` • Quantidade: ${onboarding.data.primeiro_custo.quantidade} unidades` : '';

                let resumo = `Show! Aqui está o que registrei:\n\n`;
                resumo += `• Descrição: ${categoria}${quantidade}\n`;
                resumo += `• Valor: R$ ${valor}\n`;
                resumo += `• Pagamento: ${parcelas}x no Cartão\n`;
                resumo += `• Categoria sugerida: Compra de insumo\n\n`;
                resumo += `Agora me diz: esse custo é fixo ou variável?\n\nDigite 1 para Variável ou 2 para Fixo`;

                return resumo;
            }

            case 'primeiro_custo_tipo': {
                const tipoNum = parseInt(messageTrimmed);
                if (tipoNum === 1) {
                    onboarding.data.primeiro_custo.tipo_custo = 'variável';
                } else if (tipoNum === 2) {
                    onboarding.data.primeiro_custo.tipo_custo = 'fixo';
                } else {
                    return 'Por favor, digite 1 para Variável ou 2 para Fixo.';
                }

                onboarding.step = 'segundo_custo';
                return `Entendido! Agora pra fechar:\n\nMe fala um custo fixo que você paga todo mês (tipo aluguel, internet, sistema, contador).\n\nSe não lembrar agora, pode digitar "pular".`;
            }

            case 'segundo_custo': {
                if (messageTrimmed.toLowerCase().includes('pular')) {
                    onboarding.data.segundo_custo = null;
                    // Pula direto para o final
                    return this.finalizeOnboarding(phone, onboarding, userController);
                }

                const intent = await geminiService.processMessage(messageTrimmed, {});

                if (intent.intencao === 'registrar_saida' && intent.dados?.valor) {
                    onboarding.data.segundo_custo = intent.dados;
                    onboarding.data.segundo_custo.tipo_custo = 'fixo'; // Assume fixo pois foi a pergunta

                    // Mostra resumo e confirma
                    onboarding.step = 'segundo_custo_confirmacao';
                    const valor = intent.dados.valor.toFixed(2);
                    const categoria = intent.dados.categoria || intent.dados.descricao || 'Custo Fixo';

                    let resumo = `Anotei aqui:\n\n`;
                    resumo += `• ${categoria}: R$ ${valor} (Fixo)\n\n`;
                    resumo += `Confirma? (Sim/Não)`;

                    return resumo;
                } else {
                    return `Ops, não entendi. Pode digitar o valor e o nome do custo? Ex: "Aluguel 2000" ou digite "pular".`;
                }
            }

            case 'segundo_custo_confirmacao': {
                if (messageTrimmed.toLowerCase().includes('s') || messageTrimmed.toLowerCase().includes('ok')) {
                    // Finaliza
                    return this.finalizeOnboarding(phone, onboarding, userController);
                } else {
                    onboarding.step = 'segundo_custo';
                    return 'Sem problemas, me manda de novo o custo fixo (ou "pular").';
                }
            }

            // ========== FLUXO ANTIGO (LEGACY) ==========
            case 'cnpj': {
                if (messageTrimmed.toLowerCase().includes('pular')) {
                    onboarding.data.cnpj_status = 'skipped';
                    onboarding.step = 'team_size';
                    return 'Sem problemas! Quantas pessoas trabalham na clínica hoje?';
                }

                const cnpjLimpo = messageTrimmed.replace(/\D/g, '');
                if (cnpjLimpo.length !== 14) {
                    return 'CNPJ parece inválido. Digite apenas os 14 números ou "pular".';
                }

                onboarding.data.cnpj = cnpjLimpo;
                onboarding.data.cnpj_status = 'provided';
                onboarding.step = 'team_size';
                return 'Anotado! Quantas pessoas trabalham na clínica hoje?';
            }

            case 'team_size': {
                const range = this.normalizeTeamRange(messageTrimmed);
                if (!range) {
                    return 'Por favor, escolha uma opção:\n1. 1-5 pessoas\n2. 6-10 pessoas\n3. 11-20 pessoas\n4. Mais de 20';
                }
                onboarding.data.team_size_range = range;
                onboarding.step = 'volume_mensal';
                return 'Qual a média de atendimentos por mês?\n1. Até 30\n2. 30 a 60\n3. 60 a 100\n4. Mais de 100';
            }

            case 'volume_mensal': {
                const range = this.normalizeVolumeRange(messageTrimmed);
                if (!range) {
                    return 'Por favor, escolha uma opção:\n1. Até 30\n2. 30 a 60\n3. 60 a 100\n4. Mais de 100';
                }
                onboarding.data.volume_range = range;
                onboarding.step = 'mdr_setup';
                return 'Sobre as taxas da maquininha de cartão:\n1. Quero configurar agora (recomendado)\n2. Me lembre mais tarde\n3. Não uso maquininha';
            }

            case 'mdr_setup': {
                const choice = this.normalizeMdrChoice(messageTrimmed);
                if (!choice) {
                    return 'Por favor, escolha uma opção:\n1. Configurar agora\n2. Lembrar depois\n3. Não uso';
                }
                onboarding.data.mdr_choice = choice;
                onboarding.step = 'confirmacao';

                const msgMdr = this.getMdrChoiceMessage(choice);
                const confirmacao = await this.buildConfirmationMessage(phone, onboarding);
                return `${msgMdr}\n\n${confirmacao}`;
            }

            case 'confirmacao': {
                if (messageTrimmed.toLowerCase().includes('sim') || messageTrimmed.toLowerCase().includes('s')) {
                    // Cria o usuário e finaliza (Fluxo Antigo)
                    try {
                        // Usa userController para criar usuário
                        const result = await userController.createUserFromOnboarding(onboarding.data);

                        // Cria procedimentos padrão
                        await userController.createDefaultProcedimentos(result.user.id);

                        try {
                            await onboardingService.updateState(phone, {
                                userId: result.user.id,
                                stage: 'phase3',
                                phase: 3,
                                data: {
                                    phase3: {
                                        onboarding_completed_at: new Date().toISOString(),
                                        assistant_persona: 'lumiz_whatsapp'
                                    }
                                }
                            });
                            await onboardingService.updateStepStatus(phone, 'phase3_whatsapp', 'completed', {
                                channel: 'whatsapp'
                            });
                            await onboardingService.markCompleted(phone);
                        } catch (progressError) {
                            console.error('Erro ao finalizar progresso do onboarding:', progressError);
                        }

                        this.onboardingData.delete(phone);

                        let finalMsg = `Cadastro realizado com sucesso! 🎉\n\n`;
                        finalMsg += `Agora você já pode começar a usar.\n\n`;
                        finalMsg += `Para acessar o painel completo e ver seus gráficos:\n${result.registrationLink}\n\n`;
                        finalMsg += `Ou pode me mandar aqui mesmo:\n_"Vendi um botox por 1500"_\n_"Gastei 200 com luvas"_`;

                        return finalMsg;
                    } catch (error) {
                        console.error('Erro ao criar usuário:', error);
                        this.onboardingData.delete(phone);
                        return `Erro ao criar cadastro 😢\n\n${error.message}\n\nTente novamente enviando qualquer mensagem.`;
                    }
                } else {
                    // Reinicia
                    this.onboardingData.delete(phone);
                    return 'Tudo bem, cancelamos o cadastro. Quando quiser recomeçar, é só mandar um "Oi"!';
                }
            }

            default:
                return 'Ops, me perdi aqui. Vamos recomeçar? Mande um "Oi".';
        }
    }

    async finalizeOnboarding(phone, onboarding, userController) {
        try {
            const result = await userController.createUserFromOnboarding(onboarding.data);

            // Salva as transações registradas durante o onboarding
            await userController.saveOnboardingTransactions(result.user.id, onboarding.data);

            // Cria procedimentos padrão
            await userController.createDefaultProcedimentos(result.user.id);

            try {
                await onboardingService.updateState(phone, {
                    userId: result.user.id,
                    stage: 'phase3',
                    phase: 3,
                    data: {
                        phase3: {
                            onboarding_completed_at: new Date().toISOString(),
                            assistant_persona: 'lumiz_whatsapp'
                        }
                    }
                });
                await onboardingService.updateStepStatus(phone, 'phase3_whatsapp', 'completed', {
                    channel: 'whatsapp'
                });
                await onboardingService.markCompleted(phone);
            } catch (progressError) {
                console.error('Erro ao finalizar progresso do onboarding:', progressError);
            }

            const resumo = await userController.buildResumoFinal(phone, onboarding, result.registrationLink);
            this.onboardingData.delete(phone);

            return resumo;
        } catch (error) {
            console.error('Erro ao criar usuário:', error);
            this.onboardingData.delete(phone);
            return `Erro ao criar cadastro 😢\n\n${error.message}\n\nTente novamente enviando qualquer mensagem.`;
        }
    }
}

module.exports = new OnboardingFlowService();
