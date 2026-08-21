use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppBootstrap {
    pub settings: AppSettings,
    pub library: LocalLibrary,
    pub undo_state: UndoState,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub detected_root: Option<String>,
    pub manual_root: Option<String>,
    pub effective_root: Option<String>,
    pub root_status: RootStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RootStatus {
    Ready,
    Missing,
    Invalid,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLibrary {
    pub cars: Vec<Car>,
    pub tracks: Vec<Track>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Car {
    pub id: String,
    pub folder_name: String,
    pub display_name: String,
    pub absolute_path: String,
    pub track_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub car_id: String,
    pub folder_name: String,
    pub display_name: String,
    pub absolute_path: String,
    pub setup_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSetup {
    pub id: String,
    pub track_id: String,
    pub file_name: String,
    pub display_name: String,
    pub absolute_path: String,
    pub last_modified_at: String,
    pub file_extension: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoState {
    pub can_undo: bool,
    pub can_redo: bool,
    pub undo_label: Option<String>,
    pub redo_label: Option<String>,
}

impl Default for UndoState {
    fn default() -> Self {
        Self {
            can_undo: false,
            can_redo: false,
            undo_label: None,
            redo_label: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupDocument {
    pub kind: DocumentKind,
    pub id: String,
    pub title: String,
    pub content: String,
    pub read_only: bool,
    pub dirty: bool,
    pub source_label: String,
    pub remote_download: Option<RemoteDownloadDescriptor>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DocumentKind {
    Local,
    Remote,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationResult {
    pub bootstrap: AppBootstrap,
    pub selected_setup_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSourceResult {
    pub items: Vec<RemoteSetup>,
    pub stale: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSetup {
    pub id: String,
    pub source_id: String,
    pub name: String,
    pub display_name: String,
    pub file_name: String,
    pub source_page_url: String,
    pub download_url: Option<String>,
    pub updated_at: Option<String>,
    pub author: Option<String>,
    pub preview_available: bool,
    pub source_metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDownloadDescriptor {
    pub source_id: String,
    pub remote_setup_id: String,
    pub suggested_file_name: String,
    pub source_page_url: Option<String>,
}
