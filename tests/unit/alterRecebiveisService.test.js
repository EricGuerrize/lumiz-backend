const { AlterRecebiveisService, _helpers, AGING_BUCKETS } = require('../../src/services/alter/alterRecebiveisService');

// Mock Supabase to skip DB
jest.mock('../../src/db/supabase', () => {
  const chain = {
    _data: [],
    select() { return this; },
    eq() { return this; },
    gte() { return this; },
    lte() { return this; },
    order() { return Promise.resolve({ data: this._data, error: null }); }
  };
  return { from() { return chain; }, _setData(data) { chain._data = data; } };
});

const supabaseMock = require('../../src/db/supabase');

describe('alterRecebiveisService', () => {
  describe('_bucketFor', () => {
    it('classifica corretamente os buckets de aging', () => {
      expect(_helpers._bucketFor(-5)).toBe('vencido');
      expect(_helpers._bucketFor(0)).toBe('hoje');
      expect(_helpers._bucketFor(3)).toBe('d1_d7');
      expect(_helpers._bucketFor(15)).toBe('d8_d30');
      expect(_helpers._bucketFor(45)).toBe('d31_d60');
      expect(_helpers._bucketFor(75)).toBe('d61_d90');
      expect(_helpers._bucketFor(180)).toBe('d90_mais');
    });
  });

  describe('AGING_BUCKETS', () => {
    it('expoe 7 buckets (vencido, hoje, d1_d7, d8_d30, d31_d60, d61_d90, d90_mais)', () => {
      expect(AGING_BUCKETS.map((b) => b.id)).toEqual([
        'vencido', 'hoje', 'd1_d7', 'd8_d30', 'd31_d60', 'd61_d90', 'd90_mais'
      ]);
    });
  });

  describe('getPosicao', () => {
    it('agrega valores por status corretamente', async () => {
      const adapter = { syncFromParcelas: jest.fn().mockResolvedValue({ synced: 0 }) };
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dataLivre = today.toISOString().split('T')[0];
      supabaseMock._setData([
        { id: 'r1', valor_liquido: '100', valor_bruto: '102', mdr: '0.02', status: 'livre', data_disponivel: dataLivre },
        { id: 'r2', valor_liquido: '200', valor_bruto: '204', mdr: '0.02', status: 'livre', data_disponivel: dataLivre },
        { id: 'r3', valor_liquido: '50', valor_bruto: '50', mdr: '0', status: 'comprometido', data_disponivel: dataLivre },
        { id: 'r4', valor_liquido: '70', valor_bruto: '72', mdr: '0.0277', status: 'antecipado', data_disponivel: dataLivre }
      ]);
      const svc = new AlterRecebiveisService(adapter);
      const pos = await svc.getPosicao('user1');
      expect(pos.livre.valor).toBe(300);
      expect(pos.livre.count).toBe(2);
      expect(pos.comprometido.valor).toBe(50);
      expect(pos.antecipado.valor).toBe(70);
      expect(pos.total_geral).toBe(420);
    });
  });

  describe('getMix', () => {
    it('soma e calcula pct por adquirente e parcelas', async () => {
      const adapter = { syncFromParcelas: jest.fn().mockResolvedValue({ synced: 0 }) };
      supabaseMock._setData([
        { id: 'r1', valor_liquido: '100', valor_bruto: '102', adquirente: 'Stone', parcelas_total: 1, status: 'livre' },
        { id: 'r2', valor_liquido: '200', valor_bruto: '204', adquirente: 'Stone', parcelas_total: 3, status: 'livre' },
        { id: 'r3', valor_liquido: '300', valor_bruto: '309', adquirente: 'Cielo', parcelas_total: 3, status: 'livre' }
      ]);
      const svc = new AlterRecebiveisService(adapter);
      const mix = await svc.getMix('user1');
      expect(mix.total).toBe(600);
      const stone = mix.por_adquirente.find((x) => x.adquirente === 'Stone');
      expect(stone.valor).toBe(300);
      expect(stone.pct).toBe(50);
      const tresVezes = mix.por_parcelas.find((x) => x.parcelas === 3);
      expect(tresVezes.valor).toBe(500);
    });
  });
});
