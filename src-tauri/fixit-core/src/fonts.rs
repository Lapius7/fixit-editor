//! この PC に入っているフォントの一覧(設定の「コードの書体」の選択肢に使う)

use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct FontFamily {
    pub name: String,
    pub mono: bool,
}

/// 家族名の一覧(重複なし・名前順)。等幅かどうかも付ける
pub fn list_families() -> Vec<FontFamily> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    collect(db.faces().map(|f| (f.families.first().map(|x| x.0.clone()), f.monospaced)))
}

fn collect(it: impl Iterator<Item = (Option<String>, bool)>) -> Vec<FontFamily> {
    let mut m: BTreeMap<String, bool> = BTreeMap::new();
    for (name, mono) in it {
        let Some(n) = name else { continue };
        let n = n.trim().to_string();
        // 画面に出せない名前(空・先頭が「.」「@」の内部用)は除く
        if n.is_empty() || n.starts_with('.') || n.starts_with('@') { continue; }
        let e = m.entry(n).or_insert(false);
        *e = *e || mono;
    }
    m.into_iter().map(|(name, mono)| FontFamily { name, mono }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dedup_sort_and_mono_or() {
        let v = collect(
            [
                (Some("Zed".to_string()), false),
                (Some("Arial".to_string()), false),
                (Some("Arial".to_string()), true),
                (Some(".Hidden".to_string()), false),
                (Some("  ".to_string()), false),
                (None, false),
            ]
            .into_iter(),
        );
        assert_eq!(v, vec![
            FontFamily { name: "Arial".into(), mono: true },
            FontFamily { name: "Zed".into(), mono: false },
        ]);
    }
}
