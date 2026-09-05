mod commands;
mod error;
mod models;
mod services;
mod state;

use std::sync::atomic::{AtomicBool, Ordering};

use state::AppState;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

#[derive(Default)]
struct AppLifecycleState {
    is_quitting: AtomicBool,
}

fn show_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(main_window) = app.get_webview_window("main") {
        main_window.unminimize()?;
        main_window.show()?;
        main_window.set_focus()?;
    }

    Ok(())
}

fn quit_app(app: &tauri::AppHandle) {
    app.state::<AppLifecycleState>()
        .is_quitting
        .store(true, Ordering::Relaxed);

    for window in app.webview_windows().values() {
        if let Err(error) = window.close() {
            log::error!(
                "failed to close window '{}' during app exit: {error}",
                window.label()
            );
        }
    }

    app.cleanup_before_exit();
    app.exit(0);
}

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
            app.manage(AppLifecycleState::default());
            app.manage(AppState::initialize(app.handle())?);

            let open_item = MenuItem::with_id(
                app,
                "open_main_window",
                "Open ACC Setup Manager",
                true,
                None::<&str>,
            )?;
            let quit_item = MenuItem::with_id(
                app,
                "quit_app",
                "Close ACC Setup Manager",
                true,
                None::<&str>,
            )?;
            let tray_menu = Menu::with_items(app, &[&open_item, &quit_item])?;
            let tray_icon = app
                .default_window_icon()
                .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".into()))?
                .clone();

            TrayIconBuilder::with_id("main_tray")
                .icon(tray_icon)
                .tooltip("ACC Setup Manager")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open_main_window" => {
                        if let Err(error) = show_main_window(app) {
                            log::error!("failed to show the main window from the tray: {error}");
                        }
                    }
                    "quit_app" => quit_app(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Err(error) = show_main_window(&tray.app_handle()) {
                            log::error!(
                                "failed to show the main window from the tray icon: {error}"
                            );
                        }
                    }
                })
                .build(app)?;

            services::global_setup::spawn_watcher(app.handle().clone());

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }

            if let WindowEvent::CloseRequested { api, .. } = event {
                if window
                    .state::<AppLifecycleState>()
                    .is_quitting
                    .load(Ordering::Relaxed)
                {
                    return;
                }

                if let Err(error) = window.hide() {
                    log::error!("failed to hide the main window to the tray: {error}");
                    return;
                }

                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::frontend_ready,
            commands::load_app_bootstrap,
            commands::set_manual_setup_root,
            commands::read_setup_document,
            commands::load_local_setups,
            commands::save_local_setup,
            commands::create_local_setup,
            commands::rename_local_setup,
            commands::delete_local_setup,
            commands::import_local_setup,
            commands::copy_local_setup_to_tracks,
            commands::undo_last_operation,
            commands::redo_last_operation,
            commands::load_remote_source_results,
            commands::read_remote_setup_document,
            commands::download_remote_setup,
            commands::download_remote_setup_to_tracks,
            commands::global_setup_read_master,
            commands::global_setup_adopt,
            commands::global_setup_save_master,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
