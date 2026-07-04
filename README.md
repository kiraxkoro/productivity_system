# Focus OS

A desktop app that fixes "ambition without execution" — one Tauri app with two features built in parallel:

1. **Scheduler** — enforces time-blocked focus sessions. When a block starts (e.g. "6–8 PM: LeetCode"), the app closes distracting apps/tabs and opens the required ones.
2. **Task Tracker** — tracks long-running goals (e.g. "90 LeetCode problems in 90 days") with live completion percentage.

Tech: Tauri 2 (Rust backend) + React/TypeScript (Vite) + SQLite via `rusqlite` (bundled, in the Rust layer — see `src-tauri/src/db.rs`). All data is local — no server.

## Ownership

| Person | Owns |
|---|---|
| Person A — Scheduler | `src/routes/scheduler/`, `src-tauri/src/commands/schedules.rs`, `src-tauri/src/scheduler_loop.rs`, browser extension (built last) |
| Person B — Task Tracker | `src/routes/tracker/`, `src-tauri/src/commands/goals.rs` |
| Shared (edit jointly only) | `src/shared/types.ts` — the data contract |

## Getting started

Prerequisites: [Node.js](https://nodejs.org), [Rust](https://www.rust-lang.org/tools/install), and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS (on Windows: Visual Studio Build Tools with C++ workload + WebView2).

```bash
git clone https://github.com/kiraxkoro/productivity_system.git
cd productivity_system
npm install
npm run tauri dev
```

## Status (2026-07-04)

**Scheduler (Person A): implemented.** Time blocks with weekly repeat or one-off "Focus Now" sessions, prebuilt templates, a distraction-blocker pack, and a Rust background loop (`scheduler_loop.rs`) that polls every 15s and fires each block's `onStart`/`onEnd` actions (open app/website, close app). `closeTab` still needs the browser extension (last milestone).

**Task Tracker (Person B): open.** The `goals` SQLite table is already created in `src-tauri/src/db.rs`; implement the four commands from `src/shared/types.ts` in `src-tauri/src/commands/goals.rs` (register them in `lib.rs`'s `invoke_handler`), then build `src/routes/tracker/GoalList.tsx` / `GoalForm.tsx`. The "Task Tracker" tab in `src/App.tsx` currently shows a placeholder — swap it for `GoalList`.

Note: `tauri-plugin-sql` was dropped in favor of `rusqlite` so both features share one DB connection managed in Rust (`AppState` in `lib.rs`).

## Workflow

- Never commit directly to `main` — branch, then open a PR.
- Only touch `src/shared/types.ts` after telling the other person.
- Merge small and often — one working piece per PR, not a whole feature.
