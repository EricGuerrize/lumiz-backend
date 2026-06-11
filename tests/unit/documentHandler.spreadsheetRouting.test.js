const pendingMap = new Map();
const mockUser = { id: 'user-1' };

jest.mock('../../src/controllers/userController', () => ({
  findUserByPhone: jest.fn().mockResolvedValue(mockUser),
}));

jest.mock('../../src/services/onboardingFlowService', () => ({
  ensureOnboardingState: jest.fn().mockResolvedValue(false),
  startNewOnboarding: jest.fn(),
}));

jest.mock('../../src/services/onboardingService', () => ({
  getState: jest.fn().mockResolvedValue({ id: 'state-1', data: {} }),
  updateRecord: jest.fn(),
}));

jest.mock('../../src/middleware/userRateLimit', () => ({
  checkExpensiveOperationLimit: jest.fn().mockResolvedValue({ allowed: true }),
}));

jest.mock('../../src/services/documentService', () => ({
  processDocumentFromBuffer: jest.fn(),
  formatDocumentSummary: jest.fn(() => 'ok'),
}));

jest.mock('../../src/services/estoqueImportService', () => ({
  previewFromBuffer: jest.fn().mockResolvedValue({
    import_token: 'est-1',
    preview: [],
    summary: { valid_rows: 1 },
    inconsistencias: [],
  }),
}));

jest.mock('../../src/services/excelService', () => ({
  importFromExcel: jest.fn().mockResolvedValue({
    import_token: 'fin-1',
    preview: [],
    summary: { valid_rows: 1 },
    inconsistencias: [],
  }),
}));

jest.mock('../../src/services/spreadsheetImportRouterService', () => ({
  isSpreadsheetFile: jest.fn().mockReturnValue(true),
  detectSpreadsheetKind: jest.fn(),
}));

jest.mock('../../src/services/vendorClassificationService', () => ({
  classifyVendor: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../src/services/messageReliabilityService', () => ({
  recordFailure: jest.fn(),
}));

describe('DocumentHandler spreadsheet routing', () => {
  let DocumentHandler;
  let spreadsheetImportHandler;
  let routerService;

  beforeEach(() => {
    jest.clearAllMocks();
    pendingMap.clear();
    DocumentHandler = require('../../src/controllers/messages/documentHandler');
    routerService = require('../../src/services/spreadsheetImportRouterService');
    spreadsheetImportHandler = {
      startFinancialImportFromSpreadsheet: jest.fn(),
      startSpreadsheetKindChoice: jest.fn(),
    };
  });

  it('routes financial spreadsheet to financial pending import', async () => {
    routerService.detectSpreadsheetKind.mockReturnValue('financeiro');
    const handler = new DocumentHandler(pendingMap, spreadsheetImportHandler);

    const reply = await handler.handleDocumentMessageWithBuffer(
      '551199',
      Buffer.from('csv'),
      'text/csv',
      'financeiro.csv',
      { id: 'msg-1' }
    );

    expect(spreadsheetImportHandler.startFinancialImportFromSpreadsheet).toHaveBeenCalled();
    expect(reply).toContain('Importação financeira');
  });

  it('routes ambiguous spreadsheet to kind choice pending', async () => {
    routerService.detectSpreadsheetKind.mockReturnValue('ambiguous');
    const handler = new DocumentHandler(pendingMap, spreadsheetImportHandler);

    const reply = await handler.handleDocumentMessageWithBuffer(
      '551199',
      Buffer.from('csv'),
      'text/csv',
      'misto.csv',
      { id: 'msg-2' }
    );

    expect(spreadsheetImportHandler.startSpreadsheetKindChoice).toHaveBeenCalled();
    expect(reply).toContain('Planilha ambígua');
  });
});
