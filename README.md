# Focus OS

A desktop app that fixes "ambition without execution" — one Tauri app with two features built in parallel:

1. **Scheduler** — enforces time-blocked focus sessions. When a block starts (e.g. "6–8 PM: LeetCode"), the app closes distracting apps/tabs and opens the required ones.
2. **Task Tracker** — tracks long-running goals (e.g. "90 LeetCode problems in 90 days") with live completion percentage.

Tech: Tauri 2 (Rust backend) + React/TypeScript (Vite) + SQLite via `tauri-plugin-sql`. All data is local — no server.

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

## Workflow

- Never commit directly to `main` — branch, then open a PR.
- Only touch `src/shared/types.ts` after telling the other person.
- Merge small and often — one working piece per PR, not a whole feature.
