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

fn run_actions(block: &ScheduleBlock, trigger: &str) {
    for action in block.actions.iter().filter(|a| a.trigger == trigger) {
        run_action(action);
    }
}

fn run_action(action: &BlockAction) {
    let result = match action.r#type.as_str() {
        "openApp" | "openTab" => open_target(action.target.trim()),
        "closeApp" => close_process(action.target.trim()),
        "closeTab" => {
            // real per-tab control needs the browser extension (later milestone)
            eprintln!(
                "[scheduler] closeTab not implemented yet (target: {})",
                action.target
            );
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
