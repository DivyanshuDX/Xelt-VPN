/**
 * Bridge between the x402 client scheme and a Casper wallet.
 * `signDeployJson` receives the JSON string of a Deploy (Deploy.toJSON output,
 * stringified) and returns the signature hex the wallet produced.
 */
export interface ClientCasperSigner {
  /** Signer's Casper public key, hex with algorithm tag (e.g. "01..." ed25519, "02..." secp256k1). */
  publicKeyHex: string;
  /** Sign the deploy JSON; resolve to signature hex. Reject/throw if the user cancels. */
  signDeployJson(deployJson: string, publicKeyHex: string): Promise<string>;
}

/** Facilitator-side Casper node configuration. */
export interface CasperRpcConfig {
  /** Full RPC endpoint, e.g. "https://node.testnet.casper.network/rpc". */
  nodeUrl: string;
  /** Chain name the deploy must target, e.g. "casper-test". */
  networkName: string;
  /** When true, verify the payer's main-purse balance covers amount+gas before accepting. Default false. */
  verifyBalance?: boolean;
}
