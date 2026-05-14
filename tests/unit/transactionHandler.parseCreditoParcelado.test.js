const TransactionHandler = require('../../src/controllers/messages/transactionHandler');

process.env.REDIS_QUEUE_ENABLED = 'false';
process.env.REDIS_CACHE_ENABLED = 'false';

jest.mock('../../src/services/conversationRuntimeStateService', () => ({
  upsert: jest.fn().mockResolvedValue(true),
  clear: jest.fn().mockResolvedValue(true),
  get: jest.fn().mockResolvedValue(null)
}));

describe('TransactionHandler.parseCreditoParceladoCombined', () => {
  const handler = new TransactionHandler(new Map());

  it('detecta crédito em 3x', () => {
    expect(handler.parseCreditoParceladoCombined('crédito em 3x')).toBe(3);
  });

  it('detecta cartao 6x', () => {
    expect(handler.parseCreditoParceladoCombined('cartão 6x')).toBe(6);
  });

  it('retorna null sem parcelas', () => {
    expect(handler.parseCreditoParceladoCombined('crédito à vista')).toBeNull();
  });

  it('retorna null só com 3x sem menção a cartão/crédito', () => {
    expect(handler.parseCreditoParceladoCombined('3x')).toBeNull();
  });
});
