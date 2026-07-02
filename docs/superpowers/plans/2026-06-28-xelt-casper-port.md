# Xelt Casper Network Port — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port Xelt's payment rail from Algorand x402 (USDC, Pera) to Casper Network (native CSPR, Casper Wallet) by building a faithful `@x402-casper` scheme that plugs into `@x402/core`, while keeping the WireGuard tunnel and session logic unchanged.

**Architecture:** A new workspace package `packages/x402-casper` implements the three `@x402/core` scheme roles (client/server/facilitator) for native CSPR transfers, mirroring `@x402/avm`. `vpn-server` swaps the AVM scheme for the Casper scheme and verifies/settles in-process via a `LocalFacilitatorClient` talking to a Casper testnet RPC node. The Tauri client signs in the system browser (where the Casper Wallet extension lives) and returns the result to the app via a localhost callback.

**Tech Stack:** TypeScript, Node, Hono (vpn-server); `@x402/core` 2.17.0, `casper-js-sdk` 5.0.12; Vitest (package unit tests); React + Vite + Tauri 2 (client); Rust (`tiny_http` for the callback server).

## Global Constraints

- Casper network CAIP-2 identifier: `casper:casper-test` (testnet). Copy verbatim.
- Native token: CSPR. 1 CSPR = 1_000_000_000 motes (9 decimals). Amounts in `PaymentRequirements.amount` are **motes as a decimal string**.
- Asset identifier string used in requirements: `"CSPR"`.
- Scheme name string: `"exact"` (matches `@x402/core` and the AVM scheme).
- `@x402/core` version: `^2.17.0`. `casper-js-sdk` version: `^5.0.12`.
- Native transfer minimum payment (gas) on Casper: `100000000` motes (0.1 CSPR), paid by the payer (not a fee payer). Native transfer minimum transferable amount is `2500000000` motes (2.5 CSPR) — pricing defaults must respect this floor.
- The facilitator does NOT hold funds and does NOT sponsor gas: `getSigners()` returns `[]`, `getExtra()` returns `undefined`.
- Do not modify `protocol/` (boringtun). It is chain-agnostic.
- ESM throughout vpn-server and the package (`"type": "module"`, `.js` import specifiers in TS source as the existing vpn-server does).
- Spec: `docs/superpowers/specs/2026-06-28-xelt-casper-port-design.md`.

---

## File Structure

**New — `packages/x402-casper/`:**
- `package.json`, `tsconfig.json`, `vitest.config.ts`
- `src/constants.ts` — `CASPER_TESTNET_CAIP2`, `CSPR_ASSET`, `CSPR_DECIMALS`, mote helpers
- `src/signer.ts` — `ClientCasperSigner`, `CasperRpcConfig` types
- `src/deploy.ts` — build/encode/decode native-transfer Deploy helpers
- `src/exact/server.ts` — `ExactCasperScheme implements SchemeNetworkServer`
- `src/exact/client.ts` — `ExactCasperScheme implements SchemeNetworkClient`
- `src/exact/facilitator.ts` — `ExactCasperScheme implements SchemeNetworkFacilitator`
- `src/exact/errors.ts` — facilitator error codes
- `src/local-facilitator-client.ts` — `LocalFacilitatorClient` (in-process `FacilitatorClient`)
- `src/index.ts`, `src/exact/server/index.ts` etc. via export maps
- `test/*.test.ts` — unit tests

**Modified — `vpn-server/`:**
- `services/pricing.ts` — CSPR units
- `endpoints.config.ts` — Casper network/asset
- `index.ts` — register Casper scheme + LocalFacilitatorClient + env
- `handlers/vpn.ts`, `types/vpn.ts` — CSPR wording
- `services/payPage.ts` (new) + `index.ts` route — serve `/pay`
- `.env.example`, `package.json`

**Modified — `client/`:**
- `src-tauri/src/callback.rs` (new), `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`
- `src/pay/main.tsx` (new), `pay.html` (new), `vite.config.ts`
- `src/utils/x402Vpn.ts`, `src/utils/casperWallet.ts` (new)
- `src/App.tsx`, `src/WalletApp.tsx`, `package.json`, `.env.example`

---

## Task 1: Scaffold the `@x402-casper` workspace package

**Files:**
- Create: `packages/x402-casper/package.json`
- Create: `packages/x402-casper/tsconfig.json`
- Create: `packages/x402-casper/vitest.config.ts`
- Create: `packages/x402-casper/src/index.ts` (temporary marker export)

**Interfaces:**
- Produces: an installable workspace package named `@x402-casper` with subpath exports `.`, `./exact/server`, `./exact/client`, `./exact/facilitator`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@x402-casper",
  "version": "0.1.0",
  "type": "module",
  "description": "x402 Payment Protocol Casper (native CSPR) implementation",
  "exports": {
    ".": "./src/index.ts",
    "./exact/server": "./src/exact/server.ts",
    "./exact/client": "./src/exact/client.ts",
    "./exact/facilitator": "./src/exact/facilitator.ts"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@x402/core": "^2.17.0",
    "casper-js-sdk": "^5.0.12"
  },
  "devDependencies": {
    "typescript": "^6.0.3",
    "vitest": "^2.1.0"
  }
}
```

Note: source-only package consumed by `vpn-server` (tsx) and the client (Vite) — both transpile TS directly, so no build step is needed.

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
```

- [ ] **Step 4: Create `src/index.ts` marker**

```ts
export const X402_CASPER = 'x402-casper';
```

- [ ] **Step 5: Install and verify the package resolves**

Run: `cd packages/x402-casper && npm install`
Expected: installs `@x402/core`, `casper-js-sdk`, `vitest` with no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/x402-casper
git commit -m "feat(casper): scaffold @x402-casper workspace package"
```

---

## Task 2: Constants and mote helpers

**Files:**
- Create: `packages/x402-casper/src/constants.ts`
- Test: `packages/x402-casper/test/constants.test.ts`

**Interfaces:**
- Produces:
  - `CASPER_TESTNET_CAIP2 = "casper:casper-test"` (typed as `Network`)
  - `CASPER_NETWORK_NAME = "casper-test"`
  - `CSPR_ASSET = "CSPR"`, `CSPR_DECIMALS = 9`
  - `csprToMotes(cspr: number): string` — decimal CSPR → integer motes string
  - `motesToCspr(motes: string): number`

- [ ] **Step 1: Write the failing test** — `test/constants.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { csprToMotes, motesToCspr, CASPER_TESTNET_CAIP2, CSPR_ASSET } from '../src/constants.ts';

describe('mote helpers', () => {
  it('converts whole CSPR to motes', () => {
    expect(csprToMotes(1)).toBe('1000000000');
  });
  it('converts fractional CSPR to motes without float drift', () => {
    expect(csprToMotes(2.5)).toBe('2500000000');
    expect(csprToMotes(0.1)).toBe('100000000');
  });
  it('round-trips motes back to CSPR', () => {
    expect(motesToCspr('2500000000')).toBe(2.5);
  });
  it('exposes constants', () => {
    expect(CASPER_TESTNET_CAIP2).toBe('casper:casper-test');
    expect(CSPR_ASSET).toBe('CSPR');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/x402-casper && npx vitest run test/constants.test.ts`
Expected: FAIL — cannot find module `../src/constants.ts`.

- [ ] **Step 3: Write `src/constants.ts`**

```ts
import type { Network } from '@x402/core/types';

export const CASPER_NETWORK_NAME = 'casper-test';
export const CASPER_TESTNET_CAIP2 = 'casper:casper-test' as Network;
export const CSPR_ASSET = 'CSPR';
export const CSPR_DECIMALS = 9;

const MOTES_PER_CSPR = 1_000_000_000n;

/** Convert a decimal CSPR amount to an integer motes string (no float drift). */
export function csprToMotes(cspr: number): string {
  if (!Number.isFinite(cspr) || cspr < 0) {
    throw new Error(`invalid CSPR amount: ${cspr}`);
  }
  // Work in fixed-point: 9 decimals.
  const [whole, fraction = ''] = cspr.toString().split('.');
  const fracPadded = (fraction + '0'.repeat(CSPR_DECIMALS)).slice(0, CSPR_DECIMALS);
  const motes = BigInt(whole) * MOTES_PER_CSPR + BigInt(fracPadded || '0');
  return motes.toString();
}

export function motesToCspr(motes: string): number {
  return Number(BigInt(motes)) / Number(MOTES_PER_CSPR);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/x402-casper && npx vitest run test/constants.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/x402-casper/src/constants.ts packages/x402-casper/test/constants.test.ts
git commit -m "feat(casper): CSPR mote helpers and network constants"
```

---

## Task 3: Signer and RPC config types

**Files:**
- Create: `packages/x402-casper/src/signer.ts`

**Interfaces:**
- Produces:
  - `interface ClientCasperSigner { publicKeyHex: string; signDeployJson(deployJson: string, publicKeyHex: string): Promise<string>; }` — `signDeployJson` returns the signature as a hex string (algorithm-tagged, as Casper Wallet returns).
  - `interface CasperRpcConfig { nodeUrl: string; networkName: string; verifyBalance?: boolean; }`

- [ ] **Step 1: Create `src/signer.ts`**

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/x402-casper && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/x402-casper/src/signer.ts
git commit -m "feat(casper): client signer and RPC config types"
```

---

## Task 4: Native-transfer Deploy helpers

**Files:**
- Create: `packages/x402-casper/src/deploy.ts`
- Test: `packages/x402-casper/test/deploy.test.ts`

**Interfaces:**
- Consumes: `casper-js-sdk` (`Deploy`, `DeployHeader`, `ExecutableDeployItem`, `TransferDeployItem`, `PublicKey`, `Timestamp`, `Duration`), `constants.ts`.
- Produces:
  - `buildTransferDeploy(args: { payerHex: string; payToHex: string; amountMotes: string; transferId: string; networkName: string; paymentMotes?: string; ttlMs?: number }): Deploy`
  - `encodeDeploy(deploy: Deploy): string` — base64 of `JSON.stringify(Deploy.toJSON(deploy))`
  - `decodeDeploy(encoded: string): Deploy`
  - `readTransfer(deploy: Deploy): { amountMotes: string; targetHex: string; transferId: string } | null`

- [ ] **Step 1: Write the failing test** — `test/deploy.test.ts`

These are deterministic, key-free assertions (build → encode → decode → read round-trip). Use two well-known testnet public keys (any valid hex tagged keys).

```ts
import { describe, it, expect } from 'vitest';
import { buildTransferDeploy, encodeDeploy, decodeDeploy, readTransfer } from '../src/deploy.ts';

// Valid ed25519 testnet public keys (01 prefix). These are real, fundable format examples.
const PAYER = '0118ca22aff52c0d51bd9dd88c8d4b73776e9c84a37e1fb1bf86dc7d6e6e3b0e1f';
const PAYTO = '012c7e95e6a1f0 a0'; // placeholder — replace in Step 3 note

describe('transfer deploy helpers', () => {
  it('builds, encodes, decodes and reads a native transfer', () => {
    const payTo = '0145fa9c9b9ab2a0d61c6f0e0e9f6d9e6e2cda9d2e7e7c7d3a2b1c0d9e8f7a6b5c';
    const deploy = buildTransferDeploy({
      payerHex: PAYER,
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

  it('returns null for non-transfer deploys via readTransfer on a tampered object', () => {
    expect(readTransfer({ isTransfer: () => false } as any)).toBeNull();
  });
});
```

NOTE: delete the bogus `PAYTO` constant; the test uses a local valid `payTo`. Keep `PAYER` as shown (valid 01-tagged 32-byte key).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/x402-casper && npx vitest run test/deploy.test.ts`
Expected: FAIL — cannot find `../src/deploy.ts`.

- [ ] **Step 3: Write `src/deploy.ts`**

```ts
import {
  Deploy,
  DeployHeader,
  ExecutableDeployItem,
  TransferDeployItem,
  PublicKey,
  Timestamp,
  Duration,
} from 'casper-js-sdk';

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
  const anyVal = target as { publicKey?: { toHex?: () => string }; toString: () => string };
  if (anyVal.publicKey?.toHex) return anyVal.publicKey.toHex();
  return anyVal.toString();
}
```

IMPLEMENTER NOTE (verify at this task): confirm the transfer arg names (`amount`, `target`, `id`) and how `target` CLValue renders to hex in casper-js-sdk 5.0.12 by logging `Deploy.toJSON(deploy)` once. Adjust `clTargetToHex` / arg names if the SDK differs. The browser variant of the SDK is `casper-js-sdk` (same package; resolves to `lib.web.js` under bundlers).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/x402-casper && npx vitest run test/deploy.test.ts`
Expected: PASS. If `targetHex` assertion fails, fix `clTargetToHex` per the implementer note, then re-run.

- [ ] **Step 5: Commit**

```bash
git add packages/x402-casper/src/deploy.ts packages/x402-casper/test/deploy.test.ts
git commit -m "feat(casper): native transfer deploy build/encode/decode/read helpers"
```

---

## Task 5: Server scheme — price parsing and requirements

**Files:**
- Create: `packages/x402-casper/src/exact/server.ts`
- Test: `packages/x402-casper/test/server.test.ts`

**Interfaces:**
- Consumes: `@x402/core/types` (`SchemeNetworkServer`, `Price`, `Network`, `AssetAmount`, `PaymentRequirements`, `SupportedKind`), `constants.ts`.
- Produces: `class ExactCasperScheme implements SchemeNetworkServer` with `scheme = "exact"`, `parsePrice`, `enhancePaymentRequirements`, `getAssetDecimals`.

Price semantics for CSPR: a `Money` number/string is interpreted as **CSPR** (not dollars). `"2.5"`, `2.5`, or `"2.5 CSPR"` → `{ asset: "CSPR", amount: "2500000000" }`. An `AssetAmount` is passed through.

- [ ] **Step 1: Write the failing test** — `test/server.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { ExactCasperScheme } from '../src/exact/server.ts';
import { CASPER_TESTNET_CAIP2 } from '../src/constants.ts';

const server = new ExactCasperScheme();

describe('ExactCasperScheme (server)', () => {
  it('parses a numeric CSPR price to motes', async () => {
    const a = await server.parsePrice(2.5, CASPER_TESTNET_CAIP2);
    expect(a).toEqual({ asset: 'CSPR', amount: '2500000000' });
  });
  it('parses a "N CSPR" string', async () => {
    const a = await server.parsePrice('0.1 CSPR', CASPER_TESTNET_CAIP2);
    expect(a).toEqual({ asset: 'CSPR', amount: '100000000' });
  });
  it('passes through an AssetAmount', async () => {
    const a = await server.parsePrice({ asset: 'CSPR', amount: '5' }, CASPER_TESTNET_CAIP2);
    expect(a).toEqual({ asset: 'CSPR', amount: '5' });
  });
  it('reports 9 decimals', () => {
    expect(server.getAssetDecimals('CSPR', CASPER_TESTNET_CAIP2)).toBe(9);
  });
  it('enhancePaymentRequirements keeps CSPR asset and amount', async () => {
    const req = {
      scheme: 'exact', network: CASPER_TESTNET_CAIP2, asset: 'CSPR',
      amount: '2500000000', payTo: '01abc', maxTimeoutSeconds: 120, extra: {},
    };
    const out = await server.enhancePaymentRequirements(req, {
      x402Version: 2, scheme: 'exact', network: CASPER_TESTNET_CAIP2,
    }, []);
    expect(out.asset).toBe('CSPR');
    expect(out.amount).toBe('2500000000');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/x402-casper && npx vitest run test/server.test.ts`
Expected: FAIL — cannot find `../src/exact/server.ts`.

- [ ] **Step 3: Write `src/exact/server.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/x402-casper && npx vitest run test/server.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/x402-casper/src/exact/server.ts packages/x402-casper/test/server.test.ts
git commit -m "feat(casper): exact server scheme (CSPR price parsing)"
```

---

## Task 6: Client scheme — build and sign payment payload

**Files:**
- Create: `packages/x402-casper/src/exact/client.ts`
- Test: `packages/x402-casper/test/client.test.ts`

**Interfaces:**
- Consumes: `@x402/core/types` (`SchemeNetworkClient`, `PaymentRequirements`, `PaymentPayloadResult`), `deploy.ts`, `signer.ts`, `casper-js-sdk` (`PublicKey`, `Deploy`).
- Produces: `class ExactCasperScheme implements SchemeNetworkClient` constructed with a `ClientCasperSigner`. `createPaymentPayload` returns `{ x402Version, payload: { signedDeploy, payer, transferId } }`.

The client builds the transfer deploy, asks the signer for a signature hex, attaches it via `Deploy.setSignature`, and encodes the **signed** deploy.

- [ ] **Step 1: Write the failing test** — `test/client.test.ts`

Uses a fake signer that signs with a generated `PrivateKey` so the produced deploy validates.

```ts
import { describe, it, expect } from 'vitest';
import { PrivateKey, KeyAlgorithm, Deploy } from 'casper-js-sdk';
import { ExactCasperScheme } from '../src/exact/client.ts';
import { decodeDeploy } from '../src/deploy.ts';
import { CASPER_TESTNET_CAIP2 } from '../src/constants.ts';
import type { ClientCasperSigner } from '../src/signer.ts';

async function fakeSigner(): Promise<ClientCasperSigner> {
  const priv = await PrivateKey.generate(KeyAlgorithm.ED25519);
  const pubHex = priv.publicKey.toHex();
  return {
    publicKeyHex: pubHex,
    async signDeployJson(deployJson) {
      const deploy = Deploy.fromJSON(JSON.parse(deployJson));
      deploy.sign(priv);
      // Return the signature hex from the approval the wallet would produce.
      return deploy.approvals[0].signature.toHex();
    },
  };
}

describe('ExactCasperScheme (client)', () => {
  it('creates a signed transfer payload that decodes and validates', async () => {
    const signer = await fakeSigner();
    const scheme = new ExactCasperScheme(signer);
    const req = {
      scheme: 'exact', network: CASPER_TESTNET_CAIP2, asset: 'CSPR',
      amount: '2500000000',
      payTo: (await (await import('casper-js-sdk')).PrivateKey.generate((await import('casper-js-sdk')).KeyAlgorithm.ED25519)).publicKey.toHex(),
      maxTimeoutSeconds: 120, extra: {},
    };
    const result = await scheme.createPaymentPayload(2, req);
    expect(result.x402Version).toBe(2);
    const payload = result.payload as { signedDeploy: string; payer: string; transferId: string };
    expect(payload.payer).toBe(signer.publicKeyHex);
    const deploy = decodeDeploy(payload.signedDeploy);
    expect(deploy.validate()).toBe(true);
  });
});
```

IMPLEMENTER NOTE: confirm `Approval.signature.toHex()` and `PrivateKey.generate(...)` exist in 5.0.12 (see `dist/types/keypair/PrivateKey.d.ts` and `Transaction.d.ts`). If the signature accessor differs, adjust the fake signer; the production code path uses `Deploy.setSignature` and does not depend on these test internals.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/x402-casper && npx vitest run test/client.test.ts`
Expected: FAIL — cannot find `../src/exact/client.ts`.

- [ ] **Step 3: Write `src/exact/client.ts`**

```ts
import type {
  SchemeNetworkClient, PaymentRequirements, PaymentPayloadResult, PaymentPayloadContext,
} from '@x402/core/types';
import { PublicKey, Deploy } from 'casper-js-sdk';
import type { ClientCasperSigner } from '../signer.ts';
import { CASPER_NETWORK_NAME } from '../constants.ts';
import { buildTransferDeploy, encodeDeploy, decodeDeploy } from '../deploy.ts';

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
    const signed = Deploy.setSignature(unsigned, hexToBytes(signatureHex), publicKey);

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

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
```

IMPLEMENTER NOTE: Casper Wallet's signature hex is algorithm-tagged in some SDK paths. If `Deploy.setSignature` rejects the raw bytes, strip/keep the 1-byte algorithm tag to match what `setSignature` expects (it takes the raw signature bytes; the algorithm is taken from `publicKey`). Verify with the client test (`deploy.validate()` must return true).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/x402-casper && npx vitest run test/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/x402-casper/src/exact/client.ts packages/x402-casper/test/client.test.ts
git commit -m "feat(casper): exact client scheme (build + sign transfer payload)"
```

---

## Task 7: Facilitator error codes

**Files:**
- Create: `packages/x402-casper/src/exact/errors.ts`

**Interfaces:**
- Produces: string error code constants used by `verify`/`settle`.

- [ ] **Step 1: Write `src/exact/errors.ts`**

```ts
export const ErrInvalidScheme = 'invalid_exact_casper_scheme';
export const ErrNetworkMismatch = 'invalid_exact_casper_network_mismatch';
export const ErrInvalidVersion = 'invalid_exact_casper_invalid_version';
export const ErrInvalidPayload = 'invalid_exact_casper_payload';
export const ErrInvalidDeploy = 'invalid_exact_casper_invalid_deploy';
export const ErrNotTransfer = 'invalid_exact_casper_not_transfer';
export const ErrAmountMismatch = 'invalid_exact_casper_amount_mismatch';
export const ErrReceiverMismatch = 'invalid_exact_casper_receiver_mismatch';
export const ErrChainMismatch = 'invalid_exact_casper_chain_mismatch';
export const ErrInvalidSignature = 'invalid_exact_casper_invalid_signature';
export const ErrExpired = 'invalid_exact_casper_expired';
export const ErrReplay = 'invalid_exact_casper_replay';
export const ErrInsufficientBalance = 'invalid_exact_casper_insufficient_balance';
export const ErrSettleFailed = 'invalid_exact_casper_settlement_failed';
export const ErrConfirmationFailed = 'invalid_exact_casper_confirmation_failed';
```

- [ ] **Step 2: Commit**

```bash
git add packages/x402-casper/src/exact/errors.ts
git commit -m "feat(casper): facilitator error codes"
```

---

## Task 8: Facilitator scheme — verify

**Files:**
- Create: `packages/x402-casper/src/exact/facilitator.ts`
- Test: `packages/x402-casper/test/facilitator.verify.test.ts`

**Interfaces:**
- Consumes: `@x402/core/types` (`SchemeNetworkFacilitator`, `PaymentPayload`, `PaymentRequirements`, `VerifyResponse`, `SettleResponse`, `Network`), `deploy.ts`, `errors.ts`, `signer.ts` (`CasperRpcConfig`), `casper-js-sdk` (`RpcClient`, `HttpHandler`, `PurseIdentifier`, `PublicKey`).
- Produces: `class ExactCasperScheme implements SchemeNetworkFacilitator` with `scheme="exact"`, `caipFamily="casper:*"`, `getExtra`, `getSigners`, `verify`, `settle` (settle in Task 9). A `markSettled`/`isSettled` replay guard (in-memory Set).

`verify` validations (in order): version === 2; network startsWith `casper:`; payload has `signedDeploy`+`payer`; decode deploy (else `ErrInvalidDeploy`); `deploy.validate()` true (else `ErrInvalidSignature`); `deploy.isTransfer()` (else `ErrNotTransfer`); chain_name === requirements network suffix (else `ErrChainMismatch`); TTL not expired (else `ErrExpired`); target hex === payTo (else `ErrReceiverMismatch`); amount === requirements.amount (else `ErrAmountMismatch`); not already settled (else `ErrReplay`); optional balance check.

- [ ] **Step 1: Write the failing test** — `test/facilitator.verify.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { PrivateKey, KeyAlgorithm, Deploy } from 'casper-js-sdk';
import { ExactCasperScheme } from '../src/exact/facilitator.ts';
import { buildTransferDeploy, encodeDeploy } from '../src/deploy.ts';
import { CASPER_TESTNET_CAIP2 } from '../src/constants.ts';

async function signedPayload(amountMotes: string, payToHex: string) {
  const payer = await PrivateKey.generate(KeyAlgorithm.ED25519);
  const unsigned = buildTransferDeploy({
    payerHex: payer.publicKey.toHex(),
    payToHex,
    amountMotes,
    transferId: '1',
    networkName: 'casper-test',
  });
  unsigned.sign(payer);
  return {
    x402Version: 2,
    accepted: {} as any,
    payload: { signedDeploy: encodeDeploy(unsigned), payer: payer.publicKey.toHex(), transferId: '1' },
  };
}

function reqFor(amountMotes: string, payToHex: string) {
  return {
    scheme: 'exact', network: CASPER_TESTNET_CAIP2, asset: 'CSPR',
    amount: amountMotes, payTo: payToHex, maxTimeoutSeconds: 120, extra: {},
  };
}

describe('ExactCasperScheme (facilitator) verify', () => {
  const fac = new ExactCasperScheme({ nodeUrl: 'http://unused', networkName: 'casper-test' });

  it('accepts a correct signed transfer', async () => {
    const payTo = (await PrivateKey.generate(KeyAlgorithm.ED25519)).publicKey.toHex();
    const payload = await signedPayload('2500000000', payTo);
    const res = await fac.verify(payload as any, reqFor('2500000000', payTo) as any);
    expect(res.isValid).toBe(true);
    expect(res.payer).toBe((payload.payload as any).payer);
  });

  it('rejects amount mismatch', async () => {
    const payTo = (await PrivateKey.generate(KeyAlgorithm.ED25519)).publicKey.toHex();
    const payload = await signedPayload('2500000000', payTo);
    const res = await fac.verify(payload as any, reqFor('9900000000', payTo) as any);
    expect(res.isValid).toBe(false);
    expect(res.invalidReason).toContain('amount');
  });

  it('rejects receiver mismatch', async () => {
    const payTo = (await PrivateKey.generate(KeyAlgorithm.ED25519)).publicKey.toHex();
    const other = (await PrivateKey.generate(KeyAlgorithm.ED25519)).publicKey.toHex();
    const payload = await signedPayload('2500000000', payTo);
    const res = await fac.verify(payload as any, reqFor('2500000000', other) as any);
    expect(res.isValid).toBe(false);
    expect(res.invalidReason).toContain('receiver');
  });

  it('exposes no signers and no extra', () => {
    expect(fac.getSigners('casper-test')).toEqual([]);
    expect(fac.getExtra('casper-test')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/x402-casper && npx vitest run test/facilitator.verify.test.ts`
Expected: FAIL — cannot find `../src/exact/facilitator.ts`.

- [ ] **Step 3: Write `src/exact/facilitator.ts` (verify + scaffolding; settle stubbed to throw until Task 9)**

```ts
import type {
  SchemeNetworkFacilitator, PaymentPayload, PaymentRequirements,
  VerifyResponse, SettleResponse, Network,
} from '@x402/core/types';
import { RpcClient, HttpHandler } from 'casper-js-sdk';
import type { CasperRpcConfig } from '../signer.ts';
import { decodeDeploy, readTransfer } from '../deploy.ts';
import * as E from './errors.ts';

export class ExactCasperScheme implements SchemeNetworkFacilitator {
  readonly scheme = 'exact';
  readonly caipFamily = 'casper:*';
  private readonly settled = new Set<string>();
  private readonly rpc: RpcClient;

  constructor(private readonly config: CasperRpcConfig) {
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
    const fail = (reason: string, message: string): VerifyResponse => ({
      isValid: false, invalidReason: reason, invalidMessage: message,
    });

    if (payload.x402Version !== 2) return fail(E.ErrInvalidVersion, 'unsupported x402 version');
    if (!requirements.network.startsWith('casper:')) {
      return fail(E.ErrNetworkMismatch, 'network is not a casper network');
    }

    const p = payload.payload as { signedDeploy?: string; payer?: string };
    if (!p?.signedDeploy || !p?.payer) return fail(E.ErrInvalidPayload, 'missing signedDeploy/payer');

    let deploy;
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
    _payload: PaymentPayload,
    _requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    throw new Error('settle implemented in Task 9');
  }

  protected markSettled(deployHash: string): void {
    this.settled.add(deployHash);
  }

  protected async hasSufficientBalance(payerHex: string, amountMotes: string): Promise<boolean> {
    try {
      const { PublicKey, PurseIdentifier } = await import('casper-js-sdk');
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

function isExpired(deploy: { header: { timestamp: { toMilliseconds?: () => number; date?: Date }; ttl: { duration?: number } } }): boolean {
  const ts = readTimestampMs(deploy.header.timestamp);
  const ttl = deploy.header.ttl?.duration ?? 30 * 60 * 1000;
  if (ts == null) return false;
  return Date.now() > ts + ttl;
}

function readTimestampMs(timestamp: { toMilliseconds?: () => number; date?: Date; toJSON?: () => string }): number | null {
  if (timestamp?.toMilliseconds) return timestamp.toMilliseconds();
  if (timestamp?.date) return timestamp.date.getTime();
  if (timestamp?.toJSON) return new Date(timestamp.toJSON()).getTime();
  return null;
}
```

IMPLEMENTER NOTE: verify `deploy.hash.toHex()`, `deploy.header.chainName`, `deploy.header.ttl.duration`, and the `Timestamp` accessor in 5.0.12. The helpers above defensively probe multiple shapes; tighten to the real accessors and remove the fallbacks once confirmed.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/x402-casper && npx vitest run test/facilitator.verify.test.ts`
Expected: PASS (4 tests). Fix accessor names per the implementer note if any assertion fails.

- [ ] **Step 5: Commit**

```bash
git add packages/x402-casper/src/exact/facilitator.ts packages/x402-casper/test/facilitator.verify.test.ts
git commit -m "feat(casper): exact facilitator verify (decode, checks, replay guard)"
```

---

## Task 9: Facilitator scheme — settle

**Files:**
- Modify: `packages/x402-casper/src/exact/facilitator.ts` (replace the `settle` stub)
- Test: `packages/x402-casper/test/facilitator.settle.test.ts`

**Interfaces:**
- Produces: working `settle(payload, requirements)` → `SettleResponse { success, transaction, network, payer }`. Submits via `rpc.putDeploy`, polls `rpc.getDeploy` for execution success, marks settled.

- [ ] **Step 1: Write the failing test** — `test/facilitator.settle.test.ts`

Inject a fake RPC by subclassing to avoid real network. Test success and submit-failure.

```ts
import { describe, it, expect } from 'vitest';
import { PrivateKey, KeyAlgorithm } from 'casper-js-sdk';
import { ExactCasperScheme } from '../src/exact/facilitator.ts';
import { buildTransferDeploy, encodeDeploy } from '../src/deploy.ts';
import { CASPER_TESTNET_CAIP2 } from '../src/constants.ts';

class TestFacilitator extends ExactCasperScheme {
  putCalled = false;
  constructor(private mode: 'ok' | 'putfail') {
    super({ nodeUrl: 'http://unused', networkName: 'casper-test' });
  }
  protected async submitAndConfirm(deployHash: string): Promise<void> {
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
  const payload = { x402Version: 2, accepted: {} as any,
    payload: { signedDeploy: encodeDeploy(unsigned), payer: payer.publicKey.toHex(), transferId: '1' } };
  const req = { scheme: 'exact', network: CASPER_TESTNET_CAIP2, asset: 'CSPR',
    amount: '2500000000', payTo, maxTimeoutSeconds: 120, extra: {} };
  return { payload, req };
}

describe('ExactCasperScheme (facilitator) settle', () => {
  it('returns success with the deploy hash', async () => {
    const fac = new TestFacilitator('ok');
    const { payload, req } = await payloadAndReq();
    const res = await fac.settle(payload as any, req as any);
    expect(res.success).toBe(true);
    expect(res.transaction).toMatch(/^[0-9a-f]+$/i);
    expect(fac.putCalled).toBe(true);
  });

  it('returns failure when submit throws', async () => {
    const fac = new TestFacilitator('putfail');
    const { payload, req } = await payloadAndReq();
    const res = await fac.settle(payload as any, req as any);
    expect(res.success).toBe(false);
    expect(res.errorReason).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/x402-casper && npx vitest run test/facilitator.settle.test.ts`
Expected: FAIL — `settle implemented in Task 9` thrown / `submitAndConfirm` not present.

- [ ] **Step 3: Replace the `settle` stub and add `submitAndConfirm` in `src/exact/facilitator.ts`**

Replace the stub method with:

```ts
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
      await this.submitAndConfirm(p.signedDeploy);
      this.markSettled(deployHash);
      return { success: true, transaction: deployHash, network, payer: p.payer };
    } catch (err) {
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
```

Add at the bottom of the file (module scope):

```ts
function readExecutionOutcome(result: {
  executionInfo?: { executionResult?: { errorMessage?: string } };
  executionResultsV1?: Array<{ result?: { Failure?: unknown; Success?: unknown } }>;
}): 'success' | 'failure' | 'pending' {
  const info = result.executionInfo?.executionResult;
  if (info) return info.errorMessage ? 'failure' : 'success';
  const v1 = result.executionResultsV1?.[0]?.result;
  if (v1) return 'Failure' in v1 && v1.Failure ? 'failure' : 'success';
  return 'pending';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
```

IMPLEMENTER NOTE: confirm `InfoGetDeployResult.executionInfo.executionResult.errorMessage` (v2) and `executionResultsV1[].result` (v1) shapes against `dist/rpc/response.d.ts` in 5.0.12, and adjust `readExecutionOutcome` if needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/x402-casper && npx vitest run test/facilitator.settle.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the whole package suite**

Run: `cd packages/x402-casper && npx vitest run`
Expected: all tests across files PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/x402-casper/src/exact/facilitator.ts packages/x402-casper/test/facilitator.settle.test.ts
git commit -m "feat(casper): exact facilitator settle (putDeploy + confirm)"
```

---

## Task 10: LocalFacilitatorClient + package exports

**Files:**
- Create: `packages/x402-casper/src/local-facilitator-client.ts`
- Modify: `packages/x402-casper/src/index.ts`
- Test: `packages/x402-casper/test/local-facilitator-client.test.ts`

**Interfaces:**
- Consumes: `@x402/core/server` (`FacilitatorClient` type), `@x402/core/facilitator` (`x402Facilitator`), the facilitator scheme, constants.
- Produces: `class LocalFacilitatorClient implements FacilitatorClient` wrapping an `x402Facilitator` registered with the Casper facilitator scheme. `index.ts` re-exports constants, signer types, and `LocalFacilitatorClient`.

The resource server only needs a `FacilitatorClient`. Inspect `@x402/core`'s `FacilitatorClient` interface (`dist/cjs/x402Client-CdmxbRFj.d.ts`, exported as `y`) — it has `verify`, `settle`, and `getSupported`. `LocalFacilitatorClient` delegates to an in-process `x402Facilitator`.

- [ ] **Step 1: Inspect the `FacilitatorClient` interface**

Run: `grep -n "interface FacilitatorClient" -A 25 packages/x402-casper/node_modules/@x402/core/dist/cjs/x402Client-CdmxbRFj.d.ts`
Expected: shows methods `verify(...)`, `settle(...)`, `getSupported(...)`. Use the exact signatures shown in the next step.

- [ ] **Step 2: Write the failing test** — `test/local-facilitator-client.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { LocalFacilitatorClient } from '../src/local-facilitator-client.ts';

describe('LocalFacilitatorClient', () => {
  it('reports supported casper kinds', async () => {
    const client = new LocalFacilitatorClient({ nodeUrl: 'http://unused', networkName: 'casper-test' });
    const supported = await client.getSupported();
    const kinds = supported.kinds.map((k: { network: string; scheme: string }) => `${k.scheme}:${k.network}`);
    expect(kinds).toContain('exact:casper:casper-test');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/x402-casper && npx vitest run test/local-facilitator-client.test.ts`
Expected: FAIL — cannot find `../src/local-facilitator-client.ts`.

- [ ] **Step 4: Write `src/local-facilitator-client.ts`**

```ts
import { x402Facilitator } from '@x402/core/facilitator';
import type {
  FacilitatorClient, PaymentPayload, PaymentRequirements,
  VerifyResponse, SettleResponse, SupportedResponse,
} from '@x402/core/server';
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
    return this.facilitator.getSupported();
  }
}
```

IMPLEMENTER NOTE: match the method signatures to the `FacilitatorClient` interface found in Step 1. If `FacilitatorClient` is not exported from `@x402/core/server`, import the type from `@x402/core/facilitator` or define a structural type with the same methods; the runtime only needs `verify`/`settle`/`getSupported`.

- [ ] **Step 5: Update `src/index.ts`**

```ts
export * from './constants.ts';
export * from './signer.ts';
export { LocalFacilitatorClient } from './local-facilitator-client.ts';
```

- [ ] **Step 6: Run test + full suite**

Run: `cd packages/x402-casper && npx vitest run`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/x402-casper/src/local-facilitator-client.ts packages/x402-casper/src/index.ts packages/x402-casper/test/local-facilitator-client.test.ts
git commit -m "feat(casper): in-process LocalFacilitatorClient + package exports"
```

---
</content>

## Task 11: vpn-server pricing → CSPR

**Files:**
- Modify: `vpn-server/services/pricing.ts`
- Modify: `vpn-server/types/vpn.ts` (rename USDC fields in quote/response types)

**Interfaces:**
- Produces: `PricingConfig.pricePerMinuteCSPR`, `priceForDuration()` returning an `AssetAmount`-compatible price string the Casper scheme accepts (e.g. `"2.5 CSPR"`), `priceDescription()` in CSPR.

- [ ] **Step 1: Rewrite `vpn-server/services/pricing.ts`**

```ts
import type { ParsedRequestBody } from '../types/vpn.js';

const DEFAULT_PRICE_PER_MINUTE = 0.5;   // CSPR/min
const DEFAULT_SESSION_MINUTES = 5;
const DEFAULT_MIN_MINUTES = 1;
const DEFAULT_MAX_MINUTES = 60;

export interface PricingConfig {
  pricePerMinuteCSPR: number;
  defaultSessionMinutes: number;
  minSessionMinutes: number;
  maxSessionMinutes: number;
  renewWindowSeconds: number;
}

export function loadPricingConfig(): PricingConfig {
  return {
    pricePerMinuteCSPR: parseFloat(
      process.env.PRICE_PER_MINUTE_CSPR || String(DEFAULT_PRICE_PER_MINUTE)
    ),
    defaultSessionMinutes: parseInt(
      process.env.DEFAULT_SESSION_MINUTES || String(DEFAULT_SESSION_MINUTES), 10
    ),
    minSessionMinutes: parseInt(
      process.env.MIN_SESSION_MINUTES || String(DEFAULT_MIN_MINUTES), 10
    ),
    maxSessionMinutes: parseInt(
      process.env.MAX_SESSION_MINUTES || String(DEFAULT_MAX_MINUTES), 10
    ),
    renewWindowSeconds: parseInt(process.env.RENEW_WINDOW_SECONDS || '30', 10),
  };
}

export function resolveDurationMinutes(
  body: ParsedRequestBody | null | undefined,
  config: PricingConfig,
  fallbackMinutes?: number
): number {
  const raw = body?.durationMinutes ?? fallbackMinutes ?? config.defaultSessionMinutes;
  if (!Number.isFinite(raw) || raw < config.minSessionMinutes || raw > config.maxSessionMinutes) {
    throw new Error(
      `durationMinutes must be between ${config.minSessionMinutes} and ${config.maxSessionMinutes}`
    );
  }
  return Math.floor(raw);
}

/** x402 price string the Casper scheme parses, e.g. "2.5 CSPR". */
export function priceForDuration(minutes: number, config: PricingConfig): string {
  const total = minutes * config.pricePerMinuteCSPR;
  return `${total} CSPR`;
}

export function priceDescription(minutes: number, config: PricingConfig): string {
  return `${priceForDuration(minutes, config)} for ${minutes} minute VPN session`;
}
```

- [ ] **Step 2: Update `vpn-server/types/vpn.ts`** — rename USDC fields

Replace `priceUSDC` / `pricePerMinuteUSDC` in `PricingQuoteResponse`:

```ts
export interface PricingQuoteResponse {
  durationMinutes: number;
  priceCSPR: string;
  pricePerMinuteCSPR: string;
  renewWindowSeconds: number;
  minSessionMinutes: number;
  maxSessionMinutes: number;
}
```

- [ ] **Step 3: Typecheck the vpn-server**

Run: `cd vpn-server && npx tsc --noEmit`
Expected: errors only in `handlers/vpn.ts` / `endpoints.config.ts` referencing old USDC names — fixed in Tasks 12–13. Confirm `pricing.ts` itself has no errors.

- [ ] **Step 4: Commit**

```bash
git add vpn-server/services/pricing.ts vpn-server/types/vpn.ts
git commit -m "feat(casper): price the VPN in CSPR per minute"
```

---

## Task 12: vpn-server endpoints config → Casper

**Files:**
- Modify: `vpn-server/endpoints.config.ts`

**Interfaces:**
- Consumes: `@x402-casper` (`CASPER_TESTNET_CAIP2`, `CSPR_ASSET`), `pricing.ts`.
- Produces: `createPaymentConfig(casperPayTo, sessionStore)` with both routes priced in CSPR on `CASPER_TESTNET_CAIP2`.

- [ ] **Step 1: Edit `vpn-server/endpoints.config.ts`**

Replace the AVM imports and the two `accepts` blocks:

```ts
import { CASPER_TESTNET_CAIP2, CSPR_ASSET } from '@x402-casper';
import type { RoutesConfig, HTTPRequestContext } from '@x402/core/server';

import { loadPricingConfig, priceForDuration, resolveDurationMinutes } from './services/pricing.js';
import type { SessionStore } from './services/sessionStore.js';
import type { ParsedRequestBody } from './types/vpn.js';
```

In both `'POST /connect'` and `'POST /renew'`, set `accepts` to:

```ts
      accepts: [
        {
          scheme: 'exact',
          price: dynamicPrice('connect'), // or 'renew'
          network: CASPER_TESTNET_CAIP2,
          payTo: casperPayTo,
          extra: { asset: CSPR_ASSET },
        },
      ],
```

Rename the function parameter `avmAddress` → `casperPayTo` in the signature and body. Update the `description` strings to say CSPR. Keep `dynamicPrice` as-is (it already returns the price string from `priceForDuration`).

- [ ] **Step 2: Typecheck**

Run: `cd vpn-server && npx tsc --noEmit`
Expected: `endpoints.config.ts` clean (remaining errors only in `index.ts`/`handlers` until Tasks 13–14).

- [ ] **Step 3: Commit**

```bash
git add vpn-server/endpoints.config.ts
git commit -m "feat(casper): x402 routes accept native CSPR on casper-test"
```

---

## Task 13: vpn-server server wiring → Casper scheme + LocalFacilitatorClient

**Files:**
- Modify: `vpn-server/index.ts`
- Modify: `vpn-server/handlers/vpn.ts`
- Modify: `vpn-server/package.json` (add `@x402-casper` dependency)

**Interfaces:**
- Consumes: `@x402-casper` (`CASPER_TESTNET_CAIP2`, `LocalFacilitatorClient`), `@x402-casper/exact/server` (`ExactCasperScheme`), `@x402/core/server` (`x402ResourceServer`, `x402HTTPResourceServer`).
- Produces: a running resource server that verifies/settles CSPR payments in-process.

- [ ] **Step 1: Add the workspace dependency**

In `vpn-server/package.json` dependencies, add:

```json
    "@x402-casper": "file:../packages/x402-casper",
```

Run: `cd vpn-server && npm install`
Expected: links the local package.

- [ ] **Step 2: Edit `vpn-server/index.ts`** — replace the AVM block

Replace imports:

```ts
import { paymentMiddlewareFromHTTPServer } from '@x402/hono';
import { x402ResourceServer, x402HTTPResourceServer } from '@x402/core/server';
import { ExactCasperScheme } from '@x402-casper/exact/server';
import { CASPER_TESTNET_CAIP2, LocalFacilitatorClient } from '@x402-casper';
```

Replace the env block:

```ts
const casperPayTo = process.env.CSPR_PAYTO;
const casperNodeUrl = process.env.CASPER_NODE_URL || 'https://node.testnet.casper.network/rpc';
const casperNetworkName = process.env.CASPER_NETWORK_NAME || 'casper-test';
const port = parseInt(process.env.PORT || '4021', 10);
const boringtunApi = process.env.BORINGTUN_API_URL || 'http://127.0.0.1:8080';

if (!casperPayTo) {
  console.error(
    '❌ Missing required environment variables:\n' +
      '   CSPR_PAYTO — Casper account public key (hex) receiving CSPR\n' +
      '   (optional) CASPER_NODE_URL, CASPER_NETWORK_NAME'
  );
  process.exit(1);
}
```

Replace the facilitator/server construction:

```ts
const facilitatorClient = new LocalFacilitatorClient({
  nodeUrl: casperNodeUrl,
  networkName: casperNetworkName,
  verifyBalance: process.env.VERIFY_BALANCE === '1',
});
const x402Server = new x402ResourceServer(facilitatorClient);
x402Server.register(CASPER_TESTNET_CAIP2, new ExactCasperScheme());

const paymentConfig = createPaymentConfig(casperPayTo, sessionStore);
```

Update the banner/log lines: replace `Receiver: ${avmAddress}` with `Receiver: ${casperPayTo}`, replace `Facilitator: ${facilitatorUrl}` with `Casper node: ${casperNodeUrl}`, replace `Price/min: $${pricing.pricePerMinuteUSDC} USDC` with `Price/min: ${pricing.pricePerMinuteCSPR} CSPR`. In the `/info` handler change `network: 'Algorand TestNet'` → `network: 'Casper Testnet'`, `receiver: avmAddress` → `receiver: casperPayTo`, and the pricing block to `pricePerMinuteCSPR: pricing.pricePerMinuteCSPR`.

- [ ] **Step 3: Edit `vpn-server/handlers/vpn.ts`** — wording only

In `createPricingHandler`, change the JSON response keys to match the new `PricingQuoteResponse`:

```ts
    return c.json({
      durationMinutes,
      priceCSPR: priceDescription(durationMinutes, pricing),
      pricePerMinuteCSPR: `${pricing.pricePerMinuteCSPR} CSPR`,
      renewWindowSeconds: pricing.renewWindowSeconds,
      minSessionMinutes: pricing.minSessionMinutes,
      maxSessionMinutes: pricing.maxSessionMinutes,
    });
```

`createConnectHandler`/`createRenewHandler` need no logic change (they already return `pricePaidDescription` from `priceDescription`).

- [ ] **Step 4: Typecheck + boot smoke test**

Run: `cd vpn-server && npx tsc --noEmit`
Expected: no errors.

Run: `cd vpn-server && CSPR_PAYTO=01aa npx tsx index.ts` (Ctrl-C after boot)
Expected: prints "Xelt — x402 Resource Server", "Receiver: 01aa", "Casper node: ...", and "✅ Xelt server running". (boringtun health may be degraded — fine here.)

- [ ] **Step 5: Commit**

```bash
git add vpn-server/index.ts vpn-server/handlers/vpn.ts vpn-server/package.json vpn-server/package-lock.json
git commit -m "feat(casper): vpn-server uses Casper scheme + in-process facilitator"
```

---

## Task 14: vpn-server serves the browser payment page

**Files:**
- Create: `vpn-server/services/payPage.ts`
- Modify: `vpn-server/index.ts` (add `GET /pay` route)

**Interfaces:**
- Produces: `payPageHtml(): string` — a minimal HTML page that loads the client-built pay bundle. Because bundling browser JS inside the tsx server is undesirable, `/pay` **redirects** to the client app's `pay.html` (built by Vite / served by the Tauri localhost plugin), preserving query params. This keeps all browser code in the Vite toolchain.

Decision: `GET /pay` 302-redirects to `${PAY_PAGE_BASE}/pay.html?<same query>` where `PAY_PAGE_BASE` defaults to `http://localhost:1421` (Tauri localhost plugin) and is overridable for dev (`http://localhost:1420`).

- [ ] **Step 1: Create `vpn-server/services/payPage.ts`**

```ts
/** Build the redirect target for the browser-signing page. */
export function payPageRedirect(queryString: string): string {
  const base = (process.env.PAY_PAGE_BASE || 'http://localhost:1421').replace(/\/$/, '');
  const qs = queryString ? `?${queryString}` : '';
  return `${base}/pay.html${qs}`;
}
```

- [ ] **Step 2: Add the route in `vpn-server/index.ts`** (near the other `app.get` routes)

```ts
import { payPageRedirect } from './services/payPage.js';

app.get('/pay', (c) => {
  const url = new URL(c.req.url);
  return c.redirect(payPageRedirect(url.searchParams.toString()), 302);
});
```

- [ ] **Step 3: Typecheck**

Run: `cd vpn-server && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add vpn-server/services/payPage.ts vpn-server/index.ts
git commit -m "feat(casper): /pay redirects to the browser-signing page"
```

---

## Task 15: vpn-server .env example

**Files:**
- Modify: `vpn-server/.env.example`

- [ ] **Step 1: Replace `vpn-server/.env.example`**

```bash
# Casper account public key (hex) that receives CSPR payments
CSPR_PAYTO=

# Casper testnet RPC node
CASPER_NODE_URL=https://node.testnet.casper.network/rpc
CASPER_NETWORK_NAME=casper-test

# Optionally verify payer balance before accepting (1 = on)
VERIFY_BALANCE=0

# Server port (x402 API — client connects here)
PORT=4021

# boringtun peer registration API (internal, same host)
BORINGTUN_API_URL=http://localhost:8080

# Where the browser-signing page is served (Tauri localhost plugin in prod, Vite in dev)
PAY_PAGE_BASE=http://localhost:1421

# Pricing: CSPR per minute of VPN session
PRICE_PER_MINUTE_CSPR=0.5

DEFAULT_SESSION_MINUTES=5
MIN_SESSION_MINUTES=1
MAX_SESSION_MINUTES=60
RENEW_WINDOW_SECONDS=30
```

- [ ] **Step 2: Commit**

```bash
git add vpn-server/.env.example
git commit -m "docs(casper): vpn-server env example for Casper"
```

---

## Task 16: Client Casper wallet bridge

**Files:**
- Create: `client/src/utils/casperWallet.ts`

**Interfaces:**
- Produces:
  - `getCasperProvider(): CasperWalletProvider` — wraps `window.CasperWalletProvider()`
  - `connectCasperWallet(): Promise<string>` — request connection, return active public key hex
  - `makeCasperSigner(publicKeyHex): ClientCasperSigner` — bridges `provider.sign` to the scheme's `signDeployJson`

This runs in the **system browser** (pay page), where the Casper Wallet extension injects `window.CasperWalletProvider`.

- [ ] **Step 1: Create `client/src/utils/casperWallet.ts`**

```ts
import type { ClientCasperSigner } from '@x402-casper';

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
```

IMPLEMENTER NOTE: verify the Casper Wallet provider method names/shape against the official Casper Wallet SDK docs (`requestConnection`, `getActivePublicKey`, `sign(deployJson, pubKeyHex) -> { cancelled, signatureHex }`). These match the documented provider API; adjust only if the installed extension differs.

- [ ] **Step 2: Commit**

```bash
git add client/src/utils/casperWallet.ts
git commit -m "feat(casper): client Casper Wallet provider bridge"
```

---

## Task 17: Client x402 fetch wired to the Casper scheme

**Files:**
- Modify: `client/src/utils/x402Vpn.ts`
- Modify: `client/package.json` (swap deps)

**Interfaces:**
- Consumes: `@x402/fetch` (`x402Client`, `wrapFetchWithPayment`, `decodePaymentResponseHeader`), `@x402-casper` (`CASPER_TESTNET_CAIP2`), `@x402-casper/exact/client` (`ExactCasperScheme`), `casperWallet.ts`.
- Produces: `createX402Fetch(signer: ClientCasperSigner)`, with `vpnConnectWithPayment` / `vpnRenewWithPayment` taking a `ClientCasperSigner` instead of an Algorand signer. The session-status / pricing / health helpers stay (rename `priceUSDC`→`priceCSPR` usage if referenced).

- [ ] **Step 1: Edit `client/package.json`** — dependencies

Remove: `@perawallet/connect`, `@txnlab/use-wallet-react`, `algosdk`, `@x402/avm`, `@walletconnect/modal`, `@walletconnect/sign-client`.
Add:

```json
    "@x402-casper": "file:../packages/x402-casper",
    "casper-js-sdk": "^5.0.12",
```

Keep `@x402/core`, `@x402/fetch`, `react`, `react-dom`, Tauri deps, buffer/process/util polyfills.

Run: `cd client && npm install`
Expected: resolves with the local `@x402-casper` linked.

- [ ] **Step 2: Replace the wallet-signing core of `client/src/utils/x402Vpn.ts`**

Replace the top imports:

```ts
import { x402Client, wrapFetchWithPayment, decodePaymentResponseHeader } from '@x402/fetch';
import { CASPER_TESTNET_CAIP2 } from '@x402-casper';
import type { ClientCasperSigner } from '@x402-casper';
import { ExactCasperScheme } from '@x402-casper/exact/client';
import { isTauri, tauriInvokeSafe } from './tauriBridge';
```

Replace `createX402Fetch` entirely:

```ts
/** Build x402-aware fetch using a connected Casper wallet signer. */
export async function createX402Fetch(signer: ClientCasperSigner) {
  const client = new x402Client();
  client.register(CASPER_TESTNET_CAIP2, new ExactCasperScheme(signer));
  return wrapFetchWithPayment(fetch, client);
}
```

Change `vpnConnectWithPayment` / `vpnRenewWithPayment` first parameter type from the Algorand wallet object to `signer: ClientCasperSigner`, and pass `signer` to `createX402Fetch(signer)`. The body/URL logic is unchanged. Keep `formatPaymentError`, `fetchSessionStatus`, `fetchServerHealth`, `fetchPricing`, base-URL helpers as-is.

- [ ] **Step 3: Typecheck the client**

Run: `cd client && npx tsc --noEmit`
Expected: errors only in `App.tsx` / `WalletApp.tsx` (use-wallet removal) — fixed in Tasks 20–21. `x402Vpn.ts` itself clean.

- [ ] **Step 4: Commit**

```bash
git add client/src/utils/x402Vpn.ts client/package.json client/package-lock.json
git commit -m "feat(casper): client x402 fetch uses Casper exact scheme"
```

---

## Task 18: Client pay page (system-browser entry)

**Files:**
- Create: `client/pay.html`
- Create: `client/src/pay/main.tsx`
- Modify: `client/vite.config.ts` (multi-entry build)

**Interfaces:**
- Consumes: `casperWallet.ts`, `x402Vpn.ts` (`vpnConnectWithPayment`).
- Produces: a standalone page at `/pay.html?wgPub=..&duration=..&server=..&cb=..` that connects Casper Wallet, pays via x402, then POSTs the peer config to `http://localhost:<cb>/connected`.

- [ ] **Step 1: Create `client/pay.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Xelt - Pay Per Use VPN</title>
  </head>
  <body>
    <div id="pay-root"></div>
    <script type="module" src="/src/pay/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `client/src/pay/main.tsx`**

```tsx
import '../polyfills';
import { connectCasperWallet, makeCasperSigner } from '../utils/casperWallet';
import { vpnConnectWithPayment, setCachedApiBase } from '../utils/x402Vpn';

const params = new URLSearchParams(window.location.search);
const wgPub = params.get('wgPub') ?? '';
const duration = Number(params.get('duration') ?? '5');
const serverBase = params.get('server') ?? 'http://localhost:4021';
const callbackPort = params.get('cb') ?? '';

const root = document.getElementById('pay-root')!;
function render(msg: string, isError = false) {
  root.innerHTML = `<div style="font-family:system-ui;max-width:420px;margin:40px auto;padding:24px">
    <h2>Xelt — Casper payment</h2>
    <p style="color:${isError ? '#c00' : '#222'}">${msg}</p>
  </div>`;
}

async function run() {
  try {
    if (!wgPub || !callbackPort) throw new Error('Missing wgPub/cb parameters.');
    setCachedApiBase(serverBase);
    render('Connect your Casper Wallet to continue…');
    const publicKeyHex = await connectCasperWallet();
    const signer = makeCasperSigner(publicKeyHex);
    render('Approve the CSPR payment in Casper Wallet…');
    const paid = await vpnConnectWithPayment(signer, wgPub, duration, serverBase);
    render('Payment confirmed — starting your VPN tunnel. You can return to the Xelt app.');
    await fetch(`http://localhost:${callbackPort}/connected`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        server_public_key: paid.server_public_key,
        endpoint: paid.endpoint,
        assigned_ip: paid.assigned_ip,
        expires_at: paid.expiresAt ?? null,
        wallet_address: publicKeyHex,
      }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    render(`Payment failed: ${msg}`, true);
    if (callbackPort) {
      fetch(`http://localhost:${callbackPort}/error`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: msg }),
      }).catch(() => {});
    }
  }
}

run();
```

NOTE: `setCachedApiBase` is already exported from `x402Vpn.ts`. The pay page calls the vpn-server cross-origin; the server already sends wildcard CORS headers.

- [ ] **Step 3: Edit `client/vite.config.ts`** — register the second entry

Add a `build.rollupOptions.input` map with both `index.html` and `pay.html`:

```ts
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        pay: 'pay.html',
      },
    },
  },
```

(Merge into the existing `defineConfig` object; keep existing plugins/server config.)

- [ ] **Step 4: Build smoke test**

Run: `cd client && npx vite build`
Expected: emits both `dist/index.html` and `dist/pay.html` with no errors.

- [ ] **Step 5: Commit**

```bash
git add client/pay.html client/src/pay/main.tsx client/vite.config.ts
git commit -m "feat(casper): browser-signing pay page (Vite entry)"
```

---

## Task 19: Tauri localhost callback server

**Files:**
- Create: `client/src-tauri/src/callback.rs`
- Modify: `client/src-tauri/src/lib.rs`
- Modify: `client/src-tauri/Cargo.toml`

**Interfaces:**
- Produces:
  - Tauri command `open_payment_browser(app, wg_pub: String, duration: u32, server_base: String) -> Result<(), String>` — starts a one-shot localhost callback HTTP server on an ephemeral port, opens the system browser to `${server_base}/pay?wgPub=..&duration=..&server=..&cb=<port>`, and on receiving the callback emits a `payment-complete` (or `payment-error`) event to the webview.
  - Event `payment-complete` payload = `PaidSessionRegistration` + `wallet_address`.

- [ ] **Step 1: Add `tiny_http` to `client/src-tauri/Cargo.toml`** dependencies

```toml
tiny_http = "0.12"
```

- [ ] **Step 2: Create `client/src-tauri/src/callback.rs`**

```rust
use std::io::Read;
use std::net::TcpListener;
use std::time::Duration;

use serde::Serialize;
use tauri::Emitter;
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Serialize, Clone)]
pub struct PaymentCompletePayload {
    pub server_public_key: String,
    pub endpoint: String,
    pub assigned_ip: String,
    pub expires_at: Option<String>,
    pub wallet_address: String,
}

/// Start a one-shot callback server, open the browser to the pay page, and emit
/// `payment-complete` / `payment-error` when the page reports back.
#[tauri::command]
pub async fn open_payment_browser(
    app: tauri::AppHandle,
    wg_pub: String,
    duration: u32,
    server_base: String,
) -> Result<(), String> {
    // Bind an ephemeral localhost port for the callback.
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind callback port: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to read callback port: {e}"))?
        .port();
    let server = tiny_http::Server::from_listener(listener, None)
        .map_err(|e| format!("Failed to start callback server: {e}"))?;

    // Open the system browser at the pay page (server_base /pay redirects to pay.html).
    let url = format!(
        "{}/pay?wgPub={}&duration={}&server={}&cb={}",
        server_base.trim_end_matches('/'),
        urlencoding(&wg_pub),
        duration,
        urlencoding(&server_base),
        port,
    );
    app.shell()
        .open(&url, None)
        .map_err(|e| format!("Failed to open browser: {e}"))?;

    // Wait (in a blocking task) for one callback request, then emit the event.
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Stop waiting after 5 minutes.
        let deadline = std::time::Instant::now() + Duration::from_secs(300);
        loop {
            match server.recv_timeout(Duration::from_secs(5)) {
                Ok(Some(mut request)) => {
                    let path = request.url().to_string();
                    let mut body = String::new();
                    let _ = request.as_reader().read_to_string(&mut body);
                    let _ = request.respond(tiny_http::Response::from_string("ok").with_status_code(200));

                    if path.starts_with("/connected") {
                        if let Ok(payload) = serde_json::from_str::<PaymentCompletePayload>(&body) {
                            let _ = app_handle.emit("payment-complete", &payload);
                        } else {
                            let _ = app_handle.emit("payment-error", "Malformed callback payload");
                        }
                        break;
                    } else if path.starts_with("/error") {
                        let _ = app_handle.emit("payment-error", body);
                        break;
                    }
                }
                Ok(None) => {
                    if std::time::Instant::now() > deadline {
                        let _ = app_handle.emit("payment-error", "Payment timed out");
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    Ok(())
}

/// Minimal percent-encoding for URL query values.
fn urlencoding(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}
```

IMPLEMENTER NOTE: confirm `tiny_http::Server::from_listener` signature in 0.12 (it takes the listener and an optional SSL config `Option<SslConfig>`; pass `None`). If unavailable, use `tiny_http::Server::http("127.0.0.1:0")` and read the bound port via `server.server_addr()`.

- [ ] **Step 3: Wire into `client/src-tauri/src/lib.rs`**

Add `mod callback;` at the top with the other mods. Add `callback::open_payment_browser` to `tauri::generate_handler![ ... ]`. (Shell plugin is already initialized.)

- [ ] **Step 4: Build the Rust app**

Run: `cd client/src-tauri && cargo build`
Expected: compiles. Fix any `tiny_http` API mismatch per the implementer note.

- [ ] **Step 5: Commit**

```bash
git add client/src-tauri/src/callback.rs client/src-tauri/src/lib.rs client/src-tauri/Cargo.toml client/src-tauri/Cargo.lock
git commit -m "feat(casper): Tauri localhost callback + open payment browser"
```

---

## Task 20: Client App.tsx — browser-signing connect flow

**Files:**
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: Tauri command `open_payment_browser`, events `payment-complete` / `payment-error`, existing `connect_paid`.
- Produces: CONNECT now opens the browser to pay; on `payment-complete` it calls `connect_paid` with the returned registration; renew uses the same browser flow.

- [ ] **Step 1: Remove the `useWallet` dependency**

Delete `import { useWallet } from "./WalletApp";` and the `const { wallets, activeAddress, isReady, signTransactions } = useWallet();` line. Replace `activeAddress` usage: the app no longer holds a wallet address before paying (the wallet lives in the browser). Introduce local state `const [paying, setPaying] = useState(false);` and drop the wallet modal (the browser handles wallet selection).

- [ ] **Step 2: Replace `doConnect`** with the browser-signing flow

```ts
  const doConnect = async () => {
    if (tauriReady === false) {
      setError("Use the Xelt desktop window (menu bar icon).");
      return;
    }
    try {
      setError(null);
      setSuccessMessage(null);
      await tauriInvokeSafe<boolean>("check_sudo").then(setSudoReady).catch(() => {});

      const { fetchServerHealth, fetchSessionStatus } = await import("./utils/x402Vpn");
      const health = await fetchServerHealth(SERVER_IP);
      if (!health.serverReachable || !health.boringtunOk) {
        setBackendReady(false);
        setBackendMessage(health.message);
        throw new Error(health.message ?? "VPN backend not ready");
      }

      const wgPubkey = await tauriInvokeSafe<string>("get_pubkey");
      const existing = await fetchSessionStatus(wgPubkey, SERVER_IP);

      if (existing.active && existing.serverPublicKey && existing.endpoint && existing.assignedIp) {
        setSuccessMessage("Paid session active — starting VPN tunnel (no new payment).");
        await startTunnel({
          server_public_key: existing.serverPublicKey,
          endpoint: existing.endpoint,
          assigned_ip: existing.assignedIp.includes("/") ? existing.assignedIp : `${existing.assignedIp}/32`,
          expires_at: existing.expiresAt ?? null,
          wallet_address: "casper",
        });
        return;
      }

      setConnectPhase("paying");
      setPaying(true);
      const apiBase = health.apiBase ?? `http://${SERVER_IP}:4021`;
      await tauriInvokeSafe("open_payment_browser", {
        wgPub: wgPubkey,
        duration: SESSION_MINUTES,
        serverBase: apiBase,
      });
      // The rest continues in the payment-complete listener (Step 3).
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStatus("disconnected");
      setConnectPhase(null);
      setPaying(false);
    }
  };
```

- [ ] **Step 3: Add `startTunnel` and event listeners**

Add a helper and a `useEffect` that listens for `payment-complete` / `payment-error`:

```ts
  const startTunnel = useCallback(async (reg: {
    server_public_key: string; endpoint: string; assigned_ip: string;
    expires_at: string | null; wallet_address: string;
  }) => {
    setConnectPhase("tunnel");
    setStatus("connecting");
    const info = await withTimeout(
      tauriInvokeSafe<ConnectedInfo>("connect_paid", {
        registration: {
          server_public_key: reg.server_public_key,
          endpoint: reg.endpoint,
          assigned_ip: reg.assigned_ip,
          expires_at: reg.expires_at,
        },
        serverIp: SERVER_IP,
        walletAddress: reg.wallet_address,
      }),
      45_000,
      "VPN setup timed out. Run sudo -v in Terminal, then CONNECT again."
    );
    setAssignedIp(info.assigned_ip);
    setWalletAddress(info.wallet_address);
    setBalance(info.gateway_balance);
    setStatus("connected");
    setConnectPhase(null);
    setPaying(false);
    await refreshPublicIp("after");
  }, [refreshPublicIp]);

  useEffect(() => {
    if (tauriReady !== true) return;
    const unsubs: Array<() => void> = [];
    tauriListenSafe<{
      server_public_key: string; endpoint: string; assigned_ip: string;
      expires_at: string | null; wallet_address: string;
    }>("payment-complete", (reg) => {
      startTunnel(reg).catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setStatus("disconnected"); setConnectPhase(null); setPaying(false);
      });
    }).then((u) => unsubs.push(u));
    tauriListenSafe<string>("payment-error", (msg) => {
      setError(msg); setStatus("disconnected"); setConnectPhase(null); setPaying(false);
    }).then((u) => unsubs.push(u));
    return () => unsubs.forEach((fn) => fn());
  }, [tauriReady, startTunnel]);
```

- [ ] **Step 4: Update renew + UI copy**

Change `handleRenewConfirm` to call `open_payment_browser` with the renew duration (reuse the same listener; the pay page calls `/connect` — for renew, point it at `/renew` by adding a `route` param to the pay flow OR keep renew via the existing in-app path is not possible without a wallet). Simplest: make the pay page support `&route=renew` and call `vpnRenewWithPayment`; pass `route: 'renew'` through `open_payment_browser` (add a `route` arg and query param). Update `main.tsx` to branch on `params.get('route')`.

Replace Algorand-specific copy: "Connect Algorand Wallet" → remove (browser handles it); `ALGO` label → `CSPR`; "x402 · N min session" stays. Remove the wallet modal JSX and `handleWalletConnect`. The CONNECT button no longer requires a pre-connected wallet.

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: errors only in `WalletApp.tsx` (removed next task) and `main.tsx` if it imports WalletApp.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.tsx client/src/pay/main.tsx
git commit -m "feat(casper): App connect/renew via browser-signing flow"
```

---

## Task 21: Remove use-wallet provider; mount App directly

**Files:**
- Modify: `client/src/main.tsx`
- Delete: `client/src/WalletApp.tsx`

**Interfaces:**
- Produces: `main.tsx` renders `<App />` directly (no `WalletProvider`).

- [ ] **Step 1: Inspect `client/src/main.tsx`**

Run: `sed -n '1,40p' client/src/main.tsx`
Expected: shows it currently renders `WalletApp`.

- [ ] **Step 2: Edit `client/src/main.tsx`** — render `App` directly

Replace the `WalletApp` import and usage with:

```tsx
import App from './App';
```

and render `<App />` where `<WalletApp />` was.

- [ ] **Step 3: Delete `client/src/WalletApp.tsx`**

Run: `git rm client/src/WalletApp.tsx`

- [ ] **Step 4: Typecheck + build**

Run: `cd client && npx tsc --noEmit && npx vite build`
Expected: no errors; emits `index.html` + `pay.html`.

- [ ] **Step 5: Commit**

```bash
git add client/src/main.tsx
git commit -m "feat(casper): drop Algorand use-wallet provider"
```

---

## Task 22: Client env + Tauri connect_paid param rename

**Files:**
- Modify: `client/.env.example`
- Modify: `client/src-tauri/src/lib.rs` and `client/src-tauri/src/vpn.rs` (rename `algorand_address` → `wallet_address`)

**Interfaces:**
- Produces: `connect_paid` accepts `walletAddress` (was `algorandAddress`); env documents Casper.

- [ ] **Step 1: Rename the `connect_paid` param**

In `client/src-tauri/src/lib.rs`, change the `connect_paid` command signature `algorand_address: Option<String>` → `wallet_address: Option<String>` and pass it through. In `client/src-tauri/src/vpn.rs`, rename the `connect_paid` method parameter `algorand_address` → `wallet_address` and update its single use (`algorand_address.unwrap_or_else(|| "algorand".into())` → `wallet_address.unwrap_or_else(|| "casper".into())`). The `ConnectedInfo.wallet_address` field already exists.

- [ ] **Step 2: Replace `client/.env.example`**

```bash
# vpn-server host (x402 API on :4021). 127.0.0.1 for same-machine dev.
VITE_SERVER_IP=127.0.0.1

# Session length in minutes
VITE_SESSION_MINUTES=5

# x402 API base (optional override)
VITE_X402_API_URL=http://localhost:4021
```

- [ ] **Step 3: Build both sides**

Run: `cd client/src-tauri && cargo build`
Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git add client/.env.example client/src-tauri/src/lib.rs client/src-tauri/src/vpn.rs
git commit -m "chore(casper): rename wallet param, Casper client env"
```

---

## Task 23: README + docs

**Files:**
- Modify: `README.md`
- Create: `docs/CASPER_NOTES.md`

- [ ] **Step 1: Update `README.md`** — replace Algorand/Pera/USDC references

- Title note: "Algorand x402 + WireGuard" → "Casper x402 + WireGuard".
- Terminal 2 env: `cp .env.example .env` then set `CSPR_PAYTO` (was `AVM_ADDRESS`).
- Terminal 3: note that CONNECT opens the **system browser** for Casper Wallet signing; ensure the Casper Wallet extension is installed there and funded with testnet CSPR (faucet link).
- Ports table unchanged (4021 / 8080 / 51820).
- Replace the `/pricing` example to show CSPR.

- [ ] **Step 2: Create `docs/CASPER_NOTES.md`** documenting: CAIP-2 `casper:casper-test`, motes math, faucet URL (`https://testnet.cspr.live/tools/faucet`), the browser-signing flow diagram, and how to point at a different RPC (`CASPER_NODE_URL`).

- [ ] **Step 3: Commit**

```bash
git add README.md docs/CASPER_NOTES.md
git commit -m "docs(casper): update README + Casper notes"
```

---

## Task 24: End-to-end manual verification

**Files:** none (verification only).

- [ ] **Step 1: Build the WireGuard server (unchanged)**

Run: `cargo build --release -p boringtun-cli`
Expected: builds.

- [ ] **Step 2: Start the three terminals** per README:
  1. boringtun (registration API on :8080)
  2. `cd vpn-server && npm run dev` with `CSPR_PAYTO` set to a funded testnet key
  3. `cd client && npm run tauri dev`

- [ ] **Step 3: Pre-flight checks**

Run: `curl http://127.0.0.1:4021/health` → `status: ok`, `boringtun.ok: true`
Run: `curl "http://127.0.0.1:4021/pricing?durationMinutes=5"` → shows `priceCSPR` / `pricePerMinuteCSPR`
Run: `curl -X POST http://127.0.0.1:4021/connect -H 'content-type: application/json' -d '{"wireguardPublicKey":"x"}'` → **402 Payment Required** with a Casper `accepts` entry (`network: casper:casper-test`, `extra.asset: CSPR`).

- [ ] **Step 4: Full payment path**

In the desktop app, click CONNECT → system browser opens the pay page → connect Casper Wallet (testnet) → approve the CSPR transfer → browser shows "Payment confirmed" → app receives `payment-complete` → tunnel comes up → Public IP changes and Tunnel IP shows.

Verify on-chain: the deploy hash printed by the server settle appears on `https://testnet.cspr.live`.

- [ ] **Step 5: Renew + disconnect**

Renew within the last 30s window via the browser flow; confirm `secondsRemaining` extends. DISCONNECT restores original IP/DNS.

- [ ] **Step 6: Final commit (docs of results, if any tweaks were needed)**

```bash
git add -A
git commit -m "test(casper): end-to-end verification notes"
```

---

## Notes for the implementer

- The only genuinely new, unit-tested logic lives in `packages/x402-casper` (Tasks 2–10). Get that suite green before touching vpn-server/client.
- Every "IMPLEMENTER NOTE" marks a casper-js-sdk / Casper Wallet API detail to confirm against the installed version — the surrounding tests will catch a wrong guess.
- `protocol/` is never modified.
