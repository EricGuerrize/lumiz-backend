const crypto = require('crypto');
const supabase = require('../db/supabase');
const documentService = require('./documentService');
const openaiService = require('./openaiService');
const estoqueService = require('./estoqueService');
const { buildDocumentExtractionPromptSlim } = require('../config/prompts');

/**
 * Onda 2 — Supplier Document Service.
 *
 * Responsável por:
 *  - extract(buffer, mimeType): roda OCR/Vision + parser e devolve um shape unificado
 *    `{ tipo, fornecedor, valor_total, vencimentos, itens, confidence_score, raw_text }`.
 *  - linkOrCreateFornecedor(userId, parsed): casa por CNPJ, cai para fuzzy por nome,
 *    cria novo fornecedor se nada bate.
 *  - createContasPagarFromDocument(userId, parsed, fornecedorId, options): cria N linhas
 *    em `contas_pagar` (uma por vencimento) com `parcela_numero`/`parcela_total` e
 *    `supplier_document_id`.
 *  - applyEstoqueEntradaFromItens(userId, parsed, options): faz match fuzzy dos itens
 *    da NF com `procedimentos` e dispara `estoqueService.registrarEntrada` quando
 *    score >= STOCK_MATCH_THRESHOLD; itens não casados ficam pendentes em
 *    `parsed_json.itens_pendentes`.
 *  - persist(userId, parsed, fileHash, sourcePhone): salva snapshot em
 *    `supplier_documents` para auditoria + gancho do frontend.
 */

const STOCK_MATCH_THRESHOLD = 0.8;
const FUZZY_NAME_THRESHOLD = 0.75;

const TIPO_PARA_ORIGEM = {
  nf: 'nf_ocr',
  boleto: 'boleto_ocr',
  comprovante: 'comprovante_ocr'
};

function sanitizeCnpj(value) {
  if (!value) return null;
  const digits = String(value).replace(/\D+/g, '');
  return digits.length === 14 ? digits : null;
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Bigram Dice coefficient — fuzzy similarity 0..1.
 * Pequeno, suficiente para matching de "Botox 100u" vs "BOTOX 100 UI".
 */
function similarity(a, b) {
  const s1 = normalizeName(a);
  const s2 = normalizeName(b);
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  if (s1.length < 2 || s2.length < 2) return s1 === s2 ? 1 : 0;
  const bigrams = new Map();
  for (let i = 0; i < s1.length - 1; i += 1) {
    const bg = s1.slice(i, i + 2);
    bigrams.set(bg, (bigrams.get(bg) || 0) + 1);
  }
  let intersect = 0;
  for (let i = 0; i < s2.length - 1; i += 1) {
    const bg = s2.slice(i, i + 2);
    const count = bigrams.get(bg);
    if (count && count > 0) {
      intersect += 1;
      bigrams.set(bg, count - 1);
    }
  }
  return (2 * intersect) / (s1.length + s2.length - 2);
}

class SupplierDocumentService {
  constructor() {
    this.STOCK_MATCH_THRESHOLD = STOCK_MATCH_THRESHOLD;
    this.FUZZY_NAME_THRESHOLD = FUZZY_NAME_THRESHOLD;
  }

  /**
   * Computa hash determinístico do conteúdo binário do documento.
   */
  computeFileHash(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Roda extração no buffer do documento.
   * Estratégia: usa o `documentService.processImageFromBuffer` (Google Vision + parser
   * estruturado) e enriquece com itens/fornecedor via segundo prompt slim quando
   * o texto bruto está disponível e o doc é nf/boleto.
   *
   * @param {Buffer} buffer
   * @param {string} mimeType
   * @returns {Promise<Object>} parsed
   */
  async extract(buffer, mimeType = 'image/jpeg') {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error('Buffer de documento vazio.');
    }

    const docResult = await documentService.processImageFromBuffer(buffer, mimeType);
    return this.fromDocumentResult(docResult);
  }

  /**
   * Converte o output de `documentService.processImage*` no shape unificado.
   * Evita reprocessar OCR quando o handler já chamou documentService.
   */
  fromDocumentResult(docResult) {
    const transacoes = Array.isArray(docResult.transacoes) ? docResult.transacoes : [];
    const tipoBruto = String(docResult.tipo_documento || 'outro').toLowerCase();

    let tipo = 'outro';
    if (tipoBruto.includes('nota')) tipo = 'nf';
    else if (tipoBruto === 'boleto' || tipoBruto.includes('fatura')) tipo = 'boleto';
    else if (tipoBruto.includes('comprovante') || tipoBruto.includes('recibo')) tipo = 'comprovante';

    const valorTotal = transacoes.reduce((sum, t) => sum + Math.abs(Number(t.valor) || 0), 0)
      || Number(docResult.valor_total)
      || 0;

    const vencimentos = [];
    for (const t of transacoes) {
      if (Array.isArray(t.condicoes_pagamento) && t.condicoes_pagamento.length > 0) {
        const valorPorParcela = Math.round((Math.abs(Number(t.valor) || 0) / t.condicoes_pagamento.length) * 100) / 100;
        t.condicoes_pagamento.forEach((data, idx) => {
          vencimentos.push({
            numero: idx + 1,
            valor: valorPorParcela,
            data
          });
        });
      } else {
        vencimentos.push({
          numero: 1,
          valor: Math.abs(Number(t.valor) || 0),
          data: t.data || new Date().toISOString().split('T')[0]
        });
      }
    }

    const fornecedor = {
      nome: docResult.fornecedor || transacoes[0]?.descricao || null,
      cnpj: sanitizeCnpj(docResult.cnpj || transacoes[0]?.cnpj),
      email: docResult.fornecedor_email || null,
      whatsapp: docResult.fornecedor_whatsapp || null
    };

    const itens = Array.isArray(docResult.itens) ? docResult.itens : [];

    const docConfidence = typeof docResult.confidence_score === 'number'
      ? docResult.confidence_score
      : null;
    const minTransactionConfidence = transacoes.reduce((min, t) => {
      const s = typeof t.confidence_score === 'number' ? t.confidence_score : null;
      if (s === null) return min;
      if (min === null) return s;
      return Math.min(min, s);
    }, null);

    const confidenceCandidates = [docConfidence, minTransactionConfidence].filter((v) => v !== null);
    const confidence_score = confidenceCandidates.length
      ? Math.min(...confidenceCandidates)
      : null;

    return {
      tipo,
      tipo_documento_raw: tipoBruto,
      fornecedor,
      valor_total: Math.round(valorTotal * 100) / 100,
      vencimentos,
      itens,
      confidence_score,
      raw_text: docResult.text || null,
      transacoes
    };
  }

  /**
   * Match exato por CNPJ → match fuzzy por nome → cria novo.
   * @param {string} userId
   * @param {Object} parsed - output do extract()
   * @returns {Promise<Object>} fornecedor (id, nome, cnpj, ...)
   */
  async linkOrCreateFornecedor(userId, parsed) {
    if (!userId) throw new Error('userId obrigatório.');
    const fornecedorParsed = parsed?.fornecedor || {};
    const cnpj = sanitizeCnpj(fornecedorParsed.cnpj);
    const nome = (fornecedorParsed.nome || '').trim();

    if (!cnpj && !nome) {
      throw new Error('Documento não trouxe CNPJ nem nome do fornecedor.');
    }

    if (cnpj) {
      const { data: byCnpj, error: cnpjError } = await supabase
        .from('fornecedores')
        .select('*')
        .eq('user_id', userId)
        .eq('cnpj', cnpj)
        .limit(1);

      if (cnpjError) throw cnpjError;
      if (byCnpj && byCnpj.length > 0) {
        return byCnpj[0];
      }
    }

    if (nome) {
      const { data: candidates, error: nomeError } = await supabase
        .from('fornecedores')
        .select('*')
        .eq('user_id', userId)
        .limit(50);
      if (nomeError) throw nomeError;

      let best = null;
      let bestScore = 0;
      for (const c of candidates || []) {
        const score = similarity(nome, c.nome || '');
        if (score > bestScore) {
          best = c;
          bestScore = score;
        }
      }
      if (best && bestScore >= FUZZY_NAME_THRESHOLD) {
        if (cnpj && !best.cnpj) {
          await supabase
            .from('fornecedores')
            .update({ cnpj })
            .eq('id', best.id)
            .eq('user_id', userId);
          best.cnpj = cnpj;
        }
        return best;
      }
    }

    const insertPayload = {
      user_id: userId,
      nome: nome || `Fornecedor ${cnpj || crypto.randomUUID().slice(0, 8)}`,
      cnpj: cnpj || null,
      email: fornecedorParsed.email || null,
      whatsapp: fornecedorParsed.whatsapp || null
    };
    const { data: created, error: createError } = await supabase
      .from('fornecedores')
      .insert(insertPayload)
      .select('*')
      .single();

    if (createError) throw createError;
    return created;
  }

  /**
   * Persiste o documento em supplier_documents (snapshot pre-link). Retorna o registro.
   *
   * @param {string} userId
   * @param {Object} parsed - output do extract()
   * @param {Object} options
   * @param {string} [options.fileHash] - hash sha256 do arquivo (para idempotência)
   * @param {string} [options.sourcePhone] - número WhatsApp que enviou o arquivo
   * @param {string} [options.fornecedorId] - id já resolvido (opcional)
   */
  async persist(userId, parsed, options = {}) {
    const payload = {
      user_id: userId,
      fornecedor_id: options.fornecedorId || null,
      tipo: parsed.tipo || 'outro',
      raw_text: parsed.raw_text || null,
      parsed_json: {
        fornecedor: parsed.fornecedor,
        valor_total: parsed.valor_total,
        vencimentos: parsed.vencimentos,
        itens: parsed.itens,
        confidence_score: parsed.confidence_score
      },
      status: 'pending',
      source_phone: options.sourcePhone || null,
      file_hash: options.fileHash || null,
      confidence_score: parsed.confidence_score ?? null
    };

    const { data, error } = await supabase
      .from('supplier_documents')
      .insert(payload)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  /**
   * Cria 1 ou N linhas em contas_pagar (uma por parcela) e marca o supplier_document
   * como linked.
   *
   * @param {string} userId
   * @param {Object} parsed
   * @param {string|null} fornecedorId
   * @param {Object} options
   * @param {string} [options.supplierDocumentId]
   * @returns {Promise<Array>} contas criadas
   */
  async createContasPagarFromDocument(userId, parsed, fornecedorId = null, options = {}) {
    if (!userId) throw new Error('userId obrigatório.');
    const vencimentos = Array.isArray(parsed?.vencimentos) && parsed.vencimentos.length > 0
      ? parsed.vencimentos
      : [{ numero: 1, valor: parsed?.valor_total || 0, data: new Date().toISOString().split('T')[0] }];

    const totalParcelas = vencimentos.length;
    const origem = TIPO_PARA_ORIGEM[parsed?.tipo] || 'manual';
    const baseDescricao = parsed?.fornecedor?.nome
      ? `Fornecedor ${parsed.fornecedor.nome}`
      : 'Documento de fornecedor';

    const rows = vencimentos.map((venc, idx) => ({
      user_id: userId,
      descricao: totalParcelas > 1
        ? `${baseDescricao} (${idx + 1}/${totalParcelas})`
        : baseDescricao,
      valor: Math.abs(Number(venc.valor) || 0),
      data: venc.data || new Date().toISOString().split('T')[0],
      data_vencimento: venc.data || null,
      tipo: 'variavel',
      categoria: 'Fornecedores',
      status_pagamento: 'pendente',
      observacoes: parsed?.fornecedor?.cnpj ? `CNPJ ${parsed.fornecedor.cnpj}` : null,
      origem,
      supplier_document_id: options.supplierDocumentId || null,
      fornecedor_id: fornecedorId || null,
      parcela_numero: idx + 1,
      parcela_total: totalParcelas
    }));

    const { data, error } = await supabase
      .from('contas_pagar')
      .insert(rows)
      .select('*');
    if (error) throw error;

    if (options.supplierDocumentId) {
      await supabase
        .from('supplier_documents')
        .update({
          status: 'linked',
          fornecedor_id: fornecedorId || null,
          conta_pagar_id: data?.[0]?.id || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', options.supplierDocumentId)
        .eq('user_id', userId);
    }

    return data || [];
  }

  /**
   * Para cada item da NF, tenta casar com `procedimentos` (fuzzy nome).
   * - score >= STOCK_MATCH_THRESHOLD → registra entrada no estoque.
   * - score < threshold → adiciona em itens_pendentes para confirmação manual.
   *
   * @param {string} userId
   * @param {Object} parsed
   * @param {Object} options
   * @param {string} [options.supplierDocumentId]
   * @param {string} [options.fornecedorId]
   * @returns {Promise<{aplicados: Array, pendentes: Array}>}
   */
  async applyEstoqueEntradaFromItens(userId, parsed, options = {}) {
    const itens = Array.isArray(parsed?.itens) ? parsed.itens : [];
    if (itens.length === 0) {
      return { aplicados: [], pendentes: [] };
    }

    const { data: procedimentos, error } = await supabase
      .from('procedimentos')
      .select('id, nome')
      .eq('user_id', userId);
    if (error) throw error;

    const aplicados = [];
    const pendentes = [];

    for (const item of itens) {
      const descricao = item.descricao || item.nome || '';
      const quantidade = Number(item.quantidade) || 0;
      if (!descricao || quantidade <= 0) {
        pendentes.push({ ...item, motivo: 'descricao_ou_quantidade_invalida' });
        continue;
      }

      let best = null;
      let bestScore = 0;
      for (const proc of procedimentos || []) {
        const score = similarity(descricao, proc.nome || '');
        if (score > bestScore) {
          best = proc;
          bestScore = score;
        }
      }

      if (best && bestScore >= STOCK_MATCH_THRESHOLD) {
        try {
          const movimento = await estoqueService.registrarEntrada(userId, {
            procedimentoId: best.id,
            quantidade,
            custoUnitario: item.valor_unitario || null,
            fornecedorId: options.fornecedorId || null,
            observacoes: `OCR doc ${options.supplierDocumentId || ''}`.trim()
          });
          aplicados.push({
            descricao,
            procedimento_id: best.id,
            score: bestScore,
            movimento
          });
        } catch (e) {
          pendentes.push({ ...item, motivo: 'falha_ao_aplicar_estoque', erro: e?.message || String(e) });
        }
      } else {
        pendentes.push({ ...item, motivo: best ? 'baixa_similaridade' : 'sem_procedimentos_cadastrados', score: bestScore });
      }
    }

    if (options.supplierDocumentId && pendentes.length > 0) {
      const { data: existing } = await supabase
        .from('supplier_documents')
        .select('parsed_json')
        .eq('id', options.supplierDocumentId)
        .eq('user_id', userId)
        .single();
      const parsedJson = { ...(existing?.parsed_json || {}), itens_pendentes: pendentes };
      await supabase
        .from('supplier_documents')
        .update({ parsed_json: parsedJson, updated_at: new Date().toISOString() })
        .eq('id', options.supplierDocumentId)
        .eq('user_id', userId);
    }

    return { aplicados, pendentes };
  }

  /**
   * Helper exposto para testes / matchers manuais.
   */
  similarity(a, b) {
    return similarity(a, b);
  }
}

module.exports = new SupplierDocumentService();
module.exports.SupplierDocumentService = SupplierDocumentService;
module.exports._helpers = { similarity, sanitizeCnpj, normalizeName };
