// Person B: XP, levels, achievements. Every ticked task item or habit is
// +10 XP; unticking takes the 10 back. 100 XP = 1 level. Level-ups and
// achievement unlocks fire an in-app toast + an OS notification.

import { invoke } from "@tauri-apps/api/core";
import type { Achievement, Goal, Habit, HabitLog } from "../../shared/types";
import { daysInMonth, pad, toISO } from "./api";
import { toast } from "./Toasts";

export const XP_PER_TICK = 10;
// Leveling curve: level 1 -> 2 costs 100 XP, and every level after costs
// 50 more than the one before (2 -> 3 is 150, 3 -> 4 is 200, ...).
export const XP_BASE = 100;
export const XP_STEP = 50;

// ---- Rust commands ----
export const getXp = () => invoke<number>("get_xp");
export const adjustXp = (delta: number) => invoke<number>("adjust_xp", { delta });
export const listAchievements = () => invoke<Achievement[]>("list_achievements");
const unlockAchievement = (id: string) =>
  invoke<boolean>("unlock_achievement", { id });
const notifyUser = (title: string, body: string) =>
  invoke<void>("notify_user", { title, body }).catch(() => {});

// ---- level math ----
/** XP needed to climb from `level` to `level + 1`. */
export const xpNeededFor = (level: number) => XP_BASE + (level - 1) * XP_STEP;

/** Total XP required to have reached `level` (level 1 = 0). */
export function xpForLevel(level: number): number {
  const n = level - 1;
  return n * XP_BASE + (XP_STEP * n * (n - 1)) / 2;
}

export function levelOf(xp: number): number {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  return level;
}

/** XP earned inside the current level (0 .. xpNeededFor(level)-1). */
export const xpIntoLevel = (xp: number) => xp - xpForLevel(levelOf(xp));

// ---- ranks: a new name every 10 levels ----
export const RANKS = [
  "Iron",
  "Bronze",
  "Silver",
  "Gold",
  "Platinum",
  "Diamond",
  "Master",
  "Grandmaster",
  "Legend",
];

/** Levels 1-10 = Iron, 11-20 = Bronze, ... (caps at Legend). */
export const rankOf = (level: number) =>
  RANKS[Math.min(Math.floor((level - 1) / 10), RANKS.length - 1)];

/**
 * Apply a tick's XP (+10 / -10) and celebrate a completed level exactly once.
 * Returns the new total.
 */
export async function applyTickXp(delta: number): Promise<number> {
  const newXp = await adjustXp(delta);
  // anyone displaying XP (sidebar profile, Progress tab) updates instantly
  window.dispatchEvent(new CustomEvent("xp-changed", { detail: newXp }));
  if (delta > 0) {
    const before = levelOf(newXp - delta);
    const after = levelOf(newXp);
    if (after > before) {
      const rank = rankOf(after);
      if (rank !== rankOf(before)) {
        // crossing a 10-level boundary is the bigger moment — lead with it
        toast("🏅", `Rank up: ${rank}!`, `Level ${after} — welcome to ${rank}.`);
        void notifyUser(`🏅 Rank up: ${rank}!`, `Level ${after} reached. New tier unlocked.`);
      } else {
        toast("🎉", `Level ${after}!`, `You completed level ${before} — keep going.`);
        void notifyUser(`⚡ Level ${after}!`, `Level ${before} complete. Onward.`);
      }
    }
  }
  return newXp;
}

// ---- achievements ----
export interface AchievementDef {
  id: string;
  emoji: string;
  title: string;
  desc: string;
}

interface Ctx {
  goals?: Goal[];
  habits?: Habit[];
  logs?: HabitLog[]; // current month
  today?: string; // "YYYY-MM-DD"
  xp?: number;
}

/** Every habit existing on `date` was checked that day. */
function fullDay(habits: Habit[], doneSet: Set<string>, date: string): boolean {
  const existing = habits.filter((h) => h.createdDate <= date);
  return (
    existing.length > 0 && existing.every((h) => doneSet.has(`${h.id}|${date}`))
  );
}

/**
 * LeetCode-style streak: consecutive days with EVERY habit done, walking
 * back from today (an incomplete today doesn't break it).
 */
export function currentStreak(
  habits: Habit[],
  logs: HabitLog[],
  today: string,
): number {
  const doneSet = new Set(logs.map((l) => `${l.habitId}|${l.date}`));
  let days = 0;
  const d = new Date(today + "T00:00:00");
  if (!fullDay(habits, doneSet, today)) d.setDate(d.getDate() - 1);
  while (fullDay(habits, doneSet, toISO(d))) {
    days++;
    d.setDate(d.getDate() - 1);
  }
  return days;
}

/** True when some whole calendar month had every habit done every day. */
function hasFullMonth(habits: Habit[], logs: HabitLog[]): boolean {
  const doneSet = new Set(logs.map((l) => `${l.habitId}|${l.date}`));
  const months = new Set(logs.map((l) => l.date.slice(0, 7))); // "YYYY-MM"
  for (const m of months) {
    const [y, mo] = m.split("-").map(Number);
    const dim = daysInMonth(y, mo - 1);
    let full = true;
    for (let day = 1; day <= dim; day++) {
      if (!fullDay(habits, doneSet, `${m}-${pad(day)}`)) {
        full = false;
        break;
      }
    }
    if (full) return true;
  }
  return false;
}

const streakOf = (c: Ctx) =>
  c.habits && c.logs && c.today ? currentStreak(c.habits, c.logs, c.today) : 0;

const RANK_EMOJI = ["🛡️", "🥉", "🥈", "🥇", "💠", "💎", "🎖️", "👑", "🌟"];

export const ACHIEVEMENTS: (AchievementDef & { check: (c: Ctx) => boolean })[] = [
  // --- streak badges (all habits done, consecutive days) ---
  {
    id: "streak-7",
    emoji: "🔥",
    title: "7 Day Streak",
    desc: "Every habit done, 7 days in a row",
    check: (c) => streakOf(c) >= 7,
  },
  {
    id: "streak-30",
    emoji: "⚡",
    title: "30 Day Streak",
    desc: "Every habit done, 30 days in a row",
    check: (c) => streakOf(c) >= 30,
  },
  {
    id: "streak-100",
    emoji: "💯",
    title: "100 Days Badge",
    desc: "Every habit done, 100 days in a row",
    check: (c) => streakOf(c) >= 100,
  },
  // --- monthly badge ---
  {
    id: "monthly",
    emoji: "📅",
    title: "Monthly Master",
    desc: "A full calendar month, every habit every day",
    check: (c) => !!c.habits && !!c.logs && hasFullMonth(c.habits, c.logs),
  },
  // --- tasks ---
  {
    id: "task-slayer",
    emoji: "🏁",
    title: "Task Slayer",
    desc: "Complete an entire task",
    check: (c) =>
      !!c.goals &&
      c.goals.some((g) => g.targetCount > 0 && g.currentCount >= g.targetCount),
  },
  // --- one badge per rank ---
  ...RANKS.map((name, i) => ({
    id: `rank-${name.toLowerCase()}`,
    emoji: RANK_EMOJI[i],
    title: `${name} Rank`,
    desc: i === 0 ? "Earn your first XP" : `Reach level ${i * 10 + 1}`,
    check: (c: Ctx) =>
      c.xp !== undefined &&
      (i === 0 ? c.xp > 0 : levelOf(c.xp) >= i * 10 + 1),
  })),
];

/**
 * Evaluate the catalog against current state and unlock anything newly
 * earned (backend keeps it idempotent — the toast fires exactly once).
 */
export async function checkAchievements(ctx: Ctx): Promise<void> {
  for (const a of ACHIEVEMENTS) {
    let earned = false;
    try {
      earned = a.check(ctx);
    } catch {
      // a bad check must never break ticking
    }
    if (!earned) continue;
    try {
      const fresh = await unlockAchievement(a.id);
      if (fresh) {
        toast(a.emoji, `Achievement: ${a.title}`, a.desc);
        void notifyUser(`${a.emoji} Achievement unlocked`, `${a.title} — ${a.desc}`);
      }
    } catch {
      // offline/backend hiccup: it'll unlock on the next tick
    }
  }
}
