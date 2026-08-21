mod commands;
mod error;
mod models;
mod services;
mod state;

use tauri::Manager;
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      app.manage(AppState::initialize(app.handle())?);
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::load_app_bootstrap,
      commands::set_manual_setup_root,
      commands::read_setup_document,
      commands::save_local_setup,
      commands::create_local_setup,
      commands::rename_local_setup,
      commands::delete_local_setup,
      commands::import_local_setup,
      commands::undo_last_operation,
      commands::redo_last_operation,
      commands::load_remote_source_results,
      commands::read_remote_setup_document,
      commands::download_remote_setup,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
