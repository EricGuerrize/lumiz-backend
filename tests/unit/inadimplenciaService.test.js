process.env.NODE_ENV = 'test';

jest.mock('../../src/db/supabase', () => ({
  from: jest.fn()
}));

const supabase = require('../../src/db/supabase');
const service = require('../../src/services/inadimplenciaService');

function makeParcelasQuery(rows) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue({ data: rows, error: null })
  };
}

function makeRevenueQuery(rows) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockResolvedValue({ data: rows, error: null })
  };
}

describe('inadimplenciaService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('inclui parcela vencida mesmo quando o atendimento não tem cliente associado', async () => {
    const overdueRows = [
      {
        id: 'parcela-1',
        numero: 1,
        valor: 1200,
        data_vencimento: '2026-01-10',
        atendimento_id: 'atendimento-1',
        atendimentos: {
          id: 'atendimento-1',
          user_id: 'user-1',
          cliente_id: null,
          valor_total: 1200,
          data: '2026-01-01',
          clientes: null
        }
      }
    ];

    supabase.from
      .mockReturnValueOnce(makeParcelasQuery(overdueRows))
      .mockReturnValueOnce(makeRevenueQuery([{ valor_total: 1200 }]));

    const overview = await service.getOverview('user-1');

    expect(overview.totalEmAtraso).toBe(1200);
    expect(overview.totalParcelas).toBe(1);
    expect(overview.clientes).toHaveLength(1);
    expect(overview.clientes[0]).toEqual(expect.objectContaining({
      clienteId: 'atendimento-1',
      nome: 'Cliente não informado',
      totalEmAtraso: 1200,
      totalDevido: 1200,
      parcelasAtrasadas: 1,
      diasMaximoAtraso: expect.any(Number),
    }));
  });
});
