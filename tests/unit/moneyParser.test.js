const {
  extractInstallments,
  extractPrimaryMonetaryValue,
  recoverValueWithInstallmentsContext
} = require('../../src/utils/moneyParser');

describe('moneyParser', () => {
  it('extracts amount and installments from "botox 2000 3x"', () => {
    expect(extractInstallments('botox 2000 3x')).toBe(3);
    expect(extractPrimaryMonetaryValue('botox 2000 3x')).toBe(2000);
  });

  it('extracts amount and installments from "botox r$ 2.000 3x"', () => {
    expect(extractInstallments('botox r$ 2.000 3x')).toBe(3);
    expect(extractPrimaryMonetaryValue('botox r$ 2.000 3x')).toBe(2000);
  });

  it('extracts amount and installments from "vendi 1500 em 10x mastercard"', () => {
    expect(extractInstallments('vendi 1500 em 10x mastercard')).toBe(10);
    expect(extractPrimaryMonetaryValue('vendi 1500 em 10x mastercard')).toBe(1500);
  });

  it('does not treat installments as money when value is missing', () => {
    expect(extractInstallments('botox 3x')).toBe(3);
    expect(extractPrimaryMonetaryValue('botox 3x')).toBeNull();
  });

  it('ignores date-like numbers and keeps primary monetary value', () => {
    expect(extractPrimaryMonetaryValue('botox 2000 dia 15')).toBe(2000);
    expect(extractPrimaryMonetaryValue('botox 2000 15/02')).toBe(2000);
  });

  it('keeps isolated value extraction behavior', () => {
    expect(extractPrimaryMonetaryValue('2800')).toBe(2800);
    expect(extractPrimaryMonetaryValue('insumos 3200')).toBe(3200);
  });

  it('recovers value when parsed value is incorrectly taken from installments', () => {
    expect(recoverValueWithInstallmentsContext('botox 2000 3x', 3, 3)).toBe(2000);
  });
});
