const {
  sanitizeClientName,
  containsProcedureKeyword
} = require('../../src/utils/procedureKeywords');

describe('procedureKeywords', () => {
  it('detects known procedure terms', () => {
    expect(containsProcedureKeyword('botox')).toBe(true);
    expect(containsProcedureKeyword('preenchimento labial')).toBe(true);
    expect(containsProcedureKeyword('Maria')).toBe(false);
  });

  it('rejects procedure as client name', () => {
    expect(sanitizeClientName('Botox', 'Botox')).toBeNull();
    expect(sanitizeClientName('preenchimento', 'Preenchimento')).toBeNull();
  });

  it('keeps valid person name', () => {
    expect(sanitizeClientName('Maria Silva', 'Botox')).toBe('Maria Silva');
  });
});
