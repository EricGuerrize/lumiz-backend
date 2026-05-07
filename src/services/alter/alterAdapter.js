/**
 * Onda 3.A — Factory do AlterAdapter.
 *
 * Resolve qual adapter usar em runtime com base nas variáveis de ambiente
 * `ALTER_API_URL` + `ALTER_API_KEY`. Se ambas estiverem definidas → adapter
 * real (HTTP); caso contrário → mock (deriva de `parcelas` + `mdr_configs`).
 *
 * Por que factory + proxy:
 *   - Evita que cada service importe os dois adapters e decida sozinho.
 *   - Permite swap em testes via `refresh()` (após `process.env.X = ...`).
 *   - Mantém a interface em um único módulo — domain services nunca precisam
 *     saber se estão falando com mock ou real.
 *
 * Uso normal:
 *   const alterAdapter = require('./alterAdapter');
 *   const recebiveis = await alterAdapter.listRecebiveis(userId);
 *
 * Em testes:
 *   process.env.ALTER_API_URL = 'https://...'; process.env.ALTER_API_KEY = '...';
 *   alterAdapter.refresh();
 *   expect(alterAdapter.isReal()).toBe(true);
 *
 * Contrato: ver `alterAdapterContract.js` para shapes de retorno.
 */

const mockAlterAdapter = require('./mockAlterAdapter');
const realAlterAdapter = require('./realAlterAdapter');

/**
 * Decide qual instância usar baseado nas envs Alter.
 * @returns {object} adapter selecionado
 */
function _resolveAdapter() {
  if (process.env.ALTER_API_URL && process.env.ALTER_API_KEY) {
    return realAlterAdapter;
  }
  return mockAlterAdapter;
}

let cachedAdapter = _resolveAdapter();

const proxy = {
  /**
   * Adapter atualmente cacheado. Útil para inspeção/debug e para testes que
   * precisam stubar o adapter inteiro.
   * @returns {object}
   */
  getInstance() {
    return cachedAdapter;
  },

  /**
   * Re-resolve o adapter. Útil quando testes mexem em `process.env.ALTER_*`
   * em runtime e precisam que o factory leia de novo.
   * @returns {object} adapter recém-resolvido
   */
  refresh() {
    cachedAdapter = _resolveAdapter();
    return cachedAdapter;
  },

  /**
   * @returns {boolean} true se o adapter atual é o mock
   */
  isMock() {
    return cachedAdapter === mockAlterAdapter;
  },

  /**
   * @returns {boolean} true se o adapter atual é o real (HTTP)
   */
  isReal() {
    return cachedAdapter === realAlterAdapter;
  }
};

/**
 * Métodos do contrato + um auxiliar (`syncFromParcelas`) específico do mock.
 * O proxy delega para o adapter atual; se o método não existir (ex.:
 * `syncFromParcelas` no real), lança erro claro.
 */
const METHODS = [
  'listRecebiveis',
  'getAggregatePosition',
  'simulateAntecipacaoSpot',
  'executeAntecipacaoSpot',
  'cancelAutomatica',
  'syncFromParcelas'
];

for (const method of METHODS) {
  proxy[method] = (...args) => {
    const adapter = proxy.getInstance();
    if (typeof adapter[method] !== 'function') {
      throw new Error(`Método ${method} não exposto pelo adapter atual.`);
    }
    return adapter[method](...args);
  };
}

module.exports = proxy;
