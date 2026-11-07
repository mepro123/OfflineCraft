use crate::core::*;
use crate::mc::*;
use crate::util::*;
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

// ================= Minecraft server list protocol =================
fn varint(mut n: u32) -> Vec<u8> { let mut b = vec![]; loop { let mut x = (n & 0x7f) as u8; n >>= 7; if n != 0 { x |= 0x80; } b.push(x); if n == 0 { break; } } b }
fn mc_str(s: &str) -> Vec<u8> { let mut v = varint(s.len() as u32); v.extend_from_slice(s.as_bytes()); v }
fn mc_packet(id: u32, parts: &[Vec<u8>]) -> Vec<u8> { let mut body = varint(id); for p in parts { body.extend_from_slice(p); } let mut o = varint(body.len() as u32); o.extend(body); o }
fn read_varint(buf: &[u8], mut off: usize) -> Option<(i32, usize)> { let (mut r, mut s) = (0i32, 0u32); loop { if off >= buf.len() { return None; } let b = buf[off]; off += 1; r |= ((b & 0x7f) as i32) << s; s += 7; if s > 35 { return None; } if b & 0x80 == 0 { break; } } Some((r, off)) }
fn flat_text(d: &Value) -> String { match d { Value::String(s) => s.clone(), Value::Object(_) => format!("{}{}", gs(d, "text"), arr(d, "extra").iter().map(flat_text).collect::<String>()), _ => String::new() } }
async fn read_packet(s: &mut TcpStream) -> Option<Vec<u8>> {
    let mut buf = vec![]; let mut tmp = [0u8; 4096];
    loop { if let Some((len, o)) = read_varint(&buf, 0) { if buf.len() >= o + len as usize { return Some(buf[o..o + len as usize].to_vec()); } } let n = s.read(&mut tmp).await.ok()?; if n == 0 { return None; } buf.extend_from_slice(&tmp[..n]); }
}
pub async fn mc_ping(host: &str, port: u16, timeout: u64) -> Value {
    let t0 = std::time::Instant::now();
    let r = tokio::time::timeout(Duration::from_millis(timeout), async {
        let mut s = TcpStream::connect((host, port)).await.map_err(|e| e.to_string())?;
        let hs = mc_packet(0, &[varint(767), mc_str(host), vec![(port >> 8) as u8, (port & 255) as u8], varint(1)]);
        s.write_all(&hs).await.map_err(|e| e.to_string())?; s.write_all(&mc_packet(0, &[])).await.map_err(|e| e.to_string())?;
        let p = read_packet(&mut s).await.ok_or("bad response".to_string())?;
        let (_, o) = read_varint(&p, 0).ok_or("bad response")?; let (sl, o) = read_varint(&p, o).ok_or("bad response")?;
        let j: Value = serde_json::from_slice(p.get(o..o + sl as usize).ok_or("bad response")?).map_err(|_| "bad response".to_string())?; Ok::<Value, String>(j)
    }).await;
    match r {
        Err(_) => json!({ "online": false, "err": "timeout" }),
        Ok(Err(e)) => json!({ "online": false, "err": e }),
        Ok(Ok(j)) => {
            let motd = regex::Regex::new(r"§.").unwrap().replace_all(&flat_text(&j["description"]), "").to_string(); let motd = regex::Regex::new(r"\s+").unwrap().replace_all(&motd, " ").trim().to_string();
            json!({ "online": true, "ms": t0.elapsed().as_millis() as i64, "version": gs(&j["version"], "name"), "protocol": if gi(&j["version"], "protocol") != 0 { gi(&j["version"], "protocol") } else { 767 }, "players": { "online": gi(&j["players"], "online"), "max": gi(&j["players"], "max"), "sample": arr(&j["players"], "sample").iter().map(|p| p["name"].clone()).collect::<Vec<_>>() }, "motd": motd, "favicon": gs(&j, "favicon") })
        }
    }
}
async fn mc_probe(host: &str, port: u16, protocol: i64, vhost: &str) -> String {
    let r = tokio::time::timeout(Duration::from_millis(4500), async {
        let mut s = TcpStream::connect((host, port)).await.ok()?;
        s.write_all(&mc_packet(0, &[varint(protocol as u32), mc_str(if vhost.is_empty() { host } else { vhost }), vec![(port >> 8) as u8, (port & 255) as u8], varint(2)])).await.ok()?;
        let name = mc_str("OCProbe"); let mut body = name.clone();
        if protocol >= 764 { body.extend_from_slice(&[0u8; 16]); } else if protocol >= 761 { body.push(0); } else if protocol >= 759 { body.extend_from_slice(&[0, 0]); }
        s.write_all(&mc_packet(0, &[body])).await.ok()?;
        let p = read_packet(&mut s).await?; let (id, _) = read_varint(&p, 0)?; Some(id)
    }).await;
    match r { Ok(Some(1)) => "online".into(), Ok(Some(2)) | Ok(Some(3)) => "offline".into(), _ => "unknown".into() }
}
pub async fn server_status(c: &C, a: &Value) -> Value {
    let host = gs(a, "host").trim().to_string(); let given = gi(a, "port") as u16; let (mut h, mut p) = (host.clone(), if given == 0 { 25565u16 } else { given });
    let is_ip = regex::Regex::new(r"^\d+\.\d+\.\d+\.\d+$").unwrap().is_match(&host);
    if given == 0 && !host.is_empty() && !is_ip {
        if let Ok(res) = hickory_resolver::TokioAsyncResolver::tokio_from_system_conf() { if let Ok(Ok(r)) = tokio::time::timeout(Duration::from_millis(1500), res.srv_lookup(format!("_minecraft._tcp.{}", host))).await { if let Some(x) = r.iter().next() { h = x.target().to_string().trim_end_matches('.').to_string(); p = x.port(); } } }
    }
    let mut st = mc_ping(&h, p, 4500).await; if !gb(&st, "online") { return st; }
    let key = format!("{}:{}", host, if given == 0 { String::new() } else { given.to_string() });
    let cached = c.mode_cache.lock().get(&key).cloned();
    st["mode"] = match cached { Some((m, t)) if now_ms() - t < 900000 => json!(m), _ => { let m = mc_probe(&h, p, gi(&st, "protocol"), &host).await; c.mode_cache.lock().insert(key, (m.clone(), now_ms())); json!(m) } };
    st
}

// ================= UPnP =================
async fn upnp_discover() -> Option<String> {
    let s = tokio::net::UdpSocket::bind("0.0.0.0:0").await.ok()?;
    for st in ["urn:schemas-upnp-org:device:InternetGatewayDevice:1", "urn:schemas-upnp-org:service:WANIPConnection:1", "upnp:rootdevice"] {
        let q = format!("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: {}\r\n\r\n", st); let _ = s.send_to(q.as_bytes(), "239.255.255.250:1900").await;
    }
    let re = regex::Regex::new(r"(?im)^location:\s*(.+)$").unwrap(); let mut buf = [0u8; 2048];
    tokio::time::timeout(Duration::from_millis(2500), async { loop { let (n, _) = s.recv_from(&mut buf).await.ok()?; if let Some(m) = re.captures(&String::from_utf8_lossy(&buf[..n])) { return Some(m[1].trim().to_string()); } } }).await.ok().flatten()
}
async fn upnp_service(c: &C, loc: &str) -> R<Option<(String, String)>> {
    let xml = c.http.get(loc).send().await?.text().await?; let blk = regex::Regex::new(r"(?s)<service>.*?</service>").unwrap();
    for b in blk.find_iter(&xml) { let b = b.as_str(); let st = regex::Regex::new(r"<serviceType>(.*?)</serviceType>").unwrap().captures(b).map(|m| m[1].to_string()).unwrap_or_default();
        if regex::Regex::new(r"WAN(IP|PPP)Connection").unwrap().is_match(&st) { if let Some(cu) = regex::Regex::new(r"<controlURL>(.*?)</controlURL>").unwrap().captures(b) { let base = url::Url::parse(loc)?; return Ok(Some((st, base.join(&cu[1])?.to_string()))); } } }
    Ok(None)
}
async fn upnp_soap(c: &C, svc: &(String, String), action: &str, args: &[(&str, String)]) -> R<String> {
    let inner: String = args.iter().map(|(k, v)| format!("<{}>{}</{}>", k, v, k)).collect();
    let body = format!("<?xml version=\"1.0\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:{a} xmlns:u=\"{t}\">{i}</u:{a}></s:Body></s:Envelope>", a = action, t = svc.0, i = inner);
    let r = c.http.post(&svc.1).header("Content-Type", "text/xml; charset=\"utf-8\"").header("SOAPAction", format!("\"{}#{}\"", svc.0, action)).body(body).send().await?; let ok = r.status().is_success(); let st = r.status().as_u16(); let t = r.text().await?;
    if !ok { return bail(regex::Regex::new(r"<errorDescription>(.*?)<").unwrap().captures(&t).map(|m| m[1].to_string()).unwrap_or(format!("router said HTTP {}", st))); } Ok(t)
}
pub fn local_ip() -> String {
    let ips: Vec<String> = local_ip_address::list_afinet_netifas().map(|l| l.into_iter().filter_map(|(_, ip)| match ip { std::net::IpAddr::V4(v) if !v.is_loopback() => Some(v.to_string()), _ => None }).collect()).unwrap_or_default();
    let re = |p: &str| regex::Regex::new(p).unwrap();
    ips.iter().find(|x| re(r"^192\.168\.").is_match(x)).or(ips.iter().find(|x| re(r"^10\.").is_match(x))).or(ips.iter().find(|x| re(r"^172\.(1[6-9]|2\d|3[01])\.").is_match(x))).or(ips.first()).cloned().unwrap_or("127.0.0.1".into())
}
fn is_private_ip(ip: &str) -> bool { regex::Regex::new(r"^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.)").unwrap().is_match(ip) || regex::Regex::new(r"^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.").unwrap().is_match(ip) }
async fn upnp_open(c: &C, port: i64) -> (Value, Option<(String, String)>) {
    let Some(loc) = upnp_discover().await else { return (json!({ "ok": false, "err": "No UPnP router found. Forward the port manually (see the steps below)." }), None) };
    let r: R<(Value, (String, String))> = async {
        let svc = upnp_service(c, &loc).await?.ok_or(E("Router has no port-mapping service".into()))?;
        upnp_soap(c, &svc, "AddPortMapping", &[("NewRemoteHost", String::new()), ("NewExternalPort", port.to_string()), ("NewProtocol", "TCP".into()), ("NewInternalPort", port.to_string()), ("NewInternalClient", local_ip()), ("NewEnabled", "1".into()), ("NewPortMappingDescription", "OfflineCraft Minecraft server".into()), ("NewLeaseDuration", "0".into())]).await?;
        let ip = upnp_soap(c, &svc, "GetExternalIPAddress", &[]).await.ok().and_then(|t| regex::Regex::new(r"<NewExternalIPAddress>(.*?)<").unwrap().captures(&t).map(|m| m[1].to_string())).unwrap_or_default();
        Ok((json!({ "ok": true, "ip": ip, "cgnat": !ip.is_empty() && is_private_ip(&ip) }), svc))
    }.await;
    match r { Ok((v, s)) => (v, Some(s)), Err(e) => (json!({ "ok": false, "err": format!("Router refused: {}", e.0) }), None) }
}
async fn upnp_close(c: &C, svc: &(String, String), port: i64) { let _ = upnp_soap(c, svc, "DeletePortMapping", &[("NewRemoteHost", String::new()), ("NewExternalPort", port.to_string()), ("NewProtocol", "TCP".into())]).await; }
async fn public_ip(c: &C) -> String { match c.http.get("https://api.ipify.org").send().await { Ok(r) => r.text().await.unwrap_or_default().trim().to_string(), Err(_) => String::new() } }

// ================= hosting your own server =================
fn host_dir(c: &Core, id: &str) -> std::path::PathBuf { c.p(&["servers", id]) }
fn host_meta(c: &Core, id: &str) -> Option<Value> { let mut m = read_json_opt(host_dir(c, id).join("server.json"))?; m["id"] = json!(id); Some(m) }
fn save_host_meta(c: &Core, m: &Value) { write_json(host_dir(c, &gs(m, "id")).join("server.json"), m); }
fn host_port(m: &Value) -> i64 { let p = m["props"]["server-port"].as_str().and_then(|s| s.parse().ok()).or(m["props"]["server-port"].as_i64()).unwrap_or(0); if p > 0 { p } else { 25565 } }
fn host_public(c: &Core, id: &str) -> Value {
    match c.hosted.lock().get(id) { Some(r) => { let up = r.upnp.lock().clone(); json!({ "id": id, "state": *r.state.lock(), "players": *r.players.lock(), "started": r.started.load(Ordering::Relaxed), "upnp": up.map(|u| json!({ "ok": u["ok"], "ip": u["ip"], "err": u["err"], "cgnat": u["cgnat"] })), "err": *r.err.lock() }) }
        None => json!({ "id": id, "state": "stopped", "players": [], "started": 0, "upnp": null, "err": "" }) }
}
fn emit_host(c: &C, id: &str) { c.emit("hoststate", host_public(c, id)); }
fn write_props(c: &Core, m: &Value) {
    let id = gs(m, "id"); let f = host_dir(c, &id).join("server.properties"); let mut cur: Vec<(String, String)> = vec![];
    if let Ok(t) = std::fs::read_to_string(&f) { for l in t.lines() { if let Some(k) = l.find('=') { if !l.starts_with('#') && k > 0 { cur.push((l[..k].to_string(), l[k + 1..].to_string())); } } } }
    if let Some(o) = m["props"].as_object() { for (k, v) in o { if !regex::Regex::new(r"^[a-z0-9.-]+$").unwrap().is_match(k) { continue; } let val = match v { Value::String(s) => s.clone(), o => o.to_string() }.replace(['\r', '\n'], " "); if let Some(e) = cur.iter_mut().find(|x| &x.0 == k) { e.1 = val; } else { cur.push((k.clone(), val)); } } }
    let _ = std::fs::write(f, format!("#Generated by OfflineCraft\n{}\n", cur.iter().map(|(k, v)| format!("{}={}", k, v)).collect::<Vec<_>>().join("\n")));
}
async fn host_jar_url(c: &C, m: &Value) -> R<String> {
    let (ty, mc) = (gs(m, "type"), gs(m, "mc"));
    if ty == "paper" { let j = get_json(c, &format!("https://api.papermc.io/v2/projects/paper/versions/{}/builds", mc)).await?; let b = arr(&j, "builds").last().cloned().ok_or(E(format!("No Paper build for {}", mc)))?; return Ok(format!("https://api.papermc.io/v2/projects/paper/versions/{}/builds/{}/downloads/{}", mc, gi(&b, "build"), gs(&b["downloads"]["application"], "name"))); }
    if ty == "fabric" { let l = get_json(c, &format!("https://meta.fabricmc.net/v2/versions/loader/{}", mc)).await?; let lv = arr(&l, "").iter().chain(l.as_array().into_iter().flatten()).find(|x| gb(&x["loader"], "stable")).map(|x| gs(&x["loader"], "version"));
        let iv = get_json(c, "https://meta.fabricmc.net/v2/versions/installer").await?; let iv = iv.as_array().and_then(|a| a.iter().find(|x| gb(x, "stable")).cloned()).map(|x| gs(&x, "version"));
        let (Some(lv), Some(iv)) = (lv, iv) else { return bail(format!("No Fabric server for {}", mc)) }; return Ok(format!("https://meta.fabricmc.net/v2/versions/loader/{}/{}/{}/server/jar", mc, lv, iv)); }
    if !ensure_vanilla_json(c, &mc).await? { return bail(format!("Unknown Minecraft version {}", mc)); }
    let sv = read_obj(vjson_path(c, &mc))["downloads"]["server"].clone(); if !sv.is_object() { return bail(format!("Minecraft {} has no official server download", mc)); } Ok(gs(&sv, "url"))
}
async fn host_install_jar(c: &C, m: &Value, j: &JobRef) -> R<()> { let id = gs(m, "id"); std::fs::create_dir_all(host_dir(c, &id))?; j.stage("Finding the server download", 0); let url = host_jar_url(c, m).await?; j.stage("Downloading the server", 0); download(c, &url, &host_dir(c, &id).join("server.jar"), Some(j)).await }
async fn host_close_port(c: &C, rt: &Arc<HostRt>, port: i64) { let svc = rt.upnp_svc.lock().take(); if let Some(s) = svc { upnp_close(c, &s, port).await; *rt.upnp.lock() = None; } }

pub async fn host_versions(c: &C, ty: &str) -> R<Value> {
    if ty == "paper" { let j = get_json(c, "https://api.papermc.io/v2/projects/paper").await?; let re = regex::Regex::new(r"^\d+\.\d+(\.\d+)?$").unwrap(); return Ok(json!(arr(&j, "versions").iter().rev().filter_map(|v| v.as_str()).filter(|v| re.is_match(v)).collect::<Vec<_>>())); }
    if ty == "fabric" { let j = get_json(c, "https://meta.fabricmc.net/v2/versions/game").await?; return Ok(json!(j.as_array().cloned().unwrap_or_default().iter().filter(|v| gb(v, "stable")).map(|v| v["version"].clone()).collect::<Vec<_>>())); }
    if c.manifest.lock().is_empty() { load_manifest(c).await; }
    Ok(json!(c.manifest.lock().iter().filter(|v| gs(v, "type") == "release").map(|v| v["id"].clone()).collect::<Vec<_>>()))
}
pub fn host_list(c: &Core) -> Value {
    let mut v: Vec<Value> = std::fs::read_dir(c.p(&["servers"])).map(|r| r.flatten().filter_map(|e| host_meta(c, &e.file_name().to_string_lossy())).map(|mut m| { let id = gs(&m, "id"); m["runtime"] = host_public(c, &id); m }).collect()).unwrap_or_default();
    v.sort_by_key(|m| gi(m, "created")); json!(v)
}
pub async fn host_create(c: &C, a: &Value) -> R<Value> {
    let name = if gs(a, "name").is_empty() { "My server".to_string() } else { gs(a, "name") }; let base = sanitize(&name); let mut id = base.clone(); let mut n = 2; while exists(host_dir(c, &id)) { id = format!("{} ({})", base, n); n += 1; }
    let m = json!({ "id": id, "name": name, "type": if gs(a, "type").is_empty() { "vanilla".into() } else { gs(a, "type") }, "mc": a["mc"], "ramMB": if gi(a, "ramMB") > 0 { gi(a, "ramMB") } else { 2048 }, "javaPath": "", "upnp": true, "eula": true, "props": { "motd": format!("{} - hosted with OfflineCraft", name) }, "created": now_s() });
    std::fs::create_dir_all(host_dir(c, &id))?; save_host_meta(c, &m);
    let (c2, m2) = (c.clone(), m.clone());
    tokio::spawn(async move { start_job(&c2, &format!("Setting up {}", gs(&m2, "name")), |j| { let c3 = c2.clone(); let m3 = m2.clone(); async move { host_install_jar(&c3, &m3, &j).await?; c3.toast(format!("{} is ready. Press Start!", gs(&m3, "name")), false); Ok(()) } }).await; c2.emit("hostlist", json!({})); });
    Ok(m)
}
pub fn host_save(c: &Core, id: &str, patch: &Value) -> Value {
    let Some(mut m) = host_meta(c, id) else { return Value::Null };
    for k in ["name", "ramMB", "javaPath", "upnp", "eula", "jvmArgs"] { if patch.get(k).is_some() { m[k] = patch[k].clone(); } }
    let has_props = patch["props"].is_object(); if has_props { for (k, v) in patch["props"].as_object().unwrap() { if !m["props"].is_object() { m["props"] = json!({}); } m["props"][k] = v.clone(); } }
    save_host_meta(c, &m); if exists(host_dir(c, id).join("server.properties")) || has_props { write_props(c, &m); } m
}
pub async fn host_start(c: &C, id: &str) -> R<String> {
    let m = host_meta(c, id).ok_or(E("Unknown server".into()))?; if !gb(&m, "eula") { return bail("Accept the Minecraft EULA first (Settings tab)."); }
    if let Some(old) = c.hosted.lock().get(id) { if *old.state.lock() != "stopped" { return Ok(String::new()); } }
    let rt = HostRt::new("starting"); c.hosted.lock().insert(id.to_string(), rt.clone()); emit_host(c, id);
    let (c2, id2, rt2) = (c.clone(), id.to_string(), rt.clone());
    Ok(start_job(c, &format!("Starting {}", gs(&m, "name")), |j| async move {
        let c = c2; let id = id2; let rt = rt2;
        let res: R<()> = async {
            if fsize(host_dir(&c, &id).join("server.jar")) <= 0 { host_install_jar(&c, &m, &j).await?; }
            j.stage("Preparing Java", 0); ensure_vanilla_json(&c, &gs(&m, "mc")).await?;
            let java = pick_java(&c, &json!({ "javaPath": gs(&m, "javaPath") }), required_java(&read_obj(vjson_path(&c, &gs(&m, "mc")))), &j).await?;
            std::fs::write(host_dir(&c, &id).join("eula.txt"), "eula=true\n")?; write_props(&c, &m); let ram = if gi(&m, "ramMB") > 0 { gi(&m, "ramMB") } else { 2048 };
            j.stage("Starting the server", 0);
            let mut cmd = command(&java); cmd.arg(format!("-Xmx{}M", ram)).arg(format!("-Xms{}M", ram.min(1024))); for a in gs(&m, "jvmArgs").split_whitespace() { cmd.arg(a); } cmd.args(["-jar", "server.jar", "nogui"]).current_dir(host_dir(&c, &id));
            cmd.stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
            let mut child = cmd.spawn()?; let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>(); *rt.stdin.lock() = Some(tx);
            if let Some(mut si) = child.stdin.take() { tokio::spawn(async move { while let Some(l) = rx.recv().await { if si.write_all(format!("{}\n", l).as_bytes()).await.is_err() { break; } let _ = si.flush().await; } }); }
            let (ltx, mut lrx) = tokio::sync::mpsc::unbounded_channel::<String>();
            use tokio::io::{AsyncBufReadExt, BufReader};
            if let Some(o) = child.stdout.take() { let t = ltx.clone(); tokio::spawn(async move { let mut l = BufReader::new(o).lines(); while let Ok(Some(x)) = l.next_line().await { let _ = t.send(x); } }); }
            if let Some(o) = child.stderr.take() { let t = ltx.clone(); tokio::spawn(async move { let mut l = BufReader::new(o).lines(); while let Ok(Some(x)) = l.next_line().await { let _ = t.send(x); } }); }
            drop(ltx);
            let (c3, id3, rt3) = (c.clone(), id.clone(), rt.clone());
            tokio::spawn(async move { let done = regex::Regex::new(r"Done \(.*\)! For help").unwrap(); let join = regex::Regex::new(r": (\w{1,16}) joined the game").unwrap(); let left = regex::Regex::new(r": (\w{1,16}) left the game").unwrap();
                while let Some(l) = lrx.recv().await { if l.is_empty() { continue; } host_log_line(&c3, &id3, l.clone());
                    if done.is_match(&l) { *rt3.state.lock() = "running".into(); rt3.started.store(now_ms(), Ordering::Relaxed); emit_host(&c3, &id3); }
                    if let Some(x) = join.captures(&l) { let mut p = rt3.players.lock(); if !p.contains(&x[1].to_string()) { p.push(x[1].to_string()); } drop(p); emit_host(&c3, &id3); } else if let Some(x) = left.captures(&l) { rt3.players.lock().retain(|n| n != &x[1]); emit_host(&c3, &id3); } } });
            let (c4, id4, rt4, port) = (c.clone(), id.clone(), rt.clone(), host_port(&m)); let kill = rt.kill.clone();
            tokio::spawn(async move {
                let code = tokio::select! { st = child.wait() => st.ok().and_then(|s| s.code()).unwrap_or(-1), _ = kill.notified() => { let _ = child.kill().await; child.wait().await.ok().and_then(|s| s.code()).unwrap_or(-1) } };
                host_log_line(&c4, &id4, format!("[OfflineCraft] Server stopped (exit code {})", code)); *rt4.state.lock() = "stopped".into(); rt4.players.lock().clear(); rt4.started.store(0, Ordering::Relaxed); *rt4.stdin.lock() = None;
                host_close_port(&c4, &rt4, port).await; emit_host(&c4, &id4); });
            if gb(&m, "upnp") { let (v, svc) = upnp_open(&c, host_port(&m)).await; *rt.upnp_svc.lock() = svc; host_log_line(&c, &id, if gb(&v, "ok") { format!("[OfflineCraft] Port {} opened on your router (UPnP). Public IP: {}", host_port(&m), if gs(&v, "ip").is_empty() { "unknown".into() } else { gs(&v, "ip") }) } else { format!("[OfflineCraft] {}", gs(&v, "err")) }); *rt.upnp.lock() = Some(v); emit_host(&c, &id); }
            Ok(())
        }.await;
        if let Err(e) = &res { *rt.state.lock() = "stopped".into(); *rt.err.lock() = e.0.clone(); emit_host(&c, &id); }
        res
    }).await)
}
pub fn host_stop(c: &C, id: &str) {
    let Some(r) = c.hosted.lock().get(id).cloned() else { return }; if *r.state.lock() == "stopped" || r.stdin.lock().is_none() { return; }
    *r.state.lock() = "stopping".into(); emit_host(c, id); if let Some(t) = r.stdin.lock().as_ref() { let _ = t.send("stop".into()); }
    let r2 = r.clone(); tokio::spawn(async move { sleep_ms(30000).await; if *r2.state.lock() != "stopped" { r2.kill.notify_one(); } });
}
pub fn host_command(c: &C, id: &str, cmd: &str) -> bool {
    let Some(r) = c.hosted.lock().get(id).cloned() else { return false }; if *r.state.lock() == "stopped" { return false; }
    let line = regex::Regex::new(r"[\r\n]+").unwrap().replace_all(cmd, " ").to_string(); let ok = r.stdin.lock().as_ref().map(|t| t.send(line).is_ok()).unwrap_or(false); if ok { host_log_line(c, id, format!("> {}", cmd)); } ok
}
pub fn host_log(c: &Core, id: &str) -> Value { json!(c.hosted.lock().get(id).map(|r| r.lines.lock().clone()).unwrap_or_default()) }
pub fn host_delete(c: &C, id: &str) { if let Some(r) = c.hosted.lock().remove(id) { if *r.state.lock() != "stopped" { r.kill.notify_one(); } } let _ = std::fs::remove_dir_all(host_dir(c, id)); }
pub fn host_dir_path(c: &Core, id: &str) -> std::path::PathBuf { let d = host_dir(c, id); let _ = std::fs::create_dir_all(&d); d }
pub async fn host_net(c: &C, id: &str) -> Value {
    let m = host_meta(c, id); let up = host_public(c, id)["upnp"].clone(); let pip = if gb(&up, "ip") { gs(&up, "ip") } else { public_ip(c).await };
    json!({ "localIp": local_ip(), "port": m.as_ref().map(host_port).unwrap_or(25565), "publicIp": pip, "upnp": up })
}
pub async fn host_port_map(c: &C, id: &str, on: bool) -> Value {
    let Some(m) = host_meta(c, id) else { return Value::Null };
    let rt = { let mut h = c.hosted.lock(); h.entry(id.to_string()).or_insert_with(|| HostRt::new("stopped")).clone() };
    if on { let (v, svc) = upnp_open(c, host_port(&m)).await; *rt.upnp_svc.lock() = svc; *rt.upnp.lock() = Some(v); } else { host_close_port(c, &rt, host_port(&m)).await; }
    emit_host(c, id); host_public(c, id)["upnp"].clone()
}
pub async fn host_test(c: &C, id: &str) -> Value {
    let Some(m) = host_meta(c, id) else { return json!({ "err": "Unknown server" }) }; let ip = public_ip(c).await; if ip.is_empty() { return json!({ "err": "Could not find your public IP (no internet?)" }); }
    match get_json(c, &format!("https://api.mcsrvstat.us/3/{}:{}", ip, host_port(&m))).await { Ok(j) => json!({ "ip": ip, "port": host_port(&m), "online": gb(&j, "online") }), Err(e) => json!({ "err": format!("The test service did not answer: {}", e.0) }) }
}
pub fn host_firewall(c: &Core, id: &str) -> bool {
    let port = host_meta(c, id).map(|m| host_port(&m)).unwrap_or(25565);
    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-Command", &format!("Start-Process netsh -Verb RunAs -ArgumentList 'advfirewall firewall add rule name=\"OfflineCraft server {p}\" dir=in action=allow protocol=TCP localport={p}'", p = port)]);
    #[cfg(windows)] { use std::os::windows::process::CommandExt; cmd.creation_flags(0x08000000); }
    let _ = cmd.spawn(); true
}
pub fn stop_all_hosts(c: &Core) { for (_, r) in c.hosted.lock().iter() { if *r.state.lock() != "stopped" { if let Some(t) = r.stdin.lock().as_ref() { let _ = t.send("stop".into()); } } } }

// ================= public server discovery (BattleMetrics) =================
fn is_private_host(h: &str) -> bool { regex::Regex::new(r"^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1)").unwrap().is_match(h) }
async fn bm_get(c: &C, base: &str, url: &str) -> Result<Value, (String, u16)> {
    if !url.starts_with(&format!("{}/", base)) { return Err(("Unexpected server list address".into(), 0)); }
    let r = c.http.get(url).header("Accept", "application/json").timeout(Duration::from_secs(20)).send().await.map_err(|_| ("Could not reach the server list (are you online?)".to_string(), 0))?;
    let st = r.status().as_u16(); if st == 429 { return Err(("The server list is busy right now. Try again in a minute.".into(), 429)); }
    if !r.status().is_success() { return Err((format!("The server list answered with an error ({})", st), st)); }
    r.json().await.map_err(|e| (e.to_string(), 0))
}
pub async fn srv_discover(c: &C, a: &Value) -> R<Value> {
    let base = std::env::var("OC_BM_BASE").unwrap_or("https://api.battlemetrics.com".into());
    let url = if !gs(a, "next").is_empty() { gs(a, "next") } else {
        let mut q = url::form_urlencoded::Serializer::new(String::new()); q.append_pair("filter[game]", "minecraft").append_pair("filter[status]", "online").append_pair("page[size]", "30");
        let s = gs(a, "search"); if !s.trim().is_empty() { q.append_pair("filter[search]", &s.trim().chars().take(60).collect::<String>()); }
        let co = gs(a, "country"); if co.len() == 2 && co.chars().all(|x| x.is_ascii_alphabetic()) { q.append_pair("filter[countries]", &co.to_uppercase()); }
        let mut u = format!("{}/servers?{}", base, q.finish()); match gs(a, "sort").as_str() { "players" => u.push_str("&sort=-players"), "rank" => u.push_str("&sort=rank"), _ => {} } u };
    let j = match bm_get(c, &base, &url).await { Ok(j) => j, Err((m, st)) => { if st == 400 && url.contains("sort=") { let u2 = regex::Regex::new(r"&sort=[^&]*").unwrap().replace(&url, "").to_string(); bm_get(c, &base, &u2).await.map_err(|e| E(e.0))? } else { return bail(m); } } };
    let hre = regex::Regex::new(r"^[\w.\-:]+$").unwrap();
    let servers: Vec<Value> = arr(&j, "data").iter().filter_map(|d| { let at = &d["attributes"]; let host = { let a = gs(at, "address"); if a.is_empty() { gs(at, "ip") } else { a } }.trim().to_string(); let port = gi(at, "port");
        if host.is_empty() || !hre.is_match(&host) || is_private_host(&host) { return None; } let det = &at["details"]; let co = gs(at, "country"); let name80: String = { let n = gs(at, "name"); if n.is_empty() { host.clone() } else { n } }.chars().take(80).collect();
        Some(json!({ "id": format!("bm{}", gs(d, "id")), "name": name80, "host": host, "port": if port == 25565 { 0 } else { port }, "players": gi(at, "players"), "max": gi(at, "maxPlayers"), "country": if co.len() == 2 && co.chars().all(|x| x.is_ascii_alphabetic()) { co.to_uppercase() } else { String::new() }, "rank": gi(at, "rank"), "version": det["version"].as_str().map(|v| v.chars().take(20).collect::<String>()).unwrap_or_default() })) }).collect();
    Ok(json!({ "servers": servers, "next": gs(&j["links"], "next") }))
}
