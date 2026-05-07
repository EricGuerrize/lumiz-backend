const { AntecipacaoService } = require('../../src/services/alter/antecipacaoService');

describe('antecipacaoService', () => {
  describe('simular', () => {
    it('delega ao adapter e arredonda saídas', async () => {
      const adapter = {
        simulateAntecipacaoSpot: jest.fn().mockResolvedValue({
          valor_solicitado: 1000.123,
          valor_liquido_recebido: 980.456,
          custo_antecipacao: 19.667,
          taxa_efetiva_pct: 0.019668,
          recebiveis_ids: ['r1'],
          status: 'simulada',
          cobre_alvo: false,
          gap_versus_alvo: 19.667
        })
      };
      const svc = new AntecipacaoService(adapter);
      const out = await svc.simular('u1', { valor_alvo: 1000, horizonte_dias: 30 });
      expect(out.valor_solicitado).toBe(1000.12);
      expect(out.valor_liquido_recebido).toBe(980.46);
      expect(out.custo_antecipacao).toBe(19.67);
      expect(out.taxa_efetiva_pct).toBe(0.0197);
      expect(out.recebiveis_ids).toEqual(['r1']);
      expect(out.status).toBe('simulada');
    });

    it('valor_alvo zero produz resposta vazia', async () => {
      const adapter = {
        simulateAntecipacaoSpot: jest.fn().mockResolvedValue({
          valor_solicitado: 0,
          valor_liquido_recebido: 0,
          custo_antecipacao: 0,
          taxa_efetiva_pct: 0,
          recebiveis_ids: [],
          status: 'simulada'
        })
      };
      const svc = new AntecipacaoService(adapter);
      const out = await svc.simular('u1', { valor_alvo: 0 });
      expect(out.valor_solicitado).toBe(0);
      expect(out.recebiveis_ids).toEqual([]);
    });
  });
});
