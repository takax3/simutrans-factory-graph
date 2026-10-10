//! Standard PAK format, verified against Simutrans f19fe4c8.
//! Bodies are borrowed; optional preview extraction copies only selected sprite bodies.
use crate::model::{Object, SourceRef};

#[derive(Debug)]
pub(crate) struct Node<'a> {
    pub index: usize,
    pub tag: &'a [u8],
    pub body: &'a [u8],
    pub children: Vec<Node<'a>>,
}

struct Reader<'a> {
    bytes: &'a [u8],
    pos: usize,
    nodes: usize,
    compiler: u32,
}

impl<'a> Reader<'a> {
    fn take(&mut self, len: usize) -> Result<&'a [u8], String> {
        let end = self.pos.checked_add(len).ok_or("サイズが範囲外です")?;
        let data = self
            .bytes
            .get(self.pos..end)
            .ok_or_else(|| format!("PAKが途中で切れています (offset {})", self.pos))?;
        self.pos = end;
        Ok(data)
    }

    fn node(&mut self, depth: usize, keep: bool) -> Result<Node<'a>, String> {
        self.nodes += 1;
        if depth > 128 || self.nodes > 1_000_000 {
            return Err("PAKの深度またはノード数が安全上限を超えています".into());
        }
        let head = self.take(8)?;
        let count = u16_at(head, 4)?;
        let short_len = u16_at(head, 6)?;
        let len = if short_len == 0xffff && self.compiler != 1001 {
            u32::from_le_bytes(self.take(4)?.try_into().unwrap()) as usize
        } else {
            short_len as usize
        };
        let body = self.take(len)?;
        let tag = &head[..4];
        let retain = keep || tag == b"ROOT" || tag == b"FACT" || tag == b"GOOD" || tag == b"GRND";
        let mut children = Vec::new();
        for index in 0..count {
            let mut child = self.node(depth + 1, retain && tag != b"ROOT")?;
            child.index = index as usize;
            if retain
                && (tag != b"ROOT"
                    || child.tag == b"FACT"
                    || child.tag == b"GOOD"
                    || child.tag == b"GRND")
            {
                children.push(child);
            }
        }
        Ok(Node {
            index: 0,
            tag,
            body,
            children,
        })
    }
}

fn u16_at(bytes: &[u8], offset: usize) -> Result<u16, String> {
    let data = bytes
        .get(offset..offset + 2)
        .ok_or("ノード本体が短すぎます")?;
    Ok(u16::from_le_bytes(data.try_into().unwrap()))
}

fn version(node: &Node, lengths: &[usize]) -> Result<u16, String> {
    let v = u16_at(node.body, 0)?;
    let v = if v & 0x8000 != 0 { v & 0x7fff } else { 0 };
    let min_len = lengths.get(v as usize).ok_or_else(|| {
        format!(
            "未対応の {} バージョン {} (Extendedは対象外)",
            String::from_utf8_lossy(node.tag),
            v
        )
    })?;
    if node.body.len() < *min_len {
        return Err("ノード本体が短すぎます".into());
    }
    Ok(v)
}

fn text(body: &[u8]) -> Result<String, String> {
    let end = body
        .iter()
        .position(|v| *v == 0)
        .ok_or("文字列の終端がありません")?;
    if end == 0 {
        return Err("オブジェクト名が空です".into());
    }
    let bytes = &body[..end];
    Ok(match std::str::from_utf8(bytes) {
        Ok(s) => s.to_owned(),
        Err(_) => bytes.iter().map(|b| char::from(*b)).collect(),
    })
}

fn name(node: &Node) -> Result<String, String> {
    let child = node.children.first().ok_or("名前ノードがありません")?;
    if child.tag != b"TEXT" {
        return Err("名前ノードがTEXTではありません".into());
    }
    text(child.body)
}

fn good_ref(node: &Node, input: bool) -> Result<String, String> {
    if input {
        // The writer includes a two-byte unused tail; old readers consume six.
        if node.tag != b"FSUP" || ![6, 8].contains(&node.body.len()) {
            return Err("未対応または不正なFSUPノードです".into());
        }
    } else {
        if node.tag != b"FPRO" {
            return Err("FPROノードがありません".into());
        }
        version(node, &[4, 6])?;
    }
    let xref = node.children.first().ok_or("貨物参照がありません")?;
    if xref.tag != b"XREF" || xref.body.get(..4) != Some(b"GOOD") || xref.body.len() < 6 {
        return Err("貨物のXREFが不正です".into());
    }
    Ok(format!("goods:{}", text(&xref.body[5..])?))
}

pub fn parse_pak(bytes: &[u8], source: &SourceRef) -> Result<Vec<Object>, String> {
    parse_impl(bytes, source, None).map(|p| p.0)
}

pub(crate) type ParsedAssets = (
    Vec<Object>,
    std::collections::BTreeMap<String, crate::preview::ImageSource>,
    Option<u16>,
);
pub(crate) fn parse_pak_assets(
    bytes: &[u8],
    source: &SourceRef,
    budget: &mut usize,
) -> Result<ParsedAssets, String> {
    parse_impl(bytes, source, Some(budget))
}
fn parse_impl(
    bytes: &[u8],
    source: &SourceRef,
    mut budget: Option<&mut usize>,
) -> Result<ParsedAssets, String> {
    let header_end = bytes
        .iter()
        .take(4096)
        .position(|v| *v == 0x1a)
        .ok_or("PAKヘッダの終端がありません")?;
    let mut reader = Reader {
        bytes,
        pos: header_end + 1,
        nodes: 0,
        compiler: 0,
    };
    reader.compiler = u32::from_le_bytes(reader.take(4)?.try_into().unwrap());
    if !(1001..=1003).contains(&reader.compiler) {
        return Err(format!("未対応のPAKコンパイラ形式 {}", reader.compiler));
    }
    let root = reader.node(0, false)?;
    // Standard reads one ROOT and ignores trailing bytes (seen in Japan 120.0).
    // Individual objects can also be written without a ROOT wrapper.
    let objects = if root.tag == b"ROOT" {
        root.children
    } else if root.tag == b"FACT" || root.tag == b"GOOD" || root.tag == b"GRND" {
        vec![root]
    } else {
        Vec::new()
    };
    let mut result = Vec::new();
    let mut images = std::collections::BTreeMap::new();
    let mut raster = None;
    for node in &objects {
        if node.tag == b"GRND" {
            if name(node).is_ok_and(|n| n == "Outside") {
                raster = crate::preview::outside_width(node).ok();
            }
            continue;
        }
        let index = node.index;
        let parsed = (|| {
            let (kind, internal_name, v, inputs, outputs) = if node.tag == b"FACT" {
                let v = version(node, &[16, 18, 18, 38, 43, 80, 81])?;
                let building = node.children.first().ok_or("産業のBuildingがありません")?;
                if building.tag != b"BUIL" {
                    return Err("産業の先頭がBuildingではありません".into());
                }
                let internal_name = name(building)?;
                let input_count = u16_at(node.body, 12)? as usize;
                let output_count = u16_at(node.body, 14)? as usize;
                if node.children.len() < 2 + input_count + output_count {
                    return Err("産業の入力・出力ノードが不足しています".into());
                }
                let inputs = node.children[2..2 + input_count]
                    .iter()
                    .map(|n| good_ref(n, true))
                    .collect::<Result<Vec<_>, _>>()?;
                let outputs = node.children[2 + input_count..2 + input_count + output_count]
                    .iter()
                    .map(|n| good_ref(n, false))
                    .collect::<Result<Vec<_>, _>>()?;
                ("industry", internal_name, v, inputs, outputs)
            } else {
                let v = version(node, &[4, 8, 10, 10, 16])?;
                ("goods", name(node)?, v, Vec::new(), Vec::new())
            };
            let mut source = source.clone();
            source.object_index = index;
            Ok(Object {
                id: format!("{kind}:{internal_name}"),
                display_name: internal_name.clone(),
                internal_name,
                kind: kind.into(),
                version: v,
                category_id: if kind == "goods" {
                    Some(match v {
                        0 => u16_at(node.body, 2)? as u8,
                        1 | 2 => u16_at(node.body, 4)? as u8,
                        3 => node.body[4],
                        4 => node.body[10],
                        _ => unreachable!(),
                    })
                } else {
                    None
                },
                category_name: None,
                inputs,
                outputs,
                source,
                overridden: Vec::new(),
            })
        })();
        let object = parsed.map_err(|e: String| format!("オブジェクト {index}: {e}"))?;
        if object.kind == "industry" {
            if let Some(remaining) = budget.as_deref_mut() {
                images.insert(
                    format!("{}:{}", object.id, object.source.object_index),
                    crate::preview::ImageSource {
                        raster: None,
                        sprites: crate::preview::extract_building(&node.children[0], remaining),
                    },
                );
            }
        }
        result.push(object);
    }
    Ok((result, images, raster))
}
