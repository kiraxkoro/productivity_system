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
  // Store-installed WhatsApp runs as WhatsApp.Root.exe + children; the
  // wildcard catches both it and the classic WhatsApp.exe
  { label: "WhatsApp", process: "WhatsApp*" },
  { label: "Epic Games", process: "EpicGamesLauncher.exe" },
];

export const distractionBlockers = (): BlockAction[] =>
  DISTRACTIONS.map((d) => ({
    trigger: "onStart",
    type: "closeApp",
    target: d.process,
  }));

/** Browsers for the "fresh browser" trick: close the whole browser at block
 *  start, then the block's open-website actions relaunch it showing ONLY the
 *  assigned sites. Deliberately NOT in the kill-pack — closing your browser
 *  is opt-in per block (selective tab-closing needs the future extension). */
export const BROWSERS: { label: string; process: string }[] = [
  { label: "Chrome", process: "chrome.exe" },
  { label: "Edge", process: "msedge.exe" },
  { label: "Brave", process: "brave.exe" },
  { label: "Firefox", process: "firefox.exe" },
  { label: "Opera", process: "opera.exe" },
  { label: "Vivaldi", process: "vivaldi.exe" },
];

/** Close-the-browser-at-start marker. Pass the user's chosen browser; the
 *  scheduler also locks out every OTHER browser while the block runs. */
export const freshBrowser = (browserExe = "chrome.exe"): BlockAction => ({
  trigger: "onStart",
  type: "closeApp",
  target: browserExe,
});

/** Sites the "Block sites" pack locks out (needs the browser extension —
 *  see extension/README.md). Domains cover subdomains automatically. */
export const DISTRACTION_SITES = [
  "youtube.com",
  "instagram.com",
  "x.com",
  "reddit.com",
  "netflix.com",
];

export const siteBlockers = (): BlockAction[] =>
  DISTRACTION_SITES.map((d) => ({
    trigger: "onStart",
    type: "closeTab",
    target: d,
  }));

/** Suggestions for "open app" targets (Windows `start` resolves all of these). */
export const OPEN_SUGGESTIONS: { label: string; target: string }[] = [
  { label: "VS Code", target: "code" },
  { label: "Chrome", target: "chrome" },
  { label: "Edge", target: "msedge" },
  { label: "Notepad", target: "notepad" },
  { label: "Spotify", target: "spotify:" },
  {
    label: "OBS Studio",
    target: "C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe",
  },
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
    hint: "fresh browser with only LeetCode, distractions & sites blocked",
    actions: [
      freshBrowser(),
      {
        trigger: "onStart",
        type: "openTab",
        target: "https://leetcode.com/problemset/",
      },
      ...distractionBlockers(),
      ...siteBlockers(),
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
    hint: "kills distracting apps, blocks distracting sites",
    actions: [...distractionBlockers(), ...siteBlockers()],
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
