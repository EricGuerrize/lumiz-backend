/**
 * Onda 4 — Smoke contract das respostas com `meta.is_empty` / `meta.hint`.
 *
 * Garante que os services novos sempre devolvem `meta` no shape combinado.
 */

const { AlterRecebiveisService } = require('../../src/services/alter/alterRecebiveisService');
const { CoberturaFornecedorService } = require('../../src/services/alter/coberturaFornecedorService');
const { PagarComRecebivelService } = require('../../src/services/alter/pagarComRecebivelService');

describe('Onda 4 — meta.is_empty/hint nos services novos', () => {
  describe('alterRecebiveisService.getAging', () => {
    it('returns is_empty=true quando sem recebiveis', async () => {
      jest.resetModules();
      jest.doMock('../../src/db/supabase', () => {
        const chain = {
          select() { return this; },
          eq() { return this; },
          gte() { return this; },
          lte() { return this; },
          order() { return Promise.resolve({ data: [], error: null }); }
        };
        return { from() { return chain; } };
      });
      const { AlterRecebiveisService: S } = require('../../src/services/alter/alterRecebiveisService');
      const svc = new S({ syncFromParcelas: jest.fn().mockResolvedValue({ synced: 0 }) });
      const aging = await svc.getAging('u1');
      expect(aging.meta.is_empty).toBe(true);
      expect(typeof aging.meta.hint).toBe('string');
      expect(aging.total).toBe(0);
    });
  });

  describe('coberturaFornecedorService.calcular', () => {
    it('returns is_empty=true quando sem contas a pagar', async () => {
      jest.resetModules();
      jest.doMock('../../src/db/supabase', () => {
        const chain = {
          _resolved: { data: [], error: null },
          select() { return this; },
          eq() { return this; },
          gte() { return this; },
          lte() { return this; },
          order() { return Promise.resolve(this._resolved); },
          maybeSingle() { return Promise.resolve(this._resolved); }
        };
        return { from() { return chain; } };
      });
      const { CoberturaFornecedorService: S } = require('../../src/services/alter/coberturaFornecedorService');
      const svc = new S({ list: jest.fn().mockResolvedValue([]) });
      const result = await svc.calcular('u1', { horizonte_dias: 90 });
      expect(result.meta.is_empty).toBe(true);
      expect(typeof result.meta.hint).toBe('string');
      expect(result.fornecedores).toEqual([]);
    });
  });

  describe('pagarComRecebivelService.sugerir', () => {
    it('returns is_empty=true quando opcoes nao mapeiam contas', async () => {
      const svc = new PagarComRecebivelService(
        { list: jest.fn() },
        { simular: jest.fn() }
      );
      svc._loadContasFromOptions = jest.fn().mockResolvedValue([]);
      const out = await svc.sugerir('u1', { conta_pagar_id: 'inexistente' });
      expect(out.meta.is_empty).toBe(true);
      expect(out.cobertura).toBeNull();
    });
  });
});
