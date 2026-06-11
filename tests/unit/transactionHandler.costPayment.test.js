const TransactionHandler = require('../../src/controllers/messages/transactionHandler');
const recurringExpenseService = require('../../src/services/recurringExpenseService');

process.env.REDIS_QUEUE_ENABLED = 'false';
process.env.REDIS_CACHE_ENABLED = 'false';

jest.mock('../../src/services/conversationRuntimeStateService', () => ({
  upsert: jest.fn().mockResolvedValue(true),
  clear: jest.fn().mockResolvedValue(true),
  get: jest.fn().mockResolvedValue(null)
}));

jest.mock('../../src/services/vendorClassificationService', () => ({
  classifyVendor: jest.fn().mockResolvedValue(null),
  learnVendorClassification: jest.fn().mockResolvedValue(undefined),
  normalizeCategoryForDisplay: jest.fn((value) => value)
}));

describe('TransactionHandler — custos a prazo e recorrentes', () => {
  const handler = new TransactionHandler(new Map());
  const user = { id: 'user-1' };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('prioriza recorrência explícita sobre parcelamento', async () => {
    const text = 'aluguel 2000 mensal vence dia 10 por 6 meses em 3x';
    const dados = {
      tipo: 'saida',
      valor: 2000,
      categoria: 'Aluguel',
      descricao: 'aluguel',
      data: '2026-06-11'
    };

    handler._enrichSaidaFromText(dados, text);

    expect(dados.recurrence).toEqual({ months: 6, dueDay: 10 });
    expect(dados.parcelas).toBeUndefined();
    expect(dados.tipo_custo).toBe('fixa');
  });

  it('extrai despesa parcelada quando não há recorrência', () => {
    const text = 'insumos 1800 em 3x';
    const dados = {
      tipo: 'saida',
      valor: 1800,
      categoria: null,
      descricao: 'insumos',
      data: '2026-06-11'
    };

    handler._enrichSaidaFromText(dados, text);

    expect(dados.recurrence).toBeUndefined();
    expect(dados.parcelas).toBe(3);
    expect(dados.categoria).toMatch(/insumo/i);
  });

  it('monta confirmação com preview de recorrência', () => {
    const message = handler.buildConfirmationMessage({
      tipo: 'saida',
      valor: 2000,
      categoria: 'Aluguel',
      descricao: 'aluguel',
      data: '2026-06-11',
      recurrence: { months: 6, dueDay: 10 },
      category_trigger: 'Categorizei como Aluguel porque identifiquei "aluguel" no texto.'
    });

    expect(message).toContain('Recorrente');
    expect(message).toContain('6 conta(s)');
    expect(message).toContain('dia 10');
    expect(message).toContain('Categorizei como Aluguel');
  });

  it('monta confirmação com preview de parcelas', () => {
    const message = handler.buildConfirmationMessage({
      tipo: 'saida',
      valor: 1800,
      categoria: 'Insumos / materiais',
      descricao: 'insumos',
      data: '2026-06-11',
      parcelas: 3
    });

    expect(message).toContain('3x de');
    expect(message).not.toContain('Recorrente');
  });

  it('aprende categoria corrigida antes da confirmação', async () => {
    const vendorClassificationService = require('../../src/services/vendorClassificationService');
    const previous = 'Fornecedores';
    const next = {
      tipo: 'saida',
      categoria: 'Insumos',
      descricao: 'Biogelis'
    };

    await handler._maybeLearnVendorFromCostCorrection(user, previous, next, 'Biogelis 1800');

    expect(vendorClassificationService.learnVendorClassification).toHaveBeenCalledWith(
      'Biogelis',
      'Insumos',
      'user-1'
    );
  });

  it('handleTransactionRequest registra pending com recorrência', async () => {
    const response = await handler.handleTransactionRequest(
      user,
      {
        dados: {
          tipo: 'saida',
          valor: 2000,
          categoria: 'Aluguel',
          descricao: 'aluguel',
          data: '2026-06-11'
        }
      },
      '5511999999999',
      'aluguel 2000 mensal vence dia 10 por 6 meses'
    );

    const pending = handler.pendingTransactions.get('5511999999999');
    expect(pending.dados.recurrence).toEqual({ months: 6, dueDay: 10 });
    expect(response).toContain('Recorrente');
  });
});

describe('recurringExpenseService.parseRecurrenceFromText', () => {
  it('detecta 6 meses com vencimento no dia 10', () => {
    expect(
      recurringExpenseService.parseRecurrenceFromText('aluguel 2000 mensal vence dia 10 por 6 meses')
    ).toEqual({ months: 6, dueDay: 10 });
  });
});
