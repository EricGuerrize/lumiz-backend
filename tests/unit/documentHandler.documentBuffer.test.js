const pendingMap = new Map();

const mockUser = { id: 'mockUser-1', telefone: '556592997732' };
const normalizedPhone = '+5565992997732';
const mockDocResult = {
  tipo_documento: 'recibo',
  confidence_score: 0.91,
  transacoes: [
    {
      tipo: 'entrada',
      valor: 1200,
      categoria: 'Botox',
      descricao: 'Botox no pix',
      data: '2026-06-01',
      confidence_score: 0.88
    }
  ]
};

let mockUpdateRecord;
let mockCreateAtendimento;
let mockCreateContaPagar;

jest.mock('../../src/controllers/userController', () => ({
  findUserByPhone: jest.fn().mockResolvedValue(mockUser)
}));

jest.mock('../../src/services/onboardingFlowService', () => ({
  ensureOnboardingState: jest.fn().mockResolvedValue(false),
  startNewOnboarding: jest.fn().mockResolvedValue(undefined),
  getOnboardingStep: jest.fn()
}));

jest.mock('../../src/services/onboardingService', () => ({
  getState: jest.fn().mockResolvedValue({ id: 'state-1', data: {} }),
  updateRecord: jest.fn((...args) => mockUpdateRecord(...args))
}));

jest.mock('../../src/services/documentService', () => ({
  processDocumentFromBuffer: jest.fn().mockResolvedValue(mockDocResult),
  processImageFromBuffer: jest.fn().mockResolvedValue(mockDocResult),
  processImage: jest.fn().mockResolvedValue(mockDocResult),
  formatDocumentSummary: jest.fn(() => 'Resumo do documento. Responda SIM para registrar.')
}));

jest.mock('../../src/services/supplierDocumentService', () => ({
  fromDocumentResult: jest.fn(),
  computeFileHash: jest.fn(),
  persist: jest.fn(),
  linkOrCreateFornecedor: jest.fn(),
  createContasPagarFromDocument: jest.fn(),
  applyEstoqueEntradaFromItens: jest.fn()
}));

jest.mock('../../src/middleware/userRateLimit', () => ({
  checkExpensiveOperationLimit: jest.fn().mockResolvedValue({ allowed: true })
}));

jest.mock('../../src/services/vendorClassificationService', () => ({
  classifyVendor: jest.fn().mockResolvedValue(null)
}));

jest.mock('../../src/services/messageReliabilityService', () => ({
  recordFailure: jest.fn()
}));

jest.mock('../../src/controllers/transactionController', () => ({
  createAtendimento: jest.fn((...args) => mockCreateAtendimento(...args)),
  createContaPagar: jest.fn((...args) => mockCreateContaPagar(...args))
}));

describe('DocumentHandler PDF/document buffer flow', () => {
  let DocumentHandler;
  let handler;

  beforeEach(() => {
    jest.clearAllMocks();
    pendingMap.clear();
    mockUpdateRecord = jest.fn().mockResolvedValue(undefined);
    mockCreateAtendimento = jest.fn().mockResolvedValue({ id: 'atendimento-1' });
    mockCreateContaPagar = jest.fn().mockResolvedValue({ id: 'conta-1' });
    DocumentHandler = require('../../src/controllers/messages/documentHandler');
    handler = new DocumentHandler(pendingMap);
  });

  test('PDF por buffer cria pending persistido com origem e source limpos', async () => {
    const response = await handler.handleDocumentMessageWithBuffer(
      '556592997732',
      Buffer.from('%PDF-1.4'),
      'application/pdf',
      'nota.pdf',
      { id: 'wamid-doc-1', remoteJid: '556592997732@s.whatsapp.net' }
    );

    expect(response).toContain('Resumo do documento');
    const pending = pendingMap.get(normalizedPhone);
    expect(pending).toMatchObject({
      user: mockUser,
      transacoes: mockDocResult.transacoes,
      source: expect.objectContaining({
        messageId: 'wamid-doc-1',
        mimeType: 'application/pdf',
        fileName: 'nota.pdf',
        origem: 'pdf_ocr'
      })
    });

    expect(mockUpdateRecord).toHaveBeenCalledWith('state-1', expect.objectContaining({
      data: expect.objectContaining({
        realtime: expect.objectContaining({
          pending_document_confirmation: expect.objectContaining({
            transacoes: mockDocResult.transacoes,
            source: expect.objectContaining({
              messageId: 'wamid-doc-1',
              fileName: 'nota.pdf'
            })
          })
        })
      })
    }));
  });

  test('confirmacao SIM registra receita com metadados do documento', async () => {
    await handler.handleDocumentMessageWithBuffer(
      '556592997732',
      Buffer.from('%PDF-1.4'),
      'application/pdf',
      'nota.pdf',
      { id: 'wamid-doc-2' }
    );

    const confirmation = await handler.handleDocumentConfirmation('556592997732', 'sim', mockUser);

    expect(confirmation).toContain('registrada');
    expect(mockCreateAtendimento).toHaveBeenCalledWith('mockUser-1', expect.objectContaining({
      valor: 1200,
      categoria: 'Botox',
      origem: 'pdf_ocr',
      source_phone: normalizedPhone,
      source_message_id: 'wamid-doc-2',
      raw_message: 'nota.pdf',
      is_test: false,
      metadata: expect.objectContaining({
        mime_type: 'application/pdf',
        file_name: 'nota.pdf',
        document_type: 'recibo',
        confidence_score: 0.88
      })
    }));
  });

  test('confirmacao expirada retorna fallback claro', async () => {
    const onboardingService = require('../../src/services/onboardingService');
    onboardingService.getState.mockResolvedValueOnce({ id: 'state-1', data: {} });

    const response = await handler.handleDocumentConfirmation('556592997732', 'sim', mockUser);

    expect(response).toContain('Não encontrei confirmação pendente');
  });

  test('smoke: PDF permite corrigir antes de confirmar e registra dados corrigidos', async () => {
    const documentService = require('../../src/services/documentService');
    documentService.processDocumentFromBuffer.mockResolvedValueOnce({
      tipo_documento: 'comprovante',
      confidence_score: 0.91,
      transacoes: [
        {
          tipo: 'saida',
          valor: 1100,
          categoria: 'Insumos',
          descricao: 'Pagamento de boleto para EVOPHARMA S A',
          data: '2026-02-09',
          confidence_score: 0.88
        }
      ]
    });

    await handler.handleDocumentMessageWithBuffer(
      '556592997732',
      Buffer.from('%PDF-1.4'),
      'application/pdf',
      'boleto.pdf',
      { id: 'wamid-doc-3' }
    );

    const corrected = await handler.handleDocumentConfirmation(
      '556592997732',
      'corrigir valor R$ 900 categoria taxas vencimento 10/06',
      mockUser
    );

    expect(corrected).toContain('Resumo do documento');
    expect(mockCreateContaPagar).not.toHaveBeenCalled();

    const pending = pendingMap.get(normalizedPhone);
    expect(pending.transacoes[0]).toEqual(expect.objectContaining({
      valor: 900,
      categoria: 'Taxas',
      data: '2026-06-10'
    }));

    await handler.handleDocumentConfirmation('556592997732', 'sim', mockUser);

    expect(mockCreateContaPagar).toHaveBeenCalledWith('mockUser-1', expect.objectContaining({
      valor: 900,
      categoria: 'Taxas',
      data: '2026-06-10',
      source_message_id: 'wamid-doc-3',
      is_test: false,
      metadata: expect.objectContaining({
        mime_type: 'application/pdf',
        file_name: 'boleto.pdf'
      })
    }));
  });
});
