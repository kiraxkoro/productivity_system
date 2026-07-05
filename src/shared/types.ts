// src/shared/types.ts
// SHARED DATA CONTRACT — edit jointly only (tell the other person before touching this file).

// --- Task Tracker (Person B) ---
export interface Goal {
  id: string;
  title: string; // "Solve 90 LeetCode problems"
  targetCount: number; // 90
  currentCount: number; // updates as user logs progress
  unit: string; // "problems", "days", "hours"
  startDate: string; // ISO date
  endDate: string;
}
// percentage = (currentCount / targetCount) * 100

// --- Scheduler (Person A) ---
export interface ScheduleBlock {
  id: string;
  label: string; // "LeetCode Grind"
  startTime: string; // "18:00"
  endTime: string; // "20:00"
  daysOfWeek: number[]; // [1,2,3,4,5] = Mon-Fri (0 = Sunday, same as JS Date.getDay())
  actions: BlockAction[];
  // Added by Person A (2026-07-04), additive only — Goal untouched:
  enabled: boolean; // pause a block without deleting it
  oneOffDate: string | null; // "YYYY-MM-DD" for one-time blocks ("Focus Now"); null = repeats weekly
}

export interface BlockAction {
  trigger: "onStart" | "onEnd";
  type: "openApp" | "closeApp" | "closeTab" | "openTab";
  target: string; // executable path/name, or URL/domain pattern
}

/*
Rust command contract (what the UI calls via invoke()):

Person B implements (in commands/goals.rs):
  create_goal(goal: Goal) -> Goal
  list_goals() -> Vec<Goal>
  update_goal_progress(id: String, new_count: i32) -> Goal
  delete_goal(id: String) -> ()

Person A implements (in commands/schedules.rs):
  create_schedule_block(block: ScheduleBlock) -> ScheduleBlock
  update_schedule_block(block: ScheduleBlock) -> ScheduleBlock   // added by Person A
  list_schedule_blocks() -> Vec<ScheduleBlock>
  delete_schedule_block(id: String) -> ()
  set_block_enabled(id: String, enabled: bool) -> ()             // added by Person A
  get_active_block() -> Option<ScheduleBlock>   // polled by scheduler_loop every 15s
  open_app(path: String) -> Result<(), String>
  close_app(process_name: String) -> Result<(), String>

App-level (Person A, in commands/system.rs):
  get_autostart() -> bool                        // "start with Windows" state
  set_autostart(enabled: bool) -> ()

Events emitted from Rust (listen via @tauri-apps/api/event):
  "active-block-changed" -> ScheduleBlock | null   // fired when a block starts/ends

closeTab actions (target = domain, e.g. "youtube.com") are enforced by the
browser extension in extension/ — it polls GET http://127.0.0.1:48210/blocklist
(served by src-tauri/src/blocklist_server.rs) and blocks matching tabs while
the block is active.

Persistence note (2026-07-04): SQLite lives in Rust via `rusqlite` (see src-tauri/src/db.rs —
it already creates BOTH the schedule_blocks and goals tables). tauri-plugin-sql was removed;
Person B just implements the four goal commands in commands/goals.rs against db.rs.
*/
