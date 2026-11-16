// 拡張機能の検証。サイトが認証した版には、サイトの署名鍵(update.rs の本体更新用とは別の鍵)で署名が付く。
// ここでは、受け取った本文のハッシュ・大きさ・id・版・権限が署名と合うかだけを確かめる。秘密鍵はサイトのサーバーの外へ出ない。
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::io::Read;

/// 署名の検証に使う公開鍵(Ed25519, base64)。鍵を替えるときは新しい鍵を足してから古い鍵を外す(複数を同時に受け付ける)。
/// 公開鍵はサイトの /api/ext/pubkey で確かめられる
pub const PUBKEYS: &[&str] = &["GAxgYocfmv/YyTED3lnFLJp6kP2gJ5JqqsagJHPHyhI="];
/// 拡張機能を取りに行ってよい場所
pub const API_PREFIX: &str = "https://fixit-editor.lapius7.com/api/ext/";
/// 拡張機能 1 つの大きさの上限(サイトの MAX_BUNDLE と同じ)
const MAX_BYTES: u64 = 400_000;

fn hex(d: &[u8]) -> String { Sha256::digest(d).iter().map(|b| format!("{b:02x}")).collect() }

#[derive(Deserialize)]
struct Perms {
    #[serde(rename = "fsRead")] fs_read: bool, #[serde(rename = "fsWrite")] fs_write: bool, network: Vec<String>, exec: Vec<String>,
    // format 2 の権限。format 1 の本文には無い(false 扱い)
    #[serde(default)] ui: bool, #[serde(default, rename = "editorRead")] editor_read: bool, #[serde(default, rename = "editorWrite")] editor_write: bool,
}
#[derive(Deserialize)]
struct Manifest { id: String, version: String, perms: Perms }
#[derive(Deserialize)]
struct Bundle { format: u32, manifest: Manifest }

/// 権限のハッシュ。サイトの permsHash(server/ext.ts)と同じ文字列から作る。
/// format 1 は従来の 4 項目のまま(署名済みの版が変わらないように)。format 2 は新しい権限も含める
fn perms_hash(p: &Perms, format: u32) -> String {
    let (mut n, mut e) = (p.network.clone(), p.exec.clone());
    n.sort(); e.sort();
    let mut s = format!("{{\"fsRead\":{},\"fsWrite\":{},\"network\":{},\"exec\":{}", p.fs_read, p.fs_write, serde_json::to_string(&n).unwrap_or_default(), serde_json::to_string(&e).unwrap_or_default());
    if format >= 2 { s.push_str(&format!(",\"ui\":{},\"editorRead\":{},\"editorWrite\":{}", p.ui, p.editor_read, p.editor_write)); }
    s.push('}');
    hex(s.as_bytes())
}

/// 署名の対象。サイトの signedPayload と同じ並び。format の数字が先頭に入る(v1 と v2 の署名は取り違えられない)
pub fn signed_payload(format: u32, id: &str, version: &str, sha256: &str, size: u64, perms: &str) -> String {
    format!("fixit-ext:v{format}\n{id}\n{version}\n{sha256}\n{size}\n{perms}")
}
/// 失効リストの署名の対象。サイトの revocationPayload と同じ並び(items は並べ替えてから)
pub fn revocation_payload(ts: u64, items: &[String]) -> String {
    let mut v: Vec<&str> = items.iter().map(|s| s.as_str()).collect();
    v.sort_unstable();
    format!("fixit-ext-revoke:v1\n{ts}\n{}", v.join("\n"))
}

fn check_sig(keys: &[&str], payload: &str, sig_b64: &str) -> Result<(), String> {
    let sig: [u8; 64] = STANDARD.decode(sig_b64).map_err(|_| "署名が不正です".to_string())?.try_into().map_err(|_| "署名が不正です".to_string())?;
    let sig = Signature::from_bytes(&sig);
    for k in keys {
        let Ok(raw) = STANDARD.decode(k) else { continue };
        let Ok(raw): Result<[u8; 32], _> = raw.try_into() else { continue };
        let Ok(key) = VerifyingKey::from_bytes(&raw) else { continue };
        if key.verify(payload.as_bytes(), &sig).is_ok() { return Ok(()); }
    }
    Err("署名が合いません".into())
}

/// 受け取った本文 `raw` が、サイトの署名 `sig` と合うか。id・版・権限は本文の中の値を使うので、
/// 本文を書き換えると(ハッシュが変わるので)必ず合わなくなる。返すのは (id, 版)
pub fn verify_bundle_with(keys: &[&str], raw: &[u8], sig_b64: &str) -> Result<(String, String), String> {
    if raw.len() as u64 > MAX_BYTES { return Err("ファイルが大きすぎます".into()); }
    let b: Bundle = serde_json::from_slice(raw).map_err(|_| "拡張機能の形式ではありません".to_string())?;
    if b.format != 1 && b.format != 2 { return Err("対応していない形式です".into()); }
    let m = &b.manifest;
    check_sig(keys, &signed_payload(b.format, &m.id, &m.version, &hex(raw), raw.len() as u64, &perms_hash(&m.perms, b.format)), sig_b64)?;
    Ok((m.id.clone(), m.version.clone()))
}
pub fn verify_bundle(raw: &[u8], sig_b64: &str) -> Result<(String, String), String> { verify_bundle_with(PUBKEYS, raw, sig_b64) }

pub fn verify_revoked_with(keys: &[&str], ts: u64, items: &[String], sig_b64: &str) -> Result<(), String> {
    check_sig(keys, &revocation_payload(ts, items), sig_b64)
}
pub fn verify_revoked(ts: u64, items: &[String], sig_b64: &str) -> Result<(), String> { verify_revoked_with(PUBKEYS, ts, items, sig_b64) }

/// サイトの /api/ext/ 以下から取る(それ以外の場所は断る)
pub fn fetch(url: &str) -> Result<Vec<u8>, String> {
    if !url.starts_with(API_PREFIX) || url.contains("..") { return Err("取得先が不正です".into()); }
    let r = ureq::AgentBuilder::new().timeout_connect(std::time::Duration::from_secs(15)).timeout_read(std::time::Duration::from_secs(30)).build()
        .get(url).call().map_err(|e| match e { ureq::Error::Status(c, _) => format!("status {c}"), e => e.to_string() })?;
    let mut out = Vec::new();
    r.into_reader().take(MAX_BYTES + 1).read_to_end(&mut out).map_err(|e| e.to_string())?;
    if out.len() as u64 > MAX_BYTES { return Err("ファイルが大きすぎます".into()); }
    Ok(out)
}

/// 自作の拡張機能(フォルダ)の fixit-extension.json を読む。読むのはこの 1 ファイルだけ(フォルダ内のほかのファイルや、上の階層は読まない)
pub fn read_local_manifest(dir: &str) -> Result<String, String> {
    let p = std::path::Path::new(dir).join("fixit-extension.json");
    let meta = std::fs::metadata(&p).map_err(|_| "選んだフォルダの直下に fixit-extension.json がありません".to_string())?;
    if !meta.is_file() { return Err("fixit-extension.json がファイルではありません".into()); }
    if meta.len() > MAX_BYTES { return Err("ファイルが大きすぎます".into()); }
    std::fs::read_to_string(&p).map_err(|_| "fixit-extension.json を読めません".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    const BODY: &str = r##"{"format":1,"manifest":{"id":"lap.demo","name":"Demo","version":"1.0.0","description":"","perms":{"fsRead":false,"fsWrite":false,"network":[],"exec":["echo"]},"themes":[],"snippets":[],"commands":[]},"files":{}}"##;
    fn key(n: u8) -> SigningKey { SigningKey::from_bytes(&[n; 32]) }
    fn pubkey(k: &SigningKey) -> String { STANDARD.encode(k.verifying_key().to_bytes()) }
    fn sign(k: &SigningKey, body: &str) -> String {
        let b: Bundle = serde_json::from_str(body).unwrap();
        let p = signed_payload(b.format, &b.manifest.id, &b.manifest.version, &hex(body.as_bytes()), body.len() as u64, &perms_hash(&b.manifest.perms, b.format));
        STANDARD.encode(k.sign(p.as_bytes()).to_bytes())
    }

    #[test]
    fn perms_hash_matches_server() {
        // bun で server/ext.ts の permsHash(権限, format) を計算した値(format 1 は 4 項目のまま、format 2 は新しい権限も含む)
        let p = Perms { fs_read: false, fs_write: false, network: vec![], exec: vec!["echo".into()], ui: false, editor_read: false, editor_write: false };
        assert_eq!(perms_hash(&p, 1), hex(br#"{"fsRead":false,"fsWrite":false,"network":[],"exec":["echo"]}"#));
        let all = Perms { fs_read: true, fs_write: true, network: vec!["api.example.com".into()], exec: vec!["echo".into()], ui: true, editor_read: true, editor_write: true };
        assert_eq!(perms_hash(&all, 2), "2c008a25c099ded16d5d9fac33a761335fcf163f8c2e13695fe78ff36c819891");
        // format 1 の署名には、新しい権限は影響しない(従来の署名のまま通る)
        assert_eq!(perms_hash(&all, 1), hex(br#"{"fsRead":true,"fsWrite":true,"network":["api.example.com"],"exec":["echo"]}"#));
    }
    // format 2 の本文(サーバーの parseBundle が作る形に合わせて手で書いたもの。ハッシュの一致は perms_hash_matches_server が見る)
    const BODY2: &str = r##"{"format":2,"manifest":{"id":"lap.demo","name":"Demo","version":"1.0.0","description":"","perms":{"fsRead":false,"fsWrite":false,"network":[],"exec":[],"ui":true,"editorRead":false,"editorWrite":false},"themes":[],"snippets":[],"commands":[],"main":"extension.js","settings":[],"scriptCommands":[{"id":"go","title":"Go"}],"keybindings":[],"menus":[]},"files":{"extension.js":"exports.activate = () => {};\n"}}"##;
    #[test]
    fn accepts_valid_v2() {
        let k = key(1);
        let (id, v) = verify_bundle_with(&[&pubkey(&k)], BODY2.as_bytes(), &sign(&k, BODY2)).unwrap();
        assert_eq!((id.as_str(), v.as_str()), ("lap.demo", "1.0.0"));
    }
    #[test]
    fn v2_is_bound_to_permissions_and_script() {
        let k = key(1);
        let sig = sign(&k, BODY2);
        let pk = pubkey(&k);
        // 権限を足す・スクリプトを書き換える・format を 1 にして権限ハッシュの対象から外す、はどれも合わなくなる
        for bad in [BODY2.replace(r#""ui":true"#, r#""ui":true,"x":1"#), BODY2.replace(r#""editorWrite":false"#, r#""editorWrite":true"#), BODY2.replace(r#""network":[]"#, r#""network":["evil.example.com"]"#), BODY2.replace("exports.activate = () => {};", "exports.activate = () => { evil() };"), BODY2.replacen(r#""format":2"#, r#""format":1"#, 1)] {
            assert!(verify_bundle_with(&[&pk], bad.as_bytes(), &sig).is_err(), "{bad}");
        }
    }
    #[test]
    fn v1_and_v2_signatures_are_not_interchangeable() {
        // v1 として署名したものを format 2 の本文には使えない(先頭が fixit-ext:v1 / v2 で違う)
        let k = key(1);
        let b: Bundle = serde_json::from_str(BODY2).unwrap();
        let as_v1 = signed_payload(1, &b.manifest.id, &b.manifest.version, &hex(BODY2.as_bytes()), BODY2.len() as u64, &perms_hash(&b.manifest.perms, 1));
        let sig = STANDARD.encode(k.sign(as_v1.as_bytes()).to_bytes());
        assert!(verify_bundle_with(&[&pubkey(&k)], BODY2.as_bytes(), &sig).is_err());
    }
    #[test]
    fn accepts_valid() {
        let k = key(1);
        let (id, v) = verify_bundle_with(&[&pubkey(&k)], BODY.as_bytes(), &sign(&k, BODY)).unwrap();
        assert_eq!((id.as_str(), v.as_str()), ("lap.demo", "1.0.0"));
    }
    #[test]
    fn rejects_tampered_body() {
        let k = key(1); let sig = sign(&k, BODY); let pk = pubkey(&k);
        // 1 文字変える・権限を足す・版を上げる・id を変える
        for bad in [BODY.replace("Demo", "Demx"), BODY.replace(r#""exec":["echo"]"#, r#""exec":["echo","rm"]"#), BODY.replace("1.0.0", "1.0.1"), BODY.replace("lap.demo", "lap.evil"), format!("{BODY} ")] {
            assert!(verify_bundle_with(&[&pk], bad.as_bytes(), &sig).is_err(), "{bad}");
        }
    }
    #[test]
    fn rejects_wrong_key_and_garbage() {
        let (k, other) = (key(1), key(2));
        let sig = sign(&k, BODY);
        assert!(verify_bundle_with(&[&pubkey(&other)], BODY.as_bytes(), &sig).is_err());
        assert!(verify_bundle_with(&[], BODY.as_bytes(), &sig).is_err());
        assert!(verify_bundle_with(&[&pubkey(&k)], BODY.as_bytes(), "").is_err());
        assert!(verify_bundle_with(&[&pubkey(&k)], b"{}", &sig).is_err());
    }
    #[test]
    fn key_rotation_accepts_either() {
        let (old, new) = (key(1), key(2));
        let keys = [pubkey(&old), pubkey(&new)];
        let ks: Vec<&str> = keys.iter().map(|s| s.as_str()).collect();
        assert!(verify_bundle_with(&ks, BODY.as_bytes(), &sign(&new, BODY)).is_ok());
        assert!(verify_bundle_with(&ks, BODY.as_bytes(), &sign(&old, BODY)).is_ok());
    }
    #[test]
    fn revocation_list() {
        let k = key(3);
        let items = vec!["unverify:b.b@1.0.0".to_string(), "block:a.a@1.0.0".to_string()];
        let sig = STANDARD.encode(k.sign(revocation_payload(100, &items).as_bytes()).to_bytes());
        let pk = pubkey(&k);
        assert!(verify_revoked_with(&[&pk], 100, &items, &sig).is_ok());
        // 順番が違っても同じ。項目を減らす・時刻を変えるは不可
        assert!(verify_revoked_with(&[&pk], 100, &[items[1].clone(), items[0].clone()], &sig).is_ok());
        assert!(verify_revoked_with(&[&pk], 100, &items[..1], &sig).is_err());
        assert!(verify_revoked_with(&[&pk], 101, &items, &sig).is_err());
    }
    #[test]
    fn refuses_foreign_url() {
        assert!(fetch("https://example.com/api/ext/list").is_err());
        assert!(fetch("https://fixit-editor.lapius7.com.evil.com/api/ext/x").is_err());
        assert!(fetch("https://fixit-editor.lapius7.com/api/ext/../x").is_err());
    }

    #[test]
    fn local_manifest_reads_only_the_one_file() {
        let d = std::env::temp_dir().join(format!("fx-ext-local-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let ds = d.to_string_lossy().to_string();
        assert!(read_local_manifest(&ds).is_err());
        std::fs::write(d.join("fixit-extension.json"), "{\"a\":1}").unwrap();
        assert_eq!(read_local_manifest(&ds).unwrap(), "{\"a\":1}");
        let _ = std::fs::remove_dir_all(&d);
    }
}
