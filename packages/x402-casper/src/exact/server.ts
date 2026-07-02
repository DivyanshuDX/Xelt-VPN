import type {
  SchemeNetworkServer, Price, Network, AssetAmount,
  PaymentRequirements, SupportedKind,
} from '@x402/core/types';
import { CSPR_ASSET, CSPR_DECIMALS, csprToMotes } from '../constants.ts';

export class ExactCasperScheme implements SchemeNetworkServer {
  readonly scheme = 'exact';

  async parsePrice(price: Price, _network: Network): Promise<AssetAmount> {
    if (typeof price === 'object' && price !== null && 'amount' in price) {
      return price as AssetAmount;
    }
    const cspr = this.parseCsprAmount(price as string | number);
    return { asset: CSPR_ASSET, amount: csprToMotes(cspr) };
  }

  getAssetDecimals(_asset: string, _network: Network): number {
    return CSPR_DECIMALS;
  }

  async enhancePaymentRequirements(
    paymentRequirements: PaymentRequirements,
    _supportedKind: SupportedKind,
    _extensionKeys: string[],
  ): Promise<PaymentRequirements> {
    return {
      ...paymentRequirements,
      asset: paymentRequirements.asset || CSPR_ASSET,
      extra: { ...paymentRequirements.extra },
    };
  }

  private parseCsprAmount(money: string | number): number {
    if (typeof money === 'number') return money;
    const cleaned = money.replace(/cspr/i, '').replace('$', '').trim();
    const n = parseFloat(cleaned);
    if (!Number.isFinite(n)) throw new Error(`invalid CSPR price: ${money}`);
    return n;
  }
}
