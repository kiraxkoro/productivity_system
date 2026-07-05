// Person B: goal CRUD commands.
// Contract (see src/shared/types.ts):
//   create_goal(goal: Goal) -> Goal
//   list_goals() -> Vec<Goal>
//   update_goal(goal: Goal) -> Goal
//   update_goal_progress(id: String, new_count: i32) -> Goal
//   delete_goal(id: String) -> ()

use crate::db::{self, Goal};
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn create_goal(state: State<AppState>, goal: Goal) -> Result<Goal, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::upsert_goal(&conn, &goal).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_goal(state: State<AppState>, goal: Goal) -> Result<Goal, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::upsert_goal(&conn, &goal).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_goals(state: State<AppState>) -> Result<Vec<Goal>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_goals(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_goal_progress(
    state: State<AppState>,
    id: String,
    new_count: i64,
) -> Result<Goal, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_goal_progress(&conn, &id, new_count).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_goal(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_goal(&conn, &id).map_err(|e| e.to_string())
}
