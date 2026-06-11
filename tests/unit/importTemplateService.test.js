const XLSX = require('xlsx');
const importTemplateService = require('../../src/services/importTemplateService');

describe('importTemplateService', () => {
  it('generates estoque csv/xlsx templates with expected headers', () => {
    const csv = importTemplateService.getEstoqueTemplateCsv().toString('utf-8');
    expect(csv).toContain('Produto,Quantidade,Unidade,Categoria,Validade,Custo Unitario,Lote');

    const xlsx = importTemplateService.getEstoqueTemplateXlsx();
    const workbook = XLSX.read(xlsx, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
    expect(Object.keys(rows[0])).toEqual(expect.arrayContaining(['Produto', 'Quantidade', 'Unidade']));
  });

  it('generates financeiro csv/xlsx templates with expected headers', () => {
    const csv = importTemplateService.getFinanceiroTemplateCsv().toString('utf-8');
    expect(csv).toContain('Tipo,Data,Valor,Categoria,Descricao,Cliente,Procedimento,Forma Pagamento');

    const xlsx = importTemplateService.getFinanceiroTemplateXlsx();
    const workbook = XLSX.read(xlsx, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
    expect(Object.keys(rows[0])).toEqual(expect.arrayContaining(['Tipo', 'Data', 'Valor']));
  });
});
