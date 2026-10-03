#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use pak_core::model::{IndustryGraph, LoadReport, Progress};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tauri::{ipc::Channel, State};

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
) -> Result<LoadReport<IndustryGraph>, String> {
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
        pak_core::graph_report(pak_core::load_sources_with_progress(&paths, |p| {
            let _ = on_progress.send(p);
        }))
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
