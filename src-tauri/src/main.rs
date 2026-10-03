#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use pak_core::model::{IndustryGraph, LoadReport, Progress};
use serde::Serialize;
use std::collections::BTreeMap;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tauri::{ipc::Channel, State};

#[derive(Serialize)]
struct Preview {
    data_url: String,
    width: u32,
    height: u32,
}
#[derive(Serialize)]
struct DesktopReport {
    #[serde(flatten)]
    report: LoadReport<IndustryGraph>,
    previews: BTreeMap<String, Preview>,
}

#[derive(Default)]
struct Loader(Arc<AtomicBool>);

struct LoadingGuard(Arc<AtomicBool>);
impl Drop for LoadingGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[tauri::command]
async fn normalize_sources(paths: Vec<PathBuf>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        pak_core::normalize_sources(&paths).map(|paths| {
            paths
                .iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect()
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn load_sources(
    paths: Vec<PathBuf>,
    on_progress: Channel<Progress>,
    state: State<'_, Loader>,
) -> Result<DesktopReport, String> {
    if paths.is_empty() {
        return Err("フォルダを追加してください".into());
    }
    if state
        .0
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("読み込み処理が実行中です".into());
    }
    let guard = LoadingGuard(state.0.clone());
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let mut registry = pak_core::load_sources_with_images_and_progress(&paths, |p| {
            let _ = on_progress.send(p);
        });
        let industries: Vec<_> = registry
            .data
            .objects
            .values()
            .filter(|o| o.kind == "industry")
            .map(|o| (o.id.clone(), o.source.clone()))
            .collect();
        let mut previews = BTreeMap::new();
        let mut png_bytes = 0usize;
        for (completed, (id, source)) in industries.iter().enumerate() {
            let _ = on_progress.send(Progress {
                stage: Some("images".into()),
                completed,
                total: industries.len(),
                file: source.file.clone(),
            });
            let result = pak_core::render_industry_preview(&registry.data, id);
            let error = match result {
                Ok(Some(image)) if png_bytes + image.png.len() <= pak_core::preview::PNG_LIMIT => {
                    png_bytes += image.png.len();
                    previews.insert(
                        id.clone(),
                        Preview {
                            data_url: format!(
                                "data:image/png;base64,{}",
                                base64::engine::general_purpose::STANDARD.encode(&image.png)
                            ),
                            width: image.width,
                            height: image.height,
                        },
                    );
                    None
                }
                Ok(Some(_)) => Some("生成PNGが64MiBの上限を超えました".into()),
                Ok(None) => None,
                Err(error) => Some(error.to_string()),
            };
            if let Some(message) = error {
                registry.diagnostics.push(pak_core::model::Diagnostic {
                    severity: "warning".into(),
                    code: "image_error".into(),
                    message,
                    source: Some(source.clone()),
                    object_id: Some(id.clone()),
                });
            }
        }
        let _ = on_progress.send(Progress {
            stage: Some("images".into()),
            completed: industries.len(),
            total: industries.len(),
            file: String::new(),
        });
        DesktopReport {
            report: pak_core::graph_report(registry),
            previews,
        }
    })
    .await
    .map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Loader::default())
        .invoke_handler(tauri::generate_handler![normalize_sources, load_sources])
        .run(tauri::generate_context!())
        .expect("アプリケーションを開始できませんでした");
}
