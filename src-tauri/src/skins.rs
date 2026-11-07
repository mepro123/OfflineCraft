use crate::auth::*;
use crate::core::*;
use crate::util::*;
use serde_json::{json, Value};
use std::io::Write;

fn skin_paths() -> Vec<String> {
    let mut v = vec!["entity/steve".to_string(), "entity/alex".to_string()];
    for n in ["steve", "ari", "kai", "noor", "sunny", "zuri", "makena", "efe"] { v.push(format!("entity/player/wide/{}", n)); }
    for n in ["alex", "ari", "kai", "noor", "sunny", "zuri", "makena", "efe"] { v.push(format!("entity/player/slim/{}", n)); }
    v.into_iter().map(|p| format!("assets/minecraft/textures/{}.png", p)).collect()
}
pub fn pack_format(mc: &str) -> i64 {
    let p: Vec<i64> = mc.split('.').map(|x| x.parse().unwrap_or(0)).collect(); let (a, b, c) = (p.first().copied().unwrap_or(0), p.get(1).copied().unwrap_or(0), p.get(2).copied().unwrap_or(0));
    if a != 1 { return 46; }
    match b { 0..=8 => 1, 9..=10 => 2, 11..=12 => 3, 13..=14 => 4, 15 => 5, 16 => if c >= 2 { 6 } else { 5 }, 17 => 7, 18 => 8, 19 => if c >= 4 { 13 } else if c >= 3 { 12 } else { 9 }, 20 => if c >= 5 { 32 } else if c >= 3 { 22 } else if c >= 2 { 18 } else { 15 }, 21 => if c >= 4 { 46 } else if c >= 2 { 42 } else { 34 }, _ => 46 }
}
/// Offline accounts cannot have a real skin, so the skin is shown through a tiny resource pack that replaces the default skins (visible to you only).
pub fn apply_skin_pack(c: &Core, inst: &Value) -> R<()> {
    let gd = c.game_dir(inst); let pack = gd.join("resourcepacks").join("OfflineCraft-Skin.zip"); let opt = gd.join("options.txt"); let s = c.st();
    let sk = if gs(&s, "activeMs").is_empty() { s["skins"].get(gs(&s, "username")).cloned() } else { None };
    let mc = gs(inst, "mc"); let p: Vec<i64> = mc.split('.').map(|x| x.parse().unwrap_or(0)).collect(); let legacy = p.first() == Some(&1) && p.get(1).copied().unwrap_or(0) < 13;
    let entry = if legacy { "OfflineCraft-Skin.zip" } else { "file/OfflineCraft-Skin.zip" }.to_string();
    let txt = std::fs::read_to_string(&opt).unwrap_or_default(); let re = regex::Regex::new(r"(?m)^resourcePacks:(\[.*\])\s*$").unwrap();
    let mt = re.captures(&txt).map(|m| m[1].to_string()); let mut list: Vec<String> = vec!["vanilla".into()];
    if let Some(m) = &mt { if let Ok(l) = serde_json::from_str::<Vec<String>>(m) { list = l; } }
    let had = list.contains(&entry); list.retain(|x| x != &entry);
    if let Some(sk) = sk.filter(|sk| exists(c.skin_file(&gs(sk, "id")))) {
        let buf = std::fs::read(c.skin_file(&gs(&sk, "id")))?;
        if let Some(d) = pack.parent() { std::fs::create_dir_all(d)?; }
        let mut z = zip::ZipWriter::new(std::fs::File::create(&pack)?); let o = zip::write::SimpleFileOptions::default();
        z.start_file("pack.mcmeta", o)?; z.write_all(json!({ "pack": { "pack_format": pack_format(&mc), "supported_formats": [1, 999], "description": "OfflineCraft skin" } }).to_string().as_bytes())?;
        for sp in skin_paths() { z.start_file(sp, o)?; z.write_all(&buf)?; }
        z.finish()?; list.push(entry);
    } else { if !had && !exists(&pack) { return Ok(()); } let _ = std::fs::remove_file(&pack); }
    let line = format!("resourcePacks:{}", serde_json::to_string(&list)?);
    let out = if mt.is_some() { re.replace(&txt, regex::NoExpand(&line)).to_string() } else { format!("{}{}\n", if txt.is_empty() { String::new() } else { format!("{}\n", txt.trim_end()) }, line) };
    if out != txt { std::fs::create_dir_all(&gd)?; std::fs::write(&opt, out)?; }
    Ok(())
}
pub fn save_png(c: &Core, buf: &[u8]) -> R<String> {
    if buf.len() < 33 || buf[0..4] != [0x89, 0x50, 0x4e, 0x47] { return bail("That file is not a PNG image."); }
    let w = u32::from_be_bytes(buf[16..20].try_into().unwrap()); let h = u32::from_be_bytes(buf[20..24].try_into().unwrap());
    if w != 64 || (h != 64 && h != 32) { return bail(format!("Skins must be 64×64 (or old 64×32) pixels. This image is {}×{}.", w, h)); }
    let id: String = sha1_hex(buf).chars().take(16).collect(); std::fs::create_dir_all(c.p(&["skins", "lib"]))?; std::fs::write(c.skin_file(&id), buf)?; Ok(id)
}
pub fn skin_entry(c: &Core, id: &str) -> Value { json!({ "id": id, "url": asset_url(&c.skin_file(id)) }) }
pub fn skin_library(c: &Core) -> Value { let mut v = vec![]; if let Ok(rd) = std::fs::read_dir(c.p(&["skins", "lib"])) { for e in rd.flatten() { let n = e.file_name().to_string_lossy().to_string(); if let Some(id) = n.strip_suffix(".png") { v.push(skin_entry(c, id)); } } } json!(v) }
pub fn delete_skin(c: &C, id: &str) -> Value {
    if !regex::Regex::new(r"^[0-9a-f]{8,40}$").unwrap().is_match(id) { return json!({ "err": "Unknown skin" }); }
    let _ = std::fs::remove_file(c.skin_file(id));
    c.st_mut(|s| { if let Some(o) = s["skins"].as_object_mut() { o.retain(|_, sk| gs(sk, "id") != id); } if let Some(l) = s["msAccounts"].as_array_mut() { for a in l { if gs(&a["appliedSkin"], "id") == id { a.as_object_mut().unwrap().remove("appliedSkin"); } } } });
    c.save_settings(); push_state(c); json!({ "ok": true })
}
pub async fn default_steve(c: &C) -> Value {
    let out = c.p(&["cache", "steve-default.png"]);
    let ok_png = |b: &[u8]| b.len() > 100 && b[0..4] == [0x89, 0x50, 0x4e, 0x47] && u32::from_be_bytes(b[16..20].try_into().unwrap()) == 64 && [32u32, 64].contains(&u32::from_be_bytes(b[20..24].try_into().unwrap()));
    if let Ok(b) = std::fs::read(&out) { if ok_png(&b) { return json!(asset_url(&out)); } }
    let _ = std::fs::create_dir_all(c.p(&["cache"]));
    let c2 = c.clone(); let o2 = out.clone();
    let found = blocking(move || -> Option<Vec<u8>> {
        let mut tried = 0;
        for d in std::fs::read_dir(c2.p(&["versions"])).ok()?.flatten() { let n = d.file_name().to_string_lossy().to_string(); let jar = c2.p(&["versions", &n, &format!("{}.jar", n)]); if fsize(&jar) <= 0 || tried > 4 { continue; } tried += 1;
            let mut z = zip::ZipArchive::new(std::fs::File::open(&jar).ok()?).ok()?;
            for ent in ["assets/minecraft/textures/entity/player/wide/steve.png", "assets/minecraft/textures/entity/steve.png"] { if let Ok(mut e) = z.by_name(ent) { let mut b = vec![]; if std::io::Read::read_to_end(&mut e, &mut b).is_ok() { return Some(b); } } } }
        let _ = o2; None
    }).await;
    if let Some(b) = found { if ok_png(&b) { let _ = std::fs::write(&out, &b); return json!(asset_url(&out)); } }
    if let Ok(b) = get_bytes(c, "https://textures.minecraft.net/texture/31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb", 2).await { if ok_png(&b) { let _ = std::fs::write(&out, &b); return json!(asset_url(&out)); } }
    Value::Null
}
pub async fn import_skin_by_name(c: &C, name: &str) -> R<Value> {
    if name.is_empty() || name.len() > 16 || !name.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_') { return bail("That is not a valid Minecraft username."); }
    let r = c.http.get(format!("https://api.mojang.com/users/profiles/minecraft/{}", name)).send().await?;
    if r.status().as_u16() == 404 || r.status().as_u16() == 204 { return bail(format!("No Minecraft player called \"{}\" was found.", name)); }
    if !r.status().is_success() { return bail(format!("Mojang lookup failed (HTTP {})", r.status().as_u16())); }
    let id = gs(&r.json::<Value>().await?, "id"); let prof = get_json(c, &format!("https://sessionserver.mojang.com/session/minecraft/profile/{}", id)).await?;
    let val = arr(&prof, "properties").iter().find(|p| gs(p, "name") == "textures").map(|p| gs(p, "value")).unwrap_or_default();
    use base64::Engine; let dec = base64::engine::general_purpose::STANDARD.decode(val)?; let tex: Value = serde_json::from_slice(&dec)?; let tex = &tex["textures"];
    if !tex["SKIN"].is_object() { return bail(format!("{} uses a default skin (nothing to copy).", name)); }
    let buf = get_bytes(c, &gs(&tex["SKIN"], "url"), 3).await?; let sid = save_png(c, &buf)?; let mut e = skin_entry(c, &sid);
    e["model"] = json!(if gs(&tex["SKIN"]["metadata"], "model") == "slim" { "slim" } else { "classic" }); Ok(e)
}
fn skin_form(c: &Core, id: &str, variant: &str) -> R<reqwest::multipart::Form> {
    let part = reqwest::multipart::Part::bytes(std::fs::read(c.skin_file(id))?).file_name("skin.png").mime_str("image/png")?;
    Ok(reqwest::multipart::Form::new().text("variant", variant.to_string()).part("file", part))
}
pub async fn apply_skin(c: &C, id: &str, model: &str) -> R<Value> {
    if !exists(c.skin_file(id)) { return bail("Pick a skin first."); }
    let variant = if model == "slim" { "slim" } else { "classic" }; let online = !c.st_s("activeMs").is_empty();
    if online {
        ensure_ms_token(c).await?;
        let post = |c: C, id: String, tok: String| async move { c.http.post("https://api.minecraftservices.com/minecraft/profile/skins").bearer_auth(tok).multipart(skin_form(&c, &id, variant)?).send().await.map_err(E::from) };
        let tok = |c: &C| active_ms(&c.st()).map(|a| dec_tok(&gs(&a, "mcToken"))).unwrap_or_default();
        let mut r = post(c.clone(), id.to_string(), tok(c)).await?;
        if r.status().as_u16() == 401 { let cur = c.st_s("activeMs"); c.st_mut(|s| { if let Some(a) = s["msAccounts"].as_array_mut().and_then(|l| l.iter_mut().find(|x| gs(x, "id") == cur)) { a["mcExpires"] = json!(0); } }); ensure_ms_token(c).await?; r = post(c.clone(), id.to_string(), tok(c)).await?; }
        let st = r.status().as_u16();
        if !r.status().is_success() { let t = r.text().await.unwrap_or_default(); let j: Value = serde_json::from_str(&t).unwrap_or(json!({})); let msg = if !gs(&j, "errorMessage").is_empty() { gs(&j, "errorMessage") } else { gs(&j, "error") };
            return bail(match st { 429 => "Mojang says skins are being changed too often. Wait a minute and try again.".to_string(), 401 | 403 => "Mojang refused the login. Sign in again from the account menu at the top right.".into(), _ => format!("Mojang rejected the skin (HTTP {}){}", st, if msg.is_empty() { String::new() } else { format!(": {}", msg) }) }); }
        let j: Value = r.json().await.unwrap_or(json!({})); let sk = arr(&j, "skins").iter().find(|s| gs(s, "state") == "ACTIVE").cloned();
        let aid = c.st_s("activeMs");
        c.st_mut(|s| { if let Some(a) = s["msAccounts"].as_array_mut().and_then(|l| l.iter_mut().find(|x| gs(x, "id") == aid)) {
            if let Some(sk) = &sk { a["skinUrl"] = sk["url"].clone(); a["skinModel"] = json!(if gs(sk, "variant").to_uppercase() == "SLIM" { "slim" } else { "classic" }); }
            a["appliedSkin"] = json!({ "id": id, "model": variant, "at": now_ms(), "url": sk.as_ref().map(|s| gs(s, "url")).unwrap_or_default() }); a["skinCache"] = json!(""); a["skinCacheUrl"] = json!(""); } });
    } else { c.st_mut(|s| { let u = gs(s, "username"); if !s["skins"].is_object() { s["skins"] = json!({}); } s["skins"][u] = json!({ "id": id, "model": variant }); }); }
    c.save_settings(); push_state(c); let c2 = c.clone(); tokio::spawn(async move { cache_ms_skins(&c2).await; });
    Ok(json!({ "ok": true, "online": online }))
}
pub async fn reset_skin(c: &C) -> R<Value> {
    if !c.st_s("activeMs").is_empty() {
        ensure_ms_token(c).await?; let a = active_ms(&c.st()).ok_or(E("No account".into()))?;
        let r = c.http.delete("https://api.minecraftservices.com/minecraft/profile/skins/active").bearer_auth(dec_tok(&gs(&a, "mcToken"))).send().await?;
        if !r.status().is_success() { return bail(format!("Mojang refused (HTTP {})", r.status().as_u16())); }
        let aid = gs(&a, "id");
        c.st_mut(|s| { if let Some(x) = s["msAccounts"].as_array_mut().and_then(|l| l.iter_mut().find(|x| gs(x, "id") == aid)) { x["skinUrl"] = json!(""); x["skinCache"] = json!(""); x["skinCacheUrl"] = json!(""); x.as_object_mut().unwrap().remove("appliedSkin"); } });
    } else { c.st_mut(|s| { let u = gs(s, "username"); if let Some(o) = s["skins"].as_object_mut() { o.remove(&u); } }); }
    c.save_settings(); push_state(c); Ok(json!({ "ok": true }))
}
