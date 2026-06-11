process.env.NODE_ENV = 'test';

const vendorClassificationService = require('../../src/services/vendorClassificationService');

jest.mock('../../src/services/vendorClassificationService', () => ({
  classifyVendor: jest.fn(),
  learnVendorClassification: jest.fn().mockResolvedValue(undefined),
  normalizeCategoryForDisplay: jest.fn((value) => (value === 'insumos' ? 'Insumos' : value))
}));

jest.mock('../../src/services/supplierDocumentService', () => ({
  fromDocumentResult: jest.fn(),
  computeFileHash: jest.fn(),
  persist: jest.fn().mockResolvedValue({ id: 'doc-1' })
}));

jest.mock('../../src/copy/supplierDocWhatsappCopy', () => ({
  confirmacaoSupplierDoc: jest.fn(() => 'confirm-message')
}));

jest.mock('../../src/copy/captureConfirmCopy', () => ({
  isLowConfidence: jest.fn(() => false)
}));

const DocumentHandler = require('../../src/controllers/messages/documentHandler');

describe('DocumentHandler — classificação por fornecedor', () => {
  const handler = new DocumentHandler(new Map());

  beforeEach(() => {
    jest.clearAllMocks();
    handler.pendingDocumentTransactions = new Map();
    handler._setPendingDoc = jest.fn();
    handler.persistPendingConfirmation = jest.fn().mockResolvedValue(true);
  });

  it('usa fornecedor.nome e preenche category/category_trigger', async () => {
    vendorClassificationService.classifyVendor.mockResolvedValue('insumos');
    const supplierDocumentService = require('../../src/services/supplierDocumentService');
    supplierDocumentService.fromDocumentResult.mockReturnValue({
      tipo: 'nf',
      fornecedor: { nome: 'Biogelis', cnpj: '12345678000190' },
      valor_total: 1500,
      vencimentos: [{ valor: 1500, data: '2026-06-11' }],
      itens: [],
      confidence_score: 0.9
    });

    const result = await handler._maybePrepareSupplierDocPending({
      user: { id: 'user-1' },
      normalizedPhone: '5511999999999',
      result: {
        tipo_documento: 'nota_fiscal',
        fornecedor: { nome: 'Biogelis', cnpj: '12345678000190' },
        valor_total: 1500,
        transacoes: [{ valor: 1500, tipo: 'saida' }]
      }
    });

    expect(vendorClassificationService.classifyVendor).toHaveBeenCalledWith('Biogelis', 'user-1');
    expect(result.parsed.category).toBe('Insumos');
    expect(result.parsed.category_trigger).toContain('Biogelis');
    expect(result.response).toBe('confirm-message');
  });
});
