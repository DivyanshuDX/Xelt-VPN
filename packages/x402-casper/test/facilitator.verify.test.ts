import { describe, it, expect } from 'vitest';
import Casper from 'casper-js-sdk';
import { ExactCasperScheme } from '../src/exact/facilitator.ts';
import { buildTransferDeploy, encodeDeploy } from '../src/deploy.ts';
import { CASPER_TESTNET_CAIP2 } from '../src/constants.ts';

const { PrivateKey, KeyAlgorithm } = Casper;

async function signedPayload(amountMotes: string, payToHex: string) {
  const payer = await PrivateKey.generate(KeyAlgorithm.ED25519);
  const unsigned = buildTransferDeploy({
    payerHex: payer.publicKey.toHex(),
    payToHex,
    amountMotes,
    transferId: '1',
    networkName: 'casper-test',
  });
  unsigned.sign(payer);
  return {
    x402Version: 2,
    accepted: {} as never,
    payload: { signedDeploy: encodeDeploy(unsigned), payer: payer.publicKey.toHex(), transferId: '1' },
  };
}

function reqFor(amountMotes: string, payToHex: string) {
  return {
    scheme: 'exact', network: CASPER_TESTNET_CAIP2, asset: 'CSPR',
    amount: amountMotes, payTo: payToHex, maxTimeoutSeconds: 120, extra: {},
  };
}

describe('ExactCasperScheme (facilitator) verify', () => {
  const fac = new ExactCasperScheme({ nodeUrl: 'http://unused', networkName: 'casper-test' });

  it('accepts a correct signed transfer', async () => {
    const payTo = (await PrivateKey.generate(KeyAlgorithm.ED25519)).publicKey.toHex();
    const payload = await signedPayload('2500000000', payTo);
    const res = await fac.verify(payload as never, reqFor('2500000000', payTo) as never);
    expect(res.isValid).toBe(true);
    expect(res.payer).toBe((payload.payload as { payer: string }).payer);
  });

  it('rejects amount mismatch', async () => {
    const payTo = (await PrivateKey.generate(KeyAlgorithm.ED25519)).publicKey.toHex();
    const payload = await signedPayload('2500000000', payTo);
    const res = await fac.verify(payload as never, reqFor('9900000000', payTo) as never);
    expect(res.isValid).toBe(false);
    expect(res.invalidReason).toContain('amount');
  });

  it('rejects receiver mismatch', async () => {
    const payTo = (await PrivateKey.generate(KeyAlgorithm.ED25519)).publicKey.toHex();
    const other = (await PrivateKey.generate(KeyAlgorithm.ED25519)).publicKey.toHex();
    const payload = await signedPayload('2500000000', payTo);
    const res = await fac.verify(payload as never, reqFor('2500000000', other) as never);
    expect(res.isValid).toBe(false);
    expect(res.invalidReason).toContain('receiver');
  });

  it('exposes no signers and no extra', () => {
    expect(fac.getSigners('casper-test')).toEqual([]);
    expect(fac.getExtra('casper-test')).toBeUndefined();
  });
});
