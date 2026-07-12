// Person A: schedule block CRUD + open_app/close_app commands.
// Contract lives in src/shared/types.ts.

use crate::db::{self, ScheduleBlock};
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn create_schedule_block(
    state: State<AppState>,
    block: ScheduleBlock,
) -> Result<ScheduleBlock, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::upsert_block(&conn, &block).map_err(|e| e.to_string())?;
    request_hosts_access_if_needed(&block);
    Ok(block)
}

#[tauri::command]
pub fn update_schedule_block(
    state: State<AppState>,
    block: ScheduleBlock,
) -> Result<ScheduleBlock, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::upsert_block(&conn, &block).map_err(|e| e.to_string())?;
    request_hosts_access_if_needed(&block);
    Ok(block)
}

/// Saving a block that blocks websites is the one moment the user is
/// guaranteed to be at the keyboard, so the one-time UAC grant for hosts-file
/// writes happens now — never at block start, when a surprise admin prompt
/// would sit unanswered. Spawned so saving never waits on the dialog.
fn request_hosts_access_if_needed(block: &ScheduleBlock) {
    if block.actions.iter().any(|a| a.r#type == "closeTab") {
        std::thread::spawn(|| {
            crate::hosts_blocker::ensure_write_access();
        });
    }
}

#[tauri::command]
pub fn list_schedule_blocks(state: State<AppState>) -> Result<Vec<ScheduleBlock>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_blocks(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_schedule_block(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_block(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_block_enabled(
    state: State<AppState>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::set_enabled(&conn, &id, enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_active_block(state: State<AppState>) -> Result<Option<ScheduleBlock>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_active_block(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_app(path: String) -> Result<(), String> {
    open_target(path.trim())
}

#[tauri::command]
pub fn close_app(process_name: String) -> Result<(), String> {
    close_process(process_name.trim())
}

/// Opens a URL, a registered app name ("chrome", "code"), or a full exe path.
/// Also used by scheduler_loop for onStart/onEnd actions.
pub fn open_target(target: &str) -> Result<(), String> {
    if target.is_empty() {
        return Err("empty target".into());
    }
    #[cfg(mobile)]
    {
        // Sandboxed OSes don't let one app launch an arbitrary path/exe the
        // way desktop does; a URL could still be opened via the shell plugin
        // from the frontend if this becomes worth supporting on mobile.
        return Err("Opening apps/files isn't supported on mobile".into());
    }
    #[cfg(all(desktop, target_os = "windows"))]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let path = std::path::Path::new(target);
        // A full path to an .exe is spawned directly with its own folder as the
        // working directory — apps like OBS refuse to start from anywhere else.
        if path.is_absolute()
            && path.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe"))
            && path.exists()
        {
            let mut cmd = std::process::Command::new(target);
            if let Some(parent) = path.parent() {
                cmd.current_dir(parent);
            }
            cmd.spawn()
                .map_err(|e| format!("failed to launch '{target}': {e}"))?;
            return Ok(());
        }
        // `start` resolves URLs, App Paths entries (chrome, msedge), PATH (code),
        // shortcuts and documents. The target must be quoted on the raw command
        // line: cmd otherwise treats & ^ ( ) in URLs (e.g. playlist links with
        // &index=2) as operators and truncates. The leading "" fills `start`'s
        // window-title slot so the quoted target is never mistaken for it.
        let sanitized = target.replace('"', "");
        std::process::Command::new("cmd")
            .arg("/C")
            .raw_arg(format!("start \"\" \"{sanitized}\""))
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("failed to open '{target}': {e}"))?;
        Ok(())
    }
    #[cfg(all(desktop, target_os = "macos"))]
    {
        // `open` handles URLs, schemes and paths; bare app names ("chrome",
        // "code") fail there, so those get a second try as an application.
        let direct = std::process::Command::new("open").arg(target).output();
        if matches!(&direct, Ok(o) if o.status.success()) {
            return Ok(());
        }
        let out = std::process::Command::new("open")
            .args(["-a", &mac_app_name(target)])
            .output()
            .map_err(|e| format!("failed to open '{target}': {e}"))?;
        if out.status.success() {
            Ok(())
        } else {
            Err(format!(
                "failed to open '{target}': {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ))
        }
    }
    #[cfg(all(desktop, not(any(target_os = "windows", target_os = "macos"))))]
    {
        std::process::Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| format!("failed to open '{target}': {e}"))?;
        Ok(())
    }
}

/// Kills a process by image name; "Discord" and "Discord.exe" both work.
/// A process that isn't running counts as success (it's already "closed").
pub fn close_process(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("empty process name".into());
    }
    if name == "*" {
        // whitelist-mode sentinel — only scheduler_loop acts on it, and never
        // via taskkill /IM * (which would be a massacre)
        return Ok(());
    }
    #[cfg(mobile)]
    {
        // Sandboxed OSes don't let one app kill another — there's no mobile
        // equivalent of taskkill/pkill. Callers already treat this as a
        // best-effort action, so failing loud here just surfaces the truth.
        return Err("Closing other apps isn't supported on mobile".into());
    }
    #[cfg(all(desktop, target_os = "windows"))]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        // Wildcards pass through untouched: Store apps often run under expanded
        // names ("WhatsApp*" matches WhatsApp.Root.exe and its UI children).
        let exe = if name.contains('*') || name.to_ascii_lowercase().ends_with(".exe") {
            name.to_string()
        } else {
            format!("{name}.exe")
        };
        let out = std::process::Command::new("taskkill")
            .args(["/IM", &exe, "/F", "/T"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| e.to_string())?;
        // 128 = no such process (already closed). Tree kills of Store apps can
        // exit non-zero after killing everything visible, so any SUCCESS counts.
        if out.status.success()
            || out.status.code() == Some(128)
            || String::from_utf8_lossy(&out.stdout).contains("SUCCESS")
        {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    }
    #[cfg(all(desktop, target_os = "macos"))]
    {
        // Stored targets stay canonical Windows names ("chrome.exe",
        // "WhatsApp*") so blocks keep working when data syncs across
        // machines; here they're translated to the Mac binary. Killing an
        // app's main process takes its helper processes down with it.
        let pattern = format!("MacOS/{}$", regex_escape(&mac_binary_name(name)));
        let out = std::process::Command::new("pkill")
            .args(["-i", "-f", &pattern])
            .output()
            .map_err(|e| e.to_string())?;
        // pkill exits 1 when nothing matched (already closed)
        if out.status.success() || out.status.code() == Some(1) {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    }
    #[cfg(all(desktop, not(any(target_os = "windows", target_os = "macos"))))]
    {
        let out = std::process::Command::new("pkill")
            .args(["-f", name])
            .output()
            .map_err(|e| e.to_string())?;
        // pkill exits 1 when nothing matched
        if out.status.success() || out.status.code() == Some(1) {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    }
}

/// The main-binary name inside Foo.app/Contents/MacOS/ for a canonical
/// Windows-style target. Unknown names fall back to the bare stem, which
/// matches the many apps whose binary simply shares their name (Discord,
/// Spotify, Telegram, WhatsApp…) — matching is case-insensitive anyway.
#[cfg(all(desktop, target_os = "macos"))]
fn mac_binary_name(target: &str) -> String {
    let stem = target.trim().trim_end_matches('*');
    let stem = stem
        .strip_suffix(".exe")
        .or_else(|| stem.strip_suffix(".EXE"))
        .unwrap_or(stem);
    match stem.to_ascii_lowercase().as_str() {
        "chrome" => "Google Chrome".into(),
        "msedge" => "Microsoft Edge".into(),
        "brave" => "Brave Browser".into(),
        "safari" => "Safari".into(),
        "firefox" => "firefox".into(),
        "opera" => "Opera".into(),
        "vivaldi" => "Vivaldi".into(),
        "steam" => "steam_osx".into(),
        "epicgameslauncher" => "EpicGamesLauncher".into(),
        _ => stem.to_string(),
    }
}

/// What `open -a` should get for a bare app-name target ("chrome", "code").
#[cfg(all(desktop, target_os = "macos"))]
fn mac_app_name(target: &str) -> String {
    let stem = target.trim();
    let stem = stem
        .strip_suffix(".exe")
        .or_else(|| stem.strip_suffix(".EXE"))
        .unwrap_or(stem);
    match stem.to_ascii_lowercase().as_str() {
        "chrome" => "Google Chrome".into(),
        "msedge" => "Microsoft Edge".into(),
        "brave" => "Brave Browser".into(),
        "code" => "Visual Studio Code".into(),
        "notepad" => "TextEdit".into(),
        "steam" => "Steam".into(),
        _ => stem.to_string(),
    }
}

/// pkill's pattern is a regex; app names must match literally.
#[cfg(all(desktop, target_os = "macos"))]
fn regex_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if r"\^$.|?*+()[]{}".contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}
