// Person A: typed wrappers around the Rust commands + small time helpers.
// All times are "HH:MM" zero-padded strings, so plain string comparison works.

import { invoke } from "@tauri-apps/api/core";
import type { ScheduleBlock } from "../../shared/types";

// ---- Rust commands ----
export const listBlocks = () => invoke<ScheduleBlock[]>("list_schedule_blocks");
export const createBlock = (block: ScheduleBlock) =>
  invoke<ScheduleBlock>("create_schedule_block", { block });
export const updateBlock = (block: ScheduleBlock) =>
  invoke<ScheduleBlock>("update_schedule_block", { block });
export const deleteBlock = (id: string) =>
  invoke<void>("delete_schedule_block", { id });
export const setBlockEnabled = (id: string, enabled: boolean) =>
  invoke<void>("set_block_enabled", { id, enabled });
export const getActiveBlock = () =>
  invoke<ScheduleBlock | null>("get_active_block");
export const openApp = (path: string) => invoke<void>("open_app", { path });
export const closeApp = (processName: string) =>
  invoke<void>("close_app", { processName });
export const getAutostart = () => invoke<boolean>("get_autostart");
export const setAutostart = (enabled: boolean) =>
  invoke<void>("set_autostart", { enabled });
export const getAllowedBrowser = () => invoke<string>("get_allowed_browser");
export const setAllowedBrowser = (exe: string) =>
  invoke<void>("set_allowed_browser", { exe });

// ---- time helpers ----
export const pad = (n: number) => String(n).padStart(2, "0");

export const nowHHMM = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Adds minutes to "HH:MM", clamped to 23:59 (blocks never cross midnight). */
export const addMinutes = (hhmm: string, mins: number) => {
  const total = Math.min(toMinutes(hhmm) + mins, 23 * 60 + 59);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
};

/** Now, rounded UP to the next 5 minutes — a friendly default start time. */
export const nextFiveMinutes = () => {
  const d = new Date();
  const total = d.getHours() * 60 + d.getMinutes() + 5;
  const rounded = Math.min(Math.ceil(total / 5) * 5, 23 * 60 + 59);
  return `${pad(Math.floor(rounded / 60))}:${pad(rounded % 60)}`;
};

/** "18:00" -> "6:00 pm" */
export const fmtTime = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${pad(m)} ${suffix}`;
};

export const humanDuration = (mins: number) => {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
};

export const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ---- schedule logic (mirrors src-tauri/src/db.rs so the UI updates instantly) ----
export function appliesToday(b: ScheduleBlock): boolean {
  if (b.oneOffDate) return b.oneOffDate === todayISO();
  return b.daysOfWeek.includes(new Date().getDay());
}

export function isActiveNow(b: ScheduleBlock): boolean {
  const t = nowHHMM();
  return b.enabled && appliesToday(b) && b.startTime <= t && t < b.endTime;
}

/** Same tie-break as the backend: the block that started most recently wins. */
export function activeBlockOf(blocks: ScheduleBlock[]): ScheduleBlock | null {
  const active = blocks.filter(isActiveNow);
  if (active.length === 0) return null;
  return active.reduce((a, b) => (a.startTime >= b.startTime ? a : b));
}

export function nextBlockToday(blocks: ScheduleBlock[]): ScheduleBlock | null {
  const t = nowHHMM();
  const upcoming = blocks
    .filter((b) => b.enabled && appliesToday(b) && b.startTime > t)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  return upcoming[0] ?? null;
}

export function describeDays(b: ScheduleBlock): string {
  if (b.oneOffDate) {
    return b.oneOffDate === todayISO() ? "today only" : `once on ${b.oneOffDate}`;
  }
  const days = [...b.daysOfWeek].sort();
  const key = days.join(",");
  if (key === "0,1,2,3,4,5,6") return "every day";
  if (key === "1,2,3,4,5") return "weekdays";
  if (key === "0,6") return "weekends";
  return days.map((d) => DAY_NAMES[d]).join(" ");
}
