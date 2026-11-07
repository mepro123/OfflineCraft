use crate::auth::*;
use crate::content::*;
use crate::core::*;
use crate::feat::*;
use crate::feat2::*;
use crate::host::*;
use crate::mc::*;
use crate::skins::*;
use crate::util::*;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use tauri::{LogicalPosition, LogicalSize, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

pub fn main_win(c: &Core) -> Option<tauri::WebviewWindow> { c.app.get_webview_window("main") }
// ---------------------------------------------------------------- dialogs / shell
pub async fn pick_open(c: &C, title: &str, filters: &[(&str, &[&str])], dir: bool) -> Option<PathBuf> {
    let (tx, rx) = tokio::sync::oneshot::channel(); let mut b = c.app.dialog().file().set_title(title); if let Some(w) = main_win(c) { b = b.set_parent(&w); }
    for (n, e) in filters { b = b.add_filter(*n, e); }
    if dir { b.pick_folder(move |p| { let _ = tx.send(p); }); } else { b.pick_file(move |p| { let _ = tx.send(p); }); }
    rx.await.ok().flatten().and_then(|p| p.into_path().ok())
}
pub async fn pick_save(c: &C, title: &str, default_name: &str, filters: &[(&str, &[&str])]) -> Option<PathBuf> {
    let (tx, rx) = tokio::sync::oneshot::channel(); let mut b = c.app.dialog().file().set_title(title).set_file_name(default_name); if let Some(w) = main_win(c) { b = b.set_parent(&w); }
    for (n, e) in filters { b = b.add_filter(*n, e); }
    b.save_file(move |p| { let _ = tx.send(p); }); rx.await.ok().flatten().and_then(|p| p.into_path().ok())
}
pub fn reveal(c: &Core, p: &Path) { let _ = tauri_plugin_opener::reveal_item_in_dir(p); let _ = c; }
pub fn open_path(c: &Core, p: &Path) { let _ = std::fs::create_dir_all(p); let _ = c.app.opener().open_path(p.to_string_lossy().to_string(), None::<&str>); }
fn rm_later(p: PathBuf) { tokio::spawn(async move { for _ in 0..10 { if std::fs::remove_file(&p).is_ok() || !p.exists() { return; } sleep_ms(1500).await; } }); }
pub fn relaunch(c: &Core, extra: &[&str]) -> ! {
    let exe = std::env::current_exe().unwrap_or_default(); let mut args: Vec<String> = std::env::args().skip(1).collect(); for e in extra { args.push(e.to_string()); }
    let _ = std::fs::remove_file(&c.start_mark); let _ = std::process::Command::new(exe).args(args).spawn(); c.app.exit(0); std::process::exit(0)
}

// ---------------------------------------------------------------- theme files
const NAV_IDS: [&str; 5] = ["library", "discover", "skins", "accounts", "host"];
fn clean_theme(src: &Value) -> Value {
    let mut o = serde_json::Map::new(); let hex = regex::Regex::new(r"^#[0-9a-fA-F]{6}$").unwrap();
    for k in ["accentA", "accentB", "panelColor", "appColor", "outlineColor"] { if let Some(s) = src[k].as_str() { if hex.is_match(s) { o.insert(k.into(), json!(s.to_lowercase())); } } }
    for k in ["sidebarLabels", "animations", "bgPauseUnfocused", "sidebarGlass", "secondBar", "accentAuto", "glassAll", "barAutoHide", "fontPixel"] { if src[k].is_boolean() { o.insert(k.into(), src[k].clone()); } }
    for (k, opts) in [("sidebarPos", &["left", "right", "top", "bottom"][..]), ("density", &["comfortable", "compact"]), ("fontFamily", &["default", "inter", "system"]), ("cardStyle", &["grid", "list", "compact"]), ("ambient", &["off", "snow", "fireflies", "ash"])] { if let Some(s) = src[k].as_str() { if opts.contains(&s) { o.insert(k.into(), json!(s)); } } }
    for (k, lo, hi) in [("bgDim", 0, 90), ("bgBlur", 0, 30), ("panelOpacity", 30, 100), ("panelBlur", 0, 30), ("sidebarOpacity", 0, 100), ("sidebarBlur", 0, 30), ("glassRefract", 0, 40), ("uiScale", 80, 125), ("glow", 0, 200), ("ambientAmount", 10, 100), ("outlineOpacity", 0, 100), ("outlineSize", 0, 8)] { if let Some(n) = src[k].as_f64().or(src[k].as_str().and_then(|s| s.parse().ok())) { o.insert(k.into(), json!((n.round() as i64).clamp(lo, hi))); } }
    for (k, allow) in [("navOrder", NAV_IDS.to_vec()), ("navHidden", NAV_IDS[1..].to_vec())] { if let Some(a) = src[k].as_array() { let mut out: Vec<&str> = vec![]; for x in a.iter().filter_map(|x| x.as_str()) { if allow.contains(&x) && !out.contains(&x) { out.push(x); } } o.insert(k.into(), json!(out)); } }
    Value::Object(o)
}
const THEME_KEYS: [&str; 28] = ["accentA", "accentB", "panelColor", "appColor", "outlineColor", "sidebarPos", "sidebarLabels", "animations", "bgPauseUnfocused", "bgDim", "bgBlur", "panelOpacity", "panelBlur", "sidebarOpacity", "sidebarBlur", "sidebarGlass", "glassRefract", "secondBar", "accentAuto", "glassAll", "barAutoHide", "uiScale", "density", "fontFamily", "fontPixel", "cardStyle", "glow", "ambient"];
const BG_EXTS: [&str; 9] = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".mp4", ".webm", ".m4v"];
fn ext_of(p: &str) -> String { Path::new(p).extension().map(|e| format!(".{}", e.to_string_lossy().to_lowercase())).unwrap_or_default() }
fn is_video(e: &str) -> bool { [".mp4", ".webm", ".m4v"].contains(&e) }

// ---------------------------------------------------------------- launch
pub async fn launch(c: &C, id: &str, opts: Value) -> R<Value> {
    if c.st_s("username").is_empty() { c.toast("Add an account first (top-right corner)", true); return Ok(Value::Null); }
    let Some(inst0) = c.get_inst(id) else { return Ok(Value::Null) }; if c.busy.lock().contains(id) || c.is_running(id) { return Ok(Value::Null); }
    c.busy.lock().insert(id.to_string()); push_state(c);
    let err = start_job(c, &format!("Launching {}", gs(&inst0, "name")), |j| async move {
        let mut inst = inst0;
        let r: R<()> = async {
            if !quick_check(c, &inst) { prepare_instance(c, &mut inst, &j).await?; c.save_inst(&inst); }
            j.stage("Backing up worlds", 0); auto_backup(c, &inst, Some(&j), "auto").await;
            j.stage("Starting game", 0); ensure_ms_token(c).await?;
            let loader = gs(&inst, "loader"); let join = gs(&opts, "join");
            let (java, lp) = if loader == "rust" { let mut lp = rust_launch_for(c, &inst)?; if !join.is_empty() { lp.args.push("--server".into()); lp.args.push(join.clone()); } (lp.java.clone(), lp) }
                else { if let Err(e) = apply_skin_pack(c, &inst) { c.log(format!("skin pack: {}", e.0)); } let mv = merged_version(c, &gs(&inst, "versionId"), 0)?; let java = pick_java(c, &inst, required_java(&mv), &j).await?; let mut lp = build_launch(c, &inst, &mv, &java)?; if !join.is_empty() { lp.args.extend(join_args(&inst, &join)); } (java, lp) };
            let run = Run::new(true); c.running.lock().insert(id.to_string(), run.clone()); c.log(format!("launch {}: {} {} args", gs(&inst, "name"), java, lp.args.len()));
            let (c1, id1, r1) = (c.clone(), id.to_string(), run.clone()); let add = move |l: String| run_add(&c1, &id1, &r1, l);
            if gb(&opts, "safe") && loader != "vanilla" && loader != "rust" { match hold_mods(c, &inst) { Ok(n) => add(format!("[launcher] Safe mode: {} mod(s) set aside for this launch, they come back when the game closes", n)), Err(e) => add(format!("[launcher] Safe mode failed: {}", e.0)) } }
            add(format!("[launcher] {}", java)); add(format!("[launcher] Minecraft {} / {} as {} (offline)", gs(&inst, "mc"), gs(&inst, "versionId"), c.st_s("username")));
            let pre = run_hook(c, &inst, &gs(&inst, "preCmd"), "Pre-launch", &add, &[]).await;
            if pre != 0 { run.alive.store(false, Ordering::Relaxed); return bail(format!("The pre-launch command failed (exit code {}). Its output is in the console.", pre)); }
            let (cmd, args, env) = spawn_spec(c, &inst, &lp); if cmd != lp.java { add(format!("[launcher] Wrapper: {}", cmd)); }
            let mut pc = command(&cmd); pc.args(&args).current_dir(&lp.cwd).envs(env).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).stdin(std::process::Stdio::null());
            let mut child = match pc.spawn() { Ok(ch) => ch, Err(e) => { add(format!("[launcher] {}", e)); run.alive.store(false, Ordering::Relaxed); add("[launcher] Game exited with code -1".into()); return Ok(()); } };
            let (ltx, mut lrx) = tokio::sync::mpsc::unbounded_channel::<String>(); use tokio::io::{AsyncBufReadExt, BufReader};
            if let Some(o) = child.stdout.take() { let t = ltx.clone(); tokio::spawn(async move { let mut l = BufReader::new(o).lines(); while let Ok(Some(x)) = l.next_line().await { if !x.is_empty() { let _ = t.send(x); } } }); }
            if let Some(o) = child.stderr.take() { let t = ltx.clone(); tokio::spawn(async move { let mut l = BufReader::new(o).lines(); while let Ok(Some(x)) = l.next_line().await { if !x.is_empty() { let _ = t.send(x); } } }); }
            drop(ltx);
            let (c2, id2, r2) = (c.clone(), id.to_string(), run.clone()); let kill = run.kill.clone();
            tokio::spawn(async move {
                let lines = { let (c3, id3, r3) = (c2.clone(), id2.clone(), r2.clone()); tokio::spawn(async move { while let Some(l) = lrx.recv().await { run_add(&c3, &id3, &r3, l); } }) };
                let code = tokio::select! { st = child.wait() => st.ok().and_then(|s| s.code()).unwrap_or(-1), _ = kill.notified() => { let _ = child.kill().await; child.wait().await.ok().and_then(|s| s.code()).unwrap_or(-1) } };
                let _ = tokio::time::timeout(std::time::Duration::from_millis(500), lines).await;
                if !r2.alive.swap(false, Ordering::SeqCst) { return; }
                let Some(mut inst) = c2.get_inst(&id2) else { return }; release_mods(&c2, &inst); let dur = (now_ms() - r2.started) / 1000;
                run_add(&c2, &id2, &r2, format!("[launcher] Game exited with code {}", code)); inst["playTime"] = json!(gi(&inst, "playTime") + dur); c2.save_inst(&inst);
                if gb(&c2.st(), "minimizeOnLaunch") { if let Some(w) = main_win(&c2) { let _ = w.unminimize(); } }
                on_exit(&c2, &inst, &r2, code as i64, dur);
                let (c4, i4, r4) = (c2.clone(), inst.clone(), r2.clone()); let id4 = id2.clone(); let add2 = move |l: String| run_add(&c4, &id4, &r4, l);
                let _ = run_hook(&c2, &i4, &gs(&i4, "postCmd"), "Post-exit", &add2, &[("INST_EXIT_CODE", code.to_string())]).await; push_state(&c2);
            });
            if let Some(mut i2) = c.get_inst(id) { i2["lastPlayed"] = json!(now_s()); c.save_inst(&i2); }
            if gb(&c.st(), "minimizeOnLaunch") { if let Some(w) = main_win(c) { let _ = w.minimize(); } }
            Ok(())
        }.await;
        if let Err(e) = &r {
            let run = { let g = c.running.lock(); g.get(id).filter(|r| r.is_alive()).cloned() }.unwrap_or_else(|| { let r = Run::new(false); c.running.lock().insert(id.to_string(), r.clone()); r });
            run_add(c, id, &run, format!("[launcher] ERROR: {}", e.0)); c.log(format!("launch: {}", e.0));
        }
        r
    }).await;
    c.busy.lock().remove(id); push_state(c); Ok(json!(err))
}

// ---------------------------------------------------------------- dispatcher
pub async fn call(c: &C, name: &str, a: Vec<Value>) -> R<Value> {
    let arg = |n: usize| a.get(n).cloned().unwrap_or(Value::Null); let s = |n: usize| gs(&json!({ "v": arg(n) }), "v"); let ok = Ok(Value::Null);
    match name {
        "init" => { c.load_instances(); if c.javas.lock().is_empty() { let c2 = c.clone(); tokio::spawn(async move { sleep_ms(50).await; blocking(move || scan_javas(&c2)).await; }); }
            let c2 = c.clone(); tokio::spawn(async move { let m = load_manifest(&c2).await; c2.emit("versions", json!(m)); });
            Ok(json!({ "gfx": c.gfx(), "settings": c.rs(), "instances": c.instances.lock().iter().map(|i| c.view_inst(i)).collect::<Vec<_>>(), "root": c.root.to_string_lossy(), "running": {}, "busy": [], "versions": *c.manifest.lock(), "javas": javas_json(c) })) }
        "versions" => { let m = c.manifest.lock().clone(); Ok(json!(if m.is_empty() { load_manifest(c).await } else { m })) }
        "applyZoom" => { apply_zoom(c); Ok(json!(true)) }
        "saveSettings" => { let patch = arg(0); c.st_mut(|st| { if let Some(o) = patch.as_object() { for (k, v) in o { st[k] = v.clone(); } } let u = gs(st, "username"); if !u.is_empty() && gs(st, "activeMs").is_empty() && !arr(st, "accounts").iter().any(|x| x.as_str() == Some(&u)) { if let Some(l) = st["accounts"].as_array_mut() { l.push(json!(u)); } } }); c.save_settings(); push_state(c); Ok(c.rs()) }
        "uuid" => Ok(json!(offline_uuid(&s(0)))),
        "msLogin" => Ok(match ms_login(c).await { Ok(v) => v, Err(e) => json!({ "err": e.0 }) }),
        "defaultSteve" => Ok(default_steve(c).await),
        "deleteSkin" => Ok(delete_skin(c, &s(0))),
        "skinLibrary" => Ok(skin_library(c)),
        "pickSkinFile" => { let Some(f) = pick_open(c, "Choose a skin", &[("Minecraft skin (PNG)", &["png"])], false).await else { return Ok(Value::Null) }; Ok(match std::fs::read(&f).map_err(E::from).and_then(|b| save_png(c, &b)) { Ok(id) => skin_entry(c, &id), Err(e) => json!({ "err": e.0 }) }) }
        "importSkinByName" => Ok(match import_skin_by_name(c, &s(0)).await { Ok(v) => v, Err(e) => json!({ "err": e.0 }) }),
        "applySkin" => { let o = arg(0); Ok(match apply_skin(c, &gs(&o, "id"), &gs(&o, "model")).await { Ok(v) => v, Err(e) => json!({ "err": e.0 }) }) }
        "resetSkin" => Ok(match reset_skin(c).await { Ok(v) => v, Err(e) => json!({ "err": e.0 }) }),
        "switchMs" => { let id = s(0); c.st_mut(|st| { if let Some(n) = arr(st, "msAccounts").iter().find(|x| gs(x, "id") == id).map(|x| gs(x, "name")) { st["activeMs"] = json!(id); st["username"] = json!(n); } }); c.save_settings(); push_state(c); ok }
        "removeMsAccount" => { let id = s(0); c.st_mut(|st| { let l: Vec<Value> = arr(st, "msAccounts").iter().filter(|x| gs(x, "id") != id).cloned().collect(); st["msAccounts"] = json!(l); if gs(st, "activeMs") == id { st["activeMs"] = json!(""); st["username"] = arr(st, "accounts").first().cloned().unwrap_or(json!("")); } }); c.save_settings(); push_state(c); ok }
        "graphics" => Ok(c.gfx()),
        "gpuReport" => { let log: Vec<String> = { let l = c.log_lines.lock(); l[l.len().saturating_sub(40)..].to_vec() }; Ok(json!(serde_json::to_string_pretty(&json!({ "level": c.level.load(Ordering::Relaxed), "mode": c.st_s("gpuMode"), "status": read_json_opt(c.p(&["gpu-status.json"])), "webview": tauri::webview_version().unwrap_or_default(), "tauri": tauri::VERSION, "os": std::env::consts::OS, "log": log }))?)) }
        "setGpuMode" => { let mode = s(0); c.st_mut(|st| st["gpuMode"] = json!(mode)); if mode == "auto" { let _ = std::fs::remove_file(&c.safe_file); let _ = std::fs::remove_file(c.p(&["gpu-status.json"])); } c.save_settings(); relaunch(c, &[]) }
        "restart" => relaunch(c, &[]),
        "pickBackground" => {
            let old = c.st_s("bgFile"); let Some(src) = pick_open(c, "Choose a background", &[("Images, GIFs & videos", &["png", "jpg", "jpeg", "webp", "gif", "bmp", "mp4", "webm", "m4v"])], false).await else { return Ok(json!(false)) };
            let ext = ext_of(&src.to_string_lossy()); let dir = c.p(&["backgrounds"]); std::fs::create_dir_all(&dir)?; let name = format!("bg-{}{}", now_ms(), ext); std::fs::copy(&src, dir.join(&name))?;
            c.st_mut(|st| { st["bgFile"] = json!(name); st["bgType"] = json!(if is_video(&ext) { "video" } else { "image" }); st["bgVer"] = json!(now_ms()); }); c.save_settings(); push_state(c); if !old.is_empty() { rm_later(dir.join(old)); } Ok(json!(true)) }
        "pickInstanceImage" => { let Some(mut i) = c.get_inst(&s(0)) else { return Ok(json!(false)) }; let kind = s(1); let key = if kind == "cover" { "coverFile" } else { "iconFile" };
            let Some(src) = pick_open(c, if kind == "cover" { "Choose a card background" } else { "Choose a logo" }, &[("Images", &["png", "jpg", "jpeg", "webp", "gif", "bmp"])], false).await else { return Ok(json!(false)) };
            let old = gs(&i, key); let name = format!("{}-{}{}", kind, now_ms(), ext_of(&src.to_string_lossy())); std::fs::copy(&src, c.dir_inst(&i).join(&name))?; i[key] = json!(name); i["assetVer"] = json!(now_ms()); c.save_inst(&i); push_state(c); if !old.is_empty() { rm_later(c.dir_inst(&i).join(old)); } Ok(json!(true)) }
        "clearInstanceImage" => { let Some(mut i) = c.get_inst(&s(0)) else { return ok }; let key = if s(1) == "cover" { "coverFile" } else { "iconFile" }; let old = gs(&i, key); i[key] = json!(""); i["assetVer"] = json!(now_ms()); c.save_inst(&i); push_state(c); if !old.is_empty() { rm_later(c.dir_inst(&i).join(old)); } Ok(json!(true)) }
        "openUrl" => { let u = s(0); if u.to_lowercase().starts_with("https://") { let _ = c.app.opener().open_url(u, None::<&str>); } ok }
        "projectDetail" => project_detail(c, &s(0)).await,
        "instanceStats" => { let Some(i) = c.get_inst(&s(0)) else { return ok }; let cnt = |sub: &str, dirs: bool| std::fs::read_dir(c.game_dir(&i).join(sub)).map(|r| r.flatten().filter(|e| { let t = e.file_type(); if dirs { t.map(|t| t.is_dir()).unwrap_or(false) } else { t.map(|t| t.is_file()).unwrap_or(false) && !e.file_name().to_string_lossy().ends_with(".part") } }).count()).unwrap_or(0); Ok(json!({ "mods": cnt("mods", false), "packs": cnt("resourcepacks", false), "shaders": cnt("shaderpacks", false), "worlds": cnt("saves", true) })) }
        "exportTheme" => {
            let st = c.st(); let mut obj = json!({ "format": "offlinecraft-theme", "version": 1, "exportedAt": chrono::Utc::now().to_rfc3339(), "settings": {}, "background": null }); let mut bg_skipped = false;
            for k in THEME_KEYS.iter().chain(["navOrder", "navHidden", "outlineOpacity", "outlineSize"].iter()) { if !st[*k].is_null() { obj["settings"][*k] = st[*k].clone(); } }
            if !gs(&st, "bgFile").is_empty() && gs(&st, "bgType") != "none" { let f = c.p(&["backgrounds", &gs(&st, "bgFile")]); if fsize(&f) > 200 * 1024 * 1024 { bg_skipped = true; } else if let Ok(b) = std::fs::read(&f) { use base64::Engine; obj["background"] = json!({ "type": st["bgType"], "ext": ext_of(&gs(&st, "bgFile")), "data": base64::engine::general_purpose::STANDARD.encode(b) }); } }
            let Some(fp) = pick_save(c, "Export theme", "OfflineCraft.theme", &[("OfflineCraft theme", &["theme"])]).await else { return Ok(Value::Null) };
            let fp = if fp.to_string_lossy().to_lowercase().ends_with(".theme") { fp } else { PathBuf::from(format!("{}.theme", fp.to_string_lossy())) };
            if let Err(e) = std::fs::write(&fp, serde_json::to_string_pretty(&obj)?) { return Ok(json!({ "err": format!("Could not save the file: {}", e) })); }
            Ok(json!({ "ok": true, "path": fp.to_string_lossy(), "bg": !obj["background"].is_null(), "bgSkipped": bg_skipped })) }
        "importTheme" => {
            let Some(f) = pick_open(c, "Import theme", &[("OfflineCraft theme", &["theme", "json"])], false).await else { return Ok(Value::Null) };
            if fsize(&f) > 400 * 1024 * 1024 { return Ok(json!({ "err": "That file is too big to be a theme." })); }
            let Some(t) = read_json_opt(&f) else { return Ok(json!({ "err": "That file is not a valid theme." })) };
            if gs(&t, "format") != "offlinecraft-theme" || !t["settings"].is_object() { return Ok(json!({ "err": "That file is not an OfflineCraft theme." })); }
            let mut clean = clean_theme(&t["settings"]); let dir = c.p(&["backgrounds"]); let old = c.st_s("bgFile"); let mut bg = false;
            if let Some(d) = t["background"]["data"].as_str() { let ext = gs(&t["background"], "ext").to_lowercase(); if BG_EXTS.contains(&ext.as_str()) { use base64::Engine; if let Ok(b) = base64::engine::general_purpose::STANDARD.decode(d) { std::fs::create_dir_all(&dir)?; let name = format!("bg-{}{}", now_ms(), ext); std::fs::write(dir.join(&name), b)?; clean["bgFile"] = json!(name); clean["bgType"] = json!(if is_video(&ext) { "video" } else { "image" }); clean["bgVer"] = json!(now_ms()); bg = true; } } }
            if !bg { clean["bgFile"] = json!(""); clean["bgType"] = json!("none"); }
            c.st_mut(|st| { for (k, v) in clean.as_object().unwrap() { st[k] = v.clone(); } }); c.save_settings(); push_state(c); let now = c.st_s("bgFile"); if !old.is_empty() && old != now { rm_later(dir.join(old)); } Ok(json!({ "ok": true, "bg": bg })) }
        "clearBackground" => { let old = c.st_s("bgFile"); c.st_mut(|st| { st["bgFile"] = json!(""); st["bgType"] = json!("none"); }); c.save_settings(); push_state(c); if !old.is_empty() { rm_later(c.p(&["backgrounds", &old])); } Ok(json!(true)) }
        "createInstance" => { let o = arg(0); let mc = gs(&o, "mc"); if mc.is_empty() { c.toast("Pick a Minecraft version first", true); return ok; } let loader = gs(&o, "loader");
            let name = if gs(&o, "name").is_empty() { format!("{}{}", mc, if loader != "vanilla" && !loader.is_empty() { format!(" {}", loader) } else { String::new() }) } else { gs(&o, "name") };
            let i = c.make_instance(&name, &mc, &loader, &gs(&o, "loaderVer")); push_state(c); let (c2, mut i2) = (c.clone(), i.clone()); let iname = gs(&i, "name");
            tokio::spawn(async move { let e = start_job(&c2, &format!("Installing {}", gs(&i2, "name")), |j| { let c3 = c2.clone(); async move { run_prepare(&c3, &mut i2, &j).await } }).await; if e.is_empty() { c2.toast(format!("{} is ready to play", iname), false); } }); Ok(c.get_inst(&gs(&i, "id")).unwrap_or(Value::Null)) }
        "updateInstance" => { let Some(mut i) = c.get_inst(&s(0)) else { return ok }; if let Some(o) = arg(1).as_object() { for (k, v) in o { i[k] = v.clone(); } } c.save_inst(&i); push_state(c); Ok(i) }
        "deleteInstance" => { let Some(i) = c.get_inst(&s(0)) else { return ok }; let _ = std::fs::remove_dir_all(c.dir_inst(&i)); c.instances.lock().retain(|x| gs(x, "id") != gs(&i, "id")); push_state(c); ok }
        "duplicateInstance" => { let Some(o) = c.get_inst(&s(0)) else { return ok }; let mut n = c.make_instance(&format!("{} copy", gs(&o, "name")), &gs(&o, "mc"), &gs(&o, "loader"), &gs(&o, "loaderVer")); let (od, nd) = (c.dir_inst(&o), c.dir_inst(&n)); blocking(move || copy_dir(&od, &nd, &|_| false)).await?;
            let nid = gs(&n, "id"); let mut m = o.clone(); m["id"] = json!(nid); m["name"] = json!(format!("{} copy", gs(&o, "name"))); m["created"] = json!(now_s()); m["lastPlayed"] = json!(0); m["playTime"] = json!(0); m["ready"] = json!(false); n = m; c.save_inst(&n); push_state(c); Ok(n) }
        "openFolder" => { let Some(i) = c.get_inst(&s(0)) else { return ok }; let sub = s(1); let d = if sub == "root" { c.dir_inst(&i) } else { c.game_dir(&i).join(&sub) }; open_path(c, &d); ok }
        "openData" => { open_path(c, &c.root); ok }
        "repair" => { let Some(mut i) = c.get_inst(&s(0)) else { return ok }; i["ready"] = json!(false); c.save_inst(&i); Ok(json!(prepare_job(c, &s(0), &format!("Repairing {}", gs(&i, "name"))).await)) }
        "launch" => launch(c, &s(0), if arg(1).is_object() { arg(1) } else { json!({}) }).await,
        "stop" => { if let Some(r) = c.running.lock().get(&s(0)).cloned() { if r.is_alive() { r.stopped.store(true, Ordering::Relaxed); r.kill.notify_one(); } } ok }
        "console" => Ok(json!(c.running.lock().get(&s(0)).map(|r| r.lines.lock().clone()).unwrap_or_default())),
        "listContent" => Ok(c.get_inst(&s(0)).map(|i| list_content(c, &i, &s(1))).unwrap_or(json!([]))),
        "identify" => Ok(match c.get_inst(&s(0)) { Some(i) => json!(identify_content(c, &i).await), None => json!(false) }),
        "installedIds" => Ok(c.get_inst(&s(0)).map(|i| installed_id_list(c, &i)).unwrap_or(json!([]))),
        "toggleContent" => { let i = c.must_inst(&s(0))?; let d = content_dir(c, &i, &s(1)); let f = s(2); let p = d.join(&f); std::fs::rename(&p, if f.ends_with(".disabled") { d.join(&f[..f.len() - 9]) } else { d.join(format!("{}.disabled", f)) })?; ok }
        "removeContent" => { let i = c.must_inst(&s(0))?; let kind = s(1); let f = s(2); let p = content_dir(c, &i, &kind).join(&f); if p.is_dir() { let _ = std::fs::remove_dir_all(&p); } else { let _ = std::fs::remove_file(&p); }
            if kind != "world" { let rp = c.dir_inst(&i).join("content.json"); let mut r = read_obj(&rp); if let Some(o) = r.as_object_mut() { o.remove(f.trim_end_matches(".disabled")); } write_json(&rp, &r); } ok }
        "search" => mr_search(c, &arg(0)).await,
        "installProject" => { let o = arg(0); let Some(i) = c.get_inst(&gs(&o, "instId")) else { c.toast("Choose an instance to install into first (create one in the Library).", true); return Ok(json!({ "err": "no instance" })); };
            let pid = gs(&o, "projectId"); let title = if gs(&o, "title").is_empty() { pid.clone() } else { gs(&o, "title") };
            let e = start_job(c, &format!("Install {}", title), |j| { let (pid, ty, vid) = (pid.clone(), gs(&o, "type"), gs(&o, "versionId")); async move { let mut seen = std::collections::HashSet::new(); mr_install(c, &i, &pid, &ty, &j, &mut seen, &vid, 0).await } }).await; Ok(json!({ "err": e })) }
        "installModpack" => { let pid = s(0); let vid = s(1);
            let e = start_job(c, "Modpack", |j| async move {
                let ver = if !vid.is_empty() { get_json(c, &format!("{}/version/{}", MR, vid)).await.ok() } else { mr_pick_version(c, &pid, "", "", false).await }; let Some(ver) = ver else { return bail("No downloadable version found") };
                let f = primary_file(&ver).ok_or(E("No downloadable version found".into()))?; let tmp = c.p(&["cache", &sanitize(&gs(&f, "filename"))]); j.stage("Downloading modpack", 0); download(c, &gs(&f, "url"), &tmp, Some(&j)).await?;
                let mut inst = install_mrpack(c, &tmp, &j).await?; run_prepare(c, &mut inst, &j).await?; c.toast(format!("{} installed — find it in your Library", gs(&inst, "name")), false); Ok(()) }).await; Ok(json!({ "err": e })) }
        "importMrpack" => { let Some(f) = pick_open(c, "Import modpack", &[("Modrinth modpack", &["mrpack"])], false).await else { return ok }; let c2 = c.clone();
            tokio::spawn(async move { start_job(&c2, "Importing modpack", |j| { let c3 = c2.clone(); async move { let mut inst = install_mrpack(&c3, &f, &j).await?; run_prepare(&c3, &mut inst, &j).await?; c3.toast(format!("{} imported", gs(&inst, "name")), false); Ok(()) } }).await; }); ok }
        "updateMods" => { let i = c.must_inst(&s(0))?; Ok(json!(start_job(c, "Updating mods", |j| async move { update_mods(c, &i, &j).await }).await)) }
        "cancelJob" => { if let Some(j) = c.jobs.lock().get(&(gi(&json!({ "v": arg(0) }), "v") as u64)) { j.cancel.store(true, Ordering::Relaxed); } ok }
        "javas" => Ok(javas_json(c)),
        "rescanJava" => { let c2 = c.clone(); blocking(move || scan_javas(&c2)).await; Ok(javas_json(c)) }
        "downloadJava" => { let major = gi(&json!({ "v": arg(0) }), "v"); Ok(json!(start_job(c, &format!("Java {}", major), |j| async move { download_java(c, major, &j).await }).await)) }
        "launcherLog" => Ok(json!(*c.log_lines.lock())),
        "winMin" => { if let Some(w) = main_win(c) { let _ = w.minimize(); } ok }
        "winMax" => { win_max(c); ok }
        "winClose" => { if let Some(w) = main_win(c) { let _ = w.close(); } ok }
        "winIsMax" => Ok(json!(if c.rounded.load(Ordering::Relaxed) { c.maxed.load(Ordering::Relaxed) } else { main_win(c).and_then(|w| w.is_maximized().ok()).unwrap_or(false) })),
        "setWinStyle" => { let st = s(0); if st != "rounded" && st != "classic" { return ok; } c.st_mut(|x| x["winStyle"] = json!(st)); c.save_settings(); relaunch(c, &[]) }
        "winGetBounds" => { let Some(w) = main_win(c) else { return ok }; let f = w.scale_factor().unwrap_or(1.0); let p = w.outer_position()?; let z = w.outer_size()?; Ok(json!({ "x": p.x as f64 / f, "y": p.y as f64 / f, "width": z.width as f64 / f, "height": z.height as f64 / f })) }
        "winSetBounds" => { let b = arg(0); let Some(w) = main_win(c) else { return ok }; if !b.is_object() || c.maxed.load(Ordering::Relaxed) || w.is_maximized().unwrap_or(false) || w.is_fullscreen().unwrap_or(false) { return ok; }
            let m = if c.rounded.load(Ordering::Relaxed) { 2 * WIN_M } else { 0 } as f64; let g = |k: &str| b[k].as_f64().unwrap_or(0.0).round();
            let _ = w.set_size(LogicalSize::new(g("width").max(1000.0 + m), g("height").max(640.0 + m))); let _ = w.set_position(LogicalPosition::new(g("x"), g("y"))); ok }
        "serverStatus" => Ok(server_status(c, &arg(0)).await),
        "hostVersions" => host_versions(c, &s(0)).await,
        "hostList" => Ok(host_list(c)),
        "hostCreate" => host_create(c, &arg(0)).await,
        "hostSave" => Ok(host_save(c, &s(0), &arg(1))),
        "hostStart" => Ok(json!(host_start(c, &s(0)).await?)),
        "hostStop" => { host_stop(c, &s(0)); ok }
        "hostCommand" => Ok(json!(host_command(c, &s(0), &s(1)))),
        "hostLog" => Ok(host_log(c, &s(0))),
        "hostDelete" => { host_delete(c, &s(0)); ok }
        "hostOpenFolder" => { open_path(c, &host_dir_path(c, &s(0))); ok }
        "hostNet" => Ok(host_net(c, &s(0)).await),
        "hostPortMap" => Ok(host_port_map(c, &s(0), gb(&json!({ "v": arg(1) }), "v")).await),
        "hostTest" => Ok(host_test(c, &s(0)).await),
        "hostFirewall" => Ok(json!(host_firewall(c, &s(0)))),
        "srvDiscover" => srv_discover(c, &arg(0)).await,
        // ---- features
        "backupList" => Ok(json!(list_backups(c, &c.must_inst(&s(0))?))),
        "backupNow" => backup_now(c, &s(0), &s(1)).await,
        "backupRestore" => backup_restore(c, &s(0), &s(1)).await,
        "backupDelete" => Ok(json!(backup_delete(c, &s(0), &s(1))?)),
        "backupFolder" => { open_path(c, &backup_dir_path(c, &s(0))?); ok }
        "worldSizes" => world_sizes(c, &s(0)).await,
        "shotList" => shot_list(c, &s(0)),
        "shotDelete" => { let _ = std::fs::remove_file(shot_path(c, &s(0), &s(1))?); Ok(json!(true)) }
        "shotCopy" => { use tauri_plugin_clipboard_manager::ClipboardExt; let p = shot_path(c, &s(0), &s(1))?; match tauri::image::Image::from_path(&p) { Ok(img) => Ok(json!(c.app.clipboard().write_image(&img).is_ok())), Err(_) => Ok(json!(false)) } }
        "shotShow" => { reveal(c, &shot_path(c, &s(0), &s(1))?); ok }
        "shotFolder" => { let i = c.must_inst(&s(0))?; open_path(c, &c.game_dir(&i).join("screenshots")); ok }
        "updateEverything" => update_everything_api(c, &s(0)).await,
        "hasUndo" => Ok(has_undo(c, &s(0))),
        "undoUpdate" => undo_update(c, &s(0)).await,
        "undoAvailable" => Ok(json!(undo_available(c, &s(0)))),
        "changeVersion" => change_version(c, &s(0), &s(1)).await,
        "rustStatus" => rust_status(c, &s(0)).await,
        "crashFix" => Ok(json!(crash_fix(c, &s(0), &s(1))?)),
        "exportMrpack" => { let i = c.must_inst(&s(0))?; check_export(&i)?; let worlds = gb(&arg(1), "worlds");
            let Some(t) = pick_save(c, "Export modpack", &format!("{}.mrpack", sanitize(&gs(&i, "name"))), &[("Modrinth modpack", &["mrpack"])]).await else { return ok }; export_mrpack(c, &s(0), worlds, t).await }
        "shareLog" => share_log(c, &s(0)).await,
        "makeShortcut" => make_shortcut(c, &s(0)),
        "importPrism" => import_prism_api(c).await,
        "worldImport" => world_import(c, &s(0), &s(1)).await,
        "worldExport" => world_export(c, &s(0), &s(1)).await,
        "worldCopy" => world_copy(c, &s(0), &s(1)).await,
        "copyOptions" => copy_options(c, &s(0), &s(1)),
        "capeList" => cape_list(c).await,
        "capeSet" => cape_set(c, &s(0)).await,
        "storageInfo" => Ok(storage_info(c).await),
        "storageClean" => storage_clean(c, &s(0)).await,
        _ => bail(format!("Unknown API call: {}", name)),
    }
}
fn javas_json(c: &Core) -> Value { json!(c.javas.lock().iter().map(|j| json!({ "exe": j.exe, "major": j.major, "ver": j.ver })).collect::<Vec<_>>()) }
pub fn apply_zoom(c: &Core) { if let Some(w) = main_win(c) { let z = (gi(&c.st(), "uiScale").max(1) as f64 / 100.0).clamp(0.8, 1.25); let _ = w.set_zoom(z); } }
fn win_max(c: &C) {
    let Some(w) = main_win(c) else { return };
    if !c.rounded.load(Ordering::Relaxed) { if w.is_maximized().unwrap_or(false) { let _ = w.unmaximize(); } else { let _ = w.maximize(); } return; }
    if c.maxed.load(Ordering::Relaxed) { if let Some((x, y, wd, h)) = *c.restore.lock() { let _ = w.set_position(tauri::PhysicalPosition::new(x, y)); let _ = w.set_size(tauri::PhysicalSize::new(wd, h)); } c.maxed.store(false, Ordering::Relaxed); c.emit("maxed", json!(false)); }
    else if let (Ok(p), Ok(z), Ok(Some(m))) = (w.outer_position(), w.outer_size(), w.current_monitor()) {
        *c.restore.lock() = Some((p.x, p.y, z.width, z.height)); let wa = m.work_area(); let _ = w.set_position(wa.position); let _ = w.set_size(wa.size); c.maxed.store(true, Ordering::Relaxed); c.emit("maxed", json!(true));
    }
}
#[tauri::command]
pub async fn oc(app: tauri::AppHandle, name: String, args: Option<Vec<Value>>) -> Result<Value, String> {
    let c = app_state(&app);
    match call(&c, &name, args.unwrap_or_default()).await { Ok(v) => Ok(v), Err(e) => { c.log(format!("[api:{}] {}", name, e.0)); Err(e.0) } }
}
