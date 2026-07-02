# Xelt → Casper Network Port — Design

**Date:** 2026-06-28
**Status:** Approved (design phase)

## Goal

Port Xelt — currently an Algorand x402 + WireGuard pay-per-use VPN — to the
**Casper Network**, keeping the same architecture and UX: a desktop client pays a
micro-payment per VPN session, and an encrypted WireGuard tunnel is brought up
for the paid duration. The payment rail moves from Algorand (x402 via
`@x402/avm`, USDC ASA, Pera wallet) to **Casper testnet (native CSPR, Casper
Wallet)**.

## Decisions (locked)

| Topic | Decision |
|-------|----------|
| Payment layer | Build a real `@x402-casper` scheme + facilitator that plugs into `@x402/core` (faithful port of `@x402/avm`). |
| Payment token | Native **CSPR** (motes, 9 decimals). No CEP-18. |
| Wallet | **Casper Wallet** browser extension. |
| Network | **Casper Testnet** (`casper:casper-test`). |
| Client signing | **Browser-based**: Tauri opens the system browser (where the extension lives), signs there, returns the result to the app via a localhost callback. |
| Facilitator deployment | **Embedded in-process** (default), structured so it can be split into a standalone HTTP service later. |
| Casper SDK | `casper-js-sdk` latest v5. |

## Scope

### Unchanged
- `protocol/` (boringtun WireGuard server). It is chain-agnostic — it registers
  peers over an HTTP API (`/v1/register`). No Casper code touches it.
- `vpn-server/` business logic: `handlers/vpn.ts`, `services/boringtun.ts`,
  `services/sessionStore.ts`, `services/sessionExpiry.ts` keep their logic;
  only payment wiring, pricing units, and labels change.

### New
- `packages/x402-casper/` — the Casper payment scheme (faithful `@x402/avm` port).
- `casper-facilitator` — verify/settle logic against Casper RPC, embedded in
  vpn-server via a `LocalFacilitatorClient`.

### Modified
- `vpn-server/` — payment wiring, CSPR pricing, env vars, a static `/pay` page.
- `client/` — Casper Wallet + `casper-js-sdk`, browser-signing flow, Tauri
  localhost callback.

## Architecture

### The `@x402-casper` package

Mirrors `@x402/avm`'s subpath exports, each implementing the corresponding
`@x402/core` interface (verified against `@x402/core` 2.17.0 type defs).

- **`exact/client`** → `class ExactCasperScheme implements SchemeNetworkClient`
  - `readonly scheme = "exact"`
  - `createPaymentPayload(x402Version, paymentRequirements, context?)`:
    builds a **native CSPR transfer Deploy** (`amount` motes → `payTo`, with a
    `transferId`), signs it via an injected `ClientCasperSigner`
    (Casper Wallet), returns
    `{ x402Version, payload: { signedDeploy, payer, transferId } }`.

- **`exact/server`** → `class ExactCasperScheme implements SchemeNetworkServer`
  - `parsePrice(price, network)`: converts `"$X"` / CSPR `Money` →
    `{ asset: "CSPR", amount: <motes> }` (9 decimals). Supports a money-parser
    chain like the AVM server.
  - `enhancePaymentRequirements(...)`: returns requirements with CSPR asset.
  - `getAssetDecimals()` → 9.

- **`exact/facilitator`** → `class ExactCasperScheme implements SchemeNetworkFacilitator`
  - `readonly caipFamily = "casper:*"`, `getSigners() = []`,
    `getExtra() = undefined` (no fee-payer/gasless needed — payer pays own gas).
  - `verify(payload, requirements)`: decode the signed deploy; assert it is a
    native transfer, `target == payTo`, `amount == requirements.amount`,
    `chain_name` matches network, signature valid, TTL not expired; optional
    `speculative_exec` for balance; replay-guard on deploy hash. Returns
    `VerifyResponse { isValid, invalidReason?, payer? }`.
  - `settle(payload, requirements)`: submit via `account_put_deploy`, poll
    `info_get_deploy` until execution succeeds, return
    `SettleResponse { success, transaction: <deployHash>, network, payer }`.

- **`index`** → constants `CASPER_TESTNET_CAIP2 = "casper:casper-test"`,
  `CSPR_ASSET = "CSPR"`, and `ClientCasperSigner` / `FacilitatorCasperConfig`
  types.

**Payload shape** (`PaymentPayload.payload`):
```
{ signedDeploy: string /* base64(JSON deploy) */, payer: string /* pubkey hex */, transferId: string }
```

**Why simpler than AVM:** native CSPR transfers need no fee-payer transaction
and no atomic 2-transaction group — a single signed transfer covers it.

### Facilitator (embedded)

`x402ResourceServer` accepts a `FacilitatorClient`. We provide a
`LocalFacilitatorClient` that wraps `x402Facilitator` registered with
`ExactCasperScheme(facilitator)`, so vpn-server verifies/settles in-process.
It talks to a Casper testnet RPC node (`CASPER_NODE_URL`) and keeps an in-memory
replay store of settled deploy hashes. Splitting into a standalone HTTP
facilitator (matching `HTTPFacilitatorClient`) is a later option without
touching the scheme.

### `vpn-server/` changes

- `index.ts`: `x402Server.register(CASPER_TESTNET_CAIP2, new ExactCasperScheme())`;
  facilitator = `LocalFacilitatorClient`. New env:
  `CSPR_PAYTO` (Casper account public-key hex), `CASPER_NODE_URL`,
  `CASPER_NETWORK_NAME=casper-test` (replacing `AVM_ADDRESS` / `FACILITATOR_URL`).
- `endpoints.config.ts`: `network: CASPER_TESTNET_CAIP2`, asset CSPR, CSPR price.
- `services/pricing.ts`: `pricePerMinuteCSPR` with motes math.
- `handlers/vpn.ts`, `services/boringtun.ts`, session store/expiry: logic
  unchanged; wording/labels only.
- Serves a static **payment page** at `/pay` (same-origin with the API → no CORS
  friction for the browser-signing step).

### `client/` changes — browser-signing flow

```
1. User clicks CONNECT in the Tauri app.
2. Tauri generates a WireGuard keypair, starts a localhost callback listener,
   opens the system browser at  <vpn-server>/pay?wgPub=...&duration=...
3. The browser page connects Casper Wallet, runs the x402 fetch to /connect
   (signs the CSPR transfer in the extension), receives the WG peer config.
4. The browser POSTs the peer config to  http://localhost:<cb>/connected
5. Tauri brings up the WireGuard tunnel (its private key + received peer config)
   and shows connected.
```

- Remove `@perawallet/connect`, `@txnlab/use-wallet-react`, `algosdk`,
  `@x402/avm`. Add `casper-js-sdk`, `@x402-casper`, Casper Wallet provider glue.
- `src/utils/x402Vpn.ts`: register `ExactCasperScheme(clientSigner)` into
  `x402Client`; the signer bridges to `window.CasperWalletProvider.signDeploy`.
- Tauri Rust: WG keypair generation already exists in `vpn.rs`; add a localhost
  callback server (`callback.rs`) and browser-open via
  `@tauri-apps/plugin-shell`.

## Casper specifics

- CAIP-2 identifier: `casper:casper-test`.
- Amounts in **motes** (1 CSPR = 1,000,000,000 motes; 9 decimals).
- Native transfer Deploy built with `casper-js-sdk` (v5), signed by Casper Wallet
  `signDeploy`.
- `payTo` = Casper account public-key hex (native transfers target a public key
  / account hash).
- Testnet RPC via `CASPER_NODE_URL`; CSPR funded from the Casper testnet faucet.

## Testing

- **Unit:** `parsePrice` motes conversion; `verify` cases — good payment, wrong
  amount, wrong recipient, bad signature, expired TTL, replay.
- **Integration:** facilitator `verify`/`settle` against testnet (or mocked RPC).
- **Manual e2e:** updated 3-terminal README flow (boringtun → vpn-server →
  client), connecting Casper Wallet and confirming a real testnet transfer brings
  up the tunnel.

## Error handling

Mirrors current behavior: HTTP 402 with structured reasons, payment-response
header decoding, insufficient-CSPR, wallet-cancel, and RPC-down surfaced through
the same `formatPaymentError` path in the client.

## Out of scope

- Mainnet / real CSPR.
- CEP-18 token payments.
- A publicly published `@x402-casper` npm package (kept workspace-local).
- Removing the legacy in-tunnel EVM payment code in `protocol/boringtun/src/payment/`
  (already disabled via `BT_PAYMENT_SERVER=0`; left untouched).
</content>
</invoke>
