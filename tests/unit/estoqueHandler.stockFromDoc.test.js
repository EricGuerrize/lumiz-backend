/**
 * Item 21 — entrada de estoque a partir de NF/documento, sob confirmação.
 * Cobre: abertura do fluxo, Sim → resumo, Não → encerra, confirmação com
 * criação de produto, e separação de itens aplicados/falhos.
 */
jest.mock('../../src/db/supabase', () => ({}));
jest.mock('../../src/services/estoqueService', () => ({}));
jest.mock('../../src/services/estoqueProdutoService', () => ({
  registrarEntrada: jest.fn(),
}));
jest.mock('../../src/services/conversationRuntimeStateService', () => ({
  get: jest.fn(),
  upsert: jest.fn(),
  clear: jest.fn(),
}));

const EstoqueHandler = require('../../src/controllers/messages/estoqueHandler');
const estoqueProdutoService = require('../../src/services/estoqueProdutoService');
const runtime = require('../../src/services/conversationRuntimeStateService');

const ITENS_NF = [
  { descricao: 'Toxina botulínica', quantidade: 2, unidade: 'frasco', valor_unitario: 780, validade: '2026-10-01' },
  { descricao: 'Luvas nitrílicas', quantidade: 5, unidade: 'caixa', valor_unitario: 30 },
];

describe('EstoqueHandler — entrada de estoque via NF (item 21)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('startStockFromDoc grava pending "ask" com os itens', async () => {
    const handler = new EstoqueHandler();
    await handler.startStockFromDoc('5565', { itens: ITENS_NF, supplierDocumentId: 'doc1', fornecedorId: 'f1' });

    expect(runtime.upsert).toHaveBeenCalledWith(
      '5565',
      'stock_from_doc',
      expect.objectContaining({ stage: 'ask', itens: ITENS_NF, supplierDocumentId: 'doc1', fornecedorId: 'f1' }),
      expect.any(Number)
    );
  });

  it('startStockFromDoc ignora quando não há itens', async () => {
    const handler = new EstoqueHandler();
    await handler.startStockFromDoc('5565', { itens: [] });
    expect(runtime.upsert).not.toHaveBeenCalled();
  });

  it('"1" na etapa ask mostra o resumo e vai para confirm', async () => {
    runtime.get.mockResolvedValue({ payload: { stage: 'ask', itens: ITENS_NF } });
    const handler = new EstoqueHandler();

    const reply = await handler.handlePendingStockFromDoc('5565', '1', { id: 'u1' });

    expect(runtime.upsert).toHaveBeenCalledWith(
      '5565',
      'stock_from_doc',
      expect.objectContaining({ stage: 'confirm' }),
      expect.any(Number)
    );
    expect(reply).toContain('Vou dar entrada no estoque');
    expect(reply).toContain('Toxina botulínica');
  });

  it('"2" na etapa ask encerra sem dar entrada', async () => {
    runtime.get.mockResolvedValue({ payload: { stage: 'ask', itens: ITENS_NF } });
    const handler = new EstoqueHandler();

    const reply = await handler.handlePendingStockFromDoc('5565', '2', { id: 'u1' });

    expect(runtime.clear).toHaveBeenCalledWith('5565', 'stock_from_doc');
    expect(estoqueProdutoService.registrarEntrada).not.toHaveBeenCalled();
    expect(reply).toContain('registrei só o financeiro');
  });

  it('confirma e dá entrada, separando aplicados de falhos', async () => {
    runtime.get.mockResolvedValue({ payload: { stage: 'confirm', itens: ITENS_NF, supplierDocumentId: 'doc1', fornecedorId: 'f1' } });
    estoqueProdutoService.registrarEntrada
      .mockResolvedValueOnce({ nome: 'Toxina botulínica', unidade: 'frasco', estoqueAtual: 2 })
      .mockRejectedValueOnce(new Error('Quantidade válida é obrigatória'));

    const handler = new EstoqueHandler();
    const reply = await handler.handlePendingStockFromDoc('5565', '1', { id: 'u1' });

    expect(estoqueProdutoService.registrarEntrada).toHaveBeenCalledTimes(2);
    // primeiro item: mapeia descricao→nome, custo, validade, allowCreate
    expect(estoqueProdutoService.registrarEntrada).toHaveBeenNthCalledWith(1, 'u1', expect.objectContaining({
      nome: 'Toxina botulínica',
      quantidade: 2,
      unidade: 'frasco',
      custo_unitario: 780,
      validade: '2026-10-01',
      allowCreate: true,
      origem: 'nf_documento',
      supplierDocumentId: 'doc1',
    }));
    expect(runtime.clear).toHaveBeenCalledWith('5565', 'stock_from_doc');
    expect(reply).toContain('Estoque atualizado');
    expect(reply).toContain('Toxina botulínica');
    expect(reply).toContain('1 item(ns) não entraram');
  });

  it('retorna null quando não há pending', async () => {
    runtime.get.mockResolvedValue(null);
    const handler = new EstoqueHandler();
    const reply = await handler.handlePendingStockFromDoc('5565', '1', { id: 'u1' });
    expect(reply).toBeNull();
  });
});
