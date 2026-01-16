const onboardingService = require('./onboardingService');
const onboardingCopy = require('../copy/onboardingWhatsappCopy');
const analyticsService = require('./analyticsService');
const cacheService = require('./cacheService');
const { normalizePhone } = require('../utils/phone');
const supabase = require('../db/supabase');
// Mover requires para topo (correção #5)
const userController = require('../controllers/userController');
const transactionController = require('../controllers/transactionController');
const documentService = require('./documentService');

// ============================================================
// Constantes (correção #18 - Magic numbers)
// ============================================================
const CACHE_TTL_SECONDS = 1800; // 30 minutos
const STATE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hora
const STATE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 horas
const PERSIST_DEBOUNCE_MS = 5000; // 5 segundos
const MIN_NAME_LENGTH = 2;
const MIN_CLINIC_NAME_LENGTH = 2;

// ============================================================
// Funções utilitárias
// ============================================================
function normalizeText(value = '') {
    return String(value).trim().toLowerCase();
}

function isYes(value = '') {
    const v = normalizeText(value);
    const result = v === '1' || v === 'sim' || v === 's' || v === 'ok' || v === 'confirmar' || 
           v.includes('pode registrar') || v.includes('tá ok') || v.includes('ta ok') || 
           v.includes('confere') || v.includes('autorizo') || v.includes('autorizar');
    return result;
}

function isNo(value = '') {
    const v = normalizeText(value);
    return v === '2' || v === 'nao' || v === 'não' || v === 'n' || v === 'cancelar' || 
           v.includes('corrigir') || v.includes('ajustar') || v.includes('editar');
}

function parseBrazilianNumber(raw) {
    if (!raw) return null;
    const str = String(raw).trim();
    const cleaned = str.replace(/r\$\s*/gi, '').replace(/\s/g, '');

    if (/\d+\.\d{3}(?:\.\d{3})*,\d{2}$/.test(cleaned)) {
        const normalized = cleaned.replace(/\./g, '').replace(',', '.');
        const n = parseFloat(normalized);
        return Number.isFinite(n) ? n : null;
    }

    if (/,\d{1,2}$/.test(cleaned)) {
        const normalized = cleaned.replace(/\./g, '').replace(',', '.');
        const n = parseFloat(normalized);
        return Number.isFinite(n) ? n : null;
    }

    const normalized = cleaned.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(normalized);
    return Number.isFinite(n) ? n : null;
}

function extractBestAmountFromText(text = '') {
    const raw = String(text);
    const currencyMatch = raw.match(/r\$\s*([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})?|[0-9]+(?:[.,][0-9]{2})?)/i);
    if (currencyMatch && currencyMatch[1]) {
        const value = parseBrazilianNumber(currencyMatch[1]);
        if (value && value > 0) return value;
    }

    const matches = [...raw.matchAll(/(\d+(?:[.,]\d+)?)/g)].map((m) => m[1]);
    const candidates = matches
        .map((m) => parseBrazilianNumber(m))
        .filter((n) => Number.isFinite(n) && n > 0)
        .filter((n) => !(n >= 1900 && n <= 2100));

    if (!candidates.length) return null;
    return Math.max(...candidates);
}

// Correção #13: Validação de valor unificada
// Correção #7: Adiciona validação de limites
function validateAndExtractValue(text, errorMessage = null) {
    const valor = extractBestAmountFromText(text);
    if (!valor || Number.isNaN(valor) || valor <= 0) {
        return { valid: false, error: errorMessage || onboardingCopy.ahaRevenueMissingValue() };
    }
    
    // Validação de limites
    const MAX_VALUE = 10000000; // R$ 10 milhões
    const MIN_VALUE = 0.01; // R$ 0,01
    
    if (valor > MAX_VALUE) {
        return { valid: false, error: onboardingCopy.valueTooHigh() };
    }
    
    if (valor < MIN_VALUE) {
        return { valid: false, error: onboardingCopy.valueTooLow() };
    }
    
    return { valid: true, valor };
}

function extractSaleHeuristics(text = '') {
    const raw = String(text).trim();
    const lower = raw.toLowerCase();

    let paciente = null;
    const nameMatch = raw.match(/^([A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){0,2})\s+(fez|pagou|comprou|atendeu|realizou)\b/i);
    if (nameMatch && nameMatch[1]) {
        paciente = nameMatch[1].trim();
    }

    let procedimento = null;
    const procMatch = raw.match(/\b(fez|realizou|atendeu)\b\s+(?:um|uma|o|a)?\s*([^,]+?)(?:,|\s+pagou|\s+por|\s+r\$|\s+R\$|\s+\d)/i);
    if (procMatch && procMatch[2]) {
        procedimento = procMatch[2].trim();
    }

    let forma_pagamento = null;
    let parcelas = null;
    
    // PRIMEIRO: Verifica se há padrão "número x" na mensagem inteira (qualquer número seguido de x = parcela)
    const parcelasMatch = raw.match(/\b(\d{1,2})\s*x\b/i);
    if (parcelasMatch && parcelasMatch[1]) {
        forma_pagamento = 'parcelado';
        parcelas = parseInt(parcelasMatch[1], 10);
    } else if (lower.includes('pix')) {
        forma_pagamento = 'pix';
    } else if (lower.includes('dinheiro')) {
        forma_pagamento = 'dinheiro';
    } else if (lower.includes('débito') || lower.includes('debito')) {
        forma_pagamento = 'debito';
    } else if (lower.includes('cartão') || lower.includes('cartao') || lower.includes('crédito') || lower.includes('credito')) {
        forma_pagamento = 'credito_avista';
    }

    return { paciente, procedimento, forma_pagamento, parcelas };
}

function formatDate(date) {
    if (!date) return 'Hoje';
    if (typeof date === 'string') {
        try {
            const d = new Date(date);
            if (isNaN(d.getTime())) return 'Hoje';
            return d.toLocaleDateString('pt-BR');
        } catch {
            return 'Hoje';
        }
    }
    return date.toLocaleDateString('pt-BR');
}

// Correção #17: Função helper para validação de escolhas
function validateChoice(message, options) {
    const v = normalizeText(message);
    for (const [key, matchers] of Object.entries(options)) {
        if (matchers.some(matcher => {
            if (typeof matcher === 'string') {
                const normalizedMatcher = normalizeText(matcher);
                return v === normalizedMatcher || v.includes(normalizedMatcher);
            }
            if (matcher instanceof RegExp) {
                return matcher.test(v);
            }
            return false;
        })) {
            return key;
        }
    }
    return null;
}

// Correção #10: Calcular resumo em memória ao invés de query
// Correção #2: Cálculo de resumo usando apenas dados salvos
function calculateSummaryFromOnboardingData(onboarding) {
    const sale = onboarding.data?.pending_sale;
    
    // Suporte para múltiplos custos salvos
    const savedCosts = onboarding.data?.saved_costs || [];
    const pendingCost = onboarding.data?.pending_cost;

    // Só conta se foi salvo com sucesso (tem flag saved)
    const entradas = (sale?.saved && sale?.valor) ? sale.valor : 0;
    
    // Soma custos fixos e variáveis do array de custos salvos
    let custosFixos = 0;
    let custosVariaveis = 0;
    
    for (const cost of savedCosts) {
        if (cost?.saved && cost?.valor) {
            if (cost.tipo === 'fixa') {
                custosFixos += cost.valor;
            } else if (cost.tipo === 'variavel') {
                custosVariaveis += cost.valor;
            }
        }
    }
    
    // Também considera o pending_cost se foi salvo (para compatibilidade)
    if (pendingCost?.saved && pendingCost?.valor) {
        if (pendingCost.tipo === 'fixa') {
            custosFixos += pendingCost.valor;
        } else if (pendingCost.tipo === 'variavel') {
            custosVariaveis += pendingCost.valor;
        }
    }
    
    const saldoParcial = entradas - custosFixos - custosVariaveis;

    return {
        entradas,
        custosFixos,
        custosVariaveis,
        saldoParcial
    };
}

// Fallback: query ao banco se necessário (para casos onde já tem dados no banco)
async function calculateMonthlySummary(userId) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = new Date(year, month, 0).toISOString().split('T')[0];

    // Busca entradas (atendimentos)
    const { data: atendimentos, error: atendError } = await supabase
        .from('atendimentos')
        .select('valor_total')
        .eq('user_id', userId)
        .gte('data', startDate)
        .lte('data', endDate);

    if (atendError) {
        console.error('[ONBOARDING] Erro ao buscar atendimentos:', atendError);
    }

    // Busca custos (contas_pagar)
    const { data: contas, error: contasError } = await supabase
        .from('contas_pagar')
        .select('valor, tipo')
        .eq('user_id', userId)
        .gte('data', startDate)
        .lte('data', endDate);

    if (contasError) {
        console.error('[ONBOARDING] Erro ao buscar contas:', contasError);
    }

    const entradas = (atendimentos || []).reduce((sum, a) => sum + parseFloat(a.valor_total || 0), 0);
    const custosFixos = (contas || []).filter(c => c.tipo === 'fixa').reduce((sum, c) => sum + parseFloat(c.valor || 0), 0);
    const custosVariaveis = (contas || []).filter(c => c.tipo === 'variavel' || !c.tipo).reduce((sum, c) => sum + parseFloat(c.valor || 0), 0);
    const saldoParcial = entradas - custosFixos - custosVariaveis;

    return {
        entradas,
        custosFixos,
        custosVariaveis,
        saldoParcial
    };
}

// ============================================================
// State Handlers (correção #19 - Refatorar switch gigante)
// ============================================================
class OnboardingStateHandlers {
    constructor(service) {
        this.service = service;
    }

    async handleStart(onboarding, messageTrimmed, normalizedPhone, respond) {
        const v = normalizeText(messageTrimmed);
        const choseYes = v === '1' || v.includes('sim') || v.includes('começar') || v.includes('comecar');
        const choseHow = v === '2' || v.includes('como funciona') || v.includes('como a lumiz funciona');

        if (choseHow) {
            return await respond(onboardingCopy.startHowItWorks());
        }

        if (choseYes) {
            onboarding.step = 'CONSENT';
            await analyticsService.track('onboarding_consent_started', {
                phone: normalizedPhone,
                source: 'whatsapp'
            });
            return await respond(onboardingCopy.consentQuestion(), true); // Persist imediato em transição de estado
        }

        return await respond(onboardingCopy.invalidChoice());
    }

    async handleConsent(onboarding, messageTrimmed, normalizedPhone, respond) {
        const choseAuthorize = isYes(messageTrimmed);
        const choseDeny = isNo(messageTrimmed);

        if (choseDeny) {
            return await respond(onboardingCopy.consentDenied());
        }

        if (choseAuthorize) {
            onboarding.step = 'PROFILE_NAME';
            await analyticsService.track('onboarding_consent_given', {
                phone: normalizedPhone,
                source: 'whatsapp'
            });
            const questionText = onboardingCopy.profileNameQuestion();
            return await respond(questionText, true);
        }

        return await respond(onboardingCopy.invalidChoice());
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
        return await respond(onboardingCopy.profileClinicQuestion());
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
        return await respond(onboardingCopy.profileRoleQuestion());
    }

    async handleProfileRole(onboarding, messageTrimmed, respond) {
        const role = validateChoice(messageTrimmed, {
            'dona_gestora': ['1', 'dona', 'gestora'],
            'adm_financeiro': ['2', 'adm', 'financeiro'],
            'secretaria': ['3', 'secretária', 'secretaria'],
            'profissional': ['4', 'profissional', 'aplico']
        });

        if (!role) {
            return await respond(onboardingCopy.invalidChoice());
        }

        onboarding.data.role = role;
        onboarding.step = 'PROFILE_ADD_MEMBER';
        // Inicializa lista de membros a adicionar
        onboarding.data.members_to_add = [];
        // Garante que adding_member está false na primeira vez
        onboarding.data.adding_member = false;
        console.log('[ONBOARDING] PROFILE_ROLE → PROFILE_ADD_MEMBER, role:', role);
        return await respond(onboardingCopy.profileAddMemberQuestion(), true); // Persist imediato
    }

    async handleProfileAddMember(onboarding, messageTrimmed, respond) {
        const v = normalizeText(messageTrimmed);
        
        // Se está no início (primeira vez neste step)
        // Se adding_member não existe ou é false, significa que acabou de entrar neste step
        if (!onboarding.data.adding_member && !onboarding.data.current_member_step) {
            console.log('[ONBOARDING] PROFILE_ADD_MEMBER - primeira vez, mensagem:', messageTrimmed);
            // Pergunta se quer adicionar membro
            const wantsToAdd = v === '1' || v === 'sim' || v.includes('adicionar');
            const skip = v === '2' || v === 'não' || v === 'nao' || v.includes('depois');
            
            if (wantsToAdd) {
                onboarding.data.adding_member = true;
                onboarding.data.current_member_step = 'ROLE';
                return await respond(onboardingCopy.profileAddMemberRoleQuestion());
            }
            
            if (skip) {
                // Prossegue para próximo passo
                console.log('[ONBOARDING] PROFILE_ADD_MEMBER - pulando, indo para CONTEXT_WHY');
                onboarding.step = 'CONTEXT_WHY';
                delete onboarding.data.adding_member;
                delete onboarding.data.current_member_step;
                return await respond(onboardingCopy.contextWhyQuestion());
            }
            
            // Se não é nem sim nem não, mostra a pergunta novamente
            console.log('[ONBOARDING] PROFILE_ADD_MEMBER - resposta inválida, mostrando pergunta novamente');
            return await respond(onboardingCopy.profileAddMemberQuestion());
        }
        
        // Coletando função
        if (onboarding.data.current_member_step === 'ROLE') {
            const role = validateChoice(messageTrimmed, {
                'dona': ['1', 'dona', 'gestora'],
                'adm': ['2', 'adm', 'financeiro'],
                'secretaria': ['3', 'secretária', 'secretaria'],
                'profissional': ['4', 'profissional']
            });
            
            if (!role) {
                return await respond(onboardingCopy.invalidChoice());
            }
            
            onboarding.data.current_member_function = role;
            onboarding.data.current_member_step = 'NAME';
            return await respond(onboardingCopy.profileAddMemberNameQuestion());
        }
        
        // Coletando nome
        if (onboarding.data.current_member_step === 'NAME') {
            // Detecta se o usuário enviou um número (telefone) no lugar do nome
            const phonePattern = /^\d{10,15}$/;
            const digitsOnly = messageTrimmed.replace(/\D/g, '');
            const looksLikePhone = phonePattern.test(digitsOnly) && digitsOnly.length >= 10;
            
            if (looksLikePhone) {
                // Usuário enviou número no lugar do nome - oferece opção de corrigir
                onboarding.data.temp_phone_entered = messageTrimmed.trim();
                onboarding.data.current_member_step = 'NAME_CORRECTION';
                return await respond(onboardingCopy.profileAddMemberNameCorrection());
            }
            
            if (messageTrimmed.length < MIN_NAME_LENGTH) {
                return await respond(onboardingCopy.nameTooShort());
            }
            
            onboarding.data.current_member_name = messageTrimmed.trim();
            onboarding.data.current_member_step = 'PHONE';
            return await respond(onboardingCopy.profileAddMemberPhoneQuestion());
        }
        
        // Opção de correção quando número foi enviado no lugar do nome
        if (onboarding.data.current_member_step === 'NAME_CORRECTION') {
            const v = normalizeText(messageTrimmed);
            const wantsToCorrect = v === '1' || v === 'sim' || v.includes('corrigir') || v.includes('corrige');
            const wantsToContinue = v === '2' || v === 'não' || v === 'nao' || v.includes('continuar');
            
            if (wantsToCorrect) {
                // Volta para pedir o nome novamente
                onboarding.data.current_member_step = 'NAME';
                delete onboarding.data.temp_phone_entered;
                return await respond(onboardingCopy.profileAddMemberNameQuestion());
            }
            
            if (wantsToContinue) {
                // Usa o número como nome (improvável, mas permite continuar)
                // E usa o número temporário como telefone
                onboarding.data.current_member_name = onboarding.data.temp_phone_entered || 'Sem nome';
                onboarding.data.current_member_step = 'PHONE';
                delete onboarding.data.temp_phone_entered;
                return await respond(onboardingCopy.profileAddMemberPhoneQuestion());
            }
            
            return await respond(onboardingCopy.profileAddMemberNameCorrection());
        }
        
        // Coletando telefone
        if (onboarding.data.current_member_step === 'PHONE') {
            // Permite voltar para corrigir o nome digitando "corrigir" ou "voltar"
            const v = normalizeText(messageTrimmed);
            if (v === 'corrigir' || v === 'voltar' || v === 'corrige' || v.includes('corrigir nome') || v.includes('voltar nome')) {
                onboarding.data.current_member_step = 'NAME';
                return await respond(onboardingCopy.profileAddMemberNameQuestion() + '\n\n(Digite o nome correto)');
            }
            
            const phone = normalizePhone(messageTrimmed) || messageTrimmed;
            
            // Valida formato do telefone (mínimo 10 dígitos)
            if (!/^\d{10,15}$/.test(phone.replace(/\D/g, ''))) {
                return await respond(onboardingCopy.profileAddMemberInvalidPhone() + '\n\n💡 Dica: Se quiser corrigir o nome, digite "corrigir"');
            }
            
            // Adiciona à lista de membros
            onboarding.data.members_to_add.push({
                nome: onboarding.data.current_member_name,
                telefone: phone,
                funcao: onboarding.data.current_member_function
            });
            
            // Limpa dados temporários do membro atual
            delete onboarding.data.current_member_function;
            delete onboarding.data.current_member_name;
            delete onboarding.data.current_member_step;
            delete onboarding.data.adding_member;
            delete onboarding.data.temp_phone_entered;
            
            // Pergunta se quer adicionar mais
            return await respond(onboardingCopy.profileAddMemberSuccess(
                onboarding.data.members_to_add[onboarding.data.members_to_add.length - 1].nome
            ));
        }
        
        return await respond(onboardingCopy.invalidChoice());
    }

    async handleContextWhy(onboarding, messageTrimmed, respond) {
        const why = validateChoice(messageTrimmed, {
            'organizar_dia_a_dia': ['1', 'organizar', 'dia a dia'],
            'clareza_mes': ['2', 'clareza', 'mês', 'mes'],
            'controlar_custos': ['3', 'controlar', 'custos']
        });

        if (!why) {
            return await respond(onboardingCopy.invalidChoice());
        }

        onboarding.data.context_why = why;
        onboarding.step = 'CONTEXT_HOW';
        return await respond(onboardingCopy.contextHowQuestion());
    }

    async handleContextHow(onboarding, messageTrimmed, normalizedPhone, respond) {
        const how = validateChoice(messageTrimmed, {
            'mais_pix': ['1', 'pix'],
            'mais_cartao': ['2', 'cartão', 'cartao'],
            'meio_a_meio': ['3', 'meio a meio', 'meio']
        });

        if (!how) {
            return await respond(onboardingCopy.invalidChoice());
        }

        onboarding.data.context_how = how;
        onboarding.step = 'AHA_REVENUE';
        await analyticsService.track('onboarding_context_collected', {
            phone: normalizedPhone,
            source: 'whatsapp',
            properties: { why: onboarding.data.context_why, how }
        });
        return await respond(onboardingCopy.ahaRevenuePrompt(onboarding.data.nome || ''), true); // Persist imediato
    }

    async handleAhaRevenue(onboarding, messageTrimmed, respond) {
        // REMOVIDO: Chamada Gemini desnecessária (já foi corrigido na análise)
        // Usa apenas heurísticas locais
        
        const valorResult = validateAndExtractValue(messageTrimmed, onboardingCopy.ahaRevenueMissingValue());
        if (!valorResult.valid) {
            return await respond(valorResult.error);
        }

        const heur = extractSaleHeuristics(messageTrimmed);
        const sale = {
            paciente: heur.paciente,
            procedimento: heur.procedimento,
            valor: valorResult.valor,
            forma_pagamento: heur.forma_pagamento,
            parcelas: heur.parcelas,
            bandeira_cartao: null,
            data: new Date().toISOString().split('T')[0]
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
            procedimento: sale.procedimento || '—',
            valor: sale.valor,
            pagamento: sale.forma_pagamento === 'parcelado' ? `Cartão ${sale.parcelas}x` : sale.forma_pagamento,
            data: formatDate(sale.data)
        }), true); // Persist imediato - dados importantes coletados
    }

    async handleAhaRevenueConfirm(onboarding, messageTrimmed, normalizedPhone, respond, respondAndClear) {
        const confirmed = isYes(messageTrimmed);
        const correction = isNo(messageTrimmed);

        if (correction) {
            onboarding.step = 'AHA_REVENUE';
            return await respond(onboardingCopy.ahaRevenuePrompt(onboarding.data.nome || ''));
        }

        if (confirmed) {
            const sale = onboarding.data.pending_sale;
            if (!sale) {
                onboarding.step = 'AHA_REVENUE';
                return await respond(onboardingCopy.ahaRevenuePrompt(onboarding.data.nome || ''));
            }

            // Correção #6 e #8: Validar criação de usuário adequadamente
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

            // Cria clinic_members (membro primário e adicionais)
            if (userId && profileJustCreated) {
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
                            console.log(`[ONBOARDING] Cache invalidado para membro: ${normalizedMemberPhone}`);
                        }
                    }
                    
                    if (membersToAdd.length > 0) {
                        console.log(`[ONBOARDING] ${membersToAdd.length} membros adicionais cadastrados para clínica ${userId}`);
                    }
                    
                    // Também invalida cache do telefone principal após criar membros
                    const primaryCacheKey = `phone:profile:${normalizedPhone}`;
                    await cacheService.delete(primaryCacheKey);
                } catch (memberError) {
                    // Não falha o onboarding se erro em clinic_members
                    console.error('[ONBOARDING] Erro ao criar clinic_members:', memberError);
                }
            }

            // Correção #1: Tratamento de erro ao registrar venda
            if (userId) {
                let saleSaved = false;
                try {
                    const atendimento = await transactionController.createAtendimento(userId, {
                        valor: sale.valor,
                        categoria: sale.procedimento || 'Procedimento',
                        descricao: sale.procedimento || `Venda ${sale.paciente ? `para ${sale.paciente}` : ''}`,
                        data: sale.data,
                        forma_pagamento: sale.forma_pagamento === 'parcelado' ? 'parcelado' : sale.forma_pagamento,
                        parcelas: sale.parcelas,
                        bandeira_cartao: sale.bandeira_cartao,
                        nome_cliente: sale.paciente
                    });

                    // Verifica se foi salva com sucesso (createAtendimento retorna o objeto diretamente)
                    if (atendimento && atendimento.id) {
                        saleSaved = true;
                        sale.saved = true; // Marca como salva
                        sale.savedId = atendimento.id; // Guarda ID para referência

                        await analyticsService.track('onboarding_revenue_registered', {
                            phone: normalizedPhone,
                            userId,
                            source: 'whatsapp',
                            properties: { valor: sale.valor }
                        });
                    } else {
                        // Se não retornou objeto com id, considera falha
                        console.error('[ONBOARDING] createAtendimento não retornou objeto válido:', atendimento);
                        return await respond(onboardingCopy.revenueSaveError());
                    }
                } catch (e) {
                    console.error('[ONBOARDING] Erro ao registrar venda:', e);
                    // Informa usuário do erro
                    return await respond(onboardingCopy.revenueSaveError());
                }

                // Se não salvou, não avança
                if (!saleSaved) {
                    return await respond(onboardingCopy.revenueSaveError());
                }
            } else {
                // Se não tem userId, não pode salvar
                return await respond(onboardingCopy.userCreationError());
            }

            onboarding.step = 'AHA_COSTS_INTRO';
            // Persistência crítica após salvar transação
            return await respond(onboardingCopy.ahaRevenueRegistered() + '\n\n' + onboardingCopy.ahaCostsIntro(), true, true);
        }

        return await respond(onboardingCopy.invalidChoice());
    }

    async handleAhaCostsIntro(onboarding, messageTrimmed, respond) {
        const costType = validateChoice(messageTrimmed, {
            'fixo': ['1', 'fixo'],
            'variável': ['2', 'variável', 'variavel'],
            'não_sei': ['3', 'não sei', 'nao sei']
        });

        if (costType === 'não_sei') {
            return await respond(onboardingCopy.ahaCostsDontKnow());
        }

        if (!costType) {
            return await respond(onboardingCopy.invalidChoice());
        }

        onboarding.data.cost_type = costType;
        onboarding.step = 'AHA_COSTS_UPLOAD';
        if (costType === 'fixo') {
            return await respond(onboardingCopy.ahaCostsUploadFixed());
        } else {
            return await respond(onboardingCopy.ahaCostsUploadVariable());
        }
    }

    async handleAhaCostsUpload(onboarding, messageTrimmed, mediaUrl, fileName, respond) {
        // Correção #9: Só processa documento se não tem texto válido
        const valorFromText = extractBestAmountFromText(messageTrimmed);
        
        // Se tem valor no texto, ignora documento
        if (valorFromText && valorFromText > 0) {
            const costType = onboarding.data.cost_type || 'variável';
            onboarding.data.pending_cost = {
                valor: valorFromText,
                tipo: costType === 'fixo' ? 'fixa' : 'variavel',
                descricao: messageTrimmed,
                data: new Date().toISOString().split('T')[0]
            };
            onboarding.step = 'AHA_COSTS_CATEGORY';
            return await respond(onboardingCopy.ahaCostsCategoryQuestion());
        }

        // Correção #3: Tratamento de erro em processamento de documento
        // Se recebeu documento E não tem valor no texto, processa documento
        if (mediaUrl) {
            try {
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/59a99cd5-7421-4f77-be12-78a36db4788f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'onboardingFlowService.js:596',message:'handleAhaCostsUpload calling processImage',data:{hasMediaUrl:!!mediaUrl,urlPreview:mediaUrl?.substring(0,50)||'none',messageKey:'null',step:onboarding.step},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                // #endregion
                // Timeout para processamento de documento (30 segundos)
                const processPromise = documentService.processImage(mediaUrl, null);
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout ao processar documento')), 30000)
                );
                
                const result = await Promise.race([processPromise, timeoutPromise]);
                
                let transacao = null;
                if (result.transacoes && result.transacoes.length > 0) {
                    transacao = result.transacoes.find(t => t.tipo === 'saida') || result.transacoes[0];
                }
                
                if (transacao && transacao.valor) {
                    onboarding.data.pending_cost_document = {
                        valor: transacao.valor,
                        categoria: transacao.categoria || 'Outros',
                        descricao: transacao.descricao || fileName || 'Documento',
                        data: transacao.data || new Date().toISOString().split('T')[0],
                        fornecedor: transacao.categoria || '—'
                    };
                    onboarding.step = 'AHA_COSTS_DOCUMENT_TYPE';
                    return await respond(onboardingCopy.documentReceivedMessage({
                        valor: transacao.valor,
                        vencimento: transacao.data ? formatDate(transacao.data) : '—',
                        fornecedor: transacao.categoria || '—'
                    }));
                } else {
                    // Documento processado mas não extraiu transação válida
                    return await respond(onboardingCopy.documentProcessError());
                }
            } catch (e) {
                console.error('[ONBOARDING] Erro ao processar documento:', e);
                // Informa usuário do erro e oferece alternativa
                return await respond(onboardingCopy.documentProcessError());
            }
        }

        // Se não conseguiu extrair valor nem do texto nem do documento
        return await respond(onboardingCopy.costValueNotFound());
    }

    async handleAhaCostsDocumentType(onboarding, messageTrimmed, respond) {
        const choice = validateChoice(messageTrimmed, {
            'fixo': ['1', 'fixo'],
            'variavel': ['2', 'variável', 'variavel']
        });

        if (!choice) {
            return await respond(onboardingCopy.invalidChoice());
        }

        const isFixo = choice === 'fixo';
        const isVariavel = choice === 'variavel';

        const doc = onboarding.data.pending_cost_document;
        if (doc) {
            onboarding.data.pending_cost = {
                valor: doc.valor,
                tipo: isFixo ? 'fixa' : 'variavel',
                descricao: doc.descricao || doc.fileName || 'Documento',
                data: doc.data || new Date().toISOString().split('T')[0],
                categoria: doc.categoria || null
            };
            
            if (doc.categoria && doc.categoria !== 'Outros') {
                onboarding.step = 'AHA_COSTS_CONFIRM';
                return await respond(onboardingCopy.ahaCostsConfirmation({
                    tipo: onboarding.data.pending_cost.tipo === 'fixa' ? 'Fixo' : 'Variável',
                    categoria: doc.categoria,
                    valor: doc.valor,
                    data: formatDate(doc.data)
                }));
            }
        }
        onboarding.step = 'AHA_COSTS_CATEGORY';
        return await respond(onboardingCopy.ahaCostsCategoryQuestion());
    }

    async handleAhaCostsCategory(onboarding, messageTrimmed, respond) {
        const categoria = validateChoice(messageTrimmed, {
            'Insumos / materiais': ['1', 'insumo', 'material'],
            'Aluguel': ['2', 'aluguel'],
            'Salários': ['3', 'salário', 'salario'],
            'Marketing': ['4', 'marketing', 'publicidade'],
            'Impostos': ['5', 'imposto'],
            'Outros': ['6']
        }) || 'Outros';

        if (!onboarding.data.pending_cost) {
            onboarding.step = 'AHA_COSTS_UPLOAD';
            return await respond(onboardingCopy.costErrorRetry());
        }

        onboarding.data.pending_cost.categoria = categoria;
        onboarding.step = 'AHA_COSTS_CONFIRM';
        return await respond(onboardingCopy.ahaCostsConfirmation({
            tipo: onboarding.data.pending_cost.tipo === 'fixa' ? 'Fixo' : 'Variável',
            categoria,
            valor: onboarding.data.pending_cost.valor,
            data: formatDate(onboarding.data.pending_cost.data)
        }));
    }

    async handleAhaCostsConfirm(onboarding, messageTrimmed, normalizedPhone, respond) {
        const confirmed = isYes(messageTrimmed);
        const correction = isNo(messageTrimmed);

        if (correction) {
            onboarding.step = 'AHA_COSTS_CATEGORY';
            return await respond(onboardingCopy.ahaCostsCategoryQuestion());
        }

        if (confirmed) {
            const cost = onboarding.data.pending_cost;
            if (!cost) {
                onboarding.step = 'AHA_COSTS_UPLOAD';
                return await respond(onboardingCopy.costErrorRetry());
            }

            // Correção #1: Tratamento de erro ao registrar custo
            const userId = onboarding.data.userId;
            if (userId) {
                let costSaved = false;
                try {
                    const conta = await transactionController.createContaPagar(userId, {
                        valor: cost.valor,
                        categoria: cost.categoria,
                        descricao: cost.descricao,
                        data: cost.data,
                        tipo: cost.tipo
                    });

                    // Verifica se foi salva com sucesso (createContaPagar retorna o objeto diretamente)
                    if (conta && conta.id) {
                        costSaved = true;
                        cost.saved = true; // Marca como salva
                        cost.savedId = conta.id; // Guarda ID para referência

                        await analyticsService.track('onboarding_cost_registered', {
                            phone: normalizedPhone,
                            userId,
                            source: 'whatsapp',
                            properties: { valor: cost.valor, tipo: cost.tipo }
                        });
                    } else {
                        // Se não retornou objeto com id, considera falha
                        console.error('[ONBOARDING] createContaPagar não retornou objeto válido:', conta);
                        return await respond(onboardingCopy.costSaveError());
                    }
                } catch (e) {
                    console.error('[ONBOARDING] Erro ao registrar custo:', e);
                    // Informa usuário do erro
                    return await respond(onboardingCopy.costSaveError());
                }

                // Se não salvou, não avança
                if (!costSaved) {
                    return await respond(onboardingCopy.costSaveError());
                }
            } else {
                // Se não tem userId, não pode salvar
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
                    onboarding.data.cost_type = 'fixo';
                    onboarding.step = 'AHA_COSTS_UPLOAD';
                    return await respond(onboardingCopy.ahaCostsSecondIntroFixed(), true);
                } else if (currentCostType === 'fixa' && !hasVariableCost) {
                    // Foi fixo, agora pede variável
                    onboarding.data.cost_type = 'variável';
                    onboarding.step = 'AHA_COSTS_UPLOAD';
                    return await respond(onboardingCopy.ahaCostsSecondIntroVariable(), true);
                }
            }

            // Se já tem os dois tipos, vai para o resumo
            onboarding.step = 'AHA_SUMMARY';
            // Correção #2: Usa dados salvos (com flag saved) para calcular resumo
            const summary = calculateSummaryFromOnboardingData(onboarding);
            // Persistência crítica após salvar transação
            return await respond(onboardingCopy.ahaCostsRegistered() + '\n\n' + onboardingCopy.ahaSummary(summary), true, true);
        }

        return await respond(onboardingCopy.invalidChoice());
    }

    async handleAhaSummary(onboarding, normalizedPhone, respond) {
        onboarding.step = 'HANDOFF_TO_DAILY_USE';
        await analyticsService.track('onboarding_summary_viewed', {
            phone: normalizedPhone,
            userId: onboarding.data.userId || null,
            source: 'whatsapp'
        });
        return await respond(onboardingCopy.handoffToDailyUse());
    }

    async handleHandoffToDailyUse(onboarding, messageTrimmed, normalizedPhone, respond, respondAndClear) {
        const v = normalizeText(messageTrimmed);
        
        if (v === '1' || v.includes('registrar venda') || v.includes('venda')) {
            return await respondAndClear(onboardingCopy.handoffRegisterSale());
        }
        
        if (v === '2' || v.includes('registrar custo') || v.includes('custo')) {
            return await respondAndClear(onboardingCopy.handoffRegisterCost());
        }
        
        if (v === '3' || v.includes('resumo') || v.includes('ver resumo')) {
            return await respondAndClear(onboardingCopy.handoffShowSummary());
        }

        // Detecta se a mensagem parece ser uma transação (venda ou custo)
        // Se for, finaliza onboarding automaticamente e processa como transação normal
        const intentHeuristicService = require('./intentHeuristicService');
        const intent = await intentHeuristicService.detectIntent(messageTrimmed);
        
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

        onboarding.step = 'MDR_SETUP_INTRO';
        return await respond(onboardingCopy.mdrSetupIntro());
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
        const intent = await intentHeuristicService.detectIntent(messageTrimmed);
        
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

        return await respond(onboardingCopy.invalidChoice());
    }

    async handleMdrSetupQuestion(onboarding, messageTrimmed, respond) {
        const num = parseInt(messageTrimmed, 10);
        if (isNaN(num) || num < 1) {
            return await respond(onboardingCopy.mdrInvalidNumber());
        }

        onboarding.data.mdr_count = num;
        onboarding.data.mdr_current = 1;
        onboarding.step = 'MDR_SETUP_UPLOAD';
        return await respond(onboardingCopy.mdrSetupUpload());
    }

    async handleMdrSetupUpload(onboarding, mediaUrl, respond) {
        if (mediaUrl) {
            const current = onboarding.data.mdr_current || 1;
            const total = onboarding.data.mdr_count || 1;

            if (current < total) {
                onboarding.data.mdr_current = current + 1;
                return await respond(onboardingCopy.mdrPrintReceived({ current, total }));
            } else {
                onboarding.step = 'MDR_SETUP_COMPLETE';
                return await respond(onboardingCopy.mdrSetupReinforcement() + '\n\n' + onboardingCopy.mdrSetupComplete());
            }
        } else {
            return await respond(onboardingCopy.mdrNeedPhoto());
        }
    }

    async handleMdrSetupComplete(respond, respondAndClear) {
        return await respondAndClear(onboardingCopy.mdrSetupComplete());
    }
}

class OnboardingFlowService {
    constructor() {
        this.onboardingStates = new Map();
        this.onboardingData = this.onboardingStates;
        this.persistTimers = new Map(); // Correção #4: Debounce persistência
        this.handlers = new OnboardingStateHandlers(this);
        
        // Correção #2: Limpeza automática de estados antigos
        setInterval(() => {
            this.cleanupOldStates();
        }, STATE_CLEANUP_INTERVAL_MS);
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
            console.log(`[ONBOARDING] Limpeza automática: ${cleaned} estados antigos removidos`);
        }
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

    async startIntroFlow(phone) {
        const normalizedPhone = normalizePhone(phone) || phone;
        
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
            console.error('[ONBOARDING] Falha ao carregar estado persistido:', e?.message || e);
        }

        this.onboardingStates.set(normalizedPhone, {
            step: 'START',
            startTime: Date.now(),
            data: {
                telefone: normalizedPhone
            }
        });

        await analyticsService.track('onboarding_whatsapp_started', {
            phone: normalizedPhone,
            source: 'whatsapp'
        });

        return onboardingCopy.startMessage();
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
                // Retorna mensagem apropriada baseada no sub-step
                if (onboarding.data?.current_member_step === 'ROLE') {
                    return onboardingCopy.profileAddMemberRoleQuestion();
                } else if (onboarding.data?.current_member_step === 'NAME') {
                    return onboardingCopy.profileAddMemberNameQuestion();
                } else if (onboarding.data?.current_member_step === 'NAME_CORRECTION') {
                    return onboardingCopy.profileAddMemberNameCorrection();
                } else if (onboarding.data?.current_member_step === 'PHONE') {
                    return onboardingCopy.profileAddMemberPhoneQuestion();
                }
                // Primeira vez neste step - mostra pergunta se quer adicionar
                return onboardingCopy.profileAddMemberQuestion();
            case 'CONTEXT_WHY':
                return onboardingCopy.contextWhyQuestion();
            case 'CONTEXT_HOW':
                return onboardingCopy.contextHowQuestion();
            case 'AHA_REVENUE':
                return onboardingCopy.ahaRevenuePrompt(nome);
            case 'AHA_REVENUE_CONFIRM':
                const sale = onboarding.data?.pending_sale;
                if (sale) {
                    return onboardingCopy.ahaRevenueConfirmation({
                        procedimento: sale.procedimento || '—',
                        valor: sale.valor,
                        pagamento: sale.forma_pagamento || 'Não informado',
                        data: sale.data || 'Hoje'
                    });
                }
                return onboardingCopy.ahaRevenuePrompt(nome);
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
                return onboardingCopy.ahaCostsCategoryQuestion();
            case 'AHA_COSTS_CONFIRM':
                const cost = onboarding.data?.pending_cost;
                if (cost) {
                    return onboardingCopy.ahaCostsConfirmation({
                        tipo: cost.tipo === 'fixa' ? 'Fixo' : 'Variável',
                        categoria: cost.categoria || 'Outros',
                        valor: cost.valor,
                        data: cost.data || 'Hoje'
                    });
                }
                return onboardingCopy.ahaCostsCategoryQuestion();
            case 'AHA_SUMMARY':
                return null;
            case 'HANDOFF_TO_DAILY_USE':
                return onboardingCopy.handoffToDailyUse();
            case 'MDR_SETUP_INTRO':
                return onboardingCopy.mdrSetupIntro();
            case 'MDR_SETUP_QUESTION':
                return onboardingCopy.mdrSetupQuestion();
            case 'MDR_SETUP_UPLOAD':
                return onboardingCopy.mdrSetupUpload();
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

    async processOnboarding(phone, message, mediaUrl = null, fileName = null) {
        const normalizedPhone = normalizePhone(phone) || phone;
        const onboarding = this.onboardingStates.get(normalizedPhone);
        if (!onboarding) {
            return null;
        }

        // Correção #11: Normalizar texto uma vez no início
        const messageTrimmed = message?.trim() || '';
        const messageLower = messageTrimmed.toLowerCase();

        // Correção #4: Debounce persistência
        const persistState = async (immediate = false) => {
            const existingTimer = this.persistTimers.get(normalizedPhone);
            if (existingTimer) {
                clearTimeout(existingTimer);
                this.persistTimers.delete(normalizedPhone);
            }

            const persist = async () => {
                try {
                    await onboardingService.upsertWhatsappState(normalizedPhone, {
                        step: onboarding.step,
                        data: onboarding.data
                    });
                    this.persistTimers.delete(normalizedPhone);
                } catch (e) {
                    console.error('[ONBOARDING] Falha ao persistir estado:', e?.message || e);
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
                }, PERSIST_DEBOUNCE_MS);
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
                case 'CONTEXT_HOW':
                    return await handlers.handleContextHow(onboarding, messageTrimmed, normalizedPhone, respond);
                case 'AHA_REVENUE':
                    return await handlers.handleAhaRevenue(onboarding, messageTrimmed, respond);
                case 'AHA_REVENUE_CONFIRM':
                    return await handlers.handleAhaRevenueConfirm(onboarding, messageTrimmed, normalizedPhone, respond, respondAndClear);
                case 'AHA_COSTS_INTRO':
                    return await handlers.handleAhaCostsIntro(onboarding, messageTrimmed, respond);
                case 'AHA_COSTS_UPLOAD':
                    return await handlers.handleAhaCostsUpload(onboarding, messageTrimmed, mediaUrl, fileName, respond);
                case 'AHA_COSTS_DOCUMENT_TYPE':
                    return await handlers.handleAhaCostsDocumentType(onboarding, messageTrimmed, respond);
                case 'AHA_COSTS_CATEGORY':
                    return await handlers.handleAhaCostsCategory(onboarding, messageTrimmed, respond);
                case 'AHA_COSTS_CONFIRM':
                    return await handlers.handleAhaCostsConfirm(onboarding, messageTrimmed, normalizedPhone, respond);
                case 'AHA_SUMMARY':
                    return await handlers.handleAhaSummary(onboarding, normalizedPhone, respond);
                case 'HANDOFF_TO_DAILY_USE':
                    return await handlers.handleHandoffToDailyUse(onboarding, messageTrimmed, normalizedPhone, respond, respondAndClear);
                case 'MDR_SETUP_INTRO':
                    return await handlers.handleMdrSetupIntro(onboarding, messageTrimmed, normalizedPhone, respond, respondAndClear);
                case 'MDR_SETUP_QUESTION':
                    return await handlers.handleMdrSetupQuestion(onboarding, messageTrimmed, respond);
                case 'MDR_SETUP_UPLOAD':
                    return await handlers.handleMdrSetupUpload(onboarding, mediaUrl, respond);
                case 'MDR_SETUP_COMPLETE':
                    return await handlers.handleMdrSetupComplete(respond, respondAndClear);
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
                console.error('[ONBOARDING] Erro ao gerar resposta de erro:', respondError);
                return 'Ops, me perdi. Digite "Oi" para recomeçar.';
            }
        }
    }
}

module.exports = new OnboardingFlowService();
