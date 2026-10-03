use pak_core::{load_sources_with_images_and_progress, render_industry_preview};
use std::{fs, path::Path};

fn node(tag: &[u8; 4], body: &[u8], children: Vec<Vec<u8>>) -> Vec<u8> {
    let mut b = tag.to_vec();
    b.extend((children.len() as u16).to_le_bytes());
    b.extend((body.len() as u16).to_le_bytes());
    b.extend(body);
    for c in children {
        b.extend(c);
    }
    b
}
fn text(name: &str) -> Vec<u8> {
    node(b"TEXT", &[name.as_bytes(), &[0]].concat(), vec![])
}
fn array(img: Vec<u8>) -> Vec<u8> {
    node(b"IMG2", &[1, 0], vec![node(b"IMG1", &[1, 0], vec![img])])
}
fn image(pixel: u16) -> Vec<u8> {
    let mut b = vec![0, 0, 0, 0, 4, 0, 3, 1, 0, 1];
    for w in [0, 4, pixel, pixel, pixel, pixel, 0] {
        b.extend(w.to_le_bytes());
    }
    node(b"IMG\0", &b, vec![])
}
fn outside() -> Vec<u8> {
    node(
        b"GRND",
        &[],
        vec![text("Outside"), text("test"), array(image(0))],
    )
}
fn factory(pixel: u16, broken: bool) -> Vec<u8> {
    factory_version(pixel, broken, 5)
}
fn factory_version(pixel: u16, broken: bool, version: u16) -> Vec<u8> {
    let mut b = vec![0; 24];
    b[..2].copy_from_slice(&(0x8000 | version).to_le_bytes());
    b[10] = 1;
    b[12] = 1;
    b[14] = 1;
    let img = if broken {
        node(b"IMG\0", &[0; 3], vec![])
    } else {
        image(pixel)
    };
    let tile = node(
        b"TILE",
        &[2, 128, 1, 0, 0, 0, 1],
        vec![array(img), node(b"IMG2", &[0, 0], vec![])],
    );
    let building = node(b"BUIL", &b, vec![text("test"), text("test"), tile]);
    let mut body = vec![0; 18];
    body[..2].copy_from_slice(&0x8002u16.to_le_bytes());
    node(
        b"FACT",
        &body,
        vec![building, node(b"XREF", b"SMOK\0\0", vec![])],
    )
}
#[test]
fn renders_version9_buildings_with_the_same_geometry_as_version8() {
    let dir = tempfile::tempdir().unwrap();
    let mut images = Vec::new();
    for version in [8, 9] {
        write(
            dir.path(),
            "factory.pak",
            vec![outside(), factory_version(0x7c00, false, version)],
        );
        let report = load_sources_with_images_and_progress(&[dir.path().into()], |_| {});
        images.push(
            render_industry_preview(&report.data, "industry:test")
                .unwrap()
                .unwrap()
                .png,
        );
    }
    assert_eq!(images[0], images[1]);
    write(
        dir.path(),
        "factory.pak",
        vec![outside(), factory_version(0x7c00, false, 11)],
    );
    let report = load_sources_with_images_and_progress(&[dir.path().into()], |_| {});
    assert_eq!(report.data.objects.len(), 1);
    assert!(render_industry_preview(&report.data, "industry:test")
        .unwrap_err()
        .to_string()
        .contains("BUIL v11"));
}
fn write(dir: &Path, name: &str, objects: Vec<Vec<u8>>) {
    let mut b = b"test\x1a".to_vec();
    b.extend(1003u32.to_le_bytes());
    b.extend(node(b"ROOT", &[], objects));
    fs::write(dir.join(name), b).unwrap();
}
#[test]
fn inherits_raster_and_uses_winning_images_even_with_same_file_duplicates() {
    let base = tempfile::tempdir().unwrap();
    let addon = tempfile::tempdir().unwrap();
    write(
        base.path(),
        "base.pak",
        vec![outside(), factory(0x7c00, false)],
    );
    write(
        addon.path(),
        "addon.pak",
        vec![factory(0x03e0, false), factory(0x001f, false)],
    );
    let report =
        load_sources_with_images_and_progress(&[base.path().into(), addon.path().into()], |_| {});
    assert_eq!(report.data.objects.len(), 1);
    assert_eq!(report.data.images["industry:test"].raster, Some(4));
    let p = render_industry_preview(&report.data, "industry:test")
        .unwrap()
        .unwrap();
    assert_eq!(
        image::load_from_memory(&p.png)
            .unwrap()
            .to_rgba8()
            .get_pixel(0, 0)
            .0,
        [0, 0, 248, 255]
    );
    assert_eq!(report.data.objects["industry:test"].source.object_index, 1);
    assert_eq!(
        report
            .diagnostics
            .iter()
            .filter(|d| d.code == "duplicate")
            .count(),
        1
    );
    let reverse =
        load_sources_with_images_and_progress(&[addon.path().into(), base.path().into()], |_| {});
    let p = render_industry_preview(&reverse.data, "industry:test")
        .unwrap()
        .unwrap();
    assert_eq!(
        image::load_from_memory(&p.png)
            .unwrap()
            .to_rgba8()
            .get_pixel(0, 0)
            .0,
        [248, 0, 0, 255]
    );
    assert!(!serde_json::to_string(&report.data)
        .unwrap()
        .contains("sprites"));
}
#[test]
fn broken_image_keeps_industry_and_does_not_fall_back_to_overridden_image() {
    let base = tempfile::tempdir().unwrap();
    let addon = tempfile::tempdir().unwrap();
    write(
        base.path(),
        "base.pak",
        vec![outside(), factory(0x7c00, false)],
    );
    write(addon.path(), "addon.pak", vec![factory(0, true)]);
    let report =
        load_sources_with_images_and_progress(&[base.path().into(), addon.path().into()], |_| {});
    assert_eq!(report.files_loaded, 2);
    assert_eq!(report.files_failed, 0);
    assert_eq!(pak_core::build_graph(&report.data).industries.len(), 1);
    assert!(render_industry_preview(&report.data, "industry:test").is_err());
}
#[test]
fn empty_winning_image_and_missing_base_are_distinct() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "factory.pak", vec![factory(0, false)]);
    let report = load_sources_with_images_and_progress(&[dir.path().into()], |_| {});
    assert!(render_industry_preview(&report.data, "industry:test")
        .unwrap_err()
        .to_string()
        .contains("ベースPakset"));
    let mut r = report.data;
    r.images.get_mut("industry:test").unwrap().sprites = Ok(vec![]);
    assert!(render_industry_preview(&r, "industry:test")
        .unwrap()
        .is_none());
}
