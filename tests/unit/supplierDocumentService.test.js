/**
 * Testes unitários focados no SupplierDocumentService.
 *
 * Foco em comportamento puro (sem chamar Supabase/OpenAI):
 *   - similarity()
 *   - sanitizeCnpj
 *   - fromDocumentResult: shape unificado a partir do output do documentService
 *   - computeFileHash determinístico
 */

process.env.NODE_ENV = 'test';

const supplierDocumentService = require('../../src/services/supplierDocumentService');
const { _helpers } = require('../../src/services/supplierDocumentService');

describe('SupplierDocumentService — helpers', () => {
  it('similarity retorna 1 quando strings idênticas', () => {
    expect(_helpers.similarity('Botox 100u', 'Botox 100u')).toBe(1);
  });

  it('similarity é case e accent insensitive', () => {
    expect(_helpers.similarity('Ácido Hialurônico', 'acido hialuronico')).toBeGreaterThan(0.9);
  });

  it('similarity baixa para strings sem relação', () => {
    expect(_helpers.similarity('Botox', 'Aluguel')).toBeLessThan(0.3);
  });

  it('sanitizeCnpj normaliza para 14 dígitos', () => {
    expect(_helpers.sanitizeCnpj('12.345.678/0001-90')).toBe('12345678000190');
    expect(_helpers.sanitizeCnpj('12345678000190')).toBe('12345678000190');
    expect(_helpers.sanitizeCnpj('123.456')).toBeNull();
    expect(_helpers.sanitizeCnpj(null)).toBeNull();
  });

  it('normalizeItens aceita produtos/linhas aninhados e normaliza moeda brasileira', () => {
    const itens = _helpers.normalizeItens({
      produtos: [
        {
          produto: 'Toxina botulínica 100 UI',
          qtd: '2',
          un: 'frasco',
          valor_total: 'R$ 1.500,00',
          lote: 'L123',
          validade: '10/06/2026'
        }
      ]
    }, [
      {
        itens: [
          {
            descricao: 'Ácido hialurônico',
            quantidade: 3,
            valor_unitario: '350,50'
          }
        ]
      }
    ]);

    expect(itens).toEqual([
      expect.objectContaining({
        descricao: 'Toxina botulínica 100 UI',
        quantidade: 2,
        unidade: 'frasco',
        valor_unitario: 750,
        valor_total: 1500,
        lote: 'L123',
        validade: '2026-06-10'
      }),
      expect.objectContaining({
        descricao: 'Ácido hialurônico',
        quantidade: 3,
        valor_unitario: 350.5,
        valor_total: 1051.5
      })
    ]);
  });

  it('computeFileHash é estável para o mesmo buffer', () => {
    const buf = Buffer.from('hello supplier doc');
    const h1 = supplierDocumentService.computeFileHash(buf);
    const h2 = supplierDocumentService.computeFileHash(Buffer.from('hello supplier doc'));
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('SupplierDocumentService.fromDocumentResult', () => {
  it('extrai vencimentos a partir de transação com condicoes_pagamento', () => {
    const docResult = {
      tipo_documento: 'nota_fiscal',
      fornecedor: 'Distribuidora XYZ',
      cnpj: '12.345.678/0001-90',
      itens: [{ descricao: 'Ácido Hialurônico', quantidade: 2, valor_unitario: 1500 }],
      transacoes: [
        {
          tipo: 'saida',
          valor: 4000,
          data: '2026-05-07',
          condicoes_pagamento: ['2026-06-06', '2026-07-06'],
          confidence_score: 0.92
        }
      ],
      confidence_score: 0.92
    };
    const parsed = supplierDocumentService.fromDocumentResult(docResult);
    expect(parsed.tipo).toBe('nf');
    expect(parsed.fornecedor.nome).toBe('Distribuidora XYZ');
    expect(parsed.fornecedor.cnpj).toBe('12345678000190');
    expect(parsed.category).toBe('Insumos');
    expect(parsed.category_trigger).toMatch(/acido hialuronico|insumos/i);
    expect(parsed.valor_total).toBe(4000);
    expect(parsed.vencimentos).toHaveLength(2);
    expect(parsed.vencimentos[0]).toMatchObject({ numero: 1, valor: 2000, data: '2026-06-06' });
    expect(parsed.itens).toHaveLength(1);
    expect(parsed.confidence_score).toBe(0.92);
  });

  it('cai para vencimento único quando não há condicoes_pagamento', () => {
    const parsed = supplierDocumentService.fromDocumentResult({
      tipo_documento: 'boleto',
      fornecedor: 'Fornecedor Único',
      transacoes: [{ tipo: 'saida', valor: 1500, data: '2026-05-07' }]
    });
    expect(parsed.tipo).toBe('boleto');
    expect(parsed.vencimentos).toEqual([{ numero: 1, valor: 1500, data: '2026-05-07' }]);
    expect(parsed.valor_total).toBe(1500);
  });

  it('marca tipo "outro" para tipos desconhecidos', () => {
    const parsed = supplierDocumentService.fromDocumentResult({
      tipo_documento: 'extrato',
      transacoes: []
    });
    expect(parsed.tipo).toBe('outro');
    expect(parsed.valor_total).toBe(0);
    expect(parsed.vencimentos).toEqual([]);
  });

  it('confidence_score é o mínimo entre doc e transações', () => {
    const parsed = supplierDocumentService.fromDocumentResult({
      tipo_documento: 'nota_fiscal',
      transacoes: [
        { tipo: 'saida', valor: 100, data: '2026-05-01', confidence_score: 0.5 },
        { tipo: 'saida', valor: 200, data: '2026-05-02', confidence_score: 0.9 }
      ],
      confidence_score: 0.95
    });
    expect(parsed.confidence_score).toBe(0.5);
  });

  it('reconstrói parcelas pelo texto bruto quando o OCR não traz condicoes_pagamento', () => {
    const parsed = supplierDocumentService.fromDocumentResult({
      tipo_documento: 'nota_fiscal',
      fornecedor: 'Biogelis',
      cnpj: '12.345.678/0001-90',
      data_emissao: '2026-03-05',
      text: 'NF com condição 30/60/90/120 dias',
      itens: [{ descricao: 'Ácido hialurônico', quantidade: 2, valor_unitario: 2500 }],
      transacoes: [
        {
          tipo: 'saida',
          valor: 10000,
          data: '2026-03-05',
          categoria: 'Outros',
          parcelas: 4
        }
      ]
    });

    expect(parsed.category).toBe('Insumos');
    expect(parsed.category_trigger).toMatch(/biogelis/i);
    expect(parsed.vencimentos).toEqual([
      { numero: 1, valor: 2500, data: '2026-04-04' },
      { numero: 2, valor: 2500, data: '2026-05-04' },
      { numero: 3, valor: 2500, data: '2026-06-03' },
      { numero: 4, valor: 2500, data: '2026-07-03' }
    ]);
  });

  it('preserva itens normalizados vindos de chaves alternativas do OCR', () => {
    const parsed = supplierDocumentService.fromDocumentResult({
      tipo_documento: 'nota_fiscal',
      fornecedor: 'Fornecedor Estético',
      valor_total: 600,
      produtos: [
        { nome: 'Luva nitrílica', qtde: '4', valor_total: 'R$ 600,00' }
      ],
      transacoes: [
        { tipo: 'saida', valor: 600, data: '2026-06-01', categoria: 'Insumos' }
      ]
    });

    expect(parsed.itens).toHaveLength(1);
    expect(parsed.itens[0]).toMatchObject({
      descricao: 'Luva nitrílica',
      quantidade: 4,
      valor_unitario: 150,
      valor_total: 600
    });
  });
});

describe('SupplierDocumentService.applyEstoqueEntradaFromItens', () => {
  it('mantém itens de documento como pendentes e não aplica estoque automaticamente', async () => {
    const result = await supplierDocumentService.applyEstoqueEntradaFromItens('u1', {
      itens: [
        {
          descricao: 'Toxina botulínica 100UI',
          quantidade: 2,
          valor_unitario: 700
        }
      ]
    });

    expect(result).toMatchObject({
      aplicados: [],
      skipped: true,
      reason: 'stock_update_requires_manual_confirmation'
    });
    expect(result.pendentes).toEqual([
      expect.objectContaining({
        descricao: 'Toxina botulínica 100UI',
        motivo: 'requires_manual_stock_update'
      })
    ]);
  });
});
