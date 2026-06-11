/**
 * Onda dashboard — ponte entre inventário real (`estoque_produtos`) e legado (`procedimentos`).
 * Responsável por rotas GET `/api/dashboard/estoque*`: prioriza dados do WhatsApp/inventário
 * real e faz fallback transparente para o modelo legado quando não há produtos cadastrados.
 */
const estoqueProdutoService = require('./estoqueProdutoService');
const estoqueService = require('./estoqueService');

class DashboardEstoqueService {
  /**
   * @param {string} userId
   * @returns {Promise<{ produtos: object[], source: string, meta?: { is_empty: boolean, hint?: string|null } }>}
   */
  async getEstoqueStatus(userId) {
    const real = await estoqueProdutoService.getEstoqueStatus(userId);
    if ((real.produtos || []).length > 0) {
      return {
        ...real,
        source: 'real_inventory',
        meta: { is_empty: false },
      };
    }

    const legacy = await estoqueService.getEstoqueStatus(userId);
    const isEmpty = (legacy.produtos || []).length === 0;
    return {
      ...legacy,
      source: 'legacy_procedimentos',
      meta: {
        is_empty: isEmpty,
        hint: isEmpty
          ? 'Cadastre produtos pelo WhatsApp ou importe planilha para ver o inventário.'
          : null,
      },
    };
  }

  /**
   * @param {string} userId
   * @returns {Promise<{ alertas: object[], total: number, source: string }>}
   */
  async getAlertasBaixoEstoque(userId) {
    const real = await estoqueProdutoService.getEstoqueStatus(userId);
    if ((real.produtos || []).length > 0) {
      const alertas = await estoqueProdutoService.listarAlertasCriticos(userId);
      return { alertas, total: alertas.length, source: 'real_inventory' };
    }

    const legacy = await estoqueService.getAlertasBaixoEstoque(userId);
    return { ...legacy, source: 'legacy_procedimentos' };
  }

  /**
   * @param {string} userId
   * @returns {Promise<{ alertas: object[], total: number, source: string }>}
   */
  async getAlertasEstoqueExcesso(userId) {
    const real = await estoqueProdutoService.getEstoqueStatus(userId);
    if ((real.produtos || []).length > 0) {
      const alertas = (real.produtos || []).filter((p) => p.status === 'excesso');
      return { alertas, total: alertas.length, source: 'real_inventory' };
    }

    const legacy = await estoqueService.getAlertasEstoqueExcesso(userId);
    return { ...legacy, source: 'legacy_procedimentos' };
  }

  /**
   * Sugestões de reposição — permanece no legado até equivalente no inventário real.
   * @param {string} userId
   * @param {number|null|undefined} saldoAtualPassado
   * @returns {Promise<object>}
   */
  async sugerirReposicao(userId, saldoAtualPassado) {
    const real = await estoqueProdutoService.getEstoqueStatus(userId);
    const source = (real.produtos || []).length > 0 ? 'real_inventory' : 'legacy_procedimentos';
    const result = await estoqueService.sugerirReposicao(userId, saldoAtualPassado);
    return { ...result, source };
  }
}

module.exports = new DashboardEstoqueService();
