/**
 * Contrato comum entre `mockAlterAdapter` e `realAlterAdapter`.
 *
 * Mantemos como classe abstrata (no estilo Node) — quem implementa precisa
 * sobrescrever todos os métodos. Documenta também os shapes de retorno para
 * que o frontend e os services de domínio (`alterRecebiveisService`,
 * `antecipacaoService`, `coberturaFornecedorService`) tenham contrato estável.
 *
 * Shape Recebivel:
 *   {
 *     id: string,
 *     adquirente: string|null,
 *     bandeira: string|null,
 *     parcelas_total: number,
 *     parcela_numero: number,
 *     valor_bruto: number,
 *     valor_liquido: number,
 *     mdr: number|null,
 *     data_venda: string (YYYY-MM-DD),
 *     data_disponivel: string (YYYY-MM-DD),
 *     status: 'livre'|'comprometido'|'antecipado'|'liquidado',
 *     source: 'mock'|'alter_api',
 *     external_id: string|null,
 *     parcela_id: string|null
 *   }
 *
 * Shape Antecipacao Spot:
 *   {
 *     valor_solicitado: number,
 *     valor_liquido_recebido: number,
 *     custo_antecipacao: number,
 *     taxa_efetiva_pct: number,
 *     recebiveis_ids: string[],
 *     status: 'simulada'|'executada'|'cancelada'|'falhou'
 *   }
 *
 * Shape Aggregate Position:
 *   {
 *     livre: number,
 *     comprometido: number,
 *     antecipado: number,
 *     liquidado_30d: number
 *   }
 */

class NotImplementedError extends Error {
  constructor(method) {
    super(`Método ${method} não implementado neste adapter.`);
    this.name = 'NotImplementedError';
  }
}

class AlterAdapterContract {
  /**
   * @param {string} userId
   * @param {Object} [filters]
   * @param {string} [filters.from] - YYYY-MM-DD
   * @param {string} [filters.to]   - YYYY-MM-DD
   * @param {string} [filters.status]
   * @param {string} [filters.adquirente]
   * @returns {Promise<Array>} Array<Recebivel>
   */
  async listRecebiveis(userId, filters = {}) { throw new NotImplementedError('listRecebiveis'); }

  /**
   * Posição agregada (livre/comprometido/antecipado/liquidado_30d).
   * @param {string} userId
   * @returns {Promise<Object>}
   */
  async getAggregatePosition(userId) { throw new NotImplementedError('getAggregatePosition'); }

  /**
   * Simula antecipação spot para alvo de caixa em horizonte de dias.
   * @param {string} userId
   * @param {Object} params
   * @param {number} params.valor_alvo - quanto a clínica quer ter em caixa
   * @param {number} [params.horizonte_dias=30]
   * @returns {Promise<Object>} simulação (não persiste)
   */
  async simulateAntecipacaoSpot(userId, params) { throw new NotImplementedError('simulateAntecipacaoSpot'); }

  /**
   * Executa antecipação spot persistindo em `alter_antecipacoes` e marcando
   * recebíveis como `antecipado`. Mock simula execução imediata; real chama API.
   * @param {string} userId
   * @param {Object} params
   * @returns {Promise<Object>} antecipação executada
   */
  async executeAntecipacaoSpot(userId, params) { throw new NotImplementedError('executeAntecipacaoSpot'); }

  /**
   * Cancela antecipação automática (no real, chama Alter; no mock, marca flag).
   * @param {string} userId
   * @returns {Promise<Object>}
   */
  async cancelAutomatica(userId) { throw new NotImplementedError('cancelAutomatica'); }
}

module.exports = { AlterAdapterContract, NotImplementedError };
