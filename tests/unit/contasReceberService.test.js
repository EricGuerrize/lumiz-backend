/**
 * Testes unitários focados em helpers puros do contasReceberService.
 * Foco em _bucketFor (aging) — comportamento determinístico, sem Supabase.
 */

process.env.NODE_ENV = 'test';

const { _helpers, AGING_BUCKETS } = require('../../src/services/contasReceberService');

describe('ContasReceberService — aging buckets', () => {
  it('expõe os 7 buckets esperados', () => {
    expect(AGING_BUCKETS.map((b) => b.id)).toEqual([
      'vencidas', 'hoje', '1_7', '8_30', '31_60', '61_90', '90_mais'
    ]);
  });

  it('-5 dias cai em "vencidas"', () => {
    expect(_helpers._bucketFor(-5)).toBe('vencidas');
  });

  it('0 dias cai em "hoje"', () => {
    expect(_helpers._bucketFor(0)).toBe('hoje');
  });

  it('3 dias cai em 1-7', () => {
    expect(_helpers._bucketFor(3)).toBe('1_7');
  });

  it('15 dias cai em 8-30', () => {
    expect(_helpers._bucketFor(15)).toBe('8_30');
  });

  it('45 dias cai em 31-60', () => {
    expect(_helpers._bucketFor(45)).toBe('31_60');
  });

  it('75 dias cai em 61-90', () => {
    expect(_helpers._bucketFor(75)).toBe('61_90');
  });

  it('100 dias cai em 90+', () => {
    expect(_helpers._bucketFor(100)).toBe('90_mais');
  });

  it('1000 dias cai em 90+', () => {
    expect(_helpers._bucketFor(1000)).toBe('90_mais');
  });
});
