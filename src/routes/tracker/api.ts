// Person B: typed wrappers around the Rust goal/habit commands + small helpers.

import { invoke } from "@tauri-apps/api/core";
import type { Goal, Habit, HabitLog } from "../../shared/types";

// ---- Rust commands: goals ----
export const listGoals = () => invoke<Goal[]>("list_goals");
export const createGoal = (goal: Goal) => invoke<Goal>("create_goal", { goal });
export const updateGoal = (goal: Goal) => invoke<Goal>("update_goal", { goal });
export const updateGoalProgress = (id: string, newCount: number) =>
  invoke<Goal>("update_goal_progress", { id, newCount });
export const deleteGoal = (id: string) => invoke<void>("delete_goal", { id });

// ---- Rust commands: habits ----
export const listHabits = () => invoke<Habit[]>("list_habits");
export const createHabit = (habit: Habit) =>
  invoke<Habit>("create_habit", { habit });
export const deleteHabit = (id: string) => invoke<void>("delete_habit", { id });
export const setHabitDone = (habitId: string, date: string, done: boolean) =>
  invoke<void>("set_habit_done", { habitId, date, done });
export const listHabitLogs = (from: string, to: string) =>
  invoke<HabitLog[]>("list_habit_logs", { from, to });

// ---- date helpers ----
export const pad = (n: number) => String(n).padStart(2, "0");

export const toISO = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const todayISO = () => toISO(new Date());

/** Number of days in the given month (monthIndex is 0-based). */
export const daysInMonth = (year: number, monthIndex: number) =>
  new Date(year, monthIndex + 1, 0).getDate();

// ---- goal stats ----
/** 0-100, clamped. */
export function percentOf(g: Goal): number {
  if (g.targetCount <= 0) return 0;
  return Math.min(100, Math.max(0, (g.currentCount / g.targetCount) * 100));
}

/** "66.67%" — up to 2 decimals, trailing zeros trimmed ("50%", not "50.00%"). */
export const fmtPct = (pct: number) => `${Number(pct.toFixed(2))}%`;

export function isComplete(g: Goal): boolean {
  return g.currentCount >= g.targetCount;
}

/** Label for checkbox i: custom label if uploaded, else "Task N". */
export function itemLabel(g: Goal, i: number): string {
  return g.itemLabels[i]?.trim() || `Task ${i + 1}`;
}
