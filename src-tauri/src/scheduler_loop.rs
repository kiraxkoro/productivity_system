// Person A: background loop. Every POLL_SECS it checks which block should be
// active; on a transition it fires the old block's onEnd actions and the new
// block's onStart actions, then tells the UI via the "active-block-changed" event.
//
// Browser lockout: the user designates ONE browser (settings, auto-detected
// from the Windows default). While a block with browser-lockdown intent is
// active, every OTHER known browser is closed and kept closed — no side door
// around the blocking extension. The chosen browser itself is only closed
// once at block start (the "fresh browser" effect), never re-killed.
//
// Note: if the app launches in the middle of a block, that block's onStart
// actions fire once — intentional: opening Focus OS mid-block sets up your
// workspace for you.

use crate::commands::schedules::{close_process, open_target};
use crate::commands::system::{all_browser_exes, allowed_browser};
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
    let (current, allowed) = {
        let conn = match state.db.lock() {
            Ok(c) => c,
            Err(_) => return,
        };
        let _ = db::delete_expired_one_offs(&conn);
        (
            db::get_active_block(&conn).unwrap_or(None),
            allowed_browser(&conn),
        )
    };

    let changed = current.as_ref().map(|b| &b.id) != last_active.as_ref().map(|b| &b.id);
    if !changed {
        // Enforcement while the block runs: closeApp targets are re-killed
        // every tick (reopening Discord buys ~15s), and if the block locks
        // the browser down, the non-chosen browsers stay dead too. Only the
        // chosen browser is exempt — re-killing it would nuke the work sites.
        if let Some(block) = current.as_ref() {
            for action in block.actions.iter().filter(|a| {
                a.trigger == "onStart"
                    && a.r#type == "closeApp"
                    && !is_same_browser(&a.target, &allowed)
            }) {
                let _ = close_process(action.target.trim());
            }
            if wants_browser_lockdown(block) {
                close_other_browsers(&allowed);
            }
        }
        return;
    }
    if let Some(prev) = last_active.as_ref() {
        run_actions(prev, "onEnd", &allowed);
    }
    if let Some(block) = current.as_ref() {
        run_actions(block, "onStart", &allowed);
    }
    let _ = app.emit("active-block-changed", &current);
    *last_active = current;
}

fn is_browser(target: &str) -> bool {
    let t = target.trim().to_ascii_lowercase();
    all_browser_exes()
        .iter()
        .any(|b| t == *b || t.ends_with(&format!("\\{b}")))
}

fn is_same_browser(target: &str, browser_exe: &str) -> bool {
    let t = target.trim().to_ascii_lowercase();
    t == browser_exe || t.ends_with(&format!("\\{browser_exe}"))
}

/// A closeApp action aimed at any browser = the block wants browser lockdown.
fn wants_browser_lockdown(block: &ScheduleBlock) -> bool {
    block
        .actions
        .iter()
        .any(|a| a.trigger == "onStart" && a.r#type == "closeApp" && is_browser(&a.target))
}

fn close_other_browsers(allowed: &str) {
    for b in all_browser_exes().iter().filter(|b| *b != allowed) {
        let _ = close_process(b);
    }
}

fn run_actions(block: &ScheduleBlock, trigger: &str, allowed: &str) {
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
    // Lockdown blocks also shut the non-chosen browsers at start, so switching
    // browsers isn't an escape hatch.
    if trigger == "onStart" && wants_browser_lockdown(block) {
        close_other_browsers(allowed);
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
