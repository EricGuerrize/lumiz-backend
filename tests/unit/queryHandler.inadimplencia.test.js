process.env.NODE_ENV = 'test';

jest.mock('../../src/controllers/transactionController', () => ({
  getBalance: jest.fn(),
  getMonthlyReport: jest.fn(),
  getMonthlyCashSummary: jest.fn()
}));

jest.mock('../../src/services/inadimplenciaService', () => ({
  getOverview: jest.fn()
}));

const inadimplenciaService = require('../../src/services/inadimplenciaService');
const QueryHandler = require('../../src/controllers/messages/queryHandler');

describe('QueryHandler inadimplência', () => {
  let handler;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = new QueryHandler();
  });

  it('retorna resumo direto de parcelas vencidas', async () => {
    inadimplenciaService.getOverview.mockResolvedValue({
      totalEmAtraso: 1800,
      percentualFaturamento: 12.5,
      totalParcelas: 2,
      clientes: [
        {
          nome: 'Maria',
          totalEmAtraso: 1800,
          totalParcelas: 2,
          diasAtrasoMax: 16,
          risco: 'medio'
        }
      ]
    });

    const text = await handler.handleInadimplencia({ id: 'user-1' });

    expect(text).toContain('Inadimplência');
    expect(text).toContain('R$ 1.800,00');
    expect(text).toContain('Maria');
    expect(text).toContain('risco médio');
  });

  it('retorna estado vazio quando não há vencidos', async () => {
    inadimplenciaService.getOverview.mockResolvedValue({
      totalEmAtraso: 0,
      totalParcelas: 0,
      clientes: []
    });

    const text = await handler.handleInadimplencia({ id: 'user-1' });

    expect(text).toContain('Não encontrei parcelas vencidas');
    expect(text).toContain('parcelas a receber');
  });
});
