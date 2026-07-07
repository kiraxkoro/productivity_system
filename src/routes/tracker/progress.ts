// Person B: XP, levels, achievements. Every ticked task item or habit is
// +10 XP; unticking takes the 10 back. 100 XP = 1 level. Level-ups and
// achievement unlocks fire an in-app toast + an OS notification.

import { invoke } from "@tauri-apps/api/core";
import type { Achievement, Goal, Habit, HabitLog } from "../../shared/types";
import { toast } from "./Toasts";

export const XP_PER_TICK = 10;
export const XP_PER_LEVEL = 100;

// ---- Rust commands ----
export const getXp = () => invoke<number>("get_xp");
export const adjustXp = (delta: number) => invoke<number>("adjust_xp", { delta });
export const listAchievements = () => invoke<Achievement[]>("list_achievements");
const unlockAchievement = (id: string) =>
  invoke<boolean>("unlock_achievement", { id });
const notifyUser = (title: string, body: string) =>
  invoke<void>("notify_user", { title, body }).catch(() => {});

// ---- level math ----
export const levelOf = (xp: number) => Math.floor(xp / XP_PER_LEVEL) + 1;
export const xpIntoLevel = (xp: number) => xp % XP_PER_LEVEL;

/**
 * Apply a tick's XP (+10 / -10) and celebrate a completed level exactly once.
 * Returns the new total.
 */
export async function applyTickXp(delta: number): Promise<number> {
  const newXp = await adjustXp(delta);
  if (delta > 0) {
    const before = levelOf(newXp - delta);
    const after = levelOf(newXp);
    if (after > before) {
      toast("🎉", `Level ${after}!`, `You completed level ${before} — keep going.`);
      void notifyUser(`⚡ Level ${after}!`, `Level ${before} complete. Onward.`);
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

const totalChecked = (goals: Goal[]) =>
  goals.reduce((n, g) => n + g.checkedItems.length, 0);

/** True when some habit was done every one of the last 7 days (within the
 *  fetched month window). */
function sevenDayStreak(habits: Habit[], logs: HabitLog[], today: string): boolean {
  const done = new Set(logs.map((l) => `${l.habitId}|${l.date}`));
  return habits.some((h) => {
    for (let i = 0; i < 7; i++) {
      const d = new Date(today + "T00:00:00");
      d.setDate(d.getDate() - i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!done.has(`${h.id}|${iso}`)) return false;
    }
    return true;
  });
}

export const ACHIEVEMENTS: (AchievementDef & { check: (c: Ctx) => boolean })[] = [
  {
    id: "first-step",
    emoji: "👣",
    title: "First step",
    desc: "Tick off your very first task item",
    check: (c) => !!c.goals && totalChecked(c.goals) >= 1,
  },
  {
    id: "halfway-there",
    emoji: "⛰️",
    title: "Halfway there",
    desc: "Reach 50% on any task",
    check: (c) =>
      !!c.goals &&
      c.goals.some((g) => g.targetCount > 0 && g.currentCount * 2 >= g.targetCount && g.currentCount > 0),
  },
  {
    id: "task-slayer",
    emoji: "🏁",
    title: "Task slayer",
    desc: "Complete an entire task",
    check: (c) =>
      !!c.goals &&
      c.goals.some((g) => g.targetCount > 0 && g.currentCount >= g.targetCount),
  },
  {
    id: "centurion",
    emoji: "💯",
    title: "Centurion",
    desc: "100 items ticked across all tasks",
    check: (c) => !!c.goals && totalChecked(c.goals) >= 100,
  },
  {
    id: "habit-farmer",
    emoji: "🌱",
    title: "Habit farmer",
    desc: "Create your first habit",
    check: (c) => !!c.habits && c.habits.length >= 1,
  },
  {
    id: "perfect-day",
    emoji: "🌞",
    title: "Perfect day",
    desc: "Every habit done in one day",
    check: (c) =>
      !!c.habits &&
      !!c.logs &&
      !!c.today &&
      c.habits.length > 0 &&
      c.habits.every((h) =>
        c.logs!.some((l) => l.habitId === h.id && l.date === c.today),
      ),
  },
  {
    id: "week-streak",
    emoji: "🔥",
    title: "On fire",
    desc: "One habit, 7 days in a row",
    check: (c) =>
      !!c.habits && !!c.logs && !!c.today && sevenDayStreak(c.habits, c.logs, c.today),
  },
  {
    id: "level-5",
    emoji: "🥉",
    title: "Level 5",
    desc: "Reach level 5",
    check: (c) => c.xp !== undefined && levelOf(c.xp) >= 5,
  },
  {
    id: "level-10",
    emoji: "🥇",
    title: "Level 10",
    desc: "Reach level 10",
    check: (c) => c.xp !== undefined && levelOf(c.xp) >= 10,
  },
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
