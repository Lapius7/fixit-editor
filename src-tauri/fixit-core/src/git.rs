// Git の書き込み・履歴操作。画面からは固定名の操作(cmd)だけを受け、git の引数はここで組み立てる。
// 画面から任意の引数は渡せない(--upload-pack や -c などを通さないため)。
// ブラウザ版の server/gitops.ts と同じ振る舞いにそろえる。
use crate::fs::FsError;
use serde_json::Value;

pub struct Plan {
    pub args: Vec<String>,
    pub ms: u64,
    // true: 標準エラーも結果に混ぜる(書き込み系。エラー文を画面に出すため)
    pub merge: bool,
}

fn bad(m: &str) -> FsError {
    FsError::new(m, 400, "EARG")
}
fn strs(xs: &[&str]) -> Vec<String> {
    xs.iter().map(|s| s.to_string()).collect()
}

// ブランチ名・リモート名。先頭が - だとオプションに読まれるため、ここで断る
fn ref_name(v: &Value, key: &str) -> Result<String, FsError> {
    let s = v[key].as_str().unwrap_or("");
    let ok = !s.is_empty()
        && s.len() <= 200
        && !s.starts_with(['-', '/', '.'])
        && !s.contains("..")
        && !s.contains('\\')
        && !s.chars().any(|c| c.is_control() || c.is_whitespace());
    if ok { Ok(s.to_string()) } else { Err(bad("名前が正しくありません")) }
}
fn hash(v: &Value) -> Result<String, FsError> {
    let s = v["hash"].as_str().unwrap_or("");
    if (4..=40).contains(&s.len()) && s.chars().all(|c| c.is_ascii_hexdigit()) { Ok(s.to_string()) } else { Err(bad("コミットが正しくありません")) }
}
fn one_file(v: &Value) -> Result<String, FsError> {
    let s = v["file"].as_str().unwrap_or("");
    if s.is_empty() || s.len() > 4096 || s.contains('\0') { Err(bad("ファイルが正しくありません")) } else { Ok(s.to_string()) }
}
fn files(v: &Value) -> Result<Vec<String>, FsError> {
    let a = v["files"].as_array().ok_or_else(|| bad("ファイルがありません"))?;
    if a.is_empty() || a.len() > 5000 {
        return Err(bad("ファイルの数が正しくありません"));
    }
    a.iter()
        .map(|x| match x.as_str() {
            Some(s) if !s.is_empty() && s.len() <= 4096 && !s.contains('\0') => Ok(s.to_string()),
            _ => Err(bad("ファイルが正しくありません")),
        })
        .collect()
}

// 複製元の URL。https・ssh・git と、user@host:path の形だけ(file:// や手元のパス、ext:: などは断る)
fn clone_url(v: &Value) -> Result<String, FsError> {
    let s = v["url"].as_str().unwrap_or("").trim();
    let scheme = ["http://", "https://", "ssh://", "git://"].iter().find(|p| s.len() > p.len() && s[..p.len()].eq_ignore_ascii_case(p));
    let url_ok = scheme.map_or(false, |p| s[p.len()..].split_once('/').map_or(false, |(h, rest)| !h.is_empty() && !rest.is_empty()));
    // user@host:path
    let scp_ok = s.split_once('@').and_then(|(u, r)| r.split_once(':').map(|(h, p)| (u, h, p))).map_or(false, |(u, h, p)| {
        let w = |x: &str| !x.is_empty() && x.chars().all(|c| c.is_ascii_alphanumeric() || "_.-".contains(c));
        w(u) && w(h) && !p.is_empty() && !p.starts_with('/')
    });
    let ok = s.len() <= 2048 && !s.starts_with('-') && !s.chars().any(|c| c.is_control() || c.is_whitespace()) && (url_ok || scp_ok);
    if ok { Ok(s.to_string()) } else { Err(bad("URL が正しくありません")) }
}
// 複製先のフォルダ名(今のフォルダの直下に作る)
fn clone_name(v: &Value) -> Result<String, FsError> {
    let s = v["name"].as_str().unwrap_or("");
    let ok = !s.is_empty() && s.len() <= 200 && !s.starts_with(['-', '.']) && !s.contains(['/', '\\']) && !s.chars().any(|c| c.is_control());
    if ok { Ok(s.to_string()) } else { Err(bad("フォルダ名が正しくありません")) }
}

pub fn plan(body: &[u8]) -> Result<Plan, FsError> {
    let v: Value = serde_json::from_slice(body).map_err(|_| bad("要求が正しくありません"))?;
    let cmd = v["cmd"].as_str().unwrap_or("");
    const NET: u64 = 120_000;
    const FAST: u64 = 30_000;
    let (rest, ms, merge): (Vec<String>, u64, bool) = match cmd {
        // 読み取り
        "changes" => (strs(&["status", "--porcelain=v1", "-z", "-uall", "-b"]), FAST, false),
        "log" => (strs(&["log", "--all", "--no-color", "-n", "300", "-z", "--date-order", "--format=%H%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s"]), FAST, false),
        "branches" => (
            strs(&["for-each-ref", "--format=%(refname)%1f%(refname:short)%1f%(upstream:short)%1f%(upstream:track,nobracket)%1f%(HEAD)%1f%(objectname:short)%1f%(subject)", "refs/heads", "refs/remotes"]),
            FAST,
            false,
        ),
        "show" => {
            let mut a = strs(&["show", "--format=", "--name-status", "-z", "-M"]);
            a.push(hash(&v)?);
            (a, FAST, false)
        }
        // ステージ済みの差分をまとめて(AI でコミットメッセージを作るため)
        "staged-stat" => (strs(&["diff", "--cached", "--no-color", "--stat=200", "--summary"]), FAST, false),
        "staged-diff" => (strs(&["diff", "--cached", "--no-color", "-U1", "--no-ext-diff"]), FAST, false),
        "diff" => {
            let f = one_file(&v)?;
            let a = if v["hash"].is_string() {
                let mut a = strs(&["show", "--format=", "--no-color", "-U3"]);
                a.push(hash(&v)?);
                a.extend(strs(&["--", &f]));
                a
            } else if v["untracked"].as_bool() == Some(true) {
                strs(&["diff", "--no-color", "--no-index", "--", "/dev/null", &f])
            } else {
                let mut a = strs(&["diff", "--no-color", "-U3"]);
                if v["staged"].as_bool() == Some(true) {
                    a.push("--cached".into());
                }
                a.extend(strs(&["--", &f]));
                a
            };
            (a, FAST, false)
        }
        // 書き込み
        "stage" => (["add", "-A", "--"].iter().map(|s| s.to_string()).chain(files(&v)?).collect(), FAST, true),
        "unstage" => (["reset", "-q", "--"].iter().map(|s| s.to_string()).chain(files(&v)?).collect(), FAST, true),
        "discard" => (["restore", "--source=HEAD", "--staged", "--worktree", "--"].iter().map(|s| s.to_string()).chain(files(&v)?).collect(), FAST, true),
        "clean" => (["clean", "-fq", "--"].iter().map(|s| s.to_string()).chain(files(&v)?).collect(), FAST, true),
        "commit" => {
            let m = v["message"].as_str().unwrap_or("").trim();
            if m.is_empty() || m.len() > 20_000 || m.contains('\0') {
                return Err(bad("コミットメッセージが正しくありません"));
            }
            (strs(&["commit", "-m", m]), NET, true)
        }
        "checkout" => (vec!["checkout".into(), ref_name(&v, "name")?, "--".into()], FAST, true),
        "branch-create" => {
            let mut a = vec!["checkout".to_string(), "-b".into(), ref_name(&v, "name")?];
            if v["start"].is_string() {
                a.push(ref_name(&v, "start")?);
            }
            (a, FAST, true)
        }
        "branch-delete" => (vec!["branch".into(), if v["force"].as_bool() == Some(true) { "-D" } else { "-d" }.into(), "--".into(), ref_name(&v, "name")?], FAST, true),
        "fetch" => (strs(&["fetch", "--all", "--prune"]), NET, true),
        "pull" => (strs(&["pull", "--ff-only"]), NET, true),
        "push" => {
            if v["setUpstream"].as_bool() == Some(true) {
                let remote = if v["remote"].is_string() { ref_name(&v, "remote")? } else { "origin".into() };
                (vec!["push".into(), "-u".into(), remote, ref_name(&v, "name")?], NET, true)
            } else {
                (strs(&["push"]), NET, true)
            }
        }
        // リポジトリではないフォルダで使う
        "init" => (strs(&["init"]), FAST, true),
        "clone" => (vec!["clone".into(), "--".into(), clone_url(&v)?, clone_name(&v)?], NET * 5, true),
        _ => return Err(bad("この Git 操作は使えません")),
    };
    // 先頭に付ける設定。画面からの値は入らない
    let mut args = strs(&["-c", "core.quotepath=off", "-c", "i18n.logOutputEncoding=UTF-8", "--literal-pathspecs"]);
    args.extend(rest);
    Ok(Plan { args, ms, merge })
}
