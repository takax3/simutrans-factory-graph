//! Developer-only real PAK verification; outputs stay outside distributable assets.
use pak_core::{load_sources_with_images_and_progress, render_industry_preview};
use std::{env, fs, path::PathBuf};

fn main() {
    let args: Vec<_> = env::args().skip(1).collect();
    assert!(
        args.len() >= 2,
        "preview_probe OUTPUT_DIRECTORY SOURCE_DIRECTORY..."
    );
    let output = PathBuf::from(&args[0]);
    fs::create_dir_all(&output).unwrap();
    let paths: Vec<_> = args[1..].iter().map(PathBuf::from).collect();
    let registry = load_sources_with_images_and_progress(&paths, |_| {});
    let mut rendered = Vec::new();
    let mut errors = Vec::new();
    for object in registry
        .data
        .objects
        .values()
        .filter(|o| o.kind == "industry")
    {
        match render_industry_preview(&registry.data, &object.id) {
            Ok(Some(image)) => {
                let filename = format!(
                    "{}.png",
                    object.internal_name.replace(['/', '\\', ':'], "_")
                );
                fs::write(output.join(&filename), &image.png).unwrap();
                rendered.push(serde_json::json!({"id":object.id,"file":filename,"width":image.width,"height":image.height,"bytes":image.png.len()}));
            }
            Ok(None) => errors.push(format!("{}: empty", object.id)),
            Err(e) => errors.push(format!("{}: {e}", object.id)),
        }
    }
    let graph = pak_core::build_graph(&registry.data);
    let summary = serde_json::json!({"industries":graph.industries.len(),"goods":graph.goods.len(),"relations":graph.industries.values().map(|i| i.inputs.len()+i.outputs.len()).sum::<usize>(),"rendered":rendered,"errors":errors,"diagnostics":registry.diagnostics});
    fs::write(
        output.join("report.json"),
        serde_json::to_vec_pretty(&summary).unwrap(),
    )
    .unwrap();
    println!("{summary}");
    if !errors.is_empty() {
        std::process::exit(1);
    }
}
