use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaymentCompletePayload {
    pub server_public_key: String,
    pub endpoint: String,
    pub assigned_ip: String,
    pub expires_at: Option<String>,
    pub wallet_address: String,
}

/// Start a one-shot callback server, open the browser to the pay page, and emit
/// `payment-complete` / `payment-error` when the page reports back.
#[allow(deprecated)] // shell().open is fine here; tauri-plugin-opener is the newer API.
#[tauri::command]
pub async fn open_payment_browser(
    app: tauri::AppHandle,
    wg_pub: String,
    duration: u32,
    server_base: String,
    route: Option<String>,
) -> Result<(), String> {
    // Bind an ephemeral localhost port for the callback.
    let server = tiny_http::Server::http("127.0.0.1:0")
        .map_err(|e| format!("Failed to start callback server: {e}"))?;
    let port = server
        .server_addr()
        .to_ip()
        .ok_or_else(|| "Callback server has no IP address".to_string())?
        .port();

    // Open the system browser at the pay page (server_base /pay redirects to pay.html).
    let route_q = route.unwrap_or_else(|| "connect".into());
    let url = format!(
        "{}/pay?wgPub={}&duration={}&server={}&cb={}&route={}",
        server_base.trim_end_matches('/'),
        urlencoding(&wg_pub),
        duration,
        urlencoding(&server_base),
        port,
        urlencoding(&route_q),
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
                    let method = request.method().as_str().to_string();
                    let path = request.url().to_string();

                    // The pay page is served from a different origin (Vite/localhost
                    // plugin), so the browser sends a CORS preflight. Answer OPTIONS
                    // with CORS headers and keep waiting for the real POST.
                    if method == "OPTIONS" {
                        let _ = request.respond(cors_response("", 200));
                        continue;
                    }

                    let mut body = String::new();
                    let _ = request.as_reader().read_to_string(&mut body);
                    let _ = request.respond(cors_response("ok", 200));

                    if path.starts_with("/connected") {
                        match serde_json::from_str::<PaymentCompletePayload>(&body) {
                            Ok(payload) => {
                                let _ = app_handle.emit("payment-complete", &payload);
                            }
                            Err(e) => {
                                let _ = app_handle
                                    .emit("payment-error", format!("Malformed callback payload: {e}"));
                            }
                        }
                        break;
                    } else if path.starts_with("/error") {
                        let _ = app_handle.emit("payment-error", body);
                        break;
                    }
                    // Ignore other paths (e.g. favicon) and keep waiting.
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

/// Build a response with permissive CORS headers (the pay page is cross-origin).
fn cors_response(body: &str, status: u16) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    let mut resp = tiny_http::Response::from_string(body).with_status_code(status);
    for (name, value) in [
        ("Access-Control-Allow-Origin", "*"),
        ("Access-Control-Allow-Methods", "POST, OPTIONS"),
        ("Access-Control-Allow-Headers", "*"),
    ] {
        if let Ok(h) = tiny_http::Header::from_bytes(name.as_bytes(), value.as_bytes()) {
            resp.add_header(h);
        }
    }
    resp
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
