use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::UndoState;
use crate::services::{settings, undo::UndoManager};

pub struct AppState {
    pub db_path: PathBuf,
    undo_manager: Mutex<UndoManager>,
    remote_api_key: Mutex<Option<String>>,
    staging_dir: PathBuf,
}

impl AppState {
    pub fn initialize(app_handle: &AppHandle) -> AppResult<Self> {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|error: tauri::Error| AppError::from(error.to_string()))?;
        fs::create_dir_all(&app_data_dir)?;

        let db_path = app_data_dir.join("acc-setup-manager.db");
        settings::initialize_database(&db_path)?;
        let app_state = Self {
            db_path: db_path.clone(),
            undo_manager: Mutex::new(UndoManager::new(app_data_dir.join("session-staging").join(
                Uuid::new_v4().to_string(),
            ))),
            remote_api_key: Mutex::new(None),
            staging_dir: app_data_dir
                .join("session-staging")
                .join(Uuid::new_v4().to_string()),
        };
        fs::create_dir_all(&app_state.staging_dir)?;
        if let Err(error) = crate::services::global_setup::reconcile(&app_state) {
            log::error!("global setup startup reconciliation failed: {error}");
        }

        Ok(app_state)
    }

    pub fn undo_state(&self) -> AppResult<UndoState> {
        Ok(self.undo_manager()?.state())
    }

    pub fn undo_manager(&self) -> AppResult<MutexGuard<'_, UndoManager>> {
        self.undo_manager
            .lock()
            .map_err(|_| AppError::from("The undo manager is unavailable."))
    }

    pub fn new_staged_file_path(&self, prefix: &str) -> AppResult<PathBuf> {
        fs::create_dir_all(&self.staging_dir)?;
        Ok(self
            .staging_dir
            .join(format!("{}-{}.json", prefix, Uuid::new_v4())))
    }

    pub fn get_remote_api_key(&self) -> AppResult<Option<String>> {
        Ok(self
            .remote_api_key
            .lock()
            .map_err(|_| AppError::from("The remote source cache is unavailable."))?
            .clone())
    }

    pub fn set_remote_api_key(&self, api_key: String) -> AppResult<()> {
        *self
            .remote_api_key
            .lock()
            .map_err(|_| AppError::from("The remote source cache is unavailable."))? =
            Some(api_key);
        Ok(())
    }
}
