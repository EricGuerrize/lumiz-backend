const { PagarComRecebivelService } = require('../../src/services/alter/pagarComRecebivelService');

describe('pagarComRecebivelService.sugerir', () => {
  it('cobre sem antecipação quando recebíveis livres bastam', async () => {
    const svc = new PagarComRecebivelService(
      {
        list: jest.fn().mockResolvedValue([
          { id: 'r1', valor_liquido: 600, status: 'livre', data_disponivel: '2026-05-15' },
          { id: 'r2', valor_liquido: 500, status: 'livre', data_disponivel: '2026-05-20' }
        ])
      },
      { simular: jest.fn() }
    );
    svc._loadContasFromOptions = jest.fn().mockResolvedValue([
      { id: 'c1', valor: 1000, data_vencimento: '2026-05-25', fornecedor_id: 'f1' }
    ]);

    const res = await svc.sugerir('u1', { conta_pagar_id: 'c1' });
    expect(res.cobertura.cobre_sem_antecipacao).toBe(true);
    expect(res.cobertura.gap).toBe(0);
    expect(res.cobertura.antecipacao_sugerida).toBeNull();
    expect(res.cobertura.recebiveis_livres_ids).toEqual(['r1', 'r2']);
  });

  it('sugere antecipação quando recebíveis livres não bastam', async () => {
    const simularStub = jest.fn().mockResolvedValue({
      valor_solicitado: 400,
      valor_liquido_recebido: 392,
      custo_antecipacao: 8,
      taxa_efetiva_pct: 0.02,
      recebiveis_ids: ['r3'],
      status: 'simulada'
    });
    const svc = new PagarComRecebivelService(
      {
        list: jest.fn().mockResolvedValue([
          { id: 'r1', valor_liquido: 600, status: 'livre', data_disponivel: '2026-05-15' }
        ])
      },
      { simular: simularStub }
    );
    svc._loadContasFromOptions = jest.fn().mockResolvedValue([
      { id: 'c1', valor: 1000, data_vencimento: '2026-05-25', fornecedor_id: 'f1' }
    ]);

    const res = await svc.sugerir('u1', { conta_pagar_id: 'c1' });
    expect(res.cobertura.cobre_sem_antecipacao).toBe(false);
    expect(res.cobertura.gap).toBe(400);
    expect(res.cobertura.antecipacao_sugerida).toBeTruthy();
    expect(simularStub).toHaveBeenCalledWith('u1', { valor_alvo: 400, horizonte_dias: 30 });
  });

  it('retorna meta is_empty quando sem contas', async () => {
    const svc = new PagarComRecebivelService({ list: jest.fn() }, { simular: jest.fn() });
    svc._loadContasFromOptions = jest.fn().mockResolvedValue([]);
    const res = await svc.sugerir('u1', { conta_pagar_id: 'c1' });
    expect(res.meta.is_empty).toBe(true);
    expect(res.cobertura).toBeNull();
  });
});
