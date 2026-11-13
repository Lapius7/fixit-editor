// 言語サーバー(TypeScript・Python・HTML・CSS・PHP・Go・Rust・Ruby・MySQL)を取得して動かす。
// - 一覧: src/editor/lsp/servers.json(ブラウザ版の server/lsp.ts と共有)。画面から受け取るのは id だけで、コマンドやパッケージ名は受け取らない。
// - 取得: npm(sha512 の integrity)・GitHub Releases(sha256)は照合してから置く。go・gem は環境の go install・gem install で作る。
// - 置き場所: Windows の PC フォルダは %LOCALAPPDATA%\Fixit\lsp\<dir>\<版>、WSL は WSL の中の ~/.cache/fixit/lsp/<dir>/<版>(WSL からは Linux 版を使う)。
// - 起動: 標準入出力で LSP を話す。メッセージの枠(Content-Length)は、ここで組み立て・切り出す。
// Tauri に依存しないので、Linux でもテストできる(Linux では WSL も PC も、その場の Linux で動かす)。
use crate::fs::Runner;
use crate::run::{no_window, sq};
use base64::{engine::general_purpose::STANDARD, Engine};
use sha2::{Digest, Sha256, Sha512};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;

pub const REGISTRY: &str = "https://registry.npmjs.org";
const MAX_TGZ: usize = 120 * 1024 * 1024;
const MAX_FRAME: usize = 256 * 1024 * 1024;
const MAX_SEND: usize = 64 * 1024 * 1024;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Kind {
    Wsl,
    Pc,
}
impl Kind {
    pub fn parse(s: &str) -> Option<Kind> {
        match s {
            "wsl" => Some(Kind::Wsl),
            "pc" => Some(Kind::Pc),
            _ => None,
        }
    }
}

// 画面へ渡す出来事。1 件が JSON 文字列 1 つ
pub type Emit = Arc<dyn Fn(String) + Send + Sync>;
fn ev(emit: &Emit, v: serde_json::Value) {
    emit(v.to_string());
}

// ---- 一覧(servers.json) ----
#[derive(serde::Deserialize, Debug, Clone)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum Install {
    NpmNative { pkg: String, exe: String },
    Npm { pkg: String, entry: String, #[serde(default)] deps: bool },
    Github { repo: String, exe: String, assets: HashMap<String, String> },
    Go { pkg: String, exe: String },
    Gem { name: String, exe: String },
}
#[derive(serde::Deserialize, Debug, Clone)]
struct Spec {
    id: String,
    dir: String,
    install: Install,
    args: Vec<String>,
}

fn specs() -> &'static [Spec] {
    static S: OnceLock<Vec<Spec>> = OnceLock::new();
    S.get_or_init(|| serde_json::from_str(include_str!("../../../src/editor/lsp/servers.json")).expect("servers.json"))
}
fn spec_of(id: &str) -> Option<&'static Spec> {
    specs().iter().find(|s| s.id == id)
}
pub fn known(id: &str) -> bool {
    spec_of(id).is_some()
}

// ---- 取得 ----
#[derive(Debug, Clone, PartialEq)]
pub struct Pkg {
    pub version: String,
    pub tarball: String,
    pub integrity: String,
}

pub fn version_ok(v: &str) -> bool {
    !v.is_empty() && v.len() < 40 && v.chars().all(|c| c.is_ascii_alphanumeric() || ".-+".contains(c)) && !v.starts_with('.')
}

// uname / Rust の OS・CPU の名前から、配布物の名前に使う os-cpu(linux-x64 など)を作る
pub fn plat(os: &str, arch: &str) -> Option<String> {
    let o = match os.to_lowercase().as_str() {
        "linux" => "linux",
        "darwin" | "macos" => "darwin",
        "windows" | "win32" => "win32",
        _ => return None,
    };
    let a = match arch.to_lowercase().as_str() {
        "x86_64" | "amd64" | "x64" => "x64",
        "aarch64" | "arm64" => "arm64",
        _ => return None,
    };
    Some(format!("{o}-{a}"))
}

pub fn parse_pkg(json: &str) -> Result<Pkg, String> {
    let v: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let version = v["version"].as_str().unwrap_or("").to_string();
    let tarball = v["dist"]["tarball"].as_str().unwrap_or("").to_string();
    let integrity = v["dist"]["integrity"].as_str().unwrap_or("").to_string();
    if !version_ok(&version) {
        return Err("版の形が正しくありません".into());
    }
    if !tarball.starts_with(&format!("{REGISTRY}/")) {
        return Err("ダウンロード先が npm のレジストリではありません".into());
    }
    if !integrity.starts_with("sha512-") {
        return Err("integrity がありません".into());
    }
    Ok(Pkg { version, tarball, integrity })
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(15))
        .timeout_read(std::time::Duration::from_secs(60))
        .build()
}

fn get_json(url: &str) -> Result<serde_json::Value, String> {
    let body = agent().get(url).set("accept", "application/json").call().map_err(|e| e.to_string())?.into_string().map_err(|e| e.to_string())?;
    serde_json::from_str(&body).map_err(|e| e.to_string())
}

pub fn check_integrity(bytes: &[u8], integrity: &str) -> bool {
    let Some(want) = integrity.strip_prefix("sha512-") else { return false };
    STANDARD.encode(Sha512::digest(bytes)) == want
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

fn download(url: &str, version: &str, emit: &Emit) -> Result<Vec<u8>, String> {
    let r = agent().get(url).call().map_err(|e| e.to_string())?;
    let total: usize = r.header("content-length").and_then(|s| s.parse().ok()).unwrap_or(0);
    let mut rd = r.into_reader();
    let mut out = Vec::with_capacity(total.min(MAX_TGZ));
    let mut buf = [0u8; 65536];
    let mut last = 0usize;
    loop {
        let n = rd.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        out.extend_from_slice(&buf[..n]);
        if out.len() > MAX_TGZ {
            return Err("ダウンロードが大きすぎます".into());
        }
        if out.len() - last > 256 * 1024 {
            last = out.len();
            ev(emit, serde_json::json!({ "k": "state", "s": "download", "done": out.len(), "total": total, "version": version }));
        }
    }
    Ok(out)
}

// tgz を dest へ展開する(先頭の package/ を外す。`..` や絶対パスは拒否し、通常のファイルだけ置く)
pub fn extract_tgz(bytes: &[u8], dest: &Path) -> Result<(), String> {
    let mut ar = tar::Archive::new(flate2::read::GzDecoder::new(bytes));
    for e in ar.entries().map_err(|e| e.to_string())? {
        let mut e = e.map_err(|e| e.to_string())?;
        if !e.header().entry_type().is_file() {
            continue;
        }
        let path = e.path().map_err(|e| e.to_string())?.into_owned();
        let mut comps = path.components();
        comps.next();
        let rel: PathBuf = comps.collect();
        if rel.as_os_str().is_empty() || rel.components().any(|c| !matches!(c, Component::Normal(_))) {
            continue;
        }
        let to = dest.join(&rel);
        if let Some(d) = to.parent() {
            std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
        }
        e.unpack(&to).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// zip の中から、ファイル名(base)が一致する 1 つだけを取り出す(ほかは展開しないので、パスをたどる攻撃も受けない)
pub fn unzip_one(buf: &[u8], base: &str) -> Result<Vec<u8>, String> {
    let bad = || "zip の形が正しくありません".to_string();
    let u16at = |p: usize| buf.get(p..p + 2).map(|b| u16::from_le_bytes([b[0], b[1]]) as usize);
    let u32at = |p: usize| buf.get(p..p + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize);
    let mut e = buf.len().checked_sub(22).ok_or_else(bad)?;
    while u32at(e) != Some(0x0605_4b50) {
        e = e.checked_sub(1).ok_or_else(bad)?;
    }
    let n = u16at(e + 10).ok_or_else(bad)?;
    let mut p = u32at(e + 16).ok_or_else(bad)?;
    for _ in 0..n {
        if u32at(p) != Some(0x0201_4b50) {
            break;
        }
        let (method, csize, usize_) = (u16at(p + 10).ok_or_else(bad)?, u32at(p + 20).ok_or_else(bad)?, u32at(p + 24).ok_or_else(bad)?);
        let (nl, xl, cl, off) = (u16at(p + 28).ok_or_else(bad)?, u16at(p + 30).ok_or_else(bad)?, u16at(p + 32).ok_or_else(bad)?, u32at(p + 42).ok_or_else(bad)?);
        let name = String::from_utf8_lossy(buf.get(p + 46..p + 46 + nl).ok_or_else(bad)?).to_string();
        p += 46 + nl + xl + cl;
        if name.ends_with('/') || name.rsplit('/').next() != Some(base) {
            continue;
        }
        let at = off + 30 + u16at(off + 26).ok_or_else(bad)? + u16at(off + 28).ok_or_else(bad)?;
        let data = buf.get(at..at + csize).ok_or_else(bad)?;
        if usize_ > MAX_TGZ * 2 {
            return Err("zip の中身が正しくありません".into());
        }
        let out = match method {
            0 => data.to_vec(),
            8 => {
                let mut v = Vec::with_capacity(usize_);
                flate2::read::DeflateDecoder::new(data).take(MAX_TGZ as u64 * 2).read_to_end(&mut v).map_err(|e| e.to_string())?;
                v
            }
            _ => return Err("zip の中身が正しくありません".into()),
        };
        if out.len() != usize_ {
            return Err("zip の中身が正しくありません".into());
        }
        return Ok(out);
    }
    Err(format!("zip の中に {base} がありません"))
}

// ---- 置き場所と、動かす先(この PC か WSL の中か) ----
// 起動に要るもの。program と args のあと、cwd(Linux 側の直接起動のとき)で動かす
struct Launch {
    program: String,
    args: Vec<String>,
    env: Vec<(String, String)>,
    // 負荷の計測で、Linux 側の /proc から探すときの目印(起動したファイルのパス)
    key: String,
}

// Windows の exe の WSL フォルダだけ WSL の中で動かす。それ以外は、その場の OS で動かす
#[derive(Clone, Copy, PartialEq, Debug)]
enum Host {
    Local,
    Wsl,
}

fn local_base() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("LOCALAPPDATA").map(|p| PathBuf::from(p).join("Fixit").join("lsp"))
    }
    #[cfg(not(windows))]
    {
        let base = std::env::var_os("XDG_CACHE_HOME").map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".cache")))?;
        Some(base.join("fixit").join("lsp"))
    }
}

fn home() -> Option<String> {
    std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).ok()
}

const NEED_SUFFIX: &str = "が必要です";
const ALL_CODES: [i32; 256] = {
    let mut a = [0i32; 256];
    let mut i = 0;
    while i < 256 {
        a[i] = i as i32;
        i += 1;
    }
    a
};

fn last_line(s: &str) -> String {
    s.trim().lines().last().unwrap_or("").to_string()
}

struct Env {
    host: Host,
    base: String,
    plat: Option<String>,
    // WSL では、ユーザーのシェルが持つ PATH(mise・nvm・Homebrew など)。wsl.exe -e や sh -c はこれを読まない
    path: Option<String>,
}

impl Env {
    fn new(host: Host) -> Result<Env, String> {
        if host == Host::Local {
            let base = local_base().ok_or("保存先が分かりません")?.to_string_lossy().to_string();
            return Ok(Env { host, base, plat: plat(std::env::consts::OS, std::env::consts::ARCH), path: None });
        }
        let out = Runner::Wsl
            .sh("printf '%s\\n%s\\n%s\\n' \"${XDG_CACHE_HOME:-$HOME/.cache}\" \"$(uname -s)\" \"$(uname -m)\"", None, 20_000, 4096, &[0])
            .map_err(|e| e.message)?;
        let text = String::from_utf8_lossy(&out).to_string();
        let mut it = text.lines();
        let base = it.next().unwrap_or("").to_string();
        let (os, arch) = (it.next().unwrap_or(""), it.next().unwrap_or(""));
        if !base.starts_with('/') || base.contains(['\0', '\n']) {
            return Err("WSL のキャッシュの場所が分かりません".into());
        }
        // 対話ログインシェルの PATH を 1 回だけ取る(rc ファイルの出力が混ざるので、目印の行だけ読む)。取れなければ今までどおり
        let path = Runner::Wsl
            .sh("u=${SHELL:-$(getent passwd \"$(id -u)\" | cut -d: -f7)}; \"${u:-/bin/sh}\" -ilc 'printf \"\\n__FXPATH=%s\\n\" \"$PATH\"' 2>/dev/null </dev/null", None, 20_000, 1 << 16, &ALL_CODES)
            .ok()
            .and_then(|o| String::from_utf8_lossy(&o).lines().rev().find_map(|l| l.strip_prefix("__FXPATH=").map(String::from)))
            .filter(|p| !p.is_empty() && p.len() < 8192 && !p.contains(['\0', '\r']) && p.split(':').all(|d| d.starts_with('/')));
        Ok(Env { host, base: format!("{base}/fixit/lsp"), plat: plat(os, arch), path })
    }
    fn join(&self, base: &str, rel: &str) -> String {
        if self.host == Host::Wsl {
            format!("{base}/{rel}")
        } else {
            PathBuf::from(base).join(rel).to_string_lossy().to_string()
        }
    }
    fn pre(&self) -> String {
        self.path.as_ref().map(|p| format!("PATH={}; export PATH; ", sq(p))).unwrap_or_default()
    }
    fn wsl(&self, script: &str, input: Option<Vec<u8>>, ms: u64) -> Result<Vec<u8>, String> {
        Runner::Wsl.sh(&format!("{}{script}", self.pre()), input, ms, 1 << 20, &ALL_CODES).map_err(|e| e.message)
    }
    fn code(&self, script: &str) -> Result<bool, String> {
        Runner::Wsl.sh_code(&format!("{}{script}", self.pre()), None, 20_000, 1024, &ALL_CODES).map(|r| r.1 == 0).map_err(|e| e.message)
    }
    fn exists(&self, path: &str) -> bool {
        if self.host == Host::Wsl {
            self.code(&format!("test -e {}", sq(path))).unwrap_or(false)
        } else {
            Path::new(path).exists()
        }
    }
    // コマンドを動かし、(終了コード, 出力)を返す。WSL では標準エラーも出力に混ぜる
    fn exec(&self, prog: &str, args: &[&str], cwd: Option<&str>, env: &[(&str, &str)], ms: u64) -> Result<(i32, String), String> {
        if self.host == Host::Wsl {
            let envs: String = env.iter().map(|(k, v)| format!("{k}={} ", sq(v))).collect();
            let a: String = args.iter().map(|x| format!(" {}", sq(x))).collect();
            let cd = cwd.map(|d| format!("cd {} && ", sq(d))).unwrap_or_else(|| "cd \"$HOME\" 2>/dev/null; ".into());
            let out = self.wsl(&format!("{cd}{envs}{}{a} 2>&1; echo \"__FXCODE=$?\"", sq(prog)), None, ms)?;
            let text = String::from_utf8_lossy(&out).to_string();
            let at = text.rfind("__FXCODE=").ok_or("コマンドの終了コードを読めません")?;
            let code = text[at + 9..].trim().parse().unwrap_or(1);
            return Ok((code, text[..at].to_string()));
        }
        let mut c = Command::new(prog);
        c.args(args);
        if let Some(d) = cwd.map(String::from).or_else(home) {
            c.current_dir(d);
        }
        for (k, v) in env {
            c.env(k, v);
        }
        let r = crate::run::run(c, None, std::time::Duration::from_millis(ms), 1 << 20).map_err(|e| e.message)?;
        let text = if r.err.trim().is_empty() || r.code == 0 { String::from_utf8_lossy(&r.out).to_string() } else { r.err };
        Ok((r.code, text))
    }
}

impl Env {
    // 版フォルダの中で、起動に使うファイル(あれば取得済み)
    fn launch_in(&self, sp: &Spec, dir: &str) -> Option<Launch> {
        let win = self.host == Host::Local && cfg!(windows);
        let exe = |rel: &str, ext: &str| self.join(dir, &format!("{rel}{}", if win { ext } else { "" }));
        let (l, ok) = match &sp.install {
            Install::NpmNative { exe: e, .. } => {
                let p = exe(e, ".exe");
                (Launch { program: p.clone(), args: sp.args.clone(), env: vec![], key: p.clone() }, p)
            }
            Install::Npm { entry, .. } => {
                let p = self.join(dir, entry);
                let mut args = vec![p.clone()];
                args.extend(sp.args.iter().cloned());
                (Launch { program: "node".into(), args, env: vec![], key: p.clone() }, p)
            }
            Install::Github { exe: e, .. } | Install::Go { exe: e, .. } => {
                let p = exe(e, ".exe");
                (Launch { program: p.clone(), args: sp.args.clone(), env: vec![], key: p.clone() }, p)
            }
            Install::Gem { exe: e, .. } => {
                let p = self.join(&self.join(dir, "bin"), &format!("{e}{}", if win { ".bat" } else { "" }));
                (Launch { program: p.clone(), args: sp.args.clone(), env: vec![("GEM_HOME".into(), dir.into()), ("GEM_PATH".into(), dir.into())], key: p.clone() }, p)
            }
        };
        let mut l = l;
        if let Some(p) = &self.path { l.env.push(("PATH".into(), p.clone())); }
        self.exists(&ok).then_some(l)
    }

    fn versions(&self, root: &str) -> Vec<String> {
        let names: Vec<String> = if self.host == Host::Wsl {
            self.wsl(&format!("ls -1 {} 2>/dev/null", sq(root)), None, 20_000).map(|o| String::from_utf8_lossy(&o).lines().map(String::from).collect()).unwrap_or_default()
        } else {
            std::fs::read_dir(root).map(|rd| rd.flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect()).unwrap_or_default()
        };
        let mut v: Vec<String> = names.into_iter().filter(|n| version_ok(n)).collect();
        v.sort_by_key(|n| ver_key(n));
        v
    }
    // 取得済みで、起動できる一番新しい版
    fn newest(&self, sp: &Spec, root: &str) -> Option<String> {
        self.versions(root).into_iter().rev().find(|v| self.launch_in(sp, &self.join(root, v)).is_some())
    }

    fn fresh_dir(&self, path: &str) -> Result<(), String> {
        if self.host == Host::Wsl {
            self.wsl(&format!("set -e; rm -rf {p}; mkdir -p {p}", p = sq(path)), None, 20_000).map(|_| ())
        } else {
            let _ = std::fs::remove_dir_all(path);
            std::fs::create_dir_all(path).map_err(|e| e.to_string())
        }
    }
    fn put_tgz(&self, tmp: &str, bytes: Vec<u8>) -> Result<(), String> {
        if self.host == Host::Wsl {
            // 標準入力に tgz を渡して、WSL の中で展開する(UNC を通さないので実行権が残る)
            let script = format!("set -e; cd {}; tar xzf - --strip-components=1", sq(tmp));
            self.wsl(&script, Some(bytes), 180_000).map(|_| ())
        } else {
            extract_tgz(&bytes, Path::new(tmp))
        }
    }
    fn put_file(&self, tmp: &str, name: &str, bytes: Vec<u8>) -> Result<(), String> {
        if self.host == Host::Wsl {
            let f = sq(&self.join(tmp, name));
            self.wsl(&format!("set -e; cat > {f}; chmod 755 {f}"), Some(bytes), 180_000).map(|_| ())
        } else {
            let f = Path::new(tmp).join(name);
            std::fs::write(&f, bytes).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o755));
            }
            Ok(())
        }
    }
    // 取得できた tmp を版のフォルダへ移し、古い版を消す(使用中で消せないものは残す)
    fn commit(&self, root: &str, dir: &str, tmp: &str) -> Result<(), String> {
        if self.host == Host::Wsl {
            let (d, t, r) = (sq(dir), sq(tmp), sq(root));
            let script = format!("set -e; rm -rf {d}; mv {t} {d}; for o in {r}/*; do [ \"$o\" = {d} ] || rm -rf \"$o\"; done");
            self.wsl(&script, None, 60_000).map(|_| ())
        } else {
            let _ = std::fs::remove_dir_all(dir);
            std::fs::rename(tmp, dir).map_err(|e| e.to_string())?;
            if let Ok(rd) = std::fs::read_dir(root) {
                for e in rd.flatten() {
                    if e.path() != Path::new(dir) && e.file_name() != ".checked" {
                        let _ = std::fs::remove_dir_all(e.path());
                    }
                }
            }
            Ok(())
        }
    }
    // GitHub・go・gem の最新版の確認は 1 日に 1 回にする(取得に時間がかかり、回数の制限もあるため)
    fn checked_today(&self, stamp: &str) -> bool {
        if self.host == Host::Wsl {
            self.code(&format!("[ -n \"$(find {} -mmin -1440 2>/dev/null)\" ]", sq(stamp))).unwrap_or(false)
        } else {
            std::fs::metadata(stamp).and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).map(|d| d.as_secs() < 24 * 3600).unwrap_or(false)
        }
    }
    fn touch(&self, root: &str, stamp: &str) {
        if self.host == Host::Wsl {
            let _ = self.wsl(&format!("mkdir -p {}; : > {}", sq(root), sq(stamp)), None, 20_000);
        } else {
            let _ = std::fs::create_dir_all(root);
            let _ = std::fs::write(stamp, "");
        }
    }
    // 環境にあるものを使う取得元(Node.js・Go・Ruby)は、先にあるかを確かめる
    fn need(&self, tool: &str) -> Result<(), String> {
        let win = self.host == Host::Local && cfg!(windows);
        let (prog, arg, name): (String, &str, &str) = match tool {
            "node" => ("node".into(), "--version", "Node.js"),
            "npm" => (if win { "npm.cmd" } else { "npm" }.into(), "--version", "Node.js(npm)"),
            "go" => ("go".into(), "version", "Go"),
            _ => (if win { "gem.cmd" } else { "gem" }.into(), "--version", "Ruby(gem)"),
        };
        match self.exec(&prog, &[arg], None, &[], 15_000) {
            Ok((0, _)) => Ok(()),
            _ => Err(format!("{name}{NEED_SUFFIX}(PATH にありません)")),
        }
    }
}

#[derive(Debug)]
struct Info {
    version: String,
    tarball: String,
    integrity: String,
    // GitHub の配布物: (名前, URL, sha256)
    asset: Option<(String, String, String)>,
}

fn npm_latest(pkg: &str) -> Result<Info, String> {
    let body = agent().get(&format!("{REGISTRY}/{pkg}/latest")).set("accept", "application/json").call().map_err(|e| e.to_string())?.into_string().map_err(|e| e.to_string())?;
    let p = parse_pkg(&body)?;
    Ok(Info { version: p.version, tarball: p.tarball, integrity: p.integrity, asset: None })
}

fn latest_of(env: &Env, sp: &Spec) -> Result<Info, String> {
    let none = |version: String| Info { version, tarball: String::new(), integrity: String::new(), asset: None };
    let unsupported = || "この OS には対応していません".to_string();
    match &sp.install {
        Install::NpmNative { pkg, .. } => npm_latest(&pkg.replace("{os}-{cpu}", env.plat.as_deref().ok_or_else(unsupported)?)),
        Install::Npm { pkg, deps, .. } => {
            env.need("node")?;
            if *deps {
                env.need("npm")?;
            }
            npm_latest(pkg)
        }
        Install::Github { repo, assets, .. } => {
            let want = env.plat.as_deref().and_then(|p| assets.get(p)).ok_or_else(unsupported)?;
            let j = get_json(&format!("https://api.github.com/repos/{repo}/releases/latest"))?;
            let tag = j["tag_name"].as_str().unwrap_or("").to_string();
            if !version_ok(&tag) {
                return Err("版の形が正しくありません".into());
            }
            let name = want.replace("{ver}", tag.trim_start_matches('v'));
            let a = j["assets"].as_array().and_then(|v| v.iter().find(|x| x["name"].as_str() == Some(&name))).ok_or(format!("配布物 {name} が見つかりません"))?;
            let url = a["browser_download_url"].as_str().unwrap_or("").to_string();
            if !url.starts_with(&format!("https://github.com/{repo}/releases/download/")) {
                return Err("ダウンロード先が GitHub のリリースではありません".into());
            }
            let sha = a["digest"].as_str().unwrap_or("").strip_prefix("sha256:").filter(|h| h.len() == 64 && h.chars().all(|c| c.is_ascii_hexdigit())).ok_or("配布物の sha256 がありません")?.to_lowercase();
            Ok(Info { version: tag, tarball: String::new(), integrity: String::new(), asset: Some((name, url, sha)) })
        }
        Install::Go { pkg, .. } => {
            env.need("go")?;
            let (code, out) = env.exec("go", &["list", "-m", "-f", "{{.Version}}", &format!("{pkg}@latest")], None, &[], 60_000)?;
            let v = last_line(&out);
            if code != 0 || !version_ok(&v) {
                return Err(if v.is_empty() { "版を調べられません".into() } else { v });
            }
            Ok(none(v))
        }
        Install::Gem { name, .. } => {
            env.need("gem")?;
            let v = get_json(&format!("https://rubygems.org/api/v1/versions/{name}/latest.json"))?["version"].as_str().unwrap_or("").to_string();
            if !version_ok(&v) {
                return Err("版の形が正しくありません".into());
            }
            Ok(none(v))
        }
    }
}

// tmp に取得して置く。置いたあとの形の確認は呼び出し側
fn build(env: &Env, sp: &Spec, info: &Info, tmp: &str, emit: &Emit) -> Result<(), String> {
    let state = |s: &str| ev(emit, serde_json::json!({ "k": "state", "s": s, "done": 0, "total": 0, "version": info.version }));
    match &sp.install {
        Install::NpmNative { .. } | Install::Npm { .. } => {
            state("download");
            let bytes = download(&info.tarball, &info.version, emit)?;
            if !check_integrity(&bytes, &info.integrity) {
                return Err("ダウンロードした内容が、レジストリの integrity と一致しません".into());
            }
            state("install");
            env.put_tgz(tmp, bytes)?;
            // 依存のある配布物(HTML/CSS・PHP)は、展開したあとに依存だけ取得する。ビルドの手順(スクリプト)は動かさない
            if matches!(sp.install, Install::Npm { deps: true, .. }) {
                let npm = if env.host == Host::Local && cfg!(windows) { "npm.cmd" } else { "npm" };
                let (code, out) = env.exec(npm, &["install", "--omit=dev", "--omit=optional", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock"], Some(tmp), &[], 600_000)?;
                if code != 0 {
                    return Err(format!("依存の取得に失敗しました: {}", last_line(&out)));
                }
            }
        }
        Install::Github { exe, .. } => {
            let (name, url, sha) = info.asset.as_ref().ok_or("配布物がありません")?;
            state("download");
            let bytes = download(url, &info.version, emit)?;
            if &sha256_hex(&bytes) != sha {
                return Err("ダウンロードした内容が、GitHub の sha256 と一致しません".into());
            }
            state("install");
            let win = env.host == Host::Local && cfg!(windows);
            let file = format!("{exe}{}", if win { ".exe" } else { "" });
            let bin = if name.ends_with(".gz") {
                let mut v = Vec::new();
                flate2::read::GzDecoder::new(&bytes[..]).take(MAX_TGZ as u64 * 2).read_to_end(&mut v).map_err(|e| e.to_string())?;
                v
            } else if name.ends_with(".zip") {
                unzip_one(&bytes, &file)?
            } else {
                return Err("配布物の形式に対応していません".into());
            };
            env.put_file(tmp, &file, bin)?;
        }
        Install::Go { pkg, .. } => {
            state("install");
            let (code, out) = env.exec("go", &["install", &format!("{pkg}@{}", info.version)], None, &[("GOBIN", tmp)], 900_000)?;
            if code != 0 {
                return Err(format!("go install に失敗しました: {}", last_line(&out)));
            }
        }
        Install::Gem { name, .. } => {
            state("install");
            let gem = if env.host == Host::Local && cfg!(windows) { "gem.cmd" } else { "gem" };
            let bin = env.join(tmp, "bin");
            let (code, out) = env.exec(gem, &["install", name, "-v", &info.version, "--no-document", "--install-dir", tmp, "--bindir", &bin], None, &[], 900_000)?;
            if code != 0 {
                return Err(format!("gem install に失敗しました: {}", last_line(&out)));
            }
        }
    }
    Ok(())
}

// 同じ置き場所(HTML と CSS など同じ配布物を使うもの)は、同時に取らず 1 回で済ませる
fn lock_of(key: String) -> Arc<Mutex<()>> {
    static L: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    L.get_or_init(Default::default).lock().unwrap().entry(key).or_default().clone()
}

// 取得が済んだ版のフォルダを返す(最新を確かめ、なければ取得する。確かめられないときは、取得済みの一番新しいものを使う)
fn ensure(env: &Env, sp: &Spec, emit: &Emit) -> Result<String, String> {
    let root = env.join(&env.base, &sp.dir);
    let _g = lock_of(format!("{:?}|{root}", env.host));
    let _g = _g.lock().unwrap_or_else(|e| e.into_inner());
    let slow = matches!(sp.install, Install::Github { .. } | Install::Go { .. } | Install::Gem { .. });
    let stamp = env.join(&root, ".checked");
    if slow && env.checked_today(&stamp) {
        if let Some(v) = env.newest(sp, &root) {
            return Ok(env.join(&root, &v));
        }
    }
    let info = match latest_of(env, sp) {
        Ok(i) => i,
        Err(e) => {
            if let Some(v) = env.newest(sp, &root) {
                return Ok(env.join(&root, &v));
            }
            return Err(if e.contains(NEED_SUFFIX) || e.contains("対応していません") { e } else { format!("言語サーバーを取得できません: {e}") });
        }
    };
    let dir = env.join(&root, &info.version);
    if env.launch_in(sp, &dir).is_none() {
        if matches!(sp.install, Install::Npm { .. }) {
            env.need("node")?;
        }
        let tmp = format!("{dir}.tmp");
        env.fresh_dir(&tmp)?;
        if let Err(e) = build(env, sp, &info, &tmp, emit) {
            let _ = env.fresh_dir(&tmp).and_then(|_| if env.host == Host::Local { std::fs::remove_dir_all(&tmp).map_err(|e| e.to_string()) } else { env.wsl(&format!("rm -rf {}", sq(&tmp)), None, 20_000).map(|_| ()) });
            return Err(e);
        }
        if env.launch_in(sp, &tmp).is_none() {
            let _ = if env.host == Host::Local { std::fs::remove_dir_all(&tmp).map_err(|e| e.to_string()) } else { env.wsl(&format!("rm -rf {}", sq(&tmp)), None, 20_000).map(|_| ()) };
            return Err("展開した中に言語サーバーがありません".into());
        }
        env.commit(&root, &dir, &tmp)?;
    }
    if slow {
        env.touch(&root, &stamp);
    }
    Ok(dir)
}

fn install(host: Host, sp: &Spec, emit: &Emit) -> Result<Launch, String> {
    let env = Env::new(host)?;
    let dir = ensure(&env, sp, emit)?;
    env.launch_in(sp, &dir).ok_or_else(|| "言語サーバーが見つかりません".to_string())
}

fn ver_key(v: &str) -> Vec<u64> {
    v.split(|c: char| !c.is_ascii_digit()).filter(|s| !s.is_empty()).map(|s| s.parse().unwrap_or(0)).collect()
}
// ---- メッセージの枠 ----
pub fn read_frame<R: BufRead>(r: &mut R) -> Option<String> {
    let mut len: Option<usize> = None;
    loop {
        let mut line = String::new();
        if r.read_line(&mut line).ok()? == 0 {
            return None;
        }
        let l = line.trim_end();
        if l.is_empty() {
            break;
        }
        if let Some((k, v)) = l.split_once(':') {
            if k.eq_ignore_ascii_case("content-length") {
                len = v.trim().parse().ok();
            }
        }
    }
    let n = len?;
    if n > MAX_FRAME {
        return None;
    }
    let mut buf = vec![0u8; n];
    r.read_exact(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf).to_string())
}

pub fn frame(msg: &str) -> Vec<u8> {
    let mut v = format!("Content-Length: {}\r\n\r\n", msg.len()).into_bytes();
    v.extend_from_slice(msg.as_bytes());
    v
}

// ---- プロセス ----
pub struct Server {
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Child>>,
    stopped: AtomicBool,
    // 負荷の計測用。WSL(Windows から wsl.exe 経由)のときだけ、Linux 側で探すための起動パスを持つ
    kind: Kind,
    root: String,
    // 起動したファイルのパス(Launch.key)。cmdline にこれを含むプロセスを探す
    needle: Mutex<String>,
    // 前回の計測(基準の時刻[秒], CPU の使用時間[秒])。差から CPU 使用率を出す
    prev: Mutex<Option<(f64, f64)>>,
}

// 計測結果。cpu は 1 コアを 100% とした使用率(初回は前回がないので None)、mem は常駐メモリのバイト数
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Stat {
    pub cpu: Option<f64>,
    pub mem: u64,
}

// /proc の uptime・stat・statm の文字列から (経過[秒], CPU 時間[秒], 常駐メモリ[バイト]) を読む
pub fn parse_proc(uptime: &str, stat: &str, statm: &str) -> Option<(f64, f64, u64)> {
    let up: f64 = uptime.split_whitespace().next()?.parse().ok()?;
    // comm は括弧で囲まれ、空白や括弧を含みうる。最後の ')' のあとから数える(state が 0 番目、utime は 11、stime は 12)
    let rest = &stat[stat.rfind(')')? + 1..];
    let f: Vec<&str> = rest.split_whitespace().collect();
    let ticks = f.get(11)?.parse::<u64>().ok()? + f.get(12)?.parse::<u64>().ok()?;
    let pages: u64 = statm.split_whitespace().nth(1)?.parse().ok()?;
    Some((up, ticks as f64 / 100.0, pages * 4096))
}

impl Server {
    pub fn send(&self, msg: &str) -> Result<(), String> {
        if msg.len() > MAX_SEND {
            return Err("メッセージが大きすぎます".into());
        }
        let mut g = self.stdin.lock().map_err(|e| e.to_string())?;
        let w = g.as_mut().ok_or("言語サーバーは動いていません")?;
        w.write_all(&frame(msg)).and_then(|_| w.flush()).map_err(|e| e.to_string())
    }
    // いまの CPU 使用率とメモリ。動いていなければ None(重いので、画面は開いているときだけ呼ぶ)
    pub fn stats(&self) -> Option<Stat> {
        let (wall, cpu, mem) = self.sample()?;
        let mut g = self.prev.lock().ok()?;
        let pct = match *g {
            Some((w0, c0)) if wall > w0 => Some(((cpu - c0) / (wall - w0) * 100.0).max(0.0)),
            _ => None,
        };
        *g = Some((wall, cpu));
        Some(Stat { cpu: pct, mem })
    }
    #[cfg(target_os = "linux")]
    fn sample(&self) -> Option<(f64, f64, u64)> {
        let pid = self.child.lock().ok()?.as_ref()?.id();
        let rd = |n: &str| std::fs::read_to_string(format!("/proc/{n}")).ok();
        parse_proc(&rd("uptime")?, &rd(&format!("{pid}/stat"))?, &rd(&format!("{pid}/statm"))?)
    }
    #[cfg(windows)]
    fn sample(&self) -> Option<(f64, f64, u64)> {
        if self.kind == Kind::Wsl {
            return self.sample_wsl();
        }
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Foundation::FILETIME;
        use windows_sys::Win32::System::ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
        use windows_sys::Win32::System::Threading::GetProcessTimes;
        let g = self.child.lock().ok()?;
        let h = g.as_ref()?.as_raw_handle() as windows_sys::Win32::Foundation::HANDLE;
        let z = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
        let (mut c, mut e, mut k, mut u) = (z, z, z, z);
        let t = |f: &FILETIME| ((f.dwHighDateTime as u64) << 32 | f.dwLowDateTime as u64) as f64 / 1e7;
        let mut pm: PROCESS_MEMORY_COUNTERS = unsafe { std::mem::zeroed() };
        pm.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
        // SAFETY: h は生きている子プロセスのハンドル(child のロックを持っている間は閉じられない)
        let ok = unsafe { GetProcessTimes(h, &mut c, &mut e, &mut k, &mut u) != 0 && K32GetProcessMemoryInfo(h, &mut pm, pm.cb) != 0 };
        if !ok {
            return None;
        }
        // 時刻の基準はこのプロセスの経過時間(Linux の uptime の代わり)
        static T0: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
        let wall = T0.get_or_init(std::time::Instant::now).elapsed().as_secs_f64();
        Some((wall, t(&k) + t(&u), pm.WorkingSetSize as u64))
    }
    // Windows の WSL: 子は wsl.exe なので、Linux 側の /proc から、起動パスと作業フォルダが合うプロセスを探して読む
    #[cfg(windows)]
    fn sample_wsl(&self) -> Option<(f64, f64, u64)> {
        let prog = self.needle.lock().ok()?.clone();
        if prog.is_empty() {
            return None;
        }
        let script = format!(
            "r={r}; p={p}; f=; for d in /proc/[0-9]*; do c=$(tr '\\0' ' ' < \"$d/cmdline\" 2>/dev/null) || continue; case \"$c\" in *\"$p\"*) ;; *) continue ;; esac; if [ \"$(readlink \"$d/cwd\" 2>/dev/null)\" = \"$r\" ]; then f=$d; break; fi; [ -n \"$f\" ] || f=$d; done; [ -n \"$f\" ] || exit 1; cat /proc/uptime \"$f/stat\" \"$f/statm\"",
            r = sq(&self.root),
            p = sq(&prog)
        );
        let out = Runner::Wsl.sh(&script, None, 5_000, 8192, &[0]).ok()?;
        let text = String::from_utf8_lossy(&out).to_string();
        let mut it = text.lines();
        parse_proc(it.next()?, it.next()?, it.next()?)
    }
    #[cfg(not(any(target_os = "linux", windows)))]
    fn sample(&self) -> Option<(f64, f64, u64)> {
        None
    }
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::SeqCst);
        if let Ok(mut g) = self.stdin.lock() {
            g.take();
        }
        if let Ok(mut g) = self.child.lock() {
            if let Some(c) = g.as_mut() {
                let _ = c.kill();
            }
        }
    }
}

fn spawn(kind: Kind, root: &str, l: &Launch) -> Result<Child, String> {
    let mut c;
    if cfg!(windows) && kind == Kind::Wsl {
        c = Command::new("wsl.exe");
        c.args(["--cd", root, "-e"]);
        if !l.env.is_empty() {
            c.arg("env");
            for (k, v) in &l.env {
                c.arg(format!("{k}={v}"));
            }
        }
        c.arg(&l.program).args(&l.args);
    } else {
        c = Command::new(&l.program);
        c.args(&l.args).envs(l.env.iter().map(|(k, v)| (k, v))).current_dir(root);
    }
    no_window(&mut c).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    c.spawn().map_err(|e| format!("言語サーバーを起動できません: {e}"))
}

pub fn root_ok(kind: Kind, root: &str) -> bool {
    if root.is_empty() || root.contains(['\0', '\n', '\r']) || root.starts_with('-') {
        return false;
    }
    match kind {
        Kind::Wsl => root.starts_with('/'),
        Kind::Pc => root.starts_with('/') || root.chars().nth(1) == Some(':'),
    }
}

// すぐ返る。取得・起動・受信は別のスレッドで進め、出来事を emit で知らせる。
// 出来事: {"k":"state","s":"prepare|download|install|ready"} / {"k":"msg","m":"<LSP の JSON>"} / {"k":"exit","code":n,"err":"..."} / {"k":"fail","err":"..."}
pub fn start(kind: Kind, server: &str, root: String, emit: Emit) -> Arc<Server> {
    let srv = Arc::new(Server { stdin: Mutex::new(None), child: Mutex::new(None), stopped: AtomicBool::new(false), kind, root: root.clone(), needle: Mutex::new(String::new()), prev: Mutex::new(None) });
    let s2 = srv.clone();
    let sp = spec_of(server).cloned();
    thread::spawn(move || {
        ev(&emit, serde_json::json!({ "k": "state", "s": "prepare" }));
        let Some(sp) = sp else {
            return ev(&emit, serde_json::json!({ "k": "fail", "err": "未対応の言語です" }));
        };
        // Windows 以外では、WSL も PC も、その場の Linux で動かす
        let host = if cfg!(windows) && kind == Kind::Wsl { Host::Wsl } else { Host::Local };
        let launch = install(host, &sp, &emit);
        let launch = match launch {
            Ok(l) => l,
            Err(e) => return ev(&emit, serde_json::json!({ "k": "fail", "err": e })),
        };
        if s2.stopped.load(Ordering::SeqCst) {
            return;
        }
        *s2.needle.lock().unwrap() = launch.key.clone();
        let mut child = match spawn(kind, &root, &launch) {
            Ok(c) => c,
            Err(e) => return ev(&emit, serde_json::json!({ "k": "fail", "err": e })),
        };
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        *s2.stdin.lock().unwrap() = child.stdin.take();
        *s2.child.lock().unwrap() = Some(child);
        if s2.stopped.load(Ordering::SeqCst) {
            s2.stop();
        }
        let tail = Arc::new(Mutex::new(String::new()));
        let t2 = tail.clone();
        thread::spawn(move || {
            let mut r = BufReader::new(stderr);
            let mut line = String::new();
            while r.read_line(&mut line).map(|n| n > 0).unwrap_or(false) {
                let mut g = t2.lock().unwrap();
                g.push_str(&line);
                let n = g.len();
                if n > 2000 {
                    *g = g[n - 2000..].to_string();
                }
                line.clear();
            }
        });
        ev(&emit, serde_json::json!({ "k": "state", "s": "ready" }));
        let mut rd = BufReader::new(stdout);
        while let Some(m) = read_frame(&mut rd) {
            ev(&emit, serde_json::json!({ "k": "msg", "m": m }));
        }
        let code = s2.child.lock().unwrap().take().and_then(|mut c| c.wait().ok()).and_then(|s| s.code());
        let err = tail.lock().unwrap().clone();
        ev(&emit, serde_json::json!({ "k": "exit", "code": code, "err": err, "stopped": s2.stopped.load(Ordering::SeqCst) }));
    });
    srv
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn 枠は_content_length_で切り出す() {
        let mut b = frame("{\"a\":1}");
        b.extend(frame("{\"b\":\"あ\"}"));
        let mut r = Cursor::new(b);
        assert_eq!(read_frame(&mut r).as_deref(), Some("{\"a\":1}"));
        assert_eq!(read_frame(&mut r).as_deref(), Some("{\"b\":\"あ\"}"));
        assert_eq!(read_frame(&mut r), None);
    }

    #[test]
    fn proc_の数字を読む() {
        // comm に空白と括弧が入っていても、最後の ')' から数える。utime=150, stime=50 → 2.0 秒、statm の 2 番目が 25000 ページ
        let stat = "123 (ts (server) x) S 1 123 123 0 -1 4194560 100 0 0 0 150 50 0 0 20 0 8 0 100 1000 25000 18446744073709551615";
        let (up, cpu, mem) = parse_proc("1234.56 5678.9\n", stat, "30000 25000 100 0 0 0 0\n").unwrap();
        assert_eq!((up, cpu, mem), (1234.56, 2.0, 25000 * 4096));
        assert!(parse_proc("x", stat, "1 2").is_none());
        assert!(parse_proc("1.0", "123 no-paren", "1 2").is_none());
    }
    #[test]
    fn 枠の長さはバイト数で数える() {
        assert!(String::from_utf8(frame("あ")).unwrap().starts_with("Content-Length: 3\r\n"));
    }

    #[test]
    fn ヘッダーの大文字小文字と余分な行を許す() {
        let mut r = Cursor::new(b"content-length: 2\r\nContent-Type: x\r\n\r\n{}".to_vec());
        assert_eq!(read_frame(&mut r).as_deref(), Some("{}"));
    }

    #[test]
    fn 巨大な枠は読まない() {
        let mut r = Cursor::new(format!("Content-Length: {}\r\n\r\n", MAX_FRAME + 1).into_bytes());
        assert_eq!(read_frame(&mut r), None);
    }

    #[test]
    fn integrity_を照合する() {
        let d = b"hello";
        let ok = format!("sha512-{}", STANDARD.encode(Sha512::digest(d)));
        assert!(check_integrity(d, &ok));
        assert!(!check_integrity(b"hellp", &ok));
        assert!(!check_integrity(d, "sha1-xxx"));
    }

    #[test]
    fn レジストリの応答を読む() {
        let ok = r#"{"version":"7.0.2","dist":{"tarball":"https://registry.npmjs.org/@typescript/typescript-linux-x64/-/typescript-linux-x64-7.0.2.tgz","integrity":"sha512-abc"}}"#;
        assert_eq!(parse_pkg(ok).unwrap().version, "7.0.2");
        // 別のサーバーを指す tarball と、変な版は受け付けない
        assert!(parse_pkg(&ok.replace("registry.npmjs.org", "evil.example")).is_err());
        assert!(parse_pkg(&ok.replace("7.0.2\",\"dist", "../x\",\"dist")).is_err());
        assert!(parse_pkg(&ok.replace("sha512-abc", "sha1-abc")).is_err());
    }

    #[test]
    fn パッケージ名の_os_と_cpu() {
        assert_eq!(plat("Linux", "x86_64").as_deref(), Some("linux-x64"));
        assert_eq!(plat("Linux", "aarch64").as_deref(), Some("linux-arm64"));
        assert_eq!(plat("windows", "x86_64").as_deref(), Some("win32-x64"));
        assert_eq!(plat("Darwin", "arm64").as_deref(), Some("darwin-arm64"));
        assert_eq!(plat("FreeBSD", "x86_64"), None);
    }

    #[test]
    fn 版は数として並べる() {
        assert!(ver_key("7.0.10") > ver_key("7.0.2"));
        assert!(!version_ok("../a") && !version_ok("") && version_ok("7.0.2-dev.20260101.1"));
    }

    #[test]
    fn 展開は_package_を外し_外へ出るパスを捨てる() {
        let mut tar_bytes = Vec::new();
        {
            let mut b = tar::Builder::new(&mut tar_bytes);
            for (name, data) in [("package/lib/tsc", &b"x"[..]), ("package/lib/a.d.ts", &b"y"[..])] {
                let mut h = tar::Header::new_gnu();
                h.set_size(data.len() as u64);
                h.set_mode(0o644);
                h.set_cksum();
                b.append_data(&mut h, name, data).unwrap();
            }
            b.finish().unwrap();
        }
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        gz.write_all(&tar_bytes).unwrap();
        let tgz = gz.finish().unwrap();
        let dest = std::env::temp_dir().join(format!("fixit-lsp-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dest);
        std::fs::create_dir_all(&dest).unwrap();
        extract_tgz(&tgz, &dest).unwrap();
        assert_eq!(std::fs::read(dest.join("lib/tsc")).unwrap(), b"x");
        assert_eq!(std::fs::read(dest.join("lib/a.d.ts")).unwrap(), b"y");
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[test]
    fn 作業フォルダの形を確かめる() {
        assert!(root_ok(Kind::Wsl, "/home/u/p") && !root_ok(Kind::Wsl, "C:/x") && !root_ok(Kind::Wsl, "-rf"));
        assert!(root_ok(Kind::Pc, "C:/Users/u") && !root_ok(Kind::Pc, "rel/dir") && !root_ok(Kind::Pc, "/a\nb"));
    }

    #[test]
    fn servers_json_の_9_件が読める() {
        let ids: Vec<&str> = specs().iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, ["ts", "py", "html", "css", "php", "go", "rs", "rb", "sql"]);
        assert!(known("rs") && !known("nope") && !known(""));
        // 取得元の種類が、ファイルの書き方どおりに分かれている
        assert!(matches!(spec_of("ts").unwrap().install, Install::NpmNative { .. }));
        assert!(matches!(spec_of("html").unwrap().install, Install::Npm { deps: true, .. }));
        assert!(matches!(spec_of("py").unwrap().install, Install::Npm { deps: false, .. }));
        assert!(matches!(spec_of("rs").unwrap().install, Install::Github { .. }));
        assert!(matches!(spec_of("go").unwrap().install, Install::Go { .. }));
        assert!(matches!(spec_of("rb").unwrap().install, Install::Gem { .. }));
        assert_eq!(spec_of("ts").unwrap().args, ["--lsp", "--stdio"]);
        // 同じ配布物を使う html と css は、置き場所が同じ
        assert_eq!(spec_of("html").unwrap().dir, spec_of("css").unwrap().dir);
    }

    #[test]
    fn sha256_を_16_進で出す() {
        assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    // 1 ファイルだけ入った zip を手で組む(method 8 = deflate)
    fn zip_of(name: &str, data: &[u8], deflate: bool) -> Vec<u8> {
        use std::io::Write;
        let body = if deflate {
            let mut e = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
            e.write_all(data).unwrap();
            e.finish().unwrap()
        } else {
            data.to_vec()
        };
        let m: u16 = if deflate { 8 } else { 0 };
        let mut z = Vec::new();
        z.extend(0x0403_4b50u32.to_le_bytes());
        z.extend([20, 0, 0, 0]);
        z.extend(m.to_le_bytes());
        z.extend([0u8; 4]);
        z.extend(0u32.to_le_bytes());
        z.extend((body.len() as u32).to_le_bytes());
        z.extend((data.len() as u32).to_le_bytes());
        z.extend((name.len() as u16).to_le_bytes());
        z.extend([0, 0]);
        z.extend(name.as_bytes());
        z.extend(&body);
        let cd = z.len();
        z.extend(0x0201_4b50u32.to_le_bytes());
        z.extend([20, 0, 20, 0, 0, 0]);
        z.extend(m.to_le_bytes());
        z.extend([0u8; 4]);
        z.extend(0u32.to_le_bytes());
        z.extend((body.len() as u32).to_le_bytes());
        z.extend((data.len() as u32).to_le_bytes());
        z.extend((name.len() as u16).to_le_bytes());
        z.extend([0u8; 12]);
        z.extend(0u32.to_le_bytes());
        z.extend(name.as_bytes());
        let cdlen = z.len() - cd;
        z.extend(0x0605_4b50u32.to_le_bytes());
        z.extend([0u8; 4]);
        z.extend(1u16.to_le_bytes());
        z.extend(1u16.to_le_bytes());
        z.extend((cdlen as u32).to_le_bytes());
        z.extend((cd as u32).to_le_bytes());
        z.extend([0, 0]);
        z
    }

    #[test]
    fn zip_から名前の合う_1_つを取り出す() {
        let data = b"hello zip hello zip hello zip".repeat(20);
        for deflate in [true, false] {
            let z = zip_of("sqls-linux-0.2.48/sqls", &data, deflate);
            assert_eq!(unzip_one(&z, "sqls").unwrap(), data);
            assert!(unzip_one(&z, "other").is_err());
        }
        // 途中のディレクトリ名とは一致させない
        let z = zip_of("sqls/readme.txt", b"x", false);
        assert!(unzip_one(&z, "sqls").is_err());
        assert!(unzip_one(b"not a zip", "sqls").is_err());
    }

    #[test]
    fn 取得済みの版のフォルダから起動のしかたを作る() {
        let base = std::env::temp_dir().join(format!("fixit-lsp-launch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let env = Env { host: Host::Local, base: base.to_string_lossy().to_string(), plat: Some("linux-x64".into()), path: None };
        let dir = |n: &str| base.join(n).to_string_lossy().to_string();
        let touch = |d: &str, rel: &str| {
            let p = Path::new(d).join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, "").unwrap();
        };
        // 空のフォルダは「取得済み」とみなさない
        assert!(env.launch_in(spec_of("py").unwrap(), &dir("pyright")).is_none());
        // npm: node でスクリプトを動かし、args はそのあとに続く
        touch(&dir("pyright"), "langserver.index.js");
        let l = env.launch_in(spec_of("py").unwrap(), &dir("pyright")).unwrap();
        assert_eq!(l.program, "node");
        assert_eq!(l.args.len(), 2);
        assert!(l.args[0].ends_with("langserver.index.js") && l.args[1] == "--stdio");
        assert_eq!(l.key, l.args[0]);
        // GitHub・go: 実行ファイルをそのまま動かす
        touch(&dir("rust-analyzer"), "rust-analyzer");
        let l = env.launch_in(spec_of("rs").unwrap(), &dir("rust-analyzer")).unwrap();
        assert!(l.program.ends_with("rust-analyzer") && l.args.is_empty() && l.env.is_empty());
        // gem: bin/ の中を動かし、GEM_HOME を版のフォルダに向ける
        touch(&dir("solargraph"), "bin/solargraph");
        let l = env.launch_in(spec_of("rb").unwrap(), &dir("solargraph")).unwrap();
        assert!(l.program.ends_with("bin/solargraph") && l.args == ["stdio"]);
        assert!(l.env.iter().any(|(k, v)| k == "GEM_HOME" && *v == dir("solargraph")));
        // 取得済みの一番新しい版を、数として並べて選ぶ
        for v in ["0.9.0", "0.10.0"] {
            touch(&dir(&format!("gopls/{v}")), "gopls");
        }
        std::fs::create_dir_all(base.join("gopls/.checked")).unwrap();
        assert_eq!(env.newest(spec_of("go").unwrap(), &dir("gopls")).as_deref(), Some("0.10.0"));
        let _ = std::fs::remove_dir_all(&base);
    }
}
