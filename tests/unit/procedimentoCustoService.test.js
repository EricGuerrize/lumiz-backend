let procedimentoCustoService;
let supabase;

function buildChain(final) {
  const c = {};
  ['select', 'eq', 'gte', 'lte', 'order', 'in'].forEach((m) => {
    c[m] = jest.fn(() => c);
  });
  c.then = Promise.resolve(final).then.bind(Promise.resolve(final));
  return c;
}

beforeEach(() => {
  jest.resetModules();
  jest.mock('../../src/db/supabase');
  supabase = require('../../src/db/supabase');
  procedimentoCustoService = require('../../src/services/procedimentoCustoService');
});

describe('procedimentoCustoService com comissões', () => {
  it('inclui comissao_media no resultado', async () => {
    supabase.from = jest.fn((table) => {
      if (table === 'procedimentos') {
        return buildChain({
          data: [{ id: 'p1', nome: 'Botox' }],
          error: null,
        });
      }
      if (table === 'atendimento_procedimentos') {
        return buildChain({
          data: [
            {
              procedimento_id: 'p1',
              atendimento_id: 'a1',
              custo_material: 100,
              valor_cobrado: 500,
              procedimentos: { id: 'p1', nome: 'Botox' },
              atendimentos: { user_id: 'u1', data: '2026-05-01', forma_pagamento: 'pix', mdr_percent_applied: 0 },
            },
          ],
          error: null,
        });
      }
      if (table === 'contas_pagar') return buildChain({ data: [], error: null });
      return buildChain({
        data: [{ atendimento_id: 'a1', valor: 50 }],
        error: null,
      });
    });

    const out = await procedimentoCustoService.getCustoRealProcedimentos('u1', 3);
    expect(out.procedimentos[0].comissao_media).toBe(50);
  });

  it('comissao_media zero quando não há comissão', async () => {
    supabase.from = jest.fn((table) => {
      if (table === 'procedimentos') return buildChain({ data: [{ id: 'p1', nome: 'X' }], error: null });
      if (table === 'atendimento_procedimentos') {
        return buildChain({
          data: [
            {
              procedimento_id: 'p1',
              atendimento_id: 'a1',
              custo_material: 100,
              valor_cobrado: 500,
              procedimentos: { id: 'p1', nome: 'X' },
              atendimentos: { user_id: 'u1', data: '2026-05-01', forma_pagamento: 'pix', mdr_percent_applied: 0 },
            },
          ],
          error: null,
        });
      }
      return buildChain({ data: [], error: null });
    });
    const out = await procedimentoCustoService.getCustoRealProcedimentos('u1', 3);
    expect(out.procedimentos[0].comissao_media).toBe(0);
  });

  it('soma total_pro_labore_periodo separadamente', async () => {
    supabase.from = jest.fn((table) => {
      if (table === 'procedimentos') return buildChain({ data: [], error: null });
      if (table === 'atendimento_procedimentos') return buildChain({ data: [], error: null });
      if (table === 'contas_pagar') {
        return buildChain({
          data: [
            { valor: 100, is_pro_labore: false },
            { valor: 80, is_pro_labore: true },
          ],
          error: null,
        });
      }
      return buildChain({ data: [], error: null });
    });
    const out = await procedimentoCustoService.getCustoRealProcedimentos('u1', 3);
    expect(out.total_pro_labore_periodo).toBe(80);
    expect(out.total_despesas_operacionais_periodo).toBe(100);
  });

  it('custo_total_real considera comissão no cálculo', async () => {
    supabase.from = jest.fn((table) => {
      if (table === 'procedimentos') return buildChain({ data: [{ id: 'p1', nome: 'X' }], error: null });
      if (table === 'atendimento_procedimentos') {
        return buildChain({
          data: [
            {
              procedimento_id: 'p1',
              atendimento_id: 'a1',
              custo_material: 100,
              valor_cobrado: 500,
              procedimentos: { id: 'p1', nome: 'X' },
              atendimentos: { user_id: 'u1', data: '2026-05-01', forma_pagamento: 'pix', mdr_percent_applied: 0 },
            },
          ],
          error: null,
        });
      }
      if (table === 'contas_pagar') return buildChain({ data: [], error: null });
      return buildChain({ data: [{ atendimento_id: 'a1', valor: 40 }], error: null });
    });
    const out = await procedimentoCustoService.getCustoRealProcedimentos('u1', 3);
    expect(out.procedimentos[0].custo_total_real).toBe(140);
  });
});
