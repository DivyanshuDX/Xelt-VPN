import '../polyfills';
import { connectCasperWallet, makeCasperSigner } from '../utils/casperWallet';
import {
  vpnConnectWithPayment,
  vpnRenewWithPayment,
  setCachedApiBase,
} from '../utils/x402Vpn';

const params = new URLSearchParams(window.location.search);
const wgPub = params.get('wgPub') ?? '';
const duration = Number(params.get('duration') ?? '5');
const serverBase = params.get('server') ?? 'http://localhost:4021';
const callbackPort = params.get('cb') ?? '';
const route = params.get('route') === 'renew' ? 'renew' : 'connect';

const root = document.getElementById('pay-root')!;

function injectStyles() {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap';
  document.head.appendChild(link);

  const style = document.createElement('style');
  style.textContent = `
    :root{--paper:#fafaf8;--ink:#0a0a0a;--indigo:#5b5bff;--pink:#ff4fcb;--sun:#ffe600;--ember:#ff7a00;--sky:#00b3ff;--green:#1bbf73;--mute:#8a8a85}
    *{margin:0;padding:0;box-sizing:border-box}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center;
      background:var(--paper);color:var(--ink);font-family:"Space Grotesk",system-ui,sans-serif;padding:24px;
      background-image:radial-gradient(var(--ink) 0.5px,transparent 0.5px);background-size:6px 6px;background-color:var(--paper)}
    .card{width:100%;max-width:440px;background:var(--paper);border:2px solid var(--ink);border-radius:18px;
      box-shadow:8px 8px 0 var(--ink);padding:28px}
    .brand{display:flex;align-items:center;gap:12px;margin-bottom:4px}
    .logo-badge{position:relative;width:36px;height:36px;border-radius:50%;background:var(--ink);display:grid;place-items:center;flex-shrink:0}
    .logo-badge .sun{width:11px;height:11px;border-radius:50%;background:var(--sun)}
    .logo-badge .pink{position:absolute;top:-2px;right:-2px;width:11px;height:11px;border-radius:50%;background:var(--pink)}
    .brand-text{display:flex;flex-direction:column}
    .wm{font-family:"Bebas Neue",Impact,sans-serif;font-size:34px;line-height:0.9;letter-spacing:.05em}
    .eyebrow{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--mute)}
    .step{display:flex;align-items:center;gap:10px;margin-top:20px;font-size:15px;font-weight:500}
    .dot{width:12px;height:12px;border-radius:50%;border:2px solid var(--ink);flex-shrink:0}
    .dot.live{background:var(--sun);animation:pulse 1.4s ease-in-out infinite}
    .dot.ok{background:var(--green)}
    .dot.bad{background:var(--ember)}
    .badge{display:inline-block;margin-top:16px;padding:6px 12px;border:2px solid var(--ink);border-radius:999px;
      font-family:"JetBrains Mono",monospace;font-weight:700;font-size:13px;background:var(--sun)}
    table{margin-top:18px;border-collapse:collapse;width:100%;font-family:"JetBrains Mono",monospace;font-size:12px}
    td{padding:7px 0;border-bottom:1px solid #e5e5e0;vertical-align:top}
    td.k{color:var(--mute);text-transform:uppercase;font-size:10px;letter-spacing:.08em;width:34%;white-space:nowrap}
    td.v{word-break:break-all;text-align:right}
    a{color:var(--indigo);text-decoration:none;font-weight:700}
    a:hover{text-decoration:underline}
    .hint{margin-top:18px;font-size:12px;color:var(--mute);line-height:1.5}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
    @media (prefers-reduced-motion:reduce){.dot.live{animation:none}}
  `;
  document.head.appendChild(style);
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

function shell(inner: string): string {
  return `<div class="card">
    <div class="brand">
      <span class="logo-badge"><span class="sun"></span><span class="pink"></span></span>
      <span class="brand-text"><span class="wm">Xelt</span><span class="eyebrow">Casper payment</span></span>
    </div>
    ${inner}
  </div>`;
}

type Phase = 'live' | 'ok' | 'bad';
function renderStep(text: string, phase: Phase = 'live') {
  root.innerHTML = shell(`<div class="step"><span class="dot ${phase}"></span><span>${esc(text)}</span></div>`);
}

function renderSuccess(paid: {
  pricePaidDescription?: string;
  durationMinutes?: number;
  expiresAt?: string;
  assigned_ip?: string;
  transactionHash?: string;
}) {
  const rows: Array<[string, string]> = [];
  if (paid.durationMinutes != null) rows.push(['Session', `${paid.durationMinutes} min`]);
  if (paid.expiresAt) rows.push(['Expires', new Date(paid.expiresAt).toLocaleString()]);
  if (paid.assigned_ip) rows.push(['Tunnel IP', paid.assigned_ip]);

  const tx = paid.transactionHash;
  const txRow = tx
    ? `<tr><td class="k">Deploy</td><td class="v"><a href="https://testnet.cspr.live/deploy/${esc(tx)}" target="_blank" rel="noopener">${esc(tx.slice(0, 10))}…${esc(tx.slice(-8))} ↗</a></td></tr>`
    : '';

  const body = rows
    .map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td class="v">${esc(v)}</td></tr>`)
    .join('');

  const amount = paid.pricePaidDescription ? `<div class="badge">${esc(paid.pricePaidDescription)}</div>` : '';

  root.innerHTML = shell(`
    <div class="step"><span class="dot ok"></span><span>Payment confirmed</span></div>
    ${amount}
    <table>${body}${txRow}</table>
    <p class="hint">Settled on Casper. You can return to the Xelt app — your VPN tunnel is starting.</p>
  `);
}

async function postCallback(path: string, body: unknown) {
  if (!callbackPort) return;
  // The Rust callback server binds 127.0.0.1 (IPv4). On macOS `localhost` can
  // resolve to ::1 (IPv6) first, so posting to `localhost` silently fails to
  // reach it and the app stays stuck on "PAYING…". Try IPv4 first, then fall
  // back to localhost / ::1 so we don't depend on resolver order.
  const hosts = [
    `http://127.0.0.1:${callbackPort}`,
    `http://localhost:${callbackPort}`,
    `http://[::1]:${callbackPort}`,
  ];
  for (const base of hosts) {
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) return;
    } catch {
      /* try next host */
    }
  }
}

async function run() {
  injectStyles();
  try {
    if (!wgPub || !callbackPort) throw new Error('Missing wgPub/cb parameters.');
    setCachedApiBase(serverBase);
    renderStep('Connect your Casper Wallet to continue…');
    const publicKeyHex = await connectCasperWallet();
    const signer = makeCasperSigner(publicKeyHex);
    renderStep(`Approve the CSPR payment for your ${duration}-minute session…`);

    const paid =
      route === 'renew'
        ? await vpnRenewWithPayment(signer, wgPub, duration, serverBase, publicKeyHex)
        : await vpnConnectWithPayment(signer, wgPub, duration, serverBase, publicKeyHex);

    renderSuccess(paid);
    await postCallback('/connected', {
      server_public_key: paid.server_public_key,
      endpoint: paid.endpoint,
      assigned_ip: paid.assigned_ip,
      expires_at: paid.expiresAt ?? null,
      wallet_address: publicKeyHex,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    root.innerHTML = shell(
      `<div class="step"><span class="dot bad"></span><span>Payment failed</span></div><p class="hint">${esc(msg)}</p>`
    );
    await postCallback('/error', { error: msg });
  }
}

run();
