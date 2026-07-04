mod commands;
mod db;
mod scheduler_loop;

use std::sync::Mutex;

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            use tauri::Manager;
            let conn = db::init(app.handle())?;
            app.manage(AppState { db: Mutex::new(conn) });
            scheduler_loop::start(app.handle().clone());
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
