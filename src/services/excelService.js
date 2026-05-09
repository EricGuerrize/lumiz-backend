const XLSX = require('xlsx');
const { randomUUID } = require('crypto');
const supabase = require('../db/supabase');
const transactionController = require('../controllers/transactionController');

const MAX_IMPORT_ROWS = Number.parseInt(process.env.EXCEL_IMPORT_MAX_ROWS || '5000', 10);

const HEADER_ALIASES = {
  tipo: ['tipo', 'movimento', 'natureza', 'entrada saida', 'receita despesa'],
  data: ['data', 'dt', 'data pagamento', 'data vencimento', 'vencimento', 'competencia'],
  valor: ['valor', 'valor total', 'total', 'preco', 'preco pago', 'valor pago'],
  receita: ['receita', 'entrada', 'venda', 'faturamento', 'valor receita'],
  despesa: ['despesa', 'saida', 'custo', 'conta a pagar', 'valor despesa'],
  cliente: ['cliente', 'paciente', 'nome cliente', 'nome paciente'],
  procedimento: ['procedimento', 'servico', 'tratamento', 'categoria receita'],
  categoria: ['categoria', 'categoria despesa', 'tipo despesa', 'centro custo'],
  descricao: ['descricao', 'descrição', 'observacao', 'observação', 'historico', 'histórico'],
  forma_pagamento: ['forma pagamento', 'pagamento', 'meio pagamento', 'metodo pagamento'],
  fornecedor: ['fornecedor', 'prestador'],
};

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function mapHeaders(headers) {
  const normalizedHeaders = headers.map((header) => ({
    original: header,
    normalized: normalizeKey(header),
  }));

  const mapping = {};
  Object.entries(HEADER_ALIASES).forEach(([field, aliases]) => {
    const normalizedAliases = aliases.map(normalizeKey);
    const exact = normalizedHeaders.find((header) => normalizedAliases.includes(header.normalized));
    const partial = normalizedHeaders.find((header) =>
      normalizedAliases.some((alias) => alias.length >= 4 && header.normalized.includes(alias))
    );
    if (exact || partial) mapping[field] = (exact || partial).original;
  });
  return mapping;
}

function parseMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toFixed(2)) : null;

  let text = String(value)
    .replace(/\s/g, '')
    .replace(/R\$/gi, '')
    .replace(/[^\d,.-]/g, '');

  if (!text) return null;

  const hasComma = text.includes(',');
  const hasDot = text.includes('.');
  if (hasComma && hasDot) {
    const lastComma = text.lastIndexOf(',');
    const lastDot = text.lastIndexOf('.');
    text = lastComma > lastDot
      ? text.replace(/\./g, '').replace(',', '.')
      : text.replace(/,/g, '');
  } else if (hasComma) {
    text = text.replace(',', '.');
  }

  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
}

function parseDate(value) {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }

  const text = String(value).trim();
  const br = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (br) {
    const year = br[3].length === 2 ? `20${br[3]}` : br[3];
    const iso = `${year}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
    const date = new Date(`${iso}T12:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : iso;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function normalizeFormaPagamento(value) {
  const text = normalizeKey(value);
  if (!text) return 'avista';
  if (text.includes('pix')) return 'pix';
  if (text.includes('debito')) return 'debito';
  if (text.includes('credito') && !text.includes('parcel')) return 'credito_avista';
  if (text.includes('parcel')) return 'parcelado';
  if (text.includes('dinheiro')) return 'dinheiro';
  if (text.includes('misto')) return 'misto';
  return 'avista';
}

function detectTipo(rawTipo, valor) {
  const tipo = normalizeKey(rawTipo);
  if (tipo.includes('receita') || tipo.includes('entrada') || tipo.includes('venda')) return 'entrada';
  if (tipo.includes('despesa') || tipo.includes('saida') || tipo.includes('custo') || tipo.includes('pagar')) return 'saida';
  if (Number(valor) < 0) return 'saida';
  return 'entrada';
}

class ExcelService {
  async importFromExcel(userId, buffer, options = {}) {
    const parsed = this._parseImportWorkbook(buffer);
    const batchId = randomUUID();
    const preview = parsed.validRows.slice(0, 10);
    const summary = this._buildImportSummary(parsed);

    const payload = {
      id: batchId,
      user_id: userId,
      status: 'preview',
      filename: options.filename || null,
      mapping: parsed.mapping,
      rows: parsed.validRows,
      preview,
      inconsistencias: parsed.inconsistencias,
      summary,
      original_row_count: parsed.totalRows,
      valid_row_count: parsed.validRows.length,
      invalid_row_count: parsed.inconsistencias.length,
    };

    const { error } = await supabase
      .from('excel_import_batches')
      .insert([payload]);
    if (error) throw error;

    return {
      import_token: batchId,
      preview,
      inconsistencias: parsed.inconsistencias,
      mapping: parsed.mapping,
      summary,
    };
  }

  async confirmImport(userId, importToken) {
    const batch = await this._getBatchForUser(userId, importToken);
    if (!batch) {
      const err = new Error('Importação não encontrada');
      err.code = 'IMPORT_NOT_FOUND';
      throw err;
    }
    if (batch.status !== 'preview') {
      const err = new Error('Importação já confirmada ou desfeita');
      err.code = 'IMPORT_NOT_PREVIEW';
      throw err;
    }

    const rows = Array.isArray(batch.rows) ? batch.rows : [];
    const inserted = {
      inserted_atendimentos: 0,
      inserted_contas_pagar: 0,
      skipped_rows: 0,
    };

    for (const row of rows) {
      if (row.tipo === 'entrada') {
        await this._insertImportedAtendimento(userId, batch.id, row);
        inserted.inserted_atendimentos += 1;
      } else if (row.tipo === 'saida') {
        await this._insertImportedContaPagar(userId, batch.id, row);
        inserted.inserted_contas_pagar += 1;
      } else {
        inserted.skipped_rows += 1;
      }
    }

    const summary = { ...(batch.summary || {}), ...inserted };
    const { error } = await supabase
      .from('excel_import_batches')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        summary,
      })
      .eq('id', batch.id)
      .eq('user_id', userId);
    if (error) throw error;

    return { ok: true, batch_id: batch.id, summary };
  }

  async undoImport(userId, batchId) {
    const batch = await this._getBatchForUser(userId, batchId);
    if (!batch) {
      const err = new Error('Importação não encontrada');
      err.code = 'IMPORT_NOT_FOUND';
      throw err;
    }

    const { error: atendError } = await supabase
      .from('atendimentos')
      .delete()
      .eq('user_id', userId)
      .eq('import_batch_id', batchId);
    if (atendError) throw atendError;

    const { error: contasError } = await supabase
      .from('contas_pagar')
      .delete()
      .eq('user_id', userId)
      .eq('import_batch_id', batchId);
    if (contasError) throw contasError;

    const { error: batchError } = await supabase
      .from('excel_import_batches')
      .update({
        status: 'undone',
        undone_at: new Date().toISOString(),
      })
      .eq('id', batchId)
      .eq('user_id', userId);
    if (batchError) throw batchError;

    return { ok: true, batch_id: batchId };
  }

  async getImportHistory(userId, limit = 20) {
    const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 100);
    const { data, error } = await supabase
      .from('excel_import_batches')
      .select('id, filename, status, summary, original_row_count, valid_row_count, invalid_row_count, confirmed_at, undone_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(safeLimit);
    if (error) throw error;
    return data || [];
  }

  _parseImportWorkbook(buffer) {
    const workbook = XLSX.read(buffer, {
      type: 'buffer',
      cellDates: true,
      cellFormula: false,
      cellNF: false,
      cellStyles: false,
      WTF: false,
    });

    const validRows = [];
    const inconsistencias = [];
    let mapping = {};
    let totalRows = 0;

    workbook.SheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
      if (!rows.length) return;

      const headers = Object.keys(rows[0]);
      const sheetMapping = mapHeaders(headers);
      mapping = { ...mapping, [sheetName]: sheetMapping };

      rows.slice(0, MAX_IMPORT_ROWS - totalRows).forEach((rawRow, index) => {
        totalRows += 1;
        const normalized = this._normalizeImportRow(rawRow, sheetMapping, {
          sheetName,
          rowNumber: index + 2,
        });

        if (normalized.errors.length) {
          inconsistencias.push({
            sheet: sheetName,
            row_number: index + 2,
            raw: rawRow,
            errors: normalized.errors,
          });
          return;
        }

        validRows.push(normalized.row);
      });
    });

    return { validRows, inconsistencias, mapping, totalRows };
  }

  _normalizeImportRow(rawRow, mapping, meta) {
    const revenueValue = mapping.receita ? parseMoney(rawRow[mapping.receita]) : null;
    const expenseValue = mapping.despesa ? parseMoney(rawRow[mapping.despesa]) : null;
    const baseValue = parseMoney(mapping.valor ? rawRow[mapping.valor] : null);
    const valor = revenueValue || expenseValue || baseValue;
    const tipo = revenueValue ? 'entrada' : expenseValue ? 'saida' : detectTipo(mapping.tipo ? rawRow[mapping.tipo] : '', valor);
    const data = parseDate(mapping.data ? rawRow[mapping.data] : null);
    const errors = [];

    if (!data) errors.push('data_invalida');
    if (!Number.isFinite(valor) || Math.abs(valor) <= 0) errors.push('valor_invalido');

    const descricao = normalizeText(mapping.descricao ? rawRow[mapping.descricao] : '', 'Importação Excel');
    const row = {
      sheet: meta.sheetName,
      row_number: meta.rowNumber,
      tipo,
      data,
      valor: valor ? Math.abs(valor) : valor,
      descricao,
      cliente: normalizeText(mapping.cliente ? rawRow[mapping.cliente] : '', 'Cliente importado'),
      procedimento: normalizeText(mapping.procedimento ? rawRow[mapping.procedimento] : '', 'Procedimento importado'),
      categoria: normalizeText(mapping.categoria ? rawRow[mapping.categoria] : '', tipo === 'saida' ? 'Importação' : 'Procedimento'),
      forma_pagamento: normalizeFormaPagamento(mapping.forma_pagamento ? rawRow[mapping.forma_pagamento] : ''),
      fornecedor: normalizeText(mapping.fornecedor ? rawRow[mapping.fornecedor] : ''),
    };

    return { row, errors };
  }

  _buildImportSummary(parsed) {
    const receitas = parsed.validRows.filter((row) => row.tipo === 'entrada');
    const despesas = parsed.validRows.filter((row) => row.tipo === 'saida');
    const sum = (rows) => Number(rows.reduce((acc, row) => acc + Number(row.valor || 0), 0).toFixed(2));
    return {
      total_rows: parsed.totalRows,
      valid_rows: parsed.validRows.length,
      invalid_rows: parsed.inconsistencias.length,
      receitas_count: receitas.length,
      despesas_count: despesas.length,
      receitas_total: sum(receitas),
      despesas_total: sum(despesas),
    };
  }

  async _getBatchForUser(userId, batchId) {
    const { data, error } = await supabase
      .from('excel_import_batches')
      .select('*')
      .eq('id', batchId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async _findOrCreateCliente(userId, nome) {
    const { data: existing, error: findError } = await supabase
      .from('clientes')
      .select('id')
      .eq('user_id', userId)
      .eq('nome', nome)
      .maybeSingle();
    if (findError) throw findError;
    if (existing) return existing;

    const { data, error } = await supabase
      .from('clientes')
      .insert([{ user_id: userId, nome }])
      .select('id')
      .single();
    if (error) throw error;
    return data;
  }

  async _findOrCreateProcedimento(userId, nome, valorSugerido = null) {
    const { data: existing, error: findError } = await supabase
      .from('procedimentos')
      .select('id')
      .eq('user_id', userId)
      .eq('nome', nome)
      .maybeSingle();
    if (findError) throw findError;
    if (existing) return existing;

    const { data, error } = await supabase
      .from('procedimentos')
      .insert([{
        user_id: userId,
        nome,
        tipo: 'outros',
        custo_material_ml: 0,
        valor_sugerido: valorSugerido,
      }])
      .select('id')
      .single();
    if (error) throw error;
    return data;
  }

  async _insertImportedAtendimento(userId, batchId, row) {
    const cliente = await this._findOrCreateCliente(userId, row.cliente);
    const procedimento = await this._findOrCreateProcedimento(userId, row.procedimento || row.categoria, row.valor);
    const { data: atendimento, error } = await supabase
      .from('atendimentos')
      .insert([{
        user_id: userId,
        cliente_id: cliente.id,
        data: row.data,
        valor_total: row.valor,
        custo_total: 0,
        forma_pagamento: row.forma_pagamento,
        status_pagamento: 'pago',
        parcelas: 1,
        observacoes: row.descricao,
        valor_bruto: row.valor,
        valor_liquido: row.valor,
        import_batch_id: batchId,
      }])
      .select('id')
      .single();
    if (error) throw error;

    const { error: procError } = await supabase
      .from('atendimento_procedimentos')
      .insert([{
        atendimento_id: atendimento.id,
        procedimento_id: procedimento.id,
        valor_cobrado: row.valor,
        custo_material: 0,
      }]);
    if (procError) throw procError;
  }

  async _insertImportedContaPagar(userId, batchId, row) {
    const { error } = await supabase
      .from('contas_pagar')
      .insert([{
        user_id: userId,
        descricao: row.descricao || row.fornecedor || row.categoria || 'Despesa importada',
        valor: row.valor,
        data: row.data,
        data_vencimento: row.data,
        tipo: 'variavel',
        categoria: row.categoria || 'Importação',
        forma_pagamento: row.forma_pagamento,
        status_pagamento: 'pago',
        observacoes: row.fornecedor ? `Fornecedor: ${row.fornecedor}` : null,
        origem: 'import',
        import_batch_id: batchId,
      }]);
    if (error) throw error;
  }

  async generateExcelReport(userId, year = null, month = null) {
    try {
      console.log('[EXCEL] Gerando relatório Excel...');
      console.log('[EXCEL] UserId:', userId);
      console.log('[EXCEL] Year:', year, 'Month:', month);

      const now = new Date();
      const reportYear = year || now.getFullYear();
      const reportMonth = month || (now.getMonth() + 1);

      // Busca relatório mensal
      const report = await transactionController.getMonthlyReport(userId, reportYear, reportMonth);

      // Busca todas as transações do período
      const { data: transactions, error } = await supabase
        .from('atendimentos')
        .select(`
          id,
          valor_total,
          data,
          observacoes,
          forma_pagamento,
          clientes(nome),
          atendimento_procedimentos(
            procedimentos(nome)
          )
        `)
        .eq('user_id', userId)
        .gte('data', `${reportYear}-${String(reportMonth).padStart(2, '0')}-01`)
        .lt('data', `${reportYear}-${String(reportMonth + 1).padStart(2, '0')}-01`)
        .order('data', { ascending: false });

      if (error) throw error;

      // Busca contas a pagar
      const { data: contas, error: contasError } = await supabase
        .from('contas_pagar')
        .select('*')
        .eq('user_id', userId)
        .gte('data', `${reportYear}-${String(reportMonth).padStart(2, '0')}-01`)
        .lt('data', `${reportYear}-${String(reportMonth + 1).padStart(2, '0')}-01`)
        .order('data', { ascending: false });

      if (contasError) throw contasError;

      // Cria workbook
      const workbook = XLSX.utils.book_new();

      // Sheet 1: Resumo
      const resumoData = [
        ['RELATÓRIO FINANCEIRO'],
        [`Período: ${reportMonth}/${reportYear}`],
        [],
        ['Item', 'Valor'],
        ['Faturamento Total', report.entradas],
        ['Custos Total', report.saidas],
        ['Lucro Líquido', report.entradas - report.saidas],
        ['Margem %', report.entradas > 0 ? (((report.entradas - report.saidas) / report.entradas) * 100).toFixed(2) : '0.00'],
        ['Total de Movimentações', report.totalTransacoes],
      ];

      const resumoSheet = XLSX.utils.aoa_to_sheet(resumoData);
      XLSX.utils.book_append_sheet(workbook, resumoSheet, 'Resumo');

      // Sheet 2: Receitas
      const receitasData = [
        ['Data', 'Cliente', 'Procedimento', 'Valor', 'Forma Pagamento', 'Observações']
      ];

      if (transactions && transactions.length > 0) {
        transactions.forEach(t => {
          const procedimento = t.atendimento_procedimentos?.[0]?.procedimentos?.nome || 'N/A';
          const cliente = t.clientes?.nome || 'N/A';
          receitasData.push([
            new Date(t.data).toLocaleDateString('pt-BR'),
            cliente,
            procedimento,
            parseFloat(t.valor_total || 0),
            t.forma_pagamento || 'N/A',
            t.observacoes || ''
          ]);
        });
      }

      const receitasSheet = XLSX.utils.aoa_to_sheet(receitasData);
      XLSX.utils.book_append_sheet(workbook, receitasSheet, 'Receitas');

      // Sheet 3: Custos
      const custosData = [
        ['Data', 'Categoria', 'Descrição', 'Valor']
      ];

      if (contas && contas.length > 0) {
        contas.forEach(c => {
          custosData.push([
            new Date(c.data).toLocaleDateString('pt-BR'),
            c.categoria || 'N/A',
            c.descricao || '',
            parseFloat(c.valor || 0)
          ]);
        });
      }

      const custosSheet = XLSX.utils.aoa_to_sheet(custosData);
      XLSX.utils.book_append_sheet(workbook, custosSheet, 'Custos');

      // Gera buffer
      const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      console.log('[EXCEL] ✅ Relatório Excel gerado com sucesso');
      console.log('[EXCEL] Tamanho:', excelBuffer.length, 'bytes');

      return excelBuffer;
    } catch (error) {
      console.error('[EXCEL] ❌ Erro ao gerar Excel:', error);
      throw error;
    }
  }

  async generateCSVReport(userId, year = null, month = null) {
    try {
      console.log('[EXCEL] Gerando relatório CSV...');

      const now = new Date();
      const reportYear = year || now.getFullYear();
      const reportMonth = month || (now.getMonth() + 1);

      // Busca todas as transações
      const { data: transactions, error } = await supabase
        .from('atendimentos')
        .select(`
          valor_total,
          data,
          observacoes,
          forma_pagamento,
          clientes(nome),
          atendimento_procedimentos(
            procedimentos(nome)
          )
        `)
        .eq('user_id', userId)
        .gte('data', `${reportYear}-${String(reportMonth).padStart(2, '0')}-01`)
        .lt('data', `${reportYear}-${String(reportMonth + 1).padStart(2, '0')}-01`)
        .order('data', { ascending: false });

      if (error) throw error;

      // Busca contas a pagar
      const { data: contas, error: contasError } = await supabase
        .from('contas_pagar')
        .select('*')
        .eq('user_id', userId)
        .gte('data', `${reportYear}-${String(reportMonth).padStart(2, '0')}-01`)
        .lt('data', `${reportYear}-${String(reportMonth + 1).padStart(2, '0')}-01`)
        .order('data', { ascending: false });

      if (contasError) throw contasError;

      // Gera CSV
      let csv = 'Tipo,Data,Cliente/Categoria,Procedimento/Descrição,Valor,Forma Pagamento\n';

      // Receitas
      if (transactions && transactions.length > 0) {
        transactions.forEach(t => {
          const procedimento = t.atendimento_procedimentos?.[0]?.procedimentos?.nome || '';
          const cliente = t.clientes?.nome || '';
          csv += `Receita,${new Date(t.data).toLocaleDateString('pt-BR')},"${cliente}","${procedimento}",${t.valor_total || 0},"${t.forma_pagamento || ''}"\n`;
        });
      }

      // Custos
      if (contas && contas.length > 0) {
        contas.forEach(c => {
          csv += `Custo,${new Date(c.data).toLocaleDateString('pt-BR')},"${c.categoria || ''}","${c.descricao || ''}",${c.valor || 0},\n`;
        });
      }

      return Buffer.from(csv, 'utf-8');
    } catch (error) {
      console.error('[EXCEL] ❌ Erro ao gerar CSV:', error);
      throw error;
    }
  }
}

module.exports = new ExcelService();

