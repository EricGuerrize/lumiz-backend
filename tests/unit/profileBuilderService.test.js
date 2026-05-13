jest.mock('../../src/db/supabase', () => ({}));
jest.mock('../../src/services/mdrService', () => ({ getLatestConfig: jest.fn() }));
jest.mock('../../src/services/sazonalidadeService', () => ({ getSazonalidade: jest.fn() }));
jest.mock('../../src/services/clientePerfilService', () => ({ getPerfilPagamento: jest.fn() }));
jest.mock('../../src/services/agentic/clinicProfileService', () => ({}));
jest.mock('../../src/services/agentic/learnedFactsService', () => ({}));

const { _helpers } = require('../../src/services/agentic/profileBuilderService');

describe('profileBuilderService helpers', () => {
  it('calcula payment mix observado', () => {
    const mix = _helpers.buildPaymentMix([
      { forma_pagamento: 'pix' },
      { forma_pagamento: 'parcelado' },
      { forma_pagamento: 'parcelado' },
      { forma_pagamento: 'debito' }
    ]);

    expect(mix).toEqual({
      pix: 0.25,
      credit_full: 0,
      credit_installment: 0.5,
      debit: 0.25,
      cash: 0
    });
  });

  it('normaliza sazonalidade pela media de receita', () => {
    const observed = _helpers.normalizeSeasonality([
      { mes: '2026-01', receita: 70 },
      { mes: '2026-02', receita: 130 }
    ]);

    expect(observed).toEqual({
      jan: 0.7,
      fev: 1.3
    });
  });

  it('infere custos recorrentes por mes e dia dominante', () => {
    const recurring = _helpers.inferRecurringCosts([
      {
        id: 'c1',
        descricao: 'Aluguel - Sala',
        categoria: 'Estrutura',
        valor: 8000,
        data_vencimento: '2026-03-05'
      },
      {
        id: 'c2',
        descricao: 'Aluguel - Sala',
        categoria: 'Estrutura',
        valor: 8200,
        data_vencimento: '2026-04-05'
      },
      {
        id: 'c3',
        descricao: 'Fornecedor avulso',
        categoria: 'Insumos',
        valor: 500,
        data_vencimento: '2026-04-12'
      }
    ]);

    expect(recurring).toHaveLength(1);
    expect(recurring[0]).toMatchObject({
      vendor: 'Aluguel - Sala',
      frequency: 'monthly',
      payment_pattern: 'mensal_dia_5',
      category: 'Estrutura'
    });
    expect(recurring[0].amount_avg).toBe(8100);
    expect(recurring[0].supporting_records).toEqual(['c1', 'c2']);
  });

  it('deriva learned facts a partir dos patterns mais fortes', () => {
    const facts = _helpers.deriveLearnedFacts(
      {
        recurring_costs: [
          {
            vendor: 'Biogelis',
            payment_pattern: 'mensal_dia_18',
            supporting_records: ['cp1', 'cp2']
          }
        ],
        seasonality_observed: { set: 1.3, out: 1.1 },
        top_procedures_3m: [
          { procedure: 'Full Face', revenue_share: 0.42 }
        ]
      },
      'NB Clinic'
    );

    expect(facts).toHaveLength(3);
    expect(facts[0].fact).toContain('Biogelis');
    expect(facts[1].fact).toContain('set');
    expect(facts[2].fact).toContain('Full Face');
  });
});
