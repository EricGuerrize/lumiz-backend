/**
 * Item 23 (replanejado) — baixa de estoque pós-procedimento sob confirmação.
 * Cobre: caminho feliz (Sim → itens → confirma → baixa), recusa (Não),
 * item inexistente (separa applied/failed) e o parser de insumos digitados.
 *
 * Usa o procedimentoConsumoService REAL (parseUsedItems é puro) e mocka apenas
 * supabase + estoqueProdutoService para manter o teste unitário.
 */
jest.mock('../../src/db/supabase', () => ({}));
jest.mock('../../src/services/estoqueService', () => ({}));
jest.mock('../../src/services/estoqueProdutoService', () => ({
  registrarSaida: jest.fn(),
}));
jest.mock('../../src/services/conversationRuntimeStateService', () => ({
  get: jest.fn(),
  upsert: jest.fn(),
  clear: jest.fn(),
}));

const EstoqueHandler = require('../../src/controllers/messages/estoqueHandler');
const estoqueProdutoService = require('../../src/services/estoqueProdutoService');
const runtime = require('../../src/services/conversationRuntimeStateService');
const procedimentoConsumoService = require('../../src/services/procedimentoConsumoService');

describe('EstoqueHandler — baixa pós-procedimento', () => {
  beforeEach(() => jest.clearAllMocks());

  it('na etapa "ask", "1" avança para pedir os insumos', async () => {
    runtime.get.mockResolvedValue({ payload: { stage: 'ask', atendimentoId: 'a1' } });
    const handler = new EstoqueHandler();

    const reply = await handler.handlePendingStockAfterSale('5565', '1', { id: 'u1' });

    expect(runtime.upsert).toHaveBeenCalledWith(
      '5565',
      'stock_after_sale',
      expect.objectContaining({ stage: 'awaiting_items' }),
      expect.any(Number)
    );
    expect(reply).toContain('Quais insumos');
  });

  it('na etapa "ask", "2" encerra sem alterar estoque', async () => {
    runtime.get.mockResolvedValue({ payload: { stage: 'ask' } });
    const handler = new EstoqueHandler();

    const reply = await handler.handlePendingStockAfterSale('5565', '2', { id: 'u1' });

    expect(runtime.clear).toHaveBeenCalledWith('5565', 'stock_after_sale');
    expect(estoqueProdutoService.registrarSaida).not.toHaveBeenCalled();
    expect(reply).toContain('não vou alterar');
  });

  it('interpreta os insumos digitados e mostra o resumo', async () => {
    runtime.get.mockResolvedValue({ payload: { stage: 'awaiting_items', atendimentoId: 'a1' } });
    const handler = new EstoqueHandler();

    const reply = await handler.handlePendingStockAfterSale(
      '5565',
      '1 seringa, 2 agulhas, 20 unidades de toxina',
      { id: 'u1' }
    );

    const upsertArgs = runtime.upsert.mock.calls.at(-1);
    expect(upsertArgs[2].stage).toBe('confirm');
    expect(upsertArgs[2].itens).toEqual([
      { nome: 'seringa', quantidade: 1, unidade: 'unidade' },
      { nome: 'agulhas', quantidade: 2, unidade: 'unidade' },
      { nome: 'toxina', quantidade: 20, unidade: 'unidade' },
    ]);
    expect(reply).toContain('Vou baixar do estoque');
    expect(reply).toContain('Confirmar');
  });

  it('não entende lista vazia e pede de novo', async () => {
    runtime.get.mockResolvedValue({ payload: { stage: 'awaiting_items' } });
    const handler = new EstoqueHandler();

    const reply = await handler.handlePendingStockAfterSale('5565', 'sei lá', { id: 'u1' });

    // "sei lá" não casa nenhum padrão quantidade+item
    expect(reply).toContain('Não consegui entender');
    expect(runtime.upsert).not.toHaveBeenCalled();
  });

  it('confirma e baixa, separando itens aplicados de falhos', async () => {
    const itens = [
      { nome: 'seringa', quantidade: 1, unidade: 'unidade' },
      { nome: 'toxina', quantidade: 20, unidade: 'unidade' },
    ];
    runtime.get.mockResolvedValue({ payload: { stage: 'confirm', itens, atendimentoId: 'a1' } });

    estoqueProdutoService.registrarSaida
      .mockResolvedValueOnce({ nome: 'Seringa', unidade: 'seringa', estoqueAtual: 9 })
      .mockRejectedValueOnce(new Error('Produto não encontrado no inventário'));

    const handler = new EstoqueHandler();
    const reply = await handler.handlePendingStockAfterSale('5565', '1', { id: 'u1' });

    expect(estoqueProdutoService.registrarSaida).toHaveBeenCalledTimes(2);
    expect(runtime.clear).toHaveBeenCalledWith('5565', 'stock_after_sale');
    expect(reply).toContain('Estoque atualizado');
    expect(reply).toContain('Seringa');
    expect(reply).toContain('1 item(ns) não foram baixados');
    expect(reply).toContain('toxina');
  });

  it('"3" na confirmação volta para digitar os insumos', async () => {
    runtime.get.mockResolvedValue({ payload: { stage: 'confirm', itens: [{ nome: 'x', quantidade: 1, unidade: 'unidade' }] } });
    const handler = new EstoqueHandler();

    const reply = await handler.handlePendingStockAfterSale('5565', '3', { id: 'u1' });

    expect(runtime.upsert).toHaveBeenCalledWith(
      '5565',
      'stock_after_sale',
      expect.objectContaining({ stage: 'awaiting_items' }),
      expect.any(Number)
    );
    expect(reply).toContain('Me manda de novo');
  });

  it('retorna null quando não há pending', async () => {
    runtime.get.mockResolvedValue(null);
    const handler = new EstoqueHandler();
    const reply = await handler.handlePendingStockAfterSale('5565', '1', { id: 'u1' });
    expect(reply).toBeNull();
  });
});

describe('procedimentoConsumoService.parseUsedItems', () => {
  it('interpreta quantidade-antes-do-nome e "N unidades de X"', () => {
    expect(procedimentoConsumoService.parseUsedItems('1 seringa, 2 agulhas, 20 unidades de toxina')).toEqual([
      { nome: 'seringa', quantidade: 1, unidade: 'unidade' },
      { nome: 'agulhas', quantidade: 2, unidade: 'unidade' },
      { nome: 'toxina', quantidade: 20, unidade: 'unidade' },
    ]);
  });

  it('interpreta nome-antes-da-quantidade', () => {
    expect(procedimentoConsumoService.parseUsedItems('toxina 3')).toEqual([
      { nome: 'toxina', quantidade: 3, unidade: 'unidade' },
    ]);
  });

  it('ignora trechos sem quantidade', () => {
    expect(procedimentoConsumoService.parseUsedItems('só vim conversar')).toEqual([]);
  });
});
