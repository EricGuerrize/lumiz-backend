process.env.NODE_ENV = 'test';

jest.mock('../../src/db/supabase', () => ({
  from: jest.fn()
}));

const supabase = require('../../src/db/supabase');
const userController = require('../../src/controllers/userController');

function makeQuery(rows, { terminal = 'order' } = {}) {
  const result = { data: rows, error: null };
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
  };
  chain[terminal] = jest.fn().mockResolvedValue(result);
  return chain;
}

describe('userController.getUserCategories', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('retorna procedimentos e categorias de despesa distintas', async () => {
    supabase.from
      .mockReturnValueOnce(makeQuery([
        { id: 'proc-1', nome: 'Botox' },
        { id: 'proc-2', nome: 'Preenchimento' },
      ]))
      .mockReturnValueOnce(makeQuery([
        { categoria: 'Aluguel' },
        { categoria: 'Aluguel' },
        { categoria: 'Insumos' },
      ], { terminal: 'not' }));

    const categories = await userController.getUserCategories('user-1');

    expect(categories).toEqual([
      { id: 'proc-1', name: 'Botox', type: 'procedimento' },
      { id: 'proc-2', name: 'Preenchimento', type: 'procedimento' },
      { id: 'despesa:Aluguel', name: 'Aluguel', type: 'despesa' },
      { id: 'despesa:Insumos', name: 'Insumos', type: 'despesa' },
    ]);
  });

  it('propaga erro do Supabase', async () => {
    const dbError = { message: 'db error' };
    const failingChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: null, error: dbError }),
    };
    const okChain = makeQuery([], { terminal: 'not' });
    supabase.from
      .mockReturnValueOnce(failingChain)
      .mockReturnValueOnce(okChain);

    await expect(userController.getUserCategories('user-1')).rejects.toEqual(dbError);
  });
});
