// Mobile counterpart of presets.ts: on Android a "distraction" is a package
// name, not an exe. The user's chosen block list is persisted locally and
// stamped onto blocks as ordinary closeApp actions — the DB schema doesn't
// change, and AppBlockerService (not Rust) is what enforces them.

import type { BlockAction } from "../../shared/types";

export const MOBILE_DISTRACTIONS: { label: string; pkg: string }[] = [
  { label: "Instagram", pkg: "com.instagram.android" },
  { label: "YouTube", pkg: "com.google.android.youtube" },
  { label: "TikTok", pkg: "com.zhiliaoapp.musically" },
  { label: "Snapchat", pkg: "com.snapchat.android" },
  { label: "X", pkg: "com.twitter.android" },
  { label: "Reddit", pkg: "com.reddit.frontpage" },
  { label: "WhatsApp", pkg: "com.whatsapp" },
  { label: "Facebook", pkg: "com.facebook.katana" },
  { label: "Netflix", pkg: "com.netflix.mediaclient" },
];

const KEY = "focusnow.mobileBlockedApps";

/** The packages lockdown sessions block; defaults to the full preset list. */
export function getBlockedPackages(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as string[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    /* corrupt entry — fall through to defaults */
  }
  return MOBILE_DISTRACTIONS.map((d) => d.pkg);
}

export function setBlockedPackages(pkgs: string[]) {
  localStorage.setItem(KEY, JSON.stringify(pkgs));
}

export const mobileAppBlockers = (pkgs: string[]): BlockAction[] =>
  pkgs.map((pkg) => ({ trigger: "onStart", type: "closeApp", target: pkg }));
