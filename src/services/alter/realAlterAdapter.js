const { AlterAdapterContract, NotImplementedError } = require('./alterAdapterContract');

/**
 * RealAlterAdapter — stub para integração real.
 *
 * Quando a Alter publicar a API:
 *   1) Implementar cada método consumindo `process.env.ALTER_API_URL` +
 *      `process.env.ALTER_API_KEY`.
 *   2) Persistir snapshots em `alter_recebiveis` com `source = 'alter_api'`.
 *   3) Reusar `alterRecebiveisService` / `antecipacaoService` /
 *      `coberturaFornecedorService` — eles consomem só `alter_recebiveis` +
 *      `alter_antecipacoes`, sem chamar o adapter direto.
 *
 * Por ora, todos os métodos lançam NotImplementedError quando a env não está
 * configurada (factory já redireciona para o mock; este código é defensivo).
 */

class RealAlterAdapter extends AlterAdapterContract {
  constructor() {
    super();
    this.apiUrl = process.env.ALTER_API_URL || null;
    this.apiKey = process.env.ALTER_API_KEY || null;
  }

  isConfigured() {
    return Boolean(this.apiUrl && this.apiKey);
  }

  async listRecebiveis() {
    if (!this.isConfigured()) {
      throw new NotImplementedError('listRecebiveis (ALTER_API_URL/ALTER_API_KEY ausentes)');
    }
    throw new NotImplementedError('listRecebiveis (aguardando contrato Alter)');
  }

  async getAggregatePosition() {
    if (!this.isConfigured()) {
      throw new NotImplementedError('getAggregatePosition (ALTER_API_URL/ALTER_API_KEY ausentes)');
    }
    throw new NotImplementedError('getAggregatePosition (aguardando contrato Alter)');
  }

  async simulateAntecipacaoSpot() {
    if (!this.isConfigured()) {
      throw new NotImplementedError('simulateAntecipacaoSpot (ALTER_API_URL/ALTER_API_KEY ausentes)');
    }
    throw new NotImplementedError('simulateAntecipacaoSpot (aguardando contrato Alter)');
  }

  async executeAntecipacaoSpot() {
    if (!this.isConfigured()) {
      throw new NotImplementedError('executeAntecipacaoSpot (ALTER_API_URL/ALTER_API_KEY ausentes)');
    }
    throw new NotImplementedError('executeAntecipacaoSpot (aguardando contrato Alter)');
  }

  async cancelAutomatica() {
    if (!this.isConfigured()) {
      throw new NotImplementedError('cancelAutomatica (ALTER_API_URL/ALTER_API_KEY ausentes)');
    }
    throw new NotImplementedError('cancelAutomatica (aguardando contrato Alter)');
  }
}

const instance = new RealAlterAdapter();
module.exports = instance;
module.exports.RealAlterAdapter = RealAlterAdapter;
