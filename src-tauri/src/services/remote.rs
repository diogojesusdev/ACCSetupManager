use std::collections::BTreeMap;
use std::path::Path;

use chrono::{DateTime, Duration, Utc};
use regex::Regex;
use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::error::{AppError, AppResult};
use crate::models::{
    DocumentKind, RemoteDownloadDescriptor, RemoteSetup, RemoteSourceResult, SetupDocument,
};
use crate::services::filesystem;
use crate::state::AppState;

const SIMPLY_LOVELY_SOURCE_ID: &str = "simply-lovely-setups";
const SIMPLY_LOVELY_BASE_URL: &str = "https://www.simplylovelysetups.com";
const SIMPLY_LOVELY_LIST_PAGE_SIZE: usize = 100;

pub fn load_remote_source_results(
    state: &AppState,
    source_id: &str,
    car_folder_name: &str,
    car_display_name: &str,
    track_folder_name: &str,
    track_display_name: &str,
    force_refresh: bool,
) -> AppResult<RemoteSourceResult> {
    if source_id != SIMPLY_LOVELY_SOURCE_ID {
        return Err(AppError::from("This remote source is not implemented in the backend."));
    }

    let client = SimplyLovelyClient::new(state)?;
    let options = client.fetch_options()?;

    let Some(car_name) = resolve_catalog_value(
        &options.cars,
        car_folder_name,
        car_display_name,
        remote_car_aliases(),
    ) else {
        return Ok(RemoteSourceResult {
            items: Vec::new(),
            stale: false,
            message: format!(
                "Simply Lovely Setups does not expose a verified car mapping for {} yet.",
                car_display_name
            ),
        });
    };

    let Some(track_name) = resolve_catalog_value(
        &options.tracks,
        track_folder_name,
        track_display_name,
        remote_track_aliases(),
    ) else {
        return Ok(RemoteSourceResult {
            items: Vec::new(),
            stale: false,
            message: format!(
                "Simply Lovely Setups does not expose a verified track mapping for {} yet.",
                track_display_name
            ),
        });
    };

    let cached = read_list_cache(&state.db_path, source_id, &car_name, &track_name)?;
    if !force_refresh {
        if let Some(entry) = cached.as_ref().filter(|entry| !entry.is_expired()) {
            return Ok(entry.payload.clone());
        }
    }

    match client.fetch_all_setups(&car_name, &track_name) {
        Ok(items) => {
            let result = RemoteSourceResult {
                message: if items.is_empty() {
                    format!(
                        "No Simply Lovely Setups entries were found for {} at {}.",
                        car_display_name, track_display_name
                    )
                } else {
                    format!(
                        "Loaded {} Simply Lovely Setups entr{} for {} at {}.",
                        items.len(),
                        if items.len() == 1 { "y" } else { "ies" },
                        car_display_name,
                        track_display_name
                    )
                },
                items,
                stale: false,
            };
            write_list_cache(&state.db_path, source_id, &car_name, &track_name, &result)?;
            Ok(result)
        }
        Err(error) => {
            if let Some(entry) = cached {
                let mut result = entry.payload;
                result.stale = true;
                result.message = format!(
                    "Showing cached Simply Lovely Setups results for {} at {} because the live refresh failed: {}",
                    car_display_name, track_display_name, error
                );
                return Ok(result);
            }

            Err(error)
        }
    }
}

pub fn read_remote_setup_document(
    state: &AppState,
    source_id: &str,
    remote_setup_id: &str,
) -> AppResult<SetupDocument> {
    if source_id != SIMPLY_LOVELY_SOURCE_ID {
        return Err(AppError::from("Remote preview is not available for this source."));
    }

    let detail = load_detail_with_cache(state, remote_setup_id)?;
    let preview_payload = transform_detail_for_download(&detail);
    let file_name = detail
        .file_name
        .clone()
        .unwrap_or_else(|| format!("{remote_setup_id}.json"));
    let title = file_name
        .strip_suffix(".json")
        .unwrap_or(file_name.as_str())
        .to_owned();

    Ok(SetupDocument {
        kind: DocumentKind::Remote,
        id: format!("{source_id}:{remote_setup_id}"),
        title,
        content: serde_json::to_string_pretty(&preview_payload)?,
        read_only: true,
        dirty: false,
        source_label: "Simply Lovely Setups".to_owned(),
        remote_download: Some(RemoteDownloadDescriptor {
            source_id: source_id.to_owned(),
            remote_setup_id: remote_setup_id.to_owned(),
            suggested_file_name: file_name,
            source_page_url: Some(simply_lovely_source_page_url(remote_setup_id)),
        }),
    })
}

pub fn download_remote_setup(
    state: &AppState,
    source_id: &str,
    remote_setup_id: &str,
    track_path: &Path,
    target_file_name: &str,
    overwrite: bool,
) -> AppResult<std::path::PathBuf> {
    if source_id != SIMPLY_LOVELY_SOURCE_ID {
        return Err(AppError::from("Remote download is not available for this source."));
    }

    let detail = load_detail_with_cache(state, remote_setup_id)?;
    let preview_payload = transform_detail_for_download(&detail);
    let content = serde_json::to_string_pretty(&preview_payload)?;
    let imported_path =
        filesystem::write_setup_into_track(state, track_path, target_file_name, &content, overwrite)?;

    record_download_history(
        &state.db_path,
        source_id,
        &imported_path,
        &json!({
            "remoteSetupId": remote_setup_id,
            "sourcePageUrl": simply_lovely_source_page_url(remote_setup_id),
            "fileName": detail.file_name,
        }),
    )?;

    Ok(imported_path)
}

fn load_detail_with_cache(state: &AppState, remote_setup_id: &str) -> AppResult<SimplyLovelySetupDetail> {
    let cached = read_preview_cache(&state.db_path, SIMPLY_LOVELY_SOURCE_ID, remote_setup_id)?;
    let client = SimplyLovelyClient::new(state)?;

    match client.fetch_detail(remote_setup_id) {
        Ok(detail) => {
            write_preview_cache(&state.db_path, SIMPLY_LOVELY_SOURCE_ID, remote_setup_id, &detail)?;
            Ok(detail)
        }
        Err(error) => {
            if let Some(detail) = cached {
                return Ok(detail);
            }

            Err(error)
        }
    }
}

fn transform_detail_for_download(detail: &SimplyLovelySetupDetail) -> Value {
    let mut value = serde_json::to_value(detail).unwrap_or_else(|_| Value::Object(Map::new()));
    if let Value::Object(map) = &mut value {
        map.remove("id");
        map.remove("car_name");
        map.remove("track_name");
    }
    value
}

fn simply_lovely_source_page_url(remote_setup_id: &str) -> String {
    format!("{SIMPLY_LOVELY_BASE_URL}/setups?id={remote_setup_id}")
}

fn read_list_cache(
    db_path: &Path,
    source_id: &str,
    car_id: &str,
    track_id: &str,
) -> AppResult<Option<CachedPayload<RemoteSourceResult>>> {
    let connection = Connection::open(db_path)?;
    connection
        .query_row(
            "SELECT expires_at, payload_json FROM remote_cache_entries
             WHERE source_id = ?1 AND car_id = ?2 AND track_id = ?3",
            params![source_id, car_id, track_id],
            |row| {
                let expires_at: String = row.get(0)?;
                let payload_json: String = row.get(1)?;
                Ok(CachedPayload {
                    expires_at: parse_rfc3339(&expires_at),
                    payload: serde_json::from_str::<RemoteSourceResult>(&payload_json)
                        .map_err(json_to_sql_error)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn write_list_cache(
    db_path: &Path,
    source_id: &str,
    car_id: &str,
    track_id: &str,
    payload: &RemoteSourceResult,
) -> AppResult<()> {
    let connection = Connection::open(db_path)?;
    let fetched_at = Utc::now();
    let expires_at = fetched_at + Duration::hours(24);
    connection.execute(
        "INSERT INTO remote_cache_entries (source_id, car_id, track_id, fetched_at, expires_at, stale, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)
         ON CONFLICT(source_id, car_id, track_id)
         DO UPDATE SET fetched_at = excluded.fetched_at, expires_at = excluded.expires_at, stale = 0, payload_json = excluded.payload_json",
        params![
            source_id,
            car_id,
            track_id,
            fetched_at.to_rfc3339(),
            expires_at.to_rfc3339(),
            serde_json::to_string(payload)?,
        ],
    )?;
    Ok(())
}

fn read_preview_cache(
    db_path: &Path,
    source_id: &str,
    preview_key: &str,
) -> AppResult<Option<SimplyLovelySetupDetail>> {
    let connection = Connection::open(db_path)?;
    connection
        .query_row(
            "SELECT payload_json FROM remote_preview_cache WHERE source_id = ?1 AND preview_key = ?2",
            params![source_id, preview_key],
            |row| {
                let payload_json: String = row.get(0)?;
                serde_json::from_str::<SimplyLovelySetupDetail>(&payload_json)
                    .map_err(json_to_sql_error)
            },
        )
        .optional()
        .map_err(Into::into)
}

fn write_preview_cache(
    db_path: &Path,
    source_id: &str,
    preview_key: &str,
    payload: &SimplyLovelySetupDetail,
) -> AppResult<()> {
    let connection = Connection::open(db_path)?;
    connection.execute(
        "INSERT INTO remote_preview_cache (source_id, preview_key, fetched_at, payload_json)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(source_id, preview_key)
         DO UPDATE SET fetched_at = excluded.fetched_at, payload_json = excluded.payload_json",
        params![
            source_id,
            preview_key,
            Utc::now().to_rfc3339(),
            serde_json::to_string(payload)?,
        ],
    )?;
    Ok(())
}

fn record_download_history(
    db_path: &Path,
    source_id: &str,
    target_path: &Path,
    metadata: &Value,
) -> AppResult<()> {
    let connection = Connection::open(db_path)?;
    connection.execute(
        "INSERT INTO download_history (source_id, target_path, created_at, metadata_json)
         VALUES (?1, ?2, ?3, ?4)",
        params![
            source_id,
            target_path.to_string_lossy().into_owned(),
            Utc::now().to_rfc3339(),
            serde_json::to_string(metadata)?,
        ],
    )?;
    Ok(())
}

fn parse_rfc3339(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .map(|timestamp| timestamp.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now() - Duration::days(1))
}

fn json_to_sql_error(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        Box::new(error),
    )
}

fn resolve_catalog_value(
    catalog: &[String],
    folder_name: &str,
    display_name: &str,
    aliases: BTreeMap<&'static str, &'static str>,
) -> Option<String> {
    let mut candidates = vec![folder_name.to_owned(), display_name.to_owned()];
    let folder_normalized = normalize_key(folder_name);
    let display_normalized = normalize_key(display_name);

    if let Some(alias) = aliases.get(folder_normalized.as_str()) {
        candidates.push((*alias).to_owned());
    }
    if let Some(alias) = aliases.get(display_normalized.as_str()) {
        candidates.push((*alias).to_owned());
    }

    for candidate in &candidates {
        if let Some(found) = catalog.iter().find(|value| value.eq_ignore_ascii_case(candidate)) {
            return Some(found.clone());
        }
    }

    let normalized_catalog = catalog
        .iter()
        .map(|value| (normalize_key(value), value))
        .collect::<Vec<_>>();

    for candidate in &candidates {
        let normalized_candidate = normalize_key(candidate);
        if let Some((_, found)) = normalized_catalog
            .iter()
            .find(|(normalized, _)| *normalized == normalized_candidate)
        {
            return Some((*found).clone());
        }
    }

    None
}

fn normalize_key(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn remote_track_aliases() -> BTreeMap<&'static str, &'static str> {
    BTreeMap::from([
        ("bathurst", "mount_panorama"),
        ("circuitoftheamericas", "cota"),
        ("cota", "cota"),
        ("mountpanorama", "mount_panorama"),
        ("nurburgring24h", "nurburgring_24h"),
        ("redbullring", "red_bull_ring"),
        ("spafrancorchamps", "spa"),
    ])
}

fn remote_car_aliases() -> BTreeMap<&'static str, &'static str> {
    BTreeMap::from([
        ("audir8lmsevo2", "audi_r8_lms_evo_ii"),
        ("bmwm4gt32022", "bmw_m4_gt3"),
        ("ferrari488gt3evo", "ferrari_488_gt3_evo"),
        ("ferrari488gt3evo2020", "ferrari_488_gt3_evo"),
        ("mercedesamggt3evo", "mercedes_amg_gt3_evo"),
        ("mercedesamggt3evo2020", "mercedes_amg_gt3_evo"),
        ("mclaren720sgt3evo", "mclaren_720s_gt3_evo"),
        ("porsche911gt3r992", "porsche_992_gt3_r"),
    ])
}

struct CachedPayload<T> {
    expires_at: DateTime<Utc>,
    payload: T,
}

impl<T> CachedPayload<T> {
    fn is_expired(&self) -> bool {
        self.expires_at <= Utc::now()
    }
}

struct SimplyLovelyClient<'a> {
    state: &'a AppState,
    client: Client,
}

impl<'a> SimplyLovelyClient<'a> {
    fn new(state: &'a AppState) -> AppResult<Self> {
        Ok(Self {
            state,
            client: Client::builder()
                .user_agent("ACCSetupManager/0.1")
                .build()?,
        })
    }

    fn fetch_options(&self) -> AppResult<SimplyLovelyOptions> {
        self.get_json("/api/v1/acc/setups/options")
    }

    fn fetch_all_setups(&self, car_name: &str, track_name: &str) -> AppResult<Vec<RemoteSetup>> {
        let mut page = 1usize;
        let mut items = Vec::new();

        loop {
            let response: SimplyLovelyCollection<SimplyLovelySetupListItem> = self.get_json(
                &format!(
                    "/api/v1/acc/setups/?car_name={car_name}&track_name={track_name}&size={SIMPLY_LOVELY_LIST_PAGE_SIZE}&page={page}"
                ),
            )?;

            if response.items.is_empty() {
                break;
            }

            items.extend(response.items.into_iter().map(normalize_remote_setup));

            if items.len() >= response.total || response.page * response.size >= response.total {
                break;
            }

            page += 1;
        }

        Ok(items)
    }

    fn fetch_detail(&self, remote_setup_id: &str) -> AppResult<SimplyLovelySetupDetail> {
        let response: SimplyLovelyCollection<SimplyLovelySetupDetail> =
            self.get_json(&format!(
                "/api/v1/acc/setups/?object_id={remote_setup_id}&details=true"
            ))?;
        response
            .items
            .into_iter()
            .next()
            .ok_or_else(|| AppError::from("The remote setup detail response was empty."))
    }

    fn get_json<T: for<'de> Deserialize<'de>>(&self, path: &str) -> AppResult<T> {
        let api_key = self.resolve_api_key(false)?;
        match self.get_json_with_api_key(path, &api_key) {
            Ok(value) => Ok(value),
            Err(AppError::Http(error)) if error.status() == Some(reqwest::StatusCode::UNAUTHORIZED) => {
                let refreshed_api_key = self.resolve_api_key(true)?;
                self.get_json_with_api_key(path, &refreshed_api_key)
            }
            Err(error) => Err(error),
        }
    }

    fn get_json_with_api_key<T: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        api_key: &str,
    ) -> AppResult<T> {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        headers.insert(
            "X-API-Key",
            HeaderValue::from_str(api_key)
                .map_err(|_| AppError::from("The discovered Simply Lovely Setups API key was invalid."))?,
        );

        let response = self
            .client
            .get(format!("{SIMPLY_LOVELY_BASE_URL}{path}"))
            .headers(headers)
            .send()?
            .error_for_status()?;

        Ok(response.json()?)
    }

    fn resolve_api_key(&self, force_refresh: bool) -> AppResult<String> {
        if !force_refresh {
            if let Some(api_key) = self.state.get_remote_api_key()? {
                return Ok(api_key);
            }
        }

        let page = self
            .client
            .get(format!("{SIMPLY_LOVELY_BASE_URL}/setups"))
            .send()?
            .error_for_status()?
            .text()?;

        let script_regex = Regex::new(r#"src="(/_next/static/chunks/[^"]+\.js)""#)
            .map_err(|error| AppError::from(error.to_string()))?;
        let api_key_regex = Regex::new(r#"X-API-Key":"([^"]+)""#)
            .map_err(|error| AppError::from(error.to_string()))?;

        for captures in script_regex.captures_iter(&page).take(20) {
            let Some(script_path) = captures.get(1).map(|value| value.as_str()) else {
                continue;
            };

            let script = self
                .client
                .get(format!("{SIMPLY_LOVELY_BASE_URL}{script_path}"))
                .send()?
                .error_for_status()?
                .text()?;

            if let Some(api_key) = api_key_regex
                .captures(&script)
                .and_then(|captures| captures.get(1).map(|value| value.as_str().to_owned()))
            {
                self.state.set_remote_api_key(api_key.clone())?;
                return Ok(api_key);
            }
        }

        Err(AppError::from(
            "Could not discover the Simply Lovely Setups public API key from the site bundle.",
        ))
    }
}

fn normalize_remote_setup(item: SimplyLovelySetupListItem) -> RemoteSetup {
    let file_name = item
        .file_name
        .clone()
        .unwrap_or_else(|| format!("{}-{}.json", item.track_name, item.car_name));
    let file_stem = file_name.strip_suffix(".json").unwrap_or(file_name.as_str());

    RemoteSetup {
        id: item.id.clone(),
        source_id: SIMPLY_LOVELY_SOURCE_ID.to_owned(),
        name: file_stem.to_owned(),
        display_name: file_stem.to_owned(),
        file_name: file_name.clone(),
        source_page_url: simply_lovely_source_page_url(&item.id),
        download_url: Some(format!(
            "{SIMPLY_LOVELY_BASE_URL}/api/v1/acc/setups/?object_id={}&details=true",
            item.id
        )),
        updated_at: None,
        ranking_label: None,
        author: None,
        preview_available: true,
        source_metadata: Some(json!({
            "carName": item.car_name,
            "trackName": item.track_name,
            "setupType": item.setup_type,
            "weather": item.weather,
            "trackBopType": item.track_bop_type,
        })),
    }
}

#[derive(Debug, Deserialize)]
struct SimplyLovelyOptions {
    cars: Vec<String>,
    tracks: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct SimplyLovelyCollection<T> {
    total: usize,
    page: usize,
    size: usize,
    items: Vec<T>,
}

#[derive(Debug, Deserialize)]
struct SimplyLovelySetupListItem {
    id: String,
    car_name: String,
    track_name: String,
    setup_type: Option<String>,
    weather: Option<String>,
    #[serde(rename = "trackBopType")]
    track_bop_type: Option<i64>,
    file_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SimplyLovelySetupDetail {
    id: String,
    car_name: String,
    track_name: String,
    setup_type: Option<String>,
    weather: Option<String>,
    #[serde(rename = "trackBopType")]
    track_bop_type: Option<i64>,
    file_name: Option<String>,
    #[serde(flatten)]
    remaining: Map<String, Value>,
}

#[cfg(test)]
mod tests {
    use super::{normalize_key, transform_detail_for_download, SimplyLovelySetupDetail};
    use serde_json::{json, Map};

    #[test]
    fn normalizes_keys_for_catalog_matching() {
        assert_eq!(normalize_key("Red Bull Ring"), "redbullring");
        assert_eq!(normalize_key("audi_r8_lms_evo_ii"), "audir8lmsevoii");
    }

    #[test]
    fn strips_source_only_fields_from_download_payload() {
        let detail = SimplyLovelySetupDetail {
            id: "abc".to_owned(),
            car_name: "bmw_m4_gt3".to_owned(),
            track_name: "monza".to_owned(),
            setup_type: Some("race".to_owned()),
            weather: Some("dry".to_owned()),
            track_bop_type: Some(31),
            file_name: Some("monza.json".to_owned()),
            remaining: Map::from_iter([("basicSetup".to_owned(), json!({"fuel": 13}))]),
        };

        let payload = transform_detail_for_download(&detail);
        assert!(payload.get("id").is_none());
        assert!(payload.get("car_name").is_none());
        assert!(payload.get("track_name").is_none());
        assert_eq!(payload["basicSetup"]["fuel"], 13);
    }
}
