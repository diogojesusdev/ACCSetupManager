use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, SystemTime};

use notify::{RecursiveMode, Watcher};
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

use crate::error::{AppError, AppResult};
use crate::models::{DocumentKind, SetupDocument};
use crate::services::filesystem::KNOWN_ACC_TRACK_FOLDER_NAMES;
use crate::services::global_baselines::seed_content_for;
use crate::services::settings;
use crate::state::AppState;

pub const RESERVED_SETUP_STEM: &str = "acc manager global setup";
const MASTER_FILE_NAME: &str = "acc manager global setup.json";
const DEBOUNCE: Duration = Duration::from_millis(400);
const GLOBAL_SETUP_CHANGED_EVENT: &str = "global-setup-state-changed";

pub fn is_reserved_setup_stem(stem: &str) -> bool {
    stem.trim().eq_ignore_ascii_case(RESERVED_SETUP_STEM)
}

pub fn is_reserved_setup_path(path: &Path) -> bool {
    path.file_stem()
        .and_then(|value| value.to_str())
        .map(is_reserved_setup_stem)
        .unwrap_or(false)
}

/// The path of a car's global setup master file, given that car's folder path.
pub fn car_master_path(car_path: &Path) -> PathBuf {
    car_path.join(MASTER_FILE_NAME)
}

fn open_connection(db_path: &Path) -> AppResult<Connection> {
    Ok(Connection::open(db_path)?)
}

fn hash_content(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn effective_root(state: &AppState) -> AppResult<PathBuf> {
    let settings = settings::load_settings(&state.db_path)?;
    settings::resolve_effective_root(&settings)
        .filter(|root| root.is_dir())
        .ok_or_else(|| AppError::from("No valid setup root is configured."))
}

fn upsert_sync_rows(db_path: &Path, combos: &[(String, String)], hash: &str) -> AppResult<()> {
    let connection = open_connection(db_path)?;
    let now = chrono::Utc::now().to_rfc3339();
    for (car_folder, track_folder) in combos {
        connection.execute(
            "INSERT INTO global_sync_state (car_folder, track_folder, synced_hash, synced_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(car_folder, track_folder)
             DO UPDATE SET synced_hash = excluded.synced_hash, synced_at = excluded.synced_at",
            params![car_folder, track_folder, hash, now],
        )?;
    }
    Ok(())
}

fn load_sync_rows_for_car(db_path: &Path, car_folder: &str) -> AppResult<Vec<(String, String)>> {
    let connection = open_connection(db_path)?;
    let mut statement = connection.prepare(
        "SELECT track_folder, synced_hash FROM global_sync_state WHERE car_folder = ?1",
    )?;
    let rows = statement
        .query_map(params![car_folder], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Every track folder name that should exist for one car: the known ACC track set
/// plus whatever track folders already exist on disk. Missing known folders are
/// created; this mirrors the app's existing track-folder backfill behavior.
fn collect_car_track_folders(car_path: &Path) -> AppResult<Vec<String>> {
    let mut track_folders: BTreeMap<String, String> = BTreeMap::new();
    for track_folder_name in KNOWN_ACC_TRACK_FOLDER_NAMES {
        track_folders.insert(track_folder_name.to_string(), track_folder_name.to_string());
    }

    if car_path.is_dir() {
        for entry in fs::read_dir(car_path)? {
            let entry = entry?;
            if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                continue;
            }
            let file_name = entry.file_name().to_string_lossy().into_owned();
            // On-disk casing takes precedence over the known-name canonical casing.
            track_folders.insert(file_name.to_lowercase(), file_name);
        }
    }

    for track_folder in track_folders.values() {
        let track_path = car_path.join(track_folder);
        if !track_path.exists() {
            fs::create_dir_all(&track_path)?;
        }
    }

    Ok(track_folders.into_values().collect())
}

fn sorted_car_folders(root: &Path) -> AppResult<Vec<String>> {
    let mut names = fs::read_dir(root)?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    names.sort_by_key(|name| name.to_lowercase());
    Ok(names)
}

/// Writes `content` into every track folder for `car_folder` and records the sync
/// state. This is the single write path for all car-scoped fan-out: initial
/// seeding, in-app saves, adopts, promotions and restores all go through it.
fn fan_out_car(state: &AppState, root: &Path, car_folder: &str, content: &str) -> AppResult<usize> {
    let car_path = root.join(car_folder);
    let track_folders = collect_car_track_folders(&car_path)?;
    let hash = hash_content(content);

    let mut combo_keys = Vec::with_capacity(track_folders.len());
    for track_folder in &track_folders {
        let owned_path = car_path.join(track_folder).join(MASTER_FILE_NAME);
        fs::write(&owned_path, content)?;
        combo_keys.push((car_folder.to_owned(), track_folder.clone()));
    }
    upsert_sync_rows(&state.db_path, &combo_keys, &hash)?;

    Ok(track_folders.len())
}

fn emit_state_changed(app_handle: &AppHandle) {
    if let Err(error) = app_handle.emit(GLOBAL_SETUP_CHANGED_EVENT, ()) {
        log::error!("global setup: failed to emit state-changed event: {error}");
    }
}

/// Reads a car's master content, self-healing (recreating it from the shipped
/// baseline or a neutral skeleton) if it is missing.
pub fn get_master_content(state: &AppState, car_folder: &str) -> AppResult<String> {
    let root = effective_root(state)?;
    let car_path = root.join(car_folder);
    if !car_path.is_dir() {
        return Err(AppError::from("The selected car folder no longer exists."));
    }

    let master_path = car_master_path(&car_path);
    if let Ok(content) = fs::read_to_string(&master_path) {
        return Ok(content);
    }

    reconcile_car(state, &root, car_folder)?;
    Ok(fs::read_to_string(&master_path)?)
}

pub fn read_master_document(state: &AppState, car_folder: &str) -> AppResult<SetupDocument> {
    let content = get_master_content(state, car_folder)?;
    let root = effective_root(state)?;
    let master_path = car_master_path(&root.join(car_folder));

    Ok(SetupDocument {
        kind: DocumentKind::Global,
        id: master_path.to_string_lossy().into_owned(),
        title: format!("{} — Global Setup", prettify(car_folder)),
        content,
        read_only: false,
        dirty: false,
        source_label: "Car global setup — applies to every track for this car".to_owned(),
        remote_download: None,
        car_folder: Some(car_folder.to_owned()),
    })
}

/// Saves new content as a car's master and immediately fans it out to every
/// track folder for that car (per-car global setup has no separate push step).
pub fn save_master(state: &AppState, car_folder: &str, content: &str) -> AppResult<()> {
    serde_json::from_str::<serde_json::Value>(content)?;

    let root = effective_root(state)?;
    let car_path = root.join(car_folder);
    if !car_path.is_dir() {
        return Err(AppError::from("The selected car folder no longer exists."));
    }

    fs::write(car_master_path(&car_path), content)?;
    fan_out_car(state, &root, car_folder, content)?;
    Ok(())
}

/// Replaces a car's master with the content of an existing setup file, then fans
/// it out. Used by the "Set as this car's global setup" context action.
pub fn adopt(state: &AppState, car_folder: &str, source_path: &Path) -> AppResult<()> {
    if !source_path.is_file() {
        return Err(AppError::from("The selected setup file must be a file."));
    }
    if is_reserved_setup_path(source_path) {
        return Err(AppError::from(
            "The global setup master cannot adopt its own owned file.",
        ));
    }

    let content = fs::read_to_string(source_path)?;
    save_master(state, car_folder, &content)
}

/// Migrates state left over from the old fleet-wide global setup: deletes the old
/// root-level master and every owned copy it fanned out, then drops its tables.
/// Runs once at startup, before per-car reconciliation.
fn migrate_legacy_state(state: &AppState) -> AppResult<()> {
    let connection = open_connection(&state.db_path)?;
    let has_legacy_table: bool = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'global_meta'",
        [],
        |row| row.get::<_, i64>(0),
    )? > 0;

    if !has_legacy_table {
        return Ok(());
    }

    log::info!("global setup: migrating legacy fleet-wide state to per-car setups");

    if let Ok(root) = effective_root(state) {
        let legacy_master = root.join(MASTER_FILE_NAME);
        if legacy_master.is_file() {
            let _ = fs::remove_file(&legacy_master);
        }

        let mut statement = connection
            .prepare("SELECT car_folder, track_folder FROM global_sync_state")?;
        let legacy_rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);

        for (car_folder, track_folder) in legacy_rows {
            let owned_path = root.join(&car_folder).join(&track_folder).join(MASTER_FILE_NAME);
            if owned_path.is_file() {
                let _ = fs::remove_file(&owned_path);
            }
        }
    }

    connection.execute("DELETE FROM global_sync_state", [])?;
    connection.execute("DROP TABLE IF EXISTS global_meta", [])?;
    Ok(())
}

/// Self-healing per-car reconciliation: recreates a missing master from the
/// baseline/skeleton, promotes the newest diverged owned copy (an in-game edit)
/// to master, and restores/creates owned copies for missing or brand-new track
/// folders. All car-scoped; other cars are never touched.
fn reconcile_car(state: &AppState, root: &Path, car_folder: &str) -> AppResult<bool> {
    let car_path = root.join(car_folder);
    let master_path = car_master_path(&car_path);

    let master_content = match fs::read_to_string(&master_path) {
        Ok(content) => content,
        Err(_) => {
            let content = seed_content_for(car_folder);
            fs::write(&master_path, &content)?;
            fan_out_car(state, root, car_folder, &content)?;
            log::info!("global setup: seeded master for '{car_folder}'");
            return Ok(true);
        }
    };
    let master_hash = hash_content(&master_content);

    let rows = load_sync_rows_for_car(&state.db_path, car_folder)?;
    let mut diverged: Vec<(PathBuf, String, SystemTime)> = Vec::new();
    let mut any_missing = false;
    let mut any_stale = false;
    for (track_folder, synced_hash) in &rows {
        let owned_path = car_path.join(track_folder).join(MASTER_FILE_NAME);
        let content = match fs::read_to_string(&owned_path) {
            Ok(content) => content,
            Err(_) => {
                any_missing = true;
                continue;
            }
        };
        let content_hash = hash_content(&content);
        if content_hash == master_hash {
            continue;
        }
        // Still matches what we last wrote: not an in-game edit, but behind master.
        if &content_hash == synced_hash {
            any_stale = true;
            continue;
        }
        let mtime = fs::metadata(&owned_path)?
            .modified()
            .unwrap_or(SystemTime::UNIX_EPOCH);
        diverged.push((owned_path, content, mtime));
    }

    if let Some((winner_path, winner_content, _)) =
        diverged.iter().max_by_key(|(_, _, mtime)| *mtime)
    {
        log::info!(
            "global setup: promoting in-game edit for '{car_folder}' from '{}' ({} diverged)",
            winner_path.display(),
            diverged.len()
        );
        fs::write(&master_path, winner_content)?;
        fan_out_car(state, root, car_folder, winner_content)?;
        return Ok(true);
    }

    if any_missing || any_stale {
        fan_out_car(state, root, car_folder, &master_content)?;
        return Ok(true);
    }

    // Catches brand-new track folders that have no sync row yet.
    let current_track_folders = collect_car_track_folders(&car_path)?;
    if current_track_folders.len() != rows.len() {
        fan_out_car(state, root, car_folder, &master_content)?;
        return Ok(true);
    }

    Ok(false)
}

/// Startup pass: migrates any leftover fleet-wide state, then reconciles every
/// car folder currently on disk (creating a master + full fan-out for any car
/// that does not have one yet).
pub fn reconcile(state: &AppState) -> AppResult<()> {
    migrate_legacy_state(state)?;

    let root = match effective_root(state) {
        Ok(root) => root,
        Err(_) => return Ok(()),
    };

    for car_folder in sorted_car_folders(&root)? {
        if let Err(error) = reconcile_car(state, &root, &car_folder) {
            log::error!("global setup: reconciliation failed for '{car_folder}': {error}");
        }
    }

    Ok(())
}

fn prettify(value: &str) -> String {
    value
        .split(['_', '-'])
        .filter(|segment| !segment.is_empty())
        .map(|segment| {
            let mut characters = segment.chars();
            match characters.next() {
                Some(first) => first.to_uppercase().collect::<String>() + characters.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn spawn_watcher(app_handle: AppHandle) {
    std::thread::spawn(move || {
        let (tx, rx) = mpsc::channel();
        let mut watcher = match notify::recommended_watcher(tx) {
            Ok(watcher) => watcher,
            Err(error) => {
                log::error!("global setup watcher failed to start: {error}");
                return;
            }
        };

        let state = app_handle.state::<AppState>();
        let root = match effective_root(&state) {
            Ok(root) => root,
            Err(error) => {
                log::warn!("global setup watcher skipped: {error}");
                return;
            }
        };

        if let Err(error) = watcher.watch(&root, RecursiveMode::Recursive) {
            log::error!("global setup watcher failed to watch '{}': {error}", root.display());
            return;
        }
        log::info!("global setup watcher watching '{}'", root.display());

        loop {
            let first_event = match rx.recv() {
                Ok(event) => event,
                Err(_) => return,
            };
            let mut batch = vec![first_event];
            while let Ok(event) = rx.recv_timeout(DEBOUNCE) {
                batch.push(event);
            }

            if let Err(error) = handle_watcher_batch(&app_handle, &root, &batch) {
                log::error!("global setup watcher batch failed: {error}");
            }
        }
    });
}

fn is_master_file_name(path: &Path) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(|name| name.eq_ignore_ascii_case(MASTER_FILE_NAME))
        .unwrap_or(false)
}

/// Determines which car folder (if any) an event path belongs to, and whether the
/// path itself is relevant (a car's master file, an owned copy, or a car/track
/// folder being created).
fn affected_car_folder(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    let mut components = relative.components();
    let car_folder = components.next()?.as_os_str().to_string_lossy().into_owned();
    let second = components.next();
    let third = components.next();
    if components.next().is_some() {
        return None;
    }

    match (second, third) {
        // {root}/{car} — a car folder itself was created/removed.
        (None, None) => Some(car_folder),
        // {root}/{car}/{master.json} or {root}/{car}/{track}
        (Some(_), None) => {
            if is_master_file_name(path) || path.is_dir() {
                Some(car_folder)
            } else {
                None
            }
        }
        // {root}/{car}/{track}/acc manager global setup.json — in-game override.
        (Some(_), Some(_)) => {
            if is_master_file_name(path) {
                Some(car_folder)
            } else {
                None
            }
        }
        (None, Some(_)) => None,
    }
}

fn handle_watcher_batch(
    app_handle: &AppHandle,
    root: &Path,
    batch: &[Result<notify::Event, notify::Error>],
) -> AppResult<()> {
    let state = app_handle.state::<AppState>();

    let mut affected_cars: Vec<String> = Vec::new();
    for event in batch.iter().flatten() {
        for path in event.paths.iter().map(PathBuf::as_path) {
            if let Some(car_folder) = affected_car_folder(root, path) {
                if !affected_cars.contains(&car_folder) {
                    affected_cars.push(car_folder);
                }
            }
        }
    }

    let mut changed = false;
    for car_folder in affected_cars {
        let car_path = root.join(&car_folder);
        if !car_path.is_dir() {
            // The car folder itself was removed; nothing to reconcile.
            continue;
        }
        match reconcile_car(&state, root, &car_folder) {
            Ok(did_change) => changed = changed || did_change,
            Err(error) => {
                log::error!("global setup: watcher reconciliation failed for '{car_folder}': {error}");
            }
        }
    }

    if changed {
        emit_state_changed(app_handle);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        affected_car_folder, car_master_path, collect_car_track_folders, is_reserved_setup_path,
        is_reserved_setup_stem, MASTER_FILE_NAME,
    };
    use crate::services::filesystem::KNOWN_ACC_TRACK_FOLDER_NAMES;
    use std::fs;
    use std::path::{Path, PathBuf};
    use uuid::Uuid;

    fn create_temp_dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!("global-setup-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    #[test]
    fn reserved_stem_check_is_case_insensitive() {
        assert!(is_reserved_setup_stem("ACC Manager Global Setup"));
        assert!(is_reserved_setup_stem("acc manager global setup"));
        assert!(!is_reserved_setup_stem("copilot_fast"));
        assert!(is_reserved_setup_path(Path::new(
            "C:/Setups/bmw_m4_gt3/spa/acc manager global setup.json"
        )));
    }

    #[test]
    fn car_master_path_sits_directly_in_the_car_folder() {
        let car_path = Path::new("C:/Setups/bmw_m4_gt3");
        assert_eq!(
            car_master_path(car_path),
            car_path.join(MASTER_FILE_NAME)
        );
    }

    #[test]
    fn collect_car_track_folders_creates_known_tracks_and_keeps_existing_ones() {
        let temp_dir = create_temp_dir();
        let car_path = temp_dir.join("bmw_m4_gt3");
        fs::create_dir_all(car_path.join("a_custom_track")).expect("create custom track");

        let track_folders = collect_car_track_folders(&car_path).expect("collect track folders");

        for known in KNOWN_ACC_TRACK_FOLDER_NAMES {
            assert!(
                track_folders.iter().any(|name| name == known),
                "missing known track '{known}'"
            );
            assert!(car_path.join(known).is_dir());
        }
        assert!(track_folders.iter().any(|name| name == "a_custom_track"));

        fs::remove_dir_all(temp_dir).expect("remove temp dir");
    }

    #[test]
    fn collect_car_track_folders_is_case_insensitive_for_existing_folders() {
        let temp_dir = create_temp_dir();
        let car_path = temp_dir.join("bmw_m4_gt3");
        fs::create_dir_all(car_path.join("Spa")).expect("create capitalized track");

        let track_folders = collect_car_track_folders(&car_path).expect("collect track folders");
        let spa_entries: Vec<_> = track_folders
            .iter()
            .filter(|name| name.eq_ignore_ascii_case("spa"))
            .collect();
        assert_eq!(spa_entries, vec!["Spa"], "should not duplicate case-variant tracks");

        fs::remove_dir_all(temp_dir).expect("remove temp dir");
    }

    #[test]
    fn affected_car_folder_scopes_events_to_the_owning_car() {
        let root = Path::new("C:/Setups");

        // A brand new car folder.
        assert_eq!(
            affected_car_folder(root, &root.join("bmw_m4_gt3")),
            Some("bmw_m4_gt3".to_owned())
        );

        // The car's own master file.
        assert_eq!(
            affected_car_folder(
                root,
                &root.join("bmw_m4_gt3").join(MASTER_FILE_NAME)
            ),
            Some("bmw_m4_gt3".to_owned())
        );

        // An owned copy in a track folder — this is what ACC overwrites in-game.
        assert_eq!(
            affected_car_folder(
                root,
                &root
                    .join("bmw_m4_gt3")
                    .join("spa")
                    .join(MASTER_FILE_NAME)
            ),
            Some("bmw_m4_gt3".to_owned())
        );

        // A regular setup in a track folder is irrelevant.
        assert_eq!(
            affected_car_folder(
                root,
                &root.join("bmw_m4_gt3").join("spa").join("race.json")
            ),
            None
        );

        // A non-reserved file directly in the car folder is irrelevant.
        assert_eq!(
            affected_car_folder(root, &root.join("bmw_m4_gt3").join("notes.txt")),
            None
        );

        // Paths outside the root are irrelevant.
        assert_eq!(affected_car_folder(root, Path::new("D:/Elsewhere/file.json")), None);
    }
}
