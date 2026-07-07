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
use crate::commands::system::{all_browser_exes, allowed_browser, is_paused};
use crate::db::{self, BlockAction, ScheduleBlock};
use crate::AppState;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const POLL_SECS: u64 = 15;
const WARN_MINUTES: i32 = 5;

/// closeApp target meaning "every visible app not opened by this block".
const WHITELIST_SENTINEL: &str = "*";

/// Never killed by whitelist mode — the desktop has to stay usable.
const SYSTEM_ALLOWLIST: [&str; 12] = [
    "explorer.exe",
    "taskmgr.exe",
    "searchhost.exe",
    "startmenuexperiencehost.exe",
    "shellexperiencehost.exe",
    "applicationframehost.exe",
    "systemsettings.exe",
    "textinputhost.exe",
    "msedgewebview2.exe", // hosts the Focus OS UI itself
    "focus-os.exe",
    "dwm.exe",
    "lockapp.exe",
];

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        // Keeps the full block (not just the id) so onEnd actions still fire
        // after an expired one-off block has been deleted from the table.
        let mut last_active: Option<ScheduleBlock> = None;
        // "block-id|date" we already sent the heads-up notification for
        let mut warned_for: Option<String> = None;
        loop {
            tick(&app, &mut last_active, &mut warned_for);
            std::thread::sleep(Duration::from_secs(POLL_SECS));
        }
    });
}

fn hhmm_to_minutes(hhmm: &str) -> i32 {
    let mut parts = hhmm.split(':');
    let h: i32 = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    let m: i32 = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    h * 60 + m
}

fn notify(app: &AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(title).body(body).show();
}

fn tick(app: &AppHandle, last_active: &mut Option<ScheduleBlock>, warned_for: &mut Option<String>) {
    let state = app.state::<AppState>();
    let (current, next, allowed, paused) = {
        let conn = match state.db.lock() {
            Ok(c) => c,
            Err(_) => return,
        };
        let _ = db::delete_expired_one_offs(&conn);
        (
            db::get_active_block(&conn).unwrap_or(None),
            db::get_next_block_today(&conn).unwrap_or(None),
            allowed_browser(&conn),
            is_paused(&conn),
        )
    };

    // Heads-up before the hammer drops: "wrap up, lockdown incoming".
    if let Some(nb) = &next {
        let now = chrono::Local::now();
        let mins_until = hhmm_to_minutes(&nb.start_time)
            - hhmm_to_minutes(&now.format("%H:%M").to_string());
        let key = format!("{}|{}", nb.id, now.format("%Y-%m-%d"));
        if (1..=WARN_MINUTES).contains(&mins_until) && warned_for.as_deref() != Some(&key) {
            notify(
                app,
                &format!("⚡ {} starts in {} min", nb.label, mins_until),
                "Wrap up — lockdown incoming.",
            );
            *warned_for = Some(key);
        }
    }

    let changed = current.as_ref().map(|b| &b.id) != last_active.as_ref().map(|b| &b.id);
    if !changed {
        // Enforcement while the block runs: closeApp targets are re-killed
        // every tick (reopening Discord buys ~15s), and if the block locks
        // the browser down, the non-chosen browsers stay dead too. Only the
        // chosen browser is exempt — re-killing it would nuke the work sites.
        // An emergency pause (typed weakness phrase) silences all of it.
        if paused {
            return;
        }
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
            if wants_whitelist(block) {
                enforce_whitelist(&block_allowlist(block, &allowed));
            }
        }
        return;
    }
    if let Some(prev) = last_active.as_ref() {
        run_actions(prev, "onEnd", &allowed);
        let focused = hhmm_to_minutes(&prev.end_time) - hhmm_to_minutes(&prev.start_time);
        notify(
            app,
            &format!("✅ {} done", prev.label),
            &format!("{focused} minutes focused. Future you says thanks."),
        );
    }
    if let Some(block) = current.as_ref() {
        run_actions(block, "onStart", &allowed);
        if wants_whitelist(block) {
            enforce_whitelist(&block_allowlist(block, &allowed));
        }
        notify(
            app,
            &format!("🔒 {}", block.label),
            &format!("Locked in until {}.", block.end_time),
        );
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

/// closeApp "*" = whitelist mode: only apps this block opens may run.
fn wants_whitelist(block: &ScheduleBlock) -> bool {
    block.actions.iter().any(|a| {
        a.trigger == "onStart" && a.r#type == "closeApp" && a.target.trim() == WHITELIST_SENTINEL
    })
}

/// Everything this block permits: its own openApp targets (as exe basenames),
/// the chosen browser, and the system allowlist.
fn block_allowlist(block: &ScheduleBlock, allowed_browser: &str) -> Vec<String> {
    let mut allow: Vec<String> = SYSTEM_ALLOWLIST.iter().map(|s| s.to_string()).collect();
    allow.push(allowed_browser.to_ascii_lowercase());
    for action in block
        .actions
        .iter()
        .filter(|a| a.trigger == "onStart" && a.r#type == "openApp")
    {
        let base = std::path::Path::new(action.target.trim())
            .file_name()
            .map(|f| f.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        if base.is_empty() {
            continue;
        }
        let exe = if base.ends_with(".exe") { base } else { format!("{base}.exe") };
        if !allow.contains(&exe) {
            allow.push(exe);
        }
    }
    allow
}

/// Kills every process that owns a visible window and isn't allowlisted.
/// Visible-window filtering (tasklist /v window titles) is what keeps this
/// from touching services, drivers, and other system machinery.
fn enforce_whitelist(allow: &[String]) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let Ok(out) = std::process::Command::new("tasklist")
            .args(["/v", "/fo", "csv", "/nh"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        else {
            return;
        };
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            let line = line.trim().trim_start_matches('"').trim_end_matches('"');
            let fields: Vec<&str> = line.split("\",\"").collect();
            if fields.len() < 3 {
                continue;
            }
            let image = fields[0].to_ascii_lowercase();
            let pid = fields[1];
            let title = fields[fields.len() - 1];
            if title == "N/A" || title.is_empty() {
                continue; // no visible window — background/system process
            }
            if allow.iter().any(|a| *a == image) {
                continue;
            }
            let _ = std::process::Command::new("taskkill")
                .args(["/PID", pid, "/F"])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = allow;
    }
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
