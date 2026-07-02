import { describe, it, expect } from 'vitest';
import Casper from 'casper-js-sdk';
import { ExactCasperScheme } from '../src/exact/client.ts';
import { decodeDeploy } from '../src/deploy.ts';
import { CASPER_TESTNET_CAIP2 } from '../src/constants.ts';
import type { ClientCasperSigner } from '../src/signer.ts';

const { PrivateKey, KeyAlgorithm, Deploy } = Casper;

async function fakeSigner(): Promise<ClientCasperSigner> {
  const priv = await PrivateKey.generate(KeyAlgorithm.ED25519);
  const pubHex = priv.publicKey.toHex();
  return {
    publicKeyHex: pubHex,
    async signDeployJson(deployJson) {
      const deploy = Deploy.fromJSON(JSON.parse(deployJson));
      deploy.sign(priv);
      // Return the signature hex the wallet would produce (algorithm-tagged).
      return deploy.approvals[0].signature.toHex();
    },
  };
}

/**
 * Simulates a real wallet (e.g. Casper Wallet) that returns the RAW, untagged
 * signature hex — for a secp256k1 account. Reproduces the production bug where
 * Deploy.setSignature needs the algorithm-tagged signature.
 */
async function rawSecp256k1Signer(): Promise<ClientCasperSigner> {
  const priv = await PrivateKey.generate(KeyAlgorithm.SECP256K1);
  const pubHex = priv.publicKey.toHex();
  return {
    publicKeyHex: pubHex,
    async signDeployJson(deployJson) {
      const deploy = Deploy.fromJSON(JSON.parse(deployJson));
      deploy.sign(priv);
      // Strip the 1-byte algorithm tag to mimic a wallet returning raw 64 bytes.
      return deploy.approvals[0].signature.toHex().slice(2);
    },
  };
}

describe('ExactCasperScheme (client)', () => {
  it('accepts a raw (untagged) secp256k1 wallet signature', async () => {
    const signer = await rawSecp256k1Signer();
    const scheme = new ExactCasperScheme(signer);
    const payTo = (await PrivateKey.generate(KeyAlgorithm.SECP256K1)).publicKey.toHex();
    const req = {
      scheme: 'exact', network: CASPER_TESTNET_CAIP2, asset: 'CSPR',
      amount: '2500000000', payTo, maxTimeoutSeconds: 120, extra: {},
    };
    const result = await scheme.createPaymentPayload(2, req);
    const payload = result.payload as { signedDeploy: string };
    // decodeDeploy runs Deploy.fromJSON which validates signatures — must not throw.
    expect(decodeDeploy(payload.signedDeploy).validate()).toBe(true);
  });

  it('creates a signed transfer payload that decodes and validates', async () => {
    const signer = await fakeSigner();
    const scheme = new ExactCasperScheme(signer);
    const payTo = (await PrivateKey.generate(KeyAlgorithm.ED25519)).publicKey.toHex();
    const req = {
      scheme: 'exact', network: CASPER_TESTNET_CAIP2, asset: 'CSPR',
      amount: '2500000000', payTo, maxTimeoutSeconds: 120, extra: {},
    };
    const result = await scheme.createPaymentPayload(2, req);
    expect(result.x402Version).toBe(2);
    const payload = result.payload as { signedDeploy: string; payer: string; transferId: string };
    expect(payload.payer).toBe(signer.publicKeyHex);
    const deploy = decodeDeploy(payload.signedDeploy);
    expect(deploy.validate()).toBe(true);
  });
});
