// Person A: background loop. Every POLL_SECS it checks which block should be
// active; on a transition it fires the old block's onEnd actions and the new
// block's onStart actions, then tells the UI via the "active-block-changed" event.
//
// Note: if the app launches in the middle of a block, that block's onStart
// actions fire once — intentional: opening Focus OS mid-block sets up your
// workspace for you.

use crate::commands::schedules::{close_process, open_target};
use crate::db::{self, BlockAction, ScheduleBlock};
use crate::AppState;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const POLL_SECS: u64 = 15;

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        // Keeps the full block (not just the id) so onEnd actions still fire
        // after an expired one-off block has been deleted from the table.
        let mut last_active: Option<ScheduleBlock> = None;
        loop {
            tick(&app, &mut last_active);
            std::thread::sleep(Duration::from_secs(POLL_SECS));
        }
    });
}

fn tick(app: &AppHandle, last_active: &mut Option<ScheduleBlock>) {
    let state = app.state::<AppState>();
    let current = {
        let conn = match state.db.lock() {
            Ok(c) => c,
            Err(_) => return,
        };
        let _ = db::delete_expired_one_offs(&conn);
        db::get_active_block(&conn).unwrap_or(None)
    };

    let changed = current.as_ref().map(|b| &b.id) != last_active.as_ref().map(|b| &b.id);
    if !changed {
        // Enforcement: while a block is active, its closeApp targets are
        // re-killed every tick — reopening Discord mid-block only buys ~15s.
        // Browsers are exempt: the fresh-browser close is a one-shot at block
        // start (re-killing it would also nuke the assigned sites).
        if let Some(block) = current.as_ref() {
            for action in block.actions.iter().filter(|a| {
                a.trigger == "onStart" && a.r#type == "closeApp" && !is_browser(&a.target)
            }) {
                let _ = close_process(action.target.trim());
            }
        }
        return;
    }
    if let Some(prev) = last_active.as_ref() {
        run_actions(prev, "onEnd");
    }
    if let Some(block) = current.as_ref() {
        run_actions(block, "onStart");
    }
    let _ = app.emit("active-block-changed", &current);
    *last_active = current;
}

const BROWSER_PROCESSES: [&str; 4] = ["chrome.exe", "msedge.exe", "brave.exe", "firefox.exe"];

fn is_browser(target: &str) -> bool {
    let t = target.trim().to_ascii_lowercase();
    BROWSER_PROCESSES
        .iter()
        .any(|b| t == *b || t.ends_with(&format!("\\{b}")))
}

fn run_actions(block: &ScheduleBlock, trigger: &str) {
    // Closes always run before opens, so "close chrome + open leetcode.com"
    // reliably lands you in a fresh browser showing only the assigned sites.
    let (closes, opens): (Vec<&BlockAction>, Vec<&BlockAction>) = block
        .actions
        .iter()
        .filter(|a| a.trigger == trigger)
        .partition(|a| a.r#type.starts_with("close"));
    for action in &closes {
        run_action(action);
    }
    if !closes.is_empty() && !opens.is_empty() {
        // let killed apps (especially browsers) fully die so the open actions
        // launch a fresh instance instead of racing the dying one
        std::thread::sleep(Duration::from_millis(1500));
    }
    for action in &opens {
        run_action(action);
    }
}

fn run_action(action: &BlockAction) {
    let result = match action.r#type.as_str() {
        "openApp" | "openTab" => open_target(action.target.trim()),
        "closeApp" => close_process(action.target.trim()),
        "closeTab" => {
            // handled by the browser extension: it polls blocklist_server and
            // blocks matching tabs for the whole block — nothing to do here
            Ok(())
        }
        other => {
            eprintln!("[scheduler] unknown action type: {other}");
            Ok(())
        }
    };
    if let Err(e) = result {
        eprintln!("[scheduler] action failed: {e}");
    }
}
