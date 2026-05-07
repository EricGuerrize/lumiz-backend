const { CoberturaFornecedorService, _helpers } = require('../../src/services/alter/coberturaFornecedorService');

describe('coberturaFornecedorService', () => {
  describe('_classify', () => {
    it('mapeia cobertura_pct para status correto', () => {
      expect(_helpers._classify(1.0)).toBe('ok');
      expect(_helpers._classify(1.5)).toBe('ok');
      expect(_helpers._classify(0.85)).toBe('apertado');
      expect(_helpers._classify(0.7)).toBe('apertado');
      expect(_helpers._classify(0.5)).toBe('risco');
      expect(_helpers._classify(0.4)).toBe('risco');
      expect(_helpers._classify(0.3)).toBe('critico');
      expect(_helpers._classify(0)).toBe('critico');
    });
  });

  describe('_calcGapDias', () => {
    it('retorna diff entre data de cobertura e data de vencimento', async () => {
      const svc = new CoberturaFornecedorService({});
      const recebiveis = [
        { id: 'r1', valor_liquido: '100', data_disponivel: '2026-05-15' },
        { id: 'r2', valor_liquido: '200', data_disponivel: '2026-05-20' }
      ];
      // proximo vencimento 2026-05-10, total a pagar 250 → cobertura em r2 (2026-05-20) → 10 dias gap
      const gap = await svc._calcGapDias('2026-05-10', recebiveis, 250);
      expect(gap).toBe(10);
    });

    it('retorna Infinity quando recebiveis nao cobrem', async () => {
      const svc = new CoberturaFornecedorService({});
      const recebiveis = [
        { id: 'r1', valor_liquido: '100', data_disponivel: '2026-05-15' }
      ];
      const gap = await svc._calcGapDias('2026-05-10', recebiveis, 500);
      expect(gap).toBe(Number.POSITIVE_INFINITY);
    });

    it('retorna null quando sem proximo vencimento', async () => {
      const svc = new CoberturaFornecedorService({});
      const gap = await svc._calcGapDias(null, [], 100);
      expect(gap).toBeNull();
    });
  });
});
