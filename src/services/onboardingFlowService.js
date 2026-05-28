const onboardingService = require('./onboardingService');
const onboardingCopy = require('../copy/onboardingWhatsappCopy');
const analyticsService = require('./analyticsService');
const consentService = require('./consentService');
const cacheService = require('./cacheService');
const { normalizePhone } = require('../utils/phone');
const supabase = require('../db/supabase');
const userController = require('../controllers/userController');
const transactionController = require('../controllers/transactionController');
const documentService = require('./documentService');
const knowledgeService = require('./knowledgeService');
const registrationTokenService = require('./registrationTokenService');
const { trialAccountService, buildForwardSummary, computeGhostSummary } = require('./trialAccountService');
const {
    MIN_NAME_LENGTH,
    MIN_CLINIC_NAME_LENGTH,
    normalizeText,
    isYes,
    isNo,
    parseBrazilianNumber,
    extractBestAmountFromText,
    validateAndExtractValue,
    extractSaleHeuristics,
    getLocalIsoDate,
    formatDate,
    normalizeStartTime,
    validateChoice,
    calculateSummaryFromOnboardingData,
    isDecisionMakerRole,
    calculateMonthlySummary,
    FIXED_COST_CATEGORY_RULES,
    VARIABLE_COST_CATEGORY_RULES,
    inferCostTypeAndCategoryFromText,
    extractCostPaymentDetails,
    extractPrimaryMonetaryValue
} = require('./onboardingUtils');
const { extractInstallments } = require('../utils/moneyParser');

// Fire-and-forget analytics helper — falhas de analytics nunca podem quebrar o onboarding
const safeTrack = async (event, payload) => {
    try { await analyticsService.track(event, payload); } catch { /* silently ignored */ }
};

const CACHE_TTL_SECONDS = 1800;
const STATE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const STATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PERSIST_DEBOUNCE_MS = 1000;

// ── Handlers de estado ──────────────────────────────────────────────────────
class OnboardingStateHandlers {
    constructor(service) {
        this.service = service;
    }

    async handleStart(onboarding, messageTrimmed, normalizedPhone, respond) {
        // CORREÇÃO: Quando está em step de menu, mensagens que são apenas números de 1-9
        // devem ser tratadas como escolhas de menu, não como valores monetários
        const trimmedMessage = messageTrimmed.trim();
        const isSingleDigitMenuChoice = /^[1-9]$/.test(trimmedMessage);
        const messageToCheck = isSingleDigitMenuChoice ? trimmedMessage : messageTrimmed;

        const v = normalizeText(messageToCheck);
        const choseYes = v === '1' || v.includes('sim') || v.includes('começar') || v.includes('comecar');
        const choseHow = v === '2' || v.includes('como funciona') || v.includes('como a lumiz funciona');

        if (choseHow) {
            onboarding.explained = true;
            return await respond(onboardingCopy.startHowItWorks());
        }

        if (choseYes) {
            onboarding.step = 'CONSENT';
            await safeTrack('onboarding_consent_started', {
                phone: normalizedPhone,
                source: 'whatsapp'
            });
            return await respond(onboardingCopy.consentQuestion(), true); // Persist imediato em transição de estado
        }

        // Fallback: pede confirmação de forma natural sem menu numerado
        return await respond(`Posso começar o teste rápido? É só me dizer "sim"!`);
    }

    async handleConsent(onboarding, messageTrimmed, normalizedPhone, respond) {
        const choseAuthorize = isYes(messageTrimmed);
        const choseDeny = isNo(messageTrimmed);

        if (choseDeny) {
            return await respond(onboardingCopy.consentDenied());
        }

        if (choseAuthorize) {
            onboarding.step = 'PROFILE_NAME';
            await safeTrack('onboarding_consent_given', {
                phone: normalizedPhone,
                source: 'whatsapp'
            });
            // LGPD — persiste prova do consentimento (timestamp + versão dos termos)
            // em profiles + audit_log. Fire-and-forget; nunca derruba o onboarding.
            consentService
                .recordConsent({ phone: normalizedPhone, req: onboarding?.req })
                .catch(() => {});
            const questionText = onboardingCopy.profileNameQuestion();
            return await respond(questionText, true);
        }

        return await respond(onboardingCopy.consentDenied());
    }

    async handleProfileName(onboarding, messageTrimmed, respond) {
        // Correção #6: Validação melhorada de nome
        if (messageTrimmed.length < MIN_NAME_LENGTH) {
            return await respond(onboardingCopy.nameTooShort());
        }

        // Valida que tem pelo menos uma letra (não só números ou símbolos)
        if (!/[a-zA-ZÀ-ÿ]/.test(messageTrimmed)) {
            return await respond(onboardingCopy.invalidName());
        }

        // Valida comprimento máximo
        if (messageTrimmed.length > 100) {
            return await respond('Nome muito longo. Por favor, use até 100 caracteres.');
        }

        onboarding.data.nome = messageTrimmed.trim();
        onboarding.step = 'PROFILE_CLINIC';
        return await respond(onboardingCopy.profileClinicQuestion(), true);
    }

    async handleProfileClinic(onboarding, messageTrimmed, respond) {
        // Correção #6: Validação melhorada de nome da clínica
        if (messageTrimmed.length < MIN_CLINIC_NAME_LENGTH) {
            return await respond(onboardingCopy.clinicNameTooShort());
        }

        // Valida que tem pelo menos uma letra (não só números ou símbolos)
        if (!/[a-zA-ZÀ-ÿ]/.test(messageTrimmed)) {
            return await respond(onboardingCopy.invalidClinicName());
        }

        // Valida comprimento máximo
        if (messageTrimmed.length > 100) {
            return await respond('Nome da clínica muito longo. Por favor, use até 100 caracteres.');
        }

        onboarding.data.clinica = messageTrimmed.trim();
        onboarding.step = 'PROFILE_ROLE';
        return await respond(onboardingCopy.profileRoleQuestion(), true);
    }

    async handleProfileRole(onboarding, messageTrimmed, respond) {
        const role = validateChoice(messageTrimmed, {
            'dona_gestora': ['1', 'dona', 'gestora', 'sócia', 'socia', 'proprietária', 'proprietaria', 'dono'],
            'adm_financeiro': ['2', 'adm', 'financeiro', 'administrativa', 'administrativo', 'financeira'],
            'secretaria': ['3', 'secretária', 'secretaria', 'recepcionista', 'recepção', 'recepcao'],
            'profissional': ['4', 'profissional', 'aplico', 'esteticista', 'esteta', 'enfermeira', 'medica', 'médica', 'aplica', 'aplicadora']
        });

        if (!role) {
            return await respond(onboardingCopy.profileRoleQuestion());
        }

        onboarding.data.role = role;
        onboarding.step = 'CONTEXT_WHY';
        return await respond(onboardingCopy.contextWhyQuestion(), true);
    }

    async handleProfileAddMember(onboarding, messageTrimmed, respond) {
        // Step legado removido do onboarding.
        onboarding.step = 'CONTEXT_WHY';
        delete onboarding.data.adding_member;
        delete onboarding.data.current_member_step;
        delete onboarding.data.current_member_function;
        delete onboarding.data.current_member_name;
        delete onboarding.data.temp_phone_entered;
        delete onboarding.data.members_to_add;
        return await respond(onboardingCopy.contextWhyQuestion(), true);
    }

    async handleContextWhy(onboarding, messageTrimmed, respond) {
        const why = validateChoice(messageTrimmed, {
            'organizar_dia_a_dia': ['1', 'organizar', 'dia a dia', 'dia-a-dia', 'rotina', 'diário', 'diario', 'cotidiano'],
            'clareza_mes': ['2', 'clareza', 'mês', 'mes', 'mensal', 'visão', 'visao', 'panorama', 'resultado'],
            'controlar_custos': ['3', 'controlar', 'custos', 'custo', 'gastos', 'despesas', 'gasto', 'despesa', 'reduzir']
        });

        if (!why) {
            // Resposta não reconhecida: aceita texto livre, assume o objetivo mais próximo ou repergunta de forma aberta
            return await respond(onboardingCopy.contextWhyQuestion());
        }

        onboarding.data.context_why = why;
        onboarding.step = 'CONTEXT_HOW';
        return await respond(onboardingCopy.contextHowQuestion(), true);
    }

    async handleContextHow(onboarding, messageTrimmed, normalizedPhone, respond) {
        // Suporte às opções de pagamento (com meio a meio)
        const payment = validateChoice(messageTrimmed, {
            'avista': ['1', 'pix', 'dinheiro', 'a vista', 'à vista', 'espécie', 'especie', 'cash', 'débito', 'debito'],
            'parcelado': ['2', 'cartão parcelado', 'cartao parcelado', 'parcelado', 'parcela', 'crédito', 'credito', 'cartão', 'cartao'],
            'misto': ['3', 'meio a meio', 'meio a meia', 'meio-meio', '50/50', 'metade', 'metade metade', 'misto', 'misturado', 'variado', 'varia', 'depende']
        });

        if (!payment) {
            return await respond(onboardingCopy.contextPaymentQuestion());
        }

        // Mantém compatibilidade com campo antigo e novo
        onboarding.data.context_how = payment;
        onboarding.data.context_payment = payment;
        onboarding.data.recebimento_preferencial = payment;
        onboarding.step = 'AHA_REVENUE';
        await safeTrack('onboarding_context_collected', {
            phone: normalizedPhone,
            source: 'whatsapp',
            properties: { why: onboarding.data.context_why, payment }
        });
        return await respond(onboardingCopy.ahaRevenuePrompt(onboarding.data.nome || ''), true); // Persist imediato
    }

    async handleAhaRevenue(onboarding, messageTrimmed, respond) {
        // REMOVIDO: Chamada Gemini desnecessária (já foi corrigido na análise)
        // Usa apenas heurísticas locais

        const heur = extractSaleHeuristics(messageTrimmed);
        const valorFonte = heur.valor_total || extractBestAmountFromText(messageTrimmed);
        const valorResult = validateAndExtractValue(messageTrimmed, onboardingCopy.ahaRevenueMissingValue());
        if (!valorResult.valid) {
            return await respond(valorResult.error);
        }

        const sale = {
            paciente: heur.paciente,
            procedimento: heur.procedimento,
            valor: valorFonte || valorResult.valor,
            forma_pagamento: heur.forma_pagamento,
            parcelas: heur.parcelas,
            payment_split: heur.payment_split || null,
            bandeira_cartao: null,
            data: getLocalIsoDate(),
            original_text: messageTrimmed
        };

        // Correção #4: Validação melhorada de forma_pagamento
        // Normaliza forma_pagamento
        if (!sale.forma_pagamento) {
            // Se não detectou, assume 'avista' como padrão seguro
            sale.forma_pagamento = 'avista';
        }

        // Se mencionou cartão mas não tem parcelas, assume à vista
        if ((sale.forma_pagamento === 'parcelado' ||
            sale.forma_pagamento.includes('cartão') ||
            sale.forma_pagamento.includes('cartao') ||
            sale.forma_pagamento.includes('credito') ||
            sale.forma_pagamento.includes('crédito')) && !sale.parcelas) {
            // Se mencionou cartão mas não tem número de parcelas, assume crédito à vista
            sale.forma_pagamento = 'credito_avista';
            sale.parcelas = null;
        }

        onboarding.data.pending_sale = sale;
        onboarding.step = 'AHA_REVENUE_CONFIRM';
        return await respond(onboardingCopy.ahaRevenueConfirmation({
            procedimento: sale.procedimento || 'Procedimento',
            paciente: sale.paciente || null,
            valor: sale.valor,
            pagamento: this._formatSalePaymentText(sale),
            split: this._formatSplitForCopy(sale.payment_split),
            data: formatDate(sale.data)
        }), true); // Persist imediato - dados importantes coletados
    }

    async handleAhaRevenueConfirm(onboarding, messageTrimmed, normalizedPhone, respond, respondAndClear) {
        const confirmed = isYes(messageTrimmed);
        const correction = isNo(messageTrimmed);

        // Detecção direta de forma de pagamento como correção ("Foi no Pix", "pix", "foi dinheiro", etc.)
        const msgLower = messageTrimmed.toLowerCase();
        const paymentInlineMatch = (
            /\bpix\b/.test(msgLower) ? 'pix' :
            /\bdinheiro\b|\bcash\b/.test(msgLower) ? 'dinheiro' :
            /\bd[ée]bito\b/.test(msgLower) ? 'debito' :
            /\bcr[ée]dito\b/.test(msgLower) ? 'credito' :
            null
        );
        if (paymentInlineMatch && !confirmed && onboarding.data.pending_sale) {
            onboarding.data.pending_sale.forma_pagamento = paymentInlineMatch;
            onboarding.data.pending_sale.payment_split = null;
            const sale = onboarding.data.pending_sale;
            return await respond(onboardingCopy.ahaRevenueConfirmation({
                procedimento: sale.procedimento || 'Procedimento',
                paciente: sale.paciente || null,
                valor: sale.valor,
                pagamento: this._formatSalePaymentText(sale),
                split: null,
                data: formatDate(sale.data)
            }), true);
        }

        if (correction) {
            onboarding.step = 'AHA_REVENUE_ADJUST';
            return await respond(onboardingCopy.ahaRevenueAdjustMenu(), true);
        }

        if (confirmed) {
            const sale = onboarding.data.pending_sale;
            if (!sale) {
                onboarding.step = 'AHA_REVENUE';
                return await respond(onboardingCopy.ahaRevenuePrompt(onboarding.data.nome || ''));
            }

            let userId = onboarding.data.userId;
            let profileJustCreated = false;
            if (!userId) {
                try {
                    const result = await userController.createUserFromOnboarding({
                        telefone: normalizedPhone,
                        nome_completo: onboarding.data.nome,
                        nome_clinica: onboarding.data.clinica
                    });
                    userId = result.user.id;
                    onboarding.data.userId = userId;
                    profileJustCreated = true;
                } catch (e) {
                    console.error('[ONBOARDING] Erro ao criar usuário:', e);
                    // Correção #8: Não continuar silenciosamente
                    const existingUser = await userController.findUserByPhone(normalizedPhone);
                    if (existingUser) {
                        userId = existingUser.id;
                        onboarding.data.userId = userId;
                    } else {
                        // Se não conseguiu criar E não existe, aborta onboarding
                        return await respond(onboardingCopy.userCreationError());
                    }
                }
            }

            // SALVA INTERAÇÃO PARA APRENDIZADO (CAPTURE)
            if (sale.original_text) {
                knowledgeService.saveInteraction(
                    sale.original_text,
                    'registrar_receita',
                    { procedimento: sale.procedimento || '—', forma_pagamento: sale.forma_pagamento },
                    userId
                ).catch(err => console.error('[KNOWLEDGE] Erro ao salvar receita:', err.message));
            }

            // Cria clinic_members (membro primário e adicionais)
            // PULA se já foram salvos antecipadamente em PROFILE_ADD_MEMBER
            if (userId && profileJustCreated && !onboarding.data.members_saved_early) {
                try {
                    const clinicMemberService = require('./clinicMemberService');

                    // Cria membro primário (quem fez o onboarding)
                    const primaryRole = onboarding.data.role === 'dona_gestora' ? 'dona' :
                        onboarding.data.role === 'adm_financeiro' ? 'adm' :
                            onboarding.data.role || 'dona';

                    await clinicMemberService.addMember({
                        clinicId: userId,
                        telefone: normalizedPhone,
                        nome: onboarding.data.nome,
                        funcao: primaryRole,
                        createdBy: userId,
                        isPrimary: true
                    });

                    // Cria membros adicionais coletados no PROFILE_ADD_MEMBER
                    const membersToAdd = onboarding.data.members_to_add || [];
                    for (const member of membersToAdd) {
                        const normalizedMemberPhone = normalizePhone(member.telefone) || member.telefone;
                        const result = await clinicMemberService.addMember({
                            clinicId: userId,
                            telefone: normalizedMemberPhone,
                            nome: member.nome,
                            funcao: member.funcao,
                            createdBy: userId,
                            isPrimary: false
                        });

                        // Invalida cache do telefone do membro adicionado para garantir que próxima busca encontre
                        if (result.success) {
                            const memberCacheKey = `phone:profile:${normalizedMemberPhone}`;
                            await cacheService.delete(memberCacheKey);
                        }
                    }

                    if (membersToAdd.length > 0) {
                        // members added successfully
                    }

                    // Também invalida cache do telefone principal após criar membros
                    const primaryCacheKey = `phone:profile:${normalizedPhone}`;
                    await cacheService.delete(primaryCacheKey);
                } catch (memberError) {
                    // Não falha o onboarding se erro em clinic_members
                    console.error('[ONBOARDING] Erro ao criar clinic_members:', memberError);
                }
            } else if (onboarding.data.members_saved_early) {
                // members already saved early, skipping duplication
            }

            // Durante onboarding: transações são apenas de TESTE (não salvas no banco)
            // Apenas simula o salvamento para cálculo do resumo
            if (userId) {
                // Simula salvamento (não salva no banco durante onboarding)
                sale.saved = true; // Marca como salva para cálculo do resumo
                sale.savedId = 'test_' + Date.now(); // ID temporário para referência
                sale.isTest = true; // Flag indicando que é teste

                // Track analytics mesmo sendo teste (para métricas)
                await safeTrack('onboarding_revenue_registered', {
                    phone: normalizedPhone,
                    userId,
                    source: 'whatsapp',
                    properties: { valor: sale.valor, is_test: true }
                });

                await trialAccountService.saveRevenue({
                    phone: normalizedPhone,
                    clinicId: userId,
                    ownerName: onboarding.data.nome,
                    clinicName: onboarding.data.clinica,
                    role: onboarding.data.role,
                    sale
                }).catch((error) => {
                    console.error('[TRIAL_ACCOUNT] Erro ao salvar venda do onboarding:', error?.message || error);
                });

            } else {
                // Se não tem userId, não pode continuar
                return await respond(onboardingCopy.userCreationError());
            }

            onboarding.data.pending_cost = null; // Limpa para garantir estado limpo
            onboarding.data.cost_type = null; // Não sabemos o tipo ainda
            onboarding.step = 'AHA_COSTS_UPLOAD';
            await safeTrack('onboarding_act_entered', {
                phone: normalizedPhone,
                source: 'whatsapp',
                properties: { act: '3', step: 'AHA_COSTS_UPLOAD' }
            });
            // Persistência crítica após salvar transação
            return await respond(onboardingCopy.ahaRevenueRegistered() + '\n\n' + onboardingCopy.ahaCostsIntro(), true, true);
        }

        // Resposta não reconhecida como confirmação nem correção: repergunta naturalmente
        return await respond(`Tá certo assim ou quer ajustar alguma coisa?`);
    }

    async handleAhaRevenueAdjust(onboarding, messageTrimmed, respond) {
        const choice = validateChoice(messageTrimmed, {
            'valor': ['1', 'valor', 'valor total', 'preço', 'preco', 'quantia', 'montante', 'total'],
            'pagamento': ['2', 'forma', 'pagamento', 'pix', 'cartão', 'cartao', 'dinheiro', 'débito', 'debito', 'crédito', 'credito'],
            'parcelas': ['3', 'parcelas', 'parcela', 'vezes', 'x cartão', 'parcelamento'],
            'procedimento': ['4', 'procedimento', 'descricao', 'descrição', 'serviço', 'servico', 'tratamento', 'nome', 'descrição']
        });

        if (!choice) return await respond(onboardingCopy.ahaRevenueAdjustMenu());

        if (choice === 'valor') {
            onboarding.step = 'AHA_REVENUE_ADJUST_VALUE';
            return await respond('Perfeito. Me manda só o novo valor total da venda (ex: R$ 5000).', true);
        }
        if (choice === 'pagamento') {
            onboarding.step = 'AHA_REVENUE_ADJUST_PAYMENT';
            return await respond('Me diga a forma de pagamento: foi PIX, dinheiro, débito, crédito à vista, cartão parcelado ou meio a meio?', true);
        }
        if (choice === 'parcelas') {
            onboarding.step = 'AHA_REVENUE_ADJUST_INSTALLMENTS';
            return await respond('Quantas parcelas no cartão? (ex: 6x)', true);
        }

        onboarding.step = 'AHA_REVENUE_ADJUST_PROCEDURE';
        return await respond('Me manda o procedimento/descrição correto.', true);
    }

    async handleAhaRevenueAdjustValue(onboarding, messageTrimmed, respond) {
        const value = extractBestAmountFromText(messageTrimmed);
        if (!value || value <= 0) return await respond(onboardingCopy.ahaRevenueMissingValue());
        if (!onboarding.data.pending_sale) onboarding.data.pending_sale = {};
        onboarding.data.pending_sale.valor = value;
        if (Array.isArray(onboarding.data.pending_sale.payment_split) && onboarding.data.pending_sale.payment_split.length === 2) {
            const half = Number((value / 2).toFixed(2));
            onboarding.data.pending_sale.payment_split = [
                { ...onboarding.data.pending_sale.payment_split[0], valor: half },
                { ...onboarding.data.pending_sale.payment_split[1], valor: Number((value - half).toFixed(2)) }
            ];
        }
        onboarding.step = 'AHA_REVENUE_CONFIRM';
        const sale = onboarding.data.pending_sale;
        return await respond(onboardingCopy.ahaRevenueConfirmation({
            procedimento: sale.procedimento || 'Procedimento',
            paciente: sale.paciente || null,
            valor: sale.valor,
            pagamento: this._formatSalePaymentText(sale),
            split: this._formatSplitForCopy(sale.payment_split),
            data: formatDate(sale.data)
        }), true);
    }

    async handleAhaRevenueAdjustPayment(onboarding, messageTrimmed, respond) {
        const choice = validateChoice(messageTrimmed, {
            'pix': ['1', 'pix'],
            'dinheiro': ['2', 'dinheiro'],
            'debito': ['3', 'debito', 'débito'],
            'credito_avista': ['4', 'credito avista', 'crédito à vista', 'a vista', 'avista'],
            'parcelado': ['5', 'parcelado', 'cartao parcelado', 'cartão parcelado'],
            'misto': ['6', 'meio a meio', 'metade', '50/50']
        });
        if (!choice) return await respond(`Não entendi a forma de pagamento. Pode me dizer se foi PIX, dinheiro, débito, crédito à vista, cartão parcelado ou meio a meio?`);
        if (!onboarding.data.pending_sale) onboarding.data.pending_sale = {};
        onboarding.data.pending_sale.forma_pagamento = choice;
        if (choice !== 'misto') onboarding.data.pending_sale.payment_split = null;
        onboarding.step = 'AHA_REVENUE_CONFIRM';
        const sale = onboarding.data.pending_sale;
        return await respond(onboardingCopy.ahaRevenueConfirmation({
            procedimento: sale.procedimento || 'Procedimento',
            paciente: sale.paciente || null,
            valor: sale.valor,
            pagamento: this._formatSalePaymentText(sale),
            split: this._formatSplitForCopy(sale.payment_split),
            data: formatDate(sale.data)
        }), true);
    }

    async handleAhaRevenueAdjustInstallments(onboarding, messageTrimmed, respond) {
        const installments = parseInt((messageTrimmed.match(/(\d{1,2})/) || [])[1], 10);
        if (!Number.isFinite(installments) || installments < 1 || installments > 24) {
            return await respond('Não consegui entender as parcelas. Me manda no formato "6x" ou só "6".');
        }
        if (!onboarding.data.pending_sale) onboarding.data.pending_sale = {};
        onboarding.data.pending_sale.parcelas = installments;
        if (onboarding.data.pending_sale.forma_pagamento !== 'misto') {
            onboarding.data.pending_sale.forma_pagamento = installments > 1 ? 'parcelado' : 'credito_avista';
        } else if (Array.isArray(onboarding.data.pending_sale.payment_split)) {
            onboarding.data.pending_sale.payment_split = onboarding.data.pending_sale.payment_split.map((part) =>
                part.metodo === 'parcelado' || part.metodo === 'credito_avista'
                    ? { ...part, metodo: installments > 1 ? 'parcelado' : 'credito_avista', parcelas: installments > 1 ? installments : null }
                    : part
            );
        }
        onboarding.step = 'AHA_REVENUE_CONFIRM';
        const sale = onboarding.data.pending_sale;
        return await respond(onboardingCopy.ahaRevenueConfirmation({
            procedimento: sale.procedimento || 'Procedimento',
            paciente: sale.paciente || null,
            valor: sale.valor,
            pagamento: this._formatSalePaymentText(sale),
            split: this._formatSplitForCopy(sale.payment_split),
            data: formatDate(sale.data)
        }), true);
    }

    async handleAhaRevenueAdjustProcedure(onboarding, messageTrimmed, respond) {
        if (!onboarding.data.pending_sale) onboarding.data.pending_sale = {};
        onboarding.data.pending_sale.procedimento = messageTrimmed?.trim() || 'Procedimento';
        onboarding.step = 'AHA_REVENUE_CONFIRM';
        const sale = onboarding.data.pending_sale;
        return await respond(onboardingCopy.ahaRevenueConfirmation({
            procedimento: sale.procedimento || 'Procedimento',
            paciente: sale.paciente || null,
            valor: sale.valor,
            pagamento: this._formatSalePaymentText(sale),
            split: this._formatSplitForCopy(sale.payment_split),
            data: formatDate(sale.data)
        }), true);
    }

    async handleAhaCostsIntro(onboarding, _messageTrimmed, respond) {
        // Compatibilidade com estados legados que ainda apontam para AHA_COSTS_INTRO
        onboarding.step = 'AHA_COSTS_UPLOAD';
        return await respond(onboardingCopy.ahaCostsIntro(), true);
    }

    async handleAhaCostsDocumentType(onboarding, messageTrimmed, respond) {
        // Step legado: redireciona para categoria a partir do tipo escolhido
        if (!onboarding.data.pending_cost) {
            onboarding.step = 'AHA_COSTS_UPLOAD';
            return await respond(onboardingCopy.costErrorRetry());
        }

        const costType = validateChoice(messageTrimmed, {
            'fixo': ['1', 'fixo'],
            'variável': ['2', 'variável', 'variavel'],
            'não_sei': ['3', 'não sei', 'nao sei']
        });

        if (costType === 'não_sei') {
            onboarding.step = 'AHA_COSTS_CLASSIFY_HELP';
            return await respond(onboardingCopy.ahaCostsDontKnow(), true);
        }

        if (!costType) {
            return await respond(onboardingCopy.ahaCostsClassify());
        }

        onboarding.data.pending_cost.tipo = costType === 'fixo' ? 'fixa' : 'variavel';
        onboarding.step = 'AHA_COSTS_CATEGORY';
        return await respond(
            onboarding.data.pending_cost.tipo === 'fixa'
                ? onboardingCopy.ahaCostsCategoryQuestionFixed()
                : onboardingCopy.ahaCostsCategoryQuestionVariable(),
            true
        );
    }

    async handleAhaCostsUpload(onboarding, messageTrimmed, mediaUrl, fileName, messageKey, mediaBuffer, mimeType, respond) {

        // Correção #9: Só processa documento se não tem texto válido
        const valorFromText = extractBestAmountFromText(messageTrimmed);

        // Se tem valor no texto, ignora documento
        if (valorFromText && valorFromText > 0) {
            // Se já sabemos o tipo (ex: segundo custo), já define. Se não, precisamos perguntar.
            const knownType = onboarding.data.cost_type;
            const inferredCost = inferCostTypeAndCategoryFromText(messageTrimmed, knownType);
            const paymentInfo = extractCostPaymentDetails(messageTrimmed);

            onboarding.data.pending_cost = {
                valor: valorFromText,
                tipo: knownType === 'fixo' ? 'fixa' : (knownType === 'variável' ? 'variavel' : null),
                descricao: messageTrimmed,
                data: getLocalIsoDate(),
                original_text: messageTrimmed,
                forma_pagamento: paymentInfo.forma_pagamento,
                parcelas: paymentInfo.parcelas,
                datas_vencimento: paymentInfo.datas_vencimento || null
            };

            if (!onboarding.data.pending_cost.tipo && inferredCost.tipo) {
                onboarding.data.pending_cost.tipo = inferredCost.tipo === 'fixo' ? 'fixa' : 'variavel';
            }

            if (inferredCost.categoria) {
                onboarding.data.pending_cost.categoria = inferredCost.categoria;
                onboarding.data.pending_cost.category_trigger = inferredCost.category_trigger;
            }

            if (knownType) {
                // Se já sabemos o tipo e a categoria veio no texto, já confirma direto
                if (onboarding.data.pending_cost.categoria) {
                    onboarding.step = 'AHA_COSTS_CONFIRM';
                    return await respond(onboardingCopy.ahaCostsConfirmation(this._buildCostConfirmationPayload(onboarding.data.pending_cost)));
                }

                // Se já sabemos o tipo, pula a classificação e vai para categoria
                onboarding.step = 'AHA_COSTS_CATEGORY';
                const isFixo = knownType === 'fixo';
                return await respond(isFixo ? onboardingCopy.ahaCostsCategoryQuestionFixed() : onboardingCopy.ahaCostsCategoryQuestionVariable(), true);
            } else {
                if (onboarding.data.pending_cost.tipo && onboarding.data.pending_cost.categoria) {
                    onboarding.step = 'AHA_COSTS_CONFIRM';
                    return await respond(onboardingCopy.ahaCostsConfirmation(this._buildCostConfirmationPayload(onboarding.data.pending_cost)));
                }

                if (onboarding.data.pending_cost.tipo && !onboarding.data.pending_cost.categoria) {
                    onboarding.step = 'AHA_COSTS_CATEGORY';
                    return await respond(
                        onboarding.data.pending_cost.tipo === 'fixa'
                            ? onboardingCopy.ahaCostsCategoryQuestionFixed()
                            : onboardingCopy.ahaCostsCategoryQuestionVariable(),
                        true
                    );
                }

                // Se não sabemos, pergunta
                onboarding.step = 'AHA_COSTS_CLASSIFY';
                return await respond(onboardingCopy.ahaCostsClassify(), true);
            }
        }

        // Se recebeu documento E não tem valor no texto, processa documento
        if (mediaUrl || mediaBuffer) {
            try {
                // Timeout para processamento de documento (30 segundos)
                const processPromise = mediaBuffer
                    ? documentService.processDocumentFromBuffer(
                        mediaBuffer,
                        mimeType || 'application/pdf',
                        fileName || null
                    )
                    : documentService.processImage(mediaUrl, messageKey || null);
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Timeout ao processar documento')), 60000)
                );

                const result = await Promise.race([processPromise, timeoutPromise]);

                let transacao = null;
                if (result.transacoes && result.transacoes.length > 0) {
                    transacao = result.transacoes.find(t => t.tipo === 'saida') || result.transacoes[0];
                }

                if (transacao && transacao.valor) {
                    const knownType = onboarding.data.cost_type;
                    const inferredCost = inferCostTypeAndCategoryFromText(
                        `${transacao.descricao || ''} ${transacao.categoria || ''}`,
                        knownType
                    );

                    onboarding.data.pending_cost_document = {
                        valor: transacao.valor,
                        categoria: transacao.categoria || 'Outros',
                        descricao: transacao.descricao || fileName || 'Documento',
                        data: transacao.data || getLocalIsoDate(),
                        fornecedor: transacao.categoria || '—'
                    };

                    onboarding.data.pending_cost = {
                        valor: transacao.valor,
                        tipo: knownType === 'fixo' ? 'fixa' : (knownType === 'variável' ? 'variavel' : null),
                        descricao: transacao.descricao || fileName || 'Documento',
                        data: transacao.data || getLocalIsoDate(),
                        categoria: transacao.categoria || null,
                        category_trigger: transacao.category_trigger || null,
                        forma_pagamento: transacao.parcelas > 1 ? 'boleto_parcelado' : null,
                        parcelas: transacao.parcelas || null,
                        datas_vencimento: transacao.condicoes_pagamento || null
                    };

                    if (!onboarding.data.pending_cost.tipo && inferredCost.tipo) {
                        onboarding.data.pending_cost.tipo = inferredCost.tipo === 'fixo' ? 'fixa' : 'variavel';
                    }
                    if (!onboarding.data.pending_cost.categoria && inferredCost.categoria) {
                        onboarding.data.pending_cost.categoria = inferredCost.categoria;
                        onboarding.data.pending_cost.category_trigger = onboarding.data.pending_cost.category_trigger || inferredCost.category_trigger;
                    }

                    if (knownType) {
                        if (onboarding.data.pending_cost.categoria) {
                            onboarding.step = 'AHA_COSTS_CONFIRM';
                            return await respond(
                                onboardingCopy.documentReceivedSimple({ valor: transacao.valor }) +
                                '\n\n' +
                                onboardingCopy.ahaCostsConfirmation(this._buildCostConfirmationPayload(onboarding.data.pending_cost))
                            );
                        }

                        onboarding.step = 'AHA_COSTS_CATEGORY';
                        const isFixo = knownType === 'fixo';
                        return await respond(
                            onboardingCopy.documentReceivedSimple({ valor: transacao.valor }) +
                            '\n\n' +
                            (isFixo ? onboardingCopy.ahaCostsCategoryQuestionFixed() : onboardingCopy.ahaCostsCategoryQuestionVariable())
                        );
                    } else {
                        if (onboarding.data.pending_cost.tipo && onboarding.data.pending_cost.categoria) {
                            onboarding.step = 'AHA_COSTS_CONFIRM';
                            return await respond(
                                onboardingCopy.documentReceivedSimple({ valor: transacao.valor }) +
                                '\n\n' +
                                onboardingCopy.ahaCostsConfirmation(this._buildCostConfirmationPayload(onboarding.data.pending_cost))
                            );
                        }

                        onboarding.step = 'AHA_COSTS_CLASSIFY';
                        return await respond(onboardingCopy.documentReceivedSimple({ valor: transacao.valor }) + '\n\n' + onboardingCopy.ahaCostsClassify());
                    }
                } else {
                    return await respond(onboardingCopy.documentProcessError());
                }
            } catch (e) {
                console.error('[ONBOARDING] Erro ao processar documento:', e);
                return await respond(onboardingCopy.documentProcessError());
            }
        }

        // Texto contextual sem valor (ex: "segue comprovante do boleto"):
        // evita perguntar valor logo em seguida quando o usuário está apenas contextualizando.
        const contextualDocKeywords = ['comprovante', 'boleto', 'nota', 'anexo', 'segue', 'pdf', 'foto', 'arquivo', 'documento'];
        const normalizedText = normalizeText(messageTrimmed || '');
        const looksLikeDocumentContextOnly =
            !mediaUrl &&
            !mediaBuffer &&
            !valorFromText &&
            contextualDocKeywords.some((kw) => normalizedText.includes(kw));

        if (looksLikeDocumentContextOnly) {
            return await respond('Perfeito, estou analisando seu documento. Assim que terminar eu te peço só a confirmação.');
        }

        return await respond(onboardingCopy.costValueNotFound());
    }

    async handleAhaCostsClassify(onboarding, messageTrimmed, respond) {
        const costType = validateChoice(messageTrimmed, {
            'fixo': ['1', 'fixo', 'mensal', 'todo mês', 'todo mes', 'recorrente', 'sempre', 'aluguel', 'salário', 'salario', 'internet', 'luz', 'água', 'agua'],
            'variável': ['2', 'variável', 'variavel', 'muda', 'varia', 'depende', 'insumo', 'material', 'produto', 'compra'],
            'não_sei': ['3', 'não sei', 'nao sei', 'sei lá', 'sei la', 'incerto', 'duvida', 'dúvida']
        });

        if (costType === 'não_sei') {
            onboarding.step = 'AHA_COSTS_CLASSIFY_HELP';
            return await respond(onboardingCopy.ahaCostsDontKnow());
        }

        if (!costType) {
            // Não reconheceu: manda para classify_help para interpretar o texto livre
            onboarding.step = 'AHA_COSTS_CLASSIFY_HELP';
            return await respond(onboardingCopy.ahaCostsDontKnow());
        }

        if (!onboarding.data.pending_cost) {
            onboarding.step = 'AHA_COSTS_UPLOAD';
            return await respond(onboardingCopy.costErrorRetry());
        }

        onboarding.data.pending_cost.tipo = costType === 'fixo' ? 'fixa' : 'variavel';

        if (!onboarding.data.pending_cost.categoria) {
            const inferred = inferCostTypeAndCategoryFromText(
                onboarding.data.pending_cost.descricao || onboarding.data.pending_cost.original_text || '',
                costType
            );
            if (inferred.categoria) {
                onboarding.data.pending_cost.categoria = inferred.categoria;
                onboarding.data.pending_cost.category_trigger = inferred.category_trigger;
            }
        }

        if (onboarding.data.pending_cost.categoria) {
            onboarding.step = 'AHA_COSTS_CONFIRM';
            return await respond(onboardingCopy.ahaCostsConfirmation(this._buildCostConfirmationPayload(onboarding.data.pending_cost)));
        }

        onboarding.step = 'AHA_COSTS_CATEGORY';

        if (costType === 'fixo') {
            return await respond(onboardingCopy.ahaCostsCategoryQuestionFixed(), true);
        } else {
            return await respond(onboardingCopy.ahaCostsCategoryQuestionVariable(), true);
        }
    }

    async handleAhaCostsClassifyHelp(onboarding, messageTrimmed, respond) {
        // Tenta classificar baseado no texto
        const text = normalizeText(messageTrimmed);

        // Heurísticas simples
        const fixedKeywords = ['aluguel', 'salário', 'salario', 'internet', 'luz', 'agua', 'água', 'marketing', 'imposto', 'contador', 'sistema'];
        const variableKeywords = ['insumo', 'material', 'luva', 'mascara', 'seringa', 'toxina', 'botox', 'produto', 'compra'];

        const seemsFixed = fixedKeywords.some(kw => text.includes(kw));
        const seemsVariable = variableKeywords.some(kw => text.includes(kw));

        // Padrão: Variável se inconclusivo? Ou pergunta category de um deles?
        // Vamos assumir Variável se não soubermos, pois é mais comum ter dúvidas em insumos.
        // Ou melhor: se parece Fixo, vai pra Fixo. Se não, vai pra Variável.
        const isFixo = seemsFixed;

        onboarding.data.pending_cost.tipo = isFixo ? 'fixa' : 'variavel';

        if (!onboarding.data.pending_cost.categoria) {
            const inferred = inferCostTypeAndCategoryFromText(
                onboarding.data.pending_cost.descricao || onboarding.data.pending_cost.original_text || '',
                isFixo ? 'fixo' : 'variável'
            );
            if (inferred.categoria) {
                onboarding.data.pending_cost.categoria = inferred.categoria;
                onboarding.data.pending_cost.category_trigger = inferred.category_trigger;
            }
        }

        if (onboarding.data.pending_cost.categoria) {
            onboarding.step = 'AHA_COSTS_CONFIRM';
            return await respond(onboardingCopy.ahaCostsConfirmation(this._buildCostConfirmationPayload(onboarding.data.pending_cost)));
        }

        onboarding.step = 'AHA_COSTS_CATEGORY';

        if (isFixo) {
            return await respond(onboardingCopy.ahaCostsCategoryQuestionFixed(), true);
        } else {
            return await respond(onboardingCopy.ahaCostsCategoryQuestionVariable(), true);
        }
    }

    async handleAhaCostsCategory(onboarding, messageTrimmed, respond) {
        if (!onboarding.data.pending_cost) {
            onboarding.step = 'AHA_COSTS_UPLOAD';
            return await respond(onboardingCopy.costErrorRetry());
        }

        const isFixo = onboarding.data.pending_cost.tipo === 'fixa';
        const categoria = isFixo
            ? (validateChoice(messageTrimmed, {
                'Aluguel': ['1', 'aluguel'],
                'Salários': ['2', 'salário', 'salario'],
                'Internet / Utilitários': ['3', 'internet', 'utilitário', 'utilitarios', 'luz', 'água', 'agua'],
                'Marketing': ['4', 'marketing', 'publicidade'],
                'Impostos': ['5', 'imposto'],
                'Outros': ['6', 'outro']
            }) || 'Outros')
            : (validateChoice(messageTrimmed, {
                'Insumos / materiais': ['1', 'insumo', 'material', 'luva', 'mascara', 'touca', 'gaze'],
                'Fornecedores de injetáveis': ['2', 'injetavel', 'injetáveis', 'acido', 'ácido', 'bioestimulador', 'toxina'],
                'Outros': ['3', 'outro', 'preferir']
            }) || 'Outros');

        onboarding.data.pending_cost.categoria = categoria;
        onboarding.data.pending_cost.category_trigger = 'Categoria escolhida manualmente no onboarding.';
        onboarding.step = 'AHA_COSTS_CONFIRM';
        return await respond(onboardingCopy.ahaCostsConfirmation(this._buildCostConfirmationPayload(onboarding.data.pending_cost)));
    }

    async handleAhaCostsConfirm(onboarding, messageTrimmed, normalizedPhone, respond, respondAndClearMulti) {
        const confirmed = isYes(messageTrimmed);
        const correction = isNo(messageTrimmed);
        const paymentInfo = extractCostPaymentDetails(messageTrimmed);

        if (correction) {
            onboarding.step = 'AHA_COSTS_CATEGORY';
            const isFixo = onboarding.data.pending_cost?.tipo === 'fixa';
            return await respond(isFixo ? onboardingCopy.ahaCostsCategoryQuestionFixed() : onboardingCopy.ahaCostsCategoryQuestionVariable());
        }

        if (!confirmed && onboarding.data.pending_cost && (paymentInfo.forma_pagamento || paymentInfo.parcelas)) {
            onboarding.data.pending_cost.forma_pagamento = paymentInfo.forma_pagamento || onboarding.data.pending_cost.forma_pagamento || null;
            onboarding.data.pending_cost.parcelas = paymentInfo.parcelas || null;
            onboarding.data.pending_cost.datas_vencimento = paymentInfo.datas_vencimento || onboarding.data.pending_cost.datas_vencimento || null;
            return await respond(onboardingCopy.ahaCostsConfirmation(this._buildCostConfirmationPayload(onboarding.data.pending_cost)));
        }

        if (confirmed) {
            const cost = onboarding.data.pending_cost;
            if (!cost) {
                onboarding.step = 'AHA_COSTS_UPLOAD';
                return await respond(onboardingCopy.costErrorRetry());
            }

            // SALVA INTERAÇÃO PARA APRENDIZADO (CAPTURE)
            if (cost.original_text) {
                knowledgeService.saveInteraction(
                    cost.original_text,
                    'registrar_custo',
                    { tipo: cost.tipo, categoria: cost.categoria, descricao: cost.descricao },
                    onboarding.data.userId
                ).catch(err => console.error('[KNOWLEDGE] Erro ao salvar custo:', err.message));
            }

            // Durante onboarding: transações são apenas de TESTE (não salvas no banco)
            // Apenas simula o salvamento para cálculo do resumo
            const userId = onboarding.data.userId;
            if (userId) {
                // Simula salvamento (não salva no banco durante onboarding)
                cost.saved = true; // Marca como salva para cálculo do resumo
                cost.savedId = 'test_' + Date.now(); // ID temporário para referência
                cost.isTest = true; // Flag indicando que é teste

                // Track analytics mesmo sendo teste (para métricas)
                await safeTrack('onboarding_cost_registered', {
                    phone: normalizedPhone,
                    userId,
                    source: 'whatsapp',
                    properties: { valor: cost.valor, tipo: cost.tipo, is_test: true }
                });

                await trialAccountService.saveCost({
                    phone: normalizedPhone,
                    clinicId: userId,
                    ownerName: onboarding.data.nome,
                    clinicName: onboarding.data.clinica,
                    role: onboarding.data.role,
                    cost
                }).catch((error) => {
                    console.error('[TRIAL_ACCOUNT] Erro ao salvar custo do onboarding:', error?.message || error);
                });

            } else {
                // Se não tem userId, não pode continuar
                return await respond(onboardingCopy.userCreationError());
            }

            // Guarda o custo salvo no array de custos confirmados
            const currentCostType = cost.tipo; // 'fixa' ou 'variavel'
            if (!onboarding.data.saved_costs) {
                onboarding.data.saved_costs = [];
            }
            onboarding.data.saved_costs.push({ ...cost });

            // Verifica se já coletou ambos os tipos de custo
            const hasFixedCost = onboarding.data.saved_costs.some(c => c.tipo === 'fixa');
            const hasVariableCost = onboarding.data.saved_costs.some(c => c.tipo === 'variavel');

            // Se ainda falta um tipo de custo, pede o outro
            if (!hasFixedCost || !hasVariableCost) {
                // Limpa o custo pendente para o próximo
                onboarding.data.pending_cost = null;

                // Define o próximo tipo de custo a ser coletado
                if (currentCostType === 'variavel' && !hasFixedCost) {
                    // Foi variável, agora pede fixo
                    onboarding.data.cost_type = 'fixo'; // Pre-set type
                    onboarding.step = 'AHA_COSTS_UPLOAD';
                    // Nota: O texto do script diz "Agora me manda um custo fixo". 
                    // No código anterior usavamos ahaCostsSecondIntroFixed. Preciso checar se existe, se não crio um ad-hoc ou uso o do copy.
                    // O copy antigo tinha ahaCostsSecondIntroFixed. Vou assumir que ela ainda existe e se adequa.
                    return await respond(onboardingCopy.ahaCostsSecondIntroFixed(), true);
                } else if (currentCostType === 'fixa' && !hasVariableCost) {
                    // Foi fixo, agora pede variável
                    onboarding.data.cost_type = 'variável'; // Pre-set type
                    onboarding.step = 'AHA_COSTS_UPLOAD';
                    return await respond(onboardingCopy.ahaCostsSecondIntroVariable(), true);
                }
            }

            // Se já tem os dois tipos, vai para o resumo e encerra onboarding
            const summary = calculateSummaryFromOnboardingData(onboarding);
            await safeTrack('onboarding_summary_viewed', {
                phone: normalizedPhone,
                userId: onboarding.data.userId || null,
                source: 'whatsapp'
            });
            const summaryMsg =
                onboardingCopy.ahaCostsRegistered() +
                '\n\n' +
                onboardingCopy.ahaSummary(summary);
            const act5Messages = this._buildAct5Messages(onboarding);
            return await respondAndClearMulti([summaryMsg, ...act5Messages]);
        }

        // Resposta não reconhecida: repergunta naturalmente
        return await respond(`Tá certo assim ou quer ajustar alguma coisa?`);
    }

    async handleAhaSummary(onboarding, normalizedPhone, respond) {
        onboarding.step = 'BALANCE_QUESTION';
        await safeTrack('onboarding_summary_viewed', {
            phone: normalizedPhone,
            userId: onboarding.data.userId || null,
            source: 'whatsapp'
        });
        return await respond(onboardingCopy.balanceQuestion(), true);
    }

    async handleBalanceQuestion(onboarding, messageTrimmed, respond, respondAndClear, respondAndClearMulti) {
        const choice = validateChoice(messageTrimmed, {
            'yes': ['1', 'sim', 'vou mandar', 'mandar'],
            'no': ['2', 'não', 'nao', 'seguimos']
        });

        if (choice === 'yes') {
            onboarding.step = 'BALANCE_INPUT';
            return await respond(onboardingCopy.balanceInputPrompt(), true);
        }

        if (choice === 'no') {
            return await respondAndClearMulti(this._buildAct5Messages(onboarding));
        }

        return await respond(onboardingCopy.balanceQuestion());
    }

    async handleBalanceInput(onboarding, messageTrimmed, normalizedPhone, respond, respondAndClear, respondAndClearMulti) {
        // Valida valor usando utilitário existente
        const result = validateAndExtractValue(messageTrimmed);

        if (!result.valid) {
            return await respond(onboardingCopy.balanceInputInvalid());
        }

        const saldo = result.valor;
        // Não salva no banco real pois é onboarding? Ou salva?
        // O script diz "Lumiz confirma e ajusta".
        // Como o onboarding até agora foi "teste", mas o saldo "pra eu ir ajustando" parece algo persistente.
        // No entanto, como o usuário ainda não terminou o onboarding (tecnicamente), talvez devêssemos salvar no `onboarding.data`
        // e persistir no final?
        // Vamos salvar no `onboarding.data`.

        onboarding.data.initial_balance = saldo;

        if (onboarding.data.userId) {
          await supabase
            .from('profiles')
            .update({ initial_balance: saldo })
            .eq('id', onboarding.data.userId);

          await trialAccountService.setInitialBalance({
            phone: normalizedPhone,
            clinicId: onboarding.data.userId,
            ownerName: onboarding.data.nome,
            clinicName: onboarding.data.clinica,
            role: onboarding.data.role,
            initialBalance: saldo
          }).catch((error) => {
            console.error('[TRIAL_ACCOUNT] Erro ao salvar saldo inicial do onboarding:', error?.message || error);
          });
        }

        const act5Messages = this._buildAct5Messages(onboarding);
        if (act5Messages.length > 0) {
            act5Messages[0] = onboardingCopy.balanceConfirmation(saldo) + '\n\n' + act5Messages[0];
        }
        return await respondAndClearMulti(act5Messages);
    }

    async handleHandoffToDailyUse(onboarding, messageTrimmed, normalizedPhone, respond, respondAndClear, respondAndClearMulti) {
        // Caso legacy: força handoff e finaliza onboarding sem MDR
        if (onboarding.data?.force_handoff) {
            delete onboarding.data.force_handoff;
            return await respondAndClearMulti(this._buildAct5Messages(onboarding));
        }

        // Detecta se a mensagem parece ser uma transação (venda ou custo)
        // Se for, finaliza onboarding automaticamente e processa como transação normal
        const intentHeuristicService = require('./intentHeuristicService');
        const intent = await intentHeuristicService.detectIntent(messageTrimmed, onboarding.data?.userId || null);

        // Verifica se detectou intent de transação
        const isTransaction = intent && (intent.intencao === 'registrar_entrada' || intent.intencao === 'registrar_saida');

        // Se não detectou com heurística, faz verificação mais ampla
        if (!isTransaction) {
            const lower = messageTrimmed.toLowerCase();
            const hasValue = /\d+/.test(messageTrimmed); // Tem algum número

            // Palavras-chave de venda
            const saleKeywords = ['botox', 'preenchimento', 'harmonização', 'harmonizacao', 'bioestimulador',
                'fios', 'peeling', 'laser', 'paciente', 'cliente', 'procedimento',
                'fiz', 'realizei', 'atendi', 'vendi', 'fechei', 'atendimento', 'tox', 'preench'];

            // Palavras-chave de custo
            const costKeywords = ['insumos', 'marketing', 'aluguel', 'energia', 'internet', 'material',
                'produto', 'fornecedor', 'boleto', 'conta', 'paguei', 'gastei', 'comprei',
                'pagar', 'despesa', 'custo', 'gasto', 'salário', 'salario'];

            const hasSaleKeyword = saleKeywords.some(kw => lower.includes(kw));
            const hasCostKeyword = costKeywords.some(kw => lower.includes(kw));

            // Se tem palavra-chave de transação E um valor numérico, considera como transação
            if (hasValue && (hasSaleKeyword || hasCostKeyword)) {
                // Parece ser uma transação - finaliza onboarding silenciosamente
                try {
                    const existingTimer = this.persistTimers.get(normalizedPhone);
                    if (existingTimer) {
                        clearTimeout(existingTimer);
                        this.persistTimers.delete(normalizedPhone);
                    }
                    await onboardingService.clearWhatsappState(normalizedPhone);
                } catch (e) {
                    console.error('[ONBOARDING] Falha ao limpar estado:', e?.message || e);
                }
                this.onboardingStates.delete(normalizedPhone);

                // Retorna null para indicar que o onboarding foi finalizado e a mensagem deve ser processada normalmente
                return null;
            }
        } else if (isTransaction) {
            // Detectou transação via heurística - finaliza onboarding silenciosamente
            try {
                const existingTimer = this.persistTimers.get(normalizedPhone);
                if (existingTimer) {
                    clearTimeout(existingTimer);
                    this.persistTimers.delete(normalizedPhone);
                }
                await onboardingService.clearWhatsappState(normalizedPhone);
            } catch (e) {
                console.error('[ONBOARDING] Falha ao limpar estado:', e?.message || e);
            }
            this.onboardingStates.delete(normalizedPhone);

            // Retorna null para indicar que o onboarding foi finalizado e a mensagem deve ser processada normalmente
            return null;
        }

        return await respondAndClearMulti([
            ...this._buildAct5Messages(onboarding)
        ]);
    }

    async handleMdrSetupIntro(onboarding, messageTrimmed, normalizedPhone, respond, respondAndClear) {
        const choice = validateChoice(messageTrimmed, {
            'setup': ['1', 'configurar', 'agora'],
            'skip': ['2', 'pular', 'depois']
        });

        if (choice === 'skip') {
            return await respondAndClear(onboardingCopy.mdrSetupSkip());
        }

        if (choice === 'setup') {
            onboarding.step = 'MDR_SETUP_QUESTION';
            return await respond(onboardingCopy.mdrSetupQuestion());
        }

        // Detecta se a mensagem parece ser uma transação (venda ou custo)
        // Se for, finaliza onboarding automaticamente e processa como transação normal
        const intentHeuristicService = require('./intentHeuristicService');
        const intent = await intentHeuristicService.detectIntent(messageTrimmed, onboarding.data?.userId || null);

        // Verifica se detectou intent de transação
        const isTransaction = intent && (intent.intencao === 'registrar_entrada' || intent.intencao === 'registrar_saida');

        // Se não detectou com heurística, faz verificação mais ampla
        if (!isTransaction) {
            const lower = messageTrimmed.toLowerCase();
            const hasValue = /\d+/.test(messageTrimmed); // Tem algum número

            // Palavras-chave de venda
            const saleKeywords = ['botox', 'preenchimento', 'harmonização', 'harmonizacao', 'bioestimulador',
                'fios', 'peeling', 'laser', 'paciente', 'cliente', 'procedimento',
                'fiz', 'realizei', 'atendi', 'vendi', 'fechei', 'atendimento', 'tox', 'preench'];

            // Palavras-chave de custo
            const costKeywords = ['insumos', 'marketing', 'aluguel', 'energia', 'internet', 'material',
                'produto', 'fornecedor', 'boleto', 'conta', 'paguei', 'gastei', 'comprei',
                'pagar', 'despesa', 'custo', 'gasto', 'salário', 'salario'];

            const hasSaleKeyword = saleKeywords.some(kw => lower.includes(kw));
            const hasCostKeyword = costKeywords.some(kw => lower.includes(kw));

            // Se tem palavra-chave de transação E um valor numérico, considera como transação
            if (hasValue && (hasSaleKeyword || hasCostKeyword)) {
                // Parece ser uma transação - finaliza onboarding silenciosamente
                try {
                    const existingTimer = this.persistTimers.get(normalizedPhone);
                    if (existingTimer) {
                        clearTimeout(existingTimer);
                        this.persistTimers.delete(normalizedPhone);
                    }
                    await onboardingService.clearWhatsappState(normalizedPhone);
                } catch (e) {
                    console.error('[ONBOARDING] Falha ao limpar estado:', e?.message || e);
                }
                this.onboardingStates.delete(normalizedPhone);

                // Retorna null para indicar que o onboarding foi finalizado e a mensagem deve ser processada normalmente
                return null;
            }
        } else if (isTransaction) {
            // Detectou transação via heurística - finaliza onboarding silenciosamente
            try {
                const existingTimer = this.persistTimers.get(normalizedPhone);
                if (existingTimer) {
                    clearTimeout(existingTimer);
                    this.persistTimers.delete(normalizedPhone);
                }
                await onboardingService.clearWhatsappState(normalizedPhone);
            } catch (e) {
                console.error('[ONBOARDING] Falha ao limpar estado:', e?.message || e);
            }
            this.onboardingStates.delete(normalizedPhone);

            // Retorna null para indicar que o onboarding foi finalizado e a mensagem deve ser processada normalmente
            return null;
        }

        return await respond(onboardingCopy.mdrSetupIntro());
    }

    async handleMdrSetupQuestion(onboarding, messageTrimmed, respond) {
        const num = parseInt(messageTrimmed, 10);
        if (isNaN(num) || num < 1) {
            return await respond(onboardingCopy.mdrInvalidNumber());
        }

        onboarding.data.mdr_count = num;
        onboarding.data.mdr_current = 1;
        onboarding.step = 'MDR_SETUP_UPLOAD';
        return await respond(onboardingCopy.mdrSetupUpload(), true);
    }

    async handleMdrSetupUpload(onboarding, messageTrimmed, mediaUrl, respond, respondAndClear, mediaBuffer) {
        const text = normalizeText(messageTrimmed || '');
        const skipKeywords = ['2', 'pular', 'depois', 'cancelar', 'cancela', 'nao', 'não'];
        const hasMedia = !!(mediaUrl || mediaBuffer);

        if (!hasMedia && skipKeywords.some((kw) => text === kw || text.includes(kw))) {
            return await respondAndClear(onboardingCopy.mdrSetupSkip());
        }

        if (hasMedia) {
            const current = onboarding.data.mdr_current || 1;
            const total = onboarding.data.mdr_count || 1;

            if (current < total) {
                onboarding.data.mdr_current = current + 1;
                return await respond(onboardingCopy.mdrPrintReceived({ current, total }));
            } else {
                onboarding.step = 'MDR_SETUP_COMPLETE';
                return await respondAndClear(
                    onboardingCopy.mdrSetupReinforcement() + '\n\n' + onboardingCopy.mdrSetupComplete()
                );
            }
        } else {
            return await respond(
                onboardingCopy.mdrNeedPhoto() +
                '\n\nSe quiser pular por enquanto, responda "2" ou "cancelar".'
            );
        }
    }

    async handleMdrSetupComplete(respond, respondAndClear) {
        return await respondAndClear(onboardingCopy.mdrSetupComplete());
    }

    _buildCostConfirmationPayload(cost = {}) {
        return {
            tipo: cost.tipo === 'fixa' ? 'Fixo' : 'Variável',
            categoria: cost.categoria || 'Outros',
            categoryTrigger: cost.category_trigger || null,
            valor: cost.valor,
            data: formatDate(cost.data),
            pagamento: this._formatCostPaymentText(cost)
        };
    }

    _formatCostPaymentText(cost = {}) {
        if (cost.forma_pagamento === 'boleto_parcelado') {
            return cost.parcelas ? `Boleto ${cost.parcelas}x` : 'Boleto parcelado';
        }
        if (cost.forma_pagamento === 'parcelado') {
            return cost.parcelas ? `Cartão ${cost.parcelas}x` : 'Cartão parcelado';
        }
        const map = {
            pix: 'PIX',
            dinheiro: 'Dinheiro',
            debito: 'Débito',
            credito_avista: 'Cartão à vista'
        };
        return map[cost.forma_pagamento] || null;
    }

    _formatSalePaymentText(sale = {}) {
        if (sale.forma_pagamento === 'misto' && Array.isArray(sale.payment_split) && sale.payment_split.length) {
            return 'Meio a meio';
        }
        if (sale.forma_pagamento === 'parcelado') {
            return sale.parcelas ? `Cartão ${sale.parcelas}x` : 'Cartão parcelado';
        }
        const map = {
            pix: 'PIX',
            dinheiro: 'Dinheiro',
            debito: 'Débito',
            credito: 'Crédito',
            credito_avista: 'Crédito à vista',
            avista: 'Crédito à vista'
        };
        return map[sale.forma_pagamento] || 'Não informado';
    }

    _formatSplitForCopy(split = null) {
        if (!Array.isArray(split) || !split.length) return null;
        return split.map((part) => {
            const metodoLabel = part.metodo === 'pix' ? 'PIX' :
                part.metodo === 'dinheiro' ? 'Dinheiro' :
                part.metodo === 'debito' ? 'Débito' :
                part.metodo === 'parcelado' ? 'Cartão' :
                part.metodo === 'credito_avista' ? 'Cartão à vista' : 'Cartão';
            return {
                ...part,
                metodo_label: metodoLabel
            };
        });
    }

    _buildTrialSnapshotFromOnboarding(onboarding) {
        const sale = onboarding?.data?.pending_sale;
        const savedCosts = Array.isArray(onboarding?.data?.saved_costs) ? onboarding.data.saved_costs : [];

        const snapshot = {
            sales: sale?.saved ? [sale] : [],
            costs: savedCosts.filter((cost) => cost?.saved),
            initial_balance: Number.isFinite(Number(onboarding?.data?.initial_balance))
                ? Number(onboarding.data.initial_balance)
                : null
        };
        snapshot.totals = computeGhostSummary(snapshot);
        return snapshot;
    }

    _buildAhaInsightMessage(onboarding) {
        const snapshot = this._buildTrialSnapshotFromOnboarding(onboarding);
        const sale = snapshot.sales && snapshot.sales.length > 0 ? snapshot.sales[0] : null;
        const costs = snapshot.costs || [];

        if (!sale) return null;

        const receita = Number(sale.valor_total || sale.value || sale.valor || 0);
        if (receita <= 0) return null;

        const custoVariavel = costs
            .filter((c) => c.tipo_custo === 'variável' || c.categoria === 'Insumos' || c.tipo === 'variavel')
            .reduce((acc, c) => acc + Number(c.valor || c.value || 0), 0);

        if (custoVariavel <= 0) return null;

        const margemPct = (custoVariavel / receita) * 100;
        const margemStr = margemPct.toFixed(1);
        const procedimento = sale.procedimento || sale.categoria || sale.descricao || 'esse procedimento';

        let msg = `💡 *Insight rápido:*\n\n`;
        msg += `No ${procedimento}, seu custo variável ficou em *${margemStr}%* da receita.\n`;
        msg += `Referência saudável pra estética: 25–35%.\n`;

        if (margemPct > 35) {
            msg += `_Tá um pouco acima — vale checar se o fornecedor tem margem pra negociar ou se o preço precisa de ajuste._`;
        } else if (margemPct < 25) {
            msg += `_Boa margem. Você tá bem posicionada nesse procedimento._`;
        } else {
            msg += `_Dentro do intervalo saudável. Bom sinal._`;
        }

        return msg;
    }

    _buildAct5Messages(onboarding) {
        const role = onboarding?.data?.role || null;
        const clinicName = onboarding?.data?.clinica || 'sua clínica';
        const ownerName = onboarding?.data?.nome || null;

        if (isDecisionMakerRole(role)) {
            return [onboardingCopy.trialClosingDecisionMaker(clinicName)];
        }

        const summaryText = buildForwardSummary({
            clinicName,
            testedByName: ownerName,
            snapshot: this._buildTrialSnapshotFromOnboarding(onboarding)
        });

        return [
            onboardingCopy.trialClosingTeamMember(clinicName),
            onboardingCopy.trialForwardSummary(summaryText)
        ];
    }

    // ============================================================
    // REDESIGN 5 ATOS (Fase 15)
    // ============================================================

    /**
     * Ato 1 — interpreta livremente se é dona ou equipe.
     */
    async handleAct1Role(onboarding, messageTrimmed, normalizedPhone, respond) {
        const v = normalizeText(messageTrimmed);
        const isDona = /dona|sócia|socia|proprietária|proprietaria|gestora|eu mesma|sou eu|dono/.test(v);
        const isEquipe = /secretar|recepcionist|adm|financeiro|sócio|funcionaria|funcionário|team|equipe/.test(v);
        const wantsToStart = isYes(messageTrimmed) || /começar|comecar|bora|vamos|pode|ok|quero|iniciar/.test(v);

        if (!isDona && !isEquipe && !wantsToStart) {
            return await respond(onboardingCopy.act1RoleUnrecognized());
        }

        onboarding.data.role = isEquipe ? 'team' : 'owner';
        // Registra consentimento por continuidade no fluxo iniciado pelo WhatsApp.
        const consentService = require('./consentService');
        consentService.recordConsent({ phone: normalizedPhone, req: onboarding?.req }).catch(() => {});

        onboarding.step = 'ACT2_SALE';
        return await respond(onboardingCopy.act2SalePrompt(), true);
    }

    async _ensureActProfile(onboarding, normalizedPhone) {
        if (onboarding.data.userId) {
            return onboarding.data.userId;
        }

        try {
            const role = onboarding.data.role || 'owner';
            const result = await userController.createUserFromOnboarding({
                telefone: normalizedPhone,
                nome_completo: onboarding.data.nome || 'Cliente Lumiz',
                nome_clinica: onboarding.data.clinica || 'Clínica em teste'
            });

            const userId = result?.user?.id;
            if (!userId) {
                throw new Error('USER_ID_MISSING');
            }

            onboarding.data.userId = userId;
            onboarding.data.nome = onboarding.data.nome || result.user.nome_completo || 'Cliente Lumiz';
            onboarding.data.clinica = onboarding.data.clinica || result.user.nome_clinica || 'Clínica em teste';

            try {
                const clinicMemberService = require('./clinicMemberService');
                await clinicMemberService.addMember({
                    clinicId: userId,
                    telefone: normalizedPhone,
                    nome: onboarding.data.nome,
                    funcao: role === 'team' ? 'adm' : 'dona',
                    createdBy: userId,
                    isPrimary: true
                });
                await cacheService.delete(`phone:profile:${normalizedPhone}`);
            } catch (memberError) {
                console.error('[ONBOARDING_V2] Erro ao criar clinic_member primário:', memberError?.message || memberError);
            }

            return userId;
        } catch (error) {
            console.error('[ONBOARDING_V2] Erro ao criar profile:', error?.message || error);
            const existingUser = await userController.findUserByPhone(normalizedPhone);
            if (existingUser?.id) {
                onboarding.data.userId = existingUser.id;
                onboarding.data.nome = onboarding.data.nome || existingUser.nome_completo || 'Cliente Lumiz';
                onboarding.data.clinica = onboarding.data.clinica || existingUser.nome_clinica || 'Clínica em teste';
                return existingUser.id;
            }
            return null;
        }
    }

    _extractActPayment(text) {
        const vNorm = normalizeText(text || '');
        const parcelas = extractInstallments(vNorm);

        if (vNorm.includes('dinheiro') || vNorm.includes('especie') || vNorm.includes('espécie')) {
            return { pagamento: 'dinheiro', parcelas: null };
        }
        if (vNorm.includes('debito') || vNorm.includes('débito')) {
            return { pagamento: 'debito', parcelas: null };
        }
        if (parcelas > 1 || vNorm.includes('parcel') || vNorm.includes('credito') || vNorm.includes('crédito') || vNorm.includes('cartao') || vNorm.includes('cartão')) {
            return {
                pagamento: parcelas > 1 ? 'parcelado' : 'credito',
                parcelas: parcelas > 1 ? parcelas : null
            };
        }
        if (vNorm.includes('pix')) {
            return { pagamento: 'pix', parcelas: null };
        }

        return { pagamento: null, parcelas: null };
    }

    _extractActSale(text, fallback = {}) {
        const valor = /\d/.test(text || '') ? extractPrimaryMonetaryValue(text) : null;
        const procedimentoMatch = (text || '').match(/^([a-záàãâäéèêëíìîïóòõôöúùûüçñ\s]+?)(?:\s+r\$|\s+\d)/i);
        const procedureCandidate = procedimentoMatch ? procedimentoMatch[1].trim() : null;
        const procedimento = procedureCandidate
            ? procedureCandidate.replace(/^(nao|não|foi|era|seria|corrigindo)\s+/i, '').trim()
            : fallback.procedimento || 'Procedimento';
        const { pagamento, parcelas } = this._extractActPayment(text);

        return {
            procedimento: procedimento || fallback.procedimento || 'Procedimento',
            valor: valor || fallback.valor || null,
            pagamento: pagamento || fallback.pagamento || null,
            parcelas: parcelas || fallback.parcelas || null,
            original_text: text
        };
    }

    _extractActCost(text, fallback = {}) {
        const valor = /\d/.test(text || '') ? extractPrimaryMonetaryValue(text) : null;
        const descricaoMatch = (text || '').match(/^([a-záàãâäéèêëíìîïóòõôöúùûüçñ\s\-]+?)(?:\s+r\$|\s+\d)/i);
        const descriptionCandidate = descricaoMatch ? descricaoMatch[1].trim() : null;
        const descricao = descriptionCandidate
            ? descriptionCandidate.replace(/^(nao|não|foi|era|seria|corrigindo)\s+/i, '').trim()
            : fallback.descricao || 'Custo';

        return {
            descricao: descricao || fallback.descricao || 'Custo',
            valor: valor || fallback.valor || null
        };
    }

    _extractActCostFromDocument(result, fileName = null) {
        if (!result || result.tipo_documento === 'erro' || result.tipo_documento === 'erro_validacao') {
            return null;
        }

        const transaction = Array.isArray(result.transacoes)
            ? (result.transacoes.find((item) => item.tipo === 'saida') || result.transacoes[0])
            : null;

        if (!transaction?.valor || transaction.valor <= 0) {
            return null;
        }

        const descricao = transaction.descricao ||
            transaction.fornecedor ||
            transaction.categoria ||
            fileName ||
            'Custo';

        return {
            descricao,
            valor: Number(transaction.valor),
            data: transaction.data || getLocalIsoDate(),
            categoria: transaction.categoria || null,
            fornecedor: transaction.fornecedor || null,
            original_text: result.texto_extraido || fileName || 'Documento'
        };
    }

    _toAtendimentoPayment(pagamento) {
        if (pagamento === 'pix') return 'pix';
        if (pagamento === 'dinheiro') return 'dinheiro';
        if (pagamento === 'debito') return 'debito';
        if (pagamento === 'parcelado') return 'parcelado';
        return 'credito_avista';
    }

    _isCorrectionDenial(text) {
        const vNorm = normalizeText(text || '');
        return isNo(text) || /^(nao|não|n)\b/.test(vNorm);
    }

    /**
     * Ato 2 — extrai venda do texto livre e pede confirmação.
     */
    async handleAct2Sale(onboarding, messageTrimmed, respond) {
        const sale = this._extractActSale(messageTrimmed);
        const { procedimento, valor, pagamento } = sale;
        if (!valor || valor <= 0) {
            return await respond(`Não consegui identificar o valor 🤔 Tenta assim: _"botox R$ 1.200 no pix"_`);
        }

        onboarding.data.act2_pending = sale;
        onboarding.data.act2_original_text = messageTrimmed;
        if (!pagamento) {
            onboarding.step = 'ACT2_PAYMENT';
            return await respond(onboardingCopy.act2PaymentPrompt());
        }

        onboarding.step = 'ACT2_SALE_CONFIRM';
        return await respond(onboardingCopy.act2SaleConfirm(procedimento, valor, pagamento));
    }

    /**
     * Ato 2 — coleta forma de pagamento quando a venda veio incompleta.
     */
    async handleAct2Payment(onboarding, messageTrimmed, respond) {
        const payment = this._extractActPayment(messageTrimmed);
        if (!payment.pagamento) {
            return await respond(onboardingCopy.act2PaymentPrompt());
        }

        onboarding.data.act2_pending = {
            ...(onboarding.data.act2_pending || {}),
            ...payment,
            original_text: `${onboarding.data.act2_original_text || ''} ${messageTrimmed}`.trim()
        };
        onboarding.data.act2_original_text = onboarding.data.act2_pending.original_text;
        onboarding.step = 'ACT2_SALE_CONFIRM';
        const { procedimento, valor, pagamento } = onboarding.data.act2_pending;
        return await respond(onboardingCopy.act2SaleConfirm(procedimento, valor, pagamento));
    }

    /**
     * Ato 2 — confirmação da venda extraída.
     */
    async handleAct2SaleConfirm(onboarding, messageTrimmed, normalizedPhone, respond) {
        if (this._isCorrectionDenial(messageTrimmed) || messageTrimmed === '2') {
            const paymentCorrection = this._extractActPayment(messageTrimmed);
            const hasInlineCorrection = /\d/.test(messageTrimmed) || Boolean(paymentCorrection.pagamento);
            if (hasInlineCorrection) {
                const correctedSale = this._extractActSale(messageTrimmed, onboarding.data.act2_pending || {});
                onboarding.data.act2_pending = correctedSale;
                onboarding.data.act2_original_text = correctedSale.original_text || messageTrimmed;
                if (!correctedSale.pagamento) {
                    onboarding.step = 'ACT2_PAYMENT';
                    return await respond(onboardingCopy.act2PaymentPrompt());
                }
                onboarding.step = 'ACT2_SALE_CONFIRM';
                return await respond(onboardingCopy.act2SaleConfirm(
                    correctedSale.procedimento,
                    correctedSale.valor,
                    correctedSale.pagamento
                ));
            }
            onboarding.step = 'ACT2_SALE';
            return await respond(onboardingCopy.act2SaleAdjust());
        }

        if (isYes(messageTrimmed) || messageTrimmed === '1') {
            const { procedimento, valor, pagamento, parcelas } = onboarding.data.act2_pending || {};
            if (!pagamento) {
                onboarding.step = 'ACT2_PAYMENT';
                return await respond(onboardingCopy.act2PaymentPrompt());
            }

            // Salva a venda
            try {
                const userId = await this._ensureActProfile(onboarding, normalizedPhone);
                if (!userId) {
                    return await respond(onboardingCopy.userCreationError());
                }
                if (userId) {
                    await transactionController.createAtendimento(userId, {
                        valor,
                        categoria: procedimento,
                        descricao: procedimento,
                        data: getLocalIsoDate(),
                        forma_pagamento: this._toAtendimentoPayment(pagamento),
                        parcelas
                    });
                }
                onboarding.data.act2_saved = { procedimento, valor, pagamento, parcelas };
                await trialAccountService.saveRevenue({
                    phone: normalizedPhone,
                    clinicId: userId,
                    ownerName: onboarding.data.nome,
                    clinicName: onboarding.data.clinica,
                    role: onboarding.data.role,
                    sale: {
                        procedimento,
                        valor_total: valor,
                        forma_pagamento: pagamento,
                        parcelas,
                        data: getLocalIsoDate(),
                        original_text: onboarding.data.act2_original_text || procedimento
                    }
                }).catch((error) => {
                    console.error('[TRIAL_ACCOUNT] Erro ao salvar venda do onboarding v2:', error?.message || error);
                });
            } catch (err) {
                console.warn('[ACT2] Falha ao salvar venda:', err?.message);
            }

            onboarding.step = 'ACT3_COST';
            return await respond(onboardingCopy.act3CostPrompt(), true);
        }

        return await respond(onboardingCopy.act2SaleConfirm(
            onboarding.data.act2_pending?.procedimento,
            onboarding.data.act2_pending?.valor,
            onboarding.data.act2_pending?.pagamento
        ));
    }

    /**
     * Ato 3 — extrai custo do texto livre e pede confirmação.
     */
    async handleAct3Cost(onboarding, messageTrimmed, respond, mediaUrl = null, fileName = null, messageKey = null, mediaBuffer = null, mimeType = null) {
        const cost = this._extractActCost(messageTrimmed);
        const { descricao, valor } = cost;
        if (!valor || valor <= 0) {
            if (mediaUrl || mediaBuffer) {
                try {
                    const processPromise = mediaBuffer
                        ? documentService.processDocumentFromBuffer(mediaBuffer, mimeType || 'application/pdf', fileName || null)
                        : documentService.processImage(mediaUrl, messageKey || null);
                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Timeout ao processar documento')), 60000)
                    );
                    const result = await Promise.race([processPromise, timeoutPromise]);
                    const documentCost = this._extractActCostFromDocument(result, fileName);

                    if (documentCost?.valor) {
                        onboarding.data.act3_pending = documentCost;
                        onboarding.step = 'ACT3_COST_CONFIRM';
                        return await respond(onboardingCopy.act3CostConfirm(documentCost.descricao, documentCost.valor));
                    }
                } catch (error) {
                    console.error('[ONBOARDING_V2] Erro ao processar documento no ACT3:', error?.message || error);
                }

                return await respond(onboardingCopy.act3CostDocumentError());
            }

            return await respond(`Não consegui identificar o valor 🤔 Tenta assim: _"Insumos R$ 800"_`);
        }

        onboarding.data.act3_pending = cost;
        onboarding.step = 'ACT3_COST_CONFIRM';
        return await respond(onboardingCopy.act3CostConfirm(descricao, valor));
    }

    /**
     * Ato 3 — confirmação do custo extraído.
     */
    async handleAct3CostConfirm(onboarding, messageTrimmed, normalizedPhone, respond, respondAndClear) {
        if (this._isCorrectionDenial(messageTrimmed) || messageTrimmed === '2') {
            if (/\d/.test(messageTrimmed)) {
                const correctedCost = this._extractActCost(messageTrimmed, onboarding.data.act3_pending || {});
                onboarding.data.act3_pending = correctedCost;
                onboarding.step = 'ACT3_COST_CONFIRM';
                return await respond(onboardingCopy.act3CostConfirm(
                    correctedCost.descricao,
                    correctedCost.valor
                ));
            }
            onboarding.step = 'ACT3_COST';
            return await respond(onboardingCopy.act3CostAdjust());
        }

        if (isYes(messageTrimmed) || messageTrimmed === '1') {
            const { descricao, valor } = onboarding.data.act3_pending || {};

            try {
                const userId = await this._ensureActProfile(onboarding, normalizedPhone);
                if (!userId) {
                    return await respond(onboardingCopy.userCreationError());
                }
                if (userId) {
                    await transactionController.createContaPagar(userId, {
                        valor,
                        descricao,
                        data: getLocalIsoDate(),
                        categoria: 'outro'
                    });
                }
                onboarding.data.act3_saved = { descricao, valor };
                await trialAccountService.saveCost({
                    phone: normalizedPhone,
                    clinicId: userId,
                    ownerName: onboarding.data.nome,
                    clinicName: onboarding.data.clinica,
                    role: onboarding.data.role,
                    cost: {
                        descricao,
                        valor,
                        categoria: 'outro',
                        tipo: 'variavel',
                        data: getLocalIsoDate()
                    }
                }).catch((error) => {
                    console.error('[TRIAL_ACCOUNT] Erro ao salvar custo do onboarding v2:', error?.message || error);
                });
            } catch (err) {
                console.warn('[ACT3] Falha ao salvar custo:', err?.message);
            }

            onboarding.step = 'ACT4_AHA';
            const ahaMsg = this._buildAct4AhaMessage(onboarding);
            return await respond(ahaMsg || onboardingCopy.act4Aha({}), true);
        }

        return await respond(onboardingCopy.act3CostConfirm(
            onboarding.data.act3_pending?.descricao,
            onboarding.data.act3_pending?.valor
        ));
    }

    /**
     * Ato 4 — constrói o AHA insight a partir da venda e custo salvos.
     */
    _buildAct4AhaMessage(onboarding) {
        const sale = onboarding.data.act2_saved || {};
        const cost = onboarding.data.act3_saved || {};

        const receita = Number(sale.valor || 0);
        const custo = Number(cost.valor || 0);
        if (!receita) return null;

        const insumoPercent = receita > 0 ? Math.round((custo / receita) * 100) : null;
        const liquidoPix = sale.pagamento === 'pix' || sale.pagamento === 'dinheiro' ? receita : null;
        const taxaEstimada = 0.04; // 4% crédito à vista — estimativa
        const liquidoCredito = receita > 0 ? Math.round(receita * (1 - taxaEstimada) * 100) / 100 : null;

        return onboardingCopy.act4Aha({
            procedimento: sale.procedimento,
            insumoPercent,
            insumoMin: 25,
            insumoMax: 40,
            liquidoPix,
            liquidoCredito: sale.pagamento !== 'pix' ? null : liquidoCredito,
            taxaCredito: 4,
            rateConfidence: 'estimate'
        });
    }

    /**
     * Ato 4 — resposta do usuário ao AHA insight (qualquer coisa avança).
     */
    async handleAct4Aha(onboarding, messageTrimmed, normalizedPhone, respond, respondAndClear) {
        const isOwner = onboarding.data.role === 'owner';
        const ctaMsg = isOwner
            ? onboardingCopy.act5CtaOwner(null)
            : onboardingCopy.act5CtaTeam();
        return await respondAndClear(ctaMsg);
    }
}

class OnboardingFlowService {
    constructor() {
        this.onboardingStates = new Map();
        this.onboardingData = this.onboardingStates;
        this.persistTimers = new Map(); // Correção #4: Debounce persistência
        this.handlers = new OnboardingStateHandlers(this);

        // Correção #2: Limpeza automática de estados antigos
        this.cleanupInterval = setInterval(() => {
            this.cleanupOldStates();
        }, STATE_CLEANUP_INTERVAL_MS);
        if (typeof this.cleanupInterval.unref === 'function') {
            this.cleanupInterval.unref();
        }
    }

    cleanupOldStates() {
        const now = Date.now();
        let cleaned = 0;
        for (const [phone, state] of this.onboardingStates.entries()) {
            if (now - (state.startTime || 0) > STATE_MAX_AGE_MS) {
                this.onboardingStates.delete(phone);
                this.persistTimers.delete(phone);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            // old in-memory states cleaned up
        }
    }

    isOnboarding(phone) {
        const normalizedPhone = normalizePhone(phone) || phone;
        return this.onboardingStates.has(normalizedPhone);
    }

    async ensureOnboardingState(phone) {
        const normalizedPhone = normalizePhone(phone) || phone;
        if (this.onboardingStates.has(normalizedPhone)) return true;

        try {
            const persisted = await onboardingService.getWhatsappState(normalizedPhone);
            if (persisted?.step) {
                const legacyMdrSteps = new Set([
                    'MDR_SETUP_INTRO',
                    'MDR_SETUP_QUESTION',
                    'MDR_SETUP_UPLOAD',
                    'MDR_SETUP_COMPLETE'
                ]);
                const legacyProfileMemberStep = persisted.step === 'PROFILE_ADD_MEMBER';
                const step = legacyMdrSteps.has(persisted.step)
                    ? 'HANDOFF_TO_DAILY_USE'
                    : legacyProfileMemberStep
                        ? 'CONTEXT_WHY'
                    : persisted.step;

                this.onboardingStates.set(normalizedPhone, {
                    step,
                    startTime: normalizeStartTime(persisted.startTime),
                    data: {
                        ...(persisted.data || { telefone: normalizedPhone }),
                        ...(legacyMdrSteps.has(persisted.step) ? { force_handoff: true } : {})
                    }
                });

                await safeTrack('onboarding_whatsapp_resumed', {
                    phone: normalizedPhone,
                    userId: persisted?.data?.userId || null,
                    source: 'whatsapp',
                    properties: { step: persisted.step, reason: 'ensure_onboarding_state' }
                });
                return true;
            }
        } catch (e) {
            console.error('[ONBOARDING] Falha ao restaurar estado persistido:', e?.message || e);
        }

        return false;
    }

    getOnboardingStep(phone) {
        const normalizedPhone = normalizePhone(phone) || phone;
        const data = this.onboardingStates.get(normalizedPhone);
        return data ? data.step : null;
    }

    async startIntroFlow(phone) {
        const normalizedPhone = normalizePhone(phone) || phone;

        try {
            const persisted = await onboardingService.getWhatsappState(normalizedPhone);
            if (persisted?.step) {
                const legacyMdrSteps = new Set([
                    'MDR_SETUP_INTRO',
                    'MDR_SETUP_QUESTION',
                    'MDR_SETUP_UPLOAD',
                    'MDR_SETUP_COMPLETE'
                ]);
                const legacyProfileMemberStep = persisted.step === 'PROFILE_ADD_MEMBER';
                const step = legacyMdrSteps.has(persisted.step)
                    ? 'HANDOFF_TO_DAILY_USE'
                    : legacyProfileMemberStep
                        ? 'CONTEXT_WHY'
                    : persisted.step;

                this.onboardingStates.set(normalizedPhone, {
                    step,
                    startTime: normalizeStartTime(persisted.startTime),
                    data: {
                        ...(persisted.data || { telefone: normalizedPhone }),
                        ...(legacyMdrSteps.has(persisted.step) ? { force_handoff: true } : {})
                    }
                });
                await safeTrack('onboarding_whatsapp_resumed', {
                    phone: normalizedPhone,
                    userId: persisted?.data?.userId || null,
                    source: 'whatsapp',
                    properties: { step: persisted.step }
                });
                return this.getPromptForStep(normalizedPhone);
            }
        } catch (e) {
            console.error('[ONBOARDING] Falha ao carregar estado persistido:', e?.message || e);
        }

        // Fase 15: novo fluxo 5 Atos ativado via ONBOARDING_V2=true (env)
        const useNewFlow = process.env.ONBOARDING_V2 === 'true';
        const initialStep = useNewFlow ? 'ACT1_ROLE' : 'START';

        this.onboardingStates.set(normalizedPhone, {
            step: initialStep,
            startTime: Date.now(),
            data: {
                telefone: normalizedPhone
            }
        });

        await safeTrack('onboarding_whatsapp_started', {
            phone: normalizedPhone,
            source: 'whatsapp'
        });

        return useNewFlow ? onboardingCopy.act1Welcome() : onboardingCopy.startMessage();
    }

    getPromptForStep(phone) {
        const normalizedPhone = normalizePhone(phone) || phone;
        const onboarding = this.onboardingStates.get(normalizedPhone);
        if (!onboarding) return null;

        const nome = onboarding.data?.nome || '';

        switch (onboarding.step) {
            case 'START':
                return onboardingCopy.startMessage();
            case 'CONSENT':
                return onboardingCopy.consentQuestion();
            case 'PROFILE_NAME':
                return onboardingCopy.profileNameQuestion();
            case 'PROFILE_CLINIC':
                return onboardingCopy.profileClinicQuestion();
            case 'PROFILE_ROLE':
                return onboardingCopy.profileRoleQuestion();
            case 'PROFILE_ADD_MEMBER':
                return onboardingCopy.contextWhyQuestion();
            case 'CONTEXT_WHY':
                return onboardingCopy.contextWhyQuestion();
            case 'CONTEXT_HOW':
            case 'CONTEXT_PAYMENT':
                return onboardingCopy.contextPaymentQuestion();
            case 'AHA_REVENUE':
                return onboardingCopy.ahaRevenuePrompt(nome);
            case 'AHA_REVENUE_CONFIRM':
                const sale = onboarding.data?.pending_sale;
                if (sale) {
                    // Garante que default para forma de pagamento existe
                    if (!sale.forma_pagamento) sale.forma_pagamento = 'avista';

                    return onboardingCopy.ahaRevenueConfirmation({
                        procedimento: sale.procedimento || 'Procedimento',
                        paciente: sale.paciente || null,
                        valor: sale.valor,
                        pagamento: this.handlers._formatSalePaymentText(sale),
                        split: this.handlers._formatSplitForCopy(sale.payment_split),
                        data: formatDate(sale.data || 'Hoje')
                    });
                }
                return onboardingCopy.ahaRevenuePrompt(nome);
            case 'AHA_REVENUE_ADJUST':
                return onboardingCopy.ahaRevenueAdjustMenu();
            case 'AHA_REVENUE_ADJUST_VALUE':
                return 'Me manda só o novo valor total da venda (ex: R$ 5000).';
            case 'AHA_REVENUE_ADJUST_PAYMENT':
                return 'Me diga a forma de pagamento: foi PIX, dinheiro, débito, crédito à vista, cartão parcelado ou meio a meio?';
            case 'AHA_REVENUE_ADJUST_INSTALLMENTS':
                return 'Quantas parcelas no cartão? (ex: 6x)';
            case 'AHA_REVENUE_ADJUST_PROCEDURE':
                return 'Me manda o procedimento/descrição correto.';
            case 'AHA_COSTS_INTRO':
                return onboardingCopy.ahaCostsIntro();
            case 'AHA_COSTS_UPLOAD':
                const costTypeResume = onboarding.data?.cost_type;
                const savedCostsCount = onboarding.data?.saved_costs?.length || 0;

                // Se já tem um custo salvo, está pedindo o segundo
                if (savedCostsCount > 0) {
                    if (costTypeResume === 'fixo') {
                        return onboardingCopy.ahaCostsSecondIntroFixed();
                    } else if (costTypeResume === 'variável') {
                        return onboardingCopy.ahaCostsSecondIntroVariable();
                    }
                }

                // Primeiro custo
                if (costTypeResume === 'fixo') {
                    return onboardingCopy.ahaCostsUploadFixed();
                } else if (costTypeResume === 'variável') {
                    return onboardingCopy.ahaCostsUploadVariable();
                }
                return onboardingCopy.ahaCostsIntro();
            case 'AHA_COSTS_CATEGORY':
                return (onboarding.data?.pending_cost?.tipo === 'fixa')
                    ? onboardingCopy.ahaCostsCategoryQuestionFixed()
                    : onboardingCopy.ahaCostsCategoryQuestionVariable();
            case 'AHA_COSTS_CONFIRM':
                const cost = onboarding.data?.pending_cost;
                if (cost) {
                    return onboardingCopy.ahaCostsConfirmation(this.handlers._buildCostConfirmationPayload(cost));
                }
                return (onboarding.data?.pending_cost?.tipo === 'fixa')
                    ? onboardingCopy.ahaCostsCategoryQuestionFixed()
                    : onboardingCopy.ahaCostsCategoryQuestionVariable();
            case 'AHA_SUMMARY':
                return null;
            case 'BALANCE_QUESTION':
                return onboardingCopy.balanceQuestion();
            case 'BALANCE_INPUT':
                return onboardingCopy.balanceInputPrompt();
            case 'HANDOFF_TO_DAILY_USE':
                return onboardingCopy.handoffToDailyUse();
            case 'MDR_SETUP_INTRO':
                return onboardingCopy.mdrSetupIntro();
            case 'MDR_SETUP_QUESTION':
                return onboardingCopy.mdrSetupQuestion();
            case 'MDR_SETUP_UPLOAD':
                return onboardingCopy.mdrSetupUpload();
            // 5 Atos — novo fluxo (Fase 15)
            case 'ACT1_ROLE':
                return onboardingCopy.act1Welcome();
            case 'ACT2_SALE':
                return onboardingCopy.act2SalePrompt();
            case 'ACT2_PAYMENT':
                return onboardingCopy.act2PaymentPrompt();
            case 'ACT2_SALE_CONFIRM':
                return onboardingCopy.act2SaleConfirm(
                    onboarding.data?.act2_pending?.procedimento,
                    onboarding.data?.act2_pending?.valor,
                    onboarding.data?.act2_pending?.pagamento
                );
            case 'ACT3_COST':
                return onboardingCopy.act3CostPrompt();
            case 'ACT3_COST_CONFIRM':
                return onboardingCopy.act3CostConfirm(
                    onboarding.data?.act3_pending?.descricao,
                    onboarding.data?.act3_pending?.valor
                );
            case 'ACT4_AHA':
                return onboardingCopy.act4Aha({});
            default:
                return onboardingCopy.startMessage();
        }
    }

    async startOnboarding(phone) {
        return this.startIntroFlow(phone);
    }

    async startNewOnboarding(phone) {
        return this.startIntroFlow(phone);
    }

    async processOnboarding(phone, message, mediaUrl = null, fileName = null, messageKey = null, mediaBuffer = null, mimeType = null) {
        const normalizedPhone = normalizePhone(phone) || phone;
        const onboarding = this.onboardingStates.get(normalizedPhone);
        if (!onboarding) {
            return null;
        }

        const messageTrimmed = message?.trim() || '';
        const messageLower = messageTrimmed.toLowerCase();

        // Log estruturado de cada passo do onboarding — facilita debugging de loops e desvios
        console.log(
          `[ONBOARDING] phone=${normalizedPhone.slice(-4)} step=${onboarding.step}` +
          ` text="${messageTrimmed.substring(0, 60).replace(/\n/g, ' ')}"`
        );

        // Correção #4: Debounce persistência
        const persistState = async (immediate = false) => {
            const existingTimer = this.persistTimers.get(normalizedPhone);
            if (existingTimer) {
                clearTimeout(existingTimer);
                this.persistTimers.delete(normalizedPhone);
            }

            const persist = async () => {
                const MAX_RETRIES = 3;
                for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                    try {
                        await onboardingService.upsertWhatsappState(normalizedPhone, {
                            step: onboarding.step,
                            data: onboarding.data
                        });
                        this.persistTimers.delete(normalizedPhone);
                        return;
                    } catch (e) {
                        if (attempt === MAX_RETRIES) {
                            console.error(`[ONBOARDING] Falha ao persistir estado após ${MAX_RETRIES} tentativas:`, e?.message || e);
                            return;
                        }
                        const backoff = Math.pow(2, attempt - 1) * 500; // 500ms, 1s, 2s
                        console.warn(`[ONBOARDING] Tentativa ${attempt}/${MAX_RETRIES} falhou, retry em ${backoff}ms:`, e?.message || e);
                        await new Promise(r => setTimeout(r, backoff));
                    }
                }
            };

            if (immediate) {
                // Para persistência imediata, aguarda conclusão
                try {
                    await persist();
                } catch (e) {
                    // Se persist lançar exceção (não deveria, mas por segurança)
                    console.error('[ONBOARDING] Erro inesperado em persistState imediato:', e?.message || e);
                    // Não relança - permite que a resposta continue
                }
            } else {
                // Para persistência com debounce, agenda sem aguardar
                const timer = setTimeout(() => {
                    persist().catch(e => {
                        console.error('[ONBOARDING] Erro em persistState agendado:', e?.message || e);
                    });
                }, 1000); // Força 1s mesmo se a constante mudar, para segurança
                this.persistTimers.set(normalizedPhone, timer);
            }
        };

        // Correção #5: Sincronização de estado
        const respond = async (text, shouldPersistImmediate = false, criticalPersist = false) => {
            // Garante que text é válido
            if (!text || typeof text !== 'string') {
                console.error('[ONBOARDING] respond recebeu text inválido:', text);
                text = onboardingCopy.lostState();
            }

            // Sempre persiste estado antes de responder
            try {
                if (criticalPersist) {
                    // Para persistências críticas (ex: após salvar transação), 
                    // tenta persistir imediatamente e falha silenciosamente se não conseguir
                    // (não bloqueia resposta ao usuário, mas loga erro)
                    try {
                        await persistState(true);
                    } catch (e) {
                        console.error('[ONBOARDING] Falha crítica ao persistir estado:', e?.message || e);
                    }
                } else {
                    try {
                        await persistState(shouldPersistImmediate);
                    } catch (e) {
                        console.error('[ONBOARDING] Falha ao persistir estado:', e?.message || e);
                    }
                }
            } catch (e) {
                // Catch geral para qualquer erro inesperado na persistência
                console.error('[ONBOARDING] Erro inesperado na persistência:', e?.message || e);
                // Não bloqueia resposta
            }

            // Garante que sempre retorna uma string válida
            return text || onboardingCopy.lostState();
        };

        const respondAndClear = async (text) => {
            let finalText = text || onboardingCopy.lostState();

            try {
                const existingTimer = this.persistTimers.get(normalizedPhone);
                if (existingTimer) {
                    clearTimeout(existingTimer);
                    this.persistTimers.delete(normalizedPhone);
                }
                await onboardingService.clearWhatsappState(normalizedPhone);
            } catch (e) {
                console.error('[ONBOARDING] Falha ao limpar estado:', e?.message || e);
            }
            this.onboardingStates.delete(normalizedPhone);
            await safeTrack('onboarding_whatsapp_completed', {
                phone: normalizedPhone,
                userId: onboarding?.data?.userId || null,
                source: 'whatsapp',
                properties: { step: onboarding?.step || null }
            });

            const clinicId = onboarding?.data?.userId;
            if (clinicId) {
                try {
                    await trialAccountService.saveReferralSummary({
                        phone: normalizedPhone,
                        clinicId,
                        ownerName: onboarding?.data?.nome || null,
                        clinicName: onboarding?.data?.clinica || null,
                        role: onboarding?.data?.role || null
                    }).catch((error) => {
                        console.error('[TRIAL_ACCOUNT] Falha ao salvar resumo do onboarding:', error?.message || error);
                    });

                    const subscriptionService = require('./subscriptionService');
                    const evolutionSvc = require('./evolutionService');
                    const subscriptionCopy = require('../copy/subscriptionCopy');
                    await subscriptionService.startTrial(clinicId);
                    await evolutionSvc.sendMessage(normalizedPhone, subscriptionCopy.trialStarted()).catch(() => {});
                    const dashboardTeaserVideoUrl = String(process.env.ONBOARDING_DASHBOARD_TEASER_VIDEO_URL || '').trim();
                    if (dashboardTeaserVideoUrl && typeof evolutionSvc.sendVideo === 'function') {
                        const sendTeaserVideo = () => evolutionSvc.sendVideo(
                            normalizedPhone,
                            dashboardTeaserVideoUrl,
                            onboardingCopy.dashboardTeaserVideoCaption()
                        ).catch((error) => {
                            console.error('[ONBOARDING] Falha ao enviar vídeo teaser do dashboard:', error?.message || error);
                        });

                        if (process.env.NODE_ENV === 'test') {
                            await sendTeaserVideo();
                        } else {
                            const timer = setTimeout(sendTeaserVideo, 2500);
                            if (typeof timer.unref === 'function') timer.unref();
                        }
                    }
                } catch (e) {
                    console.error('[SUBSCRIPTION] Falha ao iniciar trial:', e?.message);
                }
            }

            return finalText;
        };

        // Envia as N-1 primeiras mensagens via Evolution e usa respondAndClear na última.
        // Permite quebrar a finalização do onboarding em mensagens menores e legíveis no WhatsApp.
        const respondAndClearMulti = async (messages) => {
            const list = (messages || []).filter((m) => typeof m === 'string' && m.trim().length > 0);
            if (list.length === 0) {
                return await respondAndClear(null);
            }
            if (list.length === 1) {
                return await respondAndClear(list[0]);
            }

            const evolutionSvc = require('./evolutionService');
            const delay = process.env.NODE_ENV === 'test'
                ? () => Promise.resolve()
                : (ms) => new Promise((r) => setTimeout(r, ms));
            for (let i = 0; i < list.length - 1; i++) {
                try {
                    await evolutionSvc.sendMessage(normalizedPhone, list[i]);
                    await delay(1200);
                } catch (e) {
                    console.error('[ONBOARDING] Falha ao enviar mensagem intermediária:', e?.message || e);
                }
            }
            return await respondAndClear(list[list.length - 1]);
        };

        // Escape hatch global
        if (
            messageLower.includes('ajuda') ||
            messageLower.includes('falar com') ||
            messageLower.includes('humano') ||
            messageLower.includes('tá complicado') ||
            messageLower.includes('ta complicado')
        ) {
            return await respond(onboardingCopy.escalateToHuman());
        }

        // Correção #19: Usar handlers ao invés de switch gigante
        const handlers = this.handlers;
        const step = onboarding.step;

        try {
            switch (step) {
                case 'START':
                    return await handlers.handleStart(onboarding, messageTrimmed, normalizedPhone, respond);
                case 'CONSENT':
                    return await handlers.handleConsent(onboarding, messageTrimmed, normalizedPhone, respond);
                case 'PROFILE_NAME':
                    return await handlers.handleProfileName(onboarding, messageTrimmed, respond);
                case 'PROFILE_CLINIC':
                    return await handlers.handleProfileClinic(onboarding, messageTrimmed, respond);
                case 'PROFILE_ROLE':
                    return await handlers.handleProfileRole(onboarding, messageTrimmed, respond);
                case 'PROFILE_ADD_MEMBER':
                    return await handlers.handleProfileAddMember(onboarding, messageTrimmed, respond);
                case 'CONTEXT_WHY':
                    return await handlers.handleContextWhy(onboarding, messageTrimmed, respond);
                case 'CONTEXT_HOW':      // Mantém compatibilidade
                case 'CONTEXT_PAYMENT':
                    return await handlers.handleContextHow(onboarding, messageTrimmed, normalizedPhone, respond);
                case 'AHA_REVENUE':
                    return await handlers.handleAhaRevenue(onboarding, messageTrimmed, respond);
                case 'AHA_REVENUE_CONFIRM':
                    return await handlers.handleAhaRevenueConfirm(onboarding, messageTrimmed, normalizedPhone, respond, respondAndClear);
                case 'AHA_REVENUE_ADJUST':
                    return await handlers.handleAhaRevenueAdjust(onboarding, messageTrimmed, respond);
                case 'AHA_REVENUE_ADJUST_VALUE':
                    return await handlers.handleAhaRevenueAdjustValue(onboarding, messageTrimmed, respond);
                case 'AHA_REVENUE_ADJUST_PAYMENT':
                    return await handlers.handleAhaRevenueAdjustPayment(onboarding, messageTrimmed, respond);
                case 'AHA_REVENUE_ADJUST_INSTALLMENTS':
                    return await handlers.handleAhaRevenueAdjustInstallments(onboarding, messageTrimmed, respond);
                case 'AHA_REVENUE_ADJUST_PROCEDURE':
                    return await handlers.handleAhaRevenueAdjustProcedure(onboarding, messageTrimmed, respond);
                case 'AHA_COSTS_INTRO':
                    return await handlers.handleAhaCostsIntro(onboarding, messageTrimmed, respond);
                case 'AHA_COSTS_UPLOAD':
                    return await handlers.handleAhaCostsUpload(
                        onboarding,
                        messageTrimmed,
                        mediaUrl,
                        fileName,
                        messageKey,
                        mediaBuffer,
                        mimeType,
                        respond
                    );
                case 'AHA_COSTS_CLASSIFY':
                    return await handlers.handleAhaCostsClassify(onboarding, messageTrimmed, respond);
                case 'AHA_COSTS_CLASSIFY_HELP':
                    return await handlers.handleAhaCostsClassifyHelp(onboarding, messageTrimmed, respond);
                case 'AHA_COSTS_DOCUMENT_TYPE':
                    return await handlers.handleAhaCostsDocumentType(onboarding, messageTrimmed, respond);
                case 'AHA_COSTS_CATEGORY':
                    return await handlers.handleAhaCostsCategory(onboarding, messageTrimmed, respond);
                case 'AHA_COSTS_CONFIRM':
                    return await handlers.handleAhaCostsConfirm(onboarding, messageTrimmed, normalizedPhone, respond, respondAndClearMulti);
                case 'AHA_SUMMARY':
                    return await handlers.handleAhaSummary(onboarding, normalizedPhone, respond);
                case 'BALANCE_QUESTION':
                    return await handlers.handleBalanceQuestion(onboarding, messageTrimmed, respond, respondAndClear, respondAndClearMulti);
                case 'BALANCE_INPUT':
                    return await handlers.handleBalanceInput(onboarding, messageTrimmed, normalizedPhone, respond, respondAndClear, respondAndClearMulti);
                case 'HANDOFF_TO_DAILY_USE':
                    return await handlers.handleHandoffToDailyUse(onboarding, messageTrimmed, normalizedPhone, respond, respondAndClear, respondAndClearMulti);
                case 'MDR_SETUP_INTRO':
                    return await handlers.handleMdrSetupIntro(onboarding, messageTrimmed, normalizedPhone, respond, respondAndClear);
                case 'MDR_SETUP_QUESTION':
                    return await handlers.handleMdrSetupQuestion(onboarding, messageTrimmed, respond);
                case 'MDR_SETUP_UPLOAD':
                    return await handlers.handleMdrSetupUpload(onboarding, messageTrimmed, mediaUrl, respond, respondAndClear, mediaBuffer);
                case 'MDR_SETUP_COMPLETE':
                    return await handlers.handleMdrSetupComplete(respond, respondAndClear);
                // 5 Atos — novo fluxo (Fase 15)
                case 'ACT1_ROLE':
                    return await handlers.handleAct1Role(onboarding, messageTrimmed, normalizedPhone, respond);
                case 'ACT2_SALE':
                    return await handlers.handleAct2Sale(onboarding, messageTrimmed, respond);
                case 'ACT2_PAYMENT':
                    return await handlers.handleAct2Payment(onboarding, messageTrimmed, respond);
                case 'ACT2_SALE_CONFIRM':
                    return await handlers.handleAct2SaleConfirm(onboarding, messageTrimmed, normalizedPhone, respond);
                case 'ACT3_COST':
                    return await handlers.handleAct3Cost(onboarding, messageTrimmed, respond, mediaUrl, fileName, messageKey, mediaBuffer, mimeType);
                case 'ACT3_COST_CONFIRM':
                    return await handlers.handleAct3CostConfirm(onboarding, messageTrimmed, normalizedPhone, respond, respondAndClear);
                case 'ACT4_AHA':
                    return await handlers.handleAct4Aha(onboarding, messageTrimmed, normalizedPhone, respond, respondAndClear);
                // Fallback de segurança: estado persistiu com ACT5_CTA antes do clear
                case 'ACT5_CTA': {
                    const isOwner = onboarding.data?.role === 'owner';
                    const ctaMsg = isOwner
                        ? onboardingCopy.act5CtaOwner(null)
                        : onboardingCopy.act5CtaTeam();
                    return await respondAndClear(ctaMsg);
                }
                default:
                    return await respond(onboardingCopy.lostState());
            }
        } catch (error) {
            console.error('[ONBOARDING] Erro ao processar estado:', error);
            console.error('[ONBOARDING] Stack:', error.stack);
            try {
                const errorResponse = await respond(onboardingCopy.lostState());
                return errorResponse || 'Ops, me perdi. Digite "Oi" para recomeçar.';
            } catch (respondError) {
                console.error('[ONBOARDING] Erro fatal ao gerar resposta de erro:', {
                    error: respondError.message,
                    originalError: error.message,
                    phone: normalizedPhone,
                    step: onboarding?.step
                });
                return 'Ops, me perdi. Digite "Oi" para recomeçar.';
            }
        }
    }
}

module.exports = new OnboardingFlowService();
