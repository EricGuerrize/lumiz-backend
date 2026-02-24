describe('ConversationRuntimeStateService', () => {
  let service;
  let context;

  function buildSupabaseMock(ctx) {
    return {
      from: jest.fn((table) => {
        const state = {
          table,
          op: null,
          filters: []
        };

        const builder = {
          select: jest.fn(() => {
            state.op = 'select';
            return builder;
          }),
          delete: jest.fn(() => {
            state.op = 'delete';
            return builder;
          }),
          upsert: jest.fn(async (record, opts) => {
            ctx.upsertCalls.push({ table, record, opts });
            return ctx.upsertResult || { error: null };
          }),
          eq: jest.fn((col, value) => {
            state.filters.push({ type: 'eq', col, value });
            return builder;
          }),
          gt: jest.fn((col, value) => {
            state.filters.push({ type: 'gt', col, value });
            return builder;
          }),
          lte: jest.fn((col, value) => {
            state.filters.push({ type: 'lte', col, value });
            return builder;
          }),
          maybeSingle: jest.fn(async () => {
            if (typeof ctx.maybeSingleFactory === 'function') {
              return ctx.maybeSingleFactory(state);
            }
            return ctx.maybeSingleResult || { data: null, error: null };
          }),
          then: (resolve, reject) => {
            let result;
            if (state.op === 'select') {
              if (typeof ctx.selectFactory === 'function') {
                result = ctx.selectFactory(state);
              } else {
                result = ctx.selectResult || { data: [], error: null };
              }
            } else if (state.op === 'delete') {
              if (typeof ctx.deleteFactory === 'function') {
                result = ctx.deleteFactory(state);
              } else {
                result = ctx.deleteResult || { error: null };
              }
            } else {
              result = { data: null, error: null };
            }
            return Promise.resolve(result).then(resolve, reject);
          }
        };

        return builder;
      })
    };
  }

  beforeEach(() => {
    jest.resetModules();

    context = {
      upsertCalls: [],
      upsertResult: { error: null },
      maybeSingleResult: { data: null, error: null },
      selectResult: { data: [], error: null },
      deleteResult: { error: null }
    };

    jest.doMock('../../src/utils/phone', () => ({
      normalizePhone: jest.fn((phone) => String(phone || '').replace(/\D/g, ''))
    }));

    jest.doMock('../../src/db/supabase', () => buildSupabaseMock(context));

    service = require('../../src/services/conversationRuntimeStateService');
  });

  test('upsert persiste com phone normalizado e ttl', async () => {
    const ok = await service.upsert('(55) 11 99999-9999', 'tx_confirm', { foo: 'bar' }, 60000);

    expect(ok).toBe(true);
    expect(context.upsertCalls).toHaveLength(1);
    const call = context.upsertCalls[0];
    expect(call.table).toBe('conversation_runtime_states');
    expect(call.record.phone).toBe('5511999999999');
    expect(call.record.flow).toBe('tx_confirm');
    expect(call.record.payload).toEqual({ foo: 'bar' });
    expect(call.opts).toEqual({ onConflict: 'phone,flow' });
    expect(call.record.expires_at).toBeTruthy();
  });

  test('get retorna estado ativo', async () => {
    context.maybeSingleResult = {
      data: {
        phone: '5511999999999',
        flow: 'awaiting_data',
        payload: { stage: 'awaiting_value' },
        expires_at: new Date(Date.now() + 60000).toISOString()
      },
      error: null
    };

    const result = await service.get('5511999999999', 'awaiting_data');

    expect(result).toEqual(expect.objectContaining({
      flow: 'awaiting_data',
      payload: { stage: 'awaiting_value' }
    }));
  });

  test('get remove estado expirado e retorna null', async () => {
    context.maybeSingleResult = {
      data: {
        phone: '5511999999999',
        flow: 'awaiting_data',
        payload: { stage: 'awaiting_value' },
        expires_at: new Date(Date.now() - 60000).toISOString()
      },
      error: null
    };

    const clearSpy = jest.spyOn(service, 'clear').mockResolvedValue(true);
    const result = await service.get('5511999999999', 'awaiting_data');

    expect(result).toBeNull();
    expect(clearSpy).toHaveBeenCalledWith('5511999999999', 'awaiting_data');
  });

  test('getAllActive retorna somente ativos e faz cleanup best-effort', async () => {
    context.selectResult = {
      data: [
        {
          phone: '5511999999999',
          flow: 'tx_confirm',
          payload: { stage: 'confirm' },
          expires_at: new Date(Date.now() + 60000).toISOString()
        }
      ],
      error: null
    };

    const result = await service.getAllActive('5511999999999');

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].flow).toBe('tx_confirm');
  });

  test('clear e clearAll retornam true quando delete funciona', async () => {
    await expect(service.clear('5511999999999', 'tx_confirm')).resolves.toBe(true);
    await expect(service.clearAll('5511999999999')).resolves.toBe(true);
  });
});
