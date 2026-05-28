process.env.NODE_ENV = 'test';

jest.mock('../../src/controllers/transactionController', () => ({
  getBalance: jest.fn(),
  getMonthlyReport: jest.fn(),
  getMonthlyCashSummary: jest.fn()
}));

const transactionController = require('../../src/controllers/transactionController');
const QueryHandler = require('../../src/controllers/messages/queryHandler');

describe('QueryHandler copy pós-onboarding', () => {
  let handler;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = new QueryHandler();
  });

  it('saldo diferencia faturamento registrado de caixa recebido', async () => {
    transactionController.getBalance.mockResolvedValue({
      entradas: 7500,
      saidas: 500,
      saldo: 7000
    });
    transactionController.getMonthlyCashSummary.mockResolvedValue({
      entradasPrevistas: 3500,
      saidasPrevistas: 500,
      saldoPrevisto: 3000,
      parcelasPrevistas: 2
    });

    const text = await handler.handleBalance({ id: 'user-1' });

    expect(text).toContain('Faturamento registrado');
    expect(text).toContain('Caixa previsto no mês');
    expect(text).toContain('Custos registrados');
    expect(text).toContain('Resultado estimado');
    expect(text).toContain('Venda parcelada');
  });

  it('relatório limpa categoria gerada por forma de pagamento e adiciona leitura CFO', async () => {
    transactionController.getMonthlyReport.mockResolvedValue({
      entradas: 7500,
      saidas: 500,
      totalTransacoes: 3,
      porCategoria: {
        Botox: { tipo: 'entrada', total: 5000 },
        'Credito Em': { tipo: 'entrada', total: 2500 },
        outro: { tipo: 'saida', total: 500 }
      }
    });
    transactionController.getMonthlyCashSummary.mockResolvedValue({
      entradasPrevistas: 3500,
      saidasPrevistas: 500,
      saldoPrevisto: 3000,
      parcelasPrevistas: 2
    });

    const text = await handler.handleMonthlyReport({ id: 'user-1' }, { mes: 5, ano: 2026 });

    expect(text).toContain('RELATÓRIO FINANCEIRO');
    expect(text).toContain('Caixa previsto no mês');
    expect(text).toContain('Saldo de caixa previsto');
    expect(text).toContain('Procedimento não identificado');
    expect(text).toContain('Leitura CFO');
    expect(text).toContain('parcela(s) prevista(s)');
  });
});
