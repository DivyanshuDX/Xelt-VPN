import Casper from './casper.ts';

const {
  Deploy,
  DeployHeader,
  ExecutableDeployItem,
  TransferDeployItem,
  PublicKey,
  Timestamp,
  Duration,
} = Casper;
type Deploy = InstanceType<typeof Casper.Deploy>;

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_PAYMENT_MOTES = '100000000'; // 0.1 CSPR gas for a native transfer

/**
 * Build an UNSIGNED native CSPR transfer Deploy.
 * The payer signs it later (wallet). transferId binds the payment to a request.
 */
export function buildTransferDeploy(args: {
  payerHex: string;
  payToHex: string;
  amountMotes: string;
  transferId: string;
  networkName: string;
  paymentMotes?: string;
  ttlMs?: number;
}): Deploy {
  const payer = PublicKey.fromHex(args.payerHex);
  const target = PublicKey.fromHex(args.payToHex);

  const session = new ExecutableDeployItem();
  session.transfer = TransferDeployItem.newTransfer(
    args.amountMotes,
    target,
    undefined,
    args.transferId,
  );

  const payment = ExecutableDeployItem.standardPayment(
    args.paymentMotes ?? DEFAULT_PAYMENT_MOTES,
  );

  const header = new DeployHeader(
    args.networkName,
    [],
    1,
    new Timestamp(new Date()),
    new Duration(args.ttlMs ?? DEFAULT_TTL_MS),
    payer,
  );

  return Deploy.makeDeploy(header, payment, session);
}

/** base64( JSON.stringify( Deploy.toJSON(deploy) ) ). */
export function encodeDeploy(deploy: Deploy): string {
  const json = JSON.stringify(Deploy.toJSON(deploy));
  return Buffer.from(json, 'utf8').toString('base64');
}

export function decodeDeploy(encoded: string): Deploy {
  const json = Buffer.from(encoded, 'base64').toString('utf8');
  return Deploy.fromJSON(JSON.parse(json));
}

/** Extract transfer fields from a Deploy, or null if it is not a transfer. */
export function readTransfer(
  deploy: Deploy,
): { amountMotes: string; targetHex: string; transferId: string } | null {
  if (!deploy.isTransfer()) return null;
  const session = deploy.session;
  const amount = session.getArgByName('amount');
  const target = session.getArgByName('target');
  const id = session.getArgByName('id');
  if (!amount || !target) return null;
  return {
    amountMotes: amount.toString(),
    targetHex: clTargetToHex(target),
    transferId: id ? id.toString() : '',
  };
}

/**
 * The "target" transfer arg is a PublicKey CLValue. Render to hex for comparison.
 * casper-js-sdk CLValue exposes the underlying PublicKey; fall back to toString().
 */
function clTargetToHex(target: unknown): string {
  const anyVal = target as {
    publicKey?: { toHex?: () => string };
    toString: () => string;
  };
  if (anyVal.publicKey?.toHex) return anyVal.publicKey.toHex();
  return anyVal.toString();
}
