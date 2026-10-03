use std::{io::Write, path::PathBuf};
fn main() {
    let paths: Vec<PathBuf> = std::env::args_os().skip(1).map(PathBuf::from).collect();
    if paths.is_empty() {
        eprintln!("Usage: pak-cli <source-folder> [higher-priority-folder ...]");
        std::process::exit(2);
    }
    let report = pak_core::graph_report(pak_core::load_sources(&paths));
    let empty = report.data.industries.is_empty() && report.data.goods.is_empty();
    let result = serde_json::to_writer_pretty(std::io::stdout().lock(), &report);
    if let Err(e) = result {
        eprintln!("JSON出力失敗: {e}");
        std::process::exit(2);
    }
    let _ = std::io::stdout().write_all(b"\n");
    if empty {
        std::process::exit(1);
    }
}
