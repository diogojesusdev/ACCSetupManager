use std::collections::BTreeMap;
use std::ffi::OsString;
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
pub(crate) const KNOWN_ACC_TRACK_FOLDER_NAMES: &[&str] = &[
    "monza",
    "zolder",
    "brands_hatch",
    "silverstone",
    "paul_ricard",
    "misano",
    "spa",
    "nurburgring",
    "barcelona",
    "hungaroring",
    "zandvoort",
    "kyalami",
    "mount_panorama",
    "suzuka",
    "laguna_seca",
    "imola",
    "oulton_park",
    "donington",
    "snetterton",
    "cota",
    "indianapolis",
    "watkins_glen",
    "valencia",
    "nurburgring_24h",
];

pub fn load_bootstrap(state: &AppState) -> AppResult<AppBootstrap> {
    let settings = settings::load_settings(&state.db_path)?;
    let library = match settings.root_status {
        RootStatus::Ready => {
            ensure_known_track_folders(&settings)?;
            scan_local_library(&settings)?
        }
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
        car_folder: None,
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
    if crate::services::global_setup::is_reserved_setup_path(&path) {
        return Err(AppError::from(
            "The car's global setup cannot be deleted from here.",
        ));
    }
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

fn scan_local_library(settings: &AppSettings) -> AppResult<LocalLibrary> {
    let root = settings::resolve_effective_root(settings)
        .ok_or_else(|| AppError::from("No valid setup root is configured."))?;
    let root = fs::canonicalize(root)?;

    let mut cars = Vec::new();
    let mut tracks = Vec::new();
    let car_entries = sorted_directory_entries(&root, true)?;

    let mut track_folder_names = BTreeMap::new();
    for car_entry in &car_entries {
        for track_entry in sorted_directory_entries(&car_entry.path(), true)? {
            let file_name = track_entry.file_name();
            track_folder_names
                .entry(track_key(&file_name))
                .or_insert(file_name);
        }
    }
    let track_folder_names = collect_track_folder_names(track_folder_names);

    for car_entry in car_entries {
        let car_path = car_entry.path();
        let car_folder_name = car_entry.file_name().to_string_lossy().into_owned();
        let existing_tracks = sorted_directory_entries(&car_path, true)?
            .into_iter()
            .map(|entry| {
                let file_name = entry.file_name();
                (track_key(&file_name), file_name)
            })
            .collect::<BTreeMap<_, _>>();

        cars.push(Car {
            id: path_to_string(&car_path),
            folder_name: car_folder_name.clone(),
            display_name: prettify_name(&car_folder_name),
            absolute_path: path_to_string(&car_path),
            track_count: track_folder_names.len(),
            global_setup_path: path_to_string(&crate::services::global_setup::car_master_path(
                &car_path,
            )),
        });

        for (track_key, canonical_name) in &track_folder_names {
            let track_folder_name = existing_tracks
                .get(track_key)
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| canonical_name.to_string_lossy().into_owned());
            let track_path = car_path.join(&track_folder_name);
            let setup_count = if existing_tracks.contains_key(track_key) {
                scan_track_setups(&track_path)?.len()
            } else {
                0
            };

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

fn track_key(file_name: &OsString) -> String {
    file_name.to_string_lossy().to_lowercase()
}

fn collect_track_folder_names(
    by_key: BTreeMap<String, OsString>,
) -> Vec<(String, OsString)> {
    by_key.into_iter().collect()
}

fn ensure_known_track_folders(settings: &AppSettings) -> AppResult<()> {
    let root = settings::resolve_effective_root(settings)
        .ok_or_else(|| AppError::from("No valid setup root is configured."))?;

    for car_entry in sorted_directory_entries(&root, true)? {
        let car_path = car_entry.path();

        for track_folder_name in KNOWN_ACC_TRACK_FOLDER_NAMES {
            let track_path = car_path.join(track_folder_name);
            if track_path.exists() {
                if !track_path.is_dir() {
                    return Err(AppError::from(format!(
                        "Cannot create the '{}' track folder for '{}' because a file already exists at that path.",
                        track_folder_name,
                        car_path
                            .file_name()
                            .and_then(|value| value.to_str())
                            .unwrap_or("the selected car")
                    )));
                }

                continue;
            }

            fs::create_dir(&track_path)?;
        }
    }

    Ok(())
}

fn scan_track_setups(track_path: &Path) -> AppResult<Vec<LocalSetup>> {
    let track_id = path_to_string(track_path);
    sorted_directory_entries(track_path, false)?
        .into_iter()
        .filter(|setup_entry| {
            !crate::services::global_setup::is_reserved_setup_path(&setup_entry.path())
        })
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

pub(crate) fn ensure_track_folder(state: &AppState, track_path: &Path) -> AppResult<PathBuf> {
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

fn validate_json(content: &str) -> AppResult<()> {
    serde_json::from_str::<serde_json::Value>(content)?;
    Ok(())
}

pub(crate) fn unique_copy_target_path(track_path: &Path, file_name: &str) -> PathBuf {
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

pub(crate) fn sanitize_file_name(file_name: &str) -> AppResult<String> {
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

    if crate::services::global_setup::is_reserved_setup_stem(trimmed) {
        return Err(AppError::from(
            "That file name is reserved for the ACC Manager global setup.",
        ));
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
    use super::{
        collect_track_folder_names, ensure_known_track_folders, scan_local_library,
        unique_copy_target_path, KNOWN_ACC_TRACK_FOLDER_NAMES,
    };
    use std::ffi::OsString;
    use std::fs;
    use std::path::PathBuf;
    use uuid::Uuid;

    use crate::models::{AppSettings, RootStatus};

    fn create_temp_dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!("acc-setup-manager-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    fn settings_with_root(root: &PathBuf) -> AppSettings {
        AppSettings {
            detected_root: Some(root.to_string_lossy().into_owned()),
            manual_root: None,
            effective_root: Some(root.to_string_lossy().into_owned()),
            root_status: RootStatus::Ready,
        }
    }

    #[test]
    fn picks_original_name_when_destination_is_free() {
        let temp_dir = create_temp_dir();
        let target_path = unique_copy_target_path(&temp_dir, "race.json");

        assert_eq!(target_path, temp_dir.join("race.json"));

        fs::remove_dir_all(temp_dir).expect("remove temp dir");
    }

    #[test]
    fn creates_known_track_folders_for_existing_cars() {
        let temp_dir = create_temp_dir();
        let first_car_path = temp_dir.join("bmw_m4_gt3");
        let second_car_path = temp_dir.join("mclaren_720s_gt3_evo");
        fs::create_dir_all(first_car_path.join("monza")).expect("create existing track");
        fs::create_dir_all(&second_car_path).expect("create second car");

        ensure_known_track_folders(&settings_with_root(&temp_dir)).expect("create track folders");

        for car_path in [&first_car_path, &second_car_path] {
            for track_folder_name in KNOWN_ACC_TRACK_FOLDER_NAMES {
                assert!(
                    car_path.join(track_folder_name).is_dir(),
                    "missing track folder '{}' for '{}'",
                    track_folder_name,
                    car_path.display()
                );
            }
        }

        fs::remove_dir_all(temp_dir).expect("remove temp dir");
    }

    #[test]
    fn errors_when_track_path_is_taken_by_a_file() {
        let temp_dir = create_temp_dir();
        let car_path = temp_dir.join("bmw_m4_gt3");
        fs::create_dir_all(&car_path).expect("create car folder");
        fs::write(car_path.join("spa"), "not a directory").expect("create conflicting file");

        let error =
            ensure_known_track_folders(&settings_with_root(&temp_dir)).expect_err("expect error");

        assert!(error
            .to_string()
            .contains("Cannot create the 'spa' track folder"));

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
    fn dedupes_and_sorts_track_names_case_insensitively() {
        let mut names = std::collections::BTreeMap::new();
        for name in [
            OsString::from("zolder"),
            OsString::from("Barcelona"),
            OsString::from("brands_hatch"),
            OsString::from("SPA"),
            OsString::from("spa"),
        ] {
            names
                .entry(name.to_string_lossy().to_lowercase())
                .or_insert(name);
        }

        let collected = collect_track_folder_names(names);

        assert_eq!(
            collected,
            vec![
                ("barcelona".to_owned(), OsString::from("Barcelona")),
                ("brands_hatch".to_owned(), OsString::from("brands_hatch")),
                ("spa".to_owned(), OsString::from("SPA")),
                ("zolder".to_owned(), OsString::from("zolder")),
            ]
        );
    }

    #[test]
    fn scans_case_variant_track_folders_once_per_car() {
        let temp_dir = create_temp_dir();
        let first_car_path = temp_dir.join("bmw_m4_gt3");
        let second_car_path = temp_dir.join("ferrari_296_gt3");
        fs::create_dir_all(first_car_path.join("Spa")).expect("create first track");
        fs::create_dir_all(second_car_path.join("spa")).expect("create second track");

        let library = scan_local_library(&settings_with_root(&temp_dir)).expect("scan library");

        assert_eq!(library.cars.len(), 2);
        for car in &library.cars {
            let car_tracks = library
                .tracks
                .iter()
                .filter(|track| track.car_id == car.id)
                .collect::<Vec<_>>();
            assert_eq!(
                car_tracks.len(),
                1,
                "car '{}' got duplicate track entries",
                car.folder_name
            );
            assert_eq!(car_tracks[0].folder_name.to_lowercase(), "spa");
        }

        let first = &library.tracks[0];
        let second = &library.tracks[1];
        assert_eq!(first.folder_name, "Spa");
        assert_eq!(second.folder_name, "spa");

        fs::remove_dir_all(temp_dir).expect("remove temp dir");
    }
}
