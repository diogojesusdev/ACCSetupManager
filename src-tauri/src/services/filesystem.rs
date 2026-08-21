use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use chrono::{DateTime, Utc};

use crate::error::{AppError, AppResult};
use crate::models::{
    AppBootstrap, AppSettings, Car, DocumentKind, LocalLibrary, LocalSetup, MutationResult,
    RootStatus, SetupDocument, Track,
};
use crate::services::settings;
use crate::state::AppState;

const EMPTY_SETUP_CONTENT: &str = "{}\n";

pub fn load_bootstrap(state: &AppState) -> AppResult<AppBootstrap> {
    let settings = settings::load_settings(&state.db_path)?;
    let library = match settings.root_status {
        RootStatus::Ready => scan_local_library(&settings)?,
        RootStatus::Missing | RootStatus::Invalid => LocalLibrary::default(),
    };

    Ok(AppBootstrap {
        settings,
        library,
        undo_state: state.undo_state()?,
    })
}

pub fn mutation_result(
    state: &AppState,
    selected_setup_path: Option<PathBuf>,
) -> AppResult<MutationResult> {
    Ok(MutationResult {
        bootstrap: load_bootstrap(state)?,
        selected_setup_path: selected_setup_path.as_deref().map(path_to_string),
    })
}

pub fn read_setup_document(state: &AppState, path: &Path) -> AppResult<SetupDocument> {
    let path = validate_existing_setup_path(state, path)?;
    let content = fs::read_to_string(&path)?;
    let file_stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::from("The selected setup file name is invalid."))?;

    Ok(SetupDocument {
        kind: DocumentKind::Local,
        id: path_to_string(&path),
        title: prettify_name(file_stem),
        content,
        read_only: false,
        dirty: false,
        source_label: "Local setup".to_owned(),
        remote_download: None,
    })
}

pub fn save_local_setup(state: &AppState, path: &Path, content: &str) -> AppResult<PathBuf> {
    let path = validate_existing_setup_path(state, path)?;
    validate_json(content)?;
    fs::write(&path, content)?;
    Ok(path)
}

pub fn create_local_setup(
    state: &AppState,
    track_path: &Path,
    file_name: &str,
) -> AppResult<PathBuf> {
    let track_path = validate_existing_track_path(state, track_path)?;
    let sanitized_name = sanitize_file_name(file_name)?;
    let new_path = track_path.join(sanitized_name);

    if new_path.exists() {
        return Err(AppError::from("A setup with that file name already exists."));
    }

    fs::write(&new_path, EMPTY_SETUP_CONTENT)?;
    Ok(new_path)
}

pub fn rename_local_setup(
    state: &AppState,
    path: &Path,
    new_file_name: &str,
) -> AppResult<PathBuf> {
    let path = validate_existing_setup_path(state, path)?;
    let sanitized_name = sanitize_file_name(new_file_name)?;
    let renamed_path = path
        .parent()
        .ok_or_else(|| AppError::from("The selected setup path is invalid."))?
        .join(sanitized_name);

    if renamed_path.exists() && renamed_path != path {
        return Err(AppError::from("A setup with that file name already exists."));
    }

    fs::rename(&path, &renamed_path)?;
    Ok(renamed_path)
}

pub fn delete_local_setup(state: &AppState, path: &Path) -> AppResult<(PathBuf, PathBuf)> {
    let path = validate_existing_setup_path(state, path)?;
    let staged_path = state.new_staged_file_path("delete")?;
    fs::copy(&path, &staged_path)?;
    trash::delete(&path)?;
    Ok((path, staged_path))
}

pub fn import_local_setup(
    state: &AppState,
    track_path: &Path,
    source_path: &Path,
    target_file_name: &str,
    overwrite: bool,
) -> AppResult<PathBuf> {
    if !source_path.is_file() {
        return Err(AppError::from("The selected import source must be a file."));
    }

    let content = fs::read_to_string(source_path)?;
    write_setup_into_track(state, track_path, target_file_name, &content, overwrite)
}

pub fn write_setup_into_track(
    state: &AppState,
    track_path: &Path,
    target_file_name: &str,
    content: &str,
    overwrite: bool,
) -> AppResult<PathBuf> {
    let track_path = validate_existing_track_path(state, track_path)?;
    let sanitized_name = sanitize_file_name(target_file_name)?;
    let target_path = track_path.join(sanitized_name);
    if target_path.exists() && !overwrite {
        return Err(AppError::from("A setup with that file name already exists."));
    }

    validate_json(content)?;
    fs::write(&target_path, content)?;
    Ok(target_path)
}

fn scan_local_library(settings: &AppSettings) -> AppResult<LocalLibrary> {
    let root = settings::resolve_effective_root(settings)
        .ok_or_else(|| AppError::from("No valid setup root is configured."))?;

    let mut cars = Vec::new();
    let mut tracks = Vec::new();
    let mut local_setups = Vec::new();

    for car_entry in sorted_directory_entries(&root, true)? {
        let car_path = car_entry.path();
        let car_folder_name = car_entry.file_name().to_string_lossy().into_owned();
        let track_entries = sorted_directory_entries(&car_path, true)?;

        cars.push(Car {
            id: path_to_string(&car_path),
            folder_name: car_folder_name.clone(),
            display_name: prettify_name(&car_folder_name),
            absolute_path: path_to_string(&car_path),
            track_count: track_entries.len(),
        });

        for track_entry in track_entries {
            let track_path = track_entry.path();
            let track_folder_name = track_entry.file_name().to_string_lossy().into_owned();
            let setup_entries = sorted_directory_entries(&track_path, false)?;

            tracks.push(Track {
                id: path_to_string(&track_path),
                car_id: path_to_string(&car_path),
                folder_name: track_folder_name.clone(),
                display_name: prettify_name(&track_folder_name),
                absolute_path: path_to_string(&track_path),
                setup_count: setup_entries.len(),
            });

            for setup_entry in setup_entries {
                let setup_path = setup_entry.path();
                let metadata = setup_entry.metadata()?;
                let file_name = setup_entry.file_name().to_string_lossy().into_owned();
                let stem = setup_path
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .unwrap_or(&file_name);

                local_setups.push(LocalSetup {
                    id: path_to_string(&setup_path),
                    track_id: path_to_string(&track_path),
                    file_name: file_name.clone(),
                    display_name: prettify_name(stem),
                    absolute_path: path_to_string(&setup_path),
                    last_modified_at: format_system_time(
                        metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                    ),
                    file_extension: setup_path
                        .extension()
                        .and_then(|value| value.to_str())
                        .map(str::to_owned),
                });
            }
        }
    }

    Ok(LocalLibrary {
        cars,
        tracks,
        local_setups,
    })
}

fn validate_existing_track_path(state: &AppState, track_path: &Path) -> AppResult<PathBuf> {
    let canonical_track_path = ensure_path_inside_root(state, track_path)?;
    if !canonical_track_path.is_dir() {
        return Err(AppError::from("The selected track folder no longer exists."));
    }
    Ok(canonical_track_path)
}

fn validate_existing_setup_path(state: &AppState, setup_path: &Path) -> AppResult<PathBuf> {
    let canonical_setup_path = ensure_path_inside_root(state, setup_path)?;
    if !canonical_setup_path.is_file() {
        return Err(AppError::from("The selected setup file no longer exists."));
    }
    Ok(canonical_setup_path)
}

fn ensure_path_inside_root(state: &AppState, path: &Path) -> AppResult<PathBuf> {
    let settings = settings::load_settings(&state.db_path)?;
    let root = settings::resolve_effective_root(&settings)
        .ok_or_else(|| AppError::from("No valid setup root is configured."))?;
    let canonical_root = fs::canonicalize(root)?;
    let canonical_path = fs::canonicalize(path)?;

    if !canonical_path.starts_with(&canonical_root) {
        return Err(AppError::from(
            "The requested path is outside the configured ACC setups folder.",
        ));
    }

    Ok(canonical_path)
}

fn sorted_directory_entries(path: &Path, directories_only: bool) -> AppResult<Vec<fs::DirEntry>> {
    let mut entries = fs::read_dir(path)?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .filter(|entry| {
            entry
                .file_type()
                .map(|file_type| {
                    if directories_only {
                        file_type.is_dir()
                    } else {
                        file_type.is_file()
                    }
                })
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();

    entries.sort_by_key(|entry| {
        entry
            .file_name()
            .to_string_lossy()
            .to_string()
            .to_lowercase()
    });

    Ok(entries)
}

fn validate_json(content: &str) -> AppResult<()> {
    serde_json::from_str::<serde_json::Value>(content)?;
    Ok(())
}

fn sanitize_file_name(file_name: &str) -> AppResult<String> {
    let trimmed = file_name.trim();
    if trimmed.is_empty() {
        return Err(AppError::from("A setup file name is required."));
    }

    if trimmed.contains(['\\', '/', ':', '*', '?', '"', '<', '>', '|']) {
        return Err(AppError::from(
            "Setup file names cannot contain Windows-reserved path characters.",
        ));
    }

    if trimmed.ends_with('.') || trimmed.ends_with(' ') {
        return Err(AppError::from(
            "Setup file names cannot end with a dot or a space on Windows.",
        ));
    }

    let stem = Path::new(trimmed)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(trimmed)
        .to_ascii_uppercase();

    const RESERVED_NAMES: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
        "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8",
        "LPT9",
    ];

    if RESERVED_NAMES.contains(&stem.as_str()) {
        return Err(AppError::from("That file name is reserved on Windows."));
    }

    Ok(trimmed.to_owned())
}

fn prettify_name(value: &str) -> String {
    value
        .split(['_', '-'])
        .filter(|segment| !segment.is_empty())
        .map(|segment| {
            let mut characters = segment.chars();
            match characters.next() {
                Some(first) => {
                    let mut result = String::new();
                    result.extend(first.to_uppercase());
                    result.push_str(characters.as_str());
                    result
                }
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn format_system_time(value: SystemTime) -> String {
    let timestamp: DateTime<Utc> = DateTime::from(value);
    timestamp.to_rfc3339()
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
