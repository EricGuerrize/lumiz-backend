jest.mock('../../src/controllers/transactionController', () => ({
  createAtendimento: jest.fn().mockResolvedValue({ id: 'at-1' }),
  createContaPagar: jest.fn(),
}));
jest.mock('../../src/services/analyticsService', () => ({
  track: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../src/services/knowledgeService', () => ({
  saveInteraction: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../src/services/conversationRuntimeStateService', () => ({
  get: jest.fn(),
  upsert: jest.fn().mockResolvedValue(true),
  clear: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../src/services/vendorClassificationService', () => ({}));
jest.mock('../../src/services/recurringExpenseService', () => ({}));
jest.mock('../../src/services/agentic/profileBuilderService', () => ({
  rebuildClinicProfile: jest.fn(),
}));
jest.mock('../../src/services/estoqueProdutoService', () => ({
  hasRealInventory: jest.fn(),
}));
jest.mock('../../src/services/outboundMessageService', () => ({
  sendText: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../src/db/supabase', () => ({
  from: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockResolvedValue({ data: { count: 1 }, error: null }),
  })),
}));

const TransactionHandler = require('../../src/controllers/messages/transactionHandler');
const conversationRuntimeStateService = require('../../src/services/conversationRuntimeStateService');
const estoqueProdutoService = require('../../src/services/estoqueProdutoService');

describe('TransactionHandler stock gate', () => {
  let handler;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = new TransactionHandler(new Map());
    handler.pendingTransactions.set('5565', {
      stage: 'confirm',
      dados: {
        tipo: 'entrada',
        valor: 500,
        categoria: 'Botox',
        descricao: 'Botox',
        data: '2026-06-11',
        forma_pagamento: 'pix',
      },
      originalText: 'vendi botox 500',
    });
  });

  it('não abre prompt de baixa pós-venda sem inventário real', async () => {
    estoqueProdutoService.hasRealInventory.mockResolvedValue(false);

    const reply = await handler.handleConfirmation('5565', '1', { id: 'u1' });

    expect(estoqueProdutoService.hasRealInventory).toHaveBeenCalledWith('u1');
    expect(conversationRuntimeStateService.upsert).not.toHaveBeenCalled();
    expect(reply).not.toContain('atualizar o estoque');
    expect(reply).toContain('registrada');
  });

  it('abre prompt de baixa pós-venda quando há inventário real', async () => {
    estoqueProdutoService.hasRealInventory.mockResolvedValue(true);

    const reply = await handler.handleConfirmation('5565', '1', { id: 'u1' });

    expect(conversationRuntimeStateService.upsert).toHaveBeenCalled();
    expect(reply).toContain('atualizar o estoque');
  });
});
