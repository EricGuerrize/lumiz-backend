const onboardingService = require('./onboardingService');
const geminiService = require('./geminiService');
const onboardingCopy = require('../copy/onboardingWhatsappCopy');
const analyticsService = require('./analyticsService');
const { normalizePhone } = require('../utils/phone');

function normalizeText(value = '') {
    return String(value).trim().toLowerCase();
}

function isYes(value = '') {
    const v = normalizeText(value);
    return v === '1' || v === 'sim' || v === 's' || v === 'ok' || v === 'confirmar' || v.includes('pode registrar');
}

function isNo(value = '') {
    const v = normalizeText(value);
    return v === '2' || v === 'nao' || v === 'não' || v === 'n' || v === 'cancelar' || v.includes('corrigir');
}

function looksLikeEmail(value = '') {
    const v = String(value).trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function extractNameAndDoc(raw = '') {
    const digits = String(raw).replace(/\D/g, '');
    // Remove números e sinais comuns para sobrar o "nome"
    const name = String(raw)
        .replace(/[0-9]/g, '')
        .replace(/[-–—•·|/\\]/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

    return {
        name: name.length >= 3 ? name : null,
        doc: digits.length >= 11 ? digits : null
    };
}

function parseBrazilianNumber(raw) {
    if (!raw) return null;
    const str = String(raw).trim();
    // Remove currency and spaces
    const cleaned = str.replace(/r\$\s*/gi, '').replace(/\s/g, '');

    // If format looks like 1.234,56 -> remove thousand dots and replace comma
    if (/\d+\.\d{3}(?:\.\d{3})*,\d{2}$/.test(cleaned)) {
        const normalized = cleaned.replace(/\./g, '').replace(',', '.');
        const n = parseFloat(normalized);
        return Number.isFinite(n) ? n : null;
    }

    // If format looks like 1,234.56 (unlikely in PT-BR) -> remove commas as thousands
    if (/\d+,\d{3}(?:,\d{3})*\.\d{2}$/.test(cleaned)) {
        const normalized = cleaned.replace(/,/g, '');
        const n = parseFloat(normalized);
        return Number.isFinite(n) ? n : null;
    }

    // If has comma decimal
    if (/,\d{1,2}$/.test(cleaned)) {
        const normalized = cleaned.replace(/\./g, '').replace(',', '.');
        const n = parseFloat(normalized);
        return Number.isFinite(n) ? n : null;
    }

    // Default: strip thousands separators and parse
    const normalized = cleaned.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(normalized);
    return Number.isFinite(n) ? n : null;
}

function extractBestAmountFromText(text = '') {
    const raw = String(text);

    // 1) Prefer explicit currency marker
    const currencyMatch = raw.match(/r\$\s*([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})?|[0-9]+(?:[.,][0-9]{2})?)/i);
    if (currencyMatch && currencyMatch[1]) {
        const value = parseBrazilianNumber(currencyMatch[1]);
        if (value && value > 0) return value;
    }

    // 2) Otherwise pick the "largest plausible" number in the text (ignore years and units)
    const matches = [...raw.matchAll(/(\d+(?:[.,]\d+)?)/g)].map((m) => m[1]);
    const candidates = matches
        .map((m) => parseBrazilianNumber(m))
        .filter((n) => Number.isFinite(n) && n > 0)
        .filter((n) => !(n >= 1900 && n <= 2100)); // likely year

    if (!candidates.length) return null;
    return Math.max(...candidates);
}

function extractSaleHeuristics(text = '') {
    const raw = String(text).trim();
    const lower = raw.toLowerCase();

    // cliente: "Júlia fez ..." / "Maria pagou ..." (até 3 palavras)
    let paciente = null;
    const nameMatch = raw.match(/^([A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){0,2})\s+(fez|pagou|comprou|atendeu|realizou)\b/i);
    if (nameMatch && nameMatch[1]) {
        paciente = nameMatch[1].trim();
    }

    // procedimento: trecho depois de "fez/realizou/atendeu" até separador
    let procedimento = null;
    const procMatch = raw.match(/\b(fez|realizou|atendeu)\b\s+(?:um|uma|o|a)?\s*([^,]+?)(?:,|\s+pagou|\s+por|\s+r\$|\s+R\$|\s+\d)/i);
    if (procMatch && procMatch[2]) {
        procedimento = procMatch[2].trim();
    }

    // pagamento
    let forma_pagamento = null;
    let parcelas = null;
    if (lower.includes('pix')) forma_pagamento = 'pix';
    else if (lower.includes('dinheiro')) forma_pagamento = 'dinheiro';
    else if (lower.includes('débito') || lower.includes('debito')) forma_pagamento = 'debito';
    else if (lower.includes('cartão') || lower.includes('cartao') || lower.includes('crédito') || lower.includes('credito')) {
        // tenta extrair "6x" etc
        const px = raw.match(/(\d{1,2})\s*x\b/i);
        if (px && px[1]) {
            forma_pagamento = 'parcelado';
            parcelas = parseInt(px[1], 10);
        } else {
            forma_pagamento = 'credito_avista';
        }
    }

    return { paciente, procedimento, forma_pagamento, parcelas };
}

class OnboardingFlowService {
    constructor() {
        // Armazena dados de onboarding em andamento
        this.onboardingStates = new Map();
        // Maintain alias for compatibility if any old code checks 'onboardingData'
        this.onboardingData = this.onboardingStates;
    }

    isOnboarding(phone) {
        const normalizedPhone = normalizePhone(phone) || phone;
        return this.onboardingStates.has(normalizedPhone);
    }

    getOnboardingStep(phone) {
        const normalizedPhone = normalizePhone(phone) || phone;
        const data = this.onboardingStates.get(normalizedPhone);
        return data ? data.step : null;
    }

    // Inicia o fluxo simplificado de introdução (Vídeo + Convite)
    async startIntroFlow(phone) {
        // Normaliza telefone para garantir consistência
        const normalizedPhone = normalizePhone(phone) || phone;
        
        // Tenta retomar um onboarding persistido (pós-restart)
        try {
            const persisted = await onboardingService.getWhatsappState(normalizedPhone);
            if (persisted?.step) {
                this.onboardingStates.set(normalizedPhone, {
                    step: persisted.step,
                    startTime: persisted.startTime || Date.now(),
                    data: persisted.data || { telefone: normalizedPhone }
                });
                await analyticsService.track('onboarding_whatsapp_resumed', {
                    phone: normalizedPhone,
                    userId: persisted?.data?.userId || null,
                    source: 'whatsapp',
                    properties: { step: persisted.step }
                });
                return this.getPromptForStep(normalizedPhone);
            }
        } catch (e) {
            console.error('[ONBOARDING] Falha ao carregar estado persistido (não crítico):', e?.message || e);
        }

        // 1. Define estado inicial (novo)
        this.onboardingStates.set(normalizedPhone, {
            step: 'flow0_choice',
            startTime: Date.now(),
            data: {
                telefone: normalizedPhone // CRITICAL: Salva o telefone para usar no cadastro
            }
        });
        await analyticsService.track('onboarding_whatsapp_started', {
            phone: normalizedPhone,
            source: 'whatsapp'
        });

        const evolutionService = require('./evolutionService');

        // Mensagem inicial no estilo "oiBill" (sem botões → opções por texto)
        if (process.env.NODE_ENV !== 'test') {
            try {
                await evolutionService.sendMessage(normalizedPhone, onboardingCopy.introGreeting());
            } catch (e) {
                console.error('[ONBOARDING] Falha ao enviar mensagem inicial (não crítico):', e?.message || e);
            }
        }

        return onboardingCopy.entryMenu();
    }

    getPromptForStep(phone) {
        const normalizedPhone = normalizePhone(phone) || phone;
        const onboarding = this.onboardingStates.get(normalizedPhone);
        if (!onboarding) return null;

        switch (onboarding.step) {
            case 'flow0_choice':
                return onboardingCopy.entryMenu();
            case 'reg_step_1_type':
                return onboardingCopy.clinicTypeQuestion({ withProgress: true });
            case 'reg_step_2_name':
                return onboardingCopy.clinicNameQuestion();
            case 'reg_step_3_city':
                return onboardingCopy.clinicCityQuestion();
            case 'reg_step_4_owner':
                return onboardingCopy.ownerQuestion();
            case 'reg_step_full_email':
                return onboardingCopy.emailQuestion();
            case 'reg_step_full_whatsapp':
                return onboardingCopy.whatsappQuestion();
            case 'game_sale_request':
                return onboardingCopy.fakeSalePrompt();
            case 'game_sale_review':
                return onboardingCopy.fakeSaleAskAgain();
            case 'game_sale_confirm': {
                const sale = onboarding?.data?.test_sale;
                if (sale?.valor) {
                    const paymentLine = (() => {
                        if (sale.forma_pagamento === 'parcelado' && sale.parcelas) return `Cartão – ${sale.parcelas}x`;
                        if (sale.forma_pagamento === 'pix') return 'PIX';
                        if (sale.forma_pagamento === 'dinheiro') return 'Dinheiro';
                        if (sale.forma_pagamento === 'debito') return 'Débito';
                        if (sale.forma_pagamento === 'credito_avista') return 'Crédito à vista';
                        return 'Não informado';
                    })();
                    return onboardingCopy.fakeSaleReview({
                        cliente: sale.paciente,
                        procedimento: sale.procedimento,
                        valor: sale.valor,
                        pagamentoLabel: paymentLine
                    });
                }
                return onboardingCopy.fakeSaleAskAgain();
            }
            default:
                return onboardingCopy.entryMenu();
        }
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
        // Normaliza telefone para garantir consistência
        const normalizedPhone = normalizePhone(phone) || phone;
        const onboarding = this.onboardingStates.get(normalizedPhone); // Use onboardingStates consistently
        if (!onboarding) return null;

        const messageTrimmed = message.trim();
        const messageLower = messageTrimmed.toLowerCase();
        const userController = require('../controllers/userController');
        const evolutionService = require('./evolutionService');
        const geminiService = require('./geminiService'); // Certifique-se de importar

        const persistState = async () => {
            try {
                await onboardingService.upsertWhatsappState(normalizedPhone, {
                    step: onboarding.step,
                    data: onboarding.data
                });
            } catch (e) {
                console.error('[ONBOARDING] Falha ao persistir estado (não crítico):', e?.message || e);
            }
        };

        const respond = async (text) => {
            await persistState();
            return text;
        };

        const respondAndClear = async (text) => {
            try {
                await onboardingService.clearWhatsappState(normalizedPhone);
            } catch (e) {
                console.error('[ONBOARDING] Falha ao limpar estado persistido (não crítico):', e?.message || e);
            }
            this.onboardingStates.delete(normalizedPhone);
            await analyticsService.track('onboarding_whatsapp_completed', {
                phone: normalizedPhone,
                userId: onboarding?.data?.userId || null,
                source: 'whatsapp',
                properties: { step: onboarding?.step || null }
            });
            return text;
        };

        // Escape hatch global
        if (
            messageLower.includes('ajuda') ||
            messageLower.includes('falar com') ||
            messageLower.includes('humano') ||
            messageLower.includes('não sei') ||
            messageLower.includes('nao sei') ||
            messageLower.includes('tá complicado') ||
            messageLower.includes('ta complicado')
        ) {
            return await respond(onboardingCopy.escalateToHuman());
        }

        switch (onboarding.step) {
            // =================================================================
            // 0. INTRODUÇÃO & TESTE (Novo Fluxo)
            // =================================================================
            case 'flow0_choice': {
                const v = normalizeText(messageTrimmed);
                const choseUnderstand =
                    v === '1' ||
                    v.includes('entender') ||
                    v.includes('como funciona') ||
                    v.includes('quero saber mais') ||
                    v.includes('saber mais');

                const choseRegister =
                    v === '2' ||
                    v.includes('cadastro') ||
                    v.includes('começar') ||
                    v.includes('comecar');

                if (choseUnderstand) {
                    // Sem opções extras: explica e já puxa o cadastro
                    onboarding.step = 'reg_step_1_type';
                    return await respond(onboardingCopy.explainAndStartCadastro());
                }

                if (choseRegister) {
                    onboarding.step = 'reg_step_1_type';
                    return await respond(onboardingCopy.clinicTypeQuestion({ withProgress: true }));
                }

                return await respond(onboardingCopy.invalidEntryChoice());
            }

            // Compat (caso algum usuário fique preso num estado antigo)
            case 'flow1_choice': {
                const v = normalizeText(messageTrimmed);
                const later = v === '2' || v.includes('depois') || v.includes('olhar');

                if (later) {
                    return await respondAndClear(
                        `Sem problemas 😊\n\n` +
                        `Quando quiser, é só mandar: *Começar com a Lumiz* (ou *Começar meu cadastro*) que eu continuo.`
                    );
                }

                onboarding.step = 'reg_step_1_type';
                return await respond(
                    `Pronto 😊\n\n` +
                    `Etapa 1 de 4 ✅\n` +
                    `Qual é o tipo da sua clínica?\n\n` +
                    `1️⃣ Clínica de estética\n` +
                    `2️⃣ Clínica odontológica\n` +
                    `3️⃣ Outros procedimentos`
                );
            }

            // =================================================================
            // 2. CADASTRO DA CLÍNICA (Mantido, mas agora vem DEPOIS do teste)
            // =================================================================
            case 'reg_step_1_type':
                // Validação simples: se não bater em nenhuma opção, pede novamente
                if (
                    !messageLower.includes('1') &&
                    !messageLower.includes('2') &&
                    !messageLower.includes('3') &&
                    !messageLower.includes('estetica') &&
                    !messageLower.includes('estética') &&
                    !messageLower.includes('odonto') &&
                    !messageLower.includes('odont') &&
                    !messageLower.includes('outro')
                ) {
                    return await respond(
                        `Só pra eu te ajudar certinho 😊\n\n` +
                        onboardingCopy.clinicTypeQuestion({ withProgress: true })
                    );
                }

                let type = 'Outros';
                if (messageLower.includes('1') || messageLower.includes('estetica') || messageLower.includes('estética')) type = 'Estética';
                else if (messageLower.includes('2') || messageLower.includes('odonto') || messageLower.includes('odont')) type = 'Odontologia';

                onboarding.data.tipo_clinica = type;
                onboarding.step = 'reg_step_2_name';
                return await respond(onboardingCopy.clinicNameQuestion());

            case 'reg_step_2_name':
                if (messageTrimmed.length < 2) return await respond('Nome muito curto. Digite novamente:');
                onboarding.data.nome_clinica = messageTrimmed;
                onboarding.step = 'reg_step_3_city';
                return await respond(onboardingCopy.clinicCityQuestion());

            case 'reg_step_3_city':
                if (messageTrimmed.length < 3) return await respond('Digite cidade e estado, por favor.');
                onboarding.data.cidade = messageTrimmed;
                onboarding.step = 'reg_step_4_owner';
                return await respond(onboardingCopy.ownerQuestion());

            case 'reg_step_4_owner':
                // Validação de CPF/CNPJ (Básica: números suficientes)
                const numeros = messageTrimmed.replace(/\D/g, '');
                if (numeros.length < 11) {
                    return await respond(
                        'Ops! Preciso do *nome completo* + *CPF/CNPJ* (pode mandar só os números do documento).\n\n' +
                        'Exemplo: *Maria da Silva 12345678909*'
                    );
                }
                if (messageTrimmed.length < 5) return await respond('Preciso de um nome válido também.');

                onboarding.data.responsavel_info = messageTrimmed;
                // Extrai nome + doc para usar no perfil
                const extracted = extractNameAndDoc(messageTrimmed);
                onboarding.data.nome_completo = extracted.name || onboarding.data.nome_completo || null;
                onboarding.data.cpf_cnpj = extracted.doc || onboarding.data.cpf_cnpj || numeros;

                onboarding.step = 'reg_step_full_email';
                return await respond(onboardingCopy.emailQuestion());

            // =================================================================
            // 2.1 CADASTRO COMPLETO (SÓ SE ESCOLHER COMPLETAR)
            // =================================================================
            case 'reg_step_full_email':
                if (!looksLikeEmail(messageTrimmed)) {
                    return await respond('Esse email parece inválido 🤔\n\nMe manda no formato: *nome@dominio.com*');
                }
                onboarding.data.email = messageTrimmed;
                onboarding.step = 'reg_step_full_whatsapp';
                return await respond(onboardingCopy.whatsappQuestion());

            case 'reg_step_full_whatsapp':
                if (messageLower.includes('este') || messageLower.includes('atual') || messageLower.includes('mesmo')) {
                    onboarding.data.whatsapp = onboarding.data.telefone;
                } else {
                    const digits = messageTrimmed.replace(/\D/g, '');
                    // Validação melhorada: precisa ter DDD (2 dígitos) + número (8 ou 9 dígitos)
                    if (digits.length < 10 || digits.length > 11) {
                        return await respond(
                            `Esse WhatsApp parece inválido 🤔\n\n` +
                            `Me manda com DDD + número, tipo: *11999999999* (10 ou 11 dígitos)\n` +
                            `Ou digite *este* pra usar o número atual.`
                        );
                    }
                    // Normaliza o WhatsApp também
                    const normalizedWhatsapp = normalizePhone(messageTrimmed) || messageTrimmed;
                    onboarding.data.whatsapp = normalizedWhatsapp;
                }
                try {
                    const result = await userController.createUserFromOnboarding(onboarding.data);
                    onboarding.data.userId = result.user.id;

                    // Pós-cadastro → gamificado (no estilo do documento)
                    onboarding.step = 'game_sale_request';
                    return await respond(onboardingCopy.cadastroOkAskFakeSale());

                } catch (e) {
                    // Não trava o onboarding por falha pontual de cadastro.
                    console.error('[ONBOARDING] Erro ao criar cadastro (seguindo com demo):', e);
                    onboarding.step = 'game_sale_request';
                    return await respond(onboardingCopy.cadastroSoftFailAskFakeSale());
                }

            // =================================================================
            // 3. ONBOARDING GAMIFICADO
            // =================================================================
            case 'game_sale_request': {
                // Esse estado existe apenas como "prompt". Se o usuário já mandou a venda aqui,
                // não podemos perder a mensagem — então reaproveitamos o mesmo input.
                onboarding.step = 'game_sale_review';
                await persistState();
                // CRÍTICO: Usa normalizedPhone para manter consistência
                return await this.processOnboarding(normalizedPhone, messageTrimmed);
            }

            case 'game_sale_review': {
                // Tenta interpretar como "registrar_entrada" (sem salvar de verdade)
                let sale = null;
                if (process.env.NODE_ENV !== 'test' && process.env.GEMINI_API_KEY) {
                    try {
                        const intent = await geminiService.processMessage(messageTrimmed, {
                            recentMessages: [],
                            similarExamples: []
                        });

                        if (intent?.intencao === 'registrar_entrada' && intent?.dados?.valor) {
                            sale = {
                                paciente: intent.dados.nome_cliente || intent.dados.cliente || null,
                                procedimento: intent.dados.categoria || intent.dados.descricao || null,
                                valor: intent.dados.valor,
                                forma_pagamento: intent.dados.forma_pagamento || null,
                                parcelas: intent.dados.parcelas || null,
                                bandeira_cartao: intent.dados.bandeira_cartao || null
                            };
                        }
                    } catch (e) {
                        // Se falhar, cai no fallback simples
                        console.error('[ONBOARDING] Erro ao interpretar venda fictícia:', e);
                    }
                }

                if (!sale) {
                    // Fallback: heurísticas locais (sem IA) para não depender de rede
                    const valor = extractBestAmountFromText(messageTrimmed);
                    if (!valor || Number.isNaN(valor) || valor <= 0) {
                        return await respond(
                            `Não consegui identificar o *valor* dessa venda 🤔\n\n` +
                            `Tenta nesse formato:\n` +
                            `*"Júlia fez um full face, pagou R$ 5000 no cartão em 6x"*`
                        );
                    }
                    const heur = extractSaleHeuristics(messageTrimmed);
                    sale = {
                        paciente: heur.paciente,
                        procedimento: heur.procedimento,
                        valor,
                        forma_pagamento: heur.forma_pagamento,
                        parcelas: heur.parcelas,
                        bandeira_cartao: null
                    };
                }

                onboarding.data.test_sale = sale;
                onboarding.step = 'game_sale_confirm';

                const paymentLine = (() => {
                    if (sale.forma_pagamento === 'parcelado' && sale.parcelas) {
                        return `Cartão – ${sale.parcelas}x`;
                    }
                    if (sale.forma_pagamento) {
                        const map = {
                            pix: 'PIX',
                            dinheiro: 'Dinheiro',
                            debito: 'Débito',
                            credito_avista: 'Crédito à vista',
                            avista: 'À vista',
                            parcelado: 'Cartão (parcelado)'
                        };
                        return map[sale.forma_pagamento] || sale.forma_pagamento;
                    }
                    return 'Não informado';
                })();

                return await respond(onboardingCopy.fakeSaleReview({
                    cliente: sale.paciente,
                    procedimento: sale.procedimento,
                    valor: sale.valor,
                    pagamentoLabel: paymentLine
                }));
            }

            case 'game_sale_confirm': {
                const v = normalizeText(messageTrimmed);
                const confirmed = v === '1' || v.includes('sim');
                const correction = v === '2' || v.includes('corrigir') || v.includes('editar');

                if (correction) {
                    onboarding.step = 'game_sale_review';
                    return await respond(onboardingCopy.fakeSaleCorrectionPrompt());
                }

                if (confirmed) {
                    // Onboarding concluído - remove o estado
                    // Não salva de verdade — é só demonstração
                    return await respondAndClear(onboardingCopy.onboardingDoneMessage());
                }

                return await respond(`Me responde com *1* (sim) ou *2* (corrigir).`);
            }

            case 'game_finish':
                // Fallback caso alguém caia aqui
                return await respondAndClear('Estou pronta para organizar seu financeiro! 💜');

            default:
                return await respond('Ops, me perdi. Digite "Oi" para recomeçar.');
        }
    }
}

module.exports = new OnboardingFlowService();
