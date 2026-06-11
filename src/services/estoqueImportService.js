/**
 * Onda estoque — importação de inventário inicial via CSV/XLSX.
 * Preview salva parsing em `estoque_import_batches`; confirmação materializa
 * produtos/lotes/movimentos via `estoqueProdutoService.configureInitialInventory`.
 */
const XLSX = require('xlsx');
const { randomUUID } = require('crypto');
const supabase = require('../db/supabase');
const estoqueProdutoService = require('./estoqueProdutoService');

const MAX_IMPORT_ROWS = Number.parseInt(process.env.ESTOQUE_IMPORT_MAX_ROWS || process.env.EXCEL_IMPORT_MAX_ROWS || '5000', 10);

const SPREADSHEET_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
  'application/octet-stream',
]);

const HEADER_ALIASES = {
  nome: ['nome', 'produto', 'item', 'descricao', 'descrição', 'insumo', 'material'],
  quantidade: ['quantidade', 'qtd', 'qtde', 'qty', 'saldo', 'estoque'],
  unidade: ['unidade', 'und', 'unid', 'medida'],
  categoria: ['categoria', 'tipo', 'grupo', 'familia', 'família'],
  validade: ['validade', 'vencimento', 'vence', 'data validade'],
  custo: ['custo', 'custo unitario', 'custo unitário', 'valor unitario', 'valor unitário', 'preco', 'preço', 'valor'],
  minimo: ['minimo', 'mínimo', 'estoque minimo', 'estoque mínimo', 'min'],
  maximo: ['maximo', 'máximo', 'estoque maximo', 'estoque máximo', 'max'],
  lote: ['lote', 'lote numero', 'lote número', 'batch'],
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
      normalizedAliases.some((alias) => alias.length >= 3 && header.normalized.includes(alias))
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

function parseQuantity(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = parseMoney(value);
  return parsed;
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

  const monthYear = text.match(/^(\d{1,2})[/-](\d{4})$/);
  if (monthYear) {
    return `${monthYear[2]}-${monthYear[1].padStart(2, '0')}-01`;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function isSpreadsheetFile(mimeType, fileName) {
  const ext = String(fileName || '').toLowerCase();
  if (/\.(xlsx|xls|csv)$/i.test(ext)) return true;
  return SPREADSHEET_MIME_TYPES.has(String(mimeType || '').toLowerCase());
}

class EstoqueImportService {
  /**
   * @param {string} userId
   * @param {Buffer} buffer
   * @param {{ filename?: string }} [options]
   * @returns {Promise<{ import_token: string, preview: object[], inconsistencias: object[], mapping: object, summary: object }>}
   */
  async previewFromBuffer(userId, buffer, options = {}) {
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
      .from('estoque_import_batches')
      .insert([payload]);
    if (error) throw error;

    return {
      import_token: batchId,
      preview,
      inconsistencias: parsed.inconsistencias,
      mapping: parsed.mapping,
      summary,
      filename: options.filename || null,
    };
  }

  /**
   * @param {string} userId
   * @param {string} importToken
   * @param {{ sourcePhone?: string, observacoes?: string }} [options]
   * @returns {Promise<{ ok: boolean, batch_id: string, applied: object[], failed: object[], summary: object }>}
   */
  async confirmImport(userId, importToken, options = {}) {
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
    const result = await estoqueProdutoService.configureInitialInventory(userId, rows, {
      sourcePhone: options.sourcePhone || null,
      observacoes: options.observacoes || 'Inventário importado via planilha',
      importBatchId: batch.id,
    });

    const summary = {
      ...(batch.summary || {}),
      applied_count: result.applied?.length || 0,
      failed_count: result.failed?.length || 0,
    };

    const { error } = await supabase
      .from('estoque_import_batches')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        summary,
      })
      .eq('id', batch.id)
      .eq('user_id', userId);
    if (error) throw error;

    return {
      ok: true,
      batch_id: batch.id,
      applied: result.applied || [],
      failed: result.failed || [],
      summary,
    };
  }

  /**
   * @param {string} userId
   * @param {string} batchId
   * @returns {Promise<{ ok: boolean, batch_id: string }>}
   */
  async undoImport(userId, batchId) {
    const batch = await this._getBatchForUser(userId, batchId);
    if (!batch) {
      const err = new Error('Importação não encontrada');
      err.code = 'IMPORT_NOT_FOUND';
      throw err;
    }

    const { data: movimentos, error: movSelectError } = await supabase
      .from('estoque_movimentos_reais')
      .select('id, lote_id, produto_id, quantidade, tipo')
      .eq('user_id', userId)
      .eq('import_batch_id', batchId);
    if (movSelectError) throw movSelectError;

    const loteIds = [...new Set((movimentos || []).map((m) => m.lote_id).filter(Boolean))];

    for (const mov of movimentos || []) {
      if (mov.lote_id && (mov.tipo === 'entrada' || mov.tipo === 'inventario')) {
        const { data: lote } = await supabase
          .from('estoque_lotes')
          .select('quantidade_atual')
          .eq('id', mov.lote_id)
          .eq('user_id', userId)
          .maybeSingle();

        if (lote) {
          const novoSaldo = Math.max(0, (Number(lote.quantidade_atual) || 0) - (Number(mov.quantidade) || 0));
          await supabase
            .from('estoque_lotes')
            .update({ quantidade_atual: novoSaldo, updated_at: new Date().toISOString() })
            .eq('id', mov.lote_id)
            .eq('user_id', userId);
        }
      }
    }

    const { error: movDeleteError } = await supabase
      .from('estoque_movimentos_reais')
      .delete()
      .eq('user_id', userId)
      .eq('import_batch_id', batchId);
    if (movDeleteError) throw movDeleteError;

    if (loteIds.length) {
      await supabase
        .from('estoque_lotes')
        .delete()
        .eq('user_id', userId)
        .in('id', loteIds)
        .eq('quantidade_atual', 0);
    }

    const { error: batchError } = await supabase
      .from('estoque_import_batches')
      .update({
        status: 'undone',
        undone_at: new Date().toISOString(),
      })
      .eq('id', batchId)
      .eq('user_id', userId);
    if (batchError) throw batchError;

    return { ok: true, batch_id: batchId };
  }

  /**
   * @param {string} userId
   * @param {number} [limit]
   * @returns {Promise<object[]>}
   */
  async getImportHistory(userId, limit = 20) {
    const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 100);
    const { data, error } = await supabase
      .from('estoque_import_batches')
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
    const nome = normalizeText(mapping.nome ? rawRow[mapping.nome] : '');
    const quantidade = parseQuantity(mapping.quantidade ? rawRow[mapping.quantidade] : null);
    const errors = [];

    if (!nome) errors.push('nome_invalido');
    if (!Number.isFinite(quantidade) || quantidade <= 0) errors.push('quantidade_invalida');

    const row = {
      sheet: meta.sheetName,
      row_number: meta.rowNumber,
      nome,
      quantidade,
      unidade: normalizeText(mapping.unidade ? rawRow[mapping.unidade] : '', undefined),
      categoria: normalizeText(mapping.categoria ? rawRow[mapping.categoria] : '', undefined),
      validade: parseDate(mapping.validade ? rawRow[mapping.validade] : null),
      custo_unitario: mapping.custo ? parseMoney(rawRow[mapping.custo]) : null,
      estoque_minimo: mapping.minimo ? parseQuantity(rawRow[mapping.minimo]) : null,
      estoque_maximo: mapping.maximo ? parseQuantity(rawRow[mapping.maximo]) : null,
      lote: normalizeText(mapping.lote ? rawRow[mapping.lote] : '', undefined) || null,
    };

    return { row, errors };
  }

  _buildImportSummary(parsed) {
    const sumQty = Number(parsed.validRows.reduce((acc, row) => acc + Number(row.quantidade || 0), 0).toFixed(4));
    const categorias = new Set(parsed.validRows.map((row) => row.categoria).filter(Boolean));
    return {
      total_rows: parsed.totalRows,
      valid_rows: parsed.validRows.length,
      invalid_rows: parsed.inconsistencias.length,
      total_quantidade: sumQty,
      categorias_count: categorias.size,
    };
  }

  async _getBatchForUser(userId, batchId) {
    const { data, error } = await supabase
      .from('estoque_import_batches')
      .select('*')
      .eq('id', batchId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }
}

const service = new EstoqueImportService();
service.isSpreadsheetFile = isSpreadsheetFile;

module.exports = service;
