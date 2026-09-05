use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::{AppError, AppResult};
use crate::models::{AppSettings, RootStatus};

const MANUAL_ROOT_KEY: &str = "manual_setup_root";

pub fn initialize_database(db_path: &Path) -> AppResult<()> {
    let connection = open_connection(db_path)?;
    connection.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT
        );
        CREATE TABLE IF NOT EXISTS remote_cache_entries (
          source_id TEXT NOT NULL,
          car_id TEXT NOT NULL,
          track_id TEXT NOT NULL,
          fetched_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          stale INTEGER NOT NULL DEFAULT 0,
          payload_json TEXT NOT NULL,
          PRIMARY KEY (source_id, car_id, track_id)
        );
        CREATE TABLE IF NOT EXISTS remote_preview_cache (
          source_id TEXT NOT NULL,
          preview_key TEXT NOT NULL,
          fetched_at TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          PRIMARY KEY (source_id, preview_key)
        );
        CREATE TABLE IF NOT EXISTS download_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_id TEXT,
          target_path TEXT NOT NULL,
          created_at TEXT NOT NULL,
          metadata_json TEXT
        );
        CREATE TABLE IF NOT EXISTS global_sync_state (
          car_folder TEXT NOT NULL,
          track_folder TEXT NOT NULL,
          synced_hash TEXT NOT NULL,
          synced_at TEXT NOT NULL,
          PRIMARY KEY (car_folder, track_folder)
        );
        ",
    )?;
    Ok(())
}

pub fn load_settings(db_path: &Path) -> AppResult<AppSettings> {
    let connection = open_connection(db_path)?;
    let manual_root = connection
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![MANUAL_ROOT_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let detected_root = detect_default_root()
        .filter(|path| path.is_dir())
        .as_deref()
        .map(path_to_string);

    let (effective_root, root_status) = match manual_root.as_deref() {
        Some(path) => {
            let manual_path = PathBuf::from(path);
            if manual_path.is_dir() {
                (Some(path.to_owned()), RootStatus::Ready)
            } else {
                (None, RootStatus::Invalid)
            }
        }
        None => match detected_root.clone() {
            Some(path) => (Some(path), RootStatus::Ready),
            None => (None, RootStatus::Missing),
        },
    };

    Ok(AppSettings {
        detected_root,
        manual_root,
        effective_root,
        root_status,
    })
}

pub fn save_manual_root(db_path: &Path, path: Option<&Path>) -> AppResult<()> {
    let connection = open_connection(db_path)?;

    if let Some(path) = path {
        if !path.is_dir() {
            return Err(AppError::from(
                "The selected setup root must be an existing folder.",
            ));
        }

        connection.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![MANUAL_ROOT_KEY, path_to_string(path)],
        )?;
    } else {
        connection.execute(
            "DELETE FROM settings WHERE key = ?1",
            params![MANUAL_ROOT_KEY],
        )?;
    }

    Ok(())
}

pub fn resolve_effective_root(settings: &AppSettings) -> Option<PathBuf> {
    settings.effective_root.as_ref().map(PathBuf::from)
}

fn detect_default_root() -> Option<PathBuf> {
    dirs::document_dir()
        .map(|documents| documents.join("Assetto Corsa Competizione").join("Setups"))
}

fn open_connection(db_path: &Path) -> AppResult<Connection> {
    Ok(Connection::open(db_path)?)
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
