let estoqueService;
let supabase;
let transactionController;
let evolutionService;
let reminderSentHelper;

function chainResolve(final) {
  const c = {};
  ['select', 'eq', 'order', 'gte', 'in', 'limit', 'maybeSingle', 'single', 'insert', 'update', 'not']
    .forEach((m) => {
      c[m] = jest.fn(() => c);
    });
  const p = Promise.resolve(final);
  c.then = p.then.bind(p);
  return c;
}

beforeEach(() => {
  jest.resetModules();
  jest.mock('../../src/db/supabase');
  jest.mock('../../src/controllers/transactionController');
  jest.mock('../../src/services/evolutionService');
  jest.mock('../../src/services/reminderSentHelper');
  jest.mock('../../src/copy/estoqueWhatsappCopy', () => ({
    alertaEstoqueBaixo: jest.fn(() => 'agg'),
    alertaEstoqueCritico: jest.fn(() => 'crit'),
  }));
  supabase = require('../../src/db/supabase');
  transactionController = require('../../src/controllers/transactionController');
  evolutionService = require('../../src/services/evolutionService');
  reminderSentHelper = require('../../src/services/reminderSentHelper');
  estoqueService = require('../../src/services/estoqueService');
});

describe('getEstoqueStatus', () => {
  it('retorna sem_historico quando não há consumo em 90 dias', async () => {
    const procRow = {
      id: 'p1',
      nome: 'Botox',
      estoque_ml: 100,
      estoque_minimo: 50,
      unidade: 'ml',
      fornecedor_id: null,
      fornecedores: null,
    };
    let step = 0;
    supabase.from = jest.fn(() => {
      step += 1;
      if (step === 1) {
        return chainResolve({ data: [procRow], error: null });
      }
      if (step === 2) {
        return chainResolve({ data: [], error: null });
      }
      return chainResolve({ data: [], error: null });
    });

    const out = await estoqueService.getEstoqueStatus('user-1');
    expect(out.produtos).toHaveLength(1);
    expect(out.produtos[0].status).toBe('sem_historico');
  });

  it('retorna critico quando estoque abaixo de 50% do mínimo e há consumo', async () => {
    const procRow = {
      id: 'p1',
      nome: 'X',
      estoque_ml: 20,
      estoque_minimo: 100,
      unidade: 'ml',
      fornecedor_id: null,
      fornecedores: null,
    };
    let step = 0;
    supabase.from = jest.fn((table) => {
      step += 1;
      if (step === 1) {
        return chainResolve({ data: [procRow], error: null });
      }
      if (table === 'atendimentos') {
        return chainResolve({ data: [{ id: 'a1' }], error: null });
      }
      if (table === 'atendimento_procedimentos') {
        return chainResolve({ data: [{ ml_utilizado: 900 }], error: null });
      }
      return chainResolve({ data: [], error: null });
    });

    const out = await estoqueService.getEstoqueStatus('user-1');
    expect(out.produtos[0].status).toBe('critico');
  });
});

describe('getAlertasBaixoEstoque', () => {
  it('retorna apenas baixo ou critico ordenados por dias de suprimento', async () => {
    jest.spyOn(estoqueService, 'getEstoqueStatus').mockResolvedValue({
      produtos: [
        { id: '1', nome: 'A', status: 'ok', diasSuprimento: 10 },
        { id: '2', nome: 'B', status: 'baixo', diasSuprimento: 5 },
        { id: '3', nome: 'C', status: 'critico', diasSuprimento: 2 },
      ],
      diasConsumoReferencia: 90,
    });
    const { alertas } = await estoqueService.getAlertasBaixoEstoque('u');
    expect(alertas.map((a) => a.id)).toEqual(['3', '2']);
    estoqueService.getEstoqueStatus.mockRestore();
  });
});

describe('sugerirReposicao', () => {
  it("momento agora quando custo estimado <= saldo; aguardar quando não", async () => {
    jest.spyOn(estoqueService, 'getAlertasBaixoEstoque').mockResolvedValue({
      alertas: [
        {
          id: 'p1',
          nome: 'Botox',
          unidade: 'ml',
          status: 'baixo',
          diasSuprimento: 1,
          fornecedor: null,
        },
      ],
      total: 1,
    });
    supabase.from = jest.fn(() =>
      chainResolve({
        data: [{ id: 'p1', nome: 'Botox', unidade: 'ml', estoque_ml: 10, custo_material_ml: 5 }],
        error: null,
      })
    );
    jest.spyOn(estoqueService, '_consumoMlNoPeriodo').mockResolvedValue(100);

    const r1 = await estoqueService.sugerirReposicao('u', 1000);
    expect(r1.sugestoes[0].momento).toBe('agora');

    const r2 = await estoqueService.sugerirReposicao('u', 1);
    expect(r2.sugestoes[0].momento).toBe('aguardar');

    estoqueService.getAlertasBaixoEstoque.mockRestore();
    estoqueService._consumoMlNoPeriodo.mockRestore();
  });
});

describe('registrarEntrada', () => {
  it('incrementa estoque_ml e retorna estoque atual', async () => {
    let n = 0;
    supabase.from = jest.fn((table) => {
      n += 1;
      if (n === 1) {
        const c = chainResolve({
          data: { id: 'p1', nome: 'X', estoque_ml: 40, user_id: 'u1' },
          error: null,
        });
        return c;
      }
      if (n === 2) {
        return chainResolve({ data: null, error: null });
      }
      return chainResolve({
        data: { estoque_ml: 50, nome: 'X', unidade: 'ml' },
        error: null,
      });
    });

    const out = await estoqueService.registrarEntrada('u1', {
      procedimentoId: 'p1',
      quantidade: 10,
    });
    expect(out.estoqueAtual).toBe(50);
  });
});

describe('checkAndAlertEstoqueBaixo', () => {
  it('não envia WhatsApp se já enviou hoje (alreadySent)', async () => {
    supabase.from = jest.fn(() =>
      chainResolve({
        data: [{ id: 'prof1', telefone: '5511999999999' }],
        error: null,
      })
    );
    jest.spyOn(estoqueService, 'getAlertasBaixoEstoque').mockResolvedValue({
      alertas: [{ id: 'px', nome: 'P', status: 'baixo', estoqueAtual: 1, estoqueMinimo: 10, unidade: 'ml', diasSuprimento: 1 }],
      total: 1,
    });
    reminderSentHelper.alreadySent.mockReset();
    reminderSentHelper.alreadySent.mockResolvedValue(true);
    reminderSentHelper.markSent.mockReset();
    evolutionService.sendMessage = jest.fn();

    await estoqueService.checkAndAlertEstoqueBaixo();
    expect(evolutionService.sendMessage).not.toHaveBeenCalled();

    estoqueService.getAlertasBaixoEstoque.mockRestore();
  });
});
