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

  it('corrige categoria de venda quando LLM confunde pagamento com procedimento', () => {
    const category = handler.sanitizeSaleCategory(
      'rromulo botox 5000 em 5x no credito',
      'Credito Em',
      'rromulo'
    );

    expect(category).toBe('Botox');
  });

  it('monta mensagem pós-registro de venda com pagamento e cliente', () => {
    const text = handler.buildRegisteredPaymentText('parcelado', 5);

    expect(text).toBe(' no crédito em 5x');
  });

  it('confirmação oferece corrigir como terceira opção', () => {
    const message = handler.buildConfirmationMessage({
      tipo: 'entrada',
      valor: 5000,
      categoria: 'Botox',
      data: '2026-05-28',
      forma_pagamento: 'parcelado',
      parcelas: 5
    });

    expect(message).toContain('corrigir');
  });

  it('aplica correção textual antes de salvar', () => {
    const result = handler.applyCorrectionToDados({
      tipo: 'entrada',
      valor: 5000,
      categoria: 'Botox',
      data: '2026-05-28',
      forma_pagamento: 'parcelado',
      parcelas: 5,
      nome_cliente: 'Romulo'
    }, 'valor era 4500 no pix');

    expect(result.changed).toBe(true);
    expect(result.dados.valor).toBe(4500);
    expect(result.dados.forma_pagamento).toBe('pix');
    expect(result.dados.parcelas).toBeNull();
  });

  it('não confunde correção de parcelas com correção de valor', () => {
    const result = handler.applyCorrectionToDados({
      tipo: 'entrada',
      valor: 5000,
      categoria: 'Botox',
      data: '2026-05-28',
      forma_pagamento: 'parcelado',
      parcelas: 5
    }, 'era 4x');

    expect(result.changed).toBe(true);
    expect(result.dados.valor).toBe(5000);
    expect(result.dados.parcelas).toBe(4);
  });


  it('mostra taxa e líquido quando atendimento retorna MDR aplicado', () => {
    const text = handler.buildRegisteredPricingText({
      valor_bruto: 5000,
      valor_liquido: 4825,
      mdr_percent_applied: 3.5,
      recebimento_previsto: '2026-06-28'
    });

    expect(text).toContain('Taxa estimada');
    expect(text).toContain('Líquido previsto');
    expect(text).toContain('3.50%');
  });
});
