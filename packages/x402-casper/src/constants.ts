import type { Network } from '@x402/core/types';

export const CASPER_NETWORK_NAME = 'casper-test';
export const CASPER_TESTNET_CAIP2 = 'casper:casper-test' as Network;
export const CSPR_ASSET = 'CSPR';
export const CSPR_DECIMALS = 9;

const MOTES_PER_CSPR = 1_000_000_000n;

/** Convert a decimal CSPR amount to an integer motes string (no float drift). */
export function csprToMotes(cspr: number): string {
  if (!Number.isFinite(cspr) || cspr < 0) {
    throw new Error(`invalid CSPR amount: ${cspr}`);
  }
  // Work in fixed-point: 9 decimals.
  const [whole, fraction = ''] = cspr.toString().split('.');
  const fracPadded = (fraction + '0'.repeat(CSPR_DECIMALS)).slice(0, CSPR_DECIMALS);
  const motes = BigInt(whole) * MOTES_PER_CSPR + BigInt(fracPadded || '0');
  return motes.toString();
}

export function motesToCspr(motes: string): number {
  return Number(BigInt(motes)) / Number(MOTES_PER_CSPR);
}
