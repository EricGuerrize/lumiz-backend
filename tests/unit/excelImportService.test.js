const XLSX = require('xlsx');

function buildWorkbook(rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Movimentacoes');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

describe('Fase 12 — excelService importador', () => {
  let excelService;
  let mockSupabase;
  let tables;

  beforeEach(() => {
    jest.resetModules();
    tables = {
      excel_import_batches: [],
      clientes: [],
      procedimentos: [],
      atendimentos: [],
      atendimento_procedimentos: [],
      contas_pagar: [],
    };

    mockSupabase = {
      from: jest.fn((table) => chainFor(table)),
    };

    jest.doMock('../../src/db/supabase', () => mockSupabase);
    jest.doMock('../../src/controllers/transactionController', () => ({
      getMonthlyReport: jest.fn(),
    }));

    excelService = require('../../src/services/excelService');
  });

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function chainFor(table) {
    const state = { table, op: null, rows: null, filters: [], single: false, maybeSingle: false };
    const chain = {
      insert(rows) {
        state.op = 'insert';
        state.rows = Array.isArray(rows) ? rows : [rows];
        return chain;
      },
      update(values) {
        state.op = 'update';
        state.rows = values;
        return chain;
      },
      delete() {
        state.op = 'delete';
        return chain;
      },
      select() {
        if (!state.op) state.op = 'select';
        return chain;
      },
      eq(column, value) {
        state.filters.push({ column, value });
        return chain;
      },
      order() {
        return chain;
      },
      limit() {
        return chain;
      },
      single() {
        state.single = true;
        return chain;
      },
      maybeSingle() {
        state.maybeSingle = true;
        return chain;
      },
      then(resolve) {
        return Promise.resolve(resolve(execState(state)));
      },
    };
    return chain;
  }

  function applyFilters(rows, filters) {
    return rows.filter((row) => filters.every((f) => row[f.column] === f.value));
  }

  function execState(state) {
    if (state.op === 'insert') {
      const inserted = state.rows.map((row, idx) => ({
        id: row.id || `${state.table}-${tables[state.table].length + idx + 1}`,
        ...row,
      }));
      tables[state.table].push(...inserted);
      return { data: state.single ? inserted[0] : inserted, error: null };
    }

    if (state.op === 'update') {
      const matched = applyFilters(tables[state.table], state.filters);
      matched.forEach((row) => Object.assign(row, state.rows));
      return { data: state.single ? matched[0] : matched, error: null };
    }

    if (state.op === 'delete') {
      const before = tables[state.table].length;
      tables[state.table] = tables[state.table].filter(
        (row) => !state.filters.every((f) => row[f.column] === f.value)
      );
      return { data: [{ deleted: before - tables[state.table].length }], error: null };
    }

    const rows = applyFilters(tables[state.table], state.filters);
    if (state.single) return { data: rows[0] || null, error: rows[0] ? null : { code: 'PGRST116' } };
    if (state.maybeSingle) return { data: rows[0] || null, error: null };
    return { data: rows, error: null, count: rows.length };
  }

  it('preview detecta receitas/despesas, normaliza valores BRL e retorna inconsistências', async () => {
    const buffer = buildWorkbook([
      { Tipo: 'Receita', Data: '07/05/2026', Valor: 'R$ 1.500,50', Cliente: 'Maria', Procedimento: 'Botox', Pagamento: 'PIX' },
      { Tipo: 'Despesa', Data: '08/05/2026', Valor: '2300', Categoria: 'Fornecedor', Descrição: 'Boleto insumo' },
      { Tipo: 'Receita', Data: 'sem data', Valor: 'abc', Cliente: 'Invalido' },
    ]);

    const result = await excelService.importFromExcel('user-1', buffer, { filename: 'controle.xlsx' });

    expect(result.import_token).toBeTruthy();
    expect(result.summary).toMatchObject({
      total_rows: 3,
      valid_rows: 2,
      invalid_rows: 1,
      receitas_count: 1,
      despesas_count: 1,
      receitas_total: 1500.5,
      despesas_total: 2300,
    });
    expect(result.preview).toHaveLength(2);
    expect(result.preview[0]).toMatchObject({
      tipo: 'entrada',
      data: '2026-05-07',
      valor: 1500.5,
      cliente: 'Maria',
      procedimento: 'Botox',
      forma_pagamento: 'pix',
    });
    expect(result.inconsistencias[0].errors).toContain('data_invalida');
  });

  it('confirm salva entradas e saídas com import_batch_id e desfaz o batch inteiro', async () => {
    const preview = await excelService.importFromExcel(
      'user-1',
      buildWorkbook([
        { Tipo: 'Receita', Data: '07/05/2026', Valor: '1500', Cliente: 'Maria', Procedimento: 'Botox' },
        { Tipo: 'Despesa', Data: '08/05/2026', Valor: '300', Categoria: 'Material', Descrição: 'Agulhas' },
      ]),
      { filename: 'controle.xlsx' }
    );

    const confirmed = await excelService.confirmImport('user-1', preview.import_token);

    expect(confirmed.summary).toMatchObject({
      inserted_atendimentos: 1,
      inserted_contas_pagar: 1,
    });
    expect(tables.atendimentos[0].import_batch_id).toBe(preview.import_token);
    expect(tables.contas_pagar[0].import_batch_id).toBe(preview.import_token);
    expect(tables.atendimento_procedimentos).toHaveLength(1);

    const undone = await excelService.undoImport('user-1', preview.import_token);
    expect(undone).toMatchObject({ ok: true, batch_id: preview.import_token });
    expect(tables.atendimentos).toHaveLength(0);
    expect(tables.contas_pagar).toHaveLength(0);
  });

  it('history lista batches do usuário com resumo e status', async () => {
    const preview = await excelService.importFromExcel(
      'user-1',
      buildWorkbook([{ Tipo: 'Despesa', Data: '08/05/2026', Valor: '300', Categoria: 'Material' }]),
      { filename: 'hist.xlsx' }
    );

    await excelService.confirmImport('user-1', preview.import_token);
    const history = await excelService.getImportHistory('user-1');

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      id: preview.import_token,
      filename: 'hist.xlsx',
      status: 'confirmed',
    });
  });
});
