/**
 * Item 28 — inventário/conferência assistida.
 * Cobre: parse + preview de diffs, abertura de pending, confirmação que aplica,
 * cancelamento, e caso "tudo bate" (sem pending).
 */
jest.mock('../../src/db/supabase', () => ({}));
jest.mock('../../src/services/estoqueService', () => ({}));
jest.mock('../../src/services/estoqueProdutoService', () => ({
  conferirSaldo: jest.fn(),
}));
jest.mock('../../src/services/conversationRuntimeStateService', () => ({
  get: jest.fn(),
  upsert: jest.fn(),
  clear: jest.fn(),
}));

const EstoqueHandler = require('../../src/controllers/messages/estoqueHandler');
const estoqueProdutoService = require('../../src/services/estoqueProdutoService');
const runtime = require('../../src/services/conversationRuntimeStateService');

describe('EstoqueHandler — inventário assistido (item 28)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('interpreta a contagem, calcula diffs e abre pending de confirmação', async () => {
    estoqueProdutoService.conferirSaldo
      .mockResolvedValueOnce({ nome: 'toxina', encontrado: true, anterior: 10, novo: 8, delta: -2, changed: false })
      .mockResolvedValueOnce({ nome: 'luvas', encontrado: true, anterior: 15, novo: 20, delta: 5, changed: false });

    const handler = new EstoqueHandler();
    const reply = await handler.handleConferirEstoque({ id: 'u1' }, '5565', 'estoque real: toxina 8, luvas 20');

    // preview: apply:false nas duas chamadas
    expect(estoqueProdutoService.conferirSaldo).toHaveBeenCalledTimes(2);
    expect(estoqueProdutoService.conferirSaldo).toHaveBeenNthCalledWith(1, 'u1', expect.objectContaining({ nome: 'toxina', saldoReal: 8 }), { apply: false });
    expect(runtime.upsert).toHaveBeenCalledWith('5565', 'inventory_recount', expect.objectContaining({ stage: 'confirm' }), expect.any(Number));
    expect(reply).toContain('Conferência de estoque');
    expect(reply).toContain('toxina');
    expect(reply).toContain('Confirmar');
  });

  it('quando tudo bate com o sistema, não abre pending', async () => {
    estoqueProdutoService.conferirSaldo
      .mockResolvedValueOnce({ nome: 'toxina', encontrado: true, anterior: 8, novo: 8, delta: 0, changed: false });

    const handler = new EstoqueHandler();
    const reply = await handler.handleConferirEstoque({ id: 'u1' }, '5565', 'estoque real: toxina 8');

    expect(runtime.upsert).not.toHaveBeenCalled();
    expect(reply).toContain('bate');
  });

  it('sem itens reconhecidos, devolve instruções', async () => {
    const handler = new EstoqueHandler();
    const reply = await handler.handleConferirEstoque({ id: 'u1' }, '5565', 'conferir estoque');
    expect(estoqueProdutoService.conferirSaldo).not.toHaveBeenCalled();
    expect(reply).toContain('contagem real');
  });

  it('confirmação aplica o ajuste em cada item', async () => {
    runtime.get.mockResolvedValue({ payload: { stage: 'confirm', itens: [
      { nome: 'toxina', quantidade: 8 },
      { nome: 'luvas', quantidade: 20 },
    ] } });
    estoqueProdutoService.conferirSaldo
      .mockResolvedValueOnce({ nome: 'toxina', anterior: 10, novo: 8, delta: -2, changed: true })
      .mockResolvedValueOnce({ nome: 'luvas', anterior: 15, novo: 20, delta: 5, changed: true });

    const handler = new EstoqueHandler();
    const reply = await handler.handlePendingInventoryRecount('5565', '1', { id: 'u1' });

    expect(estoqueProdutoService.conferirSaldo).toHaveBeenNthCalledWith(1, 'u1', expect.objectContaining({ nome: 'toxina', saldoReal: 8 }), { apply: true });
    expect(runtime.clear).toHaveBeenCalledWith('5565', 'inventory_recount');
    expect(reply).toContain('Estoque ajustado');
    expect(reply).toContain('toxina');
  });

  it('cancelamento não aplica nada', async () => {
    runtime.get.mockResolvedValue({ payload: { stage: 'confirm', itens: [{ nome: 'toxina', quantidade: 8 }] } });
    const handler = new EstoqueHandler();
    const reply = await handler.handlePendingInventoryRecount('5565', '2', { id: 'u1' });

    expect(estoqueProdutoService.conferirSaldo).not.toHaveBeenCalled();
    expect(runtime.clear).toHaveBeenCalledWith('5565', 'inventory_recount');
    expect(reply).toContain('cancelada');
  });

  it('retorna null quando não há pending', async () => {
    runtime.get.mockResolvedValue(null);
    const handler = new EstoqueHandler();
    const reply = await handler.handlePendingInventoryRecount('5565', '1', { id: 'u1' });
    expect(reply).toBeNull();
  });
});
