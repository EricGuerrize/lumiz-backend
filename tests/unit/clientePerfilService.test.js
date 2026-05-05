let clientePerfilService;
let supabase;

function chainResolve(final) {
  const c = {};
  ['select', 'eq', 'not', 'in', 'lt'].forEach((m) => {
    c[m] = jest.fn(() => c);
  });
  const p = Promise.resolve(final);
  c.then = p.then.bind(p);
  return c;
}

beforeEach(() => {
  jest.resetModules();
  jest.mock('../../src/db/supabase');
  supabase = require('../../src/db/supabase');
  clientePerfilService = require('../../src/services/clientePerfilService');
});

describe('clientePerfilService.getPerfilPagamento', () => {
  it('agrega formas, preferência e risco por cliente', async () => {
    supabase.from = jest.fn((table) => {
      if (table === 'atendimentos') {
        return chainResolve({
          data: [
            { cliente_id: 'c1', forma_pagamento: 'pix', valor_total: '100' },
            { cliente_id: 'c1', forma_pagamento: 'credito_avista', valor_total: '300' },
            { cliente_id: 'c2', forma_pagamento: 'dinheiro', valor_total: '50' },
          ],
          error: null,
        });
      }
      if (table === 'clientes') {
        return chainResolve({
          data: [
            { id: 'c1', nome: 'Maria' },
            { id: 'c2', nome: 'Ana' },
          ],
          error: null,
        });
      }
      return chainResolve({
        data: [{ atendimentos: { cliente_id: 'c2' } }],
        error: null,
      });
    });

    const out = await clientePerfilService.getPerfilPagamento('u1');
    expect(out.clientes).toHaveLength(2);
    const maria = out.clientes.find((c) => c.clienteId === 'c1');
    const ana = out.clientes.find((c) => c.clienteId === 'c2');
    expect(maria.forma_preferida).toBe('pix');
    expect(maria.ticket_medio).toBe(200);
    expect(ana.indice_risco_pagamento).toBe('alto');
    expect(out.resumo.total_clientes).toBe(2);
    expect(out.resumo.clientes_risco_alto).toBe(1);
  });
});
