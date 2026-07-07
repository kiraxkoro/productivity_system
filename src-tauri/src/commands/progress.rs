// Person B: XP / levels / achievements commands.
// Contract (see src/shared/types.ts):
//   get_xp() -> i64
//   adjust_xp(delta: i64) -> i64            // clamped at 0, returns new total
//   list_achievements() -> Vec<Achievement>
//   unlock_achievement(id: String) -> bool  // true only on first unlock
//   notify_user(title: String, body: String) -> ()

use crate::db::{self, Achievement};
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn get_xp(state: State<AppState>) -> Result<i64, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(db::get_xp(&conn))
}

#[tauri::command]
pub fn adjust_xp(state: State<AppState>, delta: i64) -> Result<i64, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::adjust_xp(&conn, delta).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_achievements(state: State<AppState>) -> Result<Vec<Achievement>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_achievements(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unlock_achievement(state: State<AppState>, id: String) -> Result<bool, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::unlock_achievement(&conn, &id).map_err(|e| e.to_string())
}

/// OS notification (level ups, achievements). Same plugin the scheduler uses
/// for block heads-ups.
#[tauri::command]
pub fn notify_user(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}
