// Person A: tiny localhost endpoint the browser extension polls.
// GET http://127.0.0.1:48210/blocklist ->
//   { "active": bool, "label": String, "endTime": "HH:MM", "domains": [String] }
// domains come from the active block's closeTab actions; the extension
// redirects matching tabs to its "blocked" page while the block runs.

use crate::AppState;
use tauri::Manager;

pub const PORT: u16 = 48210;

pub fn start(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let server = match tiny_http::Server::http(("127.0.0.1", PORT)) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[blocklist] server failed to start on port {PORT}: {e}");
                return;
            }
        };
        for request in server.incoming_requests() {
            let body = build_body(&app);
            let json_header =
                tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
                    .expect("static header");
            let cors_header =
                tiny_http::Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..])
                    .expect("static header");
            let response = tiny_http::Response::from_string(body)
                .with_header(json_header)
                .with_header(cors_header);
            let _ = request.respond(response);
        }
    });
}

fn build_body(app: &tauri::AppHandle) -> String {
    let state = app.state::<AppState>();
    let active = state.db.lock().ok().and_then(|conn| {
        // an emergency pause (typed weakness phrase) unblocks sites too
        if crate::commands::system::is_paused(&conn) {
            return None;
        }
        crate::db::get_active_block(&conn).ok().flatten()
    });

    match active {
        Some(block) => {
            // closeApp "*" (whitelist mode) flips the web to whitelist too:
            // the extension blocks EVERY site except the ones this block opens.
            let whitelist = block
                .actions
                .iter()
                .any(|a| a.r#type == "closeApp" && a.target.trim() == "*");
            let source_type = if whitelist { "openTab" } else { "closeTab" };
            let domains: Vec<String> = block
                .actions
                .iter()
                .filter(|a| a.r#type == source_type)
                .map(|a| normalize_domain(&a.target))
                .filter(|d| !d.is_empty())
                .collect();
            serde_json::json!({
                "active": true,
                "mode": if whitelist { "whitelist" } else { "blacklist" },
                "label": block.label,
                "endTime": block.end_time,
                "domains": domains,
            })
            .to_string()
        }
        None => {
            serde_json::json!({ "active": false, "mode": "blacklist", "domains": [] })
                .to_string()
        }
    }
}

/// "https://www.YouTube.com/watch?v=x" -> "youtube.com"
/// Commas are always dot typos in web targets, so fix them here too.
fn normalize_domain(target: &str) -> String {
    let t = target.trim().to_ascii_lowercase().replace(',', ".");
    let t = t.strip_prefix("https://").unwrap_or(&t);
    let t = t.strip_prefix("http://").unwrap_or(t);
    let t = t.strip_prefix("www.").unwrap_or(t);
    t.split(['/', '?', '#']).next().unwrap_or("").to_string()
}
