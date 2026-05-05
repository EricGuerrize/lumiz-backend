let colaboradorService;
let supabase;

function chainResolve(final) {
  const c = {};
  ['select', 'eq', 'order', 'insert', 'update', 'delete', 'gte', 'lte', 'in', 'single'].forEach((m) => {
    c[m] = jest.fn(() => c);
  });
  c.then = Promise.resolve(final).then.bind(Promise.resolve(final));
  return c;
}

beforeEach(() => {
  jest.resetModules();
  jest.mock('../../src/db/supabase');
  supabase = require('../../src/db/supabase');
  colaboradorService = require('../../src/services/colaboradorService');
});

describe('colaboradorService', () => {
  it('create exige nome', async () => {
    await expect(colaboradorService.create('u1', {})).rejects.toThrow('nome é obrigatório');
  });

  it('list retorna items', async () => {
    supabase.from = jest.fn(() => chainResolve({ data: [{ id: 'c1', nome: 'Ana' }], error: null }));
    const out = await colaboradorService.list('u1');
    expect(out).toHaveLength(1);
  });

  it('getComissoesByMonth soma total', async () => {
    supabase.from = jest.fn(() =>
      chainResolve({
        data: [
          { id: 'x', valor: '100' },
          { id: 'y', valor: '50.5' },
        ],
        error: null,
      })
    );
    const out = await colaboradorService.getComissoesByMonth('u1', 'col1', '2026-05');
    expect(out.total).toBe(150.5);
    expect(out.month).toBe('2026-05');
  });
});
