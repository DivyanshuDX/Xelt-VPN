import type {
  SchemeNetworkFacilitator, PaymentPayload, PaymentRequirements,
  VerifyResponse, SettleResponse,
} from '@x402/core/types';
import Casper from '../casper.ts';
import type { CasperRpcConfig } from '../signer.ts';
import { decodeDeploy, readTransfer } from '../deploy.ts';
import * as E from './errors.ts';

const { RpcClient, HttpHandler, PublicKey, PurseIdentifier } = Casper;
type RpcClient = InstanceType<typeof Casper.RpcClient>;
type Deploy = InstanceType<typeof Casper.Deploy>;

export class ExactCasperScheme implements SchemeNetworkFacilitator {
  readonly scheme = 'exact';
  readonly caipFamily = 'casper:*';
  private readonly settled = new Set<string>();
  protected readonly rpc: RpcClient;

  constructor(protected readonly config: CasperRpcConfig) {
    this.rpc = new RpcClient(new HttpHandler(config.nodeUrl, 'fetch'));
  }

  getExtra(_network: string): Record<string, unknown> | undefined {
    return undefined;
  }

  getSigners(_network: string): string[] {
    return [];
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const fail = (reason: string, message: string): VerifyResponse => {
      console.error(`[casper-facilitator] verify FAILED: ${reason} — ${message}`);
      return { isValid: false, invalidReason: reason, invalidMessage: message };
    };

    if (payload.x402Version !== 2) return fail(E.ErrInvalidVersion, 'unsupported x402 version');
    if (!requirements.network.startsWith('casper:')) {
      return fail(E.ErrNetworkMismatch, 'network is not a casper network');
    }

    const p = payload.payload as { signedDeploy?: string; payer?: string };
    if (!p?.signedDeploy || !p?.payer) return fail(E.ErrInvalidPayload, 'missing signedDeploy/payer');

    let deploy: Deploy;
    try {
      deploy = decodeDeploy(p.signedDeploy);
    } catch (err) {
      return fail(E.ErrInvalidDeploy, `cannot decode deploy: ${String(err)}`);
    }

    try {
      if (!deploy.validate()) return fail(E.ErrInvalidSignature, 'deploy signature invalid');
    } catch (err) {
      return fail(E.ErrInvalidSignature, `deploy validation threw: ${String(err)}`);
    }

    const transfer = readTransfer(deploy);
    if (!transfer) return fail(E.ErrNotTransfer, 'deploy is not a native transfer');

    const wantChain = requirements.network.split(':')[1];
    if (deploy.header.chainName !== wantChain) {
      return fail(E.ErrChainMismatch, `chain ${deploy.header.chainName} != ${wantChain}`);
    }

    if (isExpired(deploy)) return fail(E.ErrExpired, 'deploy TTL expired');

    if (transfer.targetHex.toLowerCase() !== requirements.payTo.toLowerCase()) {
      return fail(E.ErrReceiverMismatch, 'transfer receiver does not match payTo');
    }
    if (transfer.amountMotes !== requirements.amount) {
      return fail(E.ErrAmountMismatch, `amount ${transfer.amountMotes} != ${requirements.amount}`);
    }

    const deployHash = deploy.hash.toHex();
    if (this.settled.has(deployHash)) return fail(E.ErrReplay, 'deploy already settled');

    if (this.config.verifyBalance) {
      const ok = await this.hasSufficientBalance(p.payer, requirements.amount);
      if (!ok) return fail(E.ErrInsufficientBalance, 'payer balance too low');
    }

    return { isValid: true, payer: p.payer };
  }

  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const network = requirements.network;
    const p = payload.payload as { signedDeploy: string; payer: string };

    // Re-verify before settling.
    const verification = await this.verify(payload, requirements);
    if (!verification.isValid) {
      return {
        success: false, transaction: '', network,
        errorReason: verification.invalidReason, errorMessage: verification.invalidMessage,
        payer: p.payer,
      };
    }

    const deploy = decodeDeploy(p.signedDeploy);
    const deployHash = deploy.hash.toHex();

    try {
      console.log(`[casper-facilitator] settling deploy ${deployHash} (payer ${p.payer})`);
      await this.submitAndConfirm(p.signedDeploy);
      this.markSettled(deployHash);
      console.log(`[casper-facilitator] settle OK: ${deployHash}`);
      return { success: true, transaction: deployHash, network, payer: p.payer };
    } catch (err) {
      console.error(`[casper-facilitator] settle FAILED for ${deployHash}: ${String(err)}`);
      return {
        success: false, transaction: deployHash, network,
        errorReason: E.ErrSettleFailed, errorMessage: String(err), payer: p.payer,
      };
    }
  }

  /** Submit the signed deploy and wait for successful execution. Overridable in tests. */
  protected async submitAndConfirm(signedDeployEncoded: string): Promise<void> {
    const deploy = decodeDeploy(signedDeployEncoded);
    const put = await this.rpc.putDeploy(deploy);
    const hash = put.deployHash.toHex();
    await this.waitForSuccess(hash);
  }

  private async waitForSuccess(deployHash: string, timeoutMs = 120_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const result = await this.rpc.getDeploy(deployHash);
        const outcome = readExecutionOutcome(result);
        if (outcome === 'success') return;
        if (outcome === 'failure') throw new Error('deploy execution failed on-chain');
      } catch (err) {
        // "deploy not found yet" — keep polling until timeout.
        if (String(err).includes('execution failed')) throw err;
      }
      await sleep(2000);
    }
    throw new Error(E.ErrConfirmationFailed);
  }

  protected markSettled(deployHash: string): void {
    this.settled.add(deployHash);
  }

  protected async hasSufficientBalance(payerHex: string, amountMotes: string): Promise<boolean> {
    try {
      const id = PurseIdentifier.fromPublicKey(PublicKey.fromHex(payerHex));
      const res = await this.rpc.queryLatestBalance(id);
      const balance = BigInt(res.balance.toString());
      return balance >= BigInt(amountMotes);
    } catch {
      // If balance can't be read, do not block verification.
      return true;
    }
  }
}

function isExpired(deploy: Deploy): boolean {
  const ts = deploy.header.timestamp?.date?.getTime?.();
  const ttl = deploy.header.ttl?.duration ?? 30 * 60 * 1000;
  if (ts == null) return false;
  return Date.now() > ts + ttl;
}

type InfoGetDeployResult = Awaited<ReturnType<RpcClient['getDeploy']>>;

function readExecutionOutcome(result: InfoGetDeployResult): 'success' | 'failure' | 'pending' {
  const execResult = result.executionInfo?.executionResult;
  if (!execResult) return 'pending';
  return execResult.errorMessage ? 'failure' : 'success';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
