// GitHub Copilot のログイン(デバイスフロー)。github.com は CORS を許さないので、この 2 手だけネイティブ側で行う。
// トークンの交換と会話は、ブラウザ側(providers.ts)から api.github.com / api.githubcopilot.com へ直接送る。
// 返すのは、画面に出す短いコードと、ログインが終わったときのトークンだけ。他のアプリの保存先は読まない。
use serde_json::{json, Value};
use std::io::Read;
use std::time::Duration;

// GitHub Copilot のエディタ向け拡張が使う OAuth アプリの ID(公開されている値)
pub const CLIENT_ID: &str = "Iv1.b507a08c87ecfe98";

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(15)).timeout_read(Duration::from_secs(30)).build()
}

fn post(url: &str, form: &[(&str, &str)]) -> Result<Value, String> {
    let r = agent().post(url).set("Accept", "application/json").set("User-Agent", "Fixit-Editor").send_form(form);
    let resp = match r {
        Ok(x) => x,
        Err(ureq::Error::Status(_, x)) => x,
        Err(_) => return Err("network".into()),
    };
    // 返事は小さい JSON だけ。大きすぎるものは読まない
    let mut buf = Vec::new();
    resp.into_reader().take(65536).read_to_end(&mut buf).map_err(|_| "network".to_string())?;
    serde_json::from_slice::<Value>(&buf).map_err(|_| "network".to_string())
}

// ログイン用のコードを発行する。{ device_code, user_code, verification_uri, interval, expires_in }
pub fn device() -> Result<Value, String> {
    let v = post("https://github.com/login/device/code", &[("client_id", CLIENT_ID), ("scope", "read:user")])?;
    Ok(device_out(&v))
}

// 受け取った値から、画面に必要なものだけを取り出す。足りなければ { error: "other" }
pub fn device_out(v: &Value) -> Value {
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).filter(|x| x.len() <= 256);
    match (s("device_code"), s("user_code"), s("verification_uri")) {
        (Some(d), Some(u), Some(w)) if w.starts_with("https://github.com/") => json!({
            "device_code": d, "user_code": u, "verification_uri": w,
            "interval": v.get("interval").and_then(|x| x.as_u64()).unwrap_or(5).clamp(1, 60),
            "expires_in": v.get("expires_in").and_then(|x| x.as_u64()).unwrap_or(900).min(1800),
        }),
        _ => json!({ "error": "other" }),
    }
}

// ログインが終わったかを 1 回だけ確かめる。{ status: "pending"|"slow"|"denied"|"expired"|"ok"|"other", token? }
pub fn poll(device_code: &str) -> Result<Value, String> {
    if device_code.is_empty() || device_code.len() > 256 {
        return Err("bad".into());
    }
    let v = post(
        "https://github.com/login/oauth/access_token",
        &[("client_id", CLIENT_ID), ("device_code", device_code), ("grant_type", "urn:ietf:params:oauth:grant-type:device_code")],
    )?;
    Ok(poll_out(&v))
}

pub fn poll_out(v: &Value) -> Value {
    if let Some(t) = v.get("access_token").and_then(|x| x.as_str()).filter(|x| !x.is_empty() && x.len() <= 512) {
        return json!({ "status": "ok", "token": t });
    }
    let st = match v.get("error").and_then(|x| x.as_str()) {
        Some("authorization_pending") => "pending",
        Some("slow_down") => "slow",
        Some("access_denied") => "denied",
        Some("expired_token") => "expired",
        _ => "other",
    };
    json!({ "status": st })
}

// ログインで得たトークン(OAuth)を、会話に使う短い期限のトークンに交換する。
// api.github.com は CORS でエディタ用のヘッダーを許さないので、ここ(ネイティブ側)で行う。
// { token, expires_at(UNIX 秒), api(会話の送り先) } か { error: "login"|"nosub"|"network"|"other" }
pub fn token(oauth: &str) -> Result<Value, String> {
    if oauth.is_empty() || oauth.len() > 512 || oauth.chars().any(|c| c.is_control() || c == ' ') {
        return Err("bad".into());
    }
    let r = agent()
        .get("https://api.github.com/copilot_internal/v2/token")
        .set("Authorization", &format!("token {oauth}"))
        .set("Accept", "application/json")
        .set("Editor-Version", concat!("Fixit/", env!("CARGO_PKG_VERSION")))
        .set("Editor-Plugin-Version", concat!("fixit-copilot/", env!("CARGO_PKG_VERSION")))
        .set("User-Agent", concat!("Fixit-Editor/", env!("CARGO_PKG_VERSION")))
        .call();
    let (code, resp) = match r {
        Ok(x) => (x.status(), x),
        Err(ureq::Error::Status(c, x)) => (c, x),
        Err(_) => return Err("network".into()),
    };
    let mut buf = Vec::new();
    resp.into_reader().take(65536).read_to_end(&mut buf).map_err(|_| "network".to_string())?;
    let v = serde_json::from_slice::<Value>(&buf).unwrap_or(Value::Null);
    Ok(token_out(code, &v))
}

pub fn token_out(code: u16, v: &Value) -> Value {
    match code {
        200 => {}
        401 => return json!({ "error": "login" }),
        403 | 404 => return json!({ "error": "nosub" }),
        _ => return json!({ "error": "other" }),
    }
    let t = v.get("token").and_then(|x| x.as_str()).filter(|x| !x.is_empty() && x.len() <= 4096);
    let exp = v.get("expires_at").and_then(|x| x.as_u64()).unwrap_or(0);
    // 送り先は github の copilot の持ち物だけ(個人・会社のプランで違う)
    let api = v.pointer("/endpoints/api").and_then(|x| x.as_str()).filter(|x| api_ok(x)).unwrap_or("https://api.githubcopilot.com");
    match t {
        Some(t) => json!({ "token": t, "expires_at": exp, "api": api }),
        None => json!({ "error": "other" }),
    }
}

fn api_ok(u: &str) -> bool {
    u.len() <= 128 && u.starts_with("https://") && u.trim_start_matches("https://").split('/').next().map_or(false, |h| h == "githubcopilot.com" || h.ends_with(".githubcopilot.com"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn コードの返事から必要な値だけ取り出す() {
        let v = json!({ "device_code": "dc", "user_code": "AB-12", "verification_uri": "https://github.com/login/device", "expires_in": 899, "interval": 5, "extra": 1 });
        let o = device_out(&v);
        assert_eq!(o["user_code"], "AB-12");
        assert_eq!(o["interval"], 5);
        assert!(o.get("extra").is_none());
        // 別のホストの URL は受け付けない
        let bad = json!({ "device_code": "dc", "user_code": "x", "verification_uri": "https://evil.example/" });
        assert_eq!(device_out(&bad)["error"], "other");
    }

    #[test]
    fn 交換の返事を分ける() {
        let ok = json!({ "token": "tid=1;exp=2", "expires_at": 1700000000u64, "endpoints": { "api": "https://api.individual.githubcopilot.com" } });
        let o = token_out(200, &ok);
        assert_eq!(o["token"], "tid=1;exp=2");
        assert_eq!(o["api"], "https://api.individual.githubcopilot.com");
        // 別のホストが書かれていても、既定の送り先にする
        let evil = json!({ "token": "t", "endpoints": { "api": "https://evil.example" } });
        assert_eq!(token_out(200, &evil)["api"], "https://api.githubcopilot.com");
        assert_eq!(token_out(401, &json!({}))["error"], "login");
        assert_eq!(token_out(403, &json!({}))["error"], "nosub");
        assert_eq!(token_out(500, &json!({}))["error"], "other");
    }

    #[test]
    fn ログインの状態を分ける() {
        assert_eq!(poll_out(&json!({ "access_token": "gho_x", "token_type": "bearer" }))["token"], "gho_x");
        assert_eq!(poll_out(&json!({ "error": "authorization_pending" }))["status"], "pending");
        assert_eq!(poll_out(&json!({ "error": "slow_down" }))["status"], "slow");
        assert_eq!(poll_out(&json!({ "error": "access_denied" }))["status"], "denied");
        assert_eq!(poll_out(&json!({ "error": "expired_token" }))["status"], "expired");
        assert_eq!(poll_out(&json!({}))["status"], "other");
    }
}
