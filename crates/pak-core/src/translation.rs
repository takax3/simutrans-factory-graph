use std::collections::BTreeMap;

pub fn is_japanese_file(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.ends_with(".tab") && (name.starts_with("ja.") || name.ends_with(".ja.tab"))
}

/// Pakset text files have no language-name header. Comments are skipped when
/// expecting a key, not a value (a translated value may itself start with '#').
pub fn parse_translation(bytes: &[u8]) -> Result<BTreeMap<String, String>, String> {
    let text = std::str::from_utf8(bytes).map_err(|_| "日本語翻訳はUTF-8で保存してください")?;
    let mut lines = text
        .trim_start_matches('\u{feff}')
        .trim_start_matches('§')
        .lines();
    let mut result = BTreeMap::new();
    while let Some(key) = lines.next() {
        if key.starts_with('#') || key.is_empty() {
            continue;
        }
        let value = lines.next().ok_or("翻訳のキーに対応する値がありません")?;
        if !value.is_empty() && key != value {
            result.insert(key.to_owned(), value.replace("\\n", "\n"));
        }
    }
    Ok(result)
}
