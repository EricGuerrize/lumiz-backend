describe('TransactionController traceability hardening', () => {
  let inserts;
  let transactionController;
  let failFirstContaInsert;

  function buildSupabaseMock() {
    return {
      from: jest.fn((table) => {
        const state = { table, payload: null, op: null };
        const builder = {
          insert: jest.fn((payload) => {
            state.op = 'insert';
            state.payload = Array.isArray(payload) ? payload[0] : payload;
            return builder;
          }),
          select: jest.fn(() => builder),
          single: jest.fn(async () => {
            if (state.op === 'insert') {
              inserts.push({ table, payload: state.payload });
              if (table === 'contas_pagar' && failFirstContaInsert) {
                failFirstContaInsert = false;
                return { data: null, error: { message: 'column "source_phone" does not exist' } };
              }
              return { data: { id: `${table}-id`, ...state.payload }, error: null };
            }
            return { data: null, error: null };
          }),
          then: (resolve, reject) => {
            if (state.op === 'insert') {
              inserts.push({ table, payload: state.payload });
              return Promise.resolve({ data: [{ id: `${table}-id`, ...state.payload }], error: null }).then(resolve, reject);
            }
            return Promise.resolve({ data: [], error: null }).then(resolve, reject);
          }
        };
        return builder;
      })
    };
  }

  beforeEach(() => {
    jest.resetModules();
    inserts = [];
    failFirstContaInsert = false;

    jest.doMock('../../src/db/supabase', () => buildSupabaseMock());
    jest.doMock('../../src/controllers/userController', () => ({
      findOrCreateCliente: jest.fn().mockResolvedValue({ id: 'cliente-1', nome: 'Cliente WhatsApp' }),
      findOrCreateProcedimento: jest.fn().mockResolvedValue({ id: 'proc-1', nome: 'Botox', tipo: 'botox' })
    }));
    jest.doMock('../../src/services/mdrService', () => ({
      getLatestConfig: jest.fn().mockResolvedValue(null)
    }));
    jest.doMock('../../src/services/mdrPricingService', () => ({
      calculateSalePricing: jest.fn(() => ({
        valorBruto: 1200,
        valorLiquido: 1200,
        mdrPercentApplied: null,
        settlementModeApplied: null,
        recebimentoPrevisto: new Date().toISOString().split('T')[0],
        mdrRuleSnapshot: {},
        parcelasPlan: []
      }))
    }));
    jest.doMock('../../src/services/notificationService', () => ({
      notifyFixedCostChange: jest.fn().mockResolvedValue(true)
    }));

    transactionController = require('../../src/controllers/transactionController');
  });

  test('createAtendimento persiste metadados de origem WhatsApp', async () => {
    await transactionController.createAtendimento('user-1', {
      valor: 1200,
      categoria: 'Botox',
      descricao: 'Botox 1200 pix',
      forma_pagamento: 'pix',
      origem: 'whatsapp_text',
      source_phone: '556592997732',
      source_message_id: 'wamid-1',
      raw_message: 'Botox 1200 pix',
      is_test: false,
      metadata: { confidence_score: 0.92 }
    });

    const atendimentoInsert = inserts.find((call) => call.table === 'atendimentos');
    expect(atendimentoInsert.payload).toEqual(expect.objectContaining({
      origem: 'whatsapp_text',
      source_phone: '556592997732',
      source_message_id: 'wamid-1',
      raw_message: 'Botox 1200 pix',
      is_test: false,
      metadata: { confidence_score: 0.92 }
    }));
  });

  test('createContaPagar persiste metadados de origem WhatsApp', async () => {
    await transactionController.createContaPagar('user-1', {
      valor: 600,
      categoria: 'Luvas',
      descricao: 'Luvas 600',
      origem: 'whatsapp_text',
      source_phone: '556592997732',
      source_message_id: 'wamid-2',
      raw_message: 'Luvas 600',
      is_test: false,
      metadata: { confidence_score: 0.88 }
    });

    const contaInsert = inserts.find((call) => call.table === 'contas_pagar');
    expect(contaInsert.payload).toEqual(expect.objectContaining({
      origem: 'whatsapp_text',
      source_phone: '556592997732',
      source_message_id: 'wamid-2',
      raw_message: 'Luvas 600',
      is_test: false,
      metadata: { confidence_score: 0.88 }
    }));
  });

  test('createContaPagar remove campos novos no fallback de coluna ausente', async () => {
    failFirstContaInsert = true;

    await transactionController.createContaPagar('user-1', {
      valor: 600,
      categoria: 'Luvas',
      descricao: 'Luvas 600',
      origem: 'whatsapp_text',
      source_phone: '556592997732',
      raw_message: 'Luvas 600',
      is_test: false,
      metadata: { confidence_score: 0.88 }
    });

    const contaInserts = inserts.filter((call) => call.table === 'contas_pagar');
    expect(contaInserts).toHaveLength(2);
    expect(contaInserts[0].payload.source_phone).toBe('556592997732');
    expect(contaInserts[1].payload.source_phone).toBeUndefined();
    expect(contaInserts[1].payload.raw_message).toBeUndefined();
    expect(contaInserts[1].payload.metadata).toBeUndefined();
    expect(contaInserts[1].payload.origem).toBeUndefined();
  });
});
