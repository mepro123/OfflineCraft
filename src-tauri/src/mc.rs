use crate::core::*;
use crate::util::*;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

// ---------------------------------------------------------------- minecraft metadata
pub fn vjson_path(c: &Core, id: &str) -> PathBuf { c.p(&["versions", id, &format!("{}.json", id)]) }
pub async fn load_manifest(c: &C) -> Vec<Value> {
    let cache = c.p(&["cache", "version_manifest.json"]);
    let body = match get_json(c, "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json").await {
        Ok(b) => { write_json(&cache, &b); Some(b) }
        Err(e) => { c.log(format!("version manifest download failed: {}", e.0)); read_json_opt(&cache) }
    };
    if let Some(b) = body { *c.manifest.lock() = arr(&b, "versions").iter().map(|v| json!({ "id": v["id"], "type": v["type"], "url": v["url"], "time": v["releaseTime"] })).collect(); }
    c.manifest.lock().clone()
}
pub async fn ensure_vanilla_json(c: &C, id: &str) -> R<bool> {
    if fsize(vjson_path(c, id)) > 0 { return Ok(true); }
    if c.manifest.lock().is_empty() { load_manifest(c).await; }
    let v = c.manifest.lock().iter().find(|x| gs(x, "id") == id).cloned();
    let Some(v) = v else { return Ok(false) };
    download(c, &gs(&v, "url"), &vjson_path(c, id), None).await?; Ok(true)
}
pub fn rules_ok(rules: &Value, custom: bool) -> bool {
    let Some(a) = rules.as_array() else { return true }; if a.is_empty() { return true; }
    let mut allowed = false;
    for r in a {
        let mut m = true;
        if let Some(os) = r.get("os").filter(|x| x.is_object()) { if let Some(n) = os["name"].as_str() { if n != "windows" { m = false; } } if os["arch"].as_str() == Some("x86") { m = false; } }
        if let Some(f) = r.get("features").and_then(|x| x.as_object()) { for (k, v) in f { let have = if k == "has_custom_resolution" { custom } else { false }; if Some(have) != v.as_bool() { m = false; } } }
        if m { allowed = r["action"].as_str().unwrap_or("allow") == "allow"; }
    }
    allowed
}
fn lib_key(n: &str) -> String { let p: Vec<&str> = n.split(':').collect(); if p.len() < 2 { n.to_string() } else { format!("{}:{}{}", p[0], p[1], if p.len() > 3 { format!(":{}", p[3]) } else { String::new() }) } }
pub fn merged_version(c: &Core, id: &str, depth: u32) -> R<Value> {
    let mut v = read_json_opt(vjson_path(c, id)).ok_or(E(format!("Missing version json: {}", id)))?;
    let inh = gs(&v, "inheritsFrom");
    let jar = |x: &Value, d: &str| if gs(x, "jar").is_empty() { d.to_string() } else { gs(x, "jar") };
    if inh.is_empty() || depth > 5 { let j = jar(&v, id); v["_jarId"] = json!(j); return Ok(v); }
    let p = merged_version(c, &inh, depth + 1)?; let mut r = p.clone();
    for (k, val) in v.as_object().cloned().unwrap_or_default() { if !["libraries", "arguments", "inheritsFrom"].contains(&k.as_str()) { r[&k] = val; } }
    let mut seen = HashSet::new(); let mut libs = vec![];
    for src in [&v, &p] { for l in arr(src, "libraries") { let k = lib_key(&gs(l, "name")); if seen.insert(k) { libs.push(l.clone()); } } }
    r["libraries"] = json!(libs);
    let (mut jvm, mut game) = (vec![], vec![]);
    for src in [&p, &v] { if src["arguments"].is_object() { jvm.extend(arr(&src["arguments"], "jvm").iter().cloned()); game.extend(arr(&src["arguments"], "game").iter().cloned()); } }
    if !jvm.is_empty() || !game.is_empty() { r["arguments"] = json!({ "jvm": jvm, "game": game }); }
    if gb(&v, "minecraftArguments") { r.as_object_mut().unwrap().remove("arguments"); }
    let pj = gs(&p, "_jarId"); let j = if !gs(&v, "jar").is_empty() { gs(&v, "jar") } else if !pj.is_empty() { pj } else { id.to_string() };
    r["_jarId"] = json!(j); Ok(r)
}
pub fn maven_path(name: &str) -> String {
    let mut n = name.to_string(); let mut ext = "jar".to_string();
    if let Some(at) = n.find('@') { ext = n[at + 1..].to_string(); n = n[..at].to_string(); }
    let p: Vec<&str> = n.split(':').collect(); if p.len() < 3 { return String::new(); }
    format!("{}/{}/{}/{}-{}{}.{}", p[0].replace('.', "/"), p[1], p[2], p[1], p[2], if p.len() > 3 { format!("-{}", p[3]) } else { String::new() }, ext)
}
#[derive(Clone, Default, Debug)]
pub struct Lib { pub path: String, pub url: String, pub size: i64, pub native: bool, pub on_classpath: bool }
pub fn collect_libs(mv: &Value) -> Vec<Lib> {
    let mut out = vec![]; let mut seen = HashSet::new();
    for l in arr(mv, "libraries") {
        if l.get("rules").map(|r| !r.is_null()).unwrap_or(false) && !rules_ok(&l["rules"], false) { continue; }
        let name = gs(l, "name"); let parts: Vec<&str> = name.split(':').collect();
        if parts.len() > 3 && parts[3].starts_with("natives-") && parts[3] != "natives-windows" { continue; }
        let new_native = parts.len() > 3 && parts[3] == "natives-windows";
        let has_art = l["downloads"]["artifact"].is_object();
        if l["natives"].is_object() {
            let mut key = gs(&l["natives"], "windows"); if key.is_empty() { continue; } key = key.replace("${arch}", "64");
            let mut f = Lib { native: true, on_classpath: false, ..Default::default() };
            let cl = &l["downloads"]["classifiers"][&key];
            if cl.is_object() { f.path = gs(cl, "path"); f.url = gs(cl, "url"); f.size = gi(cl, "size"); }
            else { f.path = maven_path(&format!("{}:{}", name, key)); let b = if gs(l, "url").is_empty() { "https://libraries.minecraft.net/".to_string() } else { gs(l, "url") }; f.url = format!("{}{}", b, f.path); }
            if !f.path.is_empty() && seen.insert(f.path.clone()) { out.push(f); }
            if !has_art { continue; }
        }
        let mut f = Lib { native: new_native, on_classpath: true, ..Default::default() };
        if has_art { let a = &l["downloads"]["artifact"]; f.path = if gs(a, "path").is_empty() { maven_path(&name) } else { gs(a, "path") }; f.url = gs(a, "url"); f.size = gi(a, "size"); }
        else { f.path = maven_path(&name); if f.path.is_empty() { continue; } let mut b = if gs(l, "url").is_empty() { "https://libraries.minecraft.net/".to_string() } else { gs(l, "url") }; if !b.ends_with('/') { b.push('/'); } f.url = format!("{}{}", b, f.path); }
        if seen.insert(f.path.clone()) { out.push(f); }
    }
    out
}

// ---------------------------------------------------------------- java
fn java_name() -> &'static str { if cfg!(windows) { "java.exe" } else { "java" } }
fn parse_major(v: &str) -> i64 { if v.is_empty() { 0 } else if let Some(r) = v.strip_prefix("1.") { r.split(|c: char| !c.is_ascii_digit()).next().and_then(|x| x.parse().ok()).unwrap_or(0) } else { v.split(|c: char| !c.is_ascii_digit()).next().and_then(|x| x.parse().ok()).unwrap_or(0) } }
fn scan_dir_java(d: &Path, depth: i32, out: &mut Vec<Java>) {
    let exe = d.join("bin").join(java_name());
    if exists(&exe) {
        let mut ver = String::new();
        if let Ok(t) = std::fs::read_to_string(d.join("release")) { if let Some(m) = regex::Regex::new(r#"JAVA_VERSION="([^"]+)""#).unwrap().captures(&t) { ver = m[1].to_string(); } }
        let mut major = parse_major(&ver);
        if major == 0 { if let Some(m) = regex::Regex::new(r"(\d+)").unwrap().captures(&file_name_str(d)) { major = m[1].parse().unwrap_or(0); } }
        if major > 0 { out.push(Java { exe: exe.to_string_lossy().to_string(), major, ver: if ver.is_empty() { major.to_string() } else { ver } }); }
        return;
    }
    if depth <= 0 { return; }
    if let Ok(rd) = std::fs::read_dir(d) { for e in rd.flatten() { if e.file_type().map(|t| t.is_dir()).unwrap_or(false) { scan_dir_java(&e.path(), depth - 1, out); } } }
}
pub fn scan_javas(c: &Core) -> Vec<Java> {
    let mut out = vec![]; let mut roots = vec![c.p(&["runtimes"])];
    if let Ok(h) = std::env::var("JAVA_HOME") { scan_dir_java(Path::new(&h), 0, &mut out); }
    for k in ["ProgramFiles", "ProgramFiles(x86)"] { if let Ok(pf) = std::env::var(k) { for s in ["Java", "Eclipse Adoptium", "Microsoft", "Zulu", "BellSoft", "Amazon Corretto", "Semeru", "AdoptOpenJDK", "Eclipse Foundation"] { roots.push(Path::new(&pf).join(s)); } } }
    if let Ok(a) = std::env::var("APPDATA") { roots.push(Path::new(&a).join(".minecraft").join("runtime")); }
    for r in roots { if exists(&r) { scan_dir_java(&r, 4, &mut out); } }
    if let Some(p) = std::env::var_os("PATH") { for d in std::env::split_paths(&p) { if exists(d.join(java_name())) { if let Some(par) = d.parent() { scan_dir_java(par, 0, &mut out); } } } }
    let mut seen = HashSet::new(); out.retain(|j| seen.insert(j.exe.to_lowercase())); out.sort_by_key(|j| j.major);
    *c.javas.lock() = out.clone(); out
}
pub async fn download_java(c: &C, major: i64, j: &JobRef) -> R<()> {
    j.stage(format!("Downloading Java {} runtime", major), 0);
    let zip = c.p(&["cache", &format!("java{}.zip", major)]);
    download(c, &format!("https://api.adoptium.net/v3/binary/latest/{}/ga/windows/x64/jre/hotspot/normal/eclipse", major), &zip, Some(j)).await?;
    j.stage(format!("Extracting Java {}", major), 0);
    let dest = c.p(&["runtimes", &format!("java{}", major)]); let _ = std::fs::remove_dir_all(&dest);
    unzip(&zip, &dest, "", false).await?; let _ = std::fs::remove_file(&zip); scan_javas(c); Ok(())
}
pub async fn pick_java(c: &C, inst: &Value, major: i64, j: &JobRef) -> R<String> {
    let jp = gs(inst, "javaPath"); if !jp.is_empty() && exists(&jp) { return Ok(jp); }
    if c.javas.lock().is_empty() { scan_javas(c); }
    let find = |c: &Core, exact: bool| c.javas.lock().iter().find(|x| if exact { x.major == major } else { x.major >= major }).map(|x| x.exe.clone());
    if let Some(f) = find(c, true) { return Ok(f); }
    scan_javas(c); if let Some(f) = find(c, true) { return Ok(f); }
    if gb(&c.st(), "autoJava") { match download_java(c, major, j).await { Ok(()) => { if let Some(f) = find(c, true) { return Ok(f); } } Err(e) => c.log(format!("java download failed: {}", e.0)) } }
    if let Some(f) = find(c, false) { return Ok(f); }
    bail(format!("No Java {}+ found. Install it or enable auto-download in Settings.", major))
}
pub fn required_java(mv: &Value) -> i64 { let m = gi(&mv["javaVersion"], "majorVersion"); if m > 0 { m } else { 8 } }

// ---------------------------------------------------------------- loaders
pub async fn list_loader_versions(c: &C, loader: &str, mc: &str) -> Vec<Value> {
    let r: R<Vec<Value>> = async {
        if loader == "fabric" || loader == "quilt" {
            let base = if loader == "fabric" { "https://meta.fabricmc.net/v2/versions/loader/" } else { "https://meta.quiltmc.org/v3/versions/loader/" };
            let j = get_json(c, &format!("{}{}", base, urlenc(mc))).await?;
            return Ok(j.as_array().cloned().unwrap_or_default().iter().map(|e| { let v = gs(&e["loader"], "version"); json!({ "version": v, "stable": if e["loader"]["stable"].is_boolean() { e["loader"]["stable"].clone() } else { json!(!v.contains('-')) } }) }).collect());
        }
        if loader == "forge" {
            let pr = get_json(c, "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json").await?; let pr = &pr["promos"]; let mut out = vec![];
            let rec = gs(pr, &format!("{}-recommended", mc)); let lat = gs(pr, &format!("{}-latest", mc));
            if !rec.is_empty() { out.push(json!({ "version": rec, "stable": true })); }
            if !lat.is_empty() && lat != rec { out.push(json!({ "version": lat, "stable": out.is_empty() })); }
            return Ok(out);
        }
        if loader == "neoforge" {
            let p: Vec<&str> = mc.split('.').collect(); if p.len() < 2 { return Ok(vec![]); }
            let prefix = format!("{}.{}.", p[1], p.get(2).copied().unwrap_or("0"));
            let j = get_json(c, "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge").await?;
            return Ok(arr(&j, "versions").iter().filter_map(|v| v.as_str()).filter(|v| v.starts_with(&prefix)).rev().map(|v| json!({ "version": v, "stable": !v.contains("beta") })).collect());
        }
        if loader == "rust" { return rust_versions(c, mc).await; }
        Ok(vec![])
    }.await;
    r.unwrap_or_default()
}
pub fn urlenc(s: &str) -> String { percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string() }
async fn run_logged(c: &C, exe: &str, args: Vec<String>, cwd: &Path, env: Option<Vec<(String, String)>>, j: &JobRef, tag: &str) -> i32 {
    let mut cmd = command(exe); cmd.args(&args).current_dir(cwd);
    if let Some(e) = env { for (k, v) in e { cmd.env(k, v); } }
    let tagname = tag.trim().trim_end_matches(':').to_string();
    run_lines(cmd, |l| { j.label(format!("{}{}", tag, trunc(&l, 90))); c.log(format!("[{}] {}", tagname, l)); }).await
}
pub async fn install_loader(c: &C, inst: &mut Value, j: &JobRef) -> R<()> {
    let loader = gs(inst, "loader"); let mc = gs(inst, "mc"); let mut lv = gs(inst, "loaderVer");
    if lv.is_empty() { let v = list_loader_versions(c, &loader, &mc).await; let s = v.iter().find(|x| gb(x, "stable")).or(v.first()); lv = s.map(|x| gs(x, "version")).unwrap_or_default(); }
    if lv.is_empty() { return bail(format!("No {} version found for Minecraft {}", loader, mc)); }
    inst["loaderVer"] = json!(lv);
    if loader == "fabric" || loader == "quilt" {
        let base = if loader == "fabric" { "https://meta.fabricmc.net/v2/versions/loader/" } else { "https://meta.quiltmc.org/v3/versions/loader/" };
        let prof = get_json(c, &format!("{}{}/{}/profile/json", base, urlenc(&mc), urlenc(&lv))).await?;
        let id = gs(&prof, "id"); if id.is_empty() { return bail("Bad loader profile"); }
        write_json(vjson_path(c, &id), &prof); inst["versionId"] = json!(id); return Ok(());
    }
    let predicted = if loader == "forge" { format!("{}-forge-{}", mc, lv) } else { format!("neoforge-{}", lv) };
    if fsize(vjson_path(c, &predicted)) > 0 { inst["versionId"] = json!(predicted); return Ok(()); }
    let (url, name) = if loader == "forge" { let full = format!("{}-{}", mc, lv); (format!("https://maven.minecraftforge.net/net/minecraftforge/forge/{}/forge-{}-installer.jar", full, full), format!("forge-{}-installer.jar", full)) }
        else { (format!("https://maven.neoforged.net/releases/net/neoforged/neoforge/{}/neoforge-{}-installer.jar", lv, lv), format!("neoforge-{}-installer.jar", lv)) };
    let jar = c.p(&["cache", &name]); j.stage(format!("Downloading {} installer", loader), 0); download(c, &url, &jar, Some(j)).await?;
    let mv = merged_version(c, &mc, 0)?; let java = pick_java(c, inst, required_java(&mv), j).await?;
    if !exists(c.p(&["launcher_profiles.json"])) { write_json(c.p(&["launcher_profiles.json"]), &json!({ "profiles": {}, "selectedProfile": "", "version": 3 })); }
    let before: HashSet<String> = std::fs::read_dir(c.p(&["versions"])).map(|r| r.flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect()).unwrap_or_default();
    j.stage(format!("Running {} installer (can take a minute)", loader), 0);
    let code = run_logged(c, &java, vec!["-jar".into(), jar.to_string_lossy().to_string(), "--installClient".into(), c.root.to_string_lossy().to_string()], &c.root, None, j, "Installer: ").await;
    if fsize(vjsonPath_(c, &predicted)) > 0 { inst["versionId"] = json!(predicted); return Ok(()); }
    if let Ok(rd) = std::fs::read_dir(c.p(&["versions"])) { for d in rd.flatten() { let n = d.file_name().to_string_lossy().to_string(); if !before.contains(&n) && fsize(vjson_path(c, &n)) > 0 { inst["versionId"] = json!(n); return Ok(()); } } }
    bail(format!("{} installer failed (exit {}). Check the launcher log.", loader, code))
}
#[allow(non_snake_case)] fn vjsonPath_(c: &Core, id: &str) -> PathBuf { vjson_path(c, id) }

// ---------------------------------------------------------------- Rust loader (Horizon)
pub const RUST_REPO: &str = "horizon-rust/horizon"; pub const RUST_MC: &str = "26.3"; pub const RUST_ASSET: &str = "horizon-windows-x64.zip"; const RUST_KEYS: [&str; 1] = ["MU4oiIQcCxkZvbwSjjXs7SySCuM6ywRQ3nGaJYZG0gw="];
pub fn rust_dir(c: &Core, lv: &str) -> PathBuf { c.p(&["rust", &sanitize(lv)]) }
fn rust_exe(c: &Core, lv: &str) -> PathBuf { rust_dir(c, lv).join("horizon-client.exe") }
fn rust_res(c: &Core, lv: &str) -> PathBuf { rust_dir(c, lv).join(".local").join("horizon-client").join(RUST_MC) }
fn rust_installed(c: &Core, lv: &str) -> bool { !lv.is_empty() && fsize(rust_exe(c, lv)) > 0 }
fn rust_prepared(c: &Core, lv: &str) -> bool { rust_installed(c, lv) && fsize(rust_res(c, lv).join("horizon-resources.json")) > 0 }
fn is_nightly(t: &str) -> bool { t == "nightly" || t.starts_with("nightly-") }
fn rust_version_of(r: &Value) -> String {
    let tag = gs(r, "tag_name"); if !is_nightly(&tag) { return tag; }
    let re = regex::Regex::new(r"(?i)^Nightly (\d{4}-\d\d-\d\d)(?: · ([0-9a-f]+))?").unwrap(); let name = gs(r, "name");
    let (d, h) = match re.captures(&name) { Some(m) => (m[1].to_string(), m.get(2).map(|x| x.as_str().to_string())), None => (gs(r, "published_at").chars().take(10).collect(), None) };
    format!("nightly-{}{}", d, h.map(|x| format!("-{}", x)).unwrap_or_default())
}
async fn rust_releases(c: &C) -> R<Vec<Value>> {
    let list = get_json(c, &format!("https://api.github.com/repos/{}/releases?per_page=100", RUST_REPO)).await?;
    Ok(list.as_array().cloned().unwrap_or_default().into_iter().filter(|r| !gb(r, "draft") && arr(r, "assets").iter().any(|a| gs(a, "name") == RUST_ASSET)).collect())
}
pub async fn rust_versions(c: &C, mc: &str) -> R<Vec<Value>> {
    if mc != RUST_MC { return Ok(vec![]); }
    Ok(rust_releases(c).await?.iter().enumerate().map(|(i, r)| json!({ "version": rust_version_of(r), "stable": i == 0 || !gb(r, "prerelease") })).collect())
}
fn rust_signed_digest(tag: &str, sums: &[u8], sig_text: &str) -> R<String> {
    use ed25519_dalek::{Signature, Verifier, VerifyingKey}; use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD;
    let mut msg = format!("horizon release {}\n", if is_nightly(tag) { "nightly" } else { tag }).into_bytes(); msg.extend_from_slice(sums);
    let keys: Vec<VerifyingKey> = RUST_KEYS.iter().filter_map(|k| b64.decode(k).ok()).filter_map(|b| <[u8; 32]>::try_from(b.as_slice()).ok()).filter_map(|a| VerifyingKey::from_bytes(&a).ok()).collect();
    let ok = sig_text.lines().map(|x| x.trim()).filter(|x| !x.is_empty()).any(|s| b64.decode(s).ok().and_then(|b| Signature::from_slice(&b).ok()).map(|sig| keys.iter().any(|k| k.verify(&msg, &sig).is_ok())).unwrap_or(false));
    if !ok { return bail(format!("{}: the release signature does not match Horizon's release key, so it was not installed.", tag)); }
    let re = regex::Regex::new(r"^([0-9a-fA-F]{64})\s+\*?(.+)$").unwrap();
    for l in String::from_utf8_lossy(sums).lines() { if let Some(m) = re.captures(l.trim()) { if &m[2] == RUST_ASSET { return Ok(m[1].to_lowercase()); } } }
    bail(format!("{} is not in {}'s signed checksums.", RUST_ASSET, tag))
}
pub async fn install_rust(c: &C, inst: &mut Value, j: &JobRef) -> R<()> {
    if gs(inst, "mc") != RUST_MC { return bail(format!("Rust (Horizon) only supports Minecraft {}", RUST_MC)); }
    j.stage("Finding Horizon release", 0); let rels = rust_releases(c).await?; let want = gs(inst, "loaderVer");
    let rel = if !want.is_empty() { rels.iter().find(|r| rust_version_of(r) == want || gs(r, "tag_name") == want) } else { rels.first() };
    let Some(rel) = rel else {
        if !want.is_empty() && rust_installed(c, &want) { inst["versionId"] = json!(format!("rust-{}", want)); return Ok(()); }
        return bail(if !want.is_empty() { format!("Horizon build \"{}\" was not found", want) } else { "No Horizon release found for Windows (offline?)".into() });
    };
    let lv = rust_version_of(rel); inst["loaderVer"] = json!(lv); inst["versionId"] = json!(format!("rust-{}", lv));
    if rust_installed(c, &lv) { return Ok(()); }
    let tag = gs(rel, "tag_name"); let base = format!("https://github.com/{}/releases/download/{}/", RUST_REPO, tag);
    j.stage("Verifying Horizon release", 0);
    let digest = async { let sums = get_bytes(c, &format!("{}SHA256SUMS", base), 3).await?; let sig = get_bytes(c, &format!("{}SHA256SUMS.sig", base), 3).await?; rust_signed_digest(&tag, &sums, &String::from_utf8_lossy(&sig)) }.await;
    let want_hash = match digest { Ok(d) => d, Err(e) => { return bail(if e.0.contains("signature") || e.0.contains("signed checksums") { e.0 } else { format!("Could not verify {} (it needs a signed SHA256SUMS): {}", lv, e.0) }); } };
    let asset = arr(rel, "assets").iter().find(|a| gs(a, "name") == RUST_ASSET).cloned().ok_or(E("asset missing".into()))?;
    let zip = c.p(&["cache", &format!("{}-{}", sanitize(&lv), RUST_ASSET)]);
    j.stage("Downloading Horizon (Rust)", 0); download(c, &gs(&asset, "browser_download_url"), &zip, Some(j)).await?;
    let z2 = zip.clone(); if blocking(move || sha256_file(&z2)).await? != want_hash { let _ = std::fs::remove_file(&zip); return bail("The Horizon download does not match its signed checksum (corrupted or tampered with). Try again."); }
    j.stage("Unpacking Horizon", 0);
    let dir = rust_dir(c, &lv); let tmp = PathBuf::from(format!("{}.partial", dir.to_string_lossy())); let _ = std::fs::remove_dir_all(&tmp); unzip(&zip, &tmp, "", false).await?;
    let ents: Vec<_> = std::fs::read_dir(&tmp)?.flatten().collect();
    let top = if ents.len() == 1 && ents[0].path().is_dir() { ents[0].path() } else { tmp.clone() };
    if fsize(top.join("horizon-client.exe")) <= 0 { let _ = std::fs::remove_dir_all(&tmp); return bail("The Horizon download has no horizon-client.exe"); }
    let _ = std::fs::remove_dir_all(&dir); if let Some(p) = dir.parent() { std::fs::create_dir_all(p)?; } std::fs::rename(&top, &dir)?; let _ = std::fs::remove_dir_all(&tmp); let _ = std::fs::remove_file(&zip);
    Ok(())
}
async fn prepare_rust(c: &C, inst: &Value, j: &JobRef) -> R<()> {
    let lv = gs(inst, "loaderVer"); if rust_prepared(c, &lv) { return Ok(()); }
    let dir = rust_dir(c, &lv); let prep = dir.join("horizon-prepare.exe"); if !exists(&prep) { return bail("This Horizon build has no horizon-prepare.exe"); }
    let mc = gs(inst, "mc"); let sv = read_obj(vjson_path(c, &mc))["downloads"]["server"].clone();
    if !sv.is_object() { return bail(format!("Minecraft {} has no server download to prepare from", mc)); }
    j.stage("Minecraft server jar", 0); let jar = c.p(&["cache", &format!("server-{}.jar", mc)]);
    download_all(c, vec![Task { url: gs(&sv, "url"), dest: jar.clone(), size: gi(&sv, "size") }], j).await?;
    if fsize(&jar) <= 0 { return bail("Server jar download failed"); }
    let major = { let m = gi(&read_obj(dir.join("research-lock.json"))["minecraft"], "java_major"); if m > 0 { m } else { 25 } };
    j.stage("Java runtime", 0); let java = pick_java(c, inst, major, j).await?;
    let jp = PathBuf::from(&java); let home = if jp.parent().map(|p| file_name_str(p).to_lowercase() == "bin").unwrap_or(false) { jp.parent().unwrap().parent().unwrap().to_path_buf() } else { jp.parent().unwrap().to_path_buf() };
    let path_old = std::env::var_os("PATH").unwrap_or_default(); let mut paths = vec![home.join("bin")]; paths.extend(std::env::split_paths(&path_old));
    let env = vec![("JAVA_HOME".to_string(), home.to_string_lossy().to_string()), ("PATH".to_string(), std::env::join_paths(paths).map(|p| p.to_string_lossy().to_string()).unwrap_or_default())];
    j.stage("Preparing Horizon (a few minutes, only once)", 0);
    let root = c.root.to_string_lossy().to_string();
    let code = run_logged(c, &prep.to_string_lossy(), vec!["--root".into(), dir.to_string_lossy().to_string(), "--prepare".into(), "--server-jar".into(), jar.to_string_lossy().to_string(), "--minecraft-dir".into(), root.clone()], &dir, Some(env.clone()), j, "Preparing: ").await;
    if !rust_prepared(c, &lv) { return bail(format!("Horizon preparation failed (exit {}). Check the launcher log.", code)); }
    j.stage("Copying sounds", 0); run_logged(c, &prep.to_string_lossy(), vec!["sounds".into(), "--root".into(), dir.to_string_lossy().to_string(), "--minecraft-dir".into(), root], &dir, Some(env), j, "Sounds: ").await;
    Ok(())
}
pub struct Launch { pub java: String, pub args: Vec<String>, pub cwd: PathBuf }
fn rust_launch(c: &Core, inst: &Value) -> R<Launch> {
    let lv = gs(inst, "loaderVer"); if !rust_prepared(c, &lv) { return bail("Horizon is not installed or prepared yet. Use Repair on this instance."); }
    let mut args = vec!["--resources".to_string(), rust_res(c, &lv).to_string_lossy().to_string(), "--name".into(), c.st_s("username")];
    if gi(inst, "width") > 0 && gi(inst, "height") > 0 { args.extend(["--width".into(), gi(inst, "width").to_string(), "--height".into(), gi(inst, "height").to_string()]); }
    Ok(Launch { java: rust_exe(c, &lv).to_string_lossy().to_string(), args, cwd: c.game_dir(inst) })
}

// ---------------------------------------------------------------- prepare / launch
pub fn quick_check(c: &Core, inst: &Value) -> bool {
    if gs(inst, "loader") == "rust" { return gb(inst, "ready") && gs(inst, "versionId") == format!("rust-{}", gs(inst, "loaderVer")) && rust_prepared(c, &gs(inst, "loaderVer")); }
    let vid = gs(inst, "versionId");
    if !gb(inst, "ready") || vid.is_empty() || fsize(vjson_path(c, &vid)) <= 0 { return false; }
    let Ok(mv) = merged_version(c, &vid, 0) else { return false };
    let jid = if gs(&mv, "_jarId").is_empty() { gs(inst, "mc") } else { gs(&mv, "_jarId") };
    if fsize(c.p(&["versions", &jid, &format!("{}.jar", jid)])) <= 0 { return false; }
    for l in collect_libs(&mv) { if (!l.url.is_empty() || l.on_classpath) && fsize(c.p(&["libraries", &l.path])) <= 0 { return false; } }
    true
}
pub async fn prepare_instance(c: &C, inst: &mut Value, j: &JobRef) -> R<()> {
    j.stage("Fetching version list", 0); if c.manifest.lock().is_empty() { load_manifest(c).await; }
    j.stage("Version metadata", 0); let mc = gs(inst, "mc");
    if !ensure_vanilla_json(c, &mc).await? { return bail(format!("Could not get metadata for Minecraft {} (offline?)", mc)); }
    let loader = gs(inst, "loader"); let rust = loader == "rust";
    if loader == "vanilla" { inst["versionId"] = json!(mc); }
    else if rust { install_rust(c, inst, j).await?; }
    else if gs(inst, "versionId").is_empty() || fsize(vjson_path(c, &gs(inst, "versionId"))) <= 0 { install_loader(c, inst, j).await?; }
    let mv = merged_version(c, &if rust { mc.clone() } else { gs(inst, "versionId") }, 0)?;
    let jid = if gs(&mv, "_jarId").is_empty() { mc.clone() } else { gs(&mv, "_jarId") }; ensure_vanilla_json(c, &jid).await?;
    j.stage("Game client", 0);
    let cj = read_obj(vjson_path(c, &jid)); let cl = &cj["downloads"]["client"]; let jar = c.p(&["versions", &jid, &format!("{}.jar", jid)]);
    if cl.is_object() { download_all(c, vec![Task { url: gs(cl, "url"), dest: jar.clone(), size: gi(cl, "size") }], j).await?; }
    if fsize(&jar) <= 0 { return bail("Client jar download failed"); }
    j.stage("Libraries", 0); let libs = collect_libs(&mv);
    download_all(c, libs.iter().map(|l| Task { url: l.url.clone(), dest: c.p(&["libraries", &l.path]), size: l.size }).collect(), j).await?;
    for l in &libs { if l.on_classpath && fsize(c.p(&["libraries", &l.path])) <= 0 { return bail(format!("Missing library: {}", l.path)); } }
    let lf = &mv["logging"]["client"]["file"];
    if lf.is_object() { let id = if gs(lf, "id").is_empty() { "log.xml".to_string() } else { gs(lf, "id") }; download_all(c, vec![Task { url: gs(lf, "url"), dest: c.p(&["assets", "log_configs", &id]), size: gi(lf, "size") }], j).await?; }
    if mv["assetIndex"].is_object() {
        j.stage("Asset index", 0); let ai = &mv["assetIndex"]; let aid = if gs(ai, "id").is_empty() { "legacy".to_string() } else { gs(ai, "id") }; let idx = c.p(&["assets", "indexes", &format!("{}.json", aid)]);
        download_all(c, vec![Task { url: gs(ai, "url"), dest: idx.clone(), size: gi(ai, "size") }], j).await?;
        let aj = read_json_opt(&idx).filter(|a| a["objects"].is_object()).ok_or(E("Asset index download failed".into()))?;
        j.stage("Assets", 0);
        let ents: Vec<(String, Value)> = aj["objects"].as_object().unwrap().iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        download_all(c, ents.iter().map(|(_, o)| { let h = gs(o, "hash"); Task { url: format!("https://resources.download.minecraft.net/{}/{}", &h[..2], h), dest: c.p(&["assets", "objects", &h[..2], &h]), size: gi(o, "size") } }).collect(), j).await?;
        if gb(&aj, "virtual") || gb(&aj, "map_to_resources") {
            j.stage("Preparing legacy assets", 0);
            for (k, o) in &ents { let h = gs(o, "hash"); let src = c.p(&["assets", "objects", &h[..2], &h]);
                let mut dests = vec![]; if gb(&aj, "virtual") { dests.push(c.p(&["assets", "virtual", &aid]).join(k)); } if gb(&aj, "map_to_resources") { dests.push(c.game_dir(inst).join("resources").join(k)); }
                for d in dests { if !exists(&d) { if let Some(p) = d.parent() { let _ = std::fs::create_dir_all(p); } let _ = std::fs::copy(&src, &d); } } }
        }
    }
    if rust { prepare_rust(c, inst, j).await?; inst["ready"] = json!(true); return Ok(()); }
    j.stage("Natives", 0); let nd = c.dir_inst(inst).join("natives"); let mk = nd.join(".done"); let vid = gs(inst, "versionId");
    if !exists(&mk) || std::fs::read_to_string(&mk).unwrap_or_default() != vid {
        let _ = std::fs::remove_dir_all(&nd); std::fs::create_dir_all(&nd)?;
        for l in libs.iter().filter(|l| l.native) {
            let (z, d) = (c.p(&["libraries", &l.path]), nd.clone());
            blocking(move || unzip_sync(&z, &d, "", Some(&|n: &str| n.to_lowercase().ends_with(".dll") && !n.contains("META-INF")), true)).await?;
        }
        std::fs::write(&mk, &vid)?;
    }
    j.stage("Java runtime", 0); pick_java(c, inst, required_java(&mv), j).await?; inst["ready"] = json!(true); Ok(())
}
pub async fn run_prepare(c: &C, inst: &mut Value, j: &JobRef) -> R<()> {
    let id = gs(inst, "id"); c.busy.lock().insert(id.clone()); push_state(c);
    let r = prepare_instance(c, inst, j).await; if r.is_ok() { c.save_inst(inst); }
    c.busy.lock().remove(&id); push_state(c); r
}
pub fn offline_uuid(name: &str) -> String {
    use md5::{Digest, Md5}; let mut h = Md5::new(); h.update(format!("OfflinePlayer:{}", name).as_bytes()); let mut b: [u8; 16] = h.finalize().into();
    b[6] = (b[6] & 0x0f) | 0x30; b[8] = (b[8] & 0x3f) | 0x80; let x = hex::encode(b);
    format!("{}-{}-{}-{}-{}", &x[0..8], &x[8..12], &x[12..16], &x[16..20], &x[20..])
}
pub fn build_launch(c: &Core, inst: &Value, mv: &Value, java: &str) -> R<Launch> {
    let jid = if gs(mv, "_jarId").is_empty() { gs(inst, "mc") } else { gs(mv, "_jarId") }; let mut seen = HashSet::new(); let mut cp = String::new();
    for l in collect_libs(mv) { if l.on_classpath { let f = c.p(&["libraries", &l.path]).to_string_lossy().to_string(); if seen.insert(f.clone()) { cp.push_str(&f); cp.push(';'); } } }
    cp.push_str(&c.p(&["versions", &jid, &format!("{}.jar", jid)]).to_string_lossy());
    let aid = if mv["assetIndex"].is_object() && !gs(&mv["assetIndex"], "id").is_empty() { gs(&mv["assetIndex"], "id") } else { "legacy".into() };
    let aj = read_obj(c.p(&["assets", "indexes", &format!("{}.json", aid)])); let s = c.st();
    let ms = if gs(&s, "activeMs").is_empty() { None } else { arr(&s, "msAccounts").iter().find(|x| gs(x, "id") == gs(&s, "activeMs")).cloned() };
    let dash = |h: &str| if h.len() == 32 { format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..]) } else { h.to_string() };
    let uuid = ms.as_ref().map(|m| dash(&gs(m, "id"))).unwrap_or_else(|| offline_uuid(&gs(&s, "username")));
    let tok = ms.as_ref().map(|m| crate::auth::dec_tok(&gs(m, "mcToken"))).unwrap_or("0".into());
    let nd = c.dir_inst(inst).join("natives").to_string_lossy().to_string(); let g = |k: &str| gs(inst, k);
    let mut v: std::collections::HashMap<&str, String> = std::collections::HashMap::new();
    for (k, val) in [("auth_player_name", ms.as_ref().map(|m| gs(m, "name")).unwrap_or(gs(&s, "username"))), ("version_name", g("versionId")), ("game_directory", c.game_dir(inst).to_string_lossy().to_string()), ("assets_root", c.p(&["assets"]).to_string_lossy().to_string()), ("assets_index_name", aid.clone()), ("auth_uuid", uuid.clone()), ("auth_access_token", tok.clone()), ("auth_session", format!("token:{}:{}", tok, uuid)), ("clientid", if ms.is_some() { crate::auth::MS_CLIENT.to_string() } else { "offline".into() }), ("auth_xuid", "0".into()), ("user_type", if ms.is_some() { "msa".into() } else { "legacy".into() }), ("user_properties", "{}".into()), ("version_type", if gs(mv, "type").is_empty() { "release".into() } else { gs(mv, "type") }), ("natives_directory", nd.clone()), ("launcher_name", "OfflineCraft".into()), ("launcher_version", "3.0".into()), ("classpath", cp.clone()), ("classpath_separator", ";".into()), ("library_directory", c.p(&["libraries"]).to_string_lossy().to_string()), ("game_assets", if gb(&aj, "virtual") { c.p(&["assets", "virtual", &aid]).to_string_lossy().to_string() } else { c.p(&["assets"]).to_string_lossy().to_string() }), ("resolution_width", gi(inst, "width").to_string()), ("resolution_height", gi(inst, "height").to_string())] { v.insert(k, val); }
    let re = regex::Regex::new(r"\$\{(\w+)\}").unwrap();
    let sub = |t: &str| re.replace_all(t, |m: &regex::Captures| v.get(&m[1]).cloned().unwrap_or(m[0].to_string())).to_string();
    let custom = gi(inst, "width") > 0 && gi(inst, "height") > 0;
    let expand = |a: &[Value], out: &mut Vec<String>| { for x in a { if let Some(t) = x.as_str() { out.push(sub(t)); continue; } if x.get("rules").is_some() && !rules_ok(&x["rules"], custom) { continue; } match &x["value"] { Value::String(t) => out.push(sub(t)), Value::Array(l) => for t in l { if let Some(t) = t.as_str() { out.push(sub(t)); } }, _ => {} } } };
    let ram = if gi(inst, "ramMB") > 0 { gi(inst, "ramMB") } else { gi(&s, "ramMB") };
    let mut args = vec![format!("-Xmx{}M", ram), format!("-Xms{}M", ram.min(512)), "-Xshare:auto".to_string()];
    if gb(&s, "optimizedFlags") { for a in ["-XX:+UseG1GC", "-XX:+UnlockExperimentalVMOptions", "-XX:G1NewSizePercent=20", "-XX:G1ReservePercent=20", "-XX:MaxGCPauseMillis=50", "-XX:G1HeapRegionSize=32M", "-XX:+DisableExplicitGC", "-XX:+AlwaysPreTouch"] { args.push(a.into()); } }
    for ua in [gs(&s, "jvmArgs"), g("jvmArgs")] { args.extend(ua.split_whitespace().map(String::from)); }
    args.push("-Dminecraft.launcher.brand=OfflineCraft".into());
    let has_args = mv["arguments"].is_object();
    if has_args { expand(arr(&mv["arguments"], "jvm"), &mut args); } else { args.push(format!("-Djava.library.path={}", nd)); args.push("-cp".into()); args.push(cp.clone()); }
    if !args.contains(&cp) { args.push("-cp".into()); args.push(cp.clone()); }
    if !args.iter().any(|a| a.starts_with("-Djava.library.path")) { args.push(format!("-Djava.library.path={}", nd)); }
    let lg = &mv["logging"]["client"];
    if !gs(&lg["argument"], "").is_empty() || lg["argument"].is_string() { if lg["file"].is_object() { let lf = c.p(&["assets", "log_configs", &gs(&lg["file"], "id")]); if fsize(&lf) > 0 { args.push(gs(lg, "argument").replace("${path}", &lf.to_string_lossy())); } } }
    args.push(if gs(mv, "mainClass").is_empty() { "net.minecraft.client.main.Main".into() } else { gs(mv, "mainClass") });
    if has_args { expand(arr(&mv["arguments"], "game"), &mut args); } else if gb(mv, "minecraftArguments") { args.extend(gs(mv, "minecraftArguments").split_whitespace().map(|t| sub(t))); }
    if custom && !has_args { args.extend(["--width".into(), gi(inst, "width").to_string(), "--height".into(), gi(inst, "height").to_string()]); }
    if gb(inst, "fullscreen") { args.push("--fullscreen".into()); }
    Ok(Launch { java: java.to_string(), args, cwd: c.game_dir(inst) })
}
pub fn join_args(inst: &Value, addr: &str) -> Vec<String> {
    let p: Vec<i64> = gs(inst, "mc").split('.').map(|x| x.parse().unwrap_or(0)).collect(); let (a, b) = (p.first().copied().unwrap_or(0), p.get(1).copied().unwrap_or(0));
    let (host, port) = match addr.rfind(':') { Some(i) if i > 0 => (&addr[..i], &addr[i + 1..]), _ => (addr, "25565") };
    if a > 1 || (a == 1 && b >= 20) { vec!["--quickPlayMultiplayer".into(), addr.into()] } else { vec!["--server".into(), host.into(), "--port".into(), port.into()] }
}
pub fn rust_launch_for(c: &Core, inst: &Value) -> R<Launch> { rust_launch(c, inst) }
