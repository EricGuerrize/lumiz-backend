jest.mock('../../src/services/estoqueProdutoService');
jest.mock('../../src/services/estoqueService');

const estoqueProdutoService = require('../../src/services/estoqueProdutoService');
const estoqueService = require('../../src/services/estoqueService');
const dashboardEstoqueService = require('../../src/services/dashboardEstoqueService');

const USER_ID = 'user-abc';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('dashboardEstoqueService.getEstoqueStatus', () => {
  it('retorna inventário real quando há produtos', async () => {
    estoqueProdutoService.getEstoqueStatus.mockResolvedValue({
      produtos: [{ id: 'p1', nome: 'Botox', status: 'ok' }],
    });

    const result = await dashboardEstoqueService.getEstoqueStatus(USER_ID);

    expect(result.source).toBe('real_inventory');
    expect(result.meta).toEqual({ is_empty: false });
    expect(result.produtos).toHaveLength(1);
    expect(estoqueService.getEstoqueStatus).not.toHaveBeenCalled();
  });

  it('faz fallback para legado quando inventário real está vazio', async () => {
    estoqueProdutoService.getEstoqueStatus.mockResolvedValue({ produtos: [] });
    estoqueService.getEstoqueStatus.mockResolvedValue({
      produtos: [{ id: 'proc1', nome: 'Preenchimento', status: 'ok' }],
      diasConsumoReferencia: 90,
    });

    const result = await dashboardEstoqueService.getEstoqueStatus(USER_ID);

    expect(result.source).toBe('legacy_procedimentos');
    expect(result.meta.is_empty).toBe(false);
    expect(estoqueService.getEstoqueStatus).toHaveBeenCalledWith(USER_ID);
  });
});

describe('dashboardEstoqueService.getAlertasBaixoEstoque', () => {
  it('usa listarAlertasCriticos no inventário real', async () => {
    estoqueProdutoService.getEstoqueStatus.mockResolvedValue({
      produtos: [{ id: 'p1', status: 'baixo' }],
    });
    estoqueProdutoService.listarAlertasCriticos.mockResolvedValue([
      { id: 'p1', status: 'baixo' },
    ]);

    const result = await dashboardEstoqueService.getAlertasBaixoEstoque(USER_ID);

    expect(result.source).toBe('real_inventory');
    expect(result.total).toBe(1);
    expect(estoqueProdutoService.listarAlertasCriticos).toHaveBeenCalledWith(USER_ID);
    expect(estoqueService.getAlertasBaixoEstoque).not.toHaveBeenCalled();
  });

  it('usa legado quando não há produtos reais', async () => {
    estoqueProdutoService.getEstoqueStatus.mockResolvedValue({ produtos: [] });
    estoqueService.getAlertasBaixoEstoque.mockResolvedValue({ alertas: [], total: 0 });

    const result = await dashboardEstoqueService.getAlertasBaixoEstoque(USER_ID);

    expect(result.source).toBe('legacy_procedimentos');
    expect(estoqueService.getAlertasBaixoEstoque).toHaveBeenCalledWith(USER_ID);
  });
});

describe('dashboardEstoqueService.getAlertasEstoqueExcesso', () => {
  it('filtra status excesso no inventário real', async () => {
    estoqueProdutoService.getEstoqueStatus.mockResolvedValue({
      produtos: [
        { id: 'p1', status: 'excesso' },
        { id: 'p2', status: 'ok' },
      ],
    });

    const result = await dashboardEstoqueService.getAlertasEstoqueExcesso(USER_ID);

    expect(result.source).toBe('real_inventory');
    expect(result.total).toBe(1);
    expect(result.alertas[0].id).toBe('p1');
  });

  it('delega ao legado quando inventário real está vazio', async () => {
    estoqueProdutoService.getEstoqueStatus.mockResolvedValue({ produtos: [] });
    estoqueService.getAlertasEstoqueExcesso.mockResolvedValue({ alertas: [], total: 0 });

    const result = await dashboardEstoqueService.getAlertasEstoqueExcesso(USER_ID);

    expect(result.source).toBe('legacy_procedimentos');
    expect(estoqueService.getAlertasEstoqueExcesso).toHaveBeenCalledWith(USER_ID);
  });
});

describe('dashboardEstoqueService.sugerirReposicao', () => {
  it('mantém legado e anota source real_inventory', async () => {
    estoqueProdutoService.getEstoqueStatus.mockResolvedValue({
      produtos: [{ id: 'p1' }],
    });
    estoqueService.sugerirReposicao.mockResolvedValue({ saldoDisponivel: 1000, sugestoes: [], total: 0 });

    const result = await dashboardEstoqueService.sugerirReposicao(USER_ID, 500);

    expect(result.source).toBe('real_inventory');
    expect(estoqueService.sugerirReposicao).toHaveBeenCalledWith(USER_ID, 500);
  });
});
