<div align="center">

# Xelt

### Pay-per-minute VPN, settled on Casper.

No accounts. No subscriptions. No signup.
Pay a micro-amount of **CSPR** with the [x402](https://x402.org) HTTP-payment
protocol and get an encrypted **WireGuard** tunnel for exactly the time you bought.

`x402` · `Casper` · `WireGuard` · `Tauri`

</div>

---

## Why Xelt

Traditional VPNs want an account, a card, and a monthly plan — even for ten
minutes at an airport. Xelt removes all of it:

- **🔑 No identity** — the payment *is* the auth. Nothing to log into.
- **⏱ Pay per minute** — buy 1 minute or 60. It auto-expires when time's up.
- **🔗 On-chain & verifiable** — every session is a native CSPR transfer, settled on Casper.
- **🔒 Real encryption** — a genuine WireGuard tunnel, not a proxy.

---

## Architecture

```
        ┌────────────────────┐   signs CSPR transfer   ┌──────────────────────┐
        │   Casper Wallet     │ ──────────────────────▶ │    Casper Testnet    │
        │  (system browser)   │                         │   settles the deploy │
        └─────────▲───────────┘                         └──────────▲───────────┘
                  │ opens pay page                                  │ verify + settle
                  │                                                 │
        ┌─────────┴───────────┐   x402  POST /connect   ┌───────────┴──────────┐
        │      Xelt App       │ ──────────────────────▶ │   vpn-server  :4021  │
        │       (Tauri)       │ ◀────────────────────── │   x402 /connect /renew│
        └─────────┬───────────┘   WireGuard peer config └───────────┬──────────┘
                  │                                                  │ POST /v1/register
                  │                                                  ▼
                  │        WireGuard tunnel (UDP :51820)  ┌──────────────────────┐
                  └─────────────────────────────────────▶│   boringtun  :8080   │
                                                          │   WireGuard server   │
                                                          └──────────────────────┘
```

**The flow, step by step:**

1. The app generates a WireGuard keypair and opens the **system browser** at the pay page.
2. The browser connects **Casper Wallet** and pays via x402 → `POST /connect` on the vpn-server.
3. The vpn-server **verifies & settles** the CSPR transfer on Casper, then registers the peer with boringtun.
4. boringtun returns the server public key + assigned tunnel IP; the browser hands it back to the app.
5. The app brings up the local WireGuard tunnel. **You're connected** until the session expires.

> **Why sign in the browser?** The Casper Wallet extension only injects into real
> browsers, not the Tauri WebView — so signing happens in your system browser and the
> result is handed back over a localhost callback. See [docs/CASPER_NOTES.md](docs/CASPER_NOTES.md).

---

## Repo layout

```
xelt/
├── packages/x402-casper/   # x402 payment scheme for native CSPR transfers
├── vpn-server/             # x402 payment API (/connect, /renew) → registers peers
├── protocol/boringtun/     # WireGuard server (Rust, chain-agnostic)
├── client/                 # Tauri desktop app (Casper Wallet + tunnel)
├── server/                 # Docker deploy (optional)
└── docs/                   # x402 reference + Casper notes
```

**`x402-casper`** implements the three x402 scheme roles for native CSPR:

| Role | Does |
|------|------|
| `exact/client` | Builds and signs a native-transfer `Deploy`. |
| `exact/server` | Parses CSPR prices to motes, builds payment requirements. |
| `exact/facilitator` | Verifies the signed deploy (amount, target, chain, signature, TTL, replay) and settles it via the Casper RPC. |

The boringtun WireGuard core is unchanged — it just registers peers and moves packets.

---

## Quickstart

### Prerequisites

- A Casper **Testnet** account funded from the [faucet](https://testnet.cspr.live/tools/faucet).
- The **Casper Wallet** browser extension installed in your system browser.
- **Rust** + **Node**, and `wireguard-tools` recommended on macOS:
  ```bash
  brew install wireguard-tools
  ```

### Run it — three terminals

**Terminal 1 · WireGuard server (boringtun)** — from the repo root:

```bash
# macOS (use tun0 instead of utun on Linux)
cargo build --release --features payment -p boringtun-cli

sudo WG_SUDO=1 \
  BT_PAYMENT_SERVER=0 BT_REGISTRATION_API=1 \
  BT_HTTP_BIND=0.0.0.0:8080 BT_PUBLIC_IP=127.0.0.1 BT_WG_PORT=51820 \
  WG_LOG_LEVEL=info \
  ./target/release/boringtun-cli utun --foreground
```
Verify: `curl http://127.0.0.1:8080/health`

**Terminal 2 · x402 payment server**

```bash
cd vpn-server
cp .env.example .env          # set CSPR_PAYTO to your Casper account public key (hex)
npm install
npm run dev
```
Verify: `curl http://127.0.0.1:4021/health`

**Terminal 3 · desktop client**

```bash
cd client
cp .env.example .env.local    # VITE_SERVER_IP=127.0.0.1
npm install
npm run tauri dev
```

Click **CONNECT** → choose your minutes → approve the CSPR transfer in Casper
Wallet → the tunnel comes up. ✅

---

## Configuration

`vpn-server/.env`:

| Env var | Meaning |
|---------|---------|
| `CSPR_PAYTO` | Casper account public key (hex) that **receives** CSPR. |
| `CASPER_NODE_URL` | Testnet RPC node (default `https://node.testnet.casper.network/rpc`). |
| `CASPER_NETWORK_NAME` | `casper-test`. |
| `PRICE_PER_MINUTE_CSPR` | CSPR per minute (default `2.5`). |
| `PAY_PAGE_BASE` | Where the browser-signing page is served (`http://localhost:1420` in dev). |

> **Native transfer floor:** Casper requires a minimum native transfer of **2.5 CSPR**
> (plus ~0.1 CSPR gas). The default rate of 2.5 CSPR/min makes even a 1-minute
> session a valid transfer. Each session is one transfer — a prepaid model.

### Ports

| Port | Service |
|------|---------|
| `4021` | x402 payment API |
| `8080` | boringtun peer registration |
| `51820/udp` | WireGuard |
| `1420` | client pay page (Vite, dev) |

---

## Tests

```bash
cd packages/x402-casper && npm test   # scheme unit tests (vitest)
```

## Docker (optional, for production)

```bash
cd server
cp .env.example .env
docker compose up --build
```

---

## Notes

- **Same-machine dev** (`127.0.0.1`) is great for the full pay → tunnel flow. For
  real internet **egress** through the VPN, run boringtun on a Linux VPS with IP
  forwarding + NAT enabled (the Docker `entrypoint.sh` sets this up automatically).
- For same-machine demos that keep your internet alive, run the client with
  `XELT_SPLIT_TUNNEL=1` — it brings up the tunnel without hijacking your default route.
- Funded a testnet account? View your settled deploys at
  [testnet.cspr.live](https://testnet.cspr.live).
