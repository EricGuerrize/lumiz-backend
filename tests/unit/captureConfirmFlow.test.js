/**
 * Testes unitários para o copy/captureConfirmCopy + comportamento dos handlers
 * (transactionHandler/documentHandler) ao receber confidence_score baixo.
 */

process.env.NODE_ENV = 'test';

const {
  isLowConfidence,
  lowConfidenceBanner,
  LOW_CONFIDENCE_THRESHOLD
} = require('../../src/copy/captureConfirmCopy');

const TransactionHandler = require('../../src/controllers/messages/transactionHandler');

describe('captureConfirmCopy', () => {
  it('retorna true quando confidence < threshold', () => {
    expect(isLowConfidence(0.5)).toBe(true);
    expect(isLowConfidence(0.79)).toBe(true);
  });

  it('retorna false quando confidence >= threshold', () => {
    expect(isLowConfidence(LOW_CONFIDENCE_THRESHOLD)).toBe(false);
    expect(isLowConfidence(0.95)).toBe(false);
  });

  it('retorna false para valores inválidos', () => {
    expect(isLowConfidence(null)).toBe(false);
    expect(isLowConfidence(undefined)).toBe(false);
    expect(isLowConfidence(NaN)).toBe(false);
    expect(isLowConfidence('0.5')).toBe(false);
  });

  it('banner contém texto de confirmação', () => {
    expect(lowConfidenceBanner()).toContain('confere');
  });
});

describe('TransactionHandler.buildConfirmationMessage com confidence baixo', () => {
  let handler;
  beforeEach(() => {
    handler = new TransactionHandler(new Map());
  });

  it('inclui banner de baixa confiança quando confidence_score < 0.8', () => {
    const dados = {
      tipo: 'entrada',
      valor: 1500,
      categoria: 'Botox',
      descricao: null,
      data: '2026-05-07',
      forma_pagamento: 'pix',
      parcelas: null,
      bandeira_cartao: null,
      nome_cliente: null,
      confidence_score: 0.5
    };

    const message = handler.buildConfirmationMessage(dados);
    expect(message).toContain('confere');
    expect(message).toContain('VENDA');
  });

  it('NÃO inclui banner quando confidence_score alto', () => {
    const dados = {
      tipo: 'entrada',
      valor: 1500,
      categoria: 'Botox',
      descricao: null,
      data: '2026-05-07',
      forma_pagamento: 'pix',
      parcelas: null,
      bandeira_cartao: null,
      nome_cliente: null,
      confidence_score: 0.95
    };

    const message = handler.buildConfirmationMessage(dados);
    expect(message).not.toContain('confere');
    expect(message).toContain('VENDA');
  });

  it('NÃO inclui banner quando confidence_score ausente (legado)', () => {
    const dados = {
      tipo: 'saida',
      valor: 200,
      categoria: 'Insumos',
      descricao: null,
      data: '2026-05-07',
      forma_pagamento: 'pix',
      parcelas: null,
      bandeira_cartao: null,
      nome_cliente: null
    };

    const message = handler.buildConfirmationMessage(dados);
    expect(message).not.toContain('confere');
  });
});
