import type {
  SchemeNetworkClient, PaymentRequirements, PaymentPayloadResult, PaymentPayloadContext,
} from '@x402/core/types';
import Casper from '../casper.ts';
import type { ClientCasperSigner } from '../signer.ts';
import { CASPER_NETWORK_NAME } from '../constants.ts';
import { buildTransferDeploy, encodeDeploy } from '../deploy.ts';

const { PublicKey, Deploy } = Casper;

export class ExactCasperScheme implements SchemeNetworkClient {
  readonly scheme = 'exact';

  constructor(private readonly signer: ClientCasperSigner) {}

  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
    _context?: PaymentPayloadContext,
  ): Promise<PaymentPayloadResult> {
    const transferId = String(Date.now());
    const networkName = networkNameFromCaip2(paymentRequirements.network) ?? CASPER_NETWORK_NAME;

    const unsigned = buildTransferDeploy({
      payerHex: this.signer.publicKeyHex,
      payToHex: paymentRequirements.payTo,
      amountMotes: paymentRequirements.amount,
      transferId,
      networkName,
    });

    const deployJson = JSON.stringify(Deploy.toJSON(unsigned));
    const signatureHex = await this.signer.signDeployJson(deployJson, this.signer.publicKeyHex);

    const publicKey = PublicKey.fromHex(this.signer.publicKeyHex);
    const taggedSig = tagSignature(signatureHex, this.signer.publicKeyHex);
    const signed = Deploy.setSignature(unsigned, taggedSig, publicKey);

    return {
      x402Version,
      payload: {
        signedDeploy: encodeDeploy(signed),
        payer: this.signer.publicKeyHex,
        transferId,
      },
    };
  }
}

function networkNameFromCaip2(network: string): string | null {
  const parts = network.split(':');
  return parts.length === 2 ? parts[1] : null;
}

/**
 * `Deploy.setSignature` expects the signature prefixed with the 1-byte algorithm
 * tag (01 = ed25519, 02 = secp256k1), matching the public key's tag. Wallets
 * typically return the raw (untagged) 64-byte signature, so normalize: strip any
 * existing tag, then prepend the tag taken from the payer's public key.
 */
function tagSignature(signatureHex: string, publicKeyHex: string): Uint8Array {
  const algTag = parseInt(publicKeyHex.slice(0, 2), 16);
  let bytes = hexToBytes(signatureHex);
  if (bytes.length === 65) bytes = bytes.slice(1); // drop an existing tag byte
  if (bytes.length !== 64) return bytes; // unexpected shape — let setSignature surface it
  const tagged = new Uint8Array(65);
  tagged[0] = algTag;
  tagged.set(bytes, 1);
  return tagged;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
