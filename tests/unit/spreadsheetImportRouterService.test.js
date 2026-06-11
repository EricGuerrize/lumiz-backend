const XLSX = require('xlsx');
const routerService = require('../../src/services/spreadsheetImportRouterService');

function buildWorkbook(rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

describe('spreadsheetImportRouterService', () => {
  it('detects estoque spreadsheet by headers', () => {
    const buffer = buildWorkbook([
      { Produto: 'Botox', Quantidade: 3, Unidade: 'frasco' },
    ]);

    const kind = routerService.detectSpreadsheetKind(buffer, 'estoque.xlsx');

    expect(kind).toBe('estoque');
    expect(routerService.isSpreadsheetFile('estoque.xlsx', 'application/octet-stream')).toBe(true);
  });

  it('returns ambiguous for mixed/noisy headers', () => {
    const buffer = buildWorkbook([
      { Produto: 'Botox', Quantidade: 2, Data: '2026-06-01', Valor: 500 },
    ]);

    const kind = routerService.detectSpreadsheetKind(buffer, 'import.csv');

    expect(kind).toBe('ambiguous');
    expect(routerService.isSpreadsheetFile('arquivo.txt', 'text/plain')).toBe(true);
  });
});
