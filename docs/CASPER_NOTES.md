# Casper Notes

How Xelt's payment layer maps onto Casper Network.

## Identifiers and units

- **CAIP-2 network id:** `casper:casper-test` (testnet). Mainnet would be `casper:casper`.
- **Chain name** (in the deploy header): `casper-test`.
- **Token:** native **CSPR**. 1 CSPR = 1,000,000,000 motes (9 decimals).
  `PaymentRequirements.amount` is a **motes string**.
- **Native transfer floor:** Casper requires a minimum native transfer of
  2.5 CSPR (`2500000000` motes); the payer also pays ~0.1 CSPR gas. Every
  payment (`/connect` or `/renew`) is a single native transfer of
  `durationMinutes × PRICE_PER_MINUTE_CSPR`, so that product must be ≥ 2.5.
  The default rate is **2.5 CSPR/min**, which makes even a 1-minute session a
  valid transfer. This is a **prepaid session** model (one transfer per session),
  not streaming per-second billing — true micro-streaming would need a CEP-18
  token or a deposit/escrow contract (see "Out of scope" in the design).

## The `x402-casper` package

A faithful port of `@x402/avm` to Casper, implementing the three `@x402/core`
scheme roles for native CSPR transfers:

- `x402-casper/exact/client` — builds and signs a native-transfer `Deploy`.
- `x402-casper/exact/server` — parses CSPR prices to motes, builds requirements.
- `x402-casper/exact/facilitator` — verifies the signed deploy (transfer, target,
  amount, chain, signature, TTL, replay) and settles it via the Casper RPC
  (`account_put_deploy` + poll `info_get_deploy`).
- `LocalFacilitatorClient` — runs the facilitator in-process so `vpn-server` needs
  no separate facilitator service.

### casper-js-sdk import note

`casper-js-sdk` ships a UMD/CJS bundle whose exports resolve differently under
CJS (tsx in `vpn-server`) vs ESM (Vite/vitest). `src/casper.ts` normalizes both
into one object — import the SDK from there (`import Casper from './casper.ts'`),
not directly.

## Browser-based signing

The Casper Wallet extension injects `window.CasperWalletProvider` only into real
browsers, **not** the Tauri WebView. So:

```
1. App (Tauri) generates a WireGuard keypair, starts a one-shot localhost
   callback server, and opens the system browser at:
      <vpn-server>/pay?wgPub=..&duration=..&server=..&cb=<port>&route=connect|renew
   (vpn-server /pay 302-redirects to the client pay.html, served by the Tauri
    localhost plugin on :1421 in prod, or Vite on :1420 in dev.)
2. The pay page connects Casper Wallet, runs the x402 fetch to /connect (or
   /renew), and signs the CSPR transfer in the extension.
3. The page POSTs the resulting WG peer config to http://localhost:<cb>/connected.
4. The app receives a `payment-complete` event and brings up the tunnel.
```

## Using a different RPC node

Set `CASPER_NODE_URL` in `vpn-server/.env` (e.g. a CSPR.cloud testnet endpoint).
Set `VERIFY_BALANCE=1` to have the facilitator check the payer's main-purse
balance via `query_balance` before accepting a payment.

## Faucet

Fund a testnet account at <https://testnet.cspr.live/tools/faucet>, then view
settled deploys at <https://testnet.cspr.live>.
