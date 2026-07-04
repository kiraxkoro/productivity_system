// Person A: everything pre-baked so a lazy-but-ambitious user never types
// an exe name or URL by hand unless they really want to.

import type { BlockAction } from "../../shared/types";

/** Apps we kill during focus. Deliberately excludes browsers/editors — nothing
 *  with unsaved work should ever be force-closed by a preset. */
export const DISTRACTIONS: { label: string; process: string }[] = [
  { label: "Discord", process: "Discord.exe" },
  { label: "Steam", process: "steam.exe" },
  { label: "Spotify", process: "Spotify.exe" },
  { label: "Telegram", process: "Telegram.exe" },
  { label: "WhatsApp", process: "WhatsApp.exe" },
  { label: "Epic Games", process: "EpicGamesLauncher.exe" },
];

export const distractionBlockers = (): BlockAction[] =>
  DISTRACTIONS.map((d) => ({
    trigger: "onStart",
    type: "closeApp",
    target: d.process,
  }));

/** Suggestions for "open app" targets (Windows `start` resolves all of these). */
export const OPEN_SUGGESTIONS: { label: string; target: string }[] = [
  { label: "VS Code", target: "code" },
  { label: "Chrome", target: "chrome" },
  { label: "Edge", target: "msedge" },
  { label: "Notepad", target: "notepad" },
  { label: "Spotify", target: "spotify:" },
];

export interface Template {
  emoji: string;
  label: string;
  durationMin: number;
  hint: string;
  actions: BlockAction[];
}

export const TEMPLATES: Template[] = [
  {
    emoji: "🧠",
    label: "LeetCode Grind",
    durationMin: 90,
    hint: "opens LeetCode, kills distractions",
    actions: [
      {
        trigger: "onStart",
        type: "openTab",
        target: "https://leetcode.com/problemset/",
      },
      ...distractionBlockers(),
    ],
  },
  {
    emoji: "💻",
    label: "Deep Work",
    durationMin: 120,
    hint: "opens VS Code, kills distractions",
    actions: [
      { trigger: "onStart", type: "openApp", target: "code" },
      ...distractionBlockers(),
    ],
  },
  {
    emoji: "📚",
    label: "Study Session",
    durationMin: 60,
    hint: "just kills distractions",
    actions: [...distractionBlockers()],
  },
  {
    emoji: "✉️",
    label: "Email & Admin",
    durationMin: 30,
    hint: "opens Gmail",
    actions: [
      { trigger: "onStart", type: "openTab", target: "https://mail.google.com" },
    ],
  },
];
