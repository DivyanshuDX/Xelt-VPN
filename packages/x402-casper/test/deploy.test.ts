import { describe, it, expect } from 'vitest';
import Casper from 'casper-js-sdk';
import { buildTransferDeploy, encodeDeploy, decodeDeploy, readTransfer } from '../src/deploy.ts';

const { PrivateKey, KeyAlgorithm } = Casper;

describe('transfer deploy helpers', () => {
  it('builds, encodes, decodes and reads a native transfer', async () => {
    const payer = await PrivateKey.generate(KeyAlgorithm.ED25519);
    const payTo = (await PrivateKey.generate(KeyAlgorithm.ED25519)).publicKey.toHex();

    const deploy = buildTransferDeploy({
      payerHex: payer.publicKey.toHex(),
      payToHex: payTo,
      amountMotes: '2500000000',
      transferId: '12345',
      networkName: 'casper-test',
    });
    expect(deploy.isTransfer()).toBe(true);

    const encoded = encodeDeploy(deploy);
    expect(typeof encoded).toBe('string');

    const decoded = decodeDeploy(encoded);
    const read = readTransfer(decoded);
    expect(read).not.toBeNull();
    expect(read!.amountMotes).toBe('2500000000');
    expect(read!.transferId).toBe('12345');
    expect(read!.targetHex.toLowerCase()).toBe(payTo.toLowerCase());
  });

  it('returns null for non-transfer deploys', () => {
    expect(readTransfer({ isTransfer: () => false } as never)).toBeNull();
  });
});
