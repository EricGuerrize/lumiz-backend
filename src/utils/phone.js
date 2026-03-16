/**
 * Utilitários para normalização e validação de telefone
 * Garante formato consistente (E.164) em todo o sistema
 */

/**
 * Normaliza telefone para formato E.164 (ex: +5511999999999)
 * @param {string} phone - Telefone em qualquer formato
 * @returns {string|null} - Telefone normalizado ou null se inválido
 */
function normalizePhone(phone) {
    if (!phone) return null;

    // Remove tudo exceto dígitos
    const digits = String(phone).replace(/\D/g, '');

    if (digits.length < 10) return null;

    // Se começa com 55 (Brasil), assume que já tem código do país
    if (digits.startsWith('55') && digits.length >= 12) {
        return `+${digits}`;
    }

    // Se tem 10 ou 11 dígitos, assume Brasil e adiciona +55
    if (digits.length === 10 || digits.length === 11) {
        // Remove 0 inicial se tiver (ex: 011 -> 11)
        const cleaned = digits.startsWith('0') ? digits.substring(1) : digits;
        return `+55${cleaned}`;
    }

    // Se já tem +, retorna como está (assumindo formato válido)
    if (String(phone).startsWith('+')) {
        return phone;
    }

    return null;
}

/**
 * Formata telefone para exibição (ex: (11) 99999-9999)
 * @param {string} phone - Telefone normalizado
 * @returns {string} - Telefone formatado
 */
function formatPhone(phone) {
    if (!phone) return '';

    const digits = String(phone).replace(/\D/g, '');

    // Remove código do país se presente
    const local = digits.startsWith('55') ? digits.substring(2) : digits;

    if (local.length === 10) {
        // Fixo: (XX) XXXX-XXXX
        return `(${local.substring(0, 2)}) ${local.substring(2, 6)}-${local.substring(6)}`;
    }

    if (local.length === 11) {
        // Celular: (XX) 9XXXX-XXXX
        return `(${local.substring(0, 2)}) ${local.substring(2, 7)}-${local.substring(7)}`;
    }

    return phone;
}

/**
 * Valida se telefone tem formato válido
 * @param {string} phone - Telefone para validar
 * @returns {boolean} - true se válido
 */
function isValidPhone(phone) {
    const normalized = normalizePhone(phone);
    return normalized !== null && normalized.length >= 12;
}

/**
 * Extrai apenas o número local (sem código do país)
 * @param {string} phone - Telefone normalizado
 * @returns {string} - Número local
 */
function getLocalNumber(phone) {
    if (!phone) return '';

    const digits = String(phone).replace(/\D/g, '');
    return digits.startsWith('55') ? digits.substring(2) : digits;
}

/**
 * Retorna variações de um número de telefone para busca
 * Útil para encontrar números salvos em formatos diferentes
 * @param {string} phone - Telefone em qualquer formato
 * @returns {Array<string>} - Array com variações do telefone
 */
function getPhoneVariants(phone) {
    if (!phone) return [];

    const digits = String(phone).replace(/\D/g, '');
    const variants = new Set();

    // Adiciona o número original
    variants.add(phone);

    // Adiciona versão com apenas dígitos
    if (digits) variants.add(digits);

    // Se tem código do país (55)
    if (digits.startsWith('55') && digits.length >= 12) {
        const withPlus = `+${digits}`;
        const withoutCountry = digits.substring(2);

        variants.add(withPlus);
        variants.add(digits);
        variants.add(withoutCountry);
    }

    // Se parece número local brasileiro (10 ou 11 dígitos)
    if (digits.length === 10 || digits.length === 11) {
        const withCountry = `55${digits}`;
        const withCountryAndPlus = `+55${digits}`;

        variants.add(withCountry);
        variants.add(withCountryAndPlus);
        variants.add(digits);
    }

    return Array.from(variants);
}

/**
 * Extrai telefone brasileiro válido de um JID do WhatsApp.
 * Exemplos de entrada: 5565999999999@s.whatsapp.net, +55 (65) 99999-9999
 * @param {string} jidOrPhone
 * @returns {string|null} - Apenas dígitos, com DDI 55 (ex: 5565999999999)
 */
function extractPhoneFromJid(jidOrPhone) {
    if (!jidOrPhone || typeof jidOrPhone !== 'string') return null;

    const localPart = jidOrPhone.split('@')[0];
    const digits = localPart.replace(/\D/g, '');
    if (!digits) return null;

    if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
        return digits;
    }

    if (digits.length === 10 || digits.length === 11) {
        return `55${digits}`;
    }

    return null;
}

/**
 * Extrai telefone do payload de webhook da Evolution.
 * Prioriza campos com número real do remetente antes de remoteJid.
 * @param {object} body
 * @returns {string|null}
 */
function extractPhoneFromWebhookBody(body) {
    if (!body || typeof body !== 'object') return null;

    // Suporta dois formatos:
    // - body.data.key (formato "by events")
    // - body.key (formato "flat")
    const key = body?.data?.key || body?.key || {};
    const sender = body?.sender;

    // IMPORTANT: body.sender in Evolution API is the bot's own instance number,
    // NOT the message sender. key.remoteJid is the actual conversation partner.
    // For incoming messages (fromMe=false), remoteJid is the user who sent the message.
    const candidates = [
        key.senderPn,
        key.participant,
        key.remoteJid,
        typeof sender === 'string' ? sender : sender?.id,
        typeof sender === 'object' ? sender?.jid : null,
        typeof sender === 'object' ? sender?.number : null,
    ];

    for (const candidate of candidates) {
        const phone = extractPhoneFromJid(candidate);
        if (phone) return phone;
    }

    return null;
}

module.exports = {
    normalizePhone,
    formatPhone,
    isValidPhone,
    getLocalNumber,
    getPhoneVariants,
    extractPhoneFromJid,
    extractPhoneFromWebhookBody
};
