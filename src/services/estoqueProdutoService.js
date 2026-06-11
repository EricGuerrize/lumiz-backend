/**
 * Inventário real Lumiz — produtos físicos, lotes e movimentos.
 * Responsável por cadastro inicial via WhatsApp, consultas e movimentações sem
 * depender do modelo legado de estoque acoplado a procedimentos.
 */
const supabase = require('../db/supabase');

const DEFAULT_UNIT = 'unidade';

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function parseNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;
  const cleaned = raw
    .replace(/R\$/gi, '')
    .replace(/[^\d,.-]/g, '')
    .trim();
  if (!cleaned) return null;

  let normalized = cleaned;
  const hasComma = normalized.includes(',');
  const hasDot = normalized.includes('.');
  if (hasComma && hasDot) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    normalized = normalized.replace(',', '.');
  }
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function normalizeUnit(unit) {
  const value = normalizeText(unit);
  if (!value) return DEFAULT_UNIT;
  if (/^frasc/.test(value)) return 'frasco';
  if (/^sering/.test(value)) return 'seringa';
  if (/^caix/.test(value)) return 'caixa';
  if (/^(un|und|unid|unidade|unidades)$/.test(value)) return 'unidade';
  if (/^ampol/.test(value)) return 'ampola';
  if (/^pacot/.test(value)) return 'pacote';
  if (/^par/.test(value)) return 'par';
  if (/^ml$/.test(value)) return 'ml';
  return value;
}

function normalizeDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const iso = raw.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];
  const br = raw.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (br) {
    const dd = br[1].padStart(2, '0');
    const mm = br[2].padStart(2, '0');
    return `${br[3]}-${mm}-${dd}`;
  }
  const monthYear = raw.match(/\b(\d{1,2})\/(20\d{2})\b/);
  if (monthYear) {
    const mm = monthYear[1].padStart(2, '0');
    return `${monthYear[2]}-${mm}-01`;
  }
  return null;
}

function inferCategory(name) {
  const n = normalizeText(name);
  if (/botox|toxina|dysport|xeomin/.test(n)) return 'Toxina botulínica';
  if (/acido|ácido|hialuron|voluma|juvederm|preench/.test(n)) return 'Preenchedor';
  if (/luva|seringa|agulha|gaze|mascara|touca|descart/.test(n)) return 'Descartáveis';
  if (/fio|pdo|silhouette/.test(n)) return 'Fios';
  if (/anestes/.test(n)) return 'Anestésicos';
  return 'Insumos';
}

function parseLine(line) {
  const original = String(line || '').trim();
  if (!original) return null;
  const cleaned = original.replace(/^[-•*\d.)\s]+/, '').trim();
  if (!cleaned) return null;

  const parts = cleaned.split('|').map((p) => p.trim()).filter(Boolean);
  const base = parts[0] || cleaned;
  const full = parts.length > 1 ? parts.join(' ') : cleaned;

  const quantityMatch = full.match(/\b(\d+(?:[.,]\d+)?)\s*(frascos?|seringas?|caixas?|unidades?|unid|und|ampolas?|pacotes?|pares?|ml)\b/i);
  const quantity = quantityMatch ? parseNumber(quantityMatch[1]) : null;
  const unit = quantityMatch ? normalizeUnit(quantityMatch[2]) : DEFAULT_UNIT;

  let name = base;
  if (quantityMatch) {
    name = name.replace(quantityMatch[0], '').trim();
  }
  name = name
    .replace(/\b(validade|vence|vencimento|custo|valor|mínimo|minimo|maximo|máximo|min)\b.*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const validadeMatch = full.match(/\b(?:validade|vence|vencimento)\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/20\d{2}|\d{1,2}\/20\d{2}|20\d{2}-\d{2}-\d{2})\b/i);
  const custoMatch = full.match(/\b(?:custo|valor|unitario|unitário)\s*[:\-]?\s*(?:R\$\s*)?(\d+(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:\.\d{1,2})?)\b/i);
  const minMatch = full.match(/\b(?:minimo|mínimo|min)\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\b/i);
  const maxMatch = full.match(/\b(?:maximo|máximo|max)\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\b/i);
  const loteMatch = full.match(/\b(?:lote)\s*[:\-]?\s*([A-Za-z0-9._-]+)\b/i);

  if (!name || !quantity || quantity <= 0) return null;

  return {
    nome: name,
    categoria: inferCategory(name),
    quantidade: quantity,
    unidade: unit,
    validade: normalizeDate(validadeMatch?.[1]),
    custo_unitario: parseNumber(custoMatch?.[1]),
    estoque_minimo: parseNumber(minMatch?.[1]) || 0,
    estoque_maximo: parseNumber(maxMatch?.[1]),
    lote: loteMatch?.[1] || null,
    raw_line: original,
  };
}

class EstoqueProdutoService {
  /**
   * Extrai itens de inventário a partir de uma mensagem com uma linha por item.
   * @param {string} text
   * @returns {Array<object>}
   */
  parseInventoryText(text) {
    const lines = String(text || '')
      .split(/\n|;/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^configurar estoque|^invent[aá]rio/i.test(line));

    const parsed = lines.map(parseLine).filter(Boolean);
    if (parsed.length) return parsed;

    const single = parseLine(text);
    return single ? [single] : [];
  }

  _resolveStatus(saldo, minimo, maximo) {
    const atual = Number(saldo) || 0;
    const min = Number(minimo) || 0;
    const max = Number(maximo) || 0;
    if (max > 0 && atual > max) return 'excesso';
    if (min > 0 && atual < min * 0.5) return 'critico';
    if (min > 0 && atual < min) return 'baixo';
    return 'ok';
  }

  async hasRealInventory(userId) {
    const { count, error } = await supabase
      .from('estoque_produtos')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('ativo', true);
    if (error) throw error;
    return Number(count || 0) > 0;
  }

  async findProductByName(userId, name) {
    const termo = String(name || '').trim();
    if (!termo) return null;

    const { data: exact, error: e1 } = await supabase
      .from('estoque_produtos')
      .select('*')
      .eq('user_id', userId)
      .eq('ativo', true)
      .ilike('nome', termo)
      .limit(1)
      .maybeSingle();
    if (!e1 && exact) return exact;

    const { data: partial, error: e2 } = await supabase
      .from('estoque_produtos')
      .select('*')
      .eq('user_id', userId)
      .eq('ativo', true)
      .ilike('nome', `%${termo}%`)
      .limit(1)
      .maybeSingle();
    if (e2) throw e2;
    return partial || null;
  }

  async upsertProduct(userId, item = {}) {
    const nome = String(item.nome || item.descricao || '').trim();
    if (!nome) throw new Error('Nome do produto é obrigatório');

    const existing = await this.findProductByName(userId, nome);
    const patch = {
      user_id: userId,
      nome,
      categoria: item.categoria || inferCategory(nome),
      unidade: normalizeUnit(item.unidade),
      fornecedor_id: item.fornecedor_id || item.fornecedorId || null,
      estoque_minimo: Number(item.estoque_minimo ?? item.estoqueMinimo ?? 0) || 0,
      estoque_maximo: item.estoque_maximo ?? item.estoqueMaximo ?? null,
      custo_medio: item.custo_medio ?? item.custoMedio ?? item.custo_unitario ?? item.custoUnitario ?? null,
      ativo: true,
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      const { data, error } = await supabase
        .from('estoque_produtos')
        .update({
          ...patch,
          estoque_minimo: Math.max(Number(existing.estoque_minimo) || 0, patch.estoque_minimo || 0),
          estoque_maximo: patch.estoque_maximo ?? existing.estoque_maximo,
          custo_medio: patch.custo_medio ?? existing.custo_medio,
        })
        .eq('id', existing.id)
        .eq('user_id', userId)
        .select('*')
        .single();
      if (error) throw error;
      return data;
    }

    const { data, error } = await supabase
      .from('estoque_produtos')
      .insert(patch)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  async registrarEntrada(userId, payload = {}) {
    const quantidade = Number(payload.quantidade);
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      throw new Error('Quantidade válida é obrigatória');
    }

    let produto = payload.produtoId
      ? null
      : await this.findProductByName(userId, payload.nome || payload.produto || payload.descricao);

    if (!produto) {
      if (!payload.allowCreate) throw new Error('Produto não encontrado no inventário');
      produto = await this.upsertProduct(userId, payload);
    }

    if (payload.produtoId) {
      const { data, error } = await supabase
        .from('estoque_produtos')
        .select('*')
        .eq('id', payload.produtoId)
        .eq('user_id', userId)
        .single();
      if (error || !data) throw new Error('Produto não encontrado no inventário');
      produto = data;
    }

    const loteRecord = {
      user_id: userId,
      produto_id: produto.id,
      fornecedor_id: payload.fornecedorId || payload.fornecedor_id || produto.fornecedor_id || null,
      lote: payload.lote || null,
      validade: normalizeDate(payload.validade) || null,
      quantidade_atual: quantidade,
      custo_unitario: payload.custoUnitario ?? payload.custo_unitario ?? null,
      supplier_document_id: payload.supplierDocumentId || payload.supplier_document_id || null,
      metadata: payload.metadata || {},
      updated_at: new Date().toISOString(),
    };

    const { data: lote, error: loteError } = await supabase
      .from('estoque_lotes')
      .insert(loteRecord)
      .select('*')
      .single();
    if (loteError) throw loteError;

    const tipo = payload.tipo === 'inventario' || payload.origem === 'inventario' ? 'inventario' : 'entrada';
    const importBatchId = payload.importBatchId || payload.import_batch_id || null;
    const { error: movError } = await supabase.from('estoque_movimentos_reais').insert({
      user_id: userId,
      produto_id: produto.id,
      lote_id: lote.id,
      tipo,
      quantidade,
      custo_unitario: loteRecord.custo_unitario,
      fornecedor_id: loteRecord.fornecedor_id,
      origem: payload.origem || 'manual',
      source_phone: payload.sourcePhone || payload.source_phone || null,
      source_message_id: payload.sourceMessageId || payload.source_message_id || null,
      observacoes: payload.observacoes || payload.observacao || null,
      metadata: payload.metadata || {},
      import_batch_id: importBatchId,
      data: payload.data ? new Date(payload.data).toISOString() : new Date().toISOString(),
    });
    if (movError) throw movError;

    const status = await this.getProdutoStatus(userId, produto.nome);
    return {
      produtoId: produto.id,
      loteId: lote.id,
      nome: produto.nome,
      quantidade,
      estoqueAtual: status?.estoqueAtual ?? quantidade,
      unidade: produto.unidade || DEFAULT_UNIT,
    };
  }

  async registrarSaida(userId, payload = {}) {
    const quantidade = Number(payload.quantidade);
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      throw new Error('Quantidade válida é obrigatória');
    }

    const produto = payload.produtoId
      ? await this._getProductById(userId, payload.produtoId)
      : await this.findProductByName(userId, payload.nome || payload.produto || payload.descricao);
    if (!produto) throw new Error('Produto não encontrado no inventário');

    const { data: lotes, error } = await supabase
      .from('estoque_lotes')
      .select('*')
      .eq('user_id', userId)
      .eq('produto_id', produto.id)
      .gt('quantidade_atual', 0)
      .order('validade', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });
    if (error) throw error;

    const saldo = (lotes || []).reduce((sum, lote) => sum + (Number(lote.quantidade_atual) || 0), 0);
    if (saldo < quantidade) {
      throw new Error(`Estoque insuficiente: saldo atual ${saldo} ${produto.unidade || DEFAULT_UNIT}`);
    }

    let restante = quantidade;
    for (const lote of lotes || []) {
      if (restante <= 0) break;
      const atual = Number(lote.quantidade_atual) || 0;
      const baixa = Math.min(atual, restante);
      const novoSaldo = atual - baixa;

      const { error: updateError } = await supabase
        .from('estoque_lotes')
        .update({ quantidade_atual: novoSaldo, updated_at: new Date().toISOString() })
        .eq('id', lote.id)
        .eq('user_id', userId);
      if (updateError) throw updateError;

      const { error: movError } = await supabase.from('estoque_movimentos_reais').insert({
        user_id: userId,
        produto_id: produto.id,
        lote_id: lote.id,
        tipo: 'saida',
        quantidade: baixa,
        custo_unitario: lote.custo_unitario || null,
        fornecedor_id: lote.fornecedor_id || null,
        origem: payload.origem || 'manual',
        source_phone: payload.sourcePhone || payload.source_phone || null,
        source_message_id: payload.sourceMessageId || payload.source_message_id || null,
        observacoes: payload.observacoes || payload.observacao || null,
        metadata: payload.metadata || {},
        data: payload.data ? new Date(payload.data).toISOString() : new Date().toISOString(),
      });
      if (movError) throw movError;

      restante -= baixa;
    }

    const status = await this.getProdutoStatus(userId, produto.nome);
    return {
      produtoId: produto.id,
      nome: produto.nome,
      quantidade,
      estoqueAtual: status?.estoqueAtual ?? saldo - quantidade,
      unidade: produto.unidade || DEFAULT_UNIT,
    };
  }

  async _getProductById(userId, produtoId) {
    const { data, error } = await supabase
      .from('estoque_produtos')
      .select('*')
      .eq('id', produtoId)
      .eq('user_id', userId)
      .single();
    if (error) throw error;
    return data || null;
  }

  async configureInitialInventory(userId, items = [], options = {}) {
    const applied = [];
    const failed = [];
    for (const item of items) {
      try {
        const result = await this.registrarEntrada(userId, {
          ...item,
          allowCreate: true,
          origem: 'inventario',
          tipo: 'inventario',
          sourcePhone: options.sourcePhone || null,
          sourceMessageId: options.sourceMessageId || null,
          observacoes: options.observacoes || 'Inventário inicial via WhatsApp',
          importBatchId: options.importBatchId || null,
        });
        applied.push(result);
      } catch (error) {
        failed.push({ item, erro: error.message });
      }
    }
    return { applied, failed };
  }

  async getEstoqueStatus(userId) {
    const { data: produtos, error } = await supabase
      .from('estoque_produtos')
      .select('id, nome, categoria, unidade, estoque_minimo, estoque_maximo, custo_medio, ativo')
      .eq('user_id', userId)
      .eq('ativo', true)
      .order('nome');
    if (error) throw error;

    if (!produtos?.length) return { produtos: [], source: 'real_inventory' };

    const ids = produtos.map((p) => p.id);
    const { data: lotes, error: loteError } = await supabase
      .from('estoque_lotes')
      .select('produto_id, quantidade_atual, validade, custo_unitario')
      .eq('user_id', userId)
      .in('produto_id', ids);
    if (loteError) throw loteError;

    const lotsByProduct = new Map();
    for (const lote of lotes || []) {
      if (!lotsByProduct.has(lote.produto_id)) lotsByProduct.set(lote.produto_id, []);
      lotsByProduct.get(lote.produto_id).push(lote);
    }

    const mapped = produtos.map((produto) => {
      const produtoLotes = lotsByProduct.get(produto.id) || [];
      const estoqueAtual = produtoLotes.reduce((sum, lote) => sum + (Number(lote.quantidade_atual) || 0), 0);
      const estoqueMinimo = Number(produto.estoque_minimo) || 0;
      const estoqueMaximo = produto.estoque_maximo != null ? Number(produto.estoque_maximo) : null;
      const nextValidity = produtoLotes
        .map((l) => l.validade)
        .filter(Boolean)
        .sort()[0] || null;
      return {
        id: produto.id,
        nome: produto.nome,
        categoria: produto.categoria,
        unidade: produto.unidade || DEFAULT_UNIT,
        estoqueAtual,
        estoqueMinimo,
        estoqueMaximo,
        custoMedio: produto.custo_medio != null ? Number(produto.custo_medio) : null,
        validadeMaisProxima: nextValidity,
        diasSuprimento: null,
        status: this._resolveStatus(estoqueAtual, estoqueMinimo, estoqueMaximo),
        source: 'real_inventory',
      };
    });

    return { produtos: mapped, source: 'real_inventory' };
  }

  async getProdutoStatus(userId, termo) {
    const produto = await this.findProductByName(userId, termo);
    if (!produto) return null;
    const status = await this.getEstoqueStatus(userId);
    return status.produtos.find((p) => p.id === produto.id) || null;
  }

  /**
   * Item 28 — conferência/inventário assistido. Calcula o delta entre o saldo
   * informado (contagem física) e o saldo do sistema. Com `apply=false` apenas
   * prevê (sem tocar no banco); com `apply=true` aplica o ajuste como movimento
   * de inventário (entrada se faltou, saída se sobrou).
   *
   * @param {string} userId
   * @param {{nome: string, saldoReal: number, sourcePhone?: string}} input
   * @param {{apply?: boolean}} [options]
   * @returns {Promise<{nome: string, encontrado: boolean, anterior: number|null, novo: number, delta: number, changed: boolean}>}
   */
  async conferirSaldo(userId, input = {}, options = {}) {
    const { nome, sourcePhone } = input;
    const saldoReal = Number(input.saldoReal);
    if (!nome || !Number.isFinite(saldoReal) || saldoReal < 0) {
      throw new Error('Nome e saldo real válidos são obrigatórios');
    }
    const apply = options.apply === true;

    const status = await this.getProdutoStatus(userId, nome);
    if (!status) {
      // Produto ainda não existe no inventário: a contagem física vira entrada inicial.
      if (apply && saldoReal > 0) {
        await this.registrarEntrada(userId, {
          nome,
          quantidade: saldoReal,
          allowCreate: true,
          origem: 'inventario',
          tipo: 'inventario',
          sourcePhone,
          observacoes: 'Inventário assistido — cadastro por contagem física',
        });
      }
      return { nome, encontrado: false, anterior: null, novo: saldoReal, delta: saldoReal, changed: apply && saldoReal > 0 };
    }

    const anterior = Number(status.estoqueAtual) || 0;
    const delta = Math.round((saldoReal - anterior) * 100) / 100;

    if (delta !== 0 && apply) {
      if (delta > 0) {
        await this.registrarEntrada(userId, {
          produtoId: status.id,
          quantidade: delta,
          origem: 'inventario',
          tipo: 'inventario',
          sourcePhone,
          observacoes: 'Inventário assistido — ajuste de contagem',
        });
      } else {
        await this.registrarSaida(userId, {
          produtoId: status.id,
          quantidade: Math.abs(delta),
          origem: 'inventario',
          sourcePhone,
          observacoes: 'Inventário assistido — ajuste de contagem',
        });
      }
    }

    return { nome: status.nome, encontrado: true, anterior, novo: saldoReal, delta, changed: delta !== 0 && apply };
  }
}

module.exports = new EstoqueProdutoService();
module.exports._helpers = {
  parseNumber,
  normalizeDate,
  normalizeUnit,
  parseLine,
  inferCategory,
};
