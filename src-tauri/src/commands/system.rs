// Person A: app-level settings commands (autostart toggle, chosen browser).

use crate::db;
use crate::AppState;
use tauri::State;
use tauri_plugin_autostart::ManagerExt;

pub const ALLOWED_BROWSER_KEY: &str = "allowed_browser";
pub const KNOWN_BROWSERS: [&str; 4] =
    ["chrome.exe", "msedge.exe", "brave.exe", "firefox.exe"];

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
