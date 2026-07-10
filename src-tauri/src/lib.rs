mod blocklist_server;
mod commands;
mod db;
mod hosts_blocker;
mod scheduler_loop;

use std::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // must be first: relaunching the app just focuses the running instance
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        // closing the window hides to tray — the scheduler must keep running
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        });

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let conn = db::init(app.handle())?;
            app.manage(AppState { db: Mutex::new(conn) });
            scheduler_loop::start(app.handle().clone());
            blocklist_server::start(app.handle().clone());
            #[cfg(desktop)]
            {
                setup_tray(app)?;
                sync_autostart(app.handle());
                // autostart launches us with --hidden: run in the tray, no window
                if std::env::args().any(|a| a == "--hidden") {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.hide();
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::schedules::create_schedule_block,
            commands::schedules::update_schedule_block,
            commands::schedules::list_schedule_blocks,
            commands::schedules::delete_schedule_block,
            commands::schedules::set_block_enabled,
            commands::schedules::get_active_block,
            commands::schedules::open_app,
            commands::schedules::close_app,
            commands::system::get_autostart,
            commands::system::set_autostart,
            commands::system::get_allowed_browser,
            commands::system::set_allowed_browser,
            commands::system::list_browsers,
            commands::system::emergency_pause,
            commands::system::has_commitment_password,
            commands::system::set_commitment_password,
            commands::system::verify_commitment_password,
            commands::goals::create_goal,
            commands::goals::list_goals,
            commands::goals::update_goal,
            commands::goals::update_goal_progress,
            commands::goals::delete_goal,
            commands::habits::create_habit,
            commands::habits::list_habits,
            commands::habits::delete_habit,
            commands::habits::set_habit_done,
            commands::habits::list_habit_logs,
            commands::progress::get_xp,
            commands::progress::adjust_xp,
            commands::progress::list_achievements,
            commands::progress::unlock_achievement,
            commands::progress::notify_user,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(desktop)]
fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show = MenuItem::with_id(app, "show", "Open Focus OS", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit completely", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::with_id("focus-os-tray")
        .icon(app.default_window_icon().expect("app icon missing").clone())
        .tooltip("Focus OS — scheduler is running")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => {
                // quitting ends all blocking (same semantics as the extension:
                // no Focus OS running = nothing blocked), so clean up hosts
                crate::hosts_blocker::sync(&[]);
                app.exit(0)
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg(desktop)]
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Lazy-person default: turn autostart ON the first time the app ever runs
/// (respecting a later opt-out in Settings), and on every launch refresh the
/// registered path so it always points at the current exe — otherwise it goes
/// stale after installs/updates. Dev builds never touch autostart: only the
/// installed app should own it.
#[cfg(desktop)]
fn sync_autostart(app: &tauri::AppHandle) {
    #[cfg(debug_assertions)]
    {
        let _ = app;
    }
    #[cfg(not(debug_assertions))]
    {
        use tauri_plugin_autostart::ManagerExt;
        let Ok(dir) = app.path().app_data_dir() else {
            return;
        };
        let marker = dir.join(".autostart-default-set");
        if !marker.exists() {
            if app.autolaunch().enable().is_ok() {
                let _ = std::fs::write(&marker, "done");
            }
        } else if app.autolaunch().is_enabled().unwrap_or(false) {
            let _ = app.autolaunch().enable();
        }
    }
}
