import { describe, it, expect } from 'vitest';
import { csprToMotes, motesToCspr, CASPER_TESTNET_CAIP2, CSPR_ASSET } from '../src/constants.ts';

describe('mote helpers', () => {
  it('converts whole CSPR to motes', () => {
    expect(csprToMotes(1)).toBe('1000000000');
  });
  it('converts fractional CSPR to motes without float drift', () => {
    expect(csprToMotes(2.5)).toBe('2500000000');
    expect(csprToMotes(0.1)).toBe('100000000');
  });
  it('round-trips motes back to CSPR', () => {
    expect(motesToCspr('2500000000')).toBe(2.5);
  });
  it('exposes constants', () => {
    expect(CASPER_TESTNET_CAIP2).toBe('casper:casper-test');
    expect(CSPR_ASSET).toBe('CSPR');
  });
});
