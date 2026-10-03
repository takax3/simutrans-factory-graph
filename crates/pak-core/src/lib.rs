pub mod model;
pub mod parser;
pub mod translation;

use model::*;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

fn diagnostic(
    code: &str,
    message: String,
    source: Option<SourceRef>,
    object_id: Option<String>,
) -> Diagnostic {
    Diagnostic {
        severity: if code == "pak_error" || code == "source_error" {
            "error"
        } else {
            "warning"
        }
        .into(),
        code: code.into(),
        message,
        source,
        object_id,
    }
}

pub fn normalize_sources(paths: &[PathBuf]) -> Result<Vec<PathBuf>, String> {
    let mut result = Vec::new();
    for path in paths {
        let canonical = fs::canonicalize(path).map_err(|e| format!("{}: {e}", path.display()))?;
        if !canonical.is_dir() {
            return Err(format!("フォルダではありません: {}", path.display()));
        }
        if !result.contains(&canonical) {
            result.push(canonical);
        }
    }
    Ok(result)
}

pub fn load_sources(paths: &[PathBuf]) -> LoadReport<PakRegistry> {
    load_sources_with_progress(paths, |_| {})
}

pub fn load_sources_with_progress(
    paths: &[PathBuf],
    mut progress: impl FnMut(Progress),
) -> LoadReport<PakRegistry> {
    let mut report = LoadReport {
        data: PakRegistry::default(),
        diagnostics: Vec::new(),
        files_loaded: 0,
        files_failed: 0,
        incomplete: false,
    };
    let mut translations = BTreeMap::new();
    let mut sources = Vec::new();
    let mut seen = BTreeSet::new();
    for path in paths {
        let canonical = match fs::canonicalize(path) {
            Ok(p) if p.is_dir() => p,
            _ => {
                report.diagnostics.push(diagnostic(
                    "source_error",
                    format!("フォルダを読み取れません: {}", path.display()),
                    Some(source_ref(path, path)),
                    None,
                ));
                continue;
            }
        };
        if !seen.insert(canonical.clone()) {
            continue;
        }
        match list_files(&canonical) {
            Ok(files) => sources.push((
                canonical,
                files
                    .into_iter()
                    .filter(|p| extension(p, "pak"))
                    .collect::<Vec<_>>(),
            )),
            Err(e) => report.diagnostics.push(diagnostic(
                "source_error",
                e.to_string(),
                Some(source_ref(path, path)),
                None,
            )),
        }
    }
    let total = sources.iter().map(|(_, files)| files.len()).sum();
    let mut completed = 0;
    for (directory, files) in sources {
        let text_dir = directory.join("text");
        if text_dir.exists() {
            match list_files(&text_dir) {
                Ok(text_files) => {
                    for file in text_files.into_iter().filter(|p| {
                        translation::is_japanese_file(&p.file_name().unwrap().to_string_lossy())
                    }) {
                        match read_limited(&file, 16 * 1024 * 1024)
                            .and_then(|b| translation::parse_translation(&b))
                        {
                            Ok(entries) => translations.extend(entries),
                            Err(e) => report.diagnostics.push(diagnostic(
                                "translation_error",
                                e,
                                Some(source_ref(&directory, &file)),
                                None,
                            )),
                        }
                    }
                }
                Err(e) => report.diagnostics.push(diagnostic(
                    "translation_error",
                    e.to_string(),
                    Some(source_ref(&directory, &text_dir)),
                    None,
                )),
            }
        }
        if files.is_empty() {
            report.diagnostics.push(diagnostic(
                "empty_source",
                "フォルダ直下にPAKファイルがありません".into(),
                Some(source_ref(&directory, &directory)),
                None,
            ));
        }
        for file in files {
            let source = source_ref(&directory, &file);
            progress(Progress {
                completed,
                total,
                file: source.file.clone(),
            });
            match read_limited(&file, 256 * 1024 * 1024)
                .and_then(|b| parser::parse_pak(&b, &source))
            {
                Ok(objects) => {
                    report.files_loaded += 1;
                    for mut object in objects {
                        if let Some(old) = report.data.objects.remove(&object.id) {
                            if old.source.directory == object.source.directory {
                                report.diagnostics.push(diagnostic(
                                    "duplicate",
                                    format!(
                                        "同一読み込み元内の重複。後を採用: {} → {}",
                                        old.source.file, object.source.file
                                    ),
                                    Some(object.source.clone()),
                                    Some(object.id.clone()),
                                ));
                            }
                            object.overridden = old.overridden;
                            object.overridden.push(old.source);
                        }
                        report.data.objects.insert(object.id.clone(), object);
                    }
                }
                Err(e) => {
                    report.files_failed += 1;
                    report
                        .diagnostics
                        .push(diagnostic("pak_error", e, Some(source), None));
                }
            }
            completed += 1;
        }
    }
    for obj in report.data.objects.values_mut() {
        if let Some(name) = translations.get(&obj.internal_name) {
            obj.display_name = name.clone();
        }
        obj.inputs.sort();
        obj.inputs.dedup();
        obj.outputs.sort();
        obj.outputs.dedup();
    }
    for obj in report.data.objects.values() {
        for id in obj.inputs.iter().chain(obj.outputs.iter()) {
            if !report.data.objects.contains_key(id) {
                report.diagnostics.push(diagnostic(
                    "unresolved_goods",
                    format!("貨物の定義が見つかりません: {id}"),
                    Some(obj.source.clone()),
                    Some(obj.id.clone()),
                ));
            }
        }
    }
    report.incomplete = report.diagnostics.iter().any(|d| {
        matches!(
            d.code.as_str(),
            "pak_error" | "source_error" | "translation_error" | "unresolved_goods"
        )
    });
    progress(Progress {
        completed,
        total,
        file: String::new(),
    });
    report
}

fn source_ref(directory: &Path, file: &Path) -> SourceRef {
    SourceRef {
        directory: directory.to_string_lossy().into_owned(),
        file: file.to_string_lossy().into_owned(),
        object_index: 0,
    }
}

fn extension(path: &Path, ext: &str) -> bool {
    path.extension()
        .is_some_and(|e| e.to_string_lossy().eq_ignore_ascii_case(ext))
}

fn list_files(path: &Path) -> std::io::Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        if entry.file_type()?.is_file() {
            files.push(entry.path());
        }
    }
    files.sort_by(|a, b| a.file_name().cmp(&b.file_name()));
    Ok(files)
}

fn read_limited(path: &Path, max: u64) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > max {
        return Err("ファイルサイズが安全上限を超えています".into());
    }
    let mut bytes = Vec::new();
    file.take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > max {
        return Err("ファイルサイズが安全上限を超えています".into());
    }
    Ok(bytes)
}

pub fn build_graph(registry: &PakRegistry) -> IndustryGraph {
    let mut graph = IndustryGraph::default();
    for obj in registry.objects.values() {
        if obj.kind == "goods" {
            graph.goods.insert(
                obj.id.clone(),
                Goods {
                    id: obj.id.clone(),
                    internal_name: obj.internal_name.clone(),
                    display_name: obj.display_name.clone(),
                    producers: Vec::new(),
                    consumers: Vec::new(),
                    source: Some(obj.source.clone()),
                    overridden: obj.overridden.clone(),
                    unresolved: false,
                },
            );
        } else {
            graph.industries.insert(
                obj.id.clone(),
                Industry {
                    id: obj.id.clone(),
                    internal_name: obj.internal_name.clone(),
                    display_name: obj.display_name.clone(),
                    inputs: obj.inputs.clone(),
                    outputs: obj.outputs.clone(),
                    source: obj.source.clone(),
                    overridden: obj.overridden.clone(),
                },
            );
        }
    }
    for industry in graph.industries.values() {
        for (ids, input) in [(&industry.inputs, true), (&industry.outputs, false)] {
            for id in ids {
                let good = graph.goods.entry(id.clone()).or_insert_with(|| {
                    let name = id.strip_prefix("goods:").unwrap_or(id).to_owned();
                    Goods {
                        id: id.clone(),
                        internal_name: name.clone(),
                        display_name: name,
                        producers: Vec::new(),
                        consumers: Vec::new(),
                        source: None,
                        overridden: Vec::new(),
                        unresolved: true,
                    }
                });
                let refs = if input {
                    &mut good.consumers
                } else {
                    &mut good.producers
                };
                if !refs.contains(&industry.id) {
                    refs.push(industry.id.clone());
                }
            }
        }
    }
    graph
}

pub fn graph_report(report: LoadReport<PakRegistry>) -> LoadReport<IndustryGraph> {
    LoadReport {
        data: build_graph(&report.data),
        diagnostics: report.diagnostics,
        files_loaded: report.files_loaded,
        files_failed: report.files_failed,
        incomplete: report.incomplete,
    }
}
