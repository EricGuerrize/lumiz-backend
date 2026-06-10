/**
 * Inventário real Lumiz — consumo padrão por procedimento.
 * Estrutura reservada para uma futura etapa explícita de atualização
 * pós-procedimento. O fluxo público atual não baixa estoque automaticamente.
 */
const supabase = require('../db/supabase');
const estoqueProdutoService = require('./estoqueProdutoService');

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
  const cleaned = String(value)
    .replace(/R\$/gi, '')
    .replace(/[^\d,.-]/g, '')
    .trim();
  if (!cleaned) return null;
  const normalized = cleaned.includes(',') && cleaned.includes('.')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned.replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeUnit(unit) {
  const value = normalizeText(unit);
  if (!value) return 'unidade';
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

function parseConsumptionItem(rawItem) {
  const text = String(rawItem || '').trim();
  if (!text) return null;

  const match = text.match(/(.+?)\s+(\d+(?:[.,]\d+)?)\s*(frascos?|seringas?|caixas?|unidades?|unid|und|ampolas?|pacotes?|par(?:es)?|ml)?$/i);
  if (!match) return null;

  const nome = match[1].trim().replace(/^[-•*]\s*/, '');
  const quantidade = parseNumber(match[2]);
  if (!nome || !quantidade || quantidade <= 0) return null;

  return {
    nome,
    quantidade,
    unidade: normalizeUnit(match[3] || 'unidade')
  };
}

class ProcedimentoConsumoService {
  /**
   * Interpreta comando textual de configuração de consumo.
   * @param {string} text
   * @returns {{procedimentoNome: string|null, itens: Array<object>}}
   */
  parseConsumptionSetupText(text) {
    const raw = String(text || '').trim();
    const match = raw.match(/(?:configurar|cadastrar|definir)?\s*consumo\s+(?:do\s+|da\s+|de\s+)?([^:]+)\s*:\s*(.+)$/i);
    if (!match) return { procedimentoNome: null, itens: [] };

    const procedimentoNome = match[1].trim();
    const itens = match[2]
      .split(/;|\n|(?:\s+e\s+)/i)
      .map(parseConsumptionItem)
      .filter(Boolean);

    return { procedimentoNome, itens };
  }

  /**
   * Busca procedimento do usuário por nome exato ou parcial.
   * @param {string} userId
   * @param {string} procedimentoNome
   * @returns {Promise<object|null>}
   */
  async findProcedimentoByName(userId, procedimentoNome) {
    const termo = String(procedimentoNome || '').trim();
    if (!userId || !termo) return null;

    const { data: exact, error: exactError } = await supabase
      .from('procedimentos')
      .select('id, nome, tipo')
      .eq('user_id', userId)
      .ilike('nome', termo)
      .limit(1)
      .maybeSingle();
    if (!exactError && exact) return exact;

    const { data: partial, error: partialError } = await supabase
      .from('procedimentos')
      .select('id, nome, tipo')
      .eq('user_id', userId)
      .ilike('nome', `%${termo}%`)
      .limit(1)
      .maybeSingle();
    if (partialError) throw partialError;
    return partial || null;
  }

  /**
   * Cadastra/substitui consumos padrão de um procedimento.
   * @param {string} userId
   * @param {string} procedimentoNome
   * @param {Array<object>} itens
   * @returns {Promise<{procedimento: object, applied: Array<object>, failed: Array<object>}>}
   */
  async configureConsumption(userId, procedimentoNome, itens = []) {
    const procedimento = await this.findProcedimentoByName(userId, procedimentoNome);
    if (!procedimento) {
      throw new Error(`Procedimento "${procedimentoNome}" não encontrado`);
    }

    const applied = [];
    const failed = [];

    for (const item of itens) {
      try {
        const produto = await estoqueProdutoService.findProductByName(userId, item.nome);
        if (!produto) {
          failed.push({ item, erro: `Produto "${item.nome}" não encontrado no inventário` });
          continue;
        }

        const payload = {
          user_id: userId,
          procedimento_id: procedimento.id,
          produto_id: produto.id,
          quantidade_padrao: Number(item.quantidade),
          unidade: item.unidade || produto.unidade || null,
          obrigatorio: true,
          metadata: {
            source: 'whatsapp_config',
            produto_nome: produto.nome,
            procedimento_nome: procedimento.nome
          },
          updated_at: new Date().toISOString()
        };

        const { data, error } = await supabase
          .from('procedimento_consumos')
          .upsert(payload, { onConflict: 'user_id,procedimento_id,produto_id' })
          .select('id, quantidade_padrao, unidade, produto_id')
          .single();
        if (error) throw error;

        applied.push({
          id: data.id,
          produtoId: produto.id,
          produtoNome: produto.nome,
          quantidade: Number(data.quantidade_padrao),
          unidade: data.unidade || produto.unidade || item.unidade || 'unidade'
        });
      } catch (error) {
        failed.push({ item, erro: error.message });
      }
    }

    return { procedimento, applied, failed };
  }

  /**
   * Retorna regras de consumo cadastradas para um procedimento.
   * @param {string} userId
   * @param {string} procedimentoNome
   * @returns {Promise<Array<object>>}
   */
  async getRulesForProcedureName(userId, procedimentoNome) {
    const procedimento = await this.findProcedimentoByName(userId, procedimentoNome);
    if (!procedimento) return [];

    const { data, error } = await supabase
      .from('procedimento_consumos')
      .select('id, produto_id, quantidade_padrao, unidade, obrigatorio, estoque_produtos(id, nome, unidade)')
      .eq('user_id', userId)
      .eq('procedimento_id', procedimento.id);
    if (error) throw error;

    return (data || []).map((row) => ({
      id: row.id,
      procedimento,
      produtoId: row.produto_id,
      produtoNome: row.estoque_produtos?.nome || null,
      unidade: row.unidade || row.estoque_produtos?.unidade || 'unidade',
      quantidadePadrao: Number(row.quantidade_padrao) || 0,
      obrigatorio: row.obrigatorio !== false
    })).filter((rule) => rule.quantidadePadrao > 0);
  }

  /**
   * Aplica consumo de estoque para uma venda confirmada.
   *
   * Guardado por `allowAutoConsumption` para impedir baixa automática acidental.
   * A decisão de produto atual exige uma etapa explícita pós-procedimento.
   *
   * @param {string} userId
   * @param {object} sale
   * @returns {Promise<{skipped: boolean, reason?: string, applied: Array<object>, failed: Array<object>}>}
   */
  async applyConsumptionForSale(userId, sale = {}) {
    if (sale.allowAutoConsumption !== true) {
      return { skipped: true, reason: 'auto_consumption_disabled', applied: [], failed: [] };
    }

    const procedimentoNome = sale.procedimentoNome || sale.categoria || sale.descricao;
    if (!userId || !procedimentoNome) {
      return { skipped: true, reason: 'missing_procedure', applied: [], failed: [] };
    }

    const rules = await this.getRulesForProcedureName(userId, procedimentoNome);
    if (!rules.length) {
      return { skipped: true, reason: 'no_rules', applied: [], failed: [] };
    }

    const quantidadeProcedimentos = Number(sale.quantidadeProcedimentos || 1) || 1;
    const applied = [];
    const failed = [];

    for (const rule of rules) {
      const quantidade = rule.quantidadePadrao * quantidadeProcedimentos;
      try {
        const result = await estoqueProdutoService.registrarSaida(userId, {
          produtoId: rule.produtoId,
          quantidade,
          origem: 'procedimento_auto',
          sourcePhone: sale.sourcePhone || sale.source_phone || null,
          sourceMessageId: sale.sourceMessageId || sale.source_message_id || null,
          observacoes: `Baixa automática por venda de ${rule.procedimento.nome}`,
          metadata: {
            atendimento_id: sale.atendimentoId || sale.atendimento_id || null,
            procedimento_id: rule.procedimento.id,
            procedimento_nome: rule.procedimento.nome,
            regra_consumo_id: rule.id,
            quantidade_procedimentos: quantidadeProcedimentos
          }
        });
        applied.push({
          ...result,
          quantidadeConsumida: quantidade,
          procedimentoNome: rule.procedimento.nome
        });
      } catch (error) {
        failed.push({
          produtoId: rule.produtoId,
          produtoNome: rule.produtoNome,
          quantidade,
          erro: error.message
        });
      }
    }

    return { skipped: false, applied, failed };
  }
}

module.exports = new ProcedimentoConsumoService();
module.exports._helpers = {
  parseNumber,
  normalizeUnit,
  parseConsumptionItem,
};
