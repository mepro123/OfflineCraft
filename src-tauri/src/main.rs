#![recursion_limit = "512"]
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#[cfg(test)] mod tests;
mod api; mod auth; mod content; mod core; mod feat; mod feat2; mod host; mod mc; mod skins; mod util;
use crate::core::*;
use crate::util::*;
use parking_lot::Mutex;
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::DialogExt;

fn pick_root() -> std::path::PathBuf {
    if let Ok(d) = std::env::var("OC_DATA") { return d.into(); }
    let base = std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.to_path_buf())).unwrap_or_default(); let c = base.join("data");
    if std::fs::create_dir_all(&c).is_ok() && std::fs::write(c.join(".w"), "1").is_ok() { let _ = std::fs::remove_file(c.join(".w")); return c; }
    let f = std::path::PathBuf::from(std::env::var("LOCALAPPDATA").or(std::env::var("HOME")).unwrap_or_default()).join("OfflineCraft").join("data"); let _ = std::fs::create_dir_all(&f); f
}
fn main() {
    let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("tokio runtime");
    tauri::async_runtime::set(rt.handle().clone()); let _guard = rt.enter();
    let root = pick_root(); let _ = std::fs::create_dir_all(&root); let _ = std::fs::remove_file(root.join(".ui-ready"));
    let argv: Vec<String> = std::env::args().collect();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| { if let Some(w) = app.get_webview_window("main") { let _ = w.unminimize(); let _ = w.show(); let _ = w.set_focus(); } if let Some(c) = app.try_state::<C>() { let c: C = c.inner().clone(); feat2::cli(&c, &argv); } }))
        .plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_opener::init()).plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![api::oc])
        .setup(move |app| {
            let h = app.handle().clone(); let settings = {
                let mut s = default_settings(); if let Some(o) = read_json_opt(root.join("settings.json")) { if let Some(m) = o.as_object() { for (k, v) in m { s[k] = v.clone(); } } }
                let u = gs(&s, "username"); if !u.is_empty() && gs(&s, "activeMs").is_empty() && !arr(&s, "accounts").iter().any(|x| x.as_str() == Some(&u)) { if let Some(l) = s["accounts"].as_array_mut() { l.insert(0, json!(u)); } }
                if !gb(&s, "v3") { if arr(&s, "accounts").len() == 1 && arr(&s, "accounts")[0] == "Player" { s["accounts"] = json!([]); s["username"] = json!(""); } s["v3"] = json!(true); }
                if !gb(&s, "v2") { s["minimizeOnLaunch"] = json!(false); s["v2"] = json!(true); } s };
            let start_mark = root.join(".starting"); let safe_file = root.join("safe-level.json");
            let mut level = read_obj(&safe_file)["level"].as_u64().unwrap_or(0) as u8; let mut fails = std::fs::read_to_string(&start_mark).ok().and_then(|s| s.trim().parse::<u32>().ok()).unwrap_or(0); if fails > 6 { fails = 1; }
            let mode = gs(&settings, "gpuMode"); let mode_level = match mode.as_str() { "d3d11" => Some(0), "dcomp" => Some(1), "gl" => Some(2), "d3d11on12" => Some(3), "nosandbox" => Some(4), "nosandboxall" => Some(5), "software" => Some(6), _ => None };
            let warn = fails > 0; if fails > 0 { level = level.max(fails.min(7) as u8); } if let Some(m) = mode_level { level = level.max(m); } let _ = std::fs::write(&start_mark, (fails + 1).to_string());
            let rounded = gs(&settings, "winStyle") != "classic" && mode != "software" && level < 6 && !argv.iter().any(|a| a == "--classic-window");
            let http = reqwest::Client::builder().user_agent(UA).connect_timeout(std::time::Duration::from_secs(20)).build()?;
            let c: C = Arc::new(Core { app: h.clone(), root: root.clone(), http, settings: Mutex::new(settings), instances: Mutex::new(vec![]), running: Mutex::new(HashMap::new()), busy: Mutex::new(HashSet::new()), jobs: Mutex::new(HashMap::new()), job_seq: AtomicU64::new(0), manifest: Mutex::new(vec![]), javas: Mutex::new(vec![]), log_lines: Mutex::new(vec![]), log_q: Mutex::new(vec![]), con_q: Mutex::new(HashMap::new()), host_q: Mutex::new(HashMap::new()), hosted: Mutex::new(HashMap::new()), mode_cache: Mutex::new(HashMap::new()), level: AtomicU8::new(level), rounded: AtomicBool::new(rounded), maxed: AtomicBool::new(false), restore: Mutex::new(None), push_pending: AtomicBool::new(false), ui_loaded: AtomicBool::new(false), start_mark: start_mark.clone(), safe_file: safe_file.clone() });
            app.manage(c.clone()); let _ = AtomicI64::new(0);
            c.log(format!("startup: tauri {} {} data={} webview={}", tauri::VERSION, std::env::consts::OS, root.display(), tauri::webview_version().unwrap_or_default()));
            if warn { c.log(format!("WARNING: previous start did not finish ({}x) - using safer graphics level {}", fails, level)); }
            c.log(format!("graphics: level {}, mode={}", level, mode));
            let flags = match level { 1 => "--disable-direct-composition", 2 => "--use-angle=gl", 3 => "--use-angle=d3d11on12", 4 => "--disable-gpu-sandbox", l if l >= 6 => "--disable-gpu --in-process-gpu --disable-gpu-sandbox", _ => "" };
            if !flags.is_empty() { std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", flags); }
            for d in ["instances", "versions", "libraries", "assets", "cache", "runtimes"] { let _ = std::fs::create_dir_all(c.p(&[d])); }
            if let Ok(rd) = std::fs::read_dir(c.p(&["backgrounds"])) { let keep = c.st_s("bgFile"); for f in rd.flatten() { if f.file_name().to_string_lossy() != keep { let _ = std::fs::remove_file(f.path()); } } }
            start_tickers(&c); c.load_instances(); feat::restore_holds(&c);
            let m = if rounded { 2 * WIN_M } else { 0 } as f64;
            let c_load = c.clone();
            let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into())).title("OfflineCraft").inner_size(1320.0 + m, 820.0 + m).min_inner_size(1000.0 + m, 640.0 + m).decorations(false).transparent(rounded).shadow(!rounded).resizable(!rounded).visible(false).data_directory(root.join("webview"))
                .on_page_load(move |w, p| { if matches!(p.event(), tauri::webview::PageLoadEvent::Finished) && !c_load.ui_loaded.swap(true, Ordering::SeqCst) {
                    let c = c_load.clone(); let w = w.clone(); c.log("UI loaded"); let _ = w.show(); api::apply_zoom(&c);
                    tokio::spawn(async move { sleep_ms(120).await; let _ = std::fs::write(c.p(&[".ui-ready"]), now_ms().to_string()); sleep_ms(1380).await; let _ = std::fs::remove_file(&c.start_mark); let lv = c.level.load(Ordering::Relaxed); if lv > 0 && c.st_s("gpuMode") != "software" { write_json(&c.safe_file, &json!({ "level": lv })); } let args: Vec<String> = std::env::args().collect(); feat2::cli(&c, &args);
                        if let Ok(f) = std::env::var("OC_SELFTEST") { if let Some(list) = read_json_opt(&f) { for call in list.as_array().cloned().unwrap_or_default() { let name = gs(&call, "n"); if name == "_sleep" { sleep_ms(1500).await; continue; } let a = call["a"].as_array().cloned().unwrap_or_default(); let r = api::call(&c, &name, a).await; let t = match r { Ok(v) => v.to_string(), Err(e) => format!("ERR {}", e.0) }; c.log(format!("SELFTEST {} => {}", name, trunc(&t, 400))); } c.log("SELFTEST done"); } } }); } })
                .build()?;
            let _ = win.set_icon(tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))?);
            let c_ev = c.clone(); win.on_window_event(move |ev| match ev {
                WindowEvent::Resized(_) => { if !c_ev.rounded.load(Ordering::Relaxed) { if let Some(w) = api::main_win(&c_ev) { c_ev.emit("maxed", json!(w.is_maximized().unwrap_or(false))); } } }
                WindowEvent::Moved(_) => { if c_ev.rounded.load(Ordering::Relaxed) && c_ev.maxed.load(Ordering::Relaxed) { if let Some(w) = api::main_win(&c_ev) { if let (Ok(p), Ok(z), Ok(Some(mo))) = (w.outer_position(), w.outer_size(), w.current_monitor()) { let wa = mo.work_area(); if p != wa.position || z != wa.size { c_ev.maxed.store(false, Ordering::Relaxed); c_ev.emit("maxed", json!(false)); } } } } }
                _ => {} });
            let c_t = c.clone(); tokio::spawn(async move { sleep_ms(1500).await; auth::cache_ms_skins(&c_t).await; sleep_ms(6500).await;
                if !c_t.ui_loaded.load(Ordering::Relaxed) && c_t.level.load(Ordering::Relaxed) < 2 && !std::env::args().any(|a| a == "--oc-relaunched") { c_t.log("UI not loaded after 8s - relaunching in safer graphics mode"); let _ = std::fs::write(&c_t.safe_file, json!({ "level": 2 }).to_string()); api::relaunch(&c_t, &["--oc-relaunched"]); }
                sleep_ms(7000).await; if !c_t.ui_loaded.load(Ordering::Relaxed) { c_t.app.dialog().message("The interface did not load within 15 seconds.\nSee data\\launcher.log for details.").title("OfflineCraft").blocking_show(); } });
            Ok(())
        })
        .build(tauri::generate_context!()).expect("error while building OfflineCraft")
        .run(|app, ev| { if let tauri::RunEvent::Exit = ev { if let Some(c) = app.try_state::<C>() { host::stop_all_hosts(&c); } } });
}
