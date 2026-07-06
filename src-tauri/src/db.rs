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

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS goals (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    target_count  INTEGER NOT NULL,
    current_count INTEGER NOT NULL DEFAULT 0,
    unit          TEXT NOT NULL,
    start_date    TEXT NOT NULL,
    end_date      TEXT NOT NULL,
    item_labels   TEXT NOT NULL DEFAULT '[]', -- JSON array of per-checkbox labels
    checked_items TEXT NOT NULL DEFAULT '[]'  -- JSON array of checked indices
);

CREATE TABLE IF NOT EXISTS habits (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    created_date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS habit_logs (
    habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    date     TEXT NOT NULL,                  -- 'YYYY-MM-DD', presence = done
    PRIMARY KEY (habit_id, date)
);
";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Goal {
    pub id: String,
    pub title: String,
    pub target_count: i64,
    pub current_count: i64,
    pub unit: String,
    pub start_date: String, // ISO date
    pub end_date: String,
    #[serde(default)]
    pub item_labels: Vec<String>, // [] = default "Task 1..N"
    #[serde(default)]
    pub checked_items: Vec<i64>, // 0-based indices of checked boxes
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Habit {
    pub id: String,
    pub title: String,
    pub created_date: String, // ISO date
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitLog {
    pub habit_id: String,
    pub date: String, // "YYYY-MM-DD"
}

pub fn init(app: &tauri::AppHandle) -> Result<Connection, Box<dyn std::error::Error>> {
    use tauri::Manager;
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let conn = Connection::open(dir.join("focus-os.db"))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.execute_batch(SCHEMA)?;
    // Columns added after the table first shipped — CREATE TABLE IF NOT EXISTS
    // won't add them to an existing DB, so patch them in here.
    ensure_column(&conn, "goals", "item_labels", "TEXT NOT NULL DEFAULT '[]'")?;
    ensure_column(&conn, "goals", "checked_items", "TEXT NOT NULL DEFAULT '[]'")?;
    Ok(conn)
}

fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    ddl: &str,
) -> rusqlite::Result<()> {
    let exists = conn
        .prepare(&format!("SELECT 1 FROM pragma_table_info('{table}') WHERE name = ?1"))?
        .exists([column])?;
    if !exists {
        conn.execute(&format!("ALTER TABLE {table} ADD COLUMN {column} {ddl}"), [])?;
    }
    Ok(())
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

/// The next block still ahead of us today, if any (for the 5-minute warning).
pub fn get_next_block_today(conn: &Connection) -> rusqlite::Result<Option<ScheduleBlock>> {
    let now = Local::now();
    let weekday = now.weekday().num_days_from_sunday() as u8;
    let today = now.format("%Y-%m-%d").to_string();
    let hhmm = now.format("%H:%M").to_string();

    let blocks = list_blocks(conn)?;
    Ok(blocks
        .into_iter()
        .filter(|b| b.enabled)
        .filter(|b| b.start_time > hhmm)
        .filter(|b| match &b.one_off_date {
            Some(date) => *date == today,
            None => b.days_of_week.contains(&weekday),
        })
        .min_by(|a, b| a.start_time.cmp(&b.start_time)))
}

pub fn get_setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        [key],
        |row| row.get(0),
    )
    .ok()
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = ?2",
        [key, value],
    )?;
    Ok(())
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

fn row_to_goal(row: &rusqlite::Row) -> rusqlite::Result<Goal> {
    let labels: String = row.get("item_labels")?;
    let checked: String = row.get("checked_items")?;
    Ok(Goal {
        id: row.get("id")?,
        title: row.get("title")?,
        target_count: row.get("target_count")?,
        current_count: row.get("current_count")?,
        unit: row.get("unit")?,
        start_date: row.get("start_date")?,
        end_date: row.get("end_date")?,
        item_labels: serde_json::from_str(&labels).unwrap_or_default(),
        checked_items: serde_json::from_str(&checked).unwrap_or_default(),
    })
}

pub fn list_goals(conn: &Connection) -> rusqlite::Result<Vec<Goal>> {
    let mut stmt = conn.prepare("SELECT * FROM goals ORDER BY title")?;
    let rows = stmt.query_map([], row_to_goal)?;
    rows.collect()
}

/// Insert or fully update a goal. `current_count` is derived from
/// `checked_items` so the progress bar and the checkboxes can never disagree.
pub fn upsert_goal(conn: &Connection, g: &Goal) -> rusqlite::Result<Goal> {
    let mut g = g.clone();
    g.checked_items.sort_unstable();
    g.checked_items.dedup();
    g.checked_items.retain(|&i| i >= 0 && i < g.target_count);
    g.current_count = g.checked_items.len() as i64;
    conn.execute(
        "INSERT INTO goals
           (id, title, target_count, current_count, unit, start_date, end_date,
            item_labels, checked_items)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
           title = ?2, target_count = ?3, current_count = ?4, unit = ?5,
           start_date = ?6, end_date = ?7, item_labels = ?8, checked_items = ?9",
        rusqlite::params![
            g.id,
            g.title,
            g.target_count,
            g.current_count,
            g.unit,
            g.start_date,
            g.end_date,
            serde_json::to_string(&g.item_labels).unwrap_or_else(|_| "[]".into()),
            serde_json::to_string(&g.checked_items).unwrap_or_else(|_| "[]".into()),
        ],
    )?;
    Ok(g)
}

/// Absolute-count progress update (the +1/-1 path). Adjusts `checked_items` to
/// match: counting up checks the lowest unchecked boxes, counting down
/// unchecks the highest checked ones — scattered checks are preserved.
pub fn update_goal_progress(
    conn: &Connection,
    id: &str,
    new_count: i64,
) -> rusqlite::Result<Goal> {
    let mut g = conn.query_row("SELECT * FROM goals WHERE id = ?1", [id], row_to_goal)?;
    let target = new_count.clamp(0, g.target_count);
    g.checked_items.sort_unstable();
    while (g.checked_items.len() as i64) > target {
        g.checked_items.pop();
    }
    let mut next = 0;
    while (g.checked_items.len() as i64) < target {
        if !g.checked_items.contains(&next) {
            g.checked_items.push(next);
        }
        next += 1;
    }
    upsert_goal(conn, &g)
}

pub fn delete_goal(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM goals WHERE id = ?1", [id])?;
    Ok(())
}

// ---- habits ----

fn row_to_habit(row: &rusqlite::Row) -> rusqlite::Result<Habit> {
    Ok(Habit {
        id: row.get("id")?,
        title: row.get("title")?,
        created_date: row.get("created_date")?,
    })
}

pub fn list_habits(conn: &Connection) -> rusqlite::Result<Vec<Habit>> {
    let mut stmt = conn.prepare("SELECT * FROM habits ORDER BY created_date, title")?;
    let rows = stmt.query_map([], row_to_habit)?;
    rows.collect()
}

pub fn create_habit(conn: &Connection, h: &Habit) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO habits (id, title, created_date) VALUES (?1, ?2, ?3)",
        rusqlite::params![h.id, h.title, h.created_date],
    )?;
    Ok(())
}

pub fn delete_habit(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM habits WHERE id = ?1", [id])?;
    Ok(())
}

pub fn set_habit_done(
    conn: &Connection,
    habit_id: &str,
    date: &str,
    done: bool,
) -> rusqlite::Result<()> {
    if done {
        conn.execute(
            "INSERT OR IGNORE INTO habit_logs (habit_id, date) VALUES (?1, ?2)",
            rusqlite::params![habit_id, date],
        )?;
    } else {
        conn.execute(
            "DELETE FROM habit_logs WHERE habit_id = ?1 AND date = ?2",
            rusqlite::params![habit_id, date],
        )?;
    }
    Ok(())
}

pub fn list_habit_logs(
    conn: &Connection,
    from: &str,
    to: &str,
) -> rusqlite::Result<Vec<HabitLog>> {
    let mut stmt = conn.prepare(
        "SELECT habit_id, date FROM habit_logs WHERE date >= ?1 AND date <= ?2",
    )?;
    let rows = stmt.query_map(rusqlite::params![from, to], |row| {
        Ok(HabitLog {
            habit_id: row.get("habit_id")?,
            date: row.get("date")?,
        })
    })?;
    rows.collect()
}
