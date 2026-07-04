// SQLite connection + schema for BOTH tables (see src/shared/types.ts for the shapes).
// Person A owns schedule_blocks; the goals table is created here too so Person B only
// has to write the goal commands in commands/goals.rs against this same connection.

use chrono::{Datelike, Local};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockAction {
    pub trigger: String, // "onStart" | "onEnd"
    pub r#type: String, // "openApp" | "closeApp" | "closeTab" | "openTab"
    pub target: String, // executable path/name, or URL
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleBlock {
    pub id: String,
    pub label: String,
    pub start_time: String, // "18:00"
    pub end_time: String,   // "20:00"
    pub days_of_week: Vec<u8>, // 0 = Sunday .. 6 = Saturday (matches JS Date.getDay())
    pub actions: Vec<BlockAction>,
    pub enabled: bool,
    pub one_off_date: Option<String>, // "YYYY-MM-DD" => runs once on that date only
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS schedule_blocks (
    id           TEXT PRIMARY KEY,
    label        TEXT NOT NULL,
    start_time   TEXT NOT NULL,
    end_time     TEXT NOT NULL,
    days_of_week TEXT NOT NULL,            -- JSON array, e.g. [1,2,3,4,5]
    actions      TEXT NOT NULL,            -- JSON array of BlockAction
    enabled      INTEGER NOT NULL DEFAULT 1,
    one_off_date TEXT                      -- NULL = repeats weekly
);

CREATE TABLE IF NOT EXISTS goals (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    target_count  INTEGER NOT NULL,
    current_count INTEGER NOT NULL DEFAULT 0,
    unit          TEXT NOT NULL,
    start_date    TEXT NOT NULL,
    end_date      TEXT NOT NULL
);
";

pub fn init(app: &tauri::AppHandle) -> Result<Connection, Box<dyn std::error::Error>> {
    use tauri::Manager;
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let conn = Connection::open(dir.join("focus-os.db"))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.execute_batch(SCHEMA)?;
    Ok(conn)
}

fn row_to_block(row: &rusqlite::Row) -> rusqlite::Result<ScheduleBlock> {
    let days: String = row.get("days_of_week")?;
    let actions: String = row.get("actions")?;
    Ok(ScheduleBlock {
        id: row.get("id")?,
        label: row.get("label")?,
        start_time: row.get("start_time")?,
        end_time: row.get("end_time")?,
        days_of_week: serde_json::from_str(&days).unwrap_or_default(),
        actions: serde_json::from_str(&actions).unwrap_or_default(),
        enabled: row.get::<_, i64>("enabled")? != 0,
        one_off_date: row.get("one_off_date")?,
    })
}

pub fn list_blocks(conn: &Connection) -> rusqlite::Result<Vec<ScheduleBlock>> {
    let mut stmt =
        conn.prepare("SELECT * FROM schedule_blocks ORDER BY start_time, label")?;
    let rows = stmt.query_map([], row_to_block)?;
    rows.collect()
}

pub fn upsert_block(conn: &Connection, b: &ScheduleBlock) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO schedule_blocks
           (id, label, start_time, end_time, days_of_week, actions, enabled, one_off_date)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET
           label = ?2, start_time = ?3, end_time = ?4, days_of_week = ?5,
           actions = ?6, enabled = ?7, one_off_date = ?8",
        rusqlite::params![
            b.id,
            b.label,
            b.start_time,
            b.end_time,
            serde_json::to_string(&b.days_of_week).unwrap_or_else(|_| "[]".into()),
            serde_json::to_string(&b.actions).unwrap_or_else(|_| "[]".into()),
            b.enabled as i64,
            b.one_off_date,
        ],
    )?;
    Ok(())
}

pub fn delete_block(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM schedule_blocks WHERE id = ?1", [id])?;
    Ok(())
}

pub fn set_enabled(conn: &Connection, id: &str, enabled: bool) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE schedule_blocks SET enabled = ?1 WHERE id = ?2",
        rusqlite::params![enabled as i64, id],
    )?;
    Ok(())
}

/// The block that should be running right now, if any.
/// "HH:MM" strings compare correctly lexicographically. Blocks are assumed to
/// start and end on the same day (the form enforces start < end).
pub fn get_active_block(conn: &Connection) -> rusqlite::Result<Option<ScheduleBlock>> {
    let now = Local::now();
    let weekday = now.weekday().num_days_from_sunday() as u8; // 0 = Sunday, like JS getDay()
    let today = now.format("%Y-%m-%d").to_string();
    let hhmm = now.format("%H:%M").to_string();

    let blocks = list_blocks(conn)?;
    Ok(blocks
        .into_iter()
        .filter(|b| b.enabled)
        .filter(|b| b.start_time <= hhmm && hhmm < b.end_time)
        .filter(|b| match &b.one_off_date {
            Some(date) => *date == today,
            None => b.days_of_week.contains(&weekday),
        })
        // if blocks overlap, the one that started most recently wins
        .max_by(|a, b| a.start_time.cmp(&b.start_time)))
}

/// One-off blocks ("Focus Now") whose time has passed are garbage — remove them
/// so the list stays clean without the user lifting a finger.
pub fn delete_expired_one_offs(conn: &Connection) -> rusqlite::Result<usize> {
    let now = Local::now();
    let today = now.format("%Y-%m-%d").to_string();
    let hhmm = now.format("%H:%M").to_string();
    conn.execute(
        "DELETE FROM schedule_blocks
         WHERE one_off_date IS NOT NULL
           AND (one_off_date < ?1 OR (one_off_date = ?1 AND end_time <= ?2))",
        rusqlite::params![today, hhmm],
    )
}
