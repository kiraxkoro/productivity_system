// Person B: habit CRUD + daily done-log commands.
// Contract (see src/shared/types.ts):
//   create_habit(habit: Habit) -> Habit
//   list_habits() -> Vec<Habit>
//   delete_habit(id: String) -> ()
//   set_habit_done(habit_id: String, date: String, done: bool) -> ()
//   list_habit_logs(from: String, to: String) -> Vec<HabitLog>

use crate::db::{self, Habit, HabitLog};
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn create_habit(state: State<AppState>, habit: Habit) -> Result<Habit, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::create_habit(&conn, &habit).map_err(|e| e.to_string())?;
    Ok(habit)
}

#[tauri::command]
pub fn list_habits(state: State<AppState>) -> Result<Vec<Habit>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_habits(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_habit(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_habit(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_habit_done(
    state: State<AppState>,
    habit_id: String,
    date: String,
    done: bool,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::set_habit_done(&conn, &habit_id, &date, done).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_habit_logs(
    state: State<AppState>,
    from: String,
    to: String,
) -> Result<Vec<HabitLog>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_habit_logs(&conn, &from, &to).map_err(|e| e.to_string())
}
