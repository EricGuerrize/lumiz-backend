const {
  applyTransactionCorrection,
  applySupplierDocCorrection
} = require('../../src/utils/whatsappCorrectionParser');

describe('whatsappCorrectionParser', () => {
  test('corrige valor, categoria e vencimento em uma frase natural', () => {
    const current = {
      tipo: 'saida',
      valor: 1100,
      categoria: 'Insumos',
      descricao: 'EVOPHARMA S A',
      data: '2026-02-09'
    };

    const result = applyTransactionCorrection(
      current,
      'corrigir valor R$ 900 categoria taxas vencimento 10/06'
    );

    expect(result.changed).toBe(true);
    expect(result.dados.valor).toBe(900);
    expect(result.dados.categoria).toBe('Taxas');
    expect(result.dados.data).toBe('2026-06-10');
  });

  test('corrige documento de fornecedor antes de confirmar conta a pagar', () => {
    const parsed = {
      tipo_documento: 'boleto',
      fornecedor: { nome: 'EVOPHARMA S A' },
      valor_total: 1100,
      vencimentos: [{ data: '2026-02-09', valor: 1100 }],
      category: 'Insumos'
    };

    const result = applySupplierDocCorrection(
      parsed,
      'corrigir beneficiario para Evopharma valor 950 vencimento 11/06 categoria medicamentos'
    );

    expect(result.changed).toBe(true);
    expect(result.parsed.fornecedor.nome).toBe('Evopharma');
    expect(result.parsed.valor_total).toBe(950);
    expect(result.parsed.vencimentos[0]).toMatchObject({
      data: '2026-06-11',
      valor: 950
    });
    expect(result.parsed.category).toBe('Medicamentos');
  });
});
