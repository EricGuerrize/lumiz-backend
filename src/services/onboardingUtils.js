/**
 * Funções utilitárias do fluxo de onboarding.
 * Extraídas de onboardingFlowService para reduzir o tamanho do arquivo principal.
 */

const onboardingCopy = require('../copy/onboardingWhatsappCopy');
const supabase = require('../db/supabase');
const { PROCEDURE_KEYWORDS, sanitizeClientName } = require('../utils/procedureKeywords');
const {
    extractPrimaryMonetaryValue,
    extractMixedPaymentSplit,
    extractInstallments,
    extractInstallmentDays,
    calcularVencimentosBoleto
} = require('../utils/moneyParser');

// ── Limites de transação ────────────────────────────────────────────────────
const MAX_TRANSACTION_VALUE = 10000000; // R$ 10 milhões
const MIN_TRANSACTION_VALUE = 0.01;

// ── Tamanhos mínimos ────────────────────────────────────────────────────────
const MIN_NAME_LENGTH = 2;
const MIN_CLINIC_NAME_LENGTH = 2;

// ── Normalização e confirmação ──────────────────────────────────────────────

function normalizeText(value = '') {
    return String(value).trim().toLowerCase();
}

function isYes(value = '') {
    const v = normalizeText(value);
    return v === '1' || v === 'sim' || v === 's' || v === 'ok' || v === 'confirmar' ||
        v === 'certo' || v === 'correto' || v === 'exato' || v === 'isso' || v === 'perfeito' ||
        v === 'show' || v === 'beleza' || v === 'pode' || v === 'bora' || v === 'aceito' ||
        v === 'topa' || v === 'topei' || v === 'concordo' || v === 'claro' || v === 'obvio' ||
        v.includes('ta certo') || v.includes('tá certo') || v.includes('ta ok') || v.includes('tá ok') ||
        v.includes('pode registrar') || v.includes('confere') || v.includes('autorizo') ||
        v.includes('autorizar') || v.includes('ta bom') || v.includes('tá bom') ||
        v.includes('pode salvar') || v.includes('salva') || v.includes('registra') ||
        v.includes('claro que sim') || v.includes('com certeza');
}

function isNo(value = '') {
    const v = normalizeText(value);
    return v === '2' || v === 'nao' || v === 'não' || v === 'n' || v === 'cancelar' ||
        v.includes('corrigir') || v.includes('ajustar') || v.includes('editar');
}

// ── Parsing monetário ───────────────────────────────────────────────────────

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

    const milMatch = raw.match(/(\d+(?:[.,]\d+)?)\s*mil\b/i);
    if (milMatch && milMatch[1]) {
        const base = parseBrazilianNumber(milMatch[1]);
        if (base && base > 0) return base * 1000;
    }
    return null;
}

function validateAndExtractValue(text, errorMessage = null) {
    const valor = extractBestAmountFromText(text);
    if (!valor || Number.isNaN(valor) || valor <= 0) {
        return { valid: false, error: errorMessage || onboardingCopy.ahaRevenueMissingValue() };
    }
    if (valor > MAX_TRANSACTION_VALUE) {
        return { valid: false, error: onboardingCopy.valueTooHigh() };
    }
    if (valor < MIN_TRANSACTION_VALUE) {
        return { valid: false, error: onboardingCopy.valueTooLow() };
    }
    return { valid: true, valor };
}

// ── Heurística de venda ─────────────────────────────────────────────────────

function extractSaleHeuristics(text = '') {
    const raw = String(text).trim();
    const lower = raw.toLowerCase();

    let paciente = null;
    const nameMatch = raw.match(/^([A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){0,2})\s+(fez|pagou|comprou|atendeu|realizou)\b/i);
    if (nameMatch && nameMatch[1]) paciente = nameMatch[1].trim();

    let procedimento = null;
    const procMatch = raw.match(/\b(fez|realizou|atendeu)\b\s+(?:um|uma|o|a)?\s*([^,]+?)(?:,|\s+pagou|\s+por|\s+r\$|\s+R\$|\s+\d)/i);
    if (procMatch && procMatch[2]) procedimento = procMatch[2].trim();

    if (!paciente && procedimento) {
        const escapedKeywords = PROCEDURE_KEYWORDS.join('|');
        const fallbackNameMatch = raw.match(
            new RegExp(`^([A-Za-zÀ-ÿ]+(?:\\s+[A-Za-zÀ-ÿ]+){0,2})\\s+(${escapedKeywords})\\b`, 'i')
        );
        if (fallbackNameMatch && fallbackNameMatch[1]) paciente = fallbackNameMatch[1].trim();
    }

    let forma_pagamento = null;
    let parcelas = null;
    let payment_split = null;
    let valor_total = extractBestAmountFromText(raw);

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
        const cardPart = mixed.splits.find(p => p.metodo === 'parcelado');
        if (cardPart) parcelas = cardPart.parcelas || parcelas;
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

// ── Datas ───────────────────────────────────────────────────────────────────

function getLocalIsoDate(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return null;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDate(date) {
    if (!date) return 'Hoje';
    if (typeof date === 'string') {
        const isoDateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (isoDateMatch) return `${isoDateMatch[3]}/${isoDateMatch[2]}/${isoDateMatch[1]}`;
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

// ── Validação de menu ───────────────────────────────────────────────────────

function validateChoice(message, options) {
    const trimmedMessage = String(message).trim();
    const isSingleDigitMenuChoice = /^[1-9]$/.test(trimmedMessage);
    const messageToValidate = isSingleDigitMenuChoice ? trimmedMessage : message;
    const v = normalizeText(messageToValidate);

    for (const [key, matchers] of Object.entries(options)) {
        if (matchers.some(matcher => {
            if (typeof matcher === 'string') return v === normalizeText(matcher) || v.includes(normalizeText(matcher));
            if (matcher instanceof RegExp) return matcher.test(v);
            return false;
        })) return key;
    }
    return null;
}

// ── Resumo financeiro ───────────────────────────────────────────────────────

function calculateSummaryFromOnboardingData(onboarding) {
    const sale = onboarding.data?.pending_sale;
    const savedCosts = onboarding.data?.saved_costs || [];
    const pendingCost = onboarding.data?.pending_cost;

    const entradas = (sale?.saved && sale?.valor) ? sale.valor : 0;
    let custosFixos = 0;
    let custosVariaveis = 0;

    for (const cost of savedCosts) {
        if (cost?.saved && cost?.valor) {
            if (cost.tipo === 'fixa') custosFixos += cost.valor;
            else if (cost.tipo === 'variavel') custosVariaveis += cost.valor;
        }
    }

    const pendingAlreadyCounted = pendingCost?.savedId &&
        savedCosts.some(cost => cost?.savedId && cost.savedId === pendingCost.savedId);

    if (pendingCost?.saved && pendingCost?.valor && !pendingAlreadyCounted) {
        if (pendingCost.tipo === 'fixa') custosFixos += pendingCost.valor;
        else if (pendingCost.tipo === 'variavel') custosVariaveis += pendingCost.valor;
    }

    return { entradas, custosFixos, custosVariaveis, saldoParcial: entradas - custosFixos - custosVariaveis };
}

function isDecisionMakerRole(role) {
    return role === 'dona_gestora' || role === 'adm_financeiro';
}

async function calculateMonthlySummary(userId) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = getLocalIsoDate(new Date(year, month, 0));

    const { data: atendimentos, error: atendError } = await supabase
        .from('atendimentos')
        .select('valor_total')
        .eq('user_id', userId)
        .gte('data', startDate)
        .lte('data', endDate);

    if (atendError) console.error('[ONBOARDING] Erro ao buscar atendimentos:', atendError);

    const { data: contas, error: contasError } = await supabase
        .from('contas_pagar')
        .select('valor, tipo')
        .eq('user_id', userId)
        .gte('data', startDate)
        .lte('data', endDate);

    if (contasError) console.error('[ONBOARDING] Erro ao buscar contas:', contasError);

    const entradas = (atendimentos || []).reduce((sum, a) => sum + parseFloat(a.valor_total || 0), 0);
    const custosFixos = (contas || []).filter(c => c.tipo === 'fixa').reduce((sum, c) => sum + parseFloat(c.valor || 0), 0);
    const custosVariaveis = (contas || []).filter(c => c.tipo === 'variavel' || !c.tipo).reduce((sum, c) => sum + parseFloat(c.valor || 0), 0);

    return { entradas, custosFixos, custosVariaveis, saldoParcial: entradas - custosFixos - custosVariaveis };
}

// ── Categorização de custos ─────────────────────────────────────────────────

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
    if (!normalized) return { tipo: forcedType || null, categoria: null, source: null, category_trigger: null };

    const findCategory = (rules) => {
        for (const rule of rules) {
            const matchedKeyword = rule.keywords.find(kw => normalized.includes(normalizeText(kw)));
            if (matchedKeyword) return { category: rule.category, matchedKeyword };
        }
        return null;
    };

    const buildTrigger = (match) => match
        ? `Categorizei como ${match.category} porque identifiquei "${match.matchedKeyword}" no texto.`
        : null;

    if (forcedType === 'fixo') {
        const match = findCategory(FIXED_COST_CATEGORY_RULES);
        return { tipo: 'fixo', categoria: match?.category || null, source: 'fixed_forced', category_trigger: buildTrigger(match) };
    }

    if (forcedType === 'variável' || forcedType === 'variavel') {
        const match = findCategory(VARIABLE_COST_CATEGORY_RULES);
        return { tipo: 'variável', categoria: match?.category || null, source: 'variable_forced', category_trigger: buildTrigger(match) };
    }

    const fixedMatch = findCategory(FIXED_COST_CATEGORY_RULES);
    if (fixedMatch) return { tipo: 'fixo', categoria: fixedMatch.category, source: 'fixed_inferred', category_trigger: buildTrigger(fixedMatch) };

    const variableMatch = findCategory(VARIABLE_COST_CATEGORY_RULES);
    if (variableMatch) return { tipo: 'variável', categoria: variableMatch.category, source: 'variable_inferred', category_trigger: buildTrigger(variableMatch) };

    return { tipo: null, categoria: null, source: null, category_trigger: null };
}

function extractCostPaymentDetails(text = '') {
    const normalized = normalizeText(text);
    const hasBoleto = normalized.includes('boleto');
    const installmentDays = extractInstallmentDays(normalized);
    const installments = installmentDays ? installmentDays.length : extractInstallments(normalized);
    const hasCard = normalized.includes('cartao') || normalized.includes('cartão') ||
        normalized.includes('credito') || normalized.includes('crédito') || installments > 1;
    const hasPix = normalized.includes('pix');
    const hasCash = normalized.includes('dinheiro') || normalized.includes('espécie') || normalized.includes('especie');
    const hasDebit = normalized.includes('debito') || normalized.includes('débito');

    if (installmentDays || (hasBoleto && !hasCard)) {
        const datas = installmentDays ? calcularVencimentosBoleto(getLocalIsoDate(), installmentDays) : null;
        return {
            forma_pagamento: installmentDays || installments > 1 ? 'boleto_parcelado' : 'boleto',
            parcelas: installments || null,
            datas_vencimento: datas
        };
    }
    if (hasPix) return { forma_pagamento: 'pix', parcelas: null, datas_vencimento: null };
    if (hasCash) return { forma_pagamento: 'dinheiro', parcelas: null, datas_vencimento: null };
    if (hasDebit) return { forma_pagamento: 'debito', parcelas: null, datas_vencimento: null };
    if (hasCard) {
        return {
            forma_pagamento: installments && installments > 1 ? 'parcelado' : 'credito_avista',
            parcelas: installments && installments > 1 ? installments : null,
            datas_vencimento: null
        };
    }

    return { forma_pagamento: null, parcelas: null, datas_vencimento: null };
}

module.exports = {
    MIN_NAME_LENGTH,
    MIN_CLINIC_NAME_LENGTH,
    MAX_TRANSACTION_VALUE,
    MIN_TRANSACTION_VALUE,
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
    extractCostPaymentDetails
};
