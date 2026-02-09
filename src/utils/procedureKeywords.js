const PROCEDURE_KEYWORDS = [
  'botox',
  'tox',
  'toxina',
  'preenchimento',
  'preench',
  'harmonizacao',
  'harmonização',
  'bioestimulador',
  'fios',
  'peeling',
  'laser',
  'acido',
  'ácido',
  'hialuronico',
  'hialurônico',
  'procedimento'
];

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function containsProcedureKeyword(value) {
  const normalized = normalizeText(value);
  if (!normalized) return false;
  return PROCEDURE_KEYWORDS.some((term) => normalized.includes(normalizeText(term)));
}

function sanitizeClientName(rawName, categoria) {
  if (!rawName) return null;
  const name = String(rawName).trim();
  if (!name) return null;

  const normalizedName = normalizeText(name);
  const normalizedCategory = normalizeText(categoria);

  // Terms that are not a person name in this context.
  const blockedTokens = [
    'paciente',
    'cliente',
    'procedimento',
    'tratamento',
    'venda',
    'custo',
    'entrada',
    'saida'
  ];

  if (blockedTokens.includes(normalizedName)) return null;
  if (containsProcedureKeyword(normalizedName)) return null;
  if (normalizedCategory && normalizedName === normalizedCategory) return null;

  // Reject values with digits or special punctuation-heavy strings.
  if (/\d/.test(name)) return null;
  if (!/[A-Za-zÀ-ÿ]/.test(name)) return null;

  return name;
}

module.exports = {
  PROCEDURE_KEYWORDS,
  containsProcedureKeyword,
  sanitizeClientName,
  normalizeText
};
