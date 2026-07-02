import { x402Facilitator } from '@x402/core/facilitator';
import type { FacilitatorClient } from '@x402/core/server';
import type {
  PaymentPayload, PaymentRequirements,
  VerifyResponse, SettleResponse, SupportedResponse,
} from '@x402/core/types';
import { ExactCasperScheme as FacilitatorScheme } from './exact/facilitator.ts';
import type { CasperRpcConfig } from './signer.ts';
import { CASPER_TESTNET_CAIP2 } from './constants.ts';

/**
 * In-process FacilitatorClient: runs an x402Facilitator with the Casper scheme
 * so the resource server verifies/settles locally (no separate HTTP service).
 */
export class LocalFacilitatorClient implements FacilitatorClient {
  private readonly facilitator: x402Facilitator;

  constructor(config: CasperRpcConfig) {
    this.facilitator = new x402Facilitator();
    this.facilitator.register(CASPER_TESTNET_CAIP2, new FacilitatorScheme(config));
  }

  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    return this.facilitator.verify(payload, requirements);
  }

  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    return this.facilitator.settle(payload, requirements);
  }

  async getSupported(): Promise<SupportedResponse> {
    // x402Facilitator types `kinds[].network` as a plain string; it is always a
    // CAIP-2 Network in practice. Narrow to satisfy SupportedResponse.
    return this.facilitator.getSupported() as SupportedResponse;
  }
}
