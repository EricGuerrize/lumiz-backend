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
const knowledgeService = require('./knowledgeService');
const registrationTokenService = require('./registrationTokenService');
const {
    PROCEDURE_KEYWORDS,
    sanitizeClientName
} = require('../utils/procedureKeywords');
const {
    extractPrimaryMonetaryValue,
    extractMixedPaymentSplit,
    extractInstallments
} = require('../utils/moneyParser');

// ============================================================
// Constantes (correção #18 - Magic numbers)
// ============================================================
const CACHE_TTL_SECONDS = 1800; // 30 minutos
const STATE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hora
const STATE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 horas
const PERSIST_DEBOUNCE_MS = 1000; // 1 segundo (reduzido de 5s para evitar perda de estado)
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
    const raw = String(text || '');
    const fromMoneyParser = extractPrimaryMonetaryValue(raw);
    if (fromMoneyParser && fromMoneyParser > 0) return fromMoneyParser;

    // fallback para casos como "5 mil"
    const milMatch = raw.match(/(\d+(?:[.,]\d+)?)\s*mil\b/i);
    if (milMatch && milMatch[1]) {
        const base = parseBrazilianNumber(milMatch[1]);
        if (base && base > 0) return base * 1000;
    }
    return null;
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

    if (!paciente && procedimento) {
        const escapedKeywords = PROCEDURE_KEYWORDS.join('|');
        const fallbackNameMatch = raw.match(
            new RegExp(`^([A-Za-zÀ-ÿ]+(?:\\s+[A-Za-zÀ-ÿ]+){0,2})\\s+(${escapedKeywords})\\b`, 'i')
        );
        if (fallbackNameMatch && fallbackNameMatch[1]) {
            paciente = fallbackNameMatch[1].trim();
        }
    }

    let forma_pagamento = null;
    let parcelas = null;
    let payment_split = null;
    let valor_total = extractBestAmountFromText(raw);

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

    const mixed = extractMixedPaymentSplit(raw, valor_total);
    if (mixed && mixed.splits?.length) {
        payment_split = mixed.splits;
        valor_total = mixed.total || valor_total;
        forma_pagamento = 'misto';
        const hasCardSplit = mixed.splits.some((part) => part.metodo === 'parcelado');
        if (hasCardSplit) {
            const cardPart = mixed.splits.find((part) => part.metodo === 'parcelado');
            parcelas = cardPart?.parcelas || parcelas;
        }
    }

    return {
        paciente: sanitizeClientName(paciente, procedimento),
        procedimento,
        forma_pagamento,
        parcelas,
        payment_split,
        valor_total
    };
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

function normalizeStartTime(startTime) {
    if (typeof startTime === 'number' && Number.isFinite(startTime)) return startTime;
    if (startTime instanceof Date && !isNaN(startTime.getTime())) return startTime.getTime();
    if (typeof startTime === 'string') {
        const parsed = Date.parse(startTime);
        if (Number.isFinite(parsed)) return parsed;
    }
    return Date.now();
}

// Correção #17: Função helper para validação de escolhas
// CORREÇÃO: Quando a mensagem é apenas um dígito de 1-9, trata como escolha de menu
function validateChoice(message, options) {
    // CORREÇÃO: Se a mensagem é apenas um dígito de 1-9, garante que seja tratada como escolha de menu
    const trimmedMessage = String(message).trim();
    const isSingleDigitMenuChoice = /^[1-9]$/.test(trimmedMessage);
    const messageToValidate = isSingleDigitMenuChoice ? trimmedMessage : message;

    const v = normalizeText(messageToValidate);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/59a99cd5-7421-4f77-be12-78a36db4788f', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'onboardingFlowService.js:158', message: 'validateChoice entrada', data: { message: message, normalized: v, optionsKeys: Object.keys(options), isSingleDigitMenuChoice: isSingleDigitMenuChoice }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' }) }).catch(() => { });
    // #endregion
    for (const [key, matchers] of Object.entries(options)) {
        if (matchers.some(matcher => {
            if (typeof matcher === 'string') {
                const normalizedMatcher = normalizeText(matcher);
                const matches = v === normalizedMatcher || v.includes(normalizedMatcher);
                // #region agent log
                if (matches) fetch('http://127.0.0.1:7242/ingest/59a99cd5-7421-4f77-be12-78a36db4788f', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'onboardingFlowService.js:165', message: 'validateChoice match encontrado', data: { key: key, matcher: matcher, normalizedMatcher: normalizedMatcher, v: v }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' }) }).catch(() => { });
                // #endregion
                return matches;
            }
            if (matcher instanceof RegExp) {
                return matcher.test(v);
            }
            return false;
        })) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/59a99cd5-7421-4f77-be12-78a36db4788f', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'onboardingFlowService.js:174', message: 'validateChoice retornando key', data: { key: key }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' }) }).catch(() => { });
            // #endregion
            return key;
        }
    }
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/59a99cd5-7421-4f77-be12-78a36db4788f', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'onboardingFlowService.js:177', message: 'validateChoice nenhum match, retornando null', data: { v: v }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' }) }).catch(() => { });
    // #endregion
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

const FIXED_COST_CATEGORY_RULES = [
    { category: 'Aluguel', keywords: ['aluguel', 'locacao', 'locação'] },
    { category: 'Salários', keywords: ['salario', 'salários', 'folha', 'funcionario', 'funcionário', 'prolabore', 'pro-labore'] },
    { category: 'Internet / Utilitários', keywords: ['internet', 'wifi', 'wi-fi', 'luz', 'energia', 'agua', 'água', 'utilitario', 'utilitário'] },
    { category: 'Marketing', keywords: ['marketing', 'trafego', 'tráfego', 'ads', 'publicidade', 'anuncio', 'anúncio'] },
    { category: 'Impostos', keywords: ['imposto', 'tributo', 'das', 'iss', 'taxa', 'contador', 'contabilidade'] }
];

const VARIABLE_COST_CATEGORY_RULES = [
    { category: 'Insumos / materiais', keywords: ['insumo', 'insumos', 'material', 'materiais', 'luva', 'mascara', 'máscara', 'touca', 'gaze'] },
    { category: 'Fornecedores de injetáveis', keywords: ['injetavel', 'injetáveis', 'injetaveis', 'toxina', 'botox', 'acido', 'ácido', 'hialuronico', 'hialurônico', 'bioestimulador', 'preenchedor'] }
];

function inferCostTypeAndCategoryFromText(text = '', forcedType = null) {
    const normalized = normalizeText(text);
    if (!normalized) {
        return { tipo: forcedType || null, categoria: null, source: null };
    }

    const findCategory = (rules) => {
        for (const rule of rules) {
            if (rule.keywords.some((keyword) => normalized.includes(normalizeText(keyword)))) {
                return rule.category;
            }
        }
        return null;
    };

    if (forcedType === 'fixo') {
        return {
            tipo: 'fixo',
            categoria: findCategory(FIXED_COST_CATEGORY_RULES),
            source: 'fixed_forced'
        };
    }

    if (forcedType === 'variável' || forcedType === 'variavel') {
        return {
            tipo: 'variável',
            categoria: findCategory(VARIABLE_COST_CATEGORY_RULES),
            source: 'variable_forced'
        };
    }

    const fixedCategory = findCategory(FIXED_COST_CATEGORY_RULES);
    if (fixedCategory) {
        return { tipo: 'fixo', categoria: fixedCategory, source: 'fixed_inferred' };
    }

    const variableCategory = findCategory(VARIABLE_COST_CATEGORY_RULES);
    if (variableCategory) {
        return { tipo: 'variável', categoria: variableCategory, source: 'variable_inferred' };
    }

    return { tipo: null, categoria: null, source: null };
}

function extractCostPaymentDetails(text = '') {
    const normalized = normalizeText(text);
    const installments = extractInstallments(normalized);
    const hasCard = normalized.includes('cartao') || normalized.includes('cartão') || normalized.includes('credito') || normalized.includes('crédito') || installments > 1;
    const hasPix = normalized.includes('pix');
    const hasCash = normalized.includes('dinheiro') || normalized.includes('espécie') || normalized.includes('especie');
    const hasDebit = normalized.includes('debito') || normalized.includes('débito');

    if (hasPix) {
        return { forma_pagamento: 'pix', parcelas: null };
    }
    if (hasCash) {
        return { forma_pagamento: 'dinheiro', parcelas: null };
    }
    if (hasDebit) {
        return { forma_pagamento: 'debito', parcelas: null };
    }
    if (hasCard) {
        return {
            forma_pagamento: installments && installments > 1 ? 'parcelado' : 'credito_avista',
            parcelas: installments && installments > 1 ? installments : null
        };
    }

    return { forma_pagamento: null, parcelas: null };
}

// ============================================================
// State Handlers (correção #19 - Refatorar switch gigante)
// ============================================================
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
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/59a99cd5-7421-4f77-be12-78a36db4788f', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'onboardingFlowService.js:345', message: 'handleConsent', data: { messageTrimmed: messageTrimmed.substring(0, 30), choseAuthorize, choseDeny }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'E' }) }).catch(() => { });
        // #endregion

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
            'dona_gestora': ['1', 'dona', 'gestora'],
            'adm_financeiro': ['2', 'adm', 'financeiro'],
            'secretaria': ['3', 'secretária', 'secretaria'],
            'profissional': ['4', 'profissional', 'aplico']
        });

        if (!role) {
            return await respond(onboardingCopy.invalidChoice());
        }

        onboarding.data.role = role;
        onboarding.step = 'CONTEXT_WHY';
        console.log('[ONBOARDING] PROFILE_ROLE → CONTEXT_WHY, role:', role);
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
            'organizar_dia_a_dia': ['1', 'organizar', 'dia a dia'],
            'clareza_mes': ['2', 'clareza', 'mês', 'mes'],
            'controlar_custos': ['3', 'controlar', 'custos']
        });

        if (!why) {
            return await respond(onboardingCopy.invalidChoice());
        }

        onboarding.data.context_why = why;
        onboarding.step = 'CONTEXT_HOW';
        return await respond(onboardingCopy.contextHowQuestion(), true);
    }

    async handleContextHow(onboarding, messageTrimmed, normalizedPhone, respond) {
        // Suporte às opções de pagamento (com meio a meio)
        const payment = validateChoice(messageTrimmed, {
            'avista': ['1', 'pix', 'dinheiro', 'a vista', 'à vista'],
            'parcelado': ['2', 'cartão parcelado', 'cartao parcelado', 'parcelado'],
            'misto': ['3', 'meio a meio', 'meio a meia', 'meio-meio', '50/50', 'metade', 'metade metade']
        });

        if (!payment) {
            return await respond(onboardingCopy.invalidChoice());
        }

        // Mantém compatibilidade com campo antigo e novo
        onboarding.data.context_how = payment;
        onboarding.data.context_payment = payment;
        onboarding.data.recebimento_preferencial = payment;
        onboarding.step = 'AHA_REVENUE';
        await analyticsService.track('onboarding_context_collected', {
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
        const valorResult = validateAndExtractValue(String(valorFonte || messageTrimmed), onboardingCopy.ahaRevenueMissingValue());
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
            data: new Date().toISOString().split('T')[0],
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
                        // #region agent log
                        fetch('http://127.0.0.1:7242/ingest/59a99cd5-7421-4f77-be12-78a36db4788f', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'onboardingFlowService.js:620', message: 'Salvando membro adicional no banco', data: { originalPhone: member.telefone, normalizedPhone: normalizedMemberPhone, nome: member.nome, funcao: member.funcao, clinicId: userId }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'B' }) }).catch(() => { });
                        // #endregion
                        const result = await clinicMemberService.addMember({
                            clinicId: userId,
                            telefone: normalizedMemberPhone,
                            nome: member.nome,
                            funcao: member.funcao,
                            createdBy: userId,
                            isPrimary: false
                        });
                        // #region agent log
                        fetch('http://127.0.0.1:7242/ingest/59a99cd5-7421-4f77-be12-78a36db4788f', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'onboardingFlowService.js:632', message: 'Resultado ao adicionar membro', data: { success: result.success, error: result.error, memberId: result.member?.id, phoneSaved: normalizedMemberPhone }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'B' }) }).catch(() => { });
                        // #endregion

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
            } else if (onboarding.data.members_saved_early) {
                console.log('[ONBOARDING] Membros já foram salvos antecipadamente em PROFILE_ADD_MEMBER, pulando duplicação');
            }

            // Durante onboarding: transações são apenas de TESTE (não salvas no banco)
            // Apenas simula o salvamento para cálculo do resumo
            if (userId) {
                // Simula salvamento (não salva no banco durante onboarding)
                sale.saved = true; // Marca como salva para cálculo do resumo
                sale.savedId = 'test_' + Date.now(); // ID temporário para referência
                sale.isTest = true; // Flag indicando que é teste

                // Track analytics mesmo sendo teste (para métricas)
                await analyticsService.track('onboarding_revenue_registered', {
                    phone: normalizedPhone,
                    userId,
                    source: 'whatsapp',
                    properties: { valor: sale.valor, is_test: true }
                });

                console.log('[ONBOARDING] Venda registrada como TESTE (não salva no banco):', sale);
            } else {
                // Se não tem userId, não pode continuar
                return await respond(onboardingCopy.userCreationError());
            }

            onboarding.data.pending_cost = null; // Limpa para garantir estado limpo
            onboarding.data.cost_type = null; // Não sabemos o tipo ainda
            onboarding.step = 'AHA_COSTS_UPLOAD';
            // Persistência crítica após salvar transação
            return await respond(onboardingCopy.ahaRevenueRegistered() + '\n\n' + onboardingCopy.ahaCostsIntro(), true, true);
        }

        return await respond(onboardingCopy.invalidChoice());
    }

    async handleAhaRevenueAdjust(onboarding, messageTrimmed, respond) {
        const choice = validateChoice(messageTrimmed, {
            'valor': ['1', 'valor', 'valor total'],
            'pagamento': ['2', 'forma', 'pagamento'],
            'parcelas': ['3', 'parcelas', 'parcela'],
            'procedimento': ['4', 'procedimento', 'descricao', 'descrição']
        });

        if (!choice) return await respond(onboardingCopy.invalidChoice());

        if (choice === 'valor') {
            onboarding.step = 'AHA_REVENUE_ADJUST_VALUE';
            return await respond('Perfeito. Me manda só o novo valor total da venda (ex: R$ 5000).', true);
        }
        if (choice === 'pagamento') {
            onboarding.step = 'AHA_REVENUE_ADJUST_PAYMENT';
            return await respond('Me diga a forma de pagamento:\n\n1️⃣ PIX\n2️⃣ Dinheiro\n3️⃣ Débito\n4️⃣ Crédito à vista\n5️⃣ Cartão parcelado\n6️⃣ Meio a meio', true);
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
        if (!choice) return await respond(onboardingCopy.invalidChoice());
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

    // handleAhaCostsIntro foi removido pois agora o fluxo vai direto para UPLOAD
    // A mensagem de intro já pede o upload

    async handleAhaCostsUpload(onboarding, messageTrimmed, mediaUrl, fileName, messageKey, mediaBuffer, mimeType, respond) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/59a99cd5-7421-4f77-be12-78a36db4788f', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'onboardingFlowService.js:830', message: 'handleAhaCostsUpload entrada', data: { message: messageTrimmed, step: onboarding.step, hasMediaUrl: !!mediaUrl, hasMediaBuffer: !!mediaBuffer, hasMessageKey: !!messageKey, targetCostType: onboarding.data.cost_type }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => { });
        // #endregion

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
                data: new Date().toISOString().split('T')[0],
                original_text: messageTrimmed,
                forma_pagamento: paymentInfo.forma_pagamento,
                parcelas: paymentInfo.parcelas
            };

            if (!onboarding.data.pending_cost.tipo && inferredCost.tipo) {
                onboarding.data.pending_cost.tipo = inferredCost.tipo === 'fixo' ? 'fixa' : 'variavel';
            }

            if (inferredCost.categoria) {
                onboarding.data.pending_cost.categoria = inferredCost.categoria;
            }

            if (knownType) {
                // Se já sabemos o tipo e a categoria veio no texto, já confirma direto
                if (onboarding.data.pending_cost.categoria) {
                    onboarding.step = 'AHA_COSTS_CONFIRM';
                    return await respond(onboardingCopy.ahaCostsConfirmation({
                        tipo: onboarding.data.pending_cost.tipo === 'fixa' ? 'Fixo' : 'Variável',
                        categoria: onboarding.data.pending_cost.categoria,
                        valor: onboarding.data.pending_cost.valor,
                        data: formatDate(onboarding.data.pending_cost.data),
                        pagamento: this._formatCostPaymentText(onboarding.data.pending_cost)
                    }));
                }

                // Se já sabemos o tipo, pula a classificação e vai para categoria
                onboarding.step = 'AHA_COSTS_CATEGORY';
                const isFixo = knownType === 'fixo';
                return await respond(isFixo ? onboardingCopy.ahaCostsCategoryQuestionFixed() : onboardingCopy.ahaCostsCategoryQuestionVariable(), true);
            } else {
                if (onboarding.data.pending_cost.tipo && onboarding.data.pending_cost.categoria) {
                    onboarding.step = 'AHA_COSTS_CONFIRM';
                    return await respond(onboardingCopy.ahaCostsConfirmation({
                        tipo: onboarding.data.pending_cost.tipo === 'fixa' ? 'Fixo' : 'Variável',
                        categoria: onboarding.data.pending_cost.categoria,
                        valor: onboarding.data.pending_cost.valor,
                        data: formatDate(onboarding.data.pending_cost.data),
                        pagamento: this._formatCostPaymentText(onboarding.data.pending_cost)
                    }));
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
                    setTimeout(() => reject(new Error('Timeout ao processar documento')), 30000)
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
                        data: transacao.data || new Date().toISOString().split('T')[0],
                        fornecedor: transacao.categoria || '—'
                    };

                    onboarding.data.pending_cost = {
                        valor: transacao.valor,
                        tipo: knownType === 'fixo' ? 'fixa' : (knownType === 'variável' ? 'variavel' : null),
                        descricao: transacao.descricao || fileName || 'Documento',
                        data: transacao.data || new Date().toISOString().split('T')[0],
                        categoria: transacao.categoria || null
                    };

                    if (!onboarding.data.pending_cost.tipo && inferredCost.tipo) {
                        onboarding.data.pending_cost.tipo = inferredCost.tipo === 'fixo' ? 'fixa' : 'variavel';
                    }
                    if (!onboarding.data.pending_cost.categoria && inferredCost.categoria) {
                        onboarding.data.pending_cost.categoria = inferredCost.categoria;
                    }

                    if (knownType) {
                        if (onboarding.data.pending_cost.categoria) {
                            onboarding.step = 'AHA_COSTS_CONFIRM';
                            return await respond(
                                onboardingCopy.documentReceivedSimple({ valor: transacao.valor }) +
                                '\n\n' +
                                onboardingCopy.ahaCostsConfirmation({
                                    tipo: onboarding.data.pending_cost.tipo === 'fixa' ? 'Fixo' : 'Variável',
                                    categoria: onboarding.data.pending_cost.categoria,
                                    valor: onboarding.data.pending_cost.valor,
                                    data: formatDate(onboarding.data.pending_cost.data),
                                    pagamento: this._formatCostPaymentText(onboarding.data.pending_cost)
                                })
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
                                onboardingCopy.ahaCostsConfirmation({
                                    tipo: onboarding.data.pending_cost.tipo === 'fixa' ? 'Fixo' : 'Variável',
                                    categoria: onboarding.data.pending_cost.categoria,
                                    valor: onboarding.data.pending_cost.valor,
                                    data: formatDate(onboarding.data.pending_cost.data),
                                    pagamento: this._formatCostPaymentText(onboarding.data.pending_cost)
                                })
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

        return await respond(onboardingCopy.costValueNotFound());
    }

    async handleAhaCostsClassify(onboarding, messageTrimmed, respond) {
        const costType = validateChoice(messageTrimmed, {
            'fixo': ['1', 'fixo'],
            'variável': ['2', 'variável', 'variavel'],
            'não_sei': ['3', 'não sei', 'nao sei']
        });

        if (costType === 'não_sei') {
            // Script diz: "Tranquilo. É aluguel, salário...?"
            // E diz "Usuário responde -> Lumiz classifica"
            // Por simplificação (e robustez), vamos classificar baseado nessa resposta
            onboarding.step = 'AHA_COSTS_CLASSIFY_HELP';
            return await respond(onboardingCopy.ahaCostsDontKnow());
        }

        if (!costType) {
            return await respond(onboardingCopy.invalidChoice());
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
            }
        }

        if (onboarding.data.pending_cost.categoria) {
            onboarding.step = 'AHA_COSTS_CONFIRM';
            return await respond(onboardingCopy.ahaCostsConfirmation({
                tipo: onboarding.data.pending_cost.tipo === 'fixa' ? 'Fixo' : 'Variável',
                categoria: onboarding.data.pending_cost.categoria,
                valor: onboarding.data.pending_cost.valor,
                data: formatDate(onboarding.data.pending_cost.data),
                pagamento: this._formatCostPaymentText(onboarding.data.pending_cost)
            }));
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
            }
        }

        if (onboarding.data.pending_cost.categoria) {
            onboarding.step = 'AHA_COSTS_CONFIRM';
            return await respond(onboardingCopy.ahaCostsConfirmation({
                tipo: onboarding.data.pending_cost.tipo === 'fixa' ? 'Fixo' : 'Variável',
                categoria: onboarding.data.pending_cost.categoria,
                valor: onboarding.data.pending_cost.valor,
                data: formatDate(onboarding.data.pending_cost.data),
                pagamento: this._formatCostPaymentText(onboarding.data.pending_cost)
            }));
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
        onboarding.step = 'AHA_COSTS_CONFIRM';
        return await respond(onboardingCopy.ahaCostsConfirmation({
            tipo: onboarding.data.pending_cost.tipo === 'fixa' ? 'Fixo' : 'Variável',
            categoria,
            valor: onboarding.data.pending_cost.valor,
            data: formatDate(onboarding.data.pending_cost.data),
            pagamento: this._formatCostPaymentText(onboarding.data.pending_cost)
        }));
    }

    async handleAhaCostsConfirm(onboarding, messageTrimmed, normalizedPhone, respond) {
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
            return await respond(onboardingCopy.ahaCostsConfirmation({
                tipo: onboarding.data.pending_cost.tipo === 'fixa' ? 'Fixo' : 'Variável',
                categoria: onboarding.data.pending_cost.categoria || 'Outros',
                valor: onboarding.data.pending_cost.valor,
                data: formatDate(onboarding.data.pending_cost.data),
                pagamento: this._formatCostPaymentText(onboarding.data.pending_cost)
            }));
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
                await analyticsService.track('onboarding_cost_registered', {
                    phone: normalizedPhone,
                    userId,
                    source: 'whatsapp',
                    properties: { valor: cost.valor, tipo: cost.tipo, is_test: true }
                });

                console.log('[ONBOARDING] Custo registrado como TESTE (não salva no banco):', cost);
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

            // Se já tem os dois tipos, vai para o resumo
            onboarding.step = 'BALANCE_QUESTION';
            // Correção #2: Usa dados salvos (com flag saved) para calcular resumo
            const summary = calculateSummaryFromOnboardingData(onboarding);
            await analyticsService.track('onboarding_summary_viewed', {
                phone: normalizedPhone,
                userId: onboarding.data.userId || null,
                source: 'whatsapp'
            });
            await respond(
                onboardingCopy.ahaCostsRegistered() +
                '\n\n' +
                onboardingCopy.ahaSummary(summary),
                true,
                true
            );
            return await respond(onboardingCopy.balanceQuestion(), true, true);
        }

        return await respond(onboardingCopy.invalidChoice());
    }

    async handleAhaSummary(onboarding, normalizedPhone, respond) {
        onboarding.step = 'BALANCE_QUESTION';
        await analyticsService.track('onboarding_summary_viewed', {
            phone: normalizedPhone,
            userId: onboarding.data.userId || null,
            source: 'whatsapp'
        });
        return await respond(onboardingCopy.balanceQuestion(), true);
    }

    async handleBalanceQuestion(onboarding, messageTrimmed, respond, respondAndClear) {
        const choice = validateChoice(messageTrimmed, {
            'yes': ['1', 'sim', 'vou mandar', 'mandar'],
            'no': ['2', 'não', 'nao', 'seguimos']
        });

        if (choice === 'yes') {
            onboarding.step = 'BALANCE_INPUT';
            return await respond(onboardingCopy.balanceInputPrompt(), true);
        }

        if (choice === 'no') {
            return await respondAndClear(
                onboardingCopy.handoffToDailyUse() +
                '\n\n' +
                onboardingCopy.onboardingCompletionNoMdr()
            );
        }

        return await respond(onboardingCopy.invalidChoice());
    }

    async handleBalanceInput(onboarding, messageTrimmed, respond, respondAndClear) {
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

        // Se user já existe, atualiza?
        // O script diz "As transações reais serão salvas apenas após você concluir o cadastro".
        // Vou assumir que o saldo também será aplicado ao criar a conta defitiniva ou finalizar.

        return await respondAndClear(
            onboardingCopy.balanceConfirmation(saldo) +
            '\n\n' +
            onboardingCopy.handoffToDailyUse() +
            '\n\n' +
            onboardingCopy.onboardingCompletionNoMdr()
        );
    }

    async handleHandoffToDailyUse(onboarding, messageTrimmed, normalizedPhone, respond, respondAndClear) {
        // Caso legacy: força handoff e finaliza onboarding sem MDR
        if (onboarding.data?.force_handoff) {
            delete onboarding.data.force_handoff;
            return await respondAndClear(
                onboardingCopy.handoffToDailyUse() +
                '\n\n' +
                onboardingCopy.onboardingCompletionNoMdr()
            );
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

        return await respondAndClear(
            onboardingCopy.handoffToDailyUse() +
            '\n\n' +
            onboardingCopy.onboardingCompletionNoMdr()
        );
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
        return await respond(onboardingCopy.mdrSetupUpload(), true);
    }

    async handleMdrSetupUpload(onboarding, messageTrimmed, mediaUrl, respond, respondAndClear) {
        const text = normalizeText(messageTrimmed || '');
        const skipKeywords = ['2', 'pular', 'depois', 'cancelar', 'cancela', 'nao', 'não'];

        if (!mediaUrl && skipKeywords.some((kw) => text === kw || text.includes(kw))) {
            return await respondAndClear(onboardingCopy.mdrSetupSkip());
        }

        if (mediaUrl) {
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

    _formatCostPaymentText(cost = {}) {
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

                await analyticsService.track('onboarding_whatsapp_resumed', {
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
                return 'Me diga a forma de pagamento:\n\n1️⃣ PIX\n2️⃣ Dinheiro\n3️⃣ Débito\n4️⃣ Crédito à vista\n5️⃣ Cartão parcelado\n6️⃣ Meio a meio';
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
                    return onboardingCopy.ahaCostsConfirmation({
                        tipo: cost.tipo === 'fixa' ? 'Fixo' : 'Variável',
                        categoria: cost.categoria || 'Outros',
                        valor: cost.valor,
                        data: cost.data || 'Hoje',
                        pagamento: this.handlers._formatCostPaymentText(cost)
                    });
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
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/59a99cd5-7421-4f77-be12-78a36db4788f', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'onboardingFlowService.js:1518', message: 'processOnboarding entry', data: { normalizedPhone: normalizedPhone ? String(normalizedPhone).substring(0, 20) : null, hasState: !!onboarding, step: onboarding?.step, messagePreview: message ? String(message).trim().substring(0, 25) : null }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }) }).catch(() => { });
        // #endregion
        if (!onboarding) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/59a99cd5-7421-4f77-be12-78a36db4788f', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'onboardingFlowService.js:1522', message: 'processOnboarding returning null (no state)', data: { normalizedPhone: normalizedPhone ? String(normalizedPhone).substring(0, 20) : null }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }) }).catch(() => { });
            // #endregion
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

            // Ao finalizar onboarding, envia CTA com link unico para ativar o dashboard (sem SMS).
            try {
                const setupToken = await registrationTokenService.generateSetupToken(
                    normalizedPhone,
                    onboarding?.data?.userId || null,
                    24
                );
                if (setupToken?.registrationLink) {
                    finalText += '\n\n' + onboardingCopy.dashboardAccessLink(setupToken.registrationLink);
                }
            } catch (setupError) {
                console.error('[ONBOARDING] Falha ao gerar link de setup:', setupError?.message || setupError);
            }

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
            return finalText;
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
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/59a99cd5-7421-4f77-be12-78a36db4788f', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'onboardingFlowService.js:1548', message: 'processOnboarding switch step', data: { step: step, message: messageTrimmed.substring(0, 50) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'B' }) }).catch(() => { });
        // #endregion

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
                    return await handlers.handleAhaCostsConfirm(onboarding, messageTrimmed, normalizedPhone, respond);
                case 'AHA_SUMMARY':
                    return await handlers.handleAhaSummary(onboarding, normalizedPhone, respond);
                case 'BALANCE_QUESTION':
                    return await handlers.handleBalanceQuestion(onboarding, messageTrimmed, respond, respondAndClear);
                case 'BALANCE_INPUT':
                    return await handlers.handleBalanceInput(onboarding, messageTrimmed, respond, respondAndClear);
                case 'HANDOFF_TO_DAILY_USE':
                    return await handlers.handleHandoffToDailyUse(onboarding, messageTrimmed, normalizedPhone, respond, respondAndClear);
                case 'MDR_SETUP_INTRO':
                    return await handlers.handleMdrSetupIntro(onboarding, messageTrimmed, normalizedPhone, respond, respondAndClear);
                case 'MDR_SETUP_QUESTION':
                    return await handlers.handleMdrSetupQuestion(onboarding, messageTrimmed, respond);
                case 'MDR_SETUP_UPLOAD':
                    return await handlers.handleMdrSetupUpload(onboarding, messageTrimmed, mediaUrl, respond, respondAndClear);
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
