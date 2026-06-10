jest.mock('../../src/db/supabase', () => ({ from: jest.fn() }));

const estoqueProdutoService = require('../../src/services/estoqueProdutoService');
const { _helpers } = require('../../src/services/estoqueProdutoService');

describe('estoqueProdutoService.parseInventoryText', () => {
  it('extrai vários itens com quantidade, unidade, validade, custo e mínimo', () => {
    const itens = estoqueProdutoService.parseInventoryText(`
      Botox 100UI | 3 frascos | validade 10/2026 | custo 780 | mínimo 1
      Ácido hialurônico Voluma | 8 seringas | validade 05/2027
      Luvas nitrílicas | 12 caixas | mínimo 2
    `);

    expect(itens).toHaveLength(3);
    expect(itens[0]).toMatchObject({
      nome: 'Botox 100UI',
      quantidade: 3,
      unidade: 'frasco',
      validade: '2026-10-01',
      custo_unitario: 780,
      estoque_minimo: 1,
    });
    expect(itens[1]).toMatchObject({ nome: 'Ácido hialurônico Voluma', quantidade: 8, unidade: 'seringa' });
    expect(itens[2]).toMatchObject({ nome: 'Luvas nitrílicas', quantidade: 12, unidade: 'caixa', estoque_minimo: 2 });
  });

  it('ignora comando isolado e retorna vazio quando não há item físico', () => {
    expect(estoqueProdutoService.parseInventoryText('configurar estoque')).toEqual([]);
  });
});

describe('estoqueProdutoService helpers', () => {
  it('normaliza moeda brasileira e datas de validade', () => {
    expect(_helpers.parseNumber('R$ 1.234,56')).toBe(1234.56);
    expect(_helpers.normalizeDate('09/02/2026')).toBe('2026-02-09');
    expect(_helpers.normalizeDate('10/2026')).toBe('2026-10-01');
  });
});
