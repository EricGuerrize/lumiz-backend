jest.mock('../../src/db/supabase', () => ({ from: jest.fn() }));
jest.mock('../../src/services/estoqueProdutoService', () => ({
  findProductByName: jest.fn(),
  registrarSaida: jest.fn(),
}));

const procedimentoConsumoService = require('../../src/services/procedimentoConsumoService');
const estoqueProdutoService = require('../../src/services/estoqueProdutoService');

describe('procedimentoConsumoService.parseConsumptionSetupText', () => {
  it('extrai procedimento e itens de consumo por venda', () => {
    const parsed = procedimentoConsumoService.parseConsumptionSetupText(
      'configurar consumo botox: Botox 100UI 0,25 frasco; Luvas nitrílicas 1 par'
    );

    expect(parsed.procedimentoNome).toBe('botox');
    expect(parsed.itens).toEqual([
      { nome: 'Botox 100UI', quantidade: 0.25, unidade: 'frasco' },
      { nome: 'Luvas nitrílicas', quantidade: 1, unidade: 'par' },
    ]);
  });

  it('retorna vazio quando formato não informa itens', () => {
    expect(procedimentoConsumoService.parseConsumptionSetupText('configurar consumo')).toEqual({
      procedimentoNome: null,
      itens: [],
    });
  });
});

describe('procedimentoConsumoService.applyConsumptionForSale', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('não baixa estoque por padrão', async () => {
    const result = await procedimentoConsumoService.applyConsumptionForSale('user-1', {
      procedimentoNome: 'Botox',
      atendimentoId: 'at-1',
      sourcePhone: '5565999999999',
    });

    expect(result).toEqual({
      skipped: true,
      reason: 'auto_consumption_disabled',
      applied: [],
      failed: [],
    });
    expect(estoqueProdutoService.registrarSaida).not.toHaveBeenCalled();
  });

  it('dá baixa somente quando explicitamente autorizado pelo chamador', async () => {
    jest.spyOn(procedimentoConsumoService, 'getRulesForProcedureName').mockResolvedValue([
      {
        id: 'rule-1',
        produtoId: 'prod-1',
        produtoNome: 'Botox 100UI',
        unidade: 'frasco',
        quantidadePadrao: 0.25,
        procedimento: { id: 'proc-1', nome: 'Botox' },
      },
    ]);
    estoqueProdutoService.registrarSaida.mockResolvedValue({
      produtoId: 'prod-1',
      nome: 'Botox 100UI',
      quantidade: 0.25,
      estoqueAtual: 2.75,
      unidade: 'frasco',
    });

    const result = await procedimentoConsumoService.applyConsumptionForSale('user-1', {
      procedimentoNome: 'Botox',
      atendimentoId: 'at-1',
      sourcePhone: '5565999999999',
      allowAutoConsumption: true,
    });

    expect(result.skipped).toBe(false);
    expect(result.applied).toHaveLength(1);
    expect(estoqueProdutoService.registrarSaida).toHaveBeenCalledWith('user-1', expect.objectContaining({
      produtoId: 'prod-1',
      quantidade: 0.25,
      origem: 'procedimento_auto',
      sourcePhone: '5565999999999',
    }));
  });

  it('preserva falha por item sem derrubar o resultado inteiro', async () => {
    jest.spyOn(procedimentoConsumoService, 'getRulesForProcedureName').mockResolvedValue([
      {
        id: 'rule-1',
        produtoId: 'prod-1',
        produtoNome: 'Botox 100UI',
        unidade: 'frasco',
        quantidadePadrao: 10,
        procedimento: { id: 'proc-1', nome: 'Botox' },
      },
    ]);
    estoqueProdutoService.registrarSaida.mockRejectedValue(new Error('Estoque insuficiente'));

    const result = await procedimentoConsumoService.applyConsumptionForSale('user-1', {
      procedimentoNome: 'Botox',
      atendimentoId: 'at-1',
      allowAutoConsumption: true,
    });

    expect(result.skipped).toBe(false);
    expect(result.applied).toEqual([]);
    expect(result.failed).toEqual([
      expect.objectContaining({ produtoNome: 'Botox 100UI', erro: 'Estoque insuficiente' }),
    ]);
  });
});
