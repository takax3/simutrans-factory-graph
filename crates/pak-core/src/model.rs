use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SourceRef {
    pub directory: String,
    pub file: String,
    pub object_index: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Diagnostic {
    pub severity: String,
    pub code: String,
    pub message: String,
    pub source: Option<SourceRef>,
    pub object_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Object {
    #[serde(default)]
    pub category_id: Option<u8>,
    #[serde(default)]
    pub category_name: Option<String>,
    pub id: String,
    pub internal_name: String,
    pub display_name: String,
    pub kind: String,
    pub version: u16,
    pub inputs: Vec<String>,
    pub outputs: Vec<String>,
    pub source: SourceRef,
    pub overridden: Vec<SourceRef>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct PakRegistry {
    pub objects: BTreeMap<String, Object>,
    #[serde(skip)]
    pub images: BTreeMap<String, crate::preview::ImageSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadReport<T> {
    pub data: T,
    pub diagnostics: Vec<Diagnostic>,
    pub files_loaded: usize,
    pub files_failed: usize,
    pub incomplete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Industry {
    pub id: String,
    pub internal_name: String,
    pub display_name: String,
    pub inputs: Vec<String>,
    pub outputs: Vec<String>,
    pub source: SourceRef,
    pub overridden: Vec<SourceRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Goods {
    #[serde(default)]
    pub category_id: Option<u8>,
    #[serde(default)]
    pub category_name: Option<String>,
    pub id: String,
    pub internal_name: String,
    pub display_name: String,
    pub producers: Vec<String>,
    pub consumers: Vec<String>,
    pub source: Option<SourceRef>,
    pub overridden: Vec<SourceRef>,
    pub unresolved: bool,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct IndustryGraph {
    pub industries: BTreeMap<String, Industry>,
    pub goods: BTreeMap<String, Goods>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Progress {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub stage: Option<String>,
    pub completed: usize,
    pub total: usize,
    pub file: String,
}
