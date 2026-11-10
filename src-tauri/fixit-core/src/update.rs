// 自動更新の中身。サーバーが返す更新情報(マニフェスト)の署名と SHA-256 を確かめ、確かめた本体だけを置き換える。
// 署名の鍵は配布側(scripts/release.ts)だけが持つ。ここには公開鍵だけを埋め込む。
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use sha2::{Digest, Sha256};
use std::{fs, io::Read, path::{Path, PathBuf}};

/// 署名の検証に使う公開鍵(Ed25519, base64)。対応する秘密鍵は ~/.config/fixit-release/update-key.pem
pub const PUBKEY_B64: &str = "nHpi3YYsVKY2hBPgYYWUc4GLPwRzUb8CGCNVtOanr3Y=";
/// 本体をダウンロードしてよい場所。マニフェストの url がこれで始まらないものは受け付けない
pub const DOWNLOAD_PREFIX: &str = "https://fixit-editor.lapius7.com/download/";
/// 本体の大きさの上限(これより大きい配布物は受け付けない)
const MAX_BYTES: u64 = 200 * 1024 * 1024;

/// 署名の対象にする文字列。release.ts と同じ並びで作る
pub fn signed_payload(version: &str, sha256: &str, size: u64) -> String {
    format!("fixit-update:v1\n{version}\n{sha256}\n{size}")
}

pub fn verify_with(pubkey_b64: &str, version: &str, sha256: &str, size: u64, sig_b64: &str, data: &[u8]) -> Result<(), String> {
    if data.len() as u64 != size { return Err("大きさが合いません".into()); }
    let got: String = Sha256::digest(data).iter().map(|b| format!("{b:02x}")).collect();
    if !got.eq_ignore_ascii_case(sha256) { return Err("ハッシュが合いません".into()); }
    let key: [u8; 32] = STANDARD.decode(pubkey_b64).map_err(|e| e.to_string())?.try_into().map_err(|_| "公開鍵が不正です".to_string())?;
    let sig: [u8; 64] = STANDARD.decode(sig_b64).map_err(|e| e.to_string())?.try_into().map_err(|_| "署名が不正です".to_string())?;
    let key = VerifyingKey::from_bytes(&key).map_err(|e| e.to_string())?;
    key.verify(signed_payload(version, sha256, size).as_bytes(), &Signature::from_bytes(&sig)).map_err(|_| "署名が合いません".to_string())
}

pub fn verify(version: &str, sha256: &str, size: u64, sig_b64: &str, data: &[u8]) -> Result<(), String> {
    verify_with(PUBKEY_B64, version, sha256, size, sig_b64, data)
}

pub fn download(url: &str) -> Result<Vec<u8>, String> {
    if !url.starts_with(DOWNLOAD_PREFIX) { return Err("ダウンロード先が不正です".into()); }
    let r = ureq::AgentBuilder::new().timeout_connect(std::time::Duration::from_secs(15)).timeout_read(std::time::Duration::from_secs(60)).build()
        .get(url).call().map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    r.into_reader().take(MAX_BYTES + 1).read_to_end(&mut out).map_err(|e| e.to_string())?;
    if out.len() as u64 > MAX_BYTES { return Err("ファイルが大きすぎます".into()); }
    Ok(out)
}

/// 起動ファイル(launcher)を、確かめ済みの新しい中身に置き換える。
/// 途中で失敗したら元に戻す。置き換え前のファイルは `<名前>.old` に残し、次の起動で消す
pub fn swap(launcher: &Path, data: &[u8]) -> Result<(), String> {
    let side = |ext: &str| -> PathBuf { let mut s = launcher.as_os_str().to_owned(); s.push(ext); PathBuf::from(s) };
    let (new, old) = (side(".new"), side(".old"));
    fs::write(&new, data).map_err(|e| format!("書き込めません: {e}"))?;
    let _ = fs::remove_file(&old);
    if let Err(e) = fs::rename(launcher, &old) { let _ = fs::remove_file(&new); return Err(format!("置き換えられません: {e}")); }
    if let Err(e) = fs::rename(&new, launcher) {
        let _ = fs::rename(&old, launcher);
        let _ = fs::remove_file(&new);
        return Err(format!("置き換えられません: {e}"));
    }
    Ok(())
}

/// 前回の更新で残った `.old` を消す
pub fn sweep_old(launcher: &Path) {
    let mut s = launcher.as_os_str().to_owned(); s.push(".old");
    let _ = fs::remove_file(PathBuf::from(s));
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn signed(data: &[u8], version: &str) -> (String, String, String) {
        let sk = SigningKey::from_bytes(&[7u8; 32]);
        let sha: String = Sha256::digest(data).iter().map(|b| format!("{b:02x}")).collect();
        let sig = sk.sign(signed_payload(version, &sha, data.len() as u64).as_bytes());
        (STANDARD.encode(sk.verifying_key().to_bytes()), sha, STANDARD.encode(sig.to_bytes()))
    }

    #[test]
    fn accepts_valid() {
        let d = b"hello exe";
        let (pk, sha, sig) = signed(d, "1.2.3");
        assert!(verify_with(&pk, "1.2.3", &sha, d.len() as u64, &sig, d).is_ok());
    }
    #[test]
    fn rejects_tampered_data_version_size() {
        let d = b"hello exe";
        let (pk, sha, sig) = signed(d, "1.2.3");
        assert!(verify_with(&pk, "1.2.3", &sha, 9, &sig, b"hello exX").is_err());
        assert!(verify_with(&pk, "1.2.4", &sha, 9, &sig, d).is_err());
        assert!(verify_with(&pk, "1.2.3", &sha, 8, &sig, d).is_err());
        let (pk2, _, _) = { let sk = SigningKey::from_bytes(&[8u8; 32]); (STANDARD.encode(sk.verifying_key().to_bytes()), 0, 0) };
        assert!(verify_with(&pk2, "1.2.3", &sha, 9, &sig, d).is_err());
    }
    #[test]
    fn refuses_foreign_url() {
        assert!(download("https://example.com/x.exe").is_err());
        assert!(download("https://fixit-editor.lapius7.com.evil.com/download/x").is_err());
    }
    #[test]
    fn swap_and_rollback() {
        let dir = std::env::temp_dir().join(format!("fixit-swap-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let l = dir.join("L.exe");
        fs::write(&l, b"old").unwrap();
        swap(&l, b"new").unwrap();
        assert_eq!(fs::read(&l).unwrap(), b"new");
        assert_eq!(fs::read(dir.join("L.exe.old")).unwrap(), b"old");
        sweep_old(&l);
        assert!(!dir.join("L.exe.old").exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
