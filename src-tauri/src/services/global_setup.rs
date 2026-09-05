use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, SystemTime};

use chrono::Utc;
use notify::{RecursiveMode, Watcher};
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

use crate::error::{AppError, AppResult};
use crate::models::{GlobalSetupCarStatus, GlobalSetupState, GlobalSetupStatus};
use crate::services::filesystem::KNOWN_ACC_TRACK_FOLDER_NAMES;
use crate::services::settings;
use crate::services::undo::{GlobalSyncMode, UndoOperation};
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

const DEFAULT_BASELINE_SETUP: &str = r##"{
	"carName": "bentley_continental_gt3_2018",
	"basicSetup": {
		"tyres": {
			"tyreCompound": 0,
			"tyrePressure": [
				51,
				52,
				50,
				51
			]
		},
		"alignment": {
			"camber": [
				0,
				0,
				3,
				3
			],
			"toe": [
				28,
				28,
				52,
				52
			],
			"staticCamber": [
				0.0,
				0.0,
				0.0,
				0.0
			],
			"toeOutLinear": [
				0.0,
				0.0,
				0.0,
				0.0
			],
			"casterLF": 24,
			"casterRF": 24,
			"steerRatio": 2
		},
		"electronics": {
			"tC1": 4,
			"tC2": 3,
			"abs": 2,
			"eCUMap": 1,
			"fuelMix": 0,
			"telemetryLaps": 0
		},
		"strategy": {
			"fuel": 40,
			"nPitStops": 0,
			"tyreSet": 0,
			"frontBrakePadCompound": 0,
			"rearBrakePadCompound": 0,
			"pitStrategy": [
				{
					"fuelToAdd": 0,
					"tyres": {
						"tyreCompound": 0,
						"tyrePressure": [
							51,
							52,
							50,
							51
						]
					},
					"tyreSet": 2,
					"frontBrakePadCompound": 0,
					"rearBrakePadCompound": 0
				}
			],
			"fuelPerLap": 3.4
		}
	},
	"advancedSetup": {
		"mechanicalBalance": {
			"aRBFront": 2,
			"aRBRear": 5,
			"wheelRate": [
				8,
				8,
				10,
				10
			],
			"bumpStopRateUp": [
				4,
				4,
				3,
				3
			],
			"bumpStopRateDn": [
				0,
				0,
				10,
				10
			],
			"bumpStopWindow": [
				6,
				6,
				52,
				52
			],
			"brakeTorque": 20,
			"brakeBias": 41
		},
		"dampers": {
			"bumpSlow": [
				12,
				12,
				16,
				16
			],
			"bumpFast": [
				12,
				12,
				14,
				14
			],
			"reboundSlow": [
				18,
				18,
				22,
				22
			],
			"reboundFast": [
				22,
				22,
				18,
				18
			]
		},
		"aeroBalance": {
			"rideHeight": [
				3,
				3,
				7,
				7
			],
			"rodLength": [
				0.0,
				0.0,
				0.0,
				0.0
			],
			"splitter": 0,
			"rearWing": 5,
			"brakeDuct": [
				3,
				3
			]
		},
		"drivetrain": {
			"preload": 4
		}
	},
	"trackBopType": 27
}"##;

struct GlobalMeta {
    feature_enabled: bool,
    master_hash: Option<String>,
}

fn load_meta(db_path: &Path) -> AppResult<GlobalMeta> {
    let connection = open_connection(db_path)?;
    let row = connection
        .query_row(
            "SELECT feature_enabled, master_hash FROM global_meta WHERE id = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, i64>(0)? != 0,
                    row.get::<_, Option<String>>(1)?,
                ))
            },
        )
        .optional()?;

    Ok(row.map(|(feature_enabled, master_hash)| GlobalMeta {
        feature_enabled,
        master_hash,
    }).unwrap_or(GlobalMeta {
        feature_enabled: false,
        master_hash: None,
    }))
}

fn set_feature_enabled(db_path: &Path, enabled: bool) -> AppResult<()> {
    let connection = open_connection(db_path)?;
    connection.execute(
        "INSERT INTO global_meta (id, feature_enabled, master_hash)
         VALUES (1, ?1, NULL)
         ON CONFLICT(id) DO UPDATE SET feature_enabled = excluded.feature_enabled",
        params![enabled as i64],
    )?;
    Ok(())
}

fn set_master_hash(db_path: &Path, hash: &str) -> AppResult<()> {
    let connection = open_connection(db_path)?;
    connection.execute(
        "INSERT INTO global_meta (id, feature_enabled, master_hash)
         VALUES (1, 0, ?1)
         ON CONFLICT(id) DO UPDATE SET master_hash = excluded.master_hash",
        params![hash],
    )?;
    Ok(())
}

fn upsert_sync_rows(
    db_path: &Path,
    combos: &[(String, String)],
    hash: &str,
) -> AppResult<()> {
    let connection = open_connection(db_path)?;
    let now = Utc::now().to_rfc3339();
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

fn clear_sync_rows(db_path: &Path) -> AppResult<()> {
    let connection = open_connection(db_path)?;
    connection.execute("DELETE FROM global_sync_state", [])?;
    Ok(())
}

fn load_sync_rows(db_path: &Path) -> AppResult<Vec<(String, String, String)>> {
    let connection = open_connection(db_path)?;
    let mut statement = connection.prepare(
        "SELECT car_folder, track_folder, synced_hash FROM global_sync_state",
    )?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
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

fn master_path_for_root(root: &Path) -> PathBuf {
    root.join(MASTER_FILE_NAME)
}

fn read_master(root: &Path) -> Option<String> {
    fs::read_to_string(master_path_for_root(root)).ok()
}

struct Combo {
    car_folder: String,
    track_folder: String,
    owned_path: PathBuf,
}

fn collect_combos(root: &Path) -> AppResult<Vec<Combo>> {
    let mut combos = Vec::new();
    for car_entry in sorted_directories(root)? {
        let car_path = car_entry.path();
        let car_folder = car_entry.file_name().to_string_lossy().into_owned();
        let mut track_folders: BTreeMap<String, String> = BTreeMap::new();
        for track_folder_name in KNOWN_ACC_TRACK_FOLDER_NAMES {
            track_folders.insert(
                track_folder_name.to_string(),
                track_folder_name.to_string(),
            );
        }
        for track_entry in sorted_directories(&car_path)? {
            let file_name = track_entry.file_name();
            track_folders.insert(
                file_name.to_string_lossy().to_lowercase(),
                file_name.to_string_lossy().into_owned(),
            );
        }

        for (_, track_folder) in track_folders {
            let track_path = car_path.join(&track_folder);
            if !track_path.exists() {
                fs::create_dir_all(&track_path)?;
            }
            combos.push(Combo {
                owned_path: track_path.join(MASTER_FILE_NAME),
                car_folder: car_folder.clone(),
                track_folder,
            });
        }
    }

    Ok(combos)
}

fn sorted_directories(path: &Path) -> AppResult<Vec<fs::DirEntry>> {
    let mut entries = fs::read_dir(path)?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());
    Ok(entries)
}

pub fn get_state(state: &AppState) -> AppResult<GlobalSetupState> {
    let meta = load_meta(&state.db_path)?;
    if !meta.feature_enabled {
        return Ok(GlobalSetupState {
            feature_enabled: false,
            status: GlobalSetupStatus::Disabled,
            master_path: None,
            owned_file_count: 0,
            cars: Vec::new(),
        });
    }

    let root = effective_root(state)?;
    let master_path = master_path_for_root(&root);
    let master_content = read_master(&root);
    if master_content.is_none() {
        return Ok(GlobalSetupState {
            feature_enabled: true,
            status: GlobalSetupStatus::NoMaster,
            master_path: Some(master_path.to_string_lossy().into_owned()),
            owned_file_count: 0,
            cars: Vec::new(),
        });
    }

    let master_hash = hash_content(master_content.as_deref().unwrap_or_default());
    let distributed_hash = meta.master_hash.clone();
    let status = if Some(&master_hash) != distributed_hash.as_ref() {
        GlobalSetupStatus::MasterModified
    } else {
        GlobalSetupStatus::Synced
    };

    let mut car_status: BTreeMap<String, GlobalSetupCarStatus> = BTreeMap::new();
    let mut owned_file_count = 0usize;
    for (car_folder, track_folder, synced_hash) in load_sync_rows(&state.db_path)? {
        let owned_path = root.join(&car_folder).join(&track_folder).join(MASTER_FILE_NAME);
        let entry = car_status
            .entry(car_folder.clone())
            .or_insert_with(|| GlobalSetupCarStatus {
                car_folder: car_folder.clone(),
                display_name: prettify(&car_folder),
                in_sync: 0,
                missing: 0,
                diverged: 0,
            });

        if !owned_path.exists() {
            entry.missing += 1;
        } else if synced_hash != master_hash {
            entry.diverged += 1;
        } else {
            entry.in_sync += 1;
        }
        owned_file_count += 1;
    }

    Ok(GlobalSetupState {
        feature_enabled: true,
        status,
        master_path: Some(master_path.to_string_lossy().into_owned()),
        owned_file_count,
        cars: car_status.into_values().collect(),
    })
}

pub fn enable(state: &AppState) -> AppResult<()> {
    if load_meta(&state.db_path)?.feature_enabled {
        return Err(AppError::from("The global setup feature is already enabled."));
    }

    let root = effective_root(state)?;
    let master_path = master_path_for_root(&root);
    let master_existed = master_path.exists();
    let previous_master = if master_existed {
        Some(stage_file(state, &fs::read_to_string(&master_path)?)?)
    } else {
        None
    };

    if !master_existed {
        fs::write(&master_path, DEFAULT_BASELINE_SETUP)?;
    }
    let master_content = fs::read_to_string(&master_path)?;
    let master_hash = hash_content(&master_content);
    set_feature_enabled(&state.db_path, true)?;
    set_master_hash(&state.db_path, &master_hash)?;
    clear_sync_rows(&state.db_path)?;

    let combos = collect_combos(&root)?;
    let content_staged = stage_file(state, &master_content)?;
    let mut undo_paths = Vec::new();
    let mut undo_staged = Vec::new();
    let mut combo_keys = Vec::new();
    for combo in &combos {
        undo_paths.push(combo.owned_path.clone());
        if combo.owned_path.exists() {
            undo_staged.push(Some(stage_file(
                state,
                &fs::read_to_string(&combo.owned_path)?,
            )?));
        } else {
            undo_staged.push(None);
        }
        combo_keys.push((combo.car_folder.clone(), combo.track_folder.clone()));
    }

    for combo in &combos {
        fs::write(&combo.owned_path, &master_content)?;
    }
    upsert_sync_rows(&state.db_path, &combo_keys, &master_hash)?;
    state.undo_manager()?.push(UndoOperation::GlobalSync {
        mode: GlobalSyncMode::Enable,
        paths: undo_paths,
        staged_paths: undo_staged,
        content_staged,
        master_path,
        master_staged: previous_master,
    });

    Ok(())
}

pub fn disable(state: &AppState) -> AppResult<()> {
    if !load_meta(&state.db_path)?.feature_enabled {
        return Err(AppError::from("The global setup feature is not enabled."));
    }

    let root = effective_root(state)?;
    let master_path = master_path_for_root(&root);
    let rows = load_sync_rows(&state.db_path)?;
    let mut undo_paths = Vec::new();
    let mut undo_staged = Vec::new();
    for (car_folder, track_folder, _) in &rows {
        let owned_path = root.join(car_folder).join(track_folder).join(MASTER_FILE_NAME);
        undo_paths.push(owned_path.clone());
        if owned_path.exists() {
            undo_staged.push(Some(stage_file(state, &fs::read_to_string(&owned_path)?)?));
        } else {
            undo_staged.push(None);
        }
    }

    let master_staged = if master_path.exists() {
        Some(stage_file(state, &fs::read_to_string(&master_path)?)?)
    } else {
        None
    };
    let content_staged = state.new_staged_file_path("global")?;
    fs::write(&content_staged, "{}\n")?;

    for path in &undo_paths {
        if path.exists() {
            fs::remove_file(path)?;
        }
    }
    if master_path.exists() {
        fs::remove_file(&master_path)?;
    }
    clear_sync_rows(&state.db_path)?;
    set_feature_enabled(&state.db_path, false)?;

    state.undo_manager()?.push(UndoOperation::GlobalSync {
        mode: GlobalSyncMode::Disable,
        paths: undo_paths,
        staged_paths: undo_staged,
        content_staged,
        master_path,
        master_staged,
    });

    Ok(())
}

pub fn push(state: &AppState) -> AppResult<usize> {
    let meta = load_meta(&state.db_path)?;
    if !meta.feature_enabled {
        return Err(AppError::from("The global setup feature is not enabled."));
    }

    let root = effective_root(state)?;
    let master_content = read_master(&root)
        .ok_or_else(|| AppError::from("The global setup master file is missing."))?;
    let master_hash = hash_content(&master_content);

    let combos = collect_combos(&root)?;
    let content_staged = stage_file(state, &master_content)?;
    let mut undo_paths = Vec::new();
    let mut undo_staged = Vec::new();
    let mut combo_keys = Vec::new();
    for combo in &combos {
        undo_paths.push(combo.owned_path.clone());
        combo_keys.push((combo.car_folder.clone(), combo.track_folder.clone()));
    }

    let mut previous_contents = Vec::new();
    for combo in &combos {
        previous_contents.push(if combo.owned_path.exists() {
            fs::read_to_string(&combo.owned_path)?
        } else {
            String::new()
        });
    }
    let all_identical = previous_contents.windows(2).all(|pair| pair[0] == pair[1]);
    if all_identical && !previous_contents.is_empty() {
        undo_staged.push(Some(stage_file(state, &previous_contents[0])?));
    } else {
        for (index, content) in previous_contents.iter().enumerate() {
            if combos[index].owned_path.exists() {
                undo_staged.push(Some(stage_file(state, content)?));
            } else {
                undo_staged.push(None);
            }
        }
    }

    for combo in &combos {
        fs::write(&combo.owned_path, &master_content)?;
    }
    set_master_hash(&state.db_path, &master_hash)?;
    upsert_sync_rows(&state.db_path, &combo_keys, &master_hash)?;
    state.undo_manager()?.push(UndoOperation::GlobalSync {
        mode: GlobalSyncMode::FanOut,
        paths: undo_paths,
        staged_paths: undo_staged,
        content_staged,
        master_path: master_path_for_root(&root),
        master_staged: None,
    });

    Ok(combos.len())
}

pub fn save_master(state: &AppState, content: &str) -> AppResult<()> {
    let meta = load_meta(&state.db_path)?;
    if !meta.feature_enabled {
        return Err(AppError::from("The global setup feature is not enabled."));
    }

    let root = effective_root(state)?;
    let master_path = master_path_for_root(&root);
    if !master_path.exists() {
        return Err(AppError::from(
            "The global setup master file is missing. Recover it before editing.",
        ));
    }

    serde_json::from_str::<serde_json::Value>(content)?;
    fs::write(&master_path, content)?;
    Ok(())
}

pub fn adopt(state: &AppState, source_path: &Path) -> AppResult<()> {
    let meta = load_meta(&state.db_path)?;
    if !meta.feature_enabled {
        return Err(AppError::from("The global setup feature is not enabled."));
    }

    if !source_path.is_file() {
        return Err(AppError::from("The selected setup file must be a file."));
    }
    if is_reserved_setup_path(source_path) {
        return Err(AppError::from(
            "The global setup master cannot adopt its own owned file.",
        ));
    }

    let content = fs::read_to_string(source_path)?;
    serde_json::from_str::<serde_json::Value>(&content)?;
    let root = effective_root(state)?;
    fs::write(master_path_for_root(&root), content)?;
    Ok(())
}

pub fn reconcile(state: &AppState) -> AppResult<()> {
    let meta = load_meta(&state.db_path)?;
    if !meta.feature_enabled {
        return Ok(());
    }

    let root = match effective_root(state) {
        Ok(root) => root,
        Err(_) => return Ok(()),
    };
    let master_content = match read_master(&root) {
        Some(content) => content,
        None => return Ok(()),
    };
    let master_hash = hash_content(&master_content);

    let rows = load_sync_rows(&state.db_path)?;
    let mut diverged: Vec<(PathBuf, String, SystemTime)> = Vec::new();
    let mut missing: Vec<(String, String)> = Vec::new();
    for (car_folder, track_folder, synced_hash) in rows {
        let owned_path = root.join(&car_folder).join(&track_folder).join(MASTER_FILE_NAME);
        if !owned_path.exists() {
            missing.push((car_folder, track_folder));
            continue;
        }

        let content = fs::read_to_string(&owned_path)?;
        let content_hash = hash_content(&content);
        if content_hash == master_hash || content_hash == synced_hash {
            continue;
        }

        let mtime = fs::metadata(&owned_path)?
            .modified()
            .unwrap_or(SystemTime::UNIX_EPOCH);
        diverged.push((owned_path, content, mtime));
    }

    if let Some((_, winner_content, _)) = diverged
        .iter()
        .max_by_key(|(_, _, mtime)| *mtime)
    {
        log::info!(
            "global setup: promoting in-game edit from '{}' (newest of {} diverged copies)",
            diverged[0].0.display(),
            diverged.len()
        );
        fs::write(master_path_for_root(&root), winner_content)?;
        let winner_hash = hash_content(winner_content);
        set_master_hash(&state.db_path, &winner_hash)?;
        push(state)?;
        return Ok(());
    }

    let mut restored = 0usize;
    for (car_folder, track_folder) in missing {
        let owned_path = root.join(&car_folder).join(&track_folder).join(MASTER_FILE_NAME);
        if let Some(parent) = owned_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&owned_path, &master_content)?;
        upsert_sync_rows(&state.db_path, &[(car_folder, track_folder)], &master_hash)?;
        restored += 1;
    }
    if restored > 0 {
        log::info!("global setup: restored {restored} missing owned files at startup");
    }

    if meta.master_hash.as_deref() != Some(master_hash.as_str()) {
        set_master_hash(&state.db_path, &master_hash)?;
    }

    Ok(())
}

fn stage_file(state: &AppState, content: &str) -> AppResult<PathBuf> {
    let staged_path = state.new_staged_file_path("global")?;
    fs::write(&staged_path, content)?;
    Ok(staged_path)
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

fn handle_watcher_batch(
    app_handle: &AppHandle,
    root: &Path,
    batch: &[Result<notify::Event, notify::Error>],
) -> AppResult<()> {
    let state = app_handle.state::<AppState>();
    let meta = load_meta(&state.db_path)?;
    if !meta.feature_enabled {
        return Ok(());
    }

    let master_path = master_path_for_root(root);
    let master_content = read_master(root);
    let master_hash = master_content.as_deref().map(hash_content);

    let mut promotion_candidates: Vec<PathBuf> = Vec::new();
    let mut restore_candidates: Vec<PathBuf> = Vec::new();
    let mut new_car_folders: Vec<PathBuf> = Vec::new();
    let mut state_changed = false;

    for event in batch.iter().flatten() {
        for path in event.paths.iter().map(PathBuf::as_path) {
            if path == master_path {
                state_changed = true;
                continue;
            }
            if !is_reserved_setup_path(path) {
                continue;
            }

            match event.kind {
                notify::EventKind::Remove(_) => {
                    restore_candidates.push(path.to_path_buf());
                    state_changed = true;
                }
                notify::EventKind::Create(_)
                | notify::EventKind::Modify(_)
                | notify::EventKind::Access(_) => {
                    if path.is_file() {
                        promotion_candidates.push(path.to_path_buf());
                        state_changed = true;
                    }
                }
                _ => {}
            }
        }

        if let notify::EventKind::Create(_) = event.kind {
            for path in event.paths.iter().map(PathBuf::as_path) {
                if path.is_dir() && path.parent() == Some(root) {
                    new_car_folders.push(path.to_path_buf());
                    state_changed = true;
                }
            }
        }
    }

    let mut promoted = false;
    if !promotion_candidates.is_empty() {
        let mut diverged: Vec<(PathBuf, String, SystemTime)> = Vec::new();
        for path in promotion_candidates {
            let content = match fs::read_to_string(&path) {
                Ok(content) => content,
                Err(_) => continue,
            };
            let content_hash = hash_content(&content);
            if Some(&content_hash) == master_hash.as_ref() {
                continue;
            }
            let synced_hash = synced_hash_for(&state.db_path, root, &path);
            if Some(&content_hash) == synced_hash.as_ref() {
                continue;
            }

            let mtime = fs::metadata(&path)?
                .modified()
                .unwrap_or(SystemTime::UNIX_EPOCH);
            diverged.push((path, content, mtime));
        }

        if let Some((winner_path, winner_content, _)) = diverged
            .iter()
            .max_by_key(|(_, _, mtime)| *mtime)
        {
            log::info!(
                "global setup: promoting in-game edit from '{}' (newest of {} diverged copies)",
                winner_path.display(),
                diverged.len()
            );
            fs::write(master_path_for_root(root), winner_content)?;
            promoted = true;
        }
    }

    if promoted {
        push(&state)?;
        state_changed = true;
    } else if master_content.is_some() {
        let mut restored = 0usize;
        for path in &restore_candidates {
            if let Err(error) = fs::write(path, master_content.as_deref().unwrap_or_default()) {
                log::error!(
                    "global setup: failed to restore '{}': {error}",
                    path.display()
                );
            } else {
                restored += 1;
            }
        }
        if restored > 0 {
            log::info!("global setup: restored {restored} deleted owned files from master");
            state_changed = true;
        }
    }

    for car_path in new_car_folders {
        if car_path.is_dir() {
            log::info!(
                "global setup: new car folder '{}' detected, creating track set",
                car_path.display()
            );
            push(&state)?;
            state_changed = true;
        }
    }

    if state_changed {
        if let Err(error) = app_handle.emit(GLOBAL_SETUP_CHANGED_EVENT, ()) {
            log::error!("failed to emit global setup state change: {error}");
        }
    }

    Ok(())
}

fn synced_hash_for(db_path: &Path, root: &Path, owned_path: &Path) -> Option<String> {
    let car_folder = owned_path.parent()?.parent()?.file_name()?;
    let track_folder = owned_path.parent()?.file_name()?;
    let _ = root;
    let connection = Connection::open(db_path).ok()?;
    connection
        .query_row(
            "SELECT synced_hash FROM global_sync_state WHERE car_folder = ?1 AND track_folder = ?2",
            params![
                car_folder.to_string_lossy().into_owned(),
                track_folder.to_string_lossy().into_owned()
            ],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .ok()
        .flatten()
}

#[cfg(test)]
mod tests {
    use super::{is_reserved_setup_path, is_reserved_setup_stem, DEFAULT_BASELINE_SETUP};
    use std::path::Path;

    #[test]
    fn recognizes_reserved_stem_case_insensitively() {
        assert!(is_reserved_setup_stem("Acc Manager Global Setup"));
        assert!(is_reserved_setup_stem("ACC MANAGER GLOBAL SETUP"));
        assert!(!is_reserved_setup_stem("race setup"));
    }

    #[test]
    fn recognizes_reserved_paths() {
        assert!(is_reserved_setup_path(Path::new(
            "C:/Setups/bmw_m4_gt3/monza/ACC Manager Global Setup.json"
        )));
        assert!(!is_reserved_setup_path(Path::new(
            "C:/Setups/bmw_m4_gt3/monza/race.json"
        )));
    }

    #[test]
    fn default_baseline_is_valid_json() {
        serde_json::from_str::<serde_json::Value>(DEFAULT_BASELINE_SETUP).expect("valid baseline");
    }
}
