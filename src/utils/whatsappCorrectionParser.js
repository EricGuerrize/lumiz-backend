/**
 * Fase 17 — Correções naturais no WhatsApp.
 *
 * Responsável por extrair ajustes curtos enviados pelo usuário durante uma
 * confirmação pendente, sem registrar nada antes de uma nova confirmação.
 */

const { recoverValueWithInstallmentsContext } = require('./moneyParser');

const CATEGORY_ALIASES = [
  'insumos',
  'materiais',
  'fornecedores',
  'equipamentos',
  'serviços',
  'servicos',
  'aluguel',
  'marketing',
  'taxas',
  'outros',
  'botox',
  'toxina',
  'preenchimento',
  'limpeza de pele'
];

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function titleCase(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\w\S*/g, (part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
}

function parseBrDate(raw, baseDate = new Date()) {
  const text = String(raw || '').trim();
  const match = text.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = match[3] ? Number(match[3]) : baseDate.getFullYear();
  if (year < 100) year += 2000;

  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseCategory(raw) {
  const text = String(raw || '').trim();
  const normalized = normalizeText(text);

  const explicit = text.match(/\b(?:categoria|cat|classifica(?:r)?(?:cao)?|classificação)\s*(?:e|é|eh|era|foi|para|como|:)?\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s/.-]{1,50})/i);
  if (explicit?.[1]) {
    return titleCase(cleanTail(explicit[1]));
  }

  const foundAlias = CATEGORY_ALIASES.find((alias) => normalized.includes(normalizeText(alias)));
  return foundAlias ? titleCase(foundAlias) : null;
}

function parseDescription(raw) {
  const text = String(raw || '').trim();
  const match = text.match(/\b(?:descri[cç][aã]o|descricao|observa[cç][aã]o|obs|fornecedor|benefici[aá]rio|beneficiario|empresa)\s*(?:e|é|eh|era|foi|para|como|:)?\s*([A-Za-z0-9À-ÿ][A-Za-z0-9À-ÿ\s/&.,-]{1,80})/i);
  if (!match?.[1]) return null;
  return cleanTail(match[1]);
}

function parseTransactionType(raw) {
  const normalized = normalizeText(raw);
  if (/\b(receita|entrada|venda|faturamento)\b/.test(normalized)) return 'entrada';
  if (/\b(custo|despesa|saida|saída|conta a pagar|boleto)\b/.test(normalized)) return 'saida';
  return null;
}

function cleanTail(value) {
  return String(value || '')
    .replace(/\b(?:valor|data|vencimento|vence|categoria|cat|tipo)\b.*$/i, '')
    .replace(/[.,;:]+$/g, '')
    .trim();
}

/**
 * @param {Object} current
 * @param {string} message
 * @returns {{changed: boolean, dados: Object, changes: Object}}
 */
function applyTransactionCorrection(current = {}, message = '') {
  const next = { ...(current || {}) };
  const raw = String(message || '').trim();
  const normalized = normalizeText(raw);
  const changes = {};

  const value = recoverValueWithInstallmentsContext(raw, null, next.parcelas);
  if (value && value > 0 && /\b(valor|era|foi|deu|total|r\$|\d)\b/.test(normalized)) {
    next.valor = value;
    changes.valor = value;
  }

  const date = parseBrDate(raw);
  if (date && /\b(data|dia|vencimento|vence|em|foi)\b/.test(normalized)) {
    next.data = date;
    changes.data = date;
  }

  const category = parseCategory(raw);
  if (category) {
    next.categoria = category;
    changes.categoria = category;
  }

  const description = parseDescription(raw);
  if (description) {
    next.descricao = description;
    changes.descricao = description;
  }

  const tipo = parseTransactionType(raw);
  if (tipo) {
    next.tipo = tipo;
    changes.tipo = tipo;
  }

  return {
    changed: Object.keys(changes).length > 0,
    dados: next,
    changes
  };
}

/**
 * @param {Object} parsed
 * @param {string} message
 * @returns {{changed: boolean, parsed: Object, changes: Object}}
 */
function applySupplierDocCorrection(parsed = {}, message = '') {
  const next = {
    ...(parsed || {}),
    fornecedor: { ...(parsed?.fornecedor || {}) },
    vencimentos: Array.isArray(parsed?.vencimentos) ? parsed.vencimentos.map((v) => ({ ...v })) : []
  };
  const raw = String(message || '').trim();
  const changes = {};

  const value = recoverValueWithInstallmentsContext(raw, null, null);
  if (value && value > 0) {
    next.valor_total = value;
    changes.valor_total = value;
    if (next.vencimentos.length === 1) {
      next.vencimentos[0].valor = value;
    }
  }

  const date = parseBrDate(raw);
  if (date && next.vencimentos.length > 0) {
    next.vencimentos[0].data = date;
    changes.vencimento = date;
  }

  const category = parseCategory(raw);
  if (category) {
    next.category = category;
    next.categoria = category;
    changes.category = category;
  }

  const description = parseDescription(raw);
  if (description) {
    next.fornecedor.nome = description;
    changes.fornecedor = description;
  }

  return {
    changed: Object.keys(changes).length > 0,
    parsed: next,
    changes
  };
}

module.exports = {
  applyTransactionCorrection,
  applySupplierDocCorrection,
  normalizeText,
  parseBrDate
};
