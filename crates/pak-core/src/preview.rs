//! Static Standard building previews. Stored-space colors and offsets follow f19fe4c8.
use crate::{model::PakRegistry, parser::Node};
use image::{Rgba, RgbaImage};
use std::{fmt, io::Cursor};

pub const MATERIAL_LIMIT: usize = 128 * 1024 * 1024;
pub const PNG_LIMIT: usize = 64 * 1024 * 1024;
const CANVAS_LIMIT: u32 = 4096;

#[derive(Debug, Clone)]
pub struct Sprite {
    pub tile_x: i32,
    pub tile_y: i32,
    pub height: i32,
    pub foreground: bool,
    pub body: Vec<u8>,
}
#[derive(Debug, Clone)]
pub struct ImageSource {
    pub raster: Option<u16>,
    pub sprites: Result<Vec<Sprite>, String>,
}
impl ImageSource {
    pub fn material_bytes(&self) -> usize {
        self.sprites
            .as_ref()
            .map_or(0, |s| s.iter().map(|s| s.body.len()).sum())
    }
}
#[derive(Debug)]
pub struct PreviewImage {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
}
#[derive(Debug, Clone)]
pub struct ImageError(pub String);
impl fmt::Display for ImageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for ImageError {}
impl From<String> for ImageError {
    fn from(s: String) -> Self {
        Self(s)
    }
}

fn word(b: &[u8], p: usize) -> Result<u16, String> {
    Ok(u16::from_le_bytes(
        b.get(p..p + 2)
            .ok_or("画像情報が途中で切れています")?
            .try_into()
            .unwrap(),
    ))
}
fn dword(b: &[u8], p: usize) -> Result<u32, String> {
    Ok(u32::from_le_bytes(
        b.get(p..p + 4)
            .ok_or("画像情報が途中で切れています")?
            .try_into()
            .unwrap(),
    ))
}
fn node_version(b: &[u8]) -> Result<u16, String> {
    let v = word(b, 0)?;
    Ok(if v & 0x8000 != 0 { v & 0x7fff } else { 0 })
}
fn list(node: &Node, tag: &[u8; 4]) -> Result<(), String> {
    if node.tag != tag || word(node.body, 0)? as usize != node.children.len() {
        return Err("画像リストの種別または要素数が不正です".into());
    }
    Ok(())
}
pub(crate) fn outside_width(node: &Node) -> Result<u16, String> {
    let array = node.children.get(2).ok_or("Outsideの画像がありません")?;
    list(array, b"IMG2")?;
    let row = array.children.first().ok_or("Outsideの画像がありません")?;
    list(row, b"IMG1")?;
    let image = row.children.first().ok_or("Outsideの画像がありません")?;
    let (_, _, w, _, _) = geometry(image.body)?;
    if image.tag != b"IMG\0" || w == 0 || w > 1024 || w % 4 != 0 {
        return Err("Outsideのタイル幅が不正です".into());
    }
    Ok(w as u16)
}
pub(crate) fn extract_building(node: &Node, budget: &mut usize) -> Result<Vec<Sprite>, String> {
    let v = node_version(node.body)?;
    if v > 12 {
        return Err(format!("未対応の建物画像形式 BUIL v{v}"));
    }
    // v0 has 32-bit fields; v12 removes the old building-type byte.
    let offset = match v {
        0 => 16,
        12 => 9,
        _ => 10,
    };
    let width = word(node.body, offset)? as usize;
    let height = word(node.body, offset + 2)? as usize;
    let layouts = if v == 0 {
        dword(node.body, 20)? as usize
    } else {
        *node
            .body
            .get(offset + 4)
            .ok_or("建物画像情報が短すぎます")? as usize
    };
    let area = width
        .checked_mul(height)
        .ok_or("建物タイル数が範囲外です")?;
    if area == 0 || area > 65536 || layouts == 0 || node.children.len() < 2 + area * layouts {
        return Err("建物タイル数が不正です".into());
    }
    let mut selected = Vec::new();
    let mut bytes = 0usize;
    for (index, tile) in node.children[2..2 + area].iter().enumerate() {
        let tile_v = node_version(tile.body)?;
        // Unversioned TILE stores a four-byte pointer before phases/index.
        let index_offset = if tile_v == 0 { 6 } else { 4 };
        if tile.tag != b"TILE"
            || tile_v > 2
            || word(tile.body, index_offset)? as usize != index
            || (tile_v == 2 && tile.body.get(6).copied().unwrap_or(0) == 0)
        {
            return Err("未対応または不正な建物TILEです".into());
        }
        for foreground in [false, true] {
            let array = tile
                .children
                .get(usize::from(foreground))
                .ok_or("建物画像リストがありません")?;
            list(array, b"IMG2")?;
            for (h, row) in array.children.iter().enumerate() {
                list(row, b"IMG1")?;
                if foreground && h > 0 {
                    continue;
                }
                if let Some(img) = row.children.first() {
                    if img.tag != b"IMG\0" || !img.children.is_empty() {
                        return Err("画像ノードが不正です".into());
                    }
                    bytes = bytes
                        .checked_add(img.body.len())
                        .ok_or("画像素材サイズが範囲外です")?;
                    if bytes > *budget {
                        return Err("画像素材が128MiBの上限を超えました".into());
                    }
                    selected.push((index, h, foreground, img.body));
                }
            }
        }
    }
    *budget -= bytes;
    Ok(selected
        .into_iter()
        .map(|(i, h, foreground, body)| Sprite {
            tile_x: (i % width) as i32,
            tile_y: (i / width) as i32,
            height: h as i32,
            foreground,
            body: body.to_vec(),
        })
        .collect())
}

fn geometry(b: &[u8]) -> Result<(i32, i32, u32, u32, usize), String> {
    let v = *b.get(6).ok_or("画像ヘッダが短すぎます")?;
    let x = if v == 0 {
        b[0] as i32
    } else {
        word(b, 0)? as i16 as i32
    };
    let y = if v == 0 {
        b[2] as i32
    } else {
        word(b, 2)? as i16 as i32
    };
    let (w, h, start) = match v {
        0 => {
            let len = dword(b, 4)? as usize;
            if b.len() != 12 + len * 2 {
                return Err("画像v0のデータ長が不正です".into());
            }
            (b[1] as u32, b[3] as u32, 12)
        }
        1 | 2 => {
            let len = word(b, 7)? as usize;
            if b.len() != 10 + len * 2 {
                return Err(format!("画像v{v}のデータ長が不正です"));
            }
            (b[4] as u32, b[5] as u32, 10)
        }
        3 => {
            let w = word(b, 4)? as i16;
            let h = word(b, 7)? as i16;
            if w < 0 || h < 0 || b.len() < 10 || !(b.len() - 10).is_multiple_of(2) {
                return Err("画像v3の寸法またはデータ長が不正です".into());
            }
            (w as u32, h as u32, 10)
        }
        _ => return Err(format!("未対応の画像形式 v{v}")),
    };
    if w > CANVAS_LIMIT || h > CANVAS_LIMIT {
        return Err("画像の寸法が4096pxの上限を超えました".into());
    }
    Ok((x, y, w, h, start))
}

const PLAYER: [[u8; 3]; 16] = [
    [36, 75, 103],
    [57, 94, 124],
    [76, 113, 145],
    [96, 132, 167],
    [116, 151, 189],
    [136, 171, 211],
    [156, 190, 233],
    [176, 210, 255],
    [123, 88, 3],
    [142, 111, 4],
    [161, 134, 5],
    [180, 157, 7],
    [198, 180, 8],
    [217, 203, 10],
    [236, 226, 11],
    [255, 249, 13],
];
const LIGHTS: [[u8; 3]; 15] = [
    [0x57, 0x65, 0x6f],
    [0x7f, 0x9b, 0xf1],
    [255, 255, 83],
    [255, 33, 29],
    [1, 221, 1],
    [107, 107, 107],
    [155, 155, 155],
    [179, 179, 179],
    [201, 201, 201],
    [223, 223, 223],
    [227, 227, 255],
    [193, 177, 209],
    [77, 77, 77],
    [225, 0, 225],
    [1, 1, 255],
];
fn color(value: u16, translucent: bool) -> Result<Rgba<u8>, String> {
    let (rgb, alpha) = if translucent {
        if value < 0x8020 {
            return Err("半透明色の値が不正です".into());
        }
        let aux = value - 0x8020;
        let code = aux / 31;
        let rgb = if code < 16 {
            PLAYER[code as usize]
        } else if code < 31 {
            LIGHTS[(code - 16) as usize]
        } else {
            let c = code - 31;
            if c >= 1024 {
                return Err("半透明色が範囲外です".into());
            }
            [
                (((c >> 7) & 7) << 5) as u8,
                (((c >> 3) & 15) << 4) as u8,
                ((c & 7) << 5) as u8,
            ]
        };
        (rgb, ((aux % 31 + 1) * 255 / 32) as u8)
    } else if value < 0x8000 {
        (
            [
                (((value >> 10) & 31) << 3) as u8,
                (((value >> 5) & 31) << 3) as u8,
                ((value & 31) << 3) as u8,
            ],
            255,
        )
    } else if value < 0x8010 {
        (PLAYER[(value - 0x8000) as usize], 255)
    } else if value < 0x801f {
        (LIGHTS[(value - 0x8010) as usize], 255)
    } else {
        return Err("通常色が範囲外です".into());
    };
    Ok(Rgba([rgb[0], rgb[1], rgb[2], alpha]))
}

fn decode(b: &[u8]) -> Result<(i32, i32, RgbaImage), String> {
    let (x, y, w, h, start) = geometry(b)?;
    if w == 0 || h == 0 {
        if b.len() != start {
            return Err("空画像に画素データがあります".into());
        }
        return Ok((x, y, RgbaImage::new(0, 0)));
    }
    let mut image = RgbaImage::new(w, h);
    let mut pos = start;
    let mut rows = Vec::new();
    for _ in 0..h {
        let skip = word(b, pos)?;
        pos += 2;
        rows.push(skip & 0x7fff);
        loop {
            let run = word(b, pos)?;
            pos += 2;
            let len = (run & 0x7fff) as usize;
            pos = pos.checked_add(len * 2).ok_or("RLEサイズが範囲外です")?;
            if pos > b.len() {
                return Err("RLEが途中で切れています".into());
            }
            let skip = word(b, pos)?;
            pos += 2;
            if skip == 0 {
                break;
            }
        }
    }
    if pos != b.len() {
        return Err("RLEの行数またはデータ長が不正です".into());
    }
    let left = if b[6] < 2 {
        *rows.iter().min().unwrap() as u32
    } else {
        0
    };
    pos = start;
    for row in 0..h {
        let mut column = (word(b, pos)? & 0x7fff) as u32 - left;
        pos += 2;
        loop {
            let run = word(b, pos)?;
            pos += 2;
            let len = (run & 0x7fff) as u32;
            // Legacy v1 ends some cropped rows with a zero-length run at the original tile edge.
            if len != 0 && column.checked_add(len).is_none_or(|end| end > w) {
                return Err("RLEが画像の行幅を超えています".into());
            }
            for _ in 0..len {
                let mut value = word(b, pos)?;
                // v0 predates the player-color index shift in Standard's reader.
                if b[6] == 0 && (0x8000..=0x800f).contains(&value) {
                    value += 1;
                }
                image.put_pixel(column, row, color(value, run & 0x8000 != 0)?);
                column += 1;
                pos += 2;
            }
            let skip = word(b, pos)? as u32;
            pos += 2;
            if skip == 0 {
                break;
            }
            // 0x8000 is a continuing run with zero gap, not a 32768-pixel gap or EOL.
            column = column
                .checked_add(skip & 0x7fff)
                .ok_or("RLE座標が範囲外です")?;
        }
    }
    Ok((x, y, image))
}

pub fn render_industry_preview(
    registry: &PakRegistry,
    id: &str,
) -> Result<Option<PreviewImage>, ImageError> {
    let Some(source) = registry.images.get(id) else {
        return Ok(None);
    };
    let sprites = source.sprites.as_ref().map_err(|s| ImageError(s.clone()))?;
    if sprites.is_empty() {
        return Ok(None);
    }
    let raster = source.raster.ok_or_else(|| {
        ImageError("タイル幅を判定できません。先にベースPaksetのフォルダを追加してください".into())
    })? as i32;
    let mut ordered: Vec<_> = sprites.iter().collect();
    ordered.sort_by_key(|s| (s.tile_x + s.tile_y, s.tile_x, s.foreground, s.height));
    let mut layers = Vec::new();
    let mut min_x = i32::MAX;
    let mut min_y = i32::MAX;
    let mut max_x = i32::MIN;
    let mut max_y = i32::MIN;
    let mut decoded_bytes = 0usize;
    for sprite in ordered {
        let (x, y, img) = decode(&sprite.body)?;
        if img.width() == 0 || img.height() == 0 {
            continue;
        }
        decoded_bytes += img.as_raw().len();
        if decoded_bytes > MATERIAL_LIMIT {
            return Err(ImageError("デコード画像が128MiBの上限を超えました".into()));
        }
        let x = x + (sprite.tile_x - sprite.tile_y) * raster / 2;
        let y = y + (sprite.tile_x + sprite.tile_y) * raster / 4 - sprite.height * raster;
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        max_x = max_x.max(x + img.width() as i32);
        max_y = max_y.max(y + img.height() as i32);
        layers.push((x, y, img));
    }
    if layers.is_empty() {
        return Ok(None);
    }
    let w = (max_x - min_x) as u32;
    let h = (max_y - min_y) as u32;
    if w > CANVAS_LIMIT || h > CANVAS_LIMIT {
        return Err(ImageError("合成画像が4096×4096pxの上限を超えました".into()));
    }
    let mut canvas = RgbaImage::new(w, h);
    for (x, y, img) in layers {
        image::imageops::overlay(&mut canvas, &img, (x - min_x) as i64, (y - min_y) as i64);
    }
    let mut bounds = (w, h, 0, 0);
    for (x, y, p) in canvas.enumerate_pixels() {
        if p[3] != 0 {
            bounds.0 = bounds.0.min(x);
            bounds.1 = bounds.1.min(y);
            bounds.2 = bounds.2.max(x + 1);
            bounds.3 = bounds.3.max(y + 1);
        }
    }
    if bounds.2 == 0 {
        return Ok(None);
    }
    let canvas = image::imageops::crop_imm(
        &canvas,
        bounds.0,
        bounds.1,
        bounds.2 - bounds.0,
        bounds.3 - bounds.1,
    )
    .to_image();
    let canvas = if canvas.width().max(canvas.height()) > 512 {
        let scale = 512.0 / canvas.width().max(canvas.height()) as f64;
        image::imageops::resize(
            &canvas,
            (canvas.width() as f64 * scale).round().max(1.0) as u32,
            (canvas.height() as f64 * scale).round().max(1.0) as u32,
            image::imageops::FilterType::Nearest,
        )
    } else {
        canvas
    };
    let width = canvas.width();
    let height = canvas.height();
    let mut out = Cursor::new(Vec::new());
    canvas
        .write_to(&mut out, image::ImageFormat::Png)
        .map_err(|e| ImageError(e.to_string()))?;
    Ok(Some(PreviewImage {
        png: out.into_inner(),
        width,
        height,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extraction_enforces_material_budget_without_partial_retention() {
        fn node<'a>(tag: &'a [u8], body: &'a [u8], children: Vec<Node<'a>>) -> Node<'a> {
            Node {
                index: 0,
                tag,
                body,
                children,
            }
        }
        let pixels = body(3, 1, 1, &[0, 1, 0x7c00, 0]);
        let mut building = vec![0; 24];
        building[..2].copy_from_slice(&0x8005u16.to_le_bytes());
        building[10] = 1;
        building[12] = 1;
        building[14] = 1;
        let tile = node(
            b"TILE",
            &[2, 128, 1, 0, 0, 0, 1],
            vec![
                node(
                    b"IMG2",
                    &[1, 0],
                    vec![node(
                        b"IMG1",
                        &[1, 0],
                        vec![node(b"IMG\0", &pixels, vec![])],
                    )],
                ),
                node(b"IMG2", &[0, 0], vec![]),
            ],
        );
        let building = node(
            b"BUIL",
            &building,
            vec![
                node(b"TEXT", b"test\0", vec![]),
                node(b"TEXT", b"test\0", vec![]),
                tile,
            ],
        );
        let mut budget = pixels.len() - 1;
        assert!(extract_building(&building, &mut budget)
            .unwrap_err()
            .contains("128MiB"));
        assert_eq!(budget, pixels.len() - 1);
        let mut budget = pixels.len();
        assert_eq!(extract_building(&building, &mut budget).unwrap().len(), 1);
        assert_eq!(budget, 0);
    }
    fn body(v: u8, w: u16, h: u16, words: &[u16]) -> Vec<u8> {
        let mut b = vec![0; 10];
        if v == 1 {
            b[4] = w as u8;
            b[5] = h as u8;
            b[7..9].copy_from_slice(&(words.len() as u16).to_le_bytes());
        } else {
            b[4..6].copy_from_slice(&w.to_le_bytes());
            b[7..9].copy_from_slice(&h.to_le_bytes());
        }
        b[6] = v;
        for word in words {
            b.extend(word.to_le_bytes());
        }
        b
    }
    #[test]
    fn decodes_legacy_image_headers_cropping_and_player_color_shift() {
        let words = [5u16, 1, 0x8000, 0];
        let mut legacy = vec![9, 1, 7, 1, 4, 0, 0, 0, 0, 0, 1, 0];
        for w in words {
            legacy.extend(w.to_le_bytes());
        }
        let (x, y, img) = decode(&legacy).unwrap();
        assert_eq!((x, y), (9, 7));
        assert_eq!(*img.get_pixel(0, 0), color(0x8001, false).unwrap());
        for len in 0..legacy.len() {
            assert!(decode(&legacy[..len]).is_err());
        }
        let mut v2 = body(1, 6, 1, &[5, 1, 0x8000, 0]);
        v2[6] = 2;
        let (_, _, img) = decode(&v2).unwrap();
        assert_eq!(img.get_pixel(0, 0)[3], 0);
        assert_eq!(*img.get_pixel(5, 0), color(0x8000, false).unwrap());
        let mut v1 = v2.clone();
        v1[6] = 1;
        let (_, _, img) = decode(&v1).unwrap();
        assert_eq!(*img.get_pixel(0, 0), color(0x8000, false).unwrap());
        v2[7] = 99;
        assert!(decode(&v2).is_err());
    }
    #[test]
    fn decodes_runs_offsets_and_legacy_empty_tail() {
        let mut b = body(3, 3, 1, &[1, 1, 0x7c00, 0]);
        b[..2].copy_from_slice(&(-8i16).to_le_bytes());
        let (x, _, img) = decode(&b).unwrap();
        assert_eq!(x, -8);
        assert_eq!(img.get_pixel(0, 0)[3], 0);
        assert_eq!(*img.get_pixel(1, 0), Rgba([248, 0, 0, 255]));
        let b = body(1, 1, 1, &[5, 1, 0x03e0, 122, 0, 0]);
        let (_, _, img) = decode(&b).unwrap();
        assert_eq!(*img.get_pixel(0, 0), Rgba([0, 248, 0, 255]));
    }
    #[test]
    fn rejects_cut_runs_row_overflow_versions_and_dimensions() {
        for b in [
            body(3, 1, 1, &[0, 2, 0x7c00, 0x7c00, 0]),
            body(3, 1, 1, &[0, 2, 0]),
            body(3, 1, 2, &[0, 1, 0, 0]),
            body(3, 4097, 1, &[]),
            body(4, 1, 1, &[]),
        ] {
            assert!(decode(&b).is_err());
        }
        let mut b = body(3, 1, 1, &[0, 1, 0x7fff, 0]);
        b.pop();
        assert!(decode(&b).is_err());
    }
    #[test]
    fn uses_fixed_player_daylight_and_alpha_colors() {
        assert_eq!(color(0x8000, false).unwrap(), Rgba([36, 75, 103, 255]));
        assert_eq!(color(0x8010, false).unwrap(), Rgba([87, 101, 111, 255]));
        assert_eq!(color(0x8020 + 15, true).unwrap(), Rgba([36, 75, 103, 127]));
        let (_, _, img) = decode(&body(3, 1, 1, &[0, 0x8001, 0x8020 + 15, 0])).unwrap();
        assert_eq!(img.get_pixel(0, 0)[3], 127);
        assert!(color(0x801f, false).is_err());
    }
    #[test]
    fn masked_zero_gaps_continue_across_opaque_and_alpha_runs() {
        let (_, _, img) = decode(&body(
            3,
            3,
            1,
            &[
                0,
                1,
                0x7c00,
                0x8000,
                0x8001,
                0x8020 + 15,
                0x8000,
                1,
                0x001f,
                0,
            ],
        ))
        .unwrap();
        assert_eq!(*img.get_pixel(0, 0), Rgba([248, 0, 0, 255]));
        assert_eq!(*img.get_pixel(1, 0), Rgba([36, 75, 103, 127]));
        assert_eq!(*img.get_pixel(2, 0), Rgba([0, 0, 248, 255]));
        let (_, _, img) = decode(&body(3, 1, 1, &[0x8000, 0x8001, 0x8020 + 15, 0])).unwrap();
        assert_eq!(img.get_pixel(0, 0)[3], 127);
    }
    fn sprite(tx: i32, ty: i32, height: i32, foreground: bool, pixel: u16) -> Sprite {
        Sprite {
            tile_x: tx,
            tile_y: ty,
            height,
            foreground,
            body: body(3, 1, 1, &[0, 1, pixel, 0]),
        }
    }
    fn registry(sprites: Vec<Sprite>, raster: Option<u16>) -> PakRegistry {
        let mut r = PakRegistry::default();
        r.images.insert(
            "industry:test".into(),
            ImageSource {
                raster,
                sprites: Ok(sprites),
            },
        );
        r
    }
    #[test]
    fn composes_tiles_storeys_foreground_and_crops_transparency() {
        let r = registry(
            vec![
                sprite(0, 0, 0, false, 0x7c00),
                sprite(1, 0, 0, false, 0x03e0),
                sprite(0, 0, 1, false, 0x001f),
                sprite(0, 0, 0, true, 0x7fff),
            ],
            Some(4),
        );
        let preview = render_industry_preview(&r, "industry:test")
            .unwrap()
            .unwrap();
        let img = image::load_from_memory(&preview.png).unwrap().to_rgba8();
        assert_eq!((preview.width, preview.height), (3, 6));
        assert_eq!(*img.get_pixel(0, 0), Rgba([0, 0, 248, 255]));
        assert_eq!(*img.get_pixel(0, 4), Rgba([248, 248, 248, 255]));
        assert_eq!(*img.get_pixel(2, 5), Rgba([0, 248, 0, 255]));
        assert_eq!(img.get_pixel(1, 1)[3], 0);
    }
    #[test]
    fn refuses_missing_raster_and_large_canvas_and_scales_to_512() {
        assert!(render_industry_preview(
            &registry(vec![sprite(0, 0, 0, false, 0)], None),
            "industry:test"
        )
        .is_err());
        assert!(render_industry_preview(
            &registry(
                vec![sprite(0, 0, 0, false, 0), sprite(4096, 0, 0, false, 0)],
                Some(4)
            ),
            "industry:test"
        )
        .is_err());
        let p = render_industry_preview(
            &registry(
                vec![sprite(0, 0, 0, false, 0), sprite(300, 0, 0, false, 0)],
                Some(4),
            ),
            "industry:test",
        )
        .unwrap()
        .unwrap();
        assert_eq!(p.width, 512);
        assert!(p.height <= 512);
    }
}
