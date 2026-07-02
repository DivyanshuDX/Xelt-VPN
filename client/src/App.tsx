import { useState, useEffect, useCallback, useRef } from "react";
import { tauriInvokeSafe, tauriListenSafe, probeTauriIpc } from "./utils/tauriBridge";
import type { SessionStatus } from "./utils/x402Vpn";

const SERVER_IP = import.meta.env.VITE_SERVER_IP || "127.0.0.1";
const SESSION_MINUTES = Number(import.meta.env.VITE_SESSION_MINUTES || "5");

type VpnStatus = "disconnected" | "connecting" | "connected" | "disconnecting" | "error";

interface ConnectedInfo {
  assigned_ip: string;
  server_endpoint: string;
  wallet_address: string;
  gateway_balance: string;
}

interface VpnStateEvent {
  status: VpnStatus;
  assigned_ip: string | null;
  error: string | null;
}

interface HealthEvent {
  connected: boolean;
  process_alive: boolean;
  handshake_age_secs: number | null;
}

interface PaymentCompleteEvent {
  server_public_key: string;
  endpoint: string;
  assigned_ip: string;
  expires_at: string | null;
  wallet_address: string;
}

type ConnectPhase = "paying" | "tunnel" | "renew" | null;
type SessionAction = "clear" | "renew" | null;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

/** Format a seconds-remaining value as "Xm Ys" (e.g. 246 → "4m 06s"). */
function formatRemaining(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec.toString().padStart(2, "0")}s`;
}

/** Format an ISO expiry timestamp as a local clock time (e.g. "4:08 AM"). */
function formatExpiry(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function App() {
  const [tauriReady, setTauriReady] = useState<boolean | null>(null);
  const [connectPhase, setConnectPhase] = useState<ConnectPhase>(null);
  const [status, setStatus] = useState<VpnStatus>("disconnected");
  const [assignedIp, setAssignedIp] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthEvent | null>(null);
  const [sessionInfo, setSessionInfo] = useState<SessionStatus | null>(null);
  const [renewModalOpen, setRenewModalOpen] = useState(false);
  const [renewMinutes, setRenewMinutes] = useState(SESSION_MINUTES);
  const [renewPrice, setRenewPrice] = useState<string | null>(null);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [connectMinutes, setConnectMinutes] = useState(SESSION_MINUTES);
  const [connectPrice, setConnectPrice] = useState<string | null>(null);
  const [sessionAction, setSessionAction] = useState<SessionAction>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [sudoReady, setSudoReady] = useState<boolean | null>(null);
  const [publicIpBefore, setPublicIpBefore] = useState<string | null>(null);
  const [publicIpAfter, setPublicIpAfter] = useState<string | null>(null);
  const [publicIpLoading, setPublicIpLoading] = useState(false);
  // Ticks every second so the countdown is live (server only polls every few seconds).
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Tracks whether the in-flight browser payment is a connect or a renew.
  const pendingActionRef = useRef<"connect" | "renew">("connect");
  // Guards against starting the tunnel twice (browser callback + polling can both fire).
  const tunnelStartedRef = useRef(false);
  // Minutes of the in-flight renew, so we can show "X min added" on completion.
  const pendingRenewMinutesRef = useRef(0);
  // Guards the auto-disconnect-on-expiry so it only fires once per session.
  const expiredHandledRef = useRef(false);

  // Live seconds remaining: derive from the session expiry + the 1s tick so the
  // timer counts down smoothly and we can detect the exact end.
  const expiresMs = sessionInfo?.expiresAt ? Date.parse(sessionInfo.expiresAt) : null;
  const secondsLeft =
    expiresMs != null && !Number.isNaN(expiresMs)
      ? Math.max(0, Math.floor((expiresMs - nowMs) / 1000))
      : sessionInfo?.secondsRemaining ?? null;

  useEffect(() => {
    let cancelled = false;
    probeTauriIpc().then((ok) => {
      if (!cancelled) setTauriReady(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshPublicIp = useCallback(async (target: "before" | "after") => {
    setPublicIpLoading(true);
    try {
      const { fetchPublicIp } = await import("./utils/publicIp");
      const ip = await fetchPublicIp();
      if (target === "before") setPublicIpBefore(ip);
      else setPublicIpAfter(ip);
    } catch {
      if (target === "before") setPublicIpBefore(null);
      else setPublicIpAfter(null);
    } finally {
      setPublicIpLoading(false);
    }
  }, []);

  const refreshSessionStatus = useCallback(async () => {
    if (tauriReady !== true) return;
    try {
      const wgPubkey = await tauriInvokeSafe<string>("get_pubkey");
      const { fetchSessionStatus } = await import("./utils/x402Vpn");
      const info = await fetchSessionStatus(wgPubkey, SERVER_IP);
      setSessionInfo(info.active ? info : null);
    } catch {
      setSessionInfo(null);
    }
  }, [tauriReady]);

  const startTunnel = useCallback(
    async (reg: PaymentCompleteEvent) => {
      setConnectPhase("tunnel");
      setStatus("connecting");
      if (!publicIpBefore) await refreshPublicIp("before");

      const info = await withTimeout(
        tauriInvokeSafe<ConnectedInfo>("connect_paid", {
          registration: {
            server_public_key: reg.server_public_key,
            endpoint: reg.endpoint,
            assigned_ip: reg.assigned_ip.includes("/") ? reg.assigned_ip : `${reg.assigned_ip}/32`,
            expires_at: reg.expires_at,
          },
          serverIp: SERVER_IP,
          walletAddress: reg.wallet_address,
        }),
        45_000,
        "VPN setup timed out. In Terminal run: sudo -v (enter Mac password), then click CONNECT again."
      );

      setAssignedIp(info.assigned_ip);
      setWalletAddress(info.wallet_address);
      setBalance(info.gateway_balance);
      setStatus("connected");
      setConnectPhase(null);
      await refreshPublicIp("after");
    },
    [publicIpBefore, refreshPublicIp]
  );

  const disconnectTunnel = useCallback(
    async (reason?: "expired") => {
      setConnectPhase(null);
      tunnelStartedRef.current = false;
      setStatus("disconnecting");
      try {
        await tauriInvokeSafe("disconnect");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      setStatus("disconnected");
      setAssignedIp(null);
      setHealth(null);
      setPublicIpAfter(null);
      if (reason === "expired") {
        // Session ran out — drop it so the button reverts to CONNECT.
        setSessionInfo(null);
      } else {
        // Manual disconnect with time left — keep the session so the user can
        // RE-CONNECT without paying again.
        setError(null);
        setSuccessMessage(null);
        refreshSessionStatus();
      }
      refreshPublicIp("before");
    },
    [refreshPublicIp, refreshSessionStatus]
  );

  // VPN status + health events from the tunnel manager.
  useEffect(() => {
    if (tauriReady !== true) return;

    tauriInvokeSafe<VpnStatus>("get_status")
      .then((s) => {
        setStatus(s);
        if (s !== "connecting") setConnectPhase(null);
      })
      .catch(() => {});

    const unsubs: Array<() => void> = [];

    tauriListenSafe<VpnStateEvent>("vpn-state", (payload) => {
      setStatus(payload.status);
      if (payload.assigned_ip) setAssignedIp(payload.assigned_ip);
      if (payload.status === "error") {
        setConnectPhase(null);
        if (payload.error) setError(payload.error);
      }
      if (payload.status === "disconnected" || payload.status === "error") {
        setConnectPhase(null);
      }
      if (payload.status === "disconnected") {
        setAssignedIp(null);
        setHealth(null);
      }
      if (payload.status === "connecting") setError(null);
      if (payload.status === "connected") {
        setConnectPhase(null);
        setError(null);
      }
    }).then((unsub) => unsubs.push(unsub));

    tauriListenSafe<HealthEvent>("vpn-health", (payload) => {
      setHealth(payload);
    }).then((unsub) => unsubs.push(unsub));

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [tauriReady]);

  // Browser-signing payment results.
  useEffect(() => {
    if (tauriReady !== true) return;
    const unsubs: Array<() => void> = [];

    tauriListenSafe<PaymentCompleteEvent>("payment-complete", (reg) => {
      if (pendingActionRef.current === "renew") {
        setSessionAction(null);
        setConnectPhase(null);
        setRenewModalOpen(false);
        const added = pendingRenewMinutesRef.current;
        setSuccessMessage(added > 0 ? `Session renewed - ${added} min added.` : "Session renewed.");
        refreshSessionStatus();
        return;
      }
      // Capture the real Casper account from the callback even if polling
      // already kicked off the tunnel (so the wallet bar shows the payer).
      if (reg.wallet_address) setWalletAddress(reg.wallet_address);
      if (tunnelStartedRef.current) return; // polling already started it
      tunnelStartedRef.current = true;
      startTunnel(reg).catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setStatus("disconnected");
        setConnectPhase(null);
        tunnelStartedRef.current = false;
      });
    }).then((u) => unsubs.push(u));

    tauriListenSafe<string>("payment-error", (msg) => {
      setError(msg);
      setStatus("disconnected");
      setConnectPhase(null);
      setSessionAction(null);
    }).then((u) => unsubs.push(u));

    return () => unsubs.forEach((fn) => fn());
  }, [tauriReady, startTunnel, refreshSessionStatus]);

  useEffect(() => {
    if (tauriReady !== true) {
      setSessionInfo(null);
      return;
    }
    refreshSessionStatus();
    // Poll fast while waiting on a payment so we can auto-start the tunnel as
    // soon as the paid session appears (independent of the browser callback).
    const intervalMs = connectPhase === "paying" ? 2000 : sessionInfo?.active ? 5000 : 30000;
    const id = setInterval(refreshSessionStatus, intervalMs);
    return () => clearInterval(id);
  }, [tauriReady, refreshSessionStatus, sessionInfo?.active, connectPhase]);

  // Reliable handoff: when a paid session is detected while we're waiting on a
  // connect payment, start the tunnel directly from the polled session data.
  // This does not depend on the browser → app HTTP callback (which can fail on
  // macOS loopback/IPv6 quirks), so the app never gets stuck on "PAYING…".
  useEffect(() => {
    if (tauriReady !== true) return;
    if (connectPhase !== "paying" || pendingActionRef.current !== "connect") return;
    if (tunnelStartedRef.current) return;
    if (
      !sessionInfo?.active ||
      !sessionInfo.serverPublicKey ||
      !sessionInfo.endpoint ||
      !sessionInfo.assignedIp
    ) {
      return;
    }
    tunnelStartedRef.current = true;
    setSuccessMessage("Payment detected, VPN tunnel running...");
    startTunnel({
      server_public_key: sessionInfo.serverPublicKey,
      endpoint: sessionInfo.endpoint,
      assigned_ip: sessionInfo.assignedIp.includes("/")
        ? sessionInfo.assignedIp
        : `${sessionInfo.assignedIp}/32`,
      expires_at: sessionInfo.expiresAt ?? null,
      wallet_address: sessionInfo.payerPublicKey ?? "casper",
    }).catch((e) => {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("disconnected");
      setConnectPhase(null);
      tunnelStartedRef.current = false;
    });
  }, [tauriReady, connectPhase, sessionInfo, startTunnel]);

  // Live 1s tick while there's an active session (drives the countdown + expiry).
  useEffect(() => {
    if (status !== "connected" && !sessionInfo?.active) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status, sessionInfo?.active]);

  // When the session timer reaches zero: auto-disconnect if connected, or just
  // drop the idle session (so the button reverts from RE-CONNECT to CONNECT).
  useEffect(() => {
    if (secondsLeft == null) return;
    if (secondsLeft > 0) {
      expiredHandledRef.current = false; // re-arm after a renew extends the time
      return;
    }
    if (!sessionInfo?.expiresAt) return; // only act when we know the real expiry
    if (expiredHandledRef.current) return;
    expiredHandledRef.current = true;
    if (status === "connected") {
      setSuccessMessage("Session time ended - disconnected.");
      void disconnectTunnel("expired");
    } else {
      setSuccessMessage("Session time ended.");
      setSessionInfo(null);
    }
  }, [status, secondsLeft, sessionInfo, disconnectTunnel]);

  useEffect(() => {
    if (tauriReady !== true) return;
    const check = () =>
      tauriInvokeSafe<boolean>("check_sudo").then(setSudoReady).catch(() => setSudoReady(false));
    check();
    const id = setInterval(check, 15000);
    return () => clearInterval(id);
  }, [tauriReady]);

  useEffect(() => {
    if (!renewModalOpen) return;
    let cancelled = false;
    import("./utils/x402Vpn")
      .then(({ fetchPricing }) => fetchPricing(renewMinutes, SERVER_IP))
      .then((quote) => {
        if (!cancelled) setRenewPrice(quote.priceCSPR ?? null);
      })
      .catch(() => {
        if (!cancelled) setRenewPrice(null);
      });
    return () => {
      cancelled = true;
    };
  }, [renewModalOpen, renewMinutes]);

  useEffect(() => {
    if (!connectModalOpen) return;
    let cancelled = false;
    setConnectPrice(null);
    import("./utils/x402Vpn")
      .then(({ fetchPricing }) => fetchPricing(connectMinutes, SERVER_IP))
      .then((quote) => {
        if (!cancelled) setConnectPrice(quote.priceCSPR ?? null);
      })
      .catch(() => {
        if (!cancelled) setConnectPrice(null);
      });
    return () => {
      cancelled = true;
    };
  }, [connectModalOpen, connectMinutes]);

  useEffect(() => {
    if (tauriReady !== true || status === "connected") return;
    refreshPublicIp("before");
  }, [tauriReady, status, refreshPublicIp]);

  const apiBaseFor = async (): Promise<string> => {
    const { ensureX402ApiBase } = await import("./utils/x402Vpn");
    return ensureX402ApiBase(SERVER_IP);
  };

  const doConnect = async () => {
    if (tauriReady === false) {
      setError("Use the Xelt desktop window (menu bar icon), not a browser tab.");
      return;
    }
    try {
      setError(null);
      setSuccessMessage(null);
      tunnelStartedRef.current = false;
      await tauriInvokeSafe<boolean>("check_sudo").then(setSudoReady).catch(() => {});

      const { fetchServerHealth, fetchSessionStatus } = await import("./utils/x402Vpn");
      const health = await fetchServerHealth(SERVER_IP);
      if (!health.serverReachable || !health.boringtunOk) {
        throw new Error(health.message ?? "VPN backend not ready");
      }

      const wgPubkey = await tauriInvokeSafe<string>("get_pubkey");
      const existing = await fetchSessionStatus(wgPubkey, SERVER_IP);

      if (existing.active && existing.serverPublicKey && existing.endpoint && existing.assignedIp) {
        setSuccessMessage("Paid session active - starting VPN tunnel (no new payment).");
        tunnelStartedRef.current = true;
        await startTunnel({
          server_public_key: existing.serverPublicKey,
          endpoint: existing.endpoint,
          assigned_ip: existing.assignedIp.includes("/") ? existing.assignedIp : `${existing.assignedIp}/32`,
          expires_at: existing.expiresAt ?? null,
          wallet_address: existing.payerPublicKey ?? "casper",
        });
        return;
      }

      // No active session → ask for duration + show CSPR cost before signing.
      setConnectMinutes(SESSION_MINUTES);
      setConnectModalOpen(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStatus("disconnected");
      setConnectPhase(null);
    }
  };

  const handleConnectConfirm = async () => {
    if (tauriReady !== true) {
      setError("Use the Xelt desktop window (menu bar icon), not a browser tab.");
      return;
    }
    setConnectModalOpen(false);
    setError(null);
    setSuccessMessage(null);
    setConnectPhase("paying");
    pendingActionRef.current = "connect";
    tunnelStartedRef.current = false;
    try {
      const wgPubkey = await tauriInvokeSafe<string>("get_pubkey");
      const apiBase = await apiBaseFor();
      await tauriInvokeSafe("open_payment_browser", {
        wgPub: wgPubkey,
        duration: connectMinutes,
        serverBase: apiBase,
        route: "connect",
      });
      // Continues in the payment-complete / polling auto-start path.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("disconnected");
      setConnectPhase(null);
    }
  };

  const handleClearSession = async () => {
    if (tauriReady !== true) {
      setError("Use the Xelt desktop window (menu bar icon), not a browser tab.");
      return;
    }
    setSessionAction("clear");
    setError(null);
    setSuccessMessage(null);
    try {
      const wgPubkey = await tauriInvokeSafe<string>("get_pubkey");
      const { clearServerSession } = await import("./utils/x402Vpn");
      await clearServerSession(wgPubkey, SERVER_IP);
      setSessionInfo(null);
      setSuccessMessage("Server session cleared. You can connect again.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSessionAction(null);
    }
  };

  const handleRenewConfirm = async () => {
    if (tauriReady !== true) {
      setError("Use the Xelt desktop window (menu bar icon), not a browser tab.");
      return;
    }
    setSessionAction("renew");
    setConnectPhase("renew");
    setError(null);
    setSuccessMessage(null);
    try {
      const wgPubkey = await tauriInvokeSafe<string>("get_pubkey");
      pendingActionRef.current = "renew";
      pendingRenewMinutesRef.current = renewMinutes;
      const apiBase = await apiBaseFor();
      await tauriInvokeSafe("open_payment_browser", {
        wgPub: wgPubkey,
        duration: renewMinutes,
        serverBase: apiBase,
        route: "renew",
      });
      // Completion handled in the payment-complete listener.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSessionAction(null);
      setConnectPhase(null);
    }
  };

  const handleClick = async () => {
    if (status === "connected" || status === "error") {
      await disconnectTunnel();
    } else if (status === "disconnected") {
      await doConnect();
    }
  };

  const isLoading = status === "connecting" || status === "disconnecting" || connectPhase !== null;
  const isConnected = status === "connected";
  const isError = status === "error";
  const showSessionActions = Boolean(sessionInfo?.active);
  const expiringSoon = isConnected && secondsLeft != null && secondsLeft <= 30;
  // Disconnected but a paid session still has time left → offer a no-payment reconnect.
  const canReconnect = status === "disconnected" && Boolean(sessionInfo?.active);

  const statusLabel = isConnected
    ? expiringSoon
      ? "ENDING SOON"
      : "SECURED"
    : isError
      ? "ERROR"
      : connectPhase === "paying" || connectPhase === "renew"
        ? "PAYING..."
        : connectPhase === "tunnel" || status === "connecting"
          ? "STARTING VPN..."
          : status === "disconnecting"
            ? "DISCONNECTING..."
            : "READY";

  const shortAddr = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  return (
    <div className={`app ${isConnected ? "secured" : ""}`}>
      {tauriReady === false && (
        <div className="error-bar">
          Open this from the Xelt desktop window (menu bar tray icon), not a Chrome tab at localhost:1420.
        </div>
      )}

      {sudoReady === false && (
        <div className="error-bar">
          Admin access required for VPN tunnel. Click CONNECT — macOS will prompt for your password.
        </div>
      )}

      <div className="header" data-tauri-drag-region>
        <span className="logo" data-tauri-drag-region>
          <span className="logo-badge">
            <span className="logo-dot-sun" />
            <span className="logo-dot-pink" />
          </span>
          <span className="logo-word">Xelt</span>
        </span>
        <div className={`status-pill ${isConnected ? "on" : ""} ${isError ? "err" : ""} ${expiringSoon ? "warn" : ""}`}>
          <span className={`status-dot ${isConnected ? "on" : ""} ${isError ? "err" : ""} ${expiringSoon ? "warn" : ""}`} />
          <span className="status-pill-text">{statusLabel}</span>
        </div>
      </div>

      {walletAddress && (
        <div className="wallet-bar">
          <div className="wallet-left">
            <span className="wallet-label">CSPR</span>
            <span className="wallet-addr">{shortAddr(walletAddress)}</span>
          </div>
          <div className="wallet-right">
            <span className="wallet-bal">{balance}</span>
          </div>
        </div>
      )}

      <div className="ip-bar">
        <div className="ip-row">
          <span className="ip-label">Public IP</span>
          <span className="ip-value">
            {publicIpLoading && !publicIpBefore && !publicIpAfter ? "…" : publicIpBefore ?? "—"}
            {isConnected && (
              <>
                <span className="ip-arrow"> → </span>
                {publicIpAfter ?? (publicIpLoading ? "…" : "—")}
              </>
            )}
          </span>
        </div>
        {assignedIp && isConnected && (
          <div className="ip-row">
            <span className="ip-label">Tunnel IP</span>
            <span className="ip-value accent">{assignedIp}</span>
          </div>
        )}
      </div>

      {sessionInfo?.active && secondsLeft != null && (
        <div className="session-box">
          <div className="session-cell">
            <span className="session-cell-label">Time left</span>
            <span className={`session-cell-value ${secondsLeft <= 30 ? "danger" : "accent"}`}>
              {formatRemaining(secondsLeft)}
            </span>
          </div>
          <div className="session-divider" />
          <div className="session-cell">
            <span className="session-cell-label">Expires</span>
            <span className="session-cell-value">
              {sessionInfo.expiresAt ? formatExpiry(sessionInfo.expiresAt) : "—"}
            </span>
          </div>
        </div>
      )}

      <div className="connected-bar">
        <span className="connected-ip">Server: {SERVER_IP}</span>
        {health?.handshake_age_secs != null && health.handshake_age_secs < 3600 && (
          <span className="connected-ping">{health.handshake_age_secs}s ago</span>
        )}
      </div>

      {canReconnect && !successMessage && !error && (
        <div className="success-bar">
          Paid session active - click RE-CONNECT to resume (no new payment).
        </div>
      )}
      {successMessage && <div className="success-bar">{successMessage}</div>}
      {error && <div className="error-bar">{error}</div>}

      {showSessionActions && (
        <div className="btn-row">
          <button
            type="button"
            className="btn-secondary"
            disabled={sessionAction !== null || isLoading}
            onClick={handleClearSession}
          >
            {sessionAction === "clear" ? "CLEARING..." : "CLEAR SESSION"}
          </button>
          <button
            type="button"
            className="btn-secondary accent"
            disabled={sessionAction !== null || isLoading}
            onClick={() => {
              setRenewMinutes(SESSION_MINUTES);
              setRenewModalOpen(true);
            }}
          >
            RENEW
          </button>
        </div>
      )}

      {renewModalOpen && (
        <div
          className="modal-overlay"
          onClick={() => sessionAction !== "renew" && setRenewModalOpen(false)}
        >
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>Renew session</h3>
            <p className="modal-hint">
              Choose how long to extend your VPN session. Payment is via x402 (CSPR on Casper) —
              signing opens in your browser.
            </p>
            <label className="modal-label">
              Duration (minutes)
              <input
                type="number"
                min={1}
                max={60}
                value={renewMinutes}
                disabled={sessionAction === "renew"}
                onChange={(e) => setRenewMinutes(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
              />
            </label>
            {renewPrice && <p className="modal-price">{renewPrice}</p>}
            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary accent"
                disabled={sessionAction === "renew"}
                onClick={handleRenewConfirm}
              >
                {sessionAction === "renew" ? "PAYING..." : "PAY & RENEW"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={sessionAction === "renew"}
                onClick={() => setRenewModalOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {connectModalOpen && (
        <div className="modal-overlay" onClick={() => setConnectModalOpen(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>Start VPN session</h3>
            <p className="modal-hint">
              Choose how long you want to connect. Payment is via x402 (CSPR on Casper) —
              signing opens in your browser.
            </p>
            <label className="modal-label">
              Duration (minutes)
              <input
                type="number"
                min={1}
                max={60}
                value={connectMinutes}
                onChange={(e) =>
                  setConnectMinutes(Math.max(1, Math.min(60, Number(e.target.value) || 1)))
                }
              />
            </label>
            <p className="modal-price">{connectPrice ?? "Calculating cost…"}</p>
            <div className="modal-actions">
              <button type="button" className="btn-secondary accent" onClick={handleConnectConfirm}>
                PAY &amp; CONNECT
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setConnectModalOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        className={`btn-action ${isConnected || isError ? "disconnect" : ""} ${isLoading ? "loading" : ""}`}
        onClick={handleClick}
        disabled={isLoading}
      >
        {isLoading
          ? connectPhase === "paying" || connectPhase === "renew"
            ? "PAY..."
            : "..."
          : isConnected || isError
            ? "DISCONNECT"
            : canReconnect
              ? "RE-CONNECT"
              : "CONNECT"}
      </button>

      <div className="footer">
        <span>
          XELT - Pay Per Use VPN
        </span>
      </div>
    </div>
  );
}
