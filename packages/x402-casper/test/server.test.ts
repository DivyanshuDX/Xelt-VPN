import { describe, it, expect } from 'vitest';
import { ExactCasperScheme } from '../src/exact/server.ts';
import { CASPER_TESTNET_CAIP2 } from '../src/constants.ts';

const server = new ExactCasperScheme();

describe('ExactCasperScheme (server)', () => {
  it('parses a numeric CSPR price to motes', async () => {
    const a = await server.parsePrice(2.5, CASPER_TESTNET_CAIP2);
    expect(a).toEqual({ asset: 'CSPR', amount: '2500000000' });
  });
  it('parses a "N CSPR" string', async () => {
    const a = await server.parsePrice('0.1 CSPR', CASPER_TESTNET_CAIP2);
    expect(a).toEqual({ asset: 'CSPR', amount: '100000000' });
  });
  it('passes through an AssetAmount', async () => {
    const a = await server.parsePrice({ asset: 'CSPR', amount: '5' }, CASPER_TESTNET_CAIP2);
    expect(a).toEqual({ asset: 'CSPR', amount: '5' });
  });
  it('reports 9 decimals', () => {
    expect(server.getAssetDecimals('CSPR', CASPER_TESTNET_CAIP2)).toBe(9);
  });
  it('enhancePaymentRequirements keeps CSPR asset and amount', async () => {
    const req = {
      scheme: 'exact', network: CASPER_TESTNET_CAIP2, asset: 'CSPR',
      amount: '2500000000', payTo: '01abc', maxTimeoutSeconds: 120, extra: {},
    };
    const out = await server.enhancePaymentRequirements(req, {
      x402Version: 2, scheme: 'exact', network: CASPER_TESTNET_CAIP2,
    }, []);
    expect(out.asset).toBe('CSPR');
    expect(out.amount).toBe('2500000000');
  });
});
