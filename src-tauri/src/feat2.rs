use crate::api::{pick_open, pick_save, reveal};
use crate::auth::*;
use crate::core::*;
use crate::feat::zip_folder;
use crate::mc::*;
use crate::util::*;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------- launch hooks
pub fn hook_env(c: &Core, i: &Value) -> Vec<(String, String)> {
    let mut e = parse_env(&gs(i, "envVars"));
    for (k, v) in [("INST_ID", gs(i, "id")), ("INST_NAME", gs(i, "name")), ("INST_MC_VER", gs(i, "mc")), ("INST_LOADER", gs(i, "loader")), ("INST_DIR", c.dir_inst(i).to_string_lossy().to_string()), ("INST_MC_DIR", c.game_dir(i).to_string_lossy().to_string())] { e.push((k.into(), v)); } e
}
pub fn spawn_spec(c: &Core, i: &Value, lp: &Launch) -> (String, Vec<String>, Vec<(String, String)>) {
    let mut cmd = lp.java.clone(); let mut args = lp.args.clone(); args.extend(split_args(&gs(i, "gameArgs"))); let w = split_args(&gs(i, "wrapCmd"));
    if !w.is_empty() { let mut a: Vec<String> = w[1..].to_vec(); a.push(cmd); a.extend(args); args = a; cmd = w[0].clone(); }
    (cmd, args, hook_env(c, i))
}
pub async fn run_hook(c: &C, i: &Value, line: &str, label: &str, add: &(dyn Fn(String) + Send + Sync), extra: &[(&str, String)]) -> i32 {
    if line.trim().is_empty() { return 0; } add(format!("[launcher] {}: {}", label, line));
    #[cfg(windows)] let mut cmd = { let mut x = command("cmd"); x.arg("/C").arg(line); x };
    #[cfg(not(windows))] let mut cmd = { let mut x = command("sh"); x.arg("-c").arg(line); x };
    cmd.current_dir(c.game_dir(i)); for (k, v) in hook_env(c, i) { cmd.env(k, v); } for (k, v) in extra { cmd.env(k, v); }
    let lab = label.to_string();
    match tokio::time::timeout(std::time::Duration::from_secs(60), run_lines(cmd, |l| add(format!("[{}] {}", lab, l)))).await { Ok(c) => c, Err(_) => { add(format!("[launcher] {} took longer than 60 s and was stopped", label)); -1 } }
}

// ---------------------------------------------------------------- share log
pub async fn share_log(c: &C, id: &str) -> R<Value> {
    let i = c.must_inst(id)?; let r = c.running.lock().get(id).cloned(); let mut text = r.map(|r| r.lines.lock().join("\n")).unwrap_or_default();
    if text.is_empty() { text = std::fs::read_to_string(c.game_dir(&i).join("logs").join("latest.log")).unwrap_or_default(); }
    if text.trim().is_empty() { return bail("There is no log to share yet. Launch the game first."); }
    let lines: Vec<&str> = text.lines().collect(); if lines.len() > 20000 { text = lines[lines.len() - 20000..].join("\n"); }
    let base = std::env::var("OC_MCLOGS_BASE").unwrap_or("https://api.mclo.gs".into());
    let res = c.http.post(format!("{}/1/log", base)).form(&[("content", text)]).timeout(std::time::Duration::from_secs(30)).send().await.map_err(|_| E("Could not reach mclo.gs (are you online?)".into()))?;
    let st = res.status(); let j: Value = res.json().await.unwrap_or(json!({}));
    if !st.is_success() || !gb(&j, "success") || gs(&j, "url").is_empty() { return bail(format!("mclo.gs refused the log: {}", if gs(&j, "error").is_empty() { st.as_u16().to_string() } else { gs(&j, "error") })); }
    Ok(j["url"].clone())
}

// ---------------------------------------------------------------- shortcut + CLI
pub fn find_instance(c: &Core, q: &str) -> Option<Value> { let q = q.trim().to_lowercase(); let l = c.instances.lock(); l.iter().find(|i| gs(i, "id").to_lowercase() == q).or(l.iter().find(|i| gs(i, "name").to_lowercase() == q)).cloned() }
pub fn make_shortcut(c: &Core, id: &str) -> R<Value> {
    let i = c.must_inst(id)?; if !cfg!(windows) { return Ok(json!({ "err": "Desktop shortcuts are only available on Windows" })); }
    let exe = launcher_exe(); let desk = std::env::var("USERPROFILE").map(|u| PathBuf::from(u).join("Desktop")).unwrap_or_default(); let lnk = desk.join(format!("{}.lnk", sanitize(&gs(&i, "name"))));
    let ps = format!("$s=New-Object -ComObject WScript.Shell; $l=$s.CreateShortcut('{lnk}'); $l.TargetPath='{exe}'; $l.Arguments='--launch \"{id}\"'; $l.WorkingDirectory='{wd}'; $l.IconLocation='{exe},0'; $l.Description='Play {name} with OfflineCraft'; $l.Save()",
        lnk = lnk.to_string_lossy().replace('\'', "''"), exe = exe.to_string_lossy().replace('\'', "''"), id = gs(&i, "id").replace('\'', "''"), wd = exe.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default().replace('\'', "''"), name = gs(&i, "name").replace('\'', "''"));
    let mut cmd = std::process::Command::new("powershell"); cmd.args(["-NoProfile", "-Command", &ps]);
    #[cfg(windows)] { use std::os::windows::process::CommandExt; cmd.creation_flags(0x08000000); }
    let ok = cmd.status().map(|s| s.success()).unwrap_or(false) && exists(&lnk); Ok(if ok { json!({ "path": lnk.to_string_lossy() }) } else { json!({ "err": "Windows refused to create the shortcut" }) })
}
/// The shortcut should start the splash launcher (OfflineCraft.exe) when it sits next to the app exe.
fn launcher_exe() -> PathBuf { let me = std::env::current_exe().unwrap_or_default(); let n = file_name_str(&me); if n.eq_ignore_ascii_case("OfflineCraft-app.exe") { let l = me.with_file_name("OfflineCraft.exe"); if exists(&l) { return l; } } me }
pub fn cli(c: &C, argv: &[String]) -> Option<String> {
    let get = |k: &str| argv.iter().position(|a| a == k).and_then(|n| argv.get(n + 1)).filter(|v| !v.starts_with("--")).cloned().unwrap_or_default();
    let q = get("--launch"); if q.is_empty() { return None; }
    let Some(i) = find_instance(c, &q) else { c.toast(format!("No instance called \"{}\"", q), true); return None };
    let (c2, id, join) = (c.clone(), gs(&i, "id"), get("--join")); tokio::spawn(async move { let _ = crate::api::launch(&c2, &id, if join.is_empty() { json!({}) } else { json!({ "join": join }) }).await; }); Some(gs(&i, "id"))
}

// ---------------------------------------------------------------- import MultiMC / Prism
async fn import_prism(c: &C, file: &Path, j: &JobRef) -> R<(Value, usize, Vec<String>)> {
    j.stage("Reading the instance", 0); let f2 = file.to_path_buf();
    let (names, pack, cfg_txt, base): (Vec<String>, Value, String, String) = blocking(move || -> R<_> {
        let mut z = zip::ZipArchive::new(std::fs::File::open(&f2)?)?; let names: Vec<String> = (0..z.len()).filter_map(|k| z.by_index(k).ok().map(|e| e.name().replace('\\', "/"))).collect();
        let pk = names.iter().find(|n| *n == "mmc-pack.json" || n.ends_with("/mmc-pack.json")).cloned().ok_or(E("This is not a MultiMC / Prism instance export (mmc-pack.json is missing)".into()))?;
        let base = pk[..pk.len() - "mmc-pack.json".len()].to_string(); let mut s = String::new(); { let idx = (0..z.len()).find(|k| z.by_index(*k).map(|e| e.name().replace('\\', "/") == pk).unwrap_or(false)).ok_or(E("mmc-pack.json missing".into()))?; let mut e = z.by_index(idx)?; std::io::Read::read_to_string(&mut e, &mut s)?; }
        let mut cfg = String::new(); if let Ok(mut e) = z.by_name(&format!("{}instance.cfg", base)) { let _ = std::io::Read::read_to_string(&mut e, &mut cfg); }
        Ok((names, serde_json::from_str(&s)?, cfg, base)) }).await?;
    let mut comp = std::collections::HashMap::new(); for cm in arr(&pack, "components") { comp.insert(gs(cm, "uid"), gs(cm, "version")); }
    let mc = comp.get("net.minecraft").cloned().ok_or(E("No Minecraft version found in this instance".into()))?;
    let (mut loader, mut want) = ("vanilla".to_string(), String::new());
    for (uid, l) in [("net.fabricmc.fabric-loader", "fabric"), ("org.quiltmc.quilt-loader", "quilt"), ("net.neoforged", "neoforge"), ("net.minecraftforge", "forge")] { if let Some(v) = comp.get(uid) { loader = l.into(); want = v.clone(); } }
    let cfg = parse_ini(&cfg_txt); let name = cfg.get("name").cloned().unwrap_or(file_stem_str(file)); let mut notes = vec![]; let mut lv = String::new();
    if loader != "vanilla" {
        j.stage(format!("Finding the {} version", loader), 0); let vs = list_loader_versions(c, &loader, &mc).await;
        let pick = vs.iter().find(|v| gs(v, "version") == want).or(vs.iter().find(|v| gs(v, "version").ends_with(&format!("-{}", want)))).or(vs.iter().find(|v| gs(v, "version").contains(&want)));
        if let Some(p) = pick { lv = gs(p, "version"); } else { let st = vs.iter().find(|v| gb(v, "stable")).or(vs.first()).ok_or(E(format!("{} has no build for Minecraft {} yet", loader, mc)))?; lv = gs(st, "version"); notes.push(format!("{} {} was not available, using {}", loader, want, lv)); }
    }
    let mut inst = c.make_instance(&name, &mc, &loader, &lv); if cfg.get("MaxMemAlloc").and_then(|m| m.parse::<i64>().ok()).unwrap_or(0) >= 1024 { inst["ramMB"] = json!(cfg["MaxMemAlloc"].parse::<i64>().unwrap()); } c.save_inst(&inst); push_state(c);
    let prefix = if names.iter().any(|n| n.starts_with(&format!("{}.minecraft/", base))) { format!("{}.minecraft/", base) } else { format!("{}minecraft/", base) }; let gd = c.game_dir(&inst);
    j.stage("Copying files", 0); let (f3, gd2, pf) = (file.to_path_buf(), gd.clone(), prefix.clone());
    let n = blocking(move || -> R<usize> { let mut z = zip::ZipArchive::new(std::fs::File::open(&f3)?)?; let skip = regex::Regex::new(r"^(logs|crash-reports|\.cache)/").unwrap(); let mut n = 0;
        for k in 0..z.len() { let mut e = z.by_index(k)?; let nm = e.name().replace('\\', "/"); if e.is_dir() || !nm.starts_with(&pf) { continue; } let rel = &nm[pf.len()..]; if !safe_rel(rel) || skip.is_match(rel) { continue; } let d = gd2.join(rel); if let Some(p) = d.parent() { std::fs::create_dir_all(p)?; } let mut f = std::fs::File::create(&d)?; std::io::copy(&mut e, &mut f)?; n += 1; } Ok(n) }).await?;
    if cfg.contains_key("PreLaunchCommand") || cfg.contains_key("WrapperCommand") || cfg.contains_key("PostExitCommand") { notes.push("launch commands were not imported, for safety".into()); }
    Ok((inst, n, notes))
}
pub async fn import_prism_api(c: &C) -> R<Value> {
    let Some(f) = pick_open(c, "Import a MultiMC / Prism instance", &[("Instance export", &["zip"])], false).await else { return Ok(Value::Null) };
    Ok(job_result(start_job(c, "Importing instance", |j| async move { let (mut inst, n, notes) = import_prism(c, &f, &j).await?; run_prepare(c, &mut inst, &j).await?; push_state(c); c.toast(format!("{} imported ({} files){}", gs(&inst, "name"), n, if notes.is_empty() { String::new() } else { format!(". Note: {}", notes.join("; ")) }), false); Ok(()) }).await))
}

// ---------------------------------------------------------------- worlds
fn saves(c: &Core, i: &Value) -> PathBuf { c.game_dir(i).join("saves") }
fn unique_dir(parent: &Path, base: &str) -> PathBuf { let n = { let s = sanitize(base); if s.is_empty() { "World".into() } else { s } }; let mut d = parent.join(&n); let mut k = 2; while exists(&d) { d = parent.join(format!("{} ({})", n, k)); k += 1; } d }
pub async fn world_import(c: &C, id: &str, kind: &str) -> R<Value> {
    let i = c.must_inst(id)?; std::fs::create_dir_all(saves(c, &i))?;
    let src = if kind == "folder" { pick_open(c, "Pick a world folder", &[], true).await } else { pick_open(c, "Pick a world .zip", &[("World", &["zip"])], false).await }; let Some(src) = src else { return Ok(Value::Null) };
    Ok(job_result(start_job(c, "Importing world", |j| async move {
        j.stage("Importing world", 0); let sv = saves(c, &i);
        if kind == "folder" { if !exists(src.join("level.dat")) { return bail("That folder has no level.dat, so it is not a Minecraft world"); } let d = unique_dir(&sv, &file_name_str(&src)); let (s2, d2) = (src.clone(), d.clone()); blocking(move || copy_dir(&s2, &d2, &|p| p.to_string_lossy().ends_with("session.lock"))).await?; c.toast(format!("Imported {}", file_name_str(&d)), false); return Ok(()); }
        let (s2, sv2) = (src.clone(), sv.clone()); let name = file_stem_str(&src);
        let (d, n) = blocking(move || -> R<(PathBuf, usize)> {
            let mut z = zip::ZipArchive::new(std::fs::File::open(&s2)?)?; let names: Vec<String> = (0..z.len()).filter_map(|k| z.by_index(k).ok().map(|e| e.name().replace('\\', "/"))).collect();
            let lv = names.iter().filter(|n| (n.as_str() == "level.dat" || (n.ends_with("/level.dat") && n.split('/').count() <= 2))).min_by_key(|n| n.split('/').count()).cloned().ok_or(E("No level.dat found in that zip, so it is not a Minecraft world".into()))?;
            let top = if lv.contains('/') { lv[..lv.find('/').unwrap() + 1].to_string() } else { String::new() }; let d = unique_dir(&sv2, &if top.is_empty() { name } else { top[..top.len() - 1].to_string() }); let mut n = 0;
            for k in 0..z.len() { let mut e = z.by_index(k)?; let nm = e.name().replace('\\', "/"); if e.is_dir() || !nm.starts_with(&top) { continue; } let rel = &nm[top.len()..]; if !safe_rel(rel) { continue; } let dest = d.join(rel); if let Some(p) = dest.parent() { std::fs::create_dir_all(p)?; } let mut f = std::fs::File::create(&dest)?; std::io::copy(&mut e, &mut f)?; n += 1; }
            Ok((d, n)) }).await?;
        c.toast(format!("Imported {} ({} files)", file_name_str(&d), n), false); Ok(())
    }).await))
}
pub async fn world_export(c: &C, id: &str, world: &str) -> R<Value> {
    let i = c.must_inst(id)?; let w = file_name_str(Path::new(world)); let src = saves(c, &i).join(&w); if !exists(&src) { return bail("World not found"); }
    let Some(out) = pick_save(c, "Export world", &format!("{}.zip", sanitize(world)), &[("Zip", &["zip"])]).await else { return Ok(Value::Null) };
    Ok(job_result(start_job(c, &format!("Exporting {}", world), |j| async move { j.stage("Zipping the world", 0); let (o2, w2) = (out.clone(), w.clone()); blocking(move || zip_folder(&src, &o2, &w2, &|r: &str| r.ends_with("session.lock"))).await?; c.toast("World exported", false); reveal(c, &out); Ok(()) }).await))
}
pub async fn world_copy(c: &C, id: &str, world: &str) -> R<Value> {
    let i = c.must_inst(id)?; let w = file_name_str(Path::new(world)); let src = saves(c, &i).join(&w); if !exists(&src) { return bail("World not found"); } if c.is_running(id) { return bail("Close the game first"); }
    Ok(job_result(start_job(c, &format!("Copying {}", world), |j| async move { j.stage("Copying the world", 0); let d = unique_dir(&saves(c, &i), &format!("{} (copy)", w)); let d2 = d.clone(); blocking(move || copy_dir(&src, &d2, &|p| p.to_string_lossy().ends_with("session.lock"))).await?; c.toast(format!("Copied to {}", file_name_str(&d)), false); Ok(()) }).await))
}
pub fn copy_options(c: &Core, from: &str, to: &str) -> R<Value> {
    let a = c.must_inst(from)?; let b = c.must_inst(to)?; if gs(&a, "id") == gs(&b, "id") { return bail("Pick another instance"); } if c.is_running(to) { return bail("Close the game first"); }
    std::fs::create_dir_all(c.game_dir(&b))?; let mut n = 0; for f in ["options.txt", "optionsof.txt", "servers.dat"] { if exists(c.game_dir(&a).join(f)) { std::fs::copy(c.game_dir(&a).join(f), c.game_dir(&b).join(f))?; n += 1; } }
    if n == 0 { return bail(format!("{} has no settings to copy yet. Launch it once first.", gs(&a, "name"))); } Ok(json!(n))
}

// ---------------------------------------------------------------- capes
async fn cape_file(c: &C, url: &str) -> String {
    let id: String = sha1_hex(url.as_bytes()).chars().take(16).collect(); let f = c.p(&["skins", "capes", &format!("{}.png", id)]);
    if !exists(&f) { if let Ok(b) = get_bytes(c, url, 1).await { let _ = std::fs::create_dir_all(c.p(&["skins", "capes"])); let _ = std::fs::write(&f, b); } }
    if exists(&f) { asset_url(&f) } else { String::new() }
}
async fn shape_capes(c: &C, j: &Value) -> Value { let mut out = vec![]; for cp in arr(j, "capes") { out.push(json!({ "id": cp["id"], "alias": if gs(cp, "alias").is_empty() { "Cape".into() } else { gs(cp, "alias") }, "active": gs(cp, "state").to_uppercase() == "ACTIVE", "url": if gs(cp, "url").is_empty() { String::new() } else { cape_file(c, &gs(cp, "url")).await } })); } json!(out) }
async fn cape_call(c: &C, method: &str, body: Option<Value>) -> R<Value> {
    ensure_ms_token(c).await?; if active_ms(&c.st()).is_none() { return bail("Sign in with a Microsoft account to use capes"); }
    let base = std::env::var("OC_MS_SERVICES_BASE").unwrap_or("https://api.minecraftservices.com".into());
    for attempt in 0..2 {
        let a = active_ms(&c.st()).unwrap(); let url = format!("{}/minecraft/profile{}", base, if method == "GET" { "" } else { "/capes/active" });
        let mut rq = match method { "GET" => c.http.get(&url), "PUT" => c.http.put(&url), _ => c.http.delete(&url) }.bearer_auth(dec_tok(&gs(&a, "mcToken"))).timeout(std::time::Duration::from_secs(20)); if let Some(b) = &body { rq = rq.json(b); }
        let r = rq.send().await?; let st = r.status().as_u16();
        if st == 401 && attempt == 0 { let aid = gs(&a, "id"); c.st_mut(|s| { if let Some(x) = s["msAccounts"].as_array_mut().and_then(|l| l.iter_mut().find(|x| gs(x, "id") == aid)) { x["mcExpires"] = json!(0); } }); ensure_ms_token(c).await?; continue; }
        if st == 429 { return bail("Mojang says capes are being changed too often. Wait a minute."); } if !r.status().is_success() { return bail(format!("Mojang refused (HTTP {})", st)); }
        return Ok(r.json().await.unwrap_or(json!({})));
    }
    bail("Mojang refused (HTTP 401)")
}
pub async fn cape_list(c: &C) -> R<Value> { if active_ms(&c.st()).is_none() { return Ok(json!({ "ms": false, "capes": [] })); } let j = cape_call(c, "GET", None).await?; Ok(json!({ "ms": true, "capes": shape_capes(c, &j).await })) }
pub async fn cape_set(c: &C, id: &str) -> R<Value> { let j = if id.is_empty() { cape_call(c, "DELETE", None).await? } else { cape_call(c, "PUT", Some(json!({ "capeId": id }))).await? }; Ok(json!({ "capes": shape_capes(c, &j).await })) }

// ---------------------------------------------------------------- storage
const SHARED: [(&str, &str); 10] = [("versions", "Game versions"), ("libraries", "Libraries"), ("assets", "Assets (sounds, textures)"), ("runtimes", "Java"), ("rust", "Horizon (Rust) builds"), ("cache", "Download cache"), ("backups", "World backups"), ("snapshots", "Update restore points"), ("skins", "Skins and capes"), ("instances", "Instances")];
pub async fn storage_info(c: &C) -> Value { let mut out = vec![]; for (k, l) in SHARED { let p = c.p(&[k]); let p2 = p.clone(); out.push(json!({ "key": k, "label": l, "bytes": blocking(move || dir_size(&p2, 400000)).await, "path": p.to_string_lossy() })); } json!(out) }
pub async fn storage_clean(c: &C, kind: &str) -> R<Value> {
    let mut freed = 0u64;
    async fn rm(freed: &mut u64, d: PathBuf) { let Ok(md) = std::fs::metadata(&d) else { return }; *freed += if md.is_dir() { let d2 = d.clone(); blocking(move || dir_size(&d2, 400000)).await } else { md.len() }; let _ = if md.is_dir() { std::fs::remove_dir_all(&d) } else { std::fs::remove_file(&d) }; }
    let list = |p: PathBuf| -> Vec<String> { std::fs::read_dir(p).map(|r| r.flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect()).unwrap_or_default() };
    let insts = c.instances.lock().clone();
    match kind {
        "cache" => for f in list(c.p(&["cache"])) { rm(&mut freed, c.p(&["cache", &f])).await; },
        "snapshots" => if exists(c.p(&["snapshots"])) { rm(&mut freed, c.p(&["snapshots"])).await; },
        "backups" => { let re = regex::Regex::new(r"^(.*)__(\d{8}-\d{6})__[a-z]+\.zip$").unwrap();
            for inst in list(c.p(&["backups"])) { let d = c.p(&["backups", &inst]); let mut by: std::collections::HashMap<String, Vec<String>> = Default::default(); for f in list(d.clone()) { if let Some(m) = re.captures(&f) { by.entry(m[1].to_string()).or_default().push(f); } }
                for mut arr in by.into_values() { arr.sort(); arr.pop(); for f in arr { freed += fsize(d.join(&f)).max(0) as u64; let _ = std::fs::remove_file(d.join(&f)); } } } }
        "versions" => { let mut keep = std::collections::HashSet::new(); for i in &insts { if !gs(i, "mc").is_empty() { keep.insert(gs(i, "mc")); } if !gs(i, "versionId").is_empty() { keep.insert(gs(i, "versionId")); } }
            for id in keep.clone() { let j = read_obj(c.p(&["versions", &id, &format!("{}.json", id)])); if !gs(&j, "inheritsFrom").is_empty() { keep.insert(gs(&j, "inheritsFrom")); } }
            for d in list(c.p(&["versions"])) { if !keep.contains(&d) { rm(&mut freed, c.p(&["versions", &d])).await; } } }
        "rust" => { let keep: std::collections::HashSet<String> = insts.iter().filter(|i| gs(i, "loader") == "rust").map(|i| sanitize(&gs(i, "loaderVer"))).collect(); for d in list(c.p(&["rust"])) { if !keep.contains(&d) { rm(&mut freed, c.p(&["rust", &d])).await; } } }
        _ => return bail("Unknown cleanup"),
    }
    push_state(c); Ok(json!(freed))
}
