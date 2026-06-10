jest.mock('../../src/services/estoqueService', () => ({}));
jest.mock('../../src/services/estoqueProdutoService', () => ({
  parseInventoryText: jest.fn(),
  configureInitialInventory: jest.fn(),
  getProdutoStatus: jest.fn(),
  getEstoqueStatus: jest.fn(),
  registrarEntrada: jest.fn(),
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

describe('EstoqueHandler inventário inicial', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cria confirmação pendente quando recebe lista de inventário', async () => {
    const item = { nome: 'Botox 100UI', quantidade: 3, unidade: 'frasco' };
    estoqueProdutoService.parseInventoryText.mockReturnValue([item]);
    runtime.upsert.mockResolvedValue(true);

    const handler = new EstoqueHandler();
    const reply = await handler.handleConfigurarEstoque({ id: 'u1' }, '5565', 'Botox 100UI | 3 frascos');

    expect(runtime.upsert).toHaveBeenCalledWith('5565', 'inventory_setup', { stage: 'confirm', itens: [item] }, expect.any(Number));
    expect(reply).toContain('Inventário inicial');
    expect(reply).toContain('Confirmar');
  });

  it('confirma e salva inventário pendente', async () => {
    const item = { nome: 'Botox 100UI', quantidade: 3, unidade: 'frasco' };
    runtime.get.mockResolvedValue({ payload: { stage: 'confirm', itens: [item] } });
    estoqueProdutoService.configureInitialInventory.mockResolvedValue({ applied: [{ nome: 'Botox 100UI' }], failed: [] });

    const handler = new EstoqueHandler();
    const reply = await handler.handlePendingInventorySetup('5565', '1', { id: 'u1' });

    expect(estoqueProdutoService.configureInitialInventory).toHaveBeenCalledWith('u1', [item], { sourcePhone: '5565' });
    expect(runtime.clear).toHaveBeenCalledWith('5565', 'inventory_setup');
    expect(reply).toContain('Inventário salvo: 1');
  });
});
