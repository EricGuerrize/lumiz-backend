/**
 * Multi-opção CONTEXT_WHY / CONTEXT_HOW (Parte I UX).
 */

const { resolveMultiChoiceMotivation } = require('../../src/services/onboarding/contextHandlers');

describe('resolveMultiChoiceMotivation', () => {
  const map = { 1: 'A', 2: 'B', 3: 'C' };

  it('aceita "todos"', () => {
    expect(resolveMultiChoiceMotivation('todos', map)).toBe('A | B | C');
  });

  it('aceita combinação com "e"', () => {
    expect(resolveMultiChoiceMotivation('1 e 2', map)).toBe('A | B');
  });

  it('aceita dígito único', () => {
    expect(resolveMultiChoiceMotivation('2', map)).toBe('B');
  });

  it('não interpreta "10" como opções 1 e 0', () => {
    expect(resolveMultiChoiceMotivation('10', map)).toBeNull();
  });
});
