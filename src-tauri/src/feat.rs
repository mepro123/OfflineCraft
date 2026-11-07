use crate::content::*;
use crate::core::*;
use crate::mc::*;
use crate::util::*;
use regex::Regex;
use serde_json::{json, Value};
use std::io::Write;
use std::path::{Path, PathBuf};

// =============================================================== crash analysis
fn act(id: &str, label: &str, primary: bool) -> Value { json!({ "id": id, "label": label, "primary": primary }) }
fn rx(p: &str) -> Regex { Regex::new(p).unwrap() }
pub fn analyze_crash(text: &str, loader: &str, ram_mb: i64, code: i64) -> Value {
    let t = text; let res = |id: &str, title: &str, detail: String, actions: Vec<Value>, mods: Vec<String>| json!({ "id": id, "title": title, "detail": detail, "actions": actions, "mods": mods });
    let has = |p: &str| rx(p).is_match(t);
    if let Some(m) = rx(r"(?i)class file version (\d+)\.\d+[^\n]*?(?:recognizes|only recognizes)[^\n]*?up to (\d+)\.\d+").captures(t).or(rx(r"UnsupportedClassVersionError[^\n]*?(\d+)\.\d+").captures(t)) {
        let need = (m[1].parse::<i64>().unwrap_or(52) - 44).max(8);
        return res("java-version", "This needs a newer Java", format!("The game or one of its mods needs Java {} or newer, but an older Java was used.", need), vec![act("autojava", "Pick the right Java automatically", true), act("console", "Open the console", false)], vec![]);
    }
    if let Some(m) = rx(r"Unsupported major\.minor version (\d+)\.\d+").captures(t) { let need = (m[1].parse::<i64>().unwrap_or(52) - 44).max(8); return res("java-version", "This needs a newer Java", format!("A mod needs Java {} or newer.", need), vec![act("autojava", "Pick the right Java automatically", true), act("console", "Open the console", false)], vec![]); }
    if has(r"(?i)Could not reserve enough space|Invalid maximum heap size|There is insufficient memory for the Java Runtime|Error occurred during initialization of VM[\s\S]{0,200}(?:heap|memory)") { return res("ram-too-high", "Not enough free memory to start", "The game asked for more memory than your PC could give it. Lowering the memory setting usually fixes this. Close other programs too.".into(), vec![act("lessram", "Lower the memory", true), act("console", "Open the console", false)], vec![]); }
    if has(r"java\.lang\.OutOfMemoryError|GC overhead limit exceeded|Java heap space") { return res("out-of-memory", "The game ran out of memory", format!("Minecraft used all of its {} MB. Giving it more memory (or removing heavy mods and shaders) fixes this.", if ram_mb > 0 { ram_mb.to_string() } else { "allowed".into() }), vec![act("moreram", "Give it more memory", true), act("safe", "Try safe mode (no mods)", false)], vec![]); }
    if has(r"(?i)Unrecognized (?:VM )?option|Unrecognized VM option|Could not create the Java Virtual Machine") { return res("jvm-args", "A Java option is not supported", "One of the extra Java arguments is not understood by this Java version, so the game could not start.".into(), vec![act("clearjvm", "Remove the extra Java arguments", true), act("autojava", "Pick the right Java automatically", false)], vec![]); }
    if has(r"Could not find or load main class|Error: Unable to initialize main class|java\.lang\.ClassNotFoundException: net\.minecraft\.client\.main") { return res("corrupt", "Some game files are missing or damaged", "A required file could not be found. Re-checking the files normally fixes this.".into(), vec![act("repair", "Verify and repair the files", true), act("console", "Open the console", false)], vec![]); }
    if has(r"(?i)Failed to load level|Exception reading [^\n]*level\.dat|Failed to read [^\n]*\.mca|Unable to read the world|Level read error") { return res("world", "A world could not be loaded", "A world file looks damaged. You can restore it from an automatic backup.".into(), vec![act("backups", "Open the backups", true), act("safe", "Try safe mode (no mods)", false)], vec![]); }
    let mut mods: Vec<String> = vec![]; let mut dep: Vec<String> = vec![]; let mut addm = |m: &mut Vec<String>, s: &str| { if !m.contains(&s.to_string()) { m.push(s.to_string()); } };
    for x in rx(r"Mod '([^']+)'[^\n]*?requires[^\n]*?'([^']+)'[^\n]*").captures_iter(t) { dep.push(format!("{} needs {}", &x[1], &x[2])); addm(&mut mods, &x[1]); addm(&mut mods, &x[2]); }
    for x in rx(r"Mod ID: '([^']+)', Requested by: '([^']+)'").captures_iter(t) { dep.push(format!("{} needs {}", &x[2], &x[1])); addm(&mut mods, &x[2]); addm(&mut mods, &x[1]); }
    if !dep.is_empty() || has(r"(?i)Incompatible mod set|Missing or unsupported mandatory dependencies|Mod resolution failed|Some of your mods are incompatible") {
        let mut list: Vec<String> = vec![]; for d in dep { if !list.contains(&d) { list.push(d); } } list.truncate(6);
        let detail = format!("{}Updating everything usually fixes mismatched versions. Safe mode starts the game without any mods so you can check.", if list.is_empty() { String::new() } else { format!("Problems found:\n{}\n\n", list.iter().map(|x| format!("• {}", x)).collect::<Vec<_>>().join("\n")) });
        mods.truncate(12); return res("mod-deps", "Some mods need other mods or a different version", detail, vec![act("updateall", "Update everything", true), act("safe", "Try safe mode (no mods)", false), act("undo", "Undo the last update", false)], mods);
    }
    if has(r"(?i)Found duplicate mods|Duplicate mods? (?:found|detected)|DuplicateModsFoundException") { return res("duplicate", "The same mod is installed twice", "Two copies (or two versions) of one mod are in the mods folder. Remove one of them.".into(), vec![act("mods", "Open the mods list", true), act("safe", "Try safe mode (no mods)", false)], vec![]); }
    if has(r"Mixin apply failed|MixinApplyError|InvalidMixinException|Mixin transformation of [^\n]* failed|MixinTransformerError") {
        for x in rx(r"([\w-]+)\.mixins?\.json").captures_iter(t) { if !rx(r"^(?:minecraft|mixins?)$").is_match(&x[1]) { addm(&mut mods, &x[1]); } }
        let detail = format!("A mod tried to change the game in a way another mod (or this game version) does not allow.{}", if mods.is_empty() { String::new() } else { format!("\nMods involved: {}", mods.iter().take(6).cloned().collect::<Vec<_>>().join(", ")) }); mods.truncate(12);
        return res("mixin", "Two mods conflict with each other", detail, vec![act("updateall", "Update everything", true), act("safe", "Try safe mode (no mods)", false), act("mods", "Open the mods list", false)], mods);
    }
    if has(r"NoSuchMethodError|NoSuchFieldError|NoClassDefFoundError|AbstractMethodError|IncompatibleClassChangeError") { return res("mod-mismatch", "A mod does not match this game version", "A mod was built for a different Minecraft or loader version. Updating the mods normally fixes it.".into(), vec![act("updateall", "Update everything", true), act("safe", "Try safe mode (no mods)", false), act("undo", "Undo the last update", false)], vec![]); }
    if has(r"(?i)GLFW error 65542|WGL: The driver does not appear to support OpenGL|Pixel format not accelerated|GLFW error 65543|Failed to create window|OpenGL (?:version|context)[^\n]*(?:not supported|unsupported)") { return res("opengl", "Your graphics driver is not supported", "The game could not start OpenGL. Update your graphics driver (NVIDIA, AMD or Intel). On a laptop, make sure Java uses the dedicated graphics card.".into(), vec![act("console", "Open the console", true), act("safe", "Try safe mode (no mods)", false)], vec![]); }
    if has(r"EXCEPTION_ACCESS_VIOLATION|SIGSEGV|A fatal error has been detected by the Java Runtime|hs_err_pid") { return res("native-crash", "Java or the graphics driver crashed", "This is usually a graphics driver problem, or a mod or shader that does not agree with it. Update your graphics driver and try safe mode.".into(), vec![act("safe", "Try safe mode (no mods)", true), act("console", "Open the console", false)], vec![]); }
    if has(r"(?i)UnknownHostException|Connection timed out|SSLHandshakeException|Failed to download") && code != 0 { return res("network", "A file could not be downloaded", "Something the game needed could not be downloaded. Check your internet connection, then verify the files.".into(), vec![act("repair", "Verify and repair the files", true)], vec![]); }
    if loader == "rust" { return res("rust", "Horizon (Rust) stopped unexpectedly", "Horizon is still under development. Updating to the newest build, or preparing it again, often fixes crashes.".into(), vec![act("updateall", "Update Horizon", true), act("repair", "Prepare it again", false), act("console", "Open the console", false)], vec![]); }
    let err: String = t.lines().rev().find(|l| rx(r"Exception|Error|FATAL").is_match(l)).unwrap_or("").trim().chars().take(200).collect();
    res("unknown", "The game closed unexpectedly", format!("{}It exited with code {}. Safe mode (no mods) tells you whether a mod is the cause.", if err.is_empty() { String::new() } else { format!("Last error: {}\n\n", err) }, code), vec![act("safe", "Try safe mode (no mods)", true), act("console", "Open the console", false), act("copy", "Copy a crash report", false)], vec![])
}

// =============================================================== backups
const BIG_WORLD: u64 = 3 * 1024 * 1024 * 1024;
fn saves(c: &Core, i: &Value) -> PathBuf { c.game_dir(i).join("saves") }
fn bdir(c: &Core, i: &Value) -> PathBuf { c.p(&["backups", &gs(i, "id")]) }
fn parse_backup(f: &str) -> Option<(String, i64, String)> { let m = rx(r"^(.*)__(\d{8}-\d{6})__([a-z]+)\.zip$").captures(f)?; Some((m[1].to_string(), stamp_to_ms(&m[2]), m[3].to_string())) }
pub fn list_backups(c: &Core, i: &Value) -> Vec<Value> {
    let mut v: Vec<Value> = std::fs::read_dir(bdir(c, i)).map(|r| r.flatten().filter_map(|e| { let f = e.file_name().to_string_lossy().to_string(); let (w, ts, r) = parse_backup(&f)?; Some(json!({ "file": f, "world": w, "ts": ts, "reason": r, "size": fsize(e.path()), "mtime": mtime_ms(&e.path()) })) }).collect()).unwrap_or_default();
    v.sort_by_key(|b| std::cmp::Reverse(gi(b, "ts"))); v
}
fn prune(c: &Core, i: &Value, world: &str) { let keep = { let k = gi(&c.st(), "backupKeep"); if k > 0 { k } else { 5 } } as usize; let w = sanitize(world); for b in list_backups(c, i).into_iter().filter(|b| gs(b, "world") == w).skip(keep) { let _ = std::fs::remove_file(bdir(c, i).join(gs(&b, "file"))); } }
pub fn zip_folder(src: &Path, zip_path: &Path, prefix: &str, skip: &(dyn Fn(&str) -> bool + Sync)) -> R<()> {
    if let Some(d) = zip_path.parent() { std::fs::create_dir_all(d)?; }
    let mut z = zip::ZipWriter::new(std::fs::File::create(zip_path)?); let o = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for e in walkdir::WalkDir::new(src).into_iter().flatten() { if !e.file_type().is_file() { continue; } let rel = e.path().strip_prefix(src).unwrap().to_string_lossy().replace('\\', "/"); if skip(&rel) { continue; }
        z.start_file(if prefix.is_empty() { rel } else { format!("{}/{}", prefix, rel) }, o)?; let mut f = std::fs::File::open(e.path())?; std::io::copy(&mut f, &mut z)?; }
    z.finish()?; Ok(())
}
pub async fn backup_world(c: &C, i: &Value, world: &str, reason: &str) -> R<Option<PathBuf>> {
    let src = saves(c, i).join(world); if !exists(&src) { return bail("World not found"); }
    let s2 = src.clone(); if blocking(move || dir_size(&s2, 200000)).await > BIG_WORLD { c.log(format!("backup: {} is over 3 GB, skipped", world)); return Ok(None); }
    let out = bdir(c, i).join(format!("{}__{}__{}.zip", sanitize(world), stamp(), reason)); let (o2, w2) = (out.clone(), world.to_string());
    blocking(move || zip_folder(&src, &o2, &w2, &|r: &str| r.ends_with("session.lock"))).await?; prune(c, i, world); Ok(Some(out))
}
fn world_names(c: &Core, i: &Value) -> Vec<String> { std::fs::read_dir(saves(c, i)).map(|r| r.flatten().filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false)).map(|e| e.file_name().to_string_lossy().to_string()).collect()).unwrap_or_default() }
fn newest_mtime(dir: &Path) -> f64 { let mut best = 0f64; for f in ["level.dat", "level.dat_old"] { best = best.max(mtime_ms(&dir.join(f))); } if best == 0.0 { best = mtime_ms(dir); } best }
pub async fn auto_backup(c: &C, i: &Value, j: Option<&JobRef>, reason: &str) -> usize {
    if c.st().get("autoBackup") == Some(&json!(false)) { return 0; } let mut n = 0;
    for w in world_names(c, i) {
        let last = list_backups(c, i).iter().filter(|b| gs(b, "world") == sanitize(&w)).map(|b| mtime_ms_val(b)).fold(0f64, f64::max); let changed = newest_mtime(&saves(c, i).join(&w));
        if last > 0.0 && changed <= last { continue; } if let Some(j) = j { j.label(format!("Backing up {}", w)); }
        match backup_world(c, i, &w, reason).await { Ok(Some(_)) => n += 1, Ok(None) => {} Err(e) => c.log(format!("backup {}: {}", w, e.0)) }
    }
    n
}
fn mtime_ms_val(b: &Value) -> f64 { b["mtime"].as_f64().unwrap_or(0.0) }
pub async fn backup_now(c: &C, id: &str, world: &str) -> R<Value> {
    let i = c.must_inst(id)?; let title = format!("Backing up {}", if world.is_empty() { gs(&i, "name") } else { world.to_string() });
    Ok(job_result(start_job(c, &title, |j| async move { if !world.is_empty() { j.stage(format!("Backing up {}", world), 0); backup_world(c, &i, world, "manual").await?; } else { let w = world_names(c, &i); if w.is_empty() { return bail("There are no worlds to back up yet"); } for x in w { j.stage(format!("Backing up {}", x), 0); backup_world(c, &i, &x, "manual").await?; } } c.toast("Backup done", false); Ok(()) }).await))
}
pub async fn backup_restore(c: &C, id: &str, file: &str) -> R<Value> {
    let i = c.must_inst(id)?; let file = file_name_str(Path::new(file)); let (world, _, _) = parse_backup(&file).ok_or(E("Not a backup file".into()))?; let zf = bdir(c, &i).join(&file); if !exists(&zf) { return bail("Backup file is missing"); }
    if c.is_running(id) { return bail("Close the game first"); }
    Ok(job_result(start_job(c, &format!("Restoring {}", world), |j| async move {
        j.stage(format!("Restoring {}", world), 0); let (zf2, sv) = (zf.clone(), saves(c, &i));
        blocking(move || -> R<()> { let mut z = zip::ZipArchive::new(std::fs::File::open(&zf2)?)?; for k in 0..z.len() { let n = z.by_index(k)?.name().replace('\\', "/"); if !safe_rel(&n) { return bail("Backup contains unsafe paths"); } } std::fs::create_dir_all(&sv)?; let target = sv.join(&world_of(&zf2)); let _ = target; Ok(()) }).await?;
        std::fs::create_dir_all(saves(c, &i))?; let target = saves(c, &i).join(&world);
        if exists(&target) { std::fs::rename(&target, format!("{} (before restore {})", target.to_string_lossy(), stamp()))?; }
        let (zf3, sv3) = (zf.clone(), saves(c, &i)); blocking(move || -> R<()> { let mut z = zip::ZipArchive::new(std::fs::File::open(&zf3)?)?; z.extract(&sv3)?; Ok(()) }).await?;
        c.toast(format!("{} restored", world), false); Ok(())
    }).await))
}
fn world_of(p: &Path) -> String { parse_backup(&file_name_str(p)).map(|x| x.0).unwrap_or_default() }
pub fn backup_delete(c: &Core, id: &str, file: &str) -> R<bool> { let i = c.must_inst(id)?; let f = file_name_str(Path::new(file)); if parse_backup(&f).is_none() { return Ok(false); } let _ = std::fs::remove_file(bdir(c, &i).join(f)); Ok(true) }
pub fn backup_dir_path(c: &Core, id: &str) -> R<PathBuf> { let i = c.must_inst(id)?; let d = bdir(c, &i); std::fs::create_dir_all(&d)?; Ok(d) }

// =============================================================== worlds + screenshots
pub async fn world_sizes(c: &C, id: &str) -> R<Value> { let i = c.must_inst(id)?; let mut out = serde_json::Map::new(); for w in world_names(c, &i) { let p = saves(c, &i).join(&w); out.insert(w, json!(blocking(move || dir_size(&p, 30000)).await)); } Ok(Value::Object(out)) }
pub fn shot_list(c: &Core, id: &str) -> R<Value> {
    let i = c.must_inst(id)?; let dir = c.game_dir(&i).join("screenshots"); let re = rx(r"(?i)\.(png|jpe?g)$");
    let mut v: Vec<Value> = std::fs::read_dir(&dir).map(|r| r.flatten().filter(|e| re.is_match(&e.file_name().to_string_lossy())).filter_map(|e| { let md = e.metadata().ok()?; Some(json!({ "file": e.file_name().to_string_lossy(), "url": asset_url(&e.path()), "size": md.len(), "mtime": mtime_ms(&e.path()) })) }).collect()).unwrap_or_default();
    v.sort_by(|a, b| b["mtime"].as_f64().partial_cmp(&a["mtime"].as_f64()).unwrap()); v.truncate(400); Ok(json!(v))
}
pub fn shot_path(c: &Core, id: &str, file: &str) -> R<PathBuf> { let i = c.must_inst(id)?; Ok(c.game_dir(&i).join("screenshots").join(file_name_str(Path::new(file)))) }

// =============================================================== safe mode
fn hold_dir(c: &Core, i: &Value) -> PathBuf { c.dir_inst(i).join("safe-hold") }
pub fn hold_mods(c: &Core, i: &Value) -> R<usize> {
    let dir = content_dir(c, i, "mod"); let files: Vec<_> = std::fs::read_dir(&dir).map(|r| r.flatten().map(|e| e.file_name()).collect()).unwrap_or_default();
    if files.is_empty() || exists(hold_dir(c, i)) { return Ok(0); } std::fs::create_dir_all(hold_dir(c, i))?; for f in &files { std::fs::rename(dir.join(f), hold_dir(c, i).join(f))?; } Ok(files.len())
}
pub fn release_mods(c: &Core, i: &Value) -> usize {
    let h = hold_dir(c, i); if !exists(&h) { return 0; } let dir = content_dir(c, i, "mod"); let _ = std::fs::create_dir_all(&dir); let mut n = 0;
    if let Ok(rd) = std::fs::read_dir(&h) { for e in rd.flatten() { let dest = dir.join(e.file_name()); if !exists(&dest) { match std::fs::rename(e.path(), &dest) { Ok(()) => n += 1, Err(er) => c.log(format!("safe mode restore {}: {}", e.file_name().to_string_lossy(), er)) } } } }
    let _ = std::fs::remove_dir(&h); n
}
pub fn restore_holds(c: &Core) { let list = c.instances.lock().clone(); for i in list { if exists(hold_dir(c, &i)) { let n = release_mods(c, &i); c.log(format!("safe mode: put {} mods back for {}", n, gs(&i, "name"))); } } }

// =============================================================== snapshots (undo)
fn sdir(c: &Core, i: &Value) -> PathBuf { c.p(&["snapshots", &gs(i, "id")]) }
fn snapshot(c: &Core, i: &Value, why: &str) -> R<PathBuf> {
    let mut dest = sdir(c, i).join(stamp()); let mut n = 1; while exists(&dest) { dest = sdir(c, i).join(format!("{}-{}", stamp(), n)); n += 1; } std::fs::create_dir_all(&dest)?;
    let mods = content_dir(c, i, "mod"); if exists(&mods) { copy_dir(&mods, &dest.join("mods"), &|_| false)?; }
    let cj = c.dir_inst(i).join("content.json"); if exists(&cj) { std::fs::copy(&cj, dest.join("content.json"))?; }
    write_json(dest.join("meta.json"), &json!({ "why": why, "mc": i["mc"], "loaderVer": i["loaderVer"], "versionId": i["versionId"], "loader": i["loader"], "at": now_ms() }));
    let mut all: Vec<String> = std::fs::read_dir(sdir(c, i))?.flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect(); all.sort(); let k = all.len().saturating_sub(2); for old in &all[..k] { let _ = std::fs::remove_dir_all(sdir(c, i).join(old)); }
    Ok(dest)
}
fn latest_snapshot(c: &Core, i: &Value) -> Option<PathBuf> { let mut all: Vec<String> = std::fs::read_dir(sdir(c, i)).ok()?.flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect(); all.sort(); all.last().map(|l| sdir(c, i).join(l)) }
fn restore_snapshot(c: &Core, i: &mut Value, dir: &Path) -> R<Value> {
    let meta = read_obj(dir.join("meta.json")); let mods = content_dir(c, i, "mod"); let _ = std::fs::remove_dir_all(&mods);
    if exists(dir.join("mods")) { copy_dir(&dir.join("mods"), &mods, &|_| false)?; } else { std::fs::create_dir_all(&mods)?; }
    if exists(dir.join("content.json")) { std::fs::copy(dir.join("content.json"), c.dir_inst(i).join("content.json"))?; }
    i["mc"] = meta["mc"].clone(); i["loaderVer"] = meta["loaderVer"].clone(); i["versionId"] = meta["versionId"].clone(); i["ready"] = json!(false); c.save_inst(i); Ok(meta)
}

// =============================================================== update everything / switch version
async fn sync_mods(c: &C, i: &Value, mc: &str, j: &JobRef, disable_unmatched: bool) -> R<(i64, Vec<String>)> {
    let dir = content_dir(c, i, "mod"); let files: Vec<String> = std::fs::read_dir(&dir).map(|r| r.flatten().map(|e| e.file_name().to_string_lossy().to_string()).filter(|f| f.ends_with(".jar") || f.ends_with(".jar.disabled")).collect()).unwrap_or_default();
    let (mut updated, mut disabled) = (0i64, vec![]); if files.is_empty() { return Ok((0, disabled)); }
    j.stage(format!("Checking mods for {}", mc), files.len() as i64); let mut hashes = std::collections::HashMap::new();
    for f in &files { let p = dir.join(f); hashes.insert(blocking(move || sha1_file(&p)).await?, f.clone()); }
    let mut body = json!({ "hashes": hashes.keys().collect::<Vec<_>>(), "algorithm": "sha1", "game_versions": [mc] }); if gs(i, "loader") != "vanilla" { body["loaders"] = json!([gs(i, "loader")]); }
    let res: Value = c.http.post(format!("{}/version_files/update", MR)).json(&body).send().await?.json().await?; let rp = c.dir_inst(i).join("content.json");
    for (h, f) in &hashes {
        if j.cancelled() { return bail("cancelled"); } let off = f.ends_with(".disabled"); let base = if off { f[..f.len() - 9].to_string() } else { f.clone() }; let v = &res[h]; let pf = if v.is_object() { primary_file(v) } else { None };
        if let Some(pf) = pf.as_ref().filter(|pf| gs(&pf["hashes"], "sha1") != *h) {
            j.label(format!("Updating {}", base)); let nf = sanitize(&gs(pf, "filename")); let nf_full = format!("{}{}", nf, if off { ".disabled" } else { "" }); download(c, &gs(pf, "url"), &dir.join(&nf_full), Some(j)).await?;
            let mut r = read_obj(&rp); let prev = r[&base].clone(); r.as_object_mut().map(|o| o.remove(&base)); let mut n = if prev.is_object() { prev } else { json!({}) }; n["version"] = v["version_number"].clone(); n["sha1"] = pf["hashes"]["sha1"].clone(); r[&nf] = n; write_json(&rp, &r);
            if &nf_full != f { let _ = std::fs::remove_file(dir.join(f)); } updated += 1;
        } else if pf.is_none() && disable_unmatched && !off { std::fs::rename(dir.join(f), dir.join(format!("{}.disabled", f)))?; disabled.push(base); }
        j.tick();
    }
    Ok((updated, disabled))
}
async fn latest_loader(c: &C, loader: &str, mc: &str) -> String { let v = list_loader_versions(c, loader, mc).await; v.iter().find(|x| gb(x, "stable")).or(v.first()).map(|x| gs(x, "version")).unwrap_or_default() }
fn loader_name(l: &str) -> &'static str { match l { "fabric" => "Fabric", "quilt" => "Quilt", "forge" => "Forge", "neoforge" => "NeoForge", "rust" => "Rust", _ => "Vanilla" } }
async fn update_everything(c: &C, id: &str, j: &JobRef) -> R<()> {
    let mut i = c.must_inst(id)?; if c.is_running(id) { return bail("Close the game first"); }
    j.stage("Backing up worlds", 0); auto_backup(c, &i, Some(j), "update").await; j.stage("Saving a restore point", 0); snapshot(c, &i, "update")?; let mut summary: Vec<String> = vec![];
    let r: R<()> = async {
        if gs(&i, "loader") == "rust" {
            j.stage("Checking for a new Horizon build", 0); let v = rust_versions(c, RUST_MC).await?; let latest = v.first().map(|x| gs(x, "version")).unwrap_or_default();
            if latest.is_empty() { return bail("Could not reach the Horizon releases"); }
            if latest != gs(&i, "loaderVer") { i["loaderVer"] = json!(latest); i["versionId"] = json!(""); i["ready"] = json!(false); summary.push(format!("Horizon {}", latest)); } else { summary.push("Horizon is already up to date".into()); }
        } else {
            let loader = gs(&i, "loader");
            if loader != "vanilla" { j.stage(format!("Checking the {} version", loader_name(&loader)), 0); let lv = latest_loader(c, &loader, &gs(&i, "mc")).await; if !lv.is_empty() && lv != gs(&i, "loaderVer") { i["loaderVer"] = json!(lv); i["versionId"] = json!(""); i["ready"] = json!(false); summary.push(format!("{} {}", loader_name(&loader), lv)); } }
            let (u, _) = sync_mods(c, &i, &gs(&i, "mc"), j, false).await?; if u > 0 { summary.push(format!("{} mod{}", u, if u > 1 { "s" } else { "" })); }
        }
        c.save_inst(&i); if !gb(&i, "ready") { run_prepare(c, &mut i, j).await?; } i["lastUpdate"] = json!({ "at": now_ms(), "kind": "update" }); c.save_inst(&i); push_state(c);
        c.toast(if summary.is_empty() { "Everything is already up to date".to_string() } else { format!("Updated: {}", summary.join(", ")) }, false); Ok(())
    }.await;
    if let Err(e) = r { if let Some(s) = latest_snapshot(c, &i) { let mut cur = c.get_inst(id).unwrap_or(i.clone()); if let Err(e2) = restore_snapshot(c, &mut cur, &s) { c.log(format!("rollback: {}", e2.0)); } else { let _ = std::fs::remove_dir_all(&s); } } push_state(c); return Err(e); }
    Ok(())
}
pub async fn update_everything_api(c: &C, id: &str) -> R<Value> { let i = c.must_inst(id)?; Ok(job_result(start_job(c, &format!("Updating {}", gs(&i, "name")), |j| async move { update_everything(c, id, &j).await }).await)) }
pub fn has_undo(c: &Core, id: &str) -> Value { c.get_inst(id).and_then(|i| latest_snapshot(c, &i)).map(|s| read_obj(s.join("meta.json"))).unwrap_or(Value::Null) }
pub async fn undo_update(c: &C, id: &str) -> R<Value> {
    let i = c.must_inst(id)?; let s = latest_snapshot(c, &i).ok_or(E("Nothing to undo".into()))?; if c.is_running(id) { return bail("Close the game first"); }
    Ok(job_result(start_job(c, "Undoing the last update", |j| async move { j.stage("Restoring mods", 0); let mut i = i; restore_snapshot(c, &mut i, &s)?; let _ = std::fs::remove_dir_all(&s); run_prepare(c, &mut i, &j).await?; push_state(c); c.toast("Went back to the version before the update", false); Ok(()) }).await))
}
pub async fn change_version(c: &C, id: &str, new_mc: &str) -> R<Value> {
    let i = c.must_inst(id)?; let new_mc = new_mc.trim().to_string(); if new_mc.is_empty() { return bail("Pick a version first"); } if new_mc == gs(&i, "mc") { return bail(format!("It is already on {}", new_mc)); }
    if gs(&i, "loader") == "rust" { return bail(format!("Horizon only supports Minecraft {}", RUST_MC)); } if c.is_running(id) { return bail("Close the game first"); }
    Ok(job_result(start_job(c, &format!("Switching {} to {}", gs(&i, "name"), new_mc), |j| async move {
        let mut i = i; let old = (gs(&i, "mc"), gs(&i, "loaderVer"), gs(&i, "versionId")); let loader = gs(&i, "loader");
        j.stage(format!("Checking {}", new_mc), 0); ensure_vanilla_json(c, &new_mc).await?;
        let mut lv = String::new(); if loader != "vanilla" { lv = latest_loader(c, &loader, &new_mc).await; if lv.is_empty() { return bail(format!("{} has no build for Minecraft {} yet", loader_name(&loader), new_mc)); } }
        j.stage("Backing up worlds", 0); auto_backup(c, &i, Some(&j), "version").await; j.stage("Saving a restore point", 0); snapshot(c, &i, "version")?;
        let r: R<()> = async {
            i["mc"] = json!(new_mc); i["loaderVer"] = json!(lv); i["versionId"] = json!(""); i["ready"] = json!(false); c.save_inst(&i);
            let (mut upd, mut dis) = (0, vec![]); if loader != "vanilla" { let r = sync_mods(c, &i, &new_mc, &j, true).await?; upd = r.0; dis = r.1; }
            run_prepare(c, &mut i, &j).await?; i["lastUpdate"] = json!({ "at": now_ms(), "kind": "version", "from": old.0 }); c.save_inst(&i); push_state(c);
            c.toast(format!("Now on {}.{}{}", new_mc, if upd > 0 { format!(" {} mod{} updated.", upd, if upd > 1 { "s" } else { "" }) } else { String::new() }, if !dis.is_empty() { format!(" {} mod{} without a {} version were turned off.", dis.len(), if dis.len() > 1 { "s" } else { "" }, new_mc) } else { String::new() }), false);
            if !dis.is_empty() { c.log(format!("switch version: turned off {}", dis.join(", "))); } Ok(())
        }.await;
        if let Err(e) = r { if let Some(s) = latest_snapshot(c, &i) { if restore_snapshot(c, &mut i, &s).is_ok() { let _ = std::fs::remove_dir_all(&s); } } else { i["mc"] = json!(old.0); i["loaderVer"] = json!(old.1); i["versionId"] = json!(old.2); i["ready"] = json!(false); c.save_inst(&i); } push_state(c); return Err(e); }
        Ok(())
    }).await))
}
pub async fn rust_status(c: &C, id: &str) -> R<Value> {
    let i = c.must_inst(id)?; if gs(&i, "loader") != "rust" { return Ok(Value::Null); }
    Ok(match rust_versions(c, RUST_MC).await { Ok(v) => { let latest = v.first().map(|x| gs(x, "version")).unwrap_or_default(); json!({ "current": i["loaderVer"], "latest": latest, "outdated": !latest.is_empty() && latest != gs(&i, "loaderVer") }) } Err(_) => json!({ "current": i["loaderVer"], "latest": "", "outdated": false }) })
}

// =============================================================== crash handling
fn crash_text(c: &Core, i: &Value, r: &Run) -> String {
    let lines = r.lines.lock(); let start = lines.len().saturating_sub(400); let mut extra = String::new(); let gd = c.game_dir(i);
    if let Ok(rd) = std::fs::read_dir(gd.join("crash-reports")) { let mut f: Vec<_> = rd.flatten().map(|e| (mtime_ms(&e.path()), e.path())).filter(|x| x.0 >= (r.started - 5000) as f64).collect(); f.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap()); if let Some((_, p)) = f.first() { extra.push_str(&std::fs::read_to_string(p).unwrap_or_default().chars().take(60000).collect::<String>()); } }
    if let Ok(rd) = std::fs::read_dir(&gd) { let re = rx(r"^hs_err_pid\d+\.log$"); let mut f: Vec<_> = rd.flatten().filter(|e| re.is_match(&e.file_name().to_string_lossy())).map(|e| (mtime_ms(&e.path()), e.path())).filter(|x| x.0 >= (r.started - 5000) as f64).collect(); f.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap()); if let Some((_, p)) = f.first() { extra.push('\n'); extra.push_str(&std::fs::read_to_string(p).unwrap_or_default().chars().take(8000).collect::<String>()); } }
    format!("{}\n{}", lines[start..].join("\n"), extra)
}
pub fn on_exit(c: &C, i: &Value, r: &Run, code: i64, dur: i64) {
    if code == 0 || r.stopped.load(std::sync::atomic::Ordering::Relaxed) { return; }
    let text = crash_text(c, i, r); let ram = if gi(i, "ramMB") > 0 { gi(i, "ramMB") } else { gi(&c.st(), "ramMB") };
    let mut res = analyze_crash(&text, &gs(i, "loader"), ram, code); let mut actions: Vec<Value> = arr(&res, "actions").to_vec(); let loader = gs(i, "loader");
    let recent = i["lastUpdate"].is_object() && now_ms() - gi(&i["lastUpdate"], "at") < 36 * 3_600_00 * 48 / 36 && latest_snapshot(c, i).is_some();
    if actions.iter().any(|a| gs(a, "id") == "undo") && !recent { actions.retain(|a| gs(a, "id") != "undo"); }
    if actions.first().map(|a| gs(a, "id") == "updateall").unwrap_or(false) && loader == "vanilla" { actions.retain(|a| gs(a, "id") != "updateall"); }
    if loader == "vanilla" || loader == "rust" { actions.retain(|a| gs(a, "id") != "safe" && gs(a, "id") != "mods"); }
    res["actions"] = json!(actions); c.log(format!("crash analysis for {}: {}", gs(i, "name"), gs(&res, "id")));
    let tail: Vec<&str> = text.lines().collect(); let tail = tail[tail.len().saturating_sub(120)..].join("\n");
    let diag = gs(&res, "id"); let mut out = res.clone(); out["diag"] = json!(diag); out["id"] = i["id"].clone(); out["name"] = i["name"].clone(); out["code"] = json!(code); out["dur"] = json!(dur);
    out["report"] = json!(["OfflineCraft crash report".to_string(), format!("{} · Minecraft {} · {} {}", gs(i, "name"), gs(i, "mc"), loader, gs(i, "loaderVer")), format!("Exit code {} after {}s", code, dur), format!("Diagnosis: {}", gs(&res, "title")), String::new(), tail].join("\n"));
    c.emit("crash", out);
}
pub fn crash_fix(c: &C, id: &str, action: &str) -> R<bool> {
    let mut i = c.must_inst(id)?; let mem = (sysinfo::System::new_with_specifics(sysinfo::RefreshKind::nothing().with_memory(sysinfo::MemoryRefreshKind::nothing().with_ram())).total_memory() / 1048576) as i64;
    match action {
        "autojava" => i["javaPath"] = json!(""),
        "moreram" => { let cur = if gi(&i, "ramMB") > 0 { gi(&i, "ramMB") } else if gi(&c.st(), "ramMB") > 0 { gi(&c.st(), "ramMB") } else { 2048 }; i["ramMB"] = json!(cur.max((cur + 2048).min(2048.max((mem as f64 * 0.6 / 256.0).floor() as i64 * 256)))); }
        "lessram" => i["ramMB"] = json!(1024.max((mem as f64 * 0.5 / 256.0).floor() as i64 * 256)),
        "clearjvm" => i["jvmArgs"] = json!(""),
        "repair" => { i["ready"] = json!(false); if gs(&i, "loader") == "vanilla" { i["versionId"] = json!(""); } }
        _ => return Ok(false),
    }
    c.save_inst(&i); push_state(c); Ok(true)
}
pub fn undo_available(c: &Core, id: &str) -> bool { c.get_inst(id).map(|i| latest_snapshot(c, &i).is_some()).unwrap_or(false) }

// =============================================================== export as .mrpack
pub async fn export_mrpack(c: &C, id: &str, worlds: bool, target: PathBuf) -> R<Value> {
    let i = c.must_inst(id)?; let loader = gs(&i, "loader");
    Ok(job_result(start_job(c, &format!("Exporting {}", gs(&i, "name")), |j| async move {
        j.stage("Reading files", 0); let gd = c.game_dir(&i); let mut found: Vec<(String, String, PathBuf)> = vec![];
        for sub in ["mods", "resourcepacks", "shaderpacks"] { if let Ok(rd) = std::fs::read_dir(gd.join(sub)) { for e in rd.flatten() { let n = e.file_name().to_string_lossy().to_string(); let l = n.to_lowercase(); if e.file_type().map(|t| t.is_file()).unwrap_or(false) && (l.ends_with(".jar") || l.ends_with(".zip")) { found.push((sub.into(), n, e.path())); } } } }
        j.stage("Hashing files", found.len() as i64); let mut hashed = vec![];
        for (sub, name, full) in found { let f2 = full.clone(); let (s1, s5) = blocking(move || (sha1_file(&f2).unwrap_or_default(), sha512_file(&f2).unwrap_or_default())).await; hashed.push((sub, name, full.clone(), s1, s5, fsize(&full))); j.tick(); }
        j.stage("Matching files with Modrinth", 0); let mut known = serde_json::Map::new();
        for chunk in hashed.chunks(100) { match c.http.post(format!("{}/version_files", MR)).json(&json!({ "hashes": chunk.iter().map(|f| f.3.clone()).collect::<Vec<_>>(), "algorithm": "sha1" })).send().await { Ok(r) => { if let Ok(Value::Object(o)) = r.json::<Value>().await { known.extend(o); } } Err(e) => c.log(format!("export lookup: {}", e)) } }
        let (mut files, mut embed) = (vec![], vec![]);
        for f in &hashed { let v = known.get(&f.3); let vf = v.and_then(|v| arr(v, "files").iter().find(|x| gs(&x["hashes"], "sha1") == f.3).cloned()); match vf.filter(|x| !gs(x, "url").is_empty()) { Some(vf) => files.push(json!({ "path": format!("{}/{}", f.0, f.1), "hashes": { "sha1": f.3, "sha512": f.4 }, "env": { "client": "required", "server": "required" }, "downloads": [vf["url"]], "fileSize": f.5 })), None => embed.push(f.clone()) } }
        j.stage("Writing the pack", 0); let (gd2, t2, i2, nfiles, nembed) = (gd.clone(), target.clone(), i.clone(), files.len(), embed.len()); let sv = saves(c, &i);
        let dk = match loader.as_str() { "fabric" => Some("fabric-loader"), "quilt" => Some("quilt-loader"), "forge" => Some("forge"), "neoforge" => Some("neoforge"), _ => None };
        blocking(move || -> R<()> {
            let mut z = zip::ZipWriter::new(std::fs::File::create(&t2)?); let o = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            let mut add = |z: &mut zip::ZipWriter<std::fs::File>, p: &Path, name: String| -> R<()> { z.start_file(name, o)?; let mut f = std::fs::File::open(p)?; std::io::copy(&mut f, z)?; Ok(()) };
            for f in &embed { add(&mut z, &f.2, format!("overrides/{}/{}", f.0, f.1))?; }
            let mut dirs: Vec<(PathBuf, String, bool)> = ["config", "defaultconfigs", "kubejs", "scripts"].iter().map(|d| (gd2.join(d), format!("overrides/{}", d), false)).collect(); if worlds { dirs.push((sv.clone(), "overrides/saves".into(), true)); }
            for (src, prefix, skip_lock) in dirs { if !exists(&src) { continue; } for e in walkdir::WalkDir::new(&src).into_iter().flatten() { if !e.file_type().is_file() { continue; } let rel = e.path().strip_prefix(&src).unwrap().to_string_lossy().replace('\\', "/"); if skip_lock && rel.ends_with("session.lock") { continue; } add(&mut z, e.path(), format!("{}/{}", prefix, rel))?; } }
            for f in ["options.txt", "servers.dat"] { if exists(gd2.join(f)) { add(&mut z, &gd2.join(f), format!("overrides/{}", f))?; } }
            let mut deps = json!({ "minecraft": i2["mc"] }); if let Some(k) = dk { deps[k] = i2["loaderVer"].clone(); }
            z.start_file("modrinth.index.json", o)?; z.write_all(serde_json::to_string_pretty(&json!({ "formatVersion": 1, "game": "minecraft", "versionId": "1.0.0", "name": i2["name"], "summary": "Exported from OfflineCraft", "files": files, "dependencies": deps }))?.as_bytes())?; z.finish()?; Ok(())
        }).await?;
        c.toast(format!("Exported {}: {} linked, {} included in the file", gs(&i, "name"), nfiles, nembed), false); crate::api::reveal(c, &target); Ok(())
    }).await))
}
pub fn check_export(i: &Value) -> R<()> { let l = gs(i, "loader"); if l == "rust" { return bail("Horizon instances have no Java mods to export"); } if l != "vanilla" && gs(i, "loaderVer").is_empty() { return bail("Launch the instance once first so its loader version is known"); } Ok(()) }
