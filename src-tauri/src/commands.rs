use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, AppResult};
use crate::models::{
    AppBootstrap, GlobalSetupState, LocalSetup, MutationResult, RemoteSourceResult, SetupDocument,
};
use crate::services::filesystem;
use crate::services::global_setup;
use crate::services::remote;
use crate::services::settings;
use crate::services::undo::UndoOperation;
use crate::state::AppState;

#[tauri::command]
pub fn load_app_bootstrap(state: State<'_, AppState>) -> AppResult<AppBootstrap> {
    filesystem::load_bootstrap(&state)
}

#[tauri::command]
pub fn frontend_ready(app: AppHandle) -> AppResult<()> {
    if let Some(main_window) = app.get_webview_window("main") {
        main_window
            .show()
            .map_err(|error| AppError::from(error.to_string()))?;
        main_window
            .set_focus()
            .map_err(|error| AppError::from(error.to_string()))?;
    }

    if let Some(splashscreen_window) = app.get_webview_window("splashscreen") {
        splashscreen_window
            .close()
            .map_err(|error| AppError::from(error.to_string()))?;
    }

    Ok(())
}

#[tauri::command]
pub fn set_manual_setup_root(
    state: State<'_, AppState>,
    path: Option<String>,
) -> AppResult<AppBootstrap> {
    let path_buf = path.as_deref().map(PathBuf::from);
    settings::save_manual_root(&state.db_path, path_buf.as_deref())?;
    filesystem::load_bootstrap(&state)
}

#[tauri::command]
pub fn read_setup_document(state: State<'_, AppState>, path: String) -> AppResult<SetupDocument> {
    let path_buf = PathBuf::from(path);
    filesystem::read_setup_document(&state, path_buf.as_path())
}

#[tauri::command]
pub fn load_local_setups(
    state: State<'_, AppState>,
    track_path: String,
) -> AppResult<Vec<LocalSetup>> {
    let track_path_buf = PathBuf::from(track_path);
    filesystem::load_local_setups(&state, track_path_buf.as_path())
}

#[tauri::command]
pub fn save_local_setup(
    state: State<'_, AppState>,
    path: String,
    content: String,
) -> AppResult<MutationResult> {
    let path_buf = PathBuf::from(path);
    let selected_path = filesystem::save_local_setup(&state, path_buf.as_path(), &content)?;
    filesystem::mutation_result(&state, Some(selected_path))
}

#[tauri::command]
pub fn create_local_setup(
    state: State<'_, AppState>,
    track_path: String,
    file_name: String,
) -> AppResult<MutationResult> {
    let track_path_buf = PathBuf::from(track_path);
    let created_path =
        filesystem::create_local_setup(&state, track_path_buf.as_path(), &file_name)?;
    state.undo_manager()?.push(UndoOperation::Create {
        path: created_path.clone(),
        staged_path: None,
    });
    filesystem::mutation_result(&state, Some(created_path))
}

#[tauri::command]
pub fn rename_local_setup(
    state: State<'_, AppState>,
    path: String,
    new_file_name: String,
) -> AppResult<MutationResult> {
    let original_path = PathBuf::from(&path);
    let renamed_path =
        filesystem::rename_local_setup(&state, original_path.as_path(), &new_file_name)?;
    state.undo_manager()?.push(UndoOperation::Rename {
        from: original_path,
        to: renamed_path.clone(),
    });
    filesystem::mutation_result(&state, Some(renamed_path))
}

#[tauri::command]
pub fn delete_local_setup(state: State<'_, AppState>, path: String) -> AppResult<MutationResult> {
    let path_buf = PathBuf::from(path);
    let (original_path, staged_path) = filesystem::delete_local_setup(&state, path_buf.as_path())?;
    state.undo_manager()?.push(UndoOperation::Delete {
        original_path,
        staged_path,
    });
    filesystem::mutation_result(&state, None)
}

#[tauri::command]
pub fn import_local_setup(
    state: State<'_, AppState>,
    track_path: String,
    source_path: String,
    target_file_name: String,
    overwrite: bool,
) -> AppResult<MutationResult> {
    let track_path_buf = PathBuf::from(track_path);
    let source_path_buf = PathBuf::from(source_path);
    let imported_path = filesystem::import_local_setup(
        &state,
        track_path_buf.as_path(),
        source_path_buf.as_path(),
        &target_file_name,
        overwrite,
    )?;
    filesystem::mutation_result(&state, Some(imported_path))
}

#[tauri::command]
pub fn copy_local_setup_to_tracks(
    state: State<'_, AppState>,
    source_path: String,
    target_track_paths: Vec<String>,
) -> AppResult<MutationResult> {
    let source_path_buf = PathBuf::from(source_path);
    let copied_paths = filesystem::copy_local_setup_to_tracks(
        &state,
        source_path_buf.as_path(),
        &target_track_paths,
    )?;
    let staged_paths = copied_paths
        .iter()
        .map(|path| {
            let staged_path = state.new_staged_file_path("copy")?;
            std::fs::copy(path, &staged_path)?;
            Ok(staged_path)
        })
        .collect::<AppResult<Vec<_>>>()?;
    state.undo_manager()?.push(UndoOperation::Copy {
        paths: copied_paths,
        staged_paths,
    });
    filesystem::mutation_result(&state, None)
}

#[tauri::command]
pub fn undo_last_operation(state: State<'_, AppState>) -> AppResult<MutationResult> {
    state.undo_manager()?.undo()?;
    filesystem::mutation_result(&state, None)
}

#[tauri::command]
pub fn redo_last_operation(state: State<'_, AppState>) -> AppResult<MutationResult> {
    state.undo_manager()?.redo()?;
    filesystem::mutation_result(&state, None)
}

#[tauri::command]
pub fn load_remote_source_results(
    state: State<'_, AppState>,
    source_id: String,
    car_folder_name: String,
    car_display_name: String,
    track_folder_name: String,
    track_display_name: String,
    force_refresh: Option<bool>,
) -> AppResult<RemoteSourceResult> {
    remote::load_remote_source_results(
        &state,
        &source_id,
        &car_folder_name,
        &car_display_name,
        &track_folder_name,
        &track_display_name,
        force_refresh.unwrap_or(false),
    )
}

#[tauri::command]
pub fn read_remote_setup_document(
    state: State<'_, AppState>,
    source_id: String,
    remote_setup_id: String,
) -> AppResult<SetupDocument> {
    remote::read_remote_setup_document(&state, &source_id, &remote_setup_id)
}

#[tauri::command]
pub fn download_remote_setup(
    state: State<'_, AppState>,
    source_id: String,
    remote_setup_id: String,
    track_path: String,
    target_file_name: String,
    overwrite: Option<bool>,
) -> AppResult<MutationResult> {
    let track_path_buf = PathBuf::from(track_path);
    let imported_path = remote::download_remote_setup(
        &state,
        &source_id,
        &remote_setup_id,
        track_path_buf.as_path(),
        &target_file_name,
        overwrite.unwrap_or(false),
    )?;
    filesystem::mutation_result(&state, Some(imported_path))
}

#[tauri::command]
pub fn download_remote_setup_to_tracks(
    state: State<'_, AppState>,
    source_id: String,
    remote_setup_id: String,
    target_track_paths: Vec<String>,
    target_file_name: String,
) -> AppResult<MutationResult> {
    let imported_paths = remote::download_remote_setup_to_tracks(
        &state,
        &source_id,
        &remote_setup_id,
        &target_track_paths,
        &target_file_name,
    )?;
    let staged_paths = imported_paths
        .iter()
        .map(|path| {
            let staged_path = state.new_staged_file_path("remote-download")?;
            std::fs::copy(path, &staged_path)?;
            Ok(staged_path)
        })
        .collect::<AppResult<Vec<_>>>()?;
    state.undo_manager()?.push(UndoOperation::Copy {
        paths: imported_paths.clone(),
        staged_paths,
    });
    filesystem::mutation_result(&state, imported_paths.first().cloned())
}

#[tauri::command]
pub fn global_setup_get_state(state: State<'_, AppState>) -> AppResult<GlobalSetupState> {
    global_setup::get_state(&state)
}

#[tauri::command]
pub fn global_setup_enable(state: State<'_, AppState>) -> AppResult<MutationResult> {
    global_setup::enable(&state)?;
    filesystem::mutation_result(&state, None)
}

#[tauri::command]
pub fn global_setup_disable(state: State<'_, AppState>) -> AppResult<MutationResult> {
    global_setup::disable(&state)?;
    filesystem::mutation_result(&state, None)
}

#[tauri::command]
pub fn global_setup_push(state: State<'_, AppState>) -> AppResult<MutationResult> {
    global_setup::push(&state)?;
    filesystem::mutation_result(&state, None)
}

#[tauri::command]
pub fn global_setup_adopt(
    state: State<'_, AppState>,
    source_path: String,
) -> AppResult<MutationResult> {
    global_setup::adopt(&state, PathBuf::from(source_path).as_path())?;
    filesystem::mutation_result(&state, None)
}

#[tauri::command]
pub fn global_setup_save_master(
    state: State<'_, AppState>,
    content: String,
) -> AppResult<MutationResult> {
    global_setup::save_master(&state, &content)?;
    filesystem::mutation_result(&state, None)
}
