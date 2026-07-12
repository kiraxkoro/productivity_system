// App-level driver for Android app blocking: keeps AppBlockerService in step
// with whatever block the Rust backend says is active, on every page — a
// scheduled block must engage even when the scheduler screen isn't open.
//
// Triggers: the backend's "active-block-changed" event, a BLOCKS_CHANGED
// window event the scheduler UI fires after any mutation (create/stop/pause),
// and a slow safety-net poll. All paths funnel into one idempotent sync, so
// there is exactly one writer to the native service.

import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getActiveBlock, getPauseUntil } from "../routes/scheduler/api";
import { isMobilePlatform } from "./platform";
import {
  hasNativeBlocker,
  startNativeBlocking,
  stopNativeBlocking,
} from "./native";

/** Dispatched on window by the scheduler UI right after blocks/pauses change. */
export const BLOCKS_CHANGED = "focus-blocks-changed";

export function useNativeBlockSync() {
  useEffect(() => {
    if (!isMobilePlatform || !hasNativeBlocker()) return;
    let disposed = false;

    const sync = async () => {
      try {
        const [block, pauseUntil] = await Promise.all([
          getActiveBlock(),
          getPauseUntil().catch(() => 0),
        ]);
        if (disposed) return;
        const pkgs =
          block?.actions
            .filter((a) => a.trigger === "onStart" && a.type === "closeApp")
            .map((a) => a.target) ?? [];
        const paused = pauseUntil * 1000 > Date.now();
        if (block && pkgs.length > 0 && !paused) {
          const [h, m] = block.endTime.split(":").map(Number);
          const end = new Date();
          end.setHours(h, m, 0, 0);
          startNativeBlocking(pkgs, end.getTime());
        } else {
          stopNativeBlocking();
        }
      } catch {
        // backend unreachable — leave the service alone; it self-stops at
        // its end time anyway
      }
    };

    void sync();
    // safety net: catches scheduled blocks starting and pauses expiring
    const interval = setInterval(() => void sync(), 10_000);
    const onChanged = () => void sync();
    window.addEventListener(BLOCKS_CHANGED, onChanged);
    let unlisten: UnlistenFn | undefined;
    listen("active-block-changed", () => void sync())
      .then((fn) => (unlisten = fn))
      .catch(() => {});
    return () => {
      disposed = true;
      clearInterval(interval);
      window.removeEventListener(BLOCKS_CHANGED, onChanged);
      unlisten?.();
    };
  }, []);
}
