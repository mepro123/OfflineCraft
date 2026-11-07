use crate::core::*;
use crate::util::*;
use base64::Engine;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

pub const MS_CLIENT: &str = "00000000402b5328";
pub const MS_REDIRECT: &str = "https://login.live.com/oauth20_desktop.srf";
const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

// Tokens are protected with Windows DPAPI (bound to the Windows user). Other systems only get base64 (dev builds).
#[cfg(windows)]
fn dpapi(data: &[u8], protect: bool) -> Option<Vec<u8>> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB};
    unsafe {
        let inb = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        let ok = if protect { CryptProtectData(&inb, std::ptr::null(), std::ptr::null(), std::ptr::null(), std::ptr::null(), 0, &mut out) } else { CryptUnprotectData(&inb, std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(), 0, &mut out) };
        if ok == 0 { return None; }
        let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec(); LocalFree(out.pbData as _); Some(v)
    }
}
#[cfg(not(windows))]
fn dpapi(data: &[u8], _protect: bool) -> Option<Vec<u8>> { Some(data.to_vec()) }

pub fn enc_tok(s: &str) -> String { if s.is_empty() { return String::new(); } match dpapi(s.as_bytes(), true) { Some(b) => format!("dp:{}", B64.encode(b)), None => s.to_string() } }
/// Tokens written by the old Electron build ("enc:") cannot be read by another app, so they decode to "" and the account asks to sign in again.
pub fn dec_tok(s: &str) -> String {
    if let Some(r) = s.strip_prefix("dp:") { return B64.decode(r).ok().and_then(|b| dpapi(&b, false)).map(|b| String::from_utf8_lossy(&b).to_string()).unwrap_or_default(); }
    if s.starts_with("enc:") { return String::new(); }
    s.to_string()
}

async fn post_json(c: &C, url: &str, body: &Value) -> R<Value> {
    let r = post_json_raw(c, url, body).await?; let ok = r.status().is_success(); let st = r.status().as_u16();
    let j: Value = serde_json::from_str(&r.text().await.unwrap_or_default()).unwrap_or(json!({}));
    if !ok { return bail(if j["XErr"].is_number() { format!("Xbox error {}", gi(&j, "XErr")) } else if !gs(&j, "errorMessage").is_empty() { gs(&j, "errorMessage") } else if !gs(&j, "error").is_empty() { gs(&j, "error") } else { format!("HTTP {}", st) }); }
    Ok(j)
}
pub async fn ms_token_request(c: &C, extra: &[(&str, String)]) -> R<Value> {
    let mut form = vec![("client_id", MS_CLIENT.to_string()), ("scope", "XboxLive.signin offline_access".into()), ("redirect_uri", MS_REDIRECT.into())]; for (k, v) in extra { form.push((k, v.clone())); }
    let r = c.http.post("https://login.live.com/oauth20_token.srf").form(&form).send().await?;
    let ok = r.status().is_success(); let j: Value = r.json().await.unwrap_or(json!({}));
    if !ok || gs(&j, "access_token").is_empty() { return bail(if !gs(&j, "error_description").is_empty() { gs(&j, "error_description") } else if !gs(&j, "error").is_empty() { gs(&j, "error") } else { "Microsoft sign-in failed".into() }); }
    Ok(j)
}
pub async fn ms_chain(c: &C, live: &str) -> R<Value> {
    let xbl = post_json(c, "https://user.auth.xboxlive.com/user/authenticate", &json!({ "Properties": { "AuthMethod": "RPS", "SiteName": "user.auth.xboxlive.com", "RpsTicket": format!("d={}", live) }, "RelyingParty": "http://auth.xboxlive.com", "TokenType": "JWT" })).await?;
    let xsts = match post_json(c, "https://xsts.auth.xboxlive.com/xsts/authorize", &json!({ "Properties": { "SandboxId": "RETAIL", "UserTokens": [xbl["Token"]] }, "RelyingParty": "rp://api.minecraftservices.com/", "TokenType": "JWT" })).await {
        Ok(x) => x,
        Err(e) => { let m = match e.0.strip_prefix("Xbox error ").and_then(|n| n.parse::<i64>().ok()) { Some(2148916233) => "This Microsoft account has no Xbox profile yet. Sign in once at xbox.com to create one.".to_string(), Some(2148916235) => "Xbox Live is not available in your country.".into(), Some(2148916238) => "This is a child account. An adult must add it to a Microsoft family first.".into(), _ => e.0 }; return bail(m); }
    };
    let uhs = xsts["DisplayClaims"]["xui"][0]["uhs"].as_str().unwrap_or("");
    let mc = post_json(c, "https://api.minecraftservices.com/authentication/login_with_xbox", &json!({ "identityToken": format!("XBL3.0 x={};{}", uhs, gs(&xsts, "Token")) })).await?;
    let pr = c.http.get("https://api.minecraftservices.com/minecraft/profile").bearer_auth(gs(&mc, "access_token")).send().await?;
    if pr.status().as_u16() == 404 { return bail("This Microsoft account does not own Minecraft: Java Edition."); }
    if !pr.status().is_success() { return bail(format!("Could not load your Minecraft profile (HTTP {})", pr.status().as_u16())); }
    let prof: Value = pr.json().await?;
    let sk = arr(&prof, "skins").iter().find(|s| gs(s, "state") == "ACTIVE").cloned();
    let exp = now_ms() + (if gi(&mc, "expires_in") > 0 { gi(&mc, "expires_in") } else { 86400 }) * 1000 - 120000;
    Ok(json!({ "id": prof["id"], "name": prof["name"], "mcToken": mc["access_token"], "mcExpires": exp, "skinUrl": sk.as_ref().map(|s| s["url"].clone()).unwrap_or(Value::Null), "skinModel": if sk.as_ref().map(|s| gs(s, "variant").to_uppercase() == "SLIM").unwrap_or(false) { "slim" } else { "classic" } }))
}
pub async fn ms_auth_window(c: &C) -> R<String> {
    let q = url::form_urlencoded::Serializer::new(String::new()).append_pair("client_id", MS_CLIENT).append_pair("response_type", "code").append_pair("redirect_uri", MS_REDIRECT).append_pair("scope", "XboxLive.signin offline_access").append_pair("prompt", "select_account").finish();
    let url: url::Url = format!("https://login.live.com/oauth20_authorize.srf?{}", q).parse()?;
    if let Some(old) = c.app.get_webview_window("mslogin") { let _ = old.destroy(); }
    let (tx, rx) = tokio::sync::oneshot::channel::<R<String>>(); let tx = Arc::new(parking_lot::Mutex::new(Some(tx))); let tx_nav = tx.clone();
    let mut b = WebviewWindowBuilder::new(&c.app, "mslogin", WebviewUrl::External(url)).title("Sign in with Microsoft").inner_size(520.0, 720.0).center().incognito(true)
        .on_navigation(move |u| {
            if u.as_str().starts_with(MS_REDIRECT) {
                let m: std::collections::HashMap<String, String> = u.query_pairs().into_owned().collect();
                let r = match m.get("code") { Some(code) => Ok(code.clone()), None => Err(E(m.get("error_description").cloned().unwrap_or("Sign-in was cancelled".into()))) };
                if let Some(t) = tx_nav.lock().take() { let _ = t.send(r); } return false;
            } true });
    if let Some(p) = c.app.get_webview_window("main") { b = b.parent(&p)?; }
    let w = b.build()?; let tx_close = tx.clone();
    w.on_window_event(move |ev| { if matches!(ev, WindowEvent::Destroyed | WindowEvent::CloseRequested { .. }) { if let Some(t) = tx_close.lock().take() { let _ = t.send(Err(E("The sign-in window was closed".into()))); } } });
    let r = rx.await.unwrap_or(Err(E("The sign-in window was closed".into()))); let _ = w.destroy(); r
}
pub fn active_ms(s: &Value) -> Option<Value> { let id = gs(s, "activeMs"); if id.is_empty() { return None; } arr(s, "msAccounts").iter().find(|x| gs(x, "id") == id).cloned() }
pub async fn ensure_ms_token(c: &C) -> R<()> {
    let s = c.st(); let aid = gs(&s, "activeMs"); if aid.is_empty() { return Ok(()); }
    let Some(a) = active_ms(&s) else { c.st_mut(|s| s["activeMs"] = json!("")); return Ok(()); };
    if now_ms() < gi(&a, "mcExpires") { return Ok(()); }
    let r: R<()> = async {
        let tok = ms_token_request(c, &[("grant_type", "refresh_token".into()), ("refresh_token", dec_tok(&gs(&a, "refresh")))]).await?;
        let n = ms_chain(c, &gs(&tok, "access_token")).await?;
        c.st_mut(|s| {
            if let Some(acc) = s["msAccounts"].as_array_mut().and_then(|l| l.iter_mut().find(|x| gs(x, "id") == aid)) {
                acc["name"] = n["name"].clone(); acc["mcToken"] = json!(enc_tok(&gs(&n, "mcToken"))); acc["mcExpires"] = n["mcExpires"].clone();
                let ap = acc.get("appliedSkin").cloned().filter(|x| x.is_object());
                let keep = ap.as_ref().map(|ap| exists(c.skin_file(&gs(ap, "id"))) && ((!gs(ap, "url").is_empty() && gs(&n, "skinUrl") == gs(ap, "url")) || now_ms() - gi(ap, "at") < 15 * 60 * 1000)).unwrap_or(false);
                if !keep { acc["skinUrl"] = n["skinUrl"].clone(); acc["skinModel"] = n["skinModel"].clone(); if ap.is_some() { acc.as_object_mut().unwrap().remove("appliedSkin"); } }
                if !gs(&tok, "refresh_token").is_empty() { acc["refresh"] = json!(enc_tok(&gs(&tok, "refresh_token"))); }
            }
            s["username"] = n["name"].clone();
        });
        c.save_settings(); let c2 = c.clone(); tokio::spawn(async move { cache_ms_skins(&c2).await; }); Ok(())
    }.await;
    r.map_err(|e| E(format!("Your Microsoft login expired, please sign in again ({})", e.0)))
}
pub async fn ms_login(c: &C) -> R<Value> {
    let code = ms_auth_window(c).await?; let tok = ms_token_request(c, &[("grant_type", "authorization_code".into()), ("code", code)]).await?; let a = ms_chain(c, &gs(&tok, "access_token")).await?;
    let rec = json!({ "id": a["id"], "name": a["name"], "refresh": enc_tok(&gs(&tok, "refresh_token")), "mcToken": enc_tok(&gs(&a, "mcToken")), "mcExpires": a["mcExpires"], "skinUrl": a["skinUrl"], "skinModel": a["skinModel"] });
    c.st_mut(|s| { let mut l: Vec<Value> = arr(s, "msAccounts").iter().filter(|x| gs(x, "id") != gs(&a, "id")).cloned().collect(); l.push(rec); s["msAccounts"] = json!(l); s["activeMs"] = a["id"].clone(); s["username"] = a["name"].clone(); });
    c.save_settings(); push_state(c); let c2 = c.clone(); tokio::spawn(async move { cache_ms_skins(&c2).await; });
    Ok(json!({ "ok": true, "name": a["name"] }))
}
pub async fn cache_ms_skins(c: &C) {
    let accts = arr(&c.st(), "msAccounts").to_vec(); let mut changed = false;
    for a in accts {
        let url = gs(&a, "skinUrl"); let f = if gs(&a, "skinCache").is_empty() { None } else { Some(c.p(&["skins", "cache", &format!("{}.png", gs(&a, "skinCache"))])) };
        if url.starts_with("https://") && (gs(&a, "skinCacheUrl") != url || f.as_ref().map(|p| !exists(p)).unwrap_or(true)) {
            match get_bytes(c, &url, 3).await {
                Ok(buf) => { let id: String = sha1_hex(url.as_bytes()).chars().take(16).collect(); let _ = std::fs::create_dir_all(c.p(&["skins", "cache"])); let _ = std::fs::write(c.p(&["skins", "cache", &format!("{}.png", id)]), buf);
                    c.st_mut(|s| { if let Some(x) = s["msAccounts"].as_array_mut().and_then(|l| l.iter_mut().find(|x| gs(x, "id") == gs(&a, "id"))) { x["skinCache"] = json!(id); x["skinCacheUrl"] = json!(url); } }); changed = true; }
                Err(e) => c.log(format!("skin cache: {}", e.0)),
            }
        }
    }
    if changed { c.save_settings(); push_state(c); }
}
