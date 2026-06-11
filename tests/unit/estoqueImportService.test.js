const XLSX = require('xlsx');

function buildWorkbook(rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Estoque');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function buildCsvBuffer(csvText) {
  return Buffer.from(csvText, 'utf-8');
}

describe('estoqueImportService', () => {
  let estoqueImportService;
  let mockSupabase;
  let mockConfigureInitialInventory;
  let tables;

  beforeEach(() => {
    jest.resetModules();
    tables = {
      estoque_import_batches: [],
      estoque_movimentos_reais: [],
      estoque_lotes: [],
    };

    mockConfigureInitialInventory = jest.fn().mockResolvedValue({
      applied: [{ nome: 'Botox 100UI' }],
      failed: [],
    });

    mockSupabase = {
      from: jest.fn((table) => chainFor(table)),
    };

    jest.doMock('../../src/db/supabase', () => mockSupabase);
    jest.doMock('../../src/services/estoqueProdutoService', () => ({
      configureInitialInventory: mockConfigureInitialInventory,
    }));

    estoqueImportService = require('../../src/services/estoqueImportService');
  });

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function chainFor(table) {
    const state = { table, op: null, rows: null, filters: [], single: false, maybeSingle: false, inColumn: null, inValues: [] };
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
      in(column, values) {
        state.inColumn = column;
        state.inValues = values;
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
      tables[state.table] = tables[state.table].filter(
        (row) => !state.filters.every((f) => row[f.column] === f.value)
      );
      return { data: [], error: null };
    }

    let rows = applyFilters(tables[state.table], state.filters);
    if (state.inColumn && state.inValues?.length) {
      rows = rows.filter((row) => state.inValues.includes(row[state.inColumn]));
    }
    if (state.single) return { data: rows[0] || null, error: rows[0] ? null : { code: 'PGRST116' } };
    if (state.maybeSingle) return { data: rows[0] || null, error: null };
    return { data: rows, error: null, count: rows.length };
  }

  it('isSpreadsheetFile detecta xlsx e csv por extensão e mime', () => {
    expect(estoqueImportService.isSpreadsheetFile('application/pdf', 'nota.pdf')).toBe(false);
    expect(estoqueImportService.isSpreadsheetFile('text/csv', 'estoque.csv')).toBe(true);
    expect(estoqueImportService.isSpreadsheetFile('application/octet-stream', 'estoque.xlsx')).toBe(true);
  });

  it('previewFromBuffer parseia xlsx com headers de estoque e inconsistências', async () => {
    const buffer = buildWorkbook([
      { Produto: 'Botox 100UI', Qtd: 3, Unidade: 'frasco', Categoria: 'Toxina', Validade: '12/06/2027', Custo: 'R$ 450,00' },
      { Produto: 'Luva nitrílica', Qtd: 10, Unidade: 'caixa' },
      { Produto: '', Qtd: 2 },
    ]);

    const result = await estoqueImportService.previewFromBuffer('user-1', buffer, { filename: 'estoque.xlsx' });

    expect(result.import_token).toBeTruthy();
    expect(result.summary).toMatchObject({
      total_rows: 3,
      valid_rows: 2,
      invalid_rows: 1,
    });
    expect(result.preview[0]).toMatchObject({
      nome: 'Botox 100UI',
      quantidade: 3,
      unidade: 'frasco',
      categoria: 'Toxina',
      validade: '2027-06-12',
      custo_unitario: 450,
    });
    expect(result.inconsistencias[0].errors).toContain('nome_invalido');
    expect(tables.estoque_import_batches).toHaveLength(1);
  });

  it('previewFromBuffer parseia csv', async () => {
    const buffer = buildCsvBuffer('nome,quantidade,unidade\nSeringa 5ml,20,unidade\n');
    const result = await estoqueImportService.previewFromBuffer('user-1', buffer, { filename: 'estoque.csv' });

    expect(result.preview).toHaveLength(1);
    expect(result.preview[0]).toMatchObject({
      nome: 'Seringa 5ml',
      quantidade: 20,
      unidade: 'unidade',
    });
  });

  it('confirmImport chama configureInitialInventory com importBatchId', async () => {
    const preview = await estoqueImportService.previewFromBuffer(
      'user-1',
      buildWorkbook([{ Produto: 'Botox', Qtd: 2, Unidade: 'frasco' }]),
      { filename: 'e.xlsx' }
    );

    const confirmed = await estoqueImportService.confirmImport('user-1', preview.import_token);

    expect(mockConfigureInitialInventory).toHaveBeenCalledWith(
      'user-1',
      expect.arrayContaining([expect.objectContaining({ nome: 'Botox', quantidade: 2 })]),
      expect.objectContaining({ importBatchId: preview.import_token })
    );
    expect(confirmed).toMatchObject({ ok: true, batch_id: preview.import_token });
    expect(tables.estoque_import_batches[0].status).toBe('confirmed');
  });

  it('getImportHistory lista batches do usuário', async () => {
    const preview = await estoqueImportService.previewFromBuffer(
      'user-1',
      buildWorkbook([{ Produto: 'Botox', Qtd: 1 }]),
      { filename: 'hist.xlsx' }
    );
    await estoqueImportService.confirmImport('user-1', preview.import_token);

    const history = await estoqueImportService.getImportHistory('user-1');
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ id: preview.import_token, status: 'confirmed' });
  });
});
