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
  daysOfWeek: number[]; // [1,2,3,4,5] = Mon-Fri
  actions: BlockAction[];
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
  list_schedule_blocks() -> Vec<ScheduleBlock>
  delete_schedule_block(id: String) -> ()
  get_active_block() -> Option<ScheduleBlock>   // polled by scheduler_loop every 30-60s
  open_app(path: String) -> Result<(), String>
  close_app(process_name: String) -> Result<(), String>
*/
