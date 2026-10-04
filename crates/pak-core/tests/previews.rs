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
    factory_formats(pixel, broken, version, 2, 3)
}
fn factory_formats(
    pixel: u16,
    broken: bool,
    version: u16,
    tile_version: u16,
    image_version: u8,
) -> Vec<u8> {
    let mut b = vec![0; 47];
    if version > 0 {
        b[..2].copy_from_slice(&(0x8000 | version).to_le_bytes());
    }
    let offset = match version {
        0 => 16,
        12 => 9,
        _ => 10,
    };
    b[offset] = 1;
    b[offset + 2] = 1;
    b[offset + 4] = 1;
    let img = if broken {
        node(b"IMG\0", &[0; 3], vec![])
    } else {
        let words: Vec<u16> = vec![0, 4, pixel, pixel, pixel, pixel, 0];
        let mut body = if image_version == 0 {
            let mut body = vec![0; 12];
            body[1] = 4;
            body[3] = 1;
            body[4..8].copy_from_slice(&(words.len() as u32).to_le_bytes());
            body
        } else {
            let mut body = vec![0, 0, 0, 0, 4, 1, image_version, 0, 0, 1];
            if image_version < 3 {
                body[7..9].copy_from_slice(&(words.len() as u16).to_le_bytes());
            } else {
                body[5] = 0;
                body[7] = 1;
            }
            body
        };
        for word in words {
            body.extend(word.to_le_bytes());
        }
        node(b"IMG\0", &body, vec![])
    };
    let tile_body = match tile_version {
        0 => vec![0, 0, 0, 0, 1, 0, 0, 0],
        1 => vec![1, 128, 1, 0, 0, 0],
        _ => vec![tile_version as u8, 128, 1, 0, 0, 0, 1],
    };
    let tile = node(
        b"TILE",
        &tile_body,
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
fn renders_all_standard_building_tile_and_image_versions_identically() {
    let dir = tempfile::tempdir().unwrap();
    let mut images = Vec::new();
    for version in 0..=12 {
        for tile_version in 0..=2 {
            for image_version in 0..=3 {
                write(
                    dir.path(),
                    "factory.pak",
                    vec![
                        outside(),
                        factory_formats(0x7c00, false, version, tile_version, image_version),
                    ],
                );
                let report = load_sources_with_images_and_progress(&[dir.path().into()], |_| {});
                images.push(
                    render_industry_preview(&report.data, "industry:test")
                        .unwrap()
                        .unwrap()
                        .png,
                );
            }
        }
    }
    for image in &images {
        assert_eq!(images[0], *image);
    }
    write(
        dir.path(),
        "factory.pak",
        vec![outside(), factory_version(0x7c00, false, 13)],
    );
    let report = load_sources_with_images_and_progress(&[dir.path().into()], |_| {});
    assert_eq!(report.data.objects.len(), 1);
    assert!(render_industry_preview(&report.data, "industry:test")
        .unwrap_err()
        .to_string()
        .contains("BUIL v13"));
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
