use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use std::{collections::BTreeSet, ffi::OsString};

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

pub fn load_local_setups(state: &AppState, track_path: &Path) -> AppResult<Vec<LocalSetup>> {
    let track_path = resolve_track_path(state, track_path)?;
    if !track_path.exists() {
        return Ok(Vec::new());
    }
    if !track_path.is_dir() {
        return Err(AppError::from("The selected track path is not a folder."));
    }
    scan_track_setups(&track_path)
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
    let track_path = ensure_track_folder(state, track_path)?;
    let sanitized_name = sanitize_file_name(file_name)?;
    let new_path = track_path.join(sanitized_name);

    if new_path.exists() {
        return Err(AppError::from(
            "A setup with that file name already exists.",
        ));
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
        return Err(AppError::from(
            "A setup with that file name already exists.",
        ));
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

pub fn copy_local_setup_to_tracks(
    state: &AppState,
    source_path: &Path,
    target_track_paths: &[String],
) -> AppResult<Vec<PathBuf>> {
    let source_path = validate_existing_setup_path(state, source_path)?;
    let source_track_path = source_path
        .parent()
        .ok_or_else(|| AppError::from("The selected setup path is invalid."))?
        .to_path_buf();
    let source_car_path = source_track_path
        .parent()
        .ok_or_else(|| AppError::from("The selected setup path is invalid."))?
        .to_path_buf();
    let source_file_name = source_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::from("The selected setup file name is invalid."))?;

    if target_track_paths.is_empty() {
        return Err(AppError::from("Select at least one destination track."));
    }

    let mut validated_tracks = Vec::new();
    for target_track_path in target_track_paths {
        let target_track = ensure_track_folder(state, Path::new(target_track_path))?;

        if validated_tracks.iter().any(|path| path == &target_track) {
            continue;
        }

        if target_track == source_track_path {
            return Err(AppError::from(
                "The current track cannot be selected as a copy destination.",
            ));
        }

        let target_car_path = target_track
            .parent()
            .ok_or_else(|| AppError::from("The selected destination track path is invalid."))?;
        if target_car_path != source_car_path {
            return Err(AppError::from(
                "Setups can only be copied into tracks for the same car.",
            ));
        }

        validated_tracks.push(target_track);
    }

    if validated_tracks.is_empty() {
        return Err(AppError::from("Select at least one destination track."));
    }

    let target_paths = validated_tracks
        .iter()
        .map(|track_path| unique_copy_target_path(track_path, source_file_name))
        .collect::<Vec<_>>();

    let mut created_paths: Vec<PathBuf> = Vec::new();
    for target_path in &target_paths {
        if let Err(error) = fs::copy(&source_path, target_path) {
            for created_path in &created_paths {
                fs::remove_file(created_path).map_err(|cleanup_error| {
                    AppError::from(format!(
                        "Copying the setup failed and the rollback also failed for {}: {}",
                        created_path.display(),
                        cleanup_error
                    ))
                })?;
            }

            return Err(error.into());
        }

        created_paths.push(target_path.clone());
    }

    Ok(target_paths)
}

pub fn write_setup_into_track(
    state: &AppState,
    track_path: &Path,
    target_file_name: &str,
    content: &str,
    overwrite: bool,
) -> AppResult<PathBuf> {
    let track_path = ensure_track_folder(state, track_path)?;
    let sanitized_name = sanitize_file_name(target_file_name)?;
    let target_path = track_path.join(sanitized_name);
    if target_path.exists() && !overwrite {
        return Err(AppError::from(
            "A setup with that file name already exists.",
        ));
    }

    validate_json(content)?;
    fs::write(&target_path, content)?;
    Ok(target_path)
}

pub fn write_setup_into_track_with_unique_name(
    state: &AppState,
    track_path: &Path,
    target_file_name: &str,
    content: &str,
) -> AppResult<PathBuf> {
    let track_path = ensure_track_folder(state, track_path)?;
    let sanitized_name = sanitize_file_name(target_file_name)?;
    let target_path = unique_copy_target_path(&track_path, &sanitized_name);

    validate_json(content)?;
    fs::write(&target_path, content)?;
    Ok(target_path)
}

fn scan_local_library(settings: &AppSettings) -> AppResult<LocalLibrary> {
    let root = settings::resolve_effective_root(settings)
        .ok_or_else(|| AppError::from("No valid setup root is configured."))?;
    let root = fs::canonicalize(root)?;

    let mut cars = Vec::new();
    let mut tracks = Vec::new();
    let mut track_folder_names = BTreeSet::new();
    let car_entries = sorted_directory_entries(&root, true)?;

    for car_entry in &car_entries {
        for track_entry in sorted_directory_entries(&car_entry.path(), true)? {
            track_folder_names.insert(track_entry.file_name());
        }
    }

    let all_track_folder_names = sort_os_strings_case_insensitive(track_folder_names);

    for car_entry in car_entries {
        let car_path = car_entry.path();
        let car_folder_name = car_entry.file_name().to_string_lossy().into_owned();
        let existing_track_entries = sorted_directory_entries(&car_path, true)?;
        let existing_track_names = existing_track_entries
            .into_iter()
            .map(|entry| entry.file_name())
            .collect::<BTreeSet<_>>();

        cars.push(Car {
            id: path_to_string(&car_path),
            folder_name: car_folder_name.clone(),
            display_name: prettify_name(&car_folder_name),
            absolute_path: path_to_string(&car_path),
            track_count: all_track_folder_names.len(),
        });

        for track_folder_name in &all_track_folder_names {
            let track_path = car_path.join(track_folder_name);
            let setup_count = if existing_track_names.contains(track_folder_name) {
                count_directory_entries(&track_path, false)?
            } else {
                0
            };
            let track_folder_name = track_folder_name.to_string_lossy().into_owned();

            tracks.push(Track {
                id: path_to_string(&track_path),
                car_id: path_to_string(&car_path),
                folder_name: track_folder_name.clone(),
                display_name: prettify_name(&track_folder_name),
                absolute_path: path_to_string(&track_path),
                setup_count,
            });
        }
    }

    Ok(LocalLibrary { cars, tracks })
}

fn scan_track_setups(track_path: &Path) -> AppResult<Vec<LocalSetup>> {
    let track_id = path_to_string(track_path);
    sorted_directory_entries(track_path, false)?
        .into_iter()
        .map(|setup_entry| build_local_setup(setup_entry, &track_id))
        .collect()
}

fn build_local_setup(setup_entry: fs::DirEntry, track_id: &str) -> AppResult<LocalSetup> {
    let setup_path = setup_entry.path();
    let metadata = setup_entry.metadata()?;
    let file_name = setup_entry.file_name().to_string_lossy().into_owned();
    let stem = setup_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(&file_name);

    Ok(LocalSetup {
        id: path_to_string(&setup_path),
        track_id: track_id.to_owned(),
        file_name: file_name.clone(),
        display_name: prettify_name(stem),
        absolute_path: path_to_string(&setup_path),
        last_modified_at: format_system_time(metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH)),
        file_extension: setup_path
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_owned),
    })
}

fn resolve_track_path(state: &AppState, track_path: &Path) -> AppResult<PathBuf> {
    let resolved_track_path = ensure_path_inside_root(state, track_path)?;
    let car_path = resolved_track_path
        .parent()
        .ok_or_else(|| AppError::from("The selected track path is invalid."))?;

    if !car_path.is_dir() {
        return Err(AppError::from("The selected car folder no longer exists."));
    }

    Ok(resolved_track_path)
}

fn ensure_track_folder(state: &AppState, track_path: &Path) -> AppResult<PathBuf> {
    let resolved_track_path = resolve_track_path(state, track_path)?;
    if resolved_track_path.exists() {
        if !resolved_track_path.is_dir() {
            return Err(AppError::from("The selected track path is not a folder."));
        }
        return Ok(resolved_track_path);
    }

    fs::create_dir_all(&resolved_track_path)?;
    Ok(resolved_track_path)
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
    let canonical_path = if path.exists() {
        fs::canonicalize(path)?
    } else {
        let parent = path
            .parent()
            .ok_or_else(|| AppError::from("The requested path is invalid."))?;
        let canonical_parent = fs::canonicalize(parent)?;
        let file_name = path
            .file_name()
            .ok_or_else(|| AppError::from("The requested path is invalid."))?;
        canonical_parent.join(file_name)
    };

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

fn sort_os_strings_case_insensitive(values: BTreeSet<OsString>) -> Vec<OsString> {
    let mut values = values.into_iter().collect::<Vec<_>>();
    values.sort_by_key(|value| value.to_string_lossy().to_string().to_lowercase());
    values
}

fn count_directory_entries(path: &Path, directories_only: bool) -> AppResult<usize> {
    Ok(fs::read_dir(path)?
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
        .count())
}

fn validate_json(content: &str) -> AppResult<()> {
    serde_json::from_str::<serde_json::Value>(content)?;
    Ok(())
}

fn unique_copy_target_path(track_path: &Path, file_name: &str) -> PathBuf {
    let preferred_path = track_path.join(file_name);
    if !preferred_path.exists() {
        return preferred_path;
    }

    let file_path = Path::new(file_name);
    let stem = file_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(file_name);
    let extension = file_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();

    let mut index = 1usize;
    loop {
        let suffix = if index == 1 {
            " (copy)".to_owned()
        } else {
            format!(" (copy {index})")
        };
        let candidate = track_path.join(format!("{stem}{suffix}{extension}"));
        if !candidate.exists() {
            return candidate;
        }
        index += 1;
    }
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
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
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

#[cfg(test)]
mod tests {
    use super::{sort_os_strings_case_insensitive, unique_copy_target_path};
    use std::fs;
    use std::path::PathBuf;
    use std::{collections::BTreeSet, ffi::OsString};
    use uuid::Uuid;

    fn create_temp_dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!("acc-setup-manager-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    #[test]
    fn picks_original_name_when_destination_is_free() {
        let temp_dir = create_temp_dir();
        let target_path = unique_copy_target_path(&temp_dir, "race.json");

        assert_eq!(target_path, temp_dir.join("race.json"));

        fs::remove_dir_all(temp_dir).expect("remove temp dir");
    }

    #[test]
    fn appends_incrementing_copy_suffix_when_needed() {
        let temp_dir = create_temp_dir();
        fs::write(temp_dir.join("race.json"), "{}").expect("write original");
        fs::write(temp_dir.join("race (copy).json"), "{}").expect("write first copy");

        let target_path = unique_copy_target_path(&temp_dir, "race.json");

        assert_eq!(target_path, temp_dir.join("race (copy 2).json"));

        fs::remove_dir_all(temp_dir).expect("remove temp dir");
    }

    #[test]
    fn sorts_track_names_case_insensitively() {
        let values = BTreeSet::from([
            OsString::from("zolder"),
            OsString::from("Barcelona"),
            OsString::from("brands_hatch"),
        ]);

        let sorted = sort_os_strings_case_insensitive(values);

        assert_eq!(
            sorted,
            vec![
                OsString::from("Barcelona"),
                OsString::from("brands_hatch"),
                OsString::from("zolder"),
            ]
        );
    }
}
