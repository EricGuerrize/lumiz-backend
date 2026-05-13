const {
  computeGhostSummary,
  buildForwardSummary
} = require('../../src/services/trialAccountService');

describe('trialAccountService helpers', () => {
  test('computeGhostSummary aggregates onboarding ghost ledger correctly', () => {
    const result = computeGhostSummary({
      sales: [
        { amount: 3200 },
        { amount: 1800 }
      ],
      costs: [
        { amount: 900, type: 'fixa' },
        { amount: 650, type: 'variavel' }
      ]
    });

    expect(result).toEqual({
      entradas: 5000,
      custosFixos: 900,
      custosVariaveis: 650,
      saldoParcial: 3450
    });
  });

  test('buildForwardSummary creates forwardable text for decision maker', () => {
    const message = buildForwardSummary({
      clinicName: 'NB Clinic',
      testedByName: 'Marina',
      snapshot: {
        sales: [
          {
            amount: 4800,
            description: 'Full face'
          }
        ],
        costs: [
          {
            amount: 16579.65,
            type: 'variavel',
            category: 'Insumos',
            installments: 3
          }
        ]
      }
    });

    expect(message).toContain('NB Clinic');
    expect(message).toContain('Regist');
    expect(message).toContain('R$ 4.800,00');
    expect(message).toContain('R$ 16.579,65');
    expect(message).toContain('saldo');
  });
});
