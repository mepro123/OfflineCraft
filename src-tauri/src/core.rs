use crate::util::*;
use parking_lot::Mutex;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

pub const UA: &str = "OfflineCraft/3.0 (offline launcher)";
pub const MR: &str = "https://api.modrinth.com/v2";
pub const WIN_M: i32 = 14;

pub struct JobInner { pub label: String, pub err: String }
pub struct Job { pub id: u64, pub title: String, pub inner: Mutex<JobInner>, pub total: AtomicI64, pub done: AtomicI64, pub bytes: AtomicU64, pub cancel: AtomicBool, pub finished: AtomicBool, pub ended: AtomicI64 }
pub type JobRef = Arc<Job>;
impl Job {
    pub fn label(&self, s: impl Into<String>) { self.inner.lock().label = s.into(); }
    pub fn stage(&self, s: impl Into<String>, total: i64) { self.label(s); self.total.store(total, Ordering::Relaxed); self.done.store(0, Ordering::Relaxed); }
    pub fn tick(&self) { self.done.fetch_add(1, Ordering::Relaxed); }
    pub fn cancelled(&self) -> bool { self.cancel.load(Ordering::Relaxed) }
}

pub struct Run { pub lines: Mutex<Vec<String>>, pub alive: AtomicBool, pub started: i64, pub stopped: AtomicBool, pub kill: Arc<tokio::sync::Notify> }
impl Run { pub fn new(alive: bool) -> Arc<Run> { Arc::new(Run { lines: Mutex::new(vec![]), alive: AtomicBool::new(alive), started: now_ms(), stopped: AtomicBool::new(false), kill: Arc::new(tokio::sync::Notify::new()) }) } pub fn is_alive(&self) -> bool { self.alive.load(Ordering::Relaxed) } }

pub struct HostRt { pub state: Mutex<String>, pub lines: Mutex<Vec<String>>, pub players: Mutex<Vec<String>>, pub started: AtomicI64, pub stdin: Mutex<Option<tokio::sync::mpsc::UnboundedSender<String>>>, pub kill: Arc<tokio::sync::Notify>, pub upnp: Mutex<Option<Value>>, pub upnp_svc: Mutex<Option<(String, String)>>, pub err: Mutex<String> }
impl HostRt { pub fn new(state: &str) -> Arc<HostRt> { Arc::new(HostRt { state: Mutex::new(state.into()), lines: Mutex::new(vec![]), players: Mutex::new(vec![]), started: AtomicI64::new(0), stdin: Mutex::new(None), kill: Arc::new(tokio::sync::Notify::new()), upnp: Mutex::new(None), upnp_svc: Mutex::new(None), err: Mutex::new(String::new()) }) } }

#[derive(Clone, Debug)]
pub struct Java { pub exe: String, pub major: i64, pub ver: String }

pub struct Core {
    pub app: AppHandle,
    pub root: PathBuf,
    pub http: reqwest::Client,
    pub settings: Mutex<Value>,
    pub instances: Mutex<Vec<Value>>,
    pub running: Mutex<HashMap<String, Arc<Run>>>,
    pub busy: Mutex<HashSet<String>>,
    pub jobs: Mutex<HashMap<u64, JobRef>>,
    pub job_seq: AtomicU64,
    pub manifest: Mutex<Vec<Value>>,
    pub javas: Mutex<Vec<Java>>,
    pub log_lines: Mutex<Vec<String>>,
    pub log_q: Mutex<Vec<String>>,
    pub con_q: Mutex<HashMap<String, Vec<String>>>,
    pub host_q: Mutex<HashMap<String, Vec<String>>>,
    pub hosted: Mutex<HashMap<String, Arc<HostRt>>>,
    pub mode_cache: Mutex<HashMap<String, (String, i64)>>,
    pub level: AtomicU8,
    pub rounded: AtomicBool,
    pub maxed: AtomicBool,
    pub restore: Mutex<Option<(i32, i32, u32, u32)>>,
    pub push_pending: AtomicBool,
    pub ui_loaded: AtomicBool,
    pub start_mark: PathBuf,
    pub safe_file: PathBuf,
}
pub type C = Arc<Core>;

pub fn default_settings() -> Value {
    json!({ "username": "", "accounts": [], "ramMB": 4096, "optimizedFlags": true, "autoJava": true, "minimizeOnLaunch": false, "threads": 16, "accent": 0, "jvmArgs": "",
      "accentA": "#34d399", "accentB": "#22d3ee", "sidebarPos": "left", "sidebarLabels": true, "bgFile": "", "bgType": "none", "bgVer": 0, "bgDim": 45, "bgBlur": 0, "panelOpacity": 88,
      "panelColor": "#12151c", "appColor": "#0b0d12", "animations": true, "bgPauseUnfocused": true, "gpuMode": "auto", "panelBlur": 0, "sidebarOpacity": 100, "sidebarBlur": 0, "sidebarGlass": false, "glassRefract": 14, "secondBar": false, "accentAuto": false, "glassAll": false, "barAutoHide": false, "uiScale": 100, "density": "comfortable", "fontFamily": "default", "fontPixel": false, "cardStyle": "grid", "glow": 100, "ambient": "off", "ambientAmount": 50, "navOrder": [], "navHidden": [], "outlineColor": "#ffffff", "outlineOpacity": 30, "outlineSize": 2, "winStyle": "rounded", "winRadius": 12, "msAccounts": [], "activeMs": "", "skins": {}, "servers": [] })
}

impl Core {
    pub fn p(&self, parts: &[&str]) -> PathBuf { let mut b = self.root.clone(); for x in parts { b.push(x); } b }
    pub fn st(&self) -> Value { self.settings.lock().clone() }
    pub fn st_s(&self, k: &str) -> String { gs(&self.settings.lock(), k) }
    pub fn st_mut<T>(&self, f: impl FnOnce(&mut Value) -> T) -> T { let mut g = self.settings.lock(); f(&mut g) }
    pub fn save_settings(&self) { write_json(self.p(&["settings.json"]), &self.settings.lock()); }
    pub fn emit(&self, ch: &str, data: Value) { let _ = self.app.emit(ch, data); }
    pub fn toast(&self, msg: impl Into<String>, err: bool) { self.emit("toast", json!({ "msg": msg.into(), "err": err })); }
    pub fn log(&self, s: impl AsRef<str>) {
        let line = format!("[{}] {}", chrono::Local::now().format("%H:%M:%S"), s.as_ref());
        { let mut l = self.log_lines.lock(); l.push(line.clone()); if l.len() > 3000 { l.remove(0); } }
        self.log_q.lock().push(line.clone());
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(self.p(&["launcher.log"])) { let _ = writeln!(f, "{}", line); }
    }
    pub fn dir_inst(&self, i: &Value) -> PathBuf { self.p(&["instances", &gs(i, "id")]) }
    pub fn game_dir(&self, i: &Value) -> PathBuf { self.dir_inst(i).join("minecraft") }
    pub fn save_inst(&self, i: &Value) {
        write_json(self.dir_inst(i).join("instance.json"), i);
        let mut l = self.instances.lock(); let id = gs(i, "id");
        if let Some(x) = l.iter_mut().find(|x| gs(x, "id") == id) { *x = i.clone(); }
    }
    pub fn get_inst(&self, id: &str) -> Option<Value> { self.instances.lock().iter().find(|i| gs(i, "id") == id).cloned() }
    pub fn must_inst(&self, id: &str) -> R<Value> { self.get_inst(id).ok_or(E("Unknown instance".into())) }
    pub fn load_instances(&self) {
        let mut out = vec![];
        if let Ok(rd) = std::fs::read_dir(self.p(&["instances"])) {
            for d in rd.flatten() { let name = d.file_name().to_string_lossy().to_string(); if let Some(mut j) = read_json_opt(d.path().join("instance.json")) { j["id"] = json!(name); out.push(j); } }
        }
        out.sort_by_key(|i| std::cmp::Reverse(gi(i, "lastPlayed").max(gi(i, "created"))));
        *self.instances.lock() = out;
    }
    pub fn make_instance(&self, name: &str, mc: &str, loader: &str, loader_ver: &str) -> Value {
        let nm = if name.is_empty() { "New instance" } else { name }; let base = sanitize(nm); let mut id = base.clone(); let mut n = 2;
        while exists(self.p(&["instances", &id])) { id = format!("{} ({})", base, n); n += 1; }
        let i = json!({ "id": id, "name": nm, "mc": mc, "loader": if loader.is_empty() { "vanilla" } else { loader }, "loaderVer": loader_ver, "versionId": "", "color": "", "iconFile": "", "coverFile": "", "assetVer": 0, "pinned": false, "ramMB": 0, "javaPath": "", "jvmArgs": "", "width": 0, "height": 0, "fullscreen": false, "ready": false, "created": now_s(), "lastPlayed": 0, "playTime": 0 });
        let _ = std::fs::create_dir_all(self.game_dir(&i)); write_json(self.dir_inst(&i).join("instance.json"), &i);
        self.instances.lock().insert(0, i.clone()); i
    }
    pub fn skin_file(&self, id: &str) -> PathBuf { self.p(&["skins", "lib", &format!("{}.png", id)]) }
    fn inst_asset(&self, i: &Value, f: &str) -> String { let p = self.dir_inst(i).join(f); if !f.is_empty() && exists(&p) { format!("{}?v={}", asset_url(&p), gi(i, "assetVer")) } else { String::new() } }
    pub fn view_inst(&self, i: &Value) -> Value { let mut v = i.clone(); v["iconUrl"] = json!(self.inst_asset(i, &gs(i, "iconFile"))); v["coverUrl"] = json!(self.inst_asset(i, &gs(i, "coverFile"))); v }
    pub fn rs(&self) -> Value {
        let mut s = self.st();
        s["winRounded"] = json!(self.rounded.load(Ordering::Relaxed)); s["winMargin"] = json!(WIN_M);
        let ms: Vec<Value> = arr(&s, "msAccounts").iter().map(|a| {
            let ap = a.get("appliedSkin").filter(|ap| ap.is_object() && exists(self.skin_file(&gs(ap, "id")))).cloned();
            let cf = if gs(a, "skinCache").is_empty() { None } else { Some(self.p(&["skins", "cache", &format!("{}.png", gs(a, "skinCache"))])) };
            let url = if let Some(ap) = &ap { asset_url(&self.skin_file(&gs(ap, "id"))) } else if let Some(cf) = cf.filter(|p| exists(p)) { asset_url(&cf) } else { gs(a, "skinUrl") };
            json!({ "id": a["id"], "name": a["name"], "skinId": ap.as_ref().map(|x| gs(x, "id")).unwrap_or_default(), "skinModel": ap.as_ref().map(|x| x["model"].clone()).unwrap_or(a["skinModel"].clone()), "skinUrl": url })
        }).collect();
        s["msAccounts"] = json!(ms);
        let mut skins = Map::new();
        if let Some(o) = s["skins"].as_object() { for (n, sk) in o { let id = gs(sk, "id"); if exists(self.skin_file(&id)) { let mut x = sk.clone(); x["url"] = json!(asset_url(&self.skin_file(&id))); skins.insert(n.clone(), x); } } }
        s["skins"] = Value::Object(skins);
        let bg = gs(&s, "bgFile"); s["bgUrl"] = json!(if !bg.is_empty() && exists(self.p(&["backgrounds", &bg])) { format!("{}?v={}", asset_url(&self.p(&["backgrounds", &bg])), gi(&s, "bgVer")) } else { String::new() });
        s
    }
    pub fn gfx(&self) -> Value { json!({ "mode": self.st_s("gpuMode"), "level": self.level.load(Ordering::Relaxed), "status": read_json_opt(self.p(&["gpu-status.json"])) }) }
    pub fn is_running(&self, id: &str) -> bool { self.running.lock().get(id).map(|r| r.is_alive()).unwrap_or(false) }
}

pub fn push_state(c: &C) {
    if c.push_pending.swap(true, Ordering::SeqCst) { return; }
    let c = c.clone();
    tokio::spawn(async move { sleep_ms(25).await; c.push_pending.store(false, Ordering::SeqCst); do_push_state(&c); });
}
pub fn do_push_state(c: &C) {
    let mut r = Map::new(); for (id, x) in c.running.lock().iter() { if x.is_alive() { r.insert(id.clone(), json!(true)); } }
    let insts: Vec<Value> = c.instances.lock().iter().map(|i| c.view_inst(i)).collect();
    let busy: Vec<String> = c.busy.lock().iter().cloned().collect();
    c.emit("state", json!({ "instances": insts, "running": r, "busy": busy, "settings": c.rs() }));
}
pub fn emit_console(c: &C, id: &str, line: String) { c.con_q.lock().entry(id.to_string()).or_default().push(line); }
pub fn host_log_line(c: &C, id: &str, line: String) {
    let Some(r) = c.hosted.lock().get(id).cloned() else { return };
    { let mut l = r.lines.lock(); l.push(line.clone()); if l.len() > 2500 { l.remove(0); } }
    c.host_q.lock().entry(id.to_string()).or_default().push(line);
}
pub fn run_add(c: &C, id: &str, r: &Run, line: String) { { let mut l = r.lines.lock(); l.push(line.clone()); if l.len() > 6000 { l.remove(0); } } emit_console(c, id, line); }

pub fn start_tickers(c: &C) {
    let c1 = c.clone();
    tokio::spawn(async move { loop { sleep_ms(80).await;
        let q: Vec<String> = std::mem::take(&mut *c1.log_q.lock()); if !q.is_empty() { c1.emit("log", json!({ "lines": q })); }
        let cq: HashMap<String, Vec<String>> = std::mem::take(&mut *c1.con_q.lock()); for (id, ls) in cq { c1.emit("console", json!({ "id": id, "lines": ls })); }
        let hq: HashMap<String, Vec<String>> = std::mem::take(&mut *c1.host_q.lock()); for (id, ls) in hq { c1.emit("hostlog", json!({ "id": id, "lines": ls })); }
    } });
    let c2 = c.clone();
    tokio::spawn(async move { let mut last = 0usize; loop { sleep_ms(200).await;
        let mut arr = vec![]; { let mut jobs = c2.jobs.lock();
            jobs.retain(|_, j| !(j.finished.load(Ordering::Relaxed) && now_ms() - j.ended.load(Ordering::Relaxed) > 1200));
            let mut v: Vec<&JobRef> = jobs.values().collect(); v.sort_by_key(|j| j.id);
            for j in v { arr.push(json!({ "id": j.id, "title": j.title, "label": j.inner.lock().label, "total": j.total.load(Ordering::Relaxed), "done": j.done.load(Ordering::Relaxed), "bytes": j.bytes.load(Ordering::Relaxed), "finished": j.finished.load(Ordering::Relaxed) })); } }
        if !arr.is_empty() || last > 0 { last = arr.len(); c2.emit("jobs", json!(arr)); }
    } });
}

/// Runs `f` as a tracked job and waits for it. Returns the error text ("" on success), like the JS startJob promise.
pub async fn start_job<F, Fut>(c: &C, title: &str, f: F) -> String where F: FnOnce(JobRef) -> Fut, Fut: std::future::Future<Output = R<()>> {
    let j = Arc::new(Job { id: c.job_seq.fetch_add(1, Ordering::SeqCst) + 1, title: title.to_string(), inner: Mutex::new(JobInner { label: String::new(), err: String::new() }), total: AtomicI64::new(0), done: AtomicI64::new(0), bytes: AtomicU64::new(0), cancel: AtomicBool::new(false), finished: AtomicBool::new(false), ended: AtomicI64::new(0) });
    c.jobs.lock().insert(j.id, j.clone());
    let res = f(j.clone()).await;
    let mut err = String::new();
    if let Err(e) = res { err = e.0; c.log(format!("[job] {} failed: {}", title, err)); j.inner.lock().err = err.clone(); }
    j.finished.store(true, Ordering::Relaxed); j.ended.store(now_ms(), Ordering::Relaxed);
    if !err.is_empty() && !j.cancelled() { c.toast(format!("{}: {}", title, err), true); }
    err
}
pub fn job_result(e: String) -> Value { json!({ "err": e }) }

// ---------------------------------------------------------------- network
pub async fn fetch_retry(c: &C, url: &str, tries: u32) -> R<reqwest::Response> {
    let mut last = E("request failed".into());
    for i in 0..tries {
        match c.http.get(url).send().await {
            Ok(r) if r.status().is_success() => return Ok(r),
            Ok(r) => last = E(format!("HTTP {} for {}", r.status().as_u16(), url)),
            Err(e) => last = E(e.to_string()),
        }
        sleep_ms(300 * (i as u64 + 1)).await;
    }
    Err(last)
}
pub async fn get_json(c: &C, url: &str) -> R<Value> { Ok(fetch_retry(c, url, 3).await?.json().await?) }
pub async fn get_bytes(c: &C, url: &str, tries: u32) -> R<Vec<u8>> { Ok(fetch_retry(c, url, tries).await?.bytes().await?.to_vec()) }
pub async fn post_json_raw(c: &C, url: &str, body: &Value) -> R<reqwest::Response> { Ok(c.http.post(url).header("Accept", "application/json").json(body).send().await?) }

pub async fn download(c: &C, url: &str, dest: &Path, j: Option<&JobRef>) -> R<()> {
    use futures_util::StreamExt; use tokio::io::AsyncWriteExt;
    let mut last = E("download failed".into());
    for i in 0..3u64 {
        if j.map(|j| j.cancelled()).unwrap_or(false) { return bail("cancelled"); }
        let attempt: R<()> = async {
            let res = fetch_retry(c, url, 1).await?; if let Some(d) = dest.parent() { tokio::fs::create_dir_all(d).await?; }
            let tmp = PathBuf::from(format!("{}.part", dest.to_string_lossy()));
            let mut f = tokio::fs::File::create(&tmp).await?; let mut s = res.bytes_stream();
            while let Some(chunk) = s.next().await { let ch = chunk?; if let Some(j) = j { j.bytes.fetch_add(ch.len() as u64, Ordering::Relaxed); } f.write_all(&ch).await?; }
            f.flush().await?; drop(f); tokio::fs::rename(&tmp, dest).await?; Ok(())
        }.await;
        match attempt { Ok(()) => return Ok(()), Err(e) => { last = e; sleep_ms(250 * (i + 1)).await; } }
    }
    Err(last)
}
#[derive(Clone)]
pub struct Task { pub url: String, pub dest: PathBuf, pub size: i64 }
pub async fn download_all(c: &C, tasks: Vec<Task>, j: &JobRef) -> R<usize> {
    use futures_util::StreamExt;
    let todo: Vec<Task> = tasks.into_iter().filter(|t| !t.url.is_empty() && !(fsize(&t.dest) > 0 && (t.size == 0 || fsize(&t.dest) == t.size))).collect();
    j.total.store(todo.len() as i64, Ordering::Relaxed); j.done.store(0, Ordering::Relaxed);
    let threads = (gi(&c.st(), "threads").max(1) as usize).min(todo.len().max(1));
    let failed = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    futures_util::stream::iter(todo).for_each_concurrent(threads, |t| { let failed = failed.clone(); async move {
        if j.cancelled() { return; }
        if download(c, &t.url, &t.dest, Some(j)).await.is_err() { failed.fetch_add(1, Ordering::Relaxed); c.log(format!("download failed: {}", t.url)); }
        j.tick();
    } }).await;
    if j.cancelled() { return bail("cancelled"); }
    Ok(failed.load(Ordering::Relaxed))
}
pub fn unzip_sync(zip_path: &Path, dest: &Path, strip: &str, filter: Option<&dyn Fn(&str) -> bool>, flat: bool) -> R<usize> {
    let mut z = zip::ZipArchive::new(std::fs::File::open(zip_path)?)?; let mut n = 0;
    for k in 0..z.len() {
        let mut e = z.by_index(k)?; if e.is_dir() { continue; }
        let mut name = e.name().replace('\\', "/");
        if !strip.is_empty() { if !name.starts_with(strip) { continue; } name = name[strip.len()..].to_string(); }
        if name.is_empty() || name.contains("..") || name.starts_with('/') || name.contains(':') { continue; }
        if let Some(f) = filter { if !f(&name) { continue; } }
        let out = if flat { dest.join(name.rsplit('/').next().unwrap_or(&name)) } else { dest.join(&name) };
        if let Some(d) = out.parent() { std::fs::create_dir_all(d)?; }
        let mut f = std::fs::File::create(&out)?; std::io::copy(&mut e, &mut f)?; n += 1;
    }
    Ok(n)
}
pub async fn unzip(zip_path: &Path, dest: &Path, strip: &str, flat: bool) -> R<usize> {
    let (a, b, s) = (zip_path.to_path_buf(), dest.to_path_buf(), strip.to_string()); blocking(move || unzip_sync(&a, &b, &s, None, flat)).await
}

// ---------------------------------------------------------------- processes
pub fn command(program: impl AsRef<std::ffi::OsStr>) -> tokio::process::Command {
    #[allow(unused_mut)] let mut c = tokio::process::Command::new(program);
    #[cfg(windows)] c.creation_flags(0x08000000);
    c
}
pub fn trunc(s: &str, n: usize) -> String { s.chars().take(n).collect() }
/// Spawns a process, streams every output line to `on_line`, returns the exit code (-1 on spawn failure).
pub async fn run_lines(mut cmd: tokio::process::Command, mut on_line: impl FnMut(String)) -> i32 {
    use tokio::io::{AsyncBufReadExt, BufReader};
    cmd.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).stdin(std::process::Stdio::null());
    let Ok(mut ch) = cmd.spawn() else { return -1 };
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    if let Some(o) = ch.stdout.take() { let tx = tx.clone(); tokio::spawn(async move { let mut l = BufReader::new(o).lines(); while let Ok(Some(x)) = l.next_line().await { if !x.is_empty() { let _ = tx.send(x); } } }); }
    if let Some(o) = ch.stderr.take() { let tx = tx.clone(); tokio::spawn(async move { let mut l = BufReader::new(o).lines(); while let Ok(Some(x)) = l.next_line().await { if !x.is_empty() { let _ = tx.send(x); } } }); }
    drop(tx);
    while let Some(l) = rx.recv().await { on_line(l); }
    ch.wait().await.ok().and_then(|s| s.code()).unwrap_or(-1)
}

pub fn app_state(app: &AppHandle) -> C { app.state::<C>().inner().clone() }
