const XLSX = require('xlsx');

const ESTOQUE_HEADERS = ['Produto', 'Quantidade', 'Unidade', 'Categoria', 'Validade', 'Custo Unitario', 'Lote'];
const ESTOQUE_SAMPLE_ROWS = [
  ['Botox 100UI', 4, 'frasco', 'Injetavel', '2026-12-31', 890, 'L001'],
  ['Luva de procedimento', 120, 'unidade', 'Descartavel', '', 0.8, ''],
];

const FINANCEIRO_HEADERS = ['Tipo', 'Data', 'Valor', 'Categoria', 'Descricao', 'Cliente', 'Procedimento', 'Forma Pagamento'];
const FINANCEIRO_SAMPLE_ROWS = [
  ['Receita', '2026-06-01', 1800, 'Harmonizacao', 'Sessao botox', 'Maria', 'Botox', 'PIX'],
  ['Despesa', '2026-06-02', 420, 'Insumos', 'Compra de agulhas', '', '', 'Boleto'],
];

function toCsv(headers, rows) {
  const escapeCell = (value) => {
    const text = String(value ?? '');
    if (/[",;\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };

  const lines = [
    headers.map(escapeCell).join(','),
    ...rows.map((row) => row.map(escapeCell).join(',')),
  ];
  return Buffer.from(lines.join('\n'), 'utf-8');
}

function toXlsx(sheetName, headers, rows) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function getEstoqueTemplateCsv() {
  return toCsv(ESTOQUE_HEADERS, ESTOQUE_SAMPLE_ROWS);
}

function getEstoqueTemplateXlsx() {
  return toXlsx('Estoque', ESTOQUE_HEADERS, ESTOQUE_SAMPLE_ROWS);
}

function getFinanceiroTemplateCsv() {
  return toCsv(FINANCEIRO_HEADERS, FINANCEIRO_SAMPLE_ROWS);
}

function getFinanceiroTemplateXlsx() {
  return toXlsx('Financeiro', FINANCEIRO_HEADERS, FINANCEIRO_SAMPLE_ROWS);
}

module.exports = {
  getEstoqueTemplateCsv,
  getEstoqueTemplateXlsx,
  getFinanceiroTemplateCsv,
  getFinanceiroTemplateXlsx,
};
