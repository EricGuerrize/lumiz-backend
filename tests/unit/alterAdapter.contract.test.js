/**
 * Testes de contrato do AlterAdapter — garantem que mock e real expõem a
 * mesma interface, e que o real lança NotImplementedError sem env config.
 */

process.env.NODE_ENV = 'test';

const { AlterAdapterContract, NotImplementedError } = require('../../src/services/alter/alterAdapterContract');
const mockAdapter = require('../../src/services/alter/mockAlterAdapter');
const realAdapter = require('../../src/services/alter/realAlterAdapter');
const alterAdapter = require('../../src/services/alter/alterAdapter');

const REQUIRED_METHODS = [
  'listRecebiveis',
  'getAggregatePosition',
  'simulateAntecipacaoSpot',
  'executeAntecipacaoSpot',
  'cancelAutomatica'
];

describe('AlterAdapterContract', () => {
  it('é uma classe abstrata que lança NotImplementedError nos métodos por padrão', async () => {
    const c = new AlterAdapterContract();
    for (const m of REQUIRED_METHODS) {
      await expect(c[m]('user1')).rejects.toBeInstanceOf(NotImplementedError);
    }
  });
});

describe('mockAlterAdapter', () => {
  it('expõe todos os métodos do contrato', () => {
    for (const m of REQUIRED_METHODS) {
      expect(typeof mockAdapter[m]).toBe('function');
    }
  });

  it('simulateAntecipacaoSpot devolve 0 quando valor_alvo é 0', async () => {
    const result = await mockAdapter.simulateAntecipacaoSpot('any', { valor_alvo: 0 });
    expect(result.valor_solicitado).toBe(0);
    expect(result.valor_liquido_recebido).toBe(0);
    expect(result.recebiveis_ids).toEqual([]);
    expect(result.status).toBe('simulada');
  });
});

describe('realAlterAdapter', () => {
  it('expõe todos os métodos do contrato', () => {
    for (const m of REQUIRED_METHODS) {
      expect(typeof realAdapter[m]).toBe('function');
    }
  });

  it('lança NotImplementedError quando ALTER_API_URL/ALTER_API_KEY ausentes', async () => {
    const originalUrl = process.env.ALTER_API_URL;
    const originalKey = process.env.ALTER_API_KEY;
    delete process.env.ALTER_API_URL;
    delete process.env.ALTER_API_KEY;
    const { RealAlterAdapter } = require('../../src/services/alter/realAlterAdapter');
    const fresh = new RealAlterAdapter();
    expect(fresh.isConfigured()).toBe(false);
    for (const m of REQUIRED_METHODS) {
      await expect(fresh[m]()).rejects.toBeInstanceOf(NotImplementedError);
    }
    if (originalUrl !== undefined) process.env.ALTER_API_URL = originalUrl;
    if (originalKey !== undefined) process.env.ALTER_API_KEY = originalKey;
  });
});

describe('alterAdapter factory', () => {
  it('default em test/dev resolve para mock', () => {
    const originalUrl = process.env.ALTER_API_URL;
    const originalKey = process.env.ALTER_API_KEY;
    delete process.env.ALTER_API_URL;
    delete process.env.ALTER_API_KEY;
    alterAdapter.refresh();
    expect(alterAdapter.isMock()).toBe(true);
    expect(alterAdapter.isReal()).toBe(false);
    if (originalUrl !== undefined) process.env.ALTER_API_URL = originalUrl;
    if (originalKey !== undefined) process.env.ALTER_API_KEY = originalKey;
    alterAdapter.refresh();
  });

  it('com ALTER_API_URL+KEY definidos, resolve para real', () => {
    process.env.ALTER_API_URL = 'https://alter.test';
    process.env.ALTER_API_KEY = 'fake_key';
    alterAdapter.refresh();
    expect(alterAdapter.isReal()).toBe(true);
    expect(alterAdapter.isMock()).toBe(false);
    delete process.env.ALTER_API_URL;
    delete process.env.ALTER_API_KEY;
    alterAdapter.refresh();
  });

  it('expõe os mesmos métodos que o adapter real', () => {
    for (const m of REQUIRED_METHODS) {
      expect(typeof alterAdapter[m]).toBe('function');
    }
  });
});
