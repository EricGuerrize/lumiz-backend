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

  it('isConfigured() retorna false quando ALTER_CLIENT_ID/ALTER_CLIENT_SECRET ausentes', () => {
    const origId = process.env.ALTER_CLIENT_ID;
    const origSecret = process.env.ALTER_CLIENT_SECRET;
    delete process.env.ALTER_CLIENT_ID;
    delete process.env.ALTER_CLIENT_SECRET;
    const { RealAlterAdapter } = require('../../src/services/alter/realAlterAdapter');
    const fresh = new RealAlterAdapter();
    expect(fresh.isConfigured()).toBe(false);
    if (origId !== undefined) process.env.ALTER_CLIENT_ID = origId;
    if (origSecret !== undefined) process.env.ALTER_CLIENT_SECRET = origSecret;
  });

  describe('registerBusinessPartner', () => {
    const origFetch = global.fetch;
    const origId = process.env.ALTER_CLIENT_ID;
    const origSecret = process.env.ALTER_CLIENT_SECRET;

    afterEach(() => {
      global.fetch = origFetch;
      jest.resetModules();
      jest.dontMock('../../src/db/supabase');
      if (origId !== undefined) process.env.ALTER_CLIENT_ID = origId;
      else delete process.env.ALTER_CLIENT_ID;
      if (origSecret !== undefined) process.env.ALTER_CLIENT_SECRET = origSecret;
      else delete process.env.ALTER_CLIENT_SECRET;
    });

    function mockAlterFetch(bpJson) {
      global.fetch = jest.fn(async (url) => {
        if (String(url).includes('/oauth/token')) {
          return {
            ok: true,
            json: async () => ({ access_token: 'tok-test', expires_in: 3600 })
          };
        }
        return {
          ok: true,
          json: async () => bpJson
        };
      });
    }

    function mockSupabaseUpdate() {
      const updatePayloads = [];
      jest.doMock('../../src/db/supabase', () => ({
        from: () => ({
          update: (payload) => {
            updatePayloads.push(payload);
            return { eq: () => Promise.resolve({ error: null }) };
          }
        })
      }));
      return updatePayloads;
    }

    it('persiste alter_bp_id quando API retorna { data: { id } }', async () => {
      jest.resetModules();
      process.env.ALTER_CLIENT_ID = 'client-test';
      process.env.ALTER_CLIENT_SECRET = 'secret-test';
      mockAlterFetch({ data: { id: 'bp-wrapped-1', name: 'Clínica Teste' } });
      const updatePayloads = mockSupabaseUpdate();

      const { RealAlterAdapter } = require('../../src/services/alter/realAlterAdapter');
      const adapter = new RealAlterAdapter();
      const result = await adapter.registerBusinessPartner('user-1', {
        cnpj: '00.000.000/0001-91',
        name: 'Clínica Teste'
      });

      expect(updatePayloads).toEqual([{ alter_bp_id: 'bp-wrapped-1' }]);
      expect(result).toEqual({ id: 'bp-wrapped-1', name: 'Clínica Teste' });
    });

    it('persiste alter_bp_id quando API retorna objeto plano { id }', async () => {
      jest.resetModules();
      process.env.ALTER_CLIENT_ID = 'client-test';
      process.env.ALTER_CLIENT_SECRET = 'secret-test';
      mockAlterFetch({ id: 'bp-flat-1', name: 'Clínica Plana' });
      const updatePayloads = mockSupabaseUpdate();

      const { RealAlterAdapter } = require('../../src/services/alter/realAlterAdapter');
      const adapter = new RealAlterAdapter();
      const result = await adapter.registerBusinessPartner('user-2', {
        cnpj: '00000000000191',
        name: 'Clínica Plana'
      });

      expect(updatePayloads).toEqual([{ alter_bp_id: 'bp-flat-1' }]);
      expect(result.id).toBe('bp-flat-1');
    });
  });
});

describe('alterAdapter factory', () => {
  it('default em test/dev resolve para mock', () => {
    const origId = process.env.ALTER_CLIENT_ID;
    const origSecret = process.env.ALTER_CLIENT_SECRET;
    delete process.env.ALTER_CLIENT_ID;
    delete process.env.ALTER_CLIENT_SECRET;
    alterAdapter.refresh();
    expect(alterAdapter.isMock()).toBe(true);
    expect(alterAdapter.isReal()).toBe(false);
    if (origId !== undefined) process.env.ALTER_CLIENT_ID = origId;
    if (origSecret !== undefined) process.env.ALTER_CLIENT_SECRET = origSecret;
    alterAdapter.refresh();
  });

  it('com ALTER_CLIENT_ID+SECRET definidos, resolve para real', () => {
    process.env.ALTER_CLIENT_ID = 'fake_client_id';
    process.env.ALTER_CLIENT_SECRET = 'fake_client_secret';
    alterAdapter.refresh();
    expect(alterAdapter.isReal()).toBe(true);
    expect(alterAdapter.isMock()).toBe(false);
    delete process.env.ALTER_CLIENT_ID;
    delete process.env.ALTER_CLIENT_SECRET;
    alterAdapter.refresh();
  });

  it('expõe os mesmos métodos que o adapter real', () => {
    for (const m of REQUIRED_METHODS) {
      expect(typeof alterAdapter[m]).toBe('function');
    }
  });
});
