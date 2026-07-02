import type { ClientCasperSigner } from 'x402-casper';

interface CasperWalletProvider {
  requestConnection(): Promise<boolean>;
  getActivePublicKey(): Promise<string>;
  sign(deployJson: string, accountPublicKeyHex: string): Promise<{
    cancelled: boolean;
    signatureHex?: string;
    signature?: Uint8Array;
  }>;
}

declare global {
  interface Window {
    CasperWalletProvider?: (options?: unknown) => CasperWalletProvider;
  }
}

export function getCasperProvider(): CasperWalletProvider {
  if (typeof window === 'undefined' || !window.CasperWalletProvider) {
    throw new Error('Casper Wallet not found. Install the Casper Wallet browser extension.');
  }
  return window.CasperWalletProvider();
}

export async function connectCasperWallet(): Promise<string> {
  const provider = getCasperProvider();
  const connected = await provider.requestConnection();
  if (!connected) throw new Error('Casper Wallet connection was rejected.');
  return provider.getActivePublicKey();
}

export function makeCasperSigner(publicKeyHex: string): ClientCasperSigner {
  const provider = getCasperProvider();
  return {
    publicKeyHex,
    async signDeployJson(deployJson, signingPublicKeyHex) {
      const res = await provider.sign(deployJson, signingPublicKeyHex);
      if (res.cancelled) throw new Error('Payment cancelled — approve the deploy in Casper Wallet.');
      if (res.signatureHex) return res.signatureHex;
      if (res.signature) return bytesToHex(res.signature);
      throw new Error('Casper Wallet returned no signature.');
    },
  };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
