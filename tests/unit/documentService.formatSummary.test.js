/**
 * Testes unitários para a copy de resumo de documentos.
 */

process.env.NODE_ENV = 'test';

describe('DocumentService.formatDocumentSummary', () => {
  let documentService;

  beforeEach(() => {
    jest.resetModules();
    documentService = require('../../src/services/documentService');
  });

  it('omite justificativa longa de categoria e mostra confirmação com opção de corrigir', () => {
    const response = documentService.formatDocumentSummary({
      tipo_documento: 'comprovante',
      transacoes: [
        {
          tipo: 'saida',
          valor: 1100,
          categoria: 'Insumos',
          category_trigger: 'Categorizei como Insumos pois o beneficiário EVOPHARMA S A é uma empresa do setor farmacêutico/médico.',
          descricao: 'Pagamento de boleto para EVOPHARMA S A (valor do documento R$ 1.100,00).',
          data: '2026-02-09'
        }
      ]
    });

    expect(response).toContain('CUSTO');
    expect(response).toContain('R$ 1.100,00');
    expect(response).toContain('Categoria: Insumos');
    expect(response).toContain('Beneficiário: EVOPHARMA S A');
    expect(response).toContain('CORRIGIR');
    expect(response).not.toContain('Categorizei como');
    expect(response).not.toContain('valor do documento');
  });
});
