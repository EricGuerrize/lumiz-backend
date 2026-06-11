const TransactionHandler = require('../../src/controllers/messages/transactionHandler');

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

describe('TransactionHandler — correção guiada', () => {
  const handler = new TransactionHandler(new Map());
  const user = { id: 'user-1' };
  const phone = '5511999999999';

  const basePending = {
    user,
    dados: {
      tipo: 'entrada',
      valor: 5000,
      categoria: 'Botox',
      nome_cliente: 'Maria',
      data: '2026-06-11',
      forma_pagamento: 'pix'
    },
    originalText: 'Maria botox 5000 pix',
    stage: 'confirm',
    timestamp: Date.now()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    handler.pendingTransactions.clear();
  });

  it('abre lista de campos ao tocar Corrigir', async () => {
    handler.pendingTransactions.set(phone, { ...basePending });

    const reply = await handler.handleConfirmation(phone, 'corrigir', user);
    const pending = handler.pendingTransactions.get(phone);

    expect(pending.stage).toBe('awaiting_correction_field');
    expect(reply).toContain('O que você quer corrigir');
    expect(reply).toContain('O que corrigir');
    expect(reply).toContain('Procedimento: Botox');
  });

  it('pergunta novo valor após escolher campo', async () => {
    handler.pendingTransactions.set(phone, {
      ...basePending,
      stage: 'awaiting_correction_field'
    });

    const reply = await handler.handleConfirmation(phone, 'campo valor', user);
    const pending = handler.pendingTransactions.get(phone);

    expect(pending.stage).toBe('awaiting_correction_value');
    expect(pending.correctionField).toBe('valor');
    expect(reply).toContain('valor');
    expect(reply).toContain('5.000');
  });

  it('volta para confirmação com botões após corrigir valor', async () => {
    handler.pendingTransactions.set(phone, {
      ...basePending,
      stage: 'awaiting_correction_value',
      correctionField: 'valor'
    });

    const reply = await handler.handleConfirmation(phone, '4500', user);
    const pending = handler.pendingTransactions.get(phone);

    expect(pending.stage).toBe('confirm');
    expect(pending.dados.valor).toBe(4500);
    expect(reply).toContain('VENDA');
    expect(reply).toContain('confirmar');
    expect(reply).toContain('corrigir');
  });

  it('corrige procedimento e nome em sequência', async () => {
    handler.pendingTransactions.set(phone, {
      ...basePending,
      stage: 'awaiting_correction_value',
      correctionField: 'procedimento'
    });

    await handler.handleConfirmation(phone, 'Preenchimento labial', user);
    let pending = handler.pendingTransactions.get(phone);
    expect(pending.dados.categoria).toBe('Preenchimento labial');

    handler.pendingTransactions.set(phone, {
      ...pending,
      stage: 'awaiting_correction_value',
      correctionField: 'nome'
    });

    await handler.handleConfirmation(phone, 'Joana Costa', user);
    pending = handler.pendingTransactions.get(phone);
    expect(pending.dados.nome_cliente).toMatch(/joana costa/i);
  });
});
