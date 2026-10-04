use pak_core::{
    build_graph, load_sources, model::SourceRef, parser::parse_pak, translation::parse_translation,
};
use std::fs;

fn node(tag: &[u8; 4], body: &[u8], children: Vec<Vec<u8>>) -> Vec<u8> {
    let mut result = tag.to_vec();
    result.extend((children.len() as u16).to_le_bytes());
    if body.len() >= 65535 {
        result.extend(65535u16.to_le_bytes());
        result.extend((body.len() as u32).to_le_bytes());
    } else {
        result.extend((body.len() as u16).to_le_bytes());
    }
    result.extend(body);
    for child in children {
        result.extend(child);
    }
    result
}
fn text(name: &str) -> Vec<u8> {
    node(b"TEXT", &[name.as_bytes(), &[0]].concat(), vec![])
}
fn good(name: &str) -> Vec<u8> {
    node(b"GOOD", &[3, 128, 0, 0, 0, 0, 0, 0, 0, 0], vec![text(name)])
}
fn xref(name: &str) -> Vec<u8> {
    node(
        b"XREF",
        &[b"GOOD".as_slice(), &[1], name.as_bytes(), &[0]].concat(),
        vec![],
    )
}
fn factory(name: &str, inputs: &[&str], outputs: &[&str]) -> Vec<u8> {
    let mut body = vec![0; 38];
    body[0] = 3;
    body[1] = 128;
    body[12..14].copy_from_slice(&(inputs.len() as u16).to_le_bytes());
    body[14..16].copy_from_slice(&(outputs.len() as u16).to_le_bytes());
    let mut children = vec![
        node(b"BUIL", &[0; 4], vec![text(name)]),
        node(b"XREF", b"SMOK\0\0", vec![]),
    ];
    for input in inputs {
        children.push(node(b"FSUP", &[0; 8], vec![xref(input)]));
    }
    for output in outputs {
        children.push(node(b"FPRO", &[1, 128, 0, 0, 0, 1], vec![xref(output)]));
    }
    node(b"FACT", &body, children)
}
fn pak(children: Vec<Vec<u8>>) -> Vec<u8> {
    let mut data = b"Simutrans object file\n\x1a".to_vec();
    data.extend(1003u32.to_le_bytes());
    data.extend(node(b"ROOT", &[], children));
    data
}
fn source() -> SourceRef {
    SourceRef {
        directory: "test".into(),
        file: "test.pak".into(),
        object_index: 0,
    }
}

#[test]
fn parses_many_objects_and_goods_references_not_unrelated_xrefs() {
    let objects = parse_pak(
        &pak(vec![
            factory("mill", &["grain"], &["food"]),
            good("grain"),
            good("food"),
        ]),
        &source(),
    )
    .unwrap();
    assert_eq!(objects.len(), 3);
    assert_eq!(objects[0].inputs, ["goods:grain"]);
    assert_eq!(objects[0].outputs, ["goods:food"]);
    assert_eq!(objects[0].internal_name, "mill");
}

#[test]
fn supported_factory_versions_preserve_nonempty_edges_in_all_containers() {
    // Standard factory_reader: v0 includes an unused word after placement;
    // v1 stores color as u16; v2+ stores color and fields as u8.
    // In each layout supplier_count/product_count remain at offsets 12/14.
    for compiler in [1001u32, 1002, 1003] {
        for (v, size) in [16, 18, 18, 38, 43, 80, 81].into_iter().enumerate() {
            for supplier_size in [6, 8] {
                for product_version in [0u16, 1] {
                    let mut body = vec![0; size];
                    if v > 0 {
                        body[..2].copy_from_slice(&(0x8000 | v as u16).to_le_bytes());
                    }
                    body[12..14].copy_from_slice(&2u16.to_le_bytes());
                    body[14..16].copy_from_slice(&1u16.to_le_bytes());
                    let mut product = vec![0; if product_version == 0 { 4 } else { 6 }];
                    if product_version > 0 {
                        product[..2].copy_from_slice(&0x8001u16.to_le_bytes());
                    }
                    let factory = node(
                        b"FACT",
                        &body,
                        vec![
                            node(b"BUIL", &[], vec![text("legacy")]),
                            node(b"XREF", b"SMOK\0\0", vec![]),
                            node(b"FSUP", &vec![0; supplier_size], vec![xref("grain")]),
                            node(b"FSUP", &vec![0; supplier_size], vec![xref("water")]),
                            node(b"FPRO", &product, vec![xref("food")]),
                        ],
                    );
                    let mut data = b"compatibility\x1a".to_vec();
                    data.extend(compiler.to_le_bytes());
                    data.extend(node(b"ROOT", &[], vec![factory]));
                    let objects = parse_pak(&data, &source()).unwrap();
                    assert_eq!(objects[0].version, v as u16);
                    assert_eq!(objects[0].inputs, ["goods:grain", "goods:water"]);
                    assert_eq!(objects[0].outputs, ["goods:food"]);
                }
            }
        }
    }
}

#[test]
fn validates_all_supported_body_versions() {
    for (v, size) in [16, 18, 18, 38, 43, 80, 81].into_iter().enumerate() {
        let mut body = vec![0; size];
        if v > 0 {
            body[..2].copy_from_slice(&(0x8000 | v as u16).to_le_bytes());
        }
        let obj = node(
            b"FACT",
            &body,
            vec![
                node(b"BUIL", &[], vec![text("plant")]),
                node(b"XREF", b"SMOK\0\0", vec![]),
            ],
        );
        assert_eq!(
            parse_pak(&pak(vec![obj]), &source()).unwrap()[0].version,
            v as u16
        );
    }
    for (v, size) in [4, 8, 10, 10, 16].into_iter().enumerate() {
        let mut body = vec![0; size];
        if v > 0 {
            body[..2].copy_from_slice(&(0x8000 | v as u16).to_le_bytes());
        }
        let obj = node(b"GOOD", &body, vec![text("grain")]);
        assert_eq!(
            parse_pak(&pak(vec![obj]), &source()).unwrap()[0].version,
            v as u16
        );
    }
}

#[test]
fn rejects_truncated_and_unknown_versions_without_panicking() {
    let data = pak(vec![factory("mill", &["grain"], &["food"]), good("food")]);
    for len in 0..data.len() {
        assert!(parse_pak(&data[..len], &source()).is_err(), "length {len}");
    }
    let newer = node(b"GOOD", &[0xff, 0x80, 0, 0], vec![text("future")]);
    assert!(parse_pak(&pak(vec![newer]), &source())
        .unwrap_err()
        .contains("未対応"));
    let mut extended = vec![0; 81];
    extended[..2].copy_from_slice(&0xc006u16.to_le_bytes());
    assert!(parse_pak(&pak(vec![node(b"FACT", &extended, vec![])]), &source()).is_err());
}

#[test]
fn skips_large_images_and_honors_legacy_compiler_length() {
    let data = pak(vec![node(b"IMG\0", &vec![0; 70000], vec![]), good("food")]);
    assert_eq!(parse_pak(&data, &source()).unwrap().len(), 1);
    let mut legacy = b"old\x1a".to_vec();
    legacy.extend(1001u32.to_le_bytes());
    let mut image = b"IMG\0\0\0\xff\xff".to_vec();
    image.extend(vec![0; 65535]);
    legacy.extend(node(b"ROOT", &[], vec![image, good("food")]));
    assert_eq!(parse_pak(&legacy, &source()).unwrap().len(), 1);
}

#[test]
fn malformed_counts_and_missing_strings_are_errors() {
    let obj = node(
        b"GOOD",
        &[0; 4],
        vec![node(b"TEXT", b"no terminator", vec![])],
    );
    assert!(parse_pak(&pak(vec![obj]), &source()).is_err());
    let mut body = vec![0; 38];
    body[..2].copy_from_slice(&0x8003u16.to_le_bytes());
    body[12] = 2;
    assert!(parse_pak(
        &pak(vec![node(
            b"FACT",
            &body,
            vec![node(b"BUIL", &[], vec![text("bad")])]
        )]),
        &source()
    )
    .is_err());
}

#[test]
fn overrides_translates_and_rebuilds_edges_from_winners() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().join("日本語 base");
    let addon = tmp.path().join("Addon");
    fs::create_dir_all(base.join("text")).unwrap();
    fs::create_dir_all(addon.join("text")).unwrap();
    fs::write(
        base.join("a.pak"),
        pak(vec![
            good("grain"),
            good("food"),
            factory("mill", &["grain"], &["food"]),
            factory("farm", &[], &["grain"]),
            factory("shop", &["food"], &[]),
        ]),
    )
    .unwrap();
    fs::write(
        base.join("z.PAK"),
        pak(vec![factory("farm", &[], &["grain"])]),
    )
    .unwrap();
    fs::write(
        base.join("text/ja.tab"),
        "§#UTF8\n# comment\nmill\n食品工場\nfood\n食品\n",
    )
    .unwrap();
    fs::write(
        addon.join("a.pak"),
        pak(vec![factory("mill", &["missing"], &["food"])]),
    )
    .unwrap();
    fs::write(addon.join("text/custom.ja.tab"), "\u{feff}food\n食料品\n").unwrap();
    fs::write(addon.join("broken.pak"), b"broken").unwrap();
    let report = load_sources(&[base.clone(), addon.clone(), base.clone()]);
    assert_eq!(report.files_loaded, 3);
    assert_eq!(report.files_failed, 1);
    assert!(report.incomplete);
    assert_eq!(
        report
            .diagnostics
            .iter()
            .filter(|d| d.code == "duplicate")
            .count(),
        1
    );
    assert_eq!(
        report
            .diagnostics
            .iter()
            .filter(|d| d.code == "unresolved_goods")
            .count(),
        1
    );
    let graph = build_graph(&report.data);
    assert_eq!(graph.industries["industry:mill"].display_name, "食品工場");
    assert_eq!(graph.goods["goods:food"].display_name, "食料品");
    assert!(graph.goods["goods:grain"].consumers.is_empty());
    assert!(graph.goods["goods:missing"].unresolved);
    assert_eq!(graph.goods["goods:missing"].consumers, ["industry:mill"]);
    assert_eq!(graph.industries["industry:mill"].overridden.len(), 1);
    let reversed = build_graph(&load_sources(&[addon, base]).data);
    assert_eq!(reversed.industries["industry:mill"].inputs, ["goods:grain"]);
}

#[test]
fn no_recursion_and_empty_or_missing_sources_are_diagnosed() {
    let tmp = tempfile::tempdir().unwrap();
    fs::create_dir(tmp.path().join("sub")).unwrap();
    fs::write(tmp.path().join("sub/good.pak"), pak(vec![good("hidden")])).unwrap();
    let report = load_sources(&[tmp.path().to_owned(), tmp.path().join("missing")]);
    assert!(report.data.objects.is_empty());
    assert!(report.diagnostics.iter().any(|d| d.code == "empty_source"));
    assert!(report.diagnostics.iter().any(|d| d.code == "source_error"));
}

#[test]
fn translation_markers_comments_empty_values_and_unicode() {
    let map = parse_translation(
        "\u{feff}§# marker\n# comment\nfood\n食品\ncoal\n#石炭\nempty\n\ntext\n一行目\\n二行目\n"
            .as_bytes(),
    )
    .unwrap();
    assert_eq!(map["food"], "食品");
    assert_eq!(map["coal"], "#石炭");
    assert_eq!(map["text"], "一行目\n二行目");
    assert!(!map.contains_key("empty"));
    assert!(parse_translation(b"unpaired").is_err());
    assert!(parse_translation(&[0xff]).is_err());
}

#[test]
fn graph_supports_multiple_producers_and_cycles() {
    let tmp = tempfile::tempdir().unwrap();
    fs::write(
        tmp.path().join("cycle.pak"),
        pak(vec![
            good("a"),
            good("b"),
            factory("one", &["a"], &["b"]),
            factory("two", &["b"], &["a"]),
            factory("three", &[], &["a"]),
            factory("self", &["a"], &["a"]),
        ]),
    )
    .unwrap();
    let graph = build_graph(&load_sources(&[tmp.path().to_owned()]).data);
    assert_eq!(graph.goods["goods:a"].producers.len(), 3);
    assert_eq!(graph.goods["goods:b"].consumers, ["industry:two"]);
}
