const supabase = require('../../db/supabase');
const alterRecebiveisService = require('./alterRecebiveisService');
const antecipacaoService = require('./antecipacaoService');

/**
 * Onda 3.C — pagarComRecebivelService.
 *
 * Dado um `supplier_document_id` (NF/boleto extraído via Onda 2) ou um
 * conjunto de `contas_pagar` futuras, sugere usar recebíveis livres da
 * agenda Alter:
 *   - Se houver recebíveis livres com data_disponivel <= data_vencimento da
 *     conta: cobrir sem custo de antecipação (só compromisso).
 *   - Se gap, oferecer antecipação spot para cobrir o restante.
 *
 * Quando o usuário aceita (executar), marca os recebíveis selecionados como
 * `comprometido` e linka via `meta` à `conta_pagar` (não cria novo objeto).
 */

function _toNumber(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function _round2(n) {
  return Math.round(n * 100) / 100;
}

function _dateStr(d) {
  return new Date(d).toISOString().split('T')[0];
}

class PagarComRecebivelService {
  constructor(recebiveisService = alterRecebiveisService, antecService = antecipacaoService) {
    this.recebiveisService = recebiveisService;
    this.antecService = antecService;
  }

  /**
   * Sugere uso de recebíveis livres para cobrir uma conta a pagar específica.
   * @param {string} userId
   * @param {Object} options
   * @param {string} [options.supplier_document_id] — quando vier de NF/boleto
   * @param {string} [options.conta_pagar_id]      — quando o usuário aponta conta direto
   * @returns {Promise<Object>} sugestão de cobertura
   */
  async sugerir(userId, options = {}) {
    if (!userId) throw new Error('userId obrigatório.');

    const contas = await this._loadContasFromOptions(userId, options);
    if (contas.length === 0) {
      return {
        contas: [],
        total_a_pagar: 0,
        cobertura: null,
        meta: { is_empty: true, hint: 'Nada a pagar para esses parâmetros.' }
      };
    }

    const totalAPagar = contas.reduce((sum, c) => sum + _toNumber(c.valor), 0);
    const proximoVenc = contas.reduce(
      (acc, c) => (acc && acc < c.data_vencimento ? acc : c.data_vencimento),
      null
    );

    const today = _dateStr(new Date());
    const recebiveis = await this.recebiveisService.list(userId, {
      from: today,
      to: proximoVenc
    });
    const livres = recebiveis.filter((r) => r.status === 'livre');
    livres.sort((a, b) => (a.data_disponivel || '').localeCompare(b.data_disponivel || ''));

    let acumulado = 0;
    const escolhidos = [];
    for (const r of livres) {
      if (acumulado >= totalAPagar) break;
      acumulado += _toNumber(r.valor_liquido);
      escolhidos.push(r);
    }

    const cobreSemAntecipacao = acumulado >= totalAPagar;
    const gap = Math.max(0, totalAPagar - acumulado);

    let antecipacaoSugerida = null;
    if (!cobreSemAntecipacao && gap > 0) {
      antecipacaoSugerida = await this.antecService.simular(userId, {
        valor_alvo: gap,
        horizonte_dias: 30
      });
    }

    return {
      contas: contas.map((c) => ({
        id: c.id,
        valor: _toNumber(c.valor),
        data_vencimento: c.data_vencimento,
        fornecedor_id: c.fornecedor_id || null
      })),
      total_a_pagar: _round2(totalAPagar),
      cobertura: {
        recebiveis_livres_ids: escolhidos.map((r) => r.id),
        recebiveis_livres_valor: _round2(acumulado),
        cobre_sem_antecipacao: cobreSemAntecipacao,
        gap: _round2(gap),
        antecipacao_sugerida: antecipacaoSugerida
      },
      proximo_vencimento: proximoVenc,
      meta: {
        is_empty: false,
        hint: cobreSemAntecipacao
          ? 'Recebíveis livres já cobrem essa conta sem custo de antecipação.'
          : 'Recebíveis livres não cobrem 100%. Use antecipação spot para fechar o gap.'
      }
    };
  }

  /**
   * Compromete recebíveis para uma conta a pagar. Marca recebíveis como
   * 'comprometido' e adiciona referência via `notas` quando a coluna existir.
   * Não executa antecipação — quando há gap a ser coberto via antecipação,
   * o caller deve chamar `antecipacaoService.executar` separadamente.
   *
   * Idempotência: se algum recebível já saiu de 'livre' (ex.: foi comprometido
   * em outra conta), retorna `{ executado: false, indisponiveis: [...ids] }`
   * e NÃO faz nenhum update — o caller deve atualizar a sugestão e tentar de novo.
   *
   * @param {string} userId
   * @param {Object} params
   * @param {string[]} params.recebiveis_ids - IDs em `alter_recebiveis` (todos status='livre').
   * @param {string} [params.conta_pagar_id] - se informado, anota `notas` na conta_pagar.
   * @returns {Promise<{executado: boolean, valor_comprometido?: number, indisponiveis?: string[]}>}
   */
  async executar(userId, params = {}) {
    if (!userId) throw new Error('userId obrigatório.');
    const recebiveisIds = params.recebiveis_ids || [];
    const contaPagarId = params.conta_pagar_id || null;
    if (recebiveisIds.length === 0) {
      throw new Error('Nenhum recebível para comprometer.');
    }

    const { data: recebiveisAtuais, error: fetchError } = await supabase
      .from('alter_recebiveis')
      .select('id, status, valor_liquido')
      .eq('user_id', userId)
      .in('id', recebiveisIds);
    if (fetchError) throw fetchError;

    const indisponiveis = (recebiveisAtuais || []).filter((r) => r.status !== 'livre');
    if (indisponiveis.length > 0) {
      return {
        executado: false,
        erro: 'Alguns recebíveis não estão livres. Atualize a sugestão.',
        indisponiveis: indisponiveis.map((r) => r.id)
      };
    }

    const { error: updError } = await supabase
      .from('alter_recebiveis')
      .update({ status: 'comprometido', updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .in('id', recebiveisIds);
    if (updError) throw updError;

    if (contaPagarId) {
      // Anota no contas_pagar.notas (campo opcional caso exista) — fallback noop
      const { error: noteError } = await supabase
        .from('contas_pagar')
        .update({
          notas: `Pagamento via recebível Alter (ids: ${recebiveisIds.join(',')})`,
          updated_at: new Date().toISOString()
        })
        .eq('id', contaPagarId)
        .eq('user_id', userId);
      if (noteError && !String(noteError.message || '').includes('column')) {
        throw noteError;
      }
    }

    const valorComprometido = (recebiveisAtuais || [])
      .reduce((sum, r) => sum + _toNumber(r.valor_liquido), 0);

    return {
      executado: true,
      conta_pagar_id: contaPagarId,
      recebiveis_comprometidos_ids: recebiveisIds,
      valor_comprometido: _round2(valorComprometido)
    };
  }

  /**
   * Resolve as contas a pagar a partir das opções recebidas.
   *  - `conta_pagar_id`: carrega 1 conta específica (status='pendente').
   *  - `supplier_document_id`: carrega TODAS as parcelas geradas a partir
   *    daquele documento (a Onda 2 cria N linhas em `contas_pagar`, uma por
   *    vencimento, com `supplier_document_id` apontando para o doc).
   *  - sem nenhum dos dois: retorna [] (caller decide UX de empty).
   *
   * @private
   * @param {string} userId
   * @param {Object} options
   * @returns {Promise<Array<Object>>}
   */
  async _loadContasFromOptions(userId, options) {
    if (options.conta_pagar_id) {
      const { data, error } = await supabase
        .from('contas_pagar')
        .select('id, valor, data_vencimento, fornecedor_id, status_pagamento')
        .eq('user_id', userId)
        .eq('id', options.conta_pagar_id)
        .eq('status_pagamento', 'pendente')
        .maybeSingle();
      if (error) throw error;
      return data ? [data] : [];
    }
    if (options.supplier_document_id) {
      const { data, error } = await supabase
        .from('contas_pagar')
        .select('id, valor, data_vencimento, fornecedor_id, status_pagamento')
        .eq('user_id', userId)
        .eq('supplier_document_id', options.supplier_document_id)
        .eq('status_pagamento', 'pendente')
        .order('data_vencimento', { ascending: true });
      if (error) throw error;
      return data || [];
    }
    return [];
  }
}

const instance = new PagarComRecebivelService();
module.exports = instance;
module.exports.PagarComRecebivelService = PagarComRecebivelService;
