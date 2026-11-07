use crate::core::*;
use crate::mc::{run_prepare, urlenc};
use crate::util::*;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;

pub fn sub_dir(t: &str) -> &'static str { match t { "resourcepack" => "resourcepacks", "shader" => "shaderpacks", "world" => "saves", _ => "mods" } }
pub fn content_dir(c: &Core, inst: &Value, t: &str) -> PathBuf { c.game_dir(inst).join(sub_dir(t)) }
pub fn primary_file(v: &Value) -> Option<Value> { let f = arr(v, "files"); f.iter().find(|x| gb(x, "primary")).or(f.first()).cloned() }
fn content_json(c: &Core, inst: &Value) -> PathBuf { c.dir_inst(inst).join("content.json") }
fn record(c: &Core, inst: &Value, file: &str, rec: Value) { let p = content_json(c, inst); let mut j = read_obj(&p); j[file] = rec; write_json(&p, &j); }
fn installed_ids(c: &Core, inst: &Value) -> HashSet<String> { read_obj(content_json(c, inst)).as_object().map(|o| o.values().map(|r| gs(r, "project_id")).filter(|s| !s.is_empty()).collect()).unwrap_or_default() }
pub fn installed_id_list(c: &Core, inst: &Value) -> Value { json!(read_obj(content_json(c, inst)).as_object().map(|o| o.values().map(|r| r["project_id"].clone()).collect::<Vec<_>>()).unwrap_or_default()) }

pub async fn mr_search(c: &C, a: &Value) -> R<Value> {
    let ty = gs(a, "type"); let mut facets = vec![json!([format!("project_type:{}", ty)])];
    if !gs(a, "category").is_empty() { facets.push(json!([format!("categories:{}", gs(a, "category"))])); }
    if !gs(a, "mc").is_empty() { facets.push(json!([format!("versions:{}", gs(a, "mc"))])); }
    if !gs(a, "loader").is_empty() && ty == "mod" { facets.push(json!([format!("categories:{}", gs(a, "loader"))])); }
    let sort = if gs(a, "sort").is_empty() { "relevance".to_string() } else { gs(a, "sort") };
    let u = format!("{}/search?query={}&facets={}&index={}&limit=20&offset={}", MR, urlenc(&gs(a, "query")), urlenc(&Value::Array(facets).to_string()), sort, gi(a, "offset"));
    let j = get_json(c, &u).await?;
    Ok(json!({ "total": j["total_hits"], "hits": arr(&j, "hits").iter().map(|h| json!({ "id": h["project_id"], "slug": h["slug"], "title": h["title"], "desc": h["description"], "icon": h["icon_url"].as_str().unwrap_or(""), "author": h["author"], "type": h["project_type"], "downloads": h["downloads"], "follows": h["follows"], "cats": arr(h, "display_categories").iter().take(4).collect::<Vec<_>>(), "color": h["color"] })).collect::<Vec<_>>() }))
}
pub async fn mr_pick_version(c: &C, pid: &str, mc: &str, loader: &str, use_loader: bool) -> Option<Value> {
    let mut q = vec![]; if !mc.is_empty() { q.push(format!("game_versions={}", urlenc(&json!([mc]).to_string()))); }
    if use_loader && !loader.is_empty() && loader != "vanilla" { q.push(format!("loaders={}", urlenc(&json!([loader]).to_string()))); }
    let a = get_json(c, &format!("{}/project/{}/version{}", MR, pid, if q.is_empty() { String::new() } else { format!("?{}", q.join("&")) })).await.ok()?;
    let a = a.as_array()?; if a.is_empty() { return None; } Some(a.iter().find(|v| gs(v, "version_type") == "release").unwrap_or(&a[0]).clone())
}
pub fn mr_install<'a>(c: &'a C, inst: &'a Value, pid: &'a str, ty: &'a str, j: &'a JobRef, visited: &'a mut HashSet<String>, force: &'a str, depth: u32) -> Pin<Box<dyn Future<Output = R<()>> + Send + 'a>> {
    Box::pin(async move {
        if !visited.insert(pid.to_string()) { return Ok(()); }
        if depth == 0 { j.label("Checking what is already installed"); identify_content(c, inst).await; }
        if installed_ids(c, inst).contains(pid) { if depth == 0 { return bail("Already installed in this instance"); } return Ok(()); }
        let loader = gs(inst, "loader"); let mc = gs(inst, "mc");
        if ty == "mod" && loader == "rust" { return bail("Horizon (Rust) cannot run Java mods. It has its own WebAssembly mod system. Resource packs and data packs work."); }
        let proj = get_json(c, &format!("{}/project/{}", MR, pid)).await.unwrap_or(json!({}));
        let title = if gs(&proj, "title").is_empty() { pid.to_string() } else { gs(&proj, "title") }; j.label(format!("Installing {}", title));
        let mut ver = None; if !force.is_empty() { ver = get_json(c, &format!("{}/version/{}", MR, force)).await.ok(); }
        if ver.is_none() { ver = mr_pick_version(c, pid, &mc, &loader, ty == "mod").await; }
        let Some(ver) = ver else { return bail(format!("No compatible version of {} for {}{}", title, mc, if ty == "mod" { format!(" ({})", loader) } else { String::new() })); };
        let Some(f) = primary_file(&ver) else { return bail(format!("No file for {}", title)); };
        let fname = sanitize(&gs(&f, "filename")); download(c, &gs(&f, "url"), &content_dir(c, inst, ty).join(&fname), Some(j)).await?;
        record(c, inst, &fname, json!({ "project_id": pid, "title": title, "version": ver["version_number"], "icon": proj["icon_url"].as_str().unwrap_or(""), "type": ty, "sha1": f["hashes"]["sha1"] }));
        if ty == "mod" && depth < 4 { for d in arr(&ver, "dependencies") { if gs(d, "dependency_type") == "required" && !gs(d, "project_id").is_empty() { if let Err(e) = mr_install(c, inst, &gs(d, "project_id"), "mod", j, visited, &gs(d, "version_id"), depth + 1).await { c.log(format!("dependency: {}", e.0)); } } } }
        Ok(())
    })
}
pub async fn install_mrpack(c: &C, file: &Path, j: &JobRef) -> R<Value> {
    j.stage("Reading modpack", 0); let f2 = file.to_path_buf();
    let idx: Value = blocking(move || -> R<Value> { let mut z = zip::ZipArchive::new(std::fs::File::open(&f2)?)?; let mut e = z.by_name("modrinth.index.json").map_err(|_| E("Not a valid .mrpack".into()))?; let mut s = String::new(); std::io::Read::read_to_string(&mut e, &mut s)?; Ok(serde_json::from_str(&s)?) }).await?;
    let deps = &idx["dependencies"]; let (mut loader, mut lv) = ("vanilla".to_string(), String::new());
    for (k, n) in [("fabric-loader", "fabric"), ("quilt-loader", "quilt"), ("forge", "forge"), ("neoforge", "neoforge")] { if !gs(deps, k).is_empty() { loader = n.into(); lv = gs(deps, k); } }
    if gs(deps, "minecraft").is_empty() { return bail("Modpack has no Minecraft version"); }
    let name = if gs(&idx, "name").is_empty() { "Modpack".into() } else { gs(&idx, "name") };
    let inst = c.make_instance(&name, &gs(deps, "minecraft"), &loader, &lv); let gd = c.game_dir(&inst); push_state(c);
    let tasks: Vec<Task> = arr(&idx, "files").iter().filter_map(|f| { if gs(&f["env"], "client") == "unsupported" { return None; } let rel = gs(f, "path"); if rel.is_empty() || !safe_rel(&rel) || rel.contains(':') { return None; } let u = f["downloads"][0].as_str()?; Some(Task { url: u.to_string(), dest: gd.join(&rel), size: gi(f, "fileSize") }) }).collect();
    j.stage("Downloading pack files", 0); download_all(c, tasks, j).await?;
    j.stage("Applying overrides", 0); unzip(file, &gd, "overrides/", false).await?; unzip(file, &gd, "client-overrides/", false).await?;
    c.save_inst(&inst); Ok(inst)
}
pub async fn identify_content(c: &C, inst: &Value) -> bool {
    let cp = c.dir_inst(inst).join("hash-cache.json"); let mut cache = read_obj(&cp); let rp = content_json(c, inst); let mut rec = read_obj(&rp);
    let mut files: Vec<(String, String, PathBuf)> = vec![];
    for (ty, sub) in [("mod", "mods"), ("resourcepack", "resourcepacks"), ("shader", "shaderpacks")] {
        if let Ok(rd) = std::fs::read_dir(c.game_dir(inst).join(sub)) { for e in rd.flatten() { let n = e.file_name().to_string_lossy().to_string(); let base = n.trim_end_matches(".disabled").to_string(); let l = base.to_lowercase();
            if e.file_type().map(|t| t.is_file()).unwrap_or(false) && (l.ends_with(".jar") || l.ends_with(".zip")) { files.push((ty.into(), base, e.path())); } } }
    }
    let need: Vec<_> = files.into_iter().filter(|f| gs(&rec[&f.1], "project_id").is_empty()).collect(); if need.is_empty() { return false; }
    let mut keys = vec![];
    for (ty, name, full) in &need {
        let md = std::fs::metadata(full); let (size, mt) = md.map(|m| (m.len(), mtime_ms(full).floor() as i64)).unwrap_or((0, 0)); let key = format!("{}/{}|{}|{}", ty, name, size, mt);
        if cache[&key].is_null() { let f = full.clone(); let h = blocking(move || sha1_file(&f)).await.unwrap_or_default(); cache[&key] = json!({ "sha1": h }); }
        keys.push(key);
    }
    let unknown: Vec<usize> = (0..need.len()).filter(|i| cache[&keys[*i]].get("pid").is_none()).collect();
    let res: R<bool> = async {
        for chunk in unknown.chunks(100) {
            let hashes: Vec<String> = chunk.iter().map(|i| gs(&cache[&keys[*i]], "sha1")).collect();
            let r: Value = c.http.post(format!("{}/version_files", MR)).json(&json!({ "hashes": hashes, "algorithm": "sha1" })).send().await?.json().await?;
            for i in chunk { let v = &r[gs(&cache[&keys[*i]], "sha1")]; cache[&keys[*i]]["pid"] = if v.is_object() { v["project_id"].clone() } else { Value::Null }; cache[&keys[*i]]["ver"] = json!(if v.is_object() { gs(v, "version_number") } else { String::new() }); }
        }
        let pids: Vec<String> = { let mut s = HashSet::new(); keys.iter().filter_map(|k| cache[k]["pid"].as_str().map(String::from)).filter(|p| s.insert(p.clone())).collect() };
        let mut info = std::collections::HashMap::new();
        for chunk in pids.chunks(100) { let a: Value = fetch_retry(c, &format!("{}/projects?ids={}", MR, urlenc(&json!(chunk).to_string())), 3).await?.json().await?; for p in a.as_array().cloned().unwrap_or_default() { info.insert(gs(&p, "id"), (gs(&p, "title"), p["icon_url"].as_str().unwrap_or("").to_string())); } }
        let mut changed = false;
        for (n, (ty, name, _)) in need.iter().enumerate() { let ce = &cache[&keys[n]]; if let Some(pid) = ce["pid"].as_str() { let (t, ic) = info.get(pid).cloned().unwrap_or((String::new(), String::new())); rec[name] = json!({ "project_id": pid, "title": if t.is_empty() { name.clone() } else { t }, "version": gs(ce, "ver"), "icon": ic, "type": ty, "sha1": ce["sha1"] }); changed = true; } }
        if changed { write_json(&rp, &rec); } write_json(&cp, &cache); Ok(changed)
    }.await;
    match res { Ok(b) => b, Err(e) => { c.log(format!("identify failed: {}", e.0)); write_json(&cp, &cache); false } }
}
pub fn list_content(c: &Core, inst: &Value, kind: &str) -> Value {
    let dir = content_dir(c, inst, kind); let rec = read_obj(content_json(c, inst)); let mut out: Vec<Value> = vec![];
    let Ok(rd) = std::fs::read_dir(&dir) else { return json!([]) };
    for e in rd.flatten() {
        let f = e.file_name().to_string_lossy().to_string(); let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if kind == "world" { if is_dir {
            let icon = std::fs::read(dir.join(&f).join("icon.png")).map(|b| { use base64::Engine; format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(b)) }).unwrap_or_default();
            let mut mt = mtime_ms(&dir.join(&f).join("level.dat")); if mt == 0.0 { mt = mtime_ms(&dir.join(&f)); }
            out.push(json!({ "file": f, "title": f, "enabled": true, "size": 0, "dir": true, "icon": icon, "mtime": mt })); } continue; }
        let dis = f.ends_with(".disabled"); let base = if dis { f[..f.len() - 9].to_string() } else { f.clone() }; let r = &rec[&base];
        out.push(json!({ "file": f, "title": if gs(r, "title").is_empty() { base.clone() } else { gs(r, "title") }, "ver": gs(r, "version"), "icon": gs(r, "icon"), "enabled": !dis, "size": if is_dir { 0 } else { fsize(dir.join(&f)) }, "dir": is_dir }));
    }
    out.sort_by_key(|x| gs(x, "title").to_lowercase()); json!(out)
}
pub async fn update_mods(c: &C, inst: &Value, j: &JobRef) -> R<()> {
    let dir = content_dir(c, inst, "mod"); let files: Vec<String> = std::fs::read_dir(&dir).map(|r| r.flatten().map(|e| e.file_name().to_string_lossy().to_string()).filter(|f| f.ends_with(".jar")).collect()).unwrap_or_default();
    if files.is_empty() { return bail("No mods to update"); }
    j.stage("Checking for updates", 0); let mut hashes = std::collections::HashMap::new();
    for f in &files { hashes.insert(sha1_hex(&std::fs::read(dir.join(f))?), f.clone()); }
    let mut body = json!({ "hashes": hashes.keys().collect::<Vec<_>>(), "algorithm": "sha1", "game_versions": [gs(inst, "mc")] }); if gs(inst, "loader") != "vanilla" { body["loaders"] = json!([gs(inst, "loader")]); }
    let res: Value = c.http.post(format!("{}/version_files/update", MR)).json(&body).send().await?.json().await?;
    let upd: Vec<(String, Value)> = res.as_object().map(|o| o.iter().filter(|(h, v)| primary_file(v).map(|f| gs(&f["hashes"], "sha1") != **h).unwrap_or(false)).map(|(h, v)| (h.clone(), v.clone())).collect()).unwrap_or_default();
    if upd.is_empty() { j.label("Everything is up to date"); return Ok(()); }
    j.stage("Updating mods", upd.len() as i64);
    for (h, v) in &upd {
        let f = primary_file(v).unwrap(); let old = hashes[h].clone(); let nf = sanitize(&gs(&f, "filename")); j.label(format!("Updating {}", nf));
        download(c, &gs(&f, "url"), &dir.join(&nf), Some(j)).await?;
        let rp = content_json(c, inst); let mut r = read_obj(&rp); let prev = r[&old].clone(); r.as_object_mut().map(|o| o.remove(&old));
        let mut n = if prev.is_object() { prev } else { json!({}) }; n["version"] = v["version_number"].clone(); n["sha1"] = f["hashes"]["sha1"].clone(); r[&nf] = n; write_json(&rp, &r);
        if old != nf { let _ = std::fs::remove_file(dir.join(&old)); } j.tick();
    }
    c.toast(format!("Updated {} mod(s)", upd.len()), false); Ok(())
}
pub async fn project_detail(c: &C, id: &str) -> R<Value> {
    let (p, vers, mem) = { let (u1, u2, u3) = (format!("{}/project/{}", MR, id), format!("{}/project/{}/version", MR, id), format!("{}/project/{}/members", MR, id)); tokio::join!(get_json(c, &u1), get_json(c, &u2), get_json(c, &u3)) };
    let p = p?; let vers = vers.unwrap_or(json!([])); let mem = mem.unwrap_or(json!([]));
    let s = |k: &str| p[k].clone();
    Ok(json!({
        "project": { "id": s("id"), "slug": s("slug"), "type": s("project_type"), "title": s("title"), "description": s("description"), "body": p["body"].as_str().unwrap_or(""), "icon": p["icon_url"].as_str().unwrap_or(""), "downloads": s("downloads"), "followers": s("followers"), "categories": p["categories"].clone(), "loaders": p["loaders"].clone(), "versions": p["game_versions"].clone(),
            "client": s("client_side"), "server": s("server_side"), "license": if gs(&p["license"], "name").is_empty() { p["license"]["id"].clone() } else { p["license"]["name"].clone() }, "source": s("source_url"), "issues": s("issues_url"), "wiki": s("wiki_url"), "discord": s("discord_url"), "published": s("published"), "updated": s("updated"),
            "gallery": arr(&p, "gallery").iter().map(|g| json!({ "url": g["url"], "title": g["title"].as_str().unwrap_or(""), "description": g["description"].as_str().unwrap_or("") })).collect::<Vec<_>>() },
        "versions": vers.as_array().cloned().unwrap_or_default().iter().take(40).map(|v| json!({ "id": v["id"], "name": v["name"], "number": v["version_number"], "type": v["version_type"], "games": v["game_versions"], "loaders": v["loaders"], "date": v["date_published"], "downloads": v["downloads"] })).collect::<Vec<_>>(),
        "members": mem.as_array().cloned().unwrap_or_default().iter().map(|x| json!({ "name": x["user"]["username"], "role": x["role"] })).collect::<Vec<_>>(),
    }))
}
pub async fn prepare_job(c: &C, inst_id: &str, title: &str) -> String {
    let Some(mut i) = c.get_inst(inst_id) else { return String::new() };
    start_job(c, title, |j| async move { run_prepare(c, &mut i, &j).await }).await
}
