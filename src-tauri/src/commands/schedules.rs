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
    Ok(block)
}

#[tauri::command]
pub fn update_schedule_block(
    state: State<AppState>,
    block: ScheduleBlock,
) -> Result<ScheduleBlock, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::upsert_block(&conn, &block).map_err(|e| e.to_string())?;
    Ok(block)
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
    #[cfg(target_os = "windows")]
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
    #[cfg(not(target_os = "windows"))]
    {
        let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        std::process::Command::new(opener)
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
    #[cfg(target_os = "windows")]
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
    #[cfg(not(target_os = "windows"))]
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
