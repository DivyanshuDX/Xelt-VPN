import { describe, it, expect } from 'vitest';
import Casper from 'casper-js-sdk';
import { ExactCasperScheme } from '../src/exact/facilitator.ts';
import { buildTransferDeploy, encodeDeploy } from '../src/deploy.ts';
import { CASPER_TESTNET_CAIP2 } from '../src/constants.ts';

const { PrivateKey, KeyAlgorithm } = Casper;

class TestFacilitator extends ExactCasperScheme {
  putCalled = false;
  constructor(private mode: 'ok' | 'putfail') {
    super({ nodeUrl: 'http://unused', networkName: 'casper-test' });
  }
  protected async submitAndConfirm(_signedDeployEncoded: string): Promise<void> {
    this.putCalled = true;
    if (this.mode === 'putfail') throw new Error('put failed');
  }
}

async function payloadAndReq() {
  const payer = await PrivateKey.generate(KeyAlgorithm.ED25519);
  const payTo = (await PrivateKey.generate(KeyAlgorithm.ED25519)).publicKey.toHex();
  const unsigned = buildTransferDeploy({
    payerHex: payer.publicKey.toHex(), payToHex: payTo,
    amountMotes: '2500000000', transferId: '1', networkName: 'casper-test',
  });
  unsigned.sign(payer);
  const payload = {
    x402Version: 2, accepted: {} as never,
    payload: { signedDeploy: encodeDeploy(unsigned), payer: payer.publicKey.toHex(), transferId: '1' },
  };
  const req = {
    scheme: 'exact', network: CASPER_TESTNET_CAIP2, asset: 'CSPR',
    amount: '2500000000', payTo, maxTimeoutSeconds: 120, extra: {},
  };
  return { payload, req };
}

describe('ExactCasperScheme (facilitator) settle', () => {
  it('returns success with the deploy hash', async () => {
    const fac = new TestFacilitator('ok');
    const { payload, req } = await payloadAndReq();
    const res = await fac.settle(payload as never, req as never);
    expect(res.success).toBe(true);
    expect(res.transaction).toMatch(/^[0-9a-f]+$/i);
    expect(fac.putCalled).toBe(true);
  });

  it('returns failure when submit throws', async () => {
    const fac = new TestFacilitator('putfail');
    const { payload, req } = await payloadAndReq();
    const res = await fac.settle(payload as never, req as never);
    expect(res.success).toBe(false);
    expect(res.errorReason).toBeDefined();
  });
});
