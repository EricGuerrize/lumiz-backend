jest.mock('../../src/services/estoqueService', () => ({}));
jest.mock('../../src/services/estoqueProdutoService', () => ({
  parseInventoryText: jest.fn(),
  configureInitialInventory: jest.fn(),
  getProdutoStatus: jest.fn(),
  getEstoqueStatus: jest.fn(),
  registrarEntrada: jest.fn(),
  registrarSaida: jest.fn(),
}));
jest.mock('../../src/services/estoqueImportService', () => ({
  confirmImport: jest.fn(),
  undoImport: jest.fn(),
}));
jest.mock('../../src/services/conversationRuntimeStateService', () => ({
  get: jest.fn(),
  upsert: jest.fn(),
  clear: jest.fn(),
}));

const EstoqueHandler = require('../../src/controllers/messages/estoqueHandler');
const estoqueProdutoService = require('../../src/services/estoqueProdutoService');
const estoqueImportService = require('../../src/services/estoqueImportService');
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
    expect(reply).toContain('confirmar');
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

  it('confirma importação de planilha pendente', async () => {
    runtime.get.mockResolvedValue({
      payload: {
        stage: 'confirm',
        importToken: 'batch-1',
        preview: [{ nome: 'Botox', quantidade: 2 }],
        summary: { valid_rows: 1 },
      },
    });
    estoqueImportService.confirmImport.mockResolvedValue({
      applied: [{ nome: 'Botox' }],
      failed: [],
      summary: { applied_count: 1 },
    });

    const handler = new EstoqueHandler();
    const reply = await handler.handlePendingInventoryImport('5565', '1', { id: 'u1' });

    expect(estoqueImportService.confirmImport).toHaveBeenCalledWith('u1', 'batch-1', { sourcePhone: '5565' });
    expect(runtime.clear).toHaveBeenCalledWith('5565', 'inventory_import');
    expect(reply).toContain('Estoque importado');
  });

  it('abre pending ao iniciar import de planilha', async () => {
    runtime.upsert.mockResolvedValue(true);
    const handler = new EstoqueHandler();

    await handler.startInventoryImportFromSpreadsheet('5565', {
      importToken: 'batch-2',
      preview: [{ nome: 'Luva', quantidade: 5 }],
      summary: { valid_rows: 1 },
      filename: 'estoque.xlsx',
    });

    expect(runtime.upsert).toHaveBeenCalledWith(
      '5565',
      'inventory_import',
      expect.objectContaining({ stage: 'confirm', importToken: 'batch-2' }),
      expect.any(Number)
    );
  });

  it('desfaz importação quando usuário confirma undo', async () => {
    runtime.get.mockResolvedValue({
      payload: { stage: 'undo_confirm', batchId: 'batch-9' },
    });
    estoqueImportService.undoImport.mockResolvedValue({ ok: true, batch_id: 'batch-9' });

    const handler = new EstoqueHandler();
    const reply = await handler.handlePendingInventoryImportUndo('5565', 'desfazer importação', { id: 'u1' });

    expect(estoqueImportService.undoImport).toHaveBeenCalledWith('u1', 'batch-9');
    expect(runtime.clear).toHaveBeenCalledWith('5565', 'inventory_import_undo');
    expect(reply).toContain('Importação desfeita');
  });

  it('não executa baixa direta de estoque por comando solto', async () => {
    const handler = new EstoqueHandler();

    const reply = await handler.handleSaidaEstoque(
      { id: 'u1' },
      { dados: { produto: 'Botox', quantidade: 1 } },
      '5565'
    );

    expect(estoqueProdutoService.registrarSaida).not.toHaveBeenCalled();
    expect(reply).toContain('não vou baixar estoque por comando solto');
    expect(reply).toContain('pós-procedimento');
  });
});
