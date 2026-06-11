process.env.NODE_ENV = 'test';

const mockFinalEq = jest.fn().mockResolvedValue({ error: null });
const mockFirstEq = jest.fn().mockReturnValue({ eq: mockFinalEq });

jest.mock('../../src/db/supabase', () => ({
  from: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null }),
    update: jest.fn().mockReturnValue({ eq: mockFirstEq })
  }))
}));

jest.mock('../../src/services/conversationRuntimeStateService', () => ({
  upsert: jest.fn().mockResolvedValue(true),
  clear: jest.fn().mockResolvedValue(true),
  get: jest.fn().mockResolvedValue(null)
}));

jest.mock('../../src/services/vendorClassificationService', () => ({
  learnVendorClassification: jest.fn().mockResolvedValue(undefined)
}));

const EditHandler = require('../../src/controllers/messages/editHandler');
const vendorClassificationService = require('../../src/services/vendorClassificationService');

describe('EditHandler — categoria pós-registro', () => {
  const handler = new EditHandler(new Map());
  const user = { id: 'user-1' };
  const phone = '5511999999999';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('atualiza categoria de conta a pagar e retroalimenta classificação', async () => {
    const transacao = {
      id: 'conta-1',
      valor: 900,
      descricao: 'Biogelis',
      categoria: 'Fornecedores'
    };

    const response = await handler.applyEdit(user, phone, transacao, 'categoria', 'Insumos', 'conta');

    expect(response).toContain('categoria atualizado');
    expect(vendorClassificationService.learnVendorClassification).toHaveBeenCalledWith(
      'Biogelis',
      'Insumos',
      'user-1'
    );
  });
});
