// Person A: app-level settings commands (autostart toggle, chosen browser).

use crate::db;
use crate::AppState;
use tauri::State;
use tauri_plugin_autostart::ManagerExt;

pub const ALLOWED_BROWSER_KEY: &str = "allowed_browser";
pub const PAUSE_UNTIL_KEY: &str = "pause_until_epoch";
pub const KNOWN_BROWSERS: [&str; 6] = [
    "chrome.exe",
    "msedge.exe",
    "brave.exe",
    "firefox.exe",
    "opera.exe",
    "vivaldi.exe",
];

#[derive(Clone, serde::Serialize)]
pub struct BrowserInfo {
    pub name: String,
    pub exe: String,
}

/// Browsers actually installed on this machine, scanned once from the
/// registry's official browser registrations (StartMenuInternet). Any browser
/// registers itself there, so Opera/Vivaldi/whatever show up without us
/// hardcoding them. Falls back to KNOWN_BROWSERS when the scan finds nothing.
pub fn installed_browsers() -> &'static Vec<BrowserInfo> {
    static CACHE: std::sync::OnceLock<Vec<BrowserInfo>> = std::sync::OnceLock::new();
    CACHE.get_or_init(scan_browsers)
}

/// Every browser exe we should lock out (installed ∪ known), lowercase.
pub fn all_browser_exes() -> Vec<String> {
    let mut exes: Vec<String> = installed_browsers()
        .iter()
        .map(|b| b.exe.clone())
        .collect();
    for known in KNOWN_BROWSERS {
        if !exes.iter().any(|e| e == known) {
            exes.push(known.to_string());
        }
    }
    exes
}

#[tauri::command]
pub fn list_browsers() -> Vec<BrowserInfo> {
    installed_browsers().clone()
}

fn scan_browsers() -> Vec<BrowserInfo> {
    let mut found: Vec<BrowserInfo> = Vec::new();
    #[cfg(target_os = "windows")]
    for hive in ["HKLM", "HKCU"] {
        let root = format!(r"{hive}\SOFTWARE\Clients\StartMenuInternet");
        let Some(listing) = reg_query(&[&root]) else {
            continue;
        };
        for key in listing.lines().map(str::trim).filter(|l| l.starts_with("HK")) {
            let Some(command) = reg_default(&format!(r"{key}\shell\open\command")) else {
                continue;
            };
            let path = command.trim().trim_matches('"');
            let Some(exe) = std::path::Path::new(path)
                .file_name()
                .map(|f| f.to_string_lossy().to_ascii_lowercase())
            else {
                continue;
            };
            if found.iter().any(|b| b.exe == exe) {
                continue;
            }
            let name = reg_default(key).unwrap_or_else(|| {
                key.rsplit('\\').next().unwrap_or("Browser").to_string()
            });
            found.push(BrowserInfo { name, exe });
        }
    }
    if found.is_empty() {
        found = KNOWN_BROWSERS
            .iter()
            .map(|e| BrowserInfo {
                name: e.trim_end_matches(".exe").to_string(),
                exe: e.to_string(),
            })
            .collect();
    }
    found
}

/// Runs `reg query` and returns stdout, or None on failure. Windows only.
#[cfg(target_os = "windows")]
fn reg_query(args: &[&str]) -> Option<String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let out = std::process::Command::new("reg")
        .arg("query")
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).to_string())
}

/// Reads a key's (Default) REG_SZ value. Windows only.
#[cfg(target_os = "windows")]
fn reg_default(key: &str) -> Option<String> {
    let out = reg_query(&[key, "/ve"])?;
    for line in out.lines() {
        if let Some((_, value)) = line.split_once("REG_SZ") {
            let value = value.trim();
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

#[tauri::command]
pub fn get_autostart(app: tauri::AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    if enabled {
        autolaunch.enable().map_err(|e| e.to_string())
    } else {
        autolaunch.disable().map_err(|e| e.to_string())
    }
}

/// The one browser the user keeps during blocks (the extension lives there).
/// First call detects the Windows default browser and persists it.
#[tauri::command]
pub fn get_allowed_browser(state: State<AppState>) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(allowed_browser(&conn))
}

#[tauri::command]
pub fn set_allowed_browser(state: State<AppState>, exe: String) -> Result<(), String> {
    let exe = exe.trim().to_ascii_lowercase();
    if !KNOWN_BROWSERS.contains(&exe.as_str()) {
        return Err(format!("unknown browser '{exe}'"));
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::set_setting(&conn, ALLOWED_BROWSER_KEY, &exe).map_err(|e| e.to_string())
}

/// Emergency pause: the UI makes the user type the weakness phrase first.
/// Enforcement and site-blocking stop until the returned "HH:MM" time.
#[tauri::command]
pub fn emergency_pause(state: State<AppState>, minutes: u32) -> Result<String, String> {
    let minutes = minutes.clamp(1, 15) as i64; // a breather, not a loophole
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let until = chrono::Local::now() + chrono::Duration::minutes(minutes);
    db::set_setting(&conn, PAUSE_UNTIL_KEY, &until.timestamp().to_string())
        .map_err(|e| e.to_string())?;
    Ok(until.format("%H:%M").to_string())
}

/// Non-command helper shared with scheduler_loop and blocklist_server.
pub fn is_paused(conn: &rusqlite::Connection) -> bool {
    db::get_setting(conn, PAUSE_UNTIL_KEY)
        .and_then(|v| v.parse::<i64>().ok())
        .map(|until| chrono::Local::now().timestamp() < until)
        .unwrap_or(false)
}

/// Non-command helper shared with scheduler_loop (caller already holds the lock).
pub fn allowed_browser(conn: &rusqlite::Connection) -> String {
    if let Some(saved) = db::get_setting(conn, ALLOWED_BROWSER_KEY) {
        return saved;
    }
    let detected = detect_default_browser().unwrap_or_else(|| "chrome.exe".to_string());
    let _ = db::set_setting(conn, ALLOWED_BROWSER_KEY, &detected);
    detected
}

/// Reads the Windows default-browser ProgId from the registry (no extra deps).
fn detect_default_browser() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let out = std::process::Command::new("reg")
            .args([
                "query",
                r"HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice",
                "/v",
                "ProgId",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&out.stdout).to_ascii_lowercase();
        let exe = if text.contains("chromehtml") {
            "chrome.exe"
        } else if text.contains("msedgehtm") {
            "msedge.exe"
        } else if text.contains("bravehtml") {
            "brave.exe"
        } else if text.contains("firefox") {
            "firefox.exe"
        } else {
            return None;
        };
        Some(exe.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}
