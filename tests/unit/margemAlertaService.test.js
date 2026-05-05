let margemAlertaService;
let supabase;
let evolutionService;
let reminderSentHelper;

function chainResolve(final) {
  const c = {};
  ['select', 'eq', 'gte', 'lte', 'not'].forEach((m) => {
    c[m] = jest.fn(() => c);
  });
  const p = Promise.resolve(final);
  c.then = p.then.bind(p);
  return c;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-05-12T12:00:00.000Z'));
  jest.resetModules();
  jest.mock('../../src/db/supabase');
  jest.mock('../../src/services/evolutionService');
  jest.mock('../../src/services/reminderSentHelper');
  supabase = require('../../src/db/supabase');
  evolutionService = require('../../src/services/evolutionService');
  reminderSentHelper = require('../../src/services/reminderSentHelper');
  margemAlertaService = require('../../src/services/margemAlertaService');
});

afterEach(() => {
  jest.useRealTimers();
});

describe('margemAlertaService.getMargemComparativa', () => {
  it('retorna alerta ativo quando margem cai mais de 5 p.p.', async () => {
    let calls = 0;
    supabase.from = jest.fn((table) => {
      if (table !== 'atendimentos') return chainResolve({ data: [], error: null });
      calls += 1;
      if (calls === 1) {
        return chainResolve({
          data: [
            { id: 'a1', valor_total: 1000, custo_total: 850 },
            { id: 'a2', valor_total: 1000, custo_total: 850 },
          ],
          error: null,
        });
      }
      return chainResolve({
        data: [
          { id: 'b1', valor_total: 1000, custo_total: 600 },
          { id: 'b2', valor_total: 1000, custo_total: 600 },
        ],
        error: null,
      });
    });

    const out = await margemAlertaService.getMargemComparativa('u1');
    expect(out.alerta_ativo).toBe(true);
    expect(out.delta_margem_pct).toBeLessThan(-5);
  });
});

describe('margemAlertaService.checkAndAlertMargemCaindo', () => {
  it('envia WhatsApp e marca dedupe quando queda ativa', async () => {
    let atendCalls = 0;
    supabase.from = jest.fn((table) => {
      if (table === 'profiles') {
        return chainResolve({
          data: [{ id: 'u1', telefone: '5511999999999', is_active: true }],
          error: null,
        });
      }
      if (table === 'atendimentos') {
        atendCalls += 1;
        if (atendCalls === 1) {
          return chainResolve({
            data: [{ id: 'a1', valor_total: 1000, custo_total: 900 }],
            error: null,
          });
        }
        return chainResolve({
          data: [{ id: 'a2', valor_total: 1000, custo_total: 600 }],
          error: null,
        });
      }
      return chainResolve({ data: [], error: null });
    });

    reminderSentHelper.alreadySent.mockResolvedValue(false);
    reminderSentHelper.markSent.mockResolvedValue(true);
    evolutionService.sendMessage = jest.fn().mockResolvedValue(true);

    const sent = await margemAlertaService.checkAndAlertMargemCaindo();
    expect(sent).toHaveLength(1);
    expect(evolutionService.sendMessage).toHaveBeenCalledTimes(1);
    expect(reminderSentHelper.markSent).toHaveBeenCalled();
  });
});
