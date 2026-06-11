jest.mock('../../src/services/conversationRuntimeStateService', () => ({
  upsert: jest.fn(),
  get: jest.fn(),
  clear: jest.fn(),
}));

jest.mock('../../src/services/excelService', () => ({
  confirmImport: jest.fn(),
}));

const runtime = require('../../src/services/conversationRuntimeStateService');
const excelService = require('../../src/services/excelService');
const SpreadsheetImportHandler = require('../../src/controllers/messages/spreadsheetImportHandler');

describe('SpreadsheetImportHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('confirms pending financial import', async () => {
    runtime.get.mockResolvedValueOnce({
      payload: {
        stage: 'confirm',
        importToken: 'excel-batch-1',
        summary: { valid_rows: 2 },
        preview: [],
        inconsistencias: [],
      },
    });
    excelService.confirmImport.mockResolvedValueOnce({
      summary: { inserted_atendimentos: 1, inserted_contas_pagar: 1 },
    });

    const handler = new SpreadsheetImportHandler();
    const reply = await handler.handlePendingFinancialImport('551199', 'confirmar', { id: 'u-1' });

    expect(excelService.confirmImport).toHaveBeenCalledWith('u-1', 'excel-batch-1');
    expect(runtime.clear).toHaveBeenCalledWith('551199', 'financial_import');
    expect(reply).toContain('Importação financeira concluída');
  });

  it('asks kind choice again on invalid reply', async () => {
    runtime.get.mockResolvedValueOnce({
      payload: {
        stage: 'choice',
        filename: 'planilha.xlsx',
        estoque: { importToken: 'e1', summary: { valid_rows: 4 } },
        financeiro: { importToken: 'f1', summary: { valid_rows: 3 } },
      },
    });

    const handler = new SpreadsheetImportHandler();
    const reply = await handler.handlePendingSpreadsheetKindChoice('551199', 'talvez');

    expect(reply).toContain('Planilha ambígua');
    expect(reply).toContain('Estoque');
    expect(reply).toContain('Financeiro');
  });
});
