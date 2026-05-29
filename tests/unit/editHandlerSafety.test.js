process.env.REDIS_CACHE_ENABLED = 'false';

jest.mock('../../src/controllers/transactionController', () => ({
  getRecentTransactions: jest.fn(),
  deleteTransaction: jest.fn()
}));

jest.mock('../../src/services/conversationRuntimeStateService', () => ({
  upsert: jest.fn().mockResolvedValue(true),
  clear: jest.fn().mockResolvedValue(true),
  get: jest.fn().mockResolvedValue(null)
}));

jest.mock('../../src/db/supabase', () => ({
  from: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null })
  }))
}));

const transactionController = require('../../src/controllers/transactionController');
const EditHandler = require('../../src/controllers/messages/editHandler');

describe('EditHandler - segurança pós-lançamento', () => {
  let handler;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = new EditHandler(new Map());
  });

  it('corrigir sem ID abre edição da última transação', async () => {
    transactionController.getRecentTransactions.mockResolvedValueOnce([
      {
        id: 'tx-1',
        type: 'entrada',
        amount: 1200,
        date: '2026-05-29',
        categories: { name: 'Botox' },
        description: 'Botox'
      }
    ]);

    const response = await handler.handleEditTransaction({ id: 'user-1' }, '5511999999999', { dados: {} });

    expect(response).toContain('Vamos corrigir o último lançamento');
    expect(response).toContain('valor R$ 3000');
  });

  it('desfazer usa deleteTransaction para remover relações da venda', async () => {
    transactionController.getRecentTransactions.mockResolvedValueOnce([
      {
        id: 'tx-1',
        type: 'entrada',
        amount: 1200,
        date: '2026-05-29',
        categories: { name: 'Botox' },
        description: 'Botox'
      }
    ]);
    transactionController.deleteTransaction.mockResolvedValueOnce({ id: 'tx-1', type: 'entrada' });

    const response = await handler.handleUndoLastTransaction({ id: 'user-1' }, '5511999999999');

    expect(transactionController.deleteTransaction).toHaveBeenCalledWith('user-1', 'tx-1');
    expect(response).toContain('Última transação removida');
  });
});
