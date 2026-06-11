const XLSX = require('xlsx');

const SPREADSHEET_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
  'application/octet-stream',
  'text/plain',
]);

const INVENTORY_NAME_SIGNALS = ['produto', 'nome', 'item', 'descricao', 'descrição', 'insumo', 'material'];
const INVENTORY_QTY_SIGNALS = ['quantidade', 'qtd', 'qtde', 'qty', 'saldo', 'estoque'];

const FINANCIAL_DATE_SIGNALS = ['data', 'dt', 'vencimento', 'competencia'];
const FINANCIAL_VALUE_SIGNALS = ['valor', 'receita', 'despesa', 'total'];
const FINANCIAL_TYPE_SIGNALS = ['tipo', 'movimento', 'natureza', 'entrada', 'saida', 'saída'];

function normalizeHeader(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isSpreadsheetFile(filename, mimetype) {
  const ext = String(filename || '').toLowerCase();
  if (/\.(xlsx|xls|csv)$/i.test(ext)) return true;
  return SPREADSHEET_MIME_TYPES.has(String(mimetype || '').toLowerCase());
}

function collectHeadersFromWorkbook(workbook) {
  const headerSet = new Set();
  for (const sheetName of workbook.SheetNames || []) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
    if (!rows.length) continue;
    Object.keys(rows[0]).forEach((key) => {
      const normalized = normalizeHeader(key);
      if (normalized) headerSet.add(normalized);
    });
  }
  return [...headerSet];
}

function hasAny(headers, signals) {
  return signals.some((signal) => headers.some((header) => header.includes(signal)));
}

function detectSpreadsheetKind(buffer, filename = '') {
  if (!buffer || !Buffer.isBuffer(buffer)) return 'ambiguous';

  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
    cellFormula: false,
    cellNF: false,
    cellStyles: false,
    WTF: false,
  });

  const headers = collectHeadersFromWorkbook(workbook);
  if (!headers.length) return 'ambiguous';

  const hasInventoryName = hasAny(headers, INVENTORY_NAME_SIGNALS);
  const hasInventoryQty = hasAny(headers, INVENTORY_QTY_SIGNALS);
  const inventoryScore = Number(hasInventoryName) + Number(hasInventoryQty);

  const hasFinancialDate = hasAny(headers, FINANCIAL_DATE_SIGNALS);
  const hasFinancialValue = hasAny(headers, FINANCIAL_VALUE_SIGNALS);
  const hasFinancialType = hasAny(headers, FINANCIAL_TYPE_SIGNALS);
  const financialScore = Number(hasFinancialDate) + Number(hasFinancialValue || hasFinancialType);

  if (inventoryScore >= 2 && financialScore <= 1) return 'estoque';
  if (financialScore >= 2 && inventoryScore <= 1) return 'financeiro';

  const lowerName = String(filename || '').toLowerCase();
  if (lowerName.includes('estoque') && inventoryScore >= 1) return 'estoque';
  if (lowerName.includes('finance') && financialScore >= 1) return 'financeiro';

  return 'ambiguous';
}

module.exports = {
  isSpreadsheetFile,
  detectSpreadsheetKind,
};
