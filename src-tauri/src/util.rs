use serde_json::{json, Value};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct E(pub String);
impl<T: std::fmt::Display> From<T> for E { fn from(t: T) -> E { E(t.to_string()) } }
pub type R<T> = Result<T, E>;
pub fn bail<T>(m: impl Into<String>) -> R<T> { Err(E(m.into())) }

pub fn exists(p: impl AsRef<Path>) -> bool { p.as_ref().exists() }
pub fn fsize(p: impl AsRef<Path>) -> i64 { std::fs::metadata(p).map(|m| m.len() as i64).unwrap_or(-1) }
pub fn read_json(p: impl AsRef<Path>, d: Value) -> Value { std::fs::read_to_string(p).ok().and_then(|s| serde_json::from_str(s.trim_start_matches('\u{feff}')).ok()).unwrap_or(d) }
pub fn read_obj(p: impl AsRef<Path>) -> Value { read_json(p, json!({})) }
pub fn read_json_opt(p: impl AsRef<Path>) -> Option<Value> { std::fs::read_to_string(p).ok().and_then(|s| serde_json::from_str(s.trim_start_matches('\u{feff}')).ok()) }
pub fn write_json(p: impl AsRef<Path>, v: &Value) { if let Some(d) = p.as_ref().parent() { let _ = std::fs::create_dir_all(d); } let _ = std::fs::write(p, serde_json::to_string_pretty(v).unwrap_or_default()); }
pub fn sanitize(s: &str) -> String {
    let t: String = s.chars().map(|c| if "<>:\"/\\|?*".contains(c) || (c as u32) < 32 { '_' } else { c }).collect();
    let t = t.trim_end_matches(|c| c == ' ' || c == '.').to_string();
    if t.is_empty() { "unnamed".into() } else { t }
}
pub fn now_ms() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0) }
pub fn now_s() -> i64 { now_ms() / 1000 }

pub fn gs(v: &Value, k: &str) -> String { match &v[k] { Value::String(s) => s.clone(), Value::Number(n) => n.to_string(), _ => String::new() } }
pub fn gi(v: &Value, k: &str) -> i64 { match &v[k] { Value::Number(n) => n.as_i64().or(n.as_f64().map(|f| f as i64)).unwrap_or(0), Value::String(s) => s.parse().unwrap_or(0), Value::Bool(b) => *b as i64, _ => 0 } }
pub fn gb(v: &Value, k: &str) -> bool { match &v[k] { Value::Bool(b) => *b, Value::Number(n) => n.as_f64().unwrap_or(0.0) != 0.0, Value::String(s) => !s.is_empty(), Value::Null => false, _ => true } }
pub fn arr<'a>(v: &'a Value, k: &str) -> &'a [Value] { v[k].as_array().map(|a| a.as_slice()).unwrap_or(&[]) }

pub fn asset_url(p: &Path) -> String {
    let s = p.to_string_lossy().to_string();
    let enc = percent_encoding::utf8_percent_encode(&s, percent_encoding::NON_ALPHANUMERIC).to_string();
    // same alphabet as JS encodeURIComponent: keep - _ . ! ~ * ' ( )
    let mut out = String::new();
    let mut rest = enc.as_str();
    while let Some(i) = rest.find('%') {
        out.push_str(&rest[..i]);
        let code = &rest[i + 1..i + 3];
        let ch = u8::from_str_radix(code, 16).unwrap_or(0) as char;
        if "-_.!~*'()".contains(ch) { out.push(ch) } else { out.push_str(&rest[i..i + 3]) }
        rest = &rest[i + 3..];
    }
    out.push_str(rest);
    if cfg!(windows) { format!("http://asset.localhost/{}", out) } else { format!("asset://localhost/{}", out) }
}

pub fn sha_file<D: sha2::digest::Digest + std::io::Write>(p: &Path) -> R<String> {
    let mut f = std::fs::File::open(p)?; let mut h = D::new(); std::io::copy(&mut f, &mut h)?; Ok(hex::encode(h.finalize()))
}
pub fn sha1_file(p: &Path) -> R<String> { sha_file::<sha1::Sha1>(p) }
pub fn sha256_file(p: &Path) -> R<String> { sha_file::<sha2::Sha256>(p) }
pub fn sha512_file(p: &Path) -> R<String> { sha_file::<sha2::Sha512>(p) }
pub fn sha1_hex(b: &[u8]) -> String { use sha1::Digest; let mut h = sha1::Sha1::new(); h.update(b); hex::encode(h.finalize()) }

pub fn dir_size(dir: &Path, cap: usize) -> u64 {
    let mut total = 0u64; let mut n = 0usize; let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() { stack.push(e.path()) } else { total += e.metadata().map(|m| m.len()).unwrap_or(0); n += 1; if n >= cap { return total; } }
        }
    }
    total
}
pub fn stamp() -> String { chrono::Local::now().format("%Y%m%d-%H%M%S").to_string() }
pub fn stamp_to_ms(s: &str) -> i64 {
    use chrono::TimeZone;
    chrono::NaiveDateTime::parse_from_str(s, "%Y%m%d-%H%M%S").ok().and_then(|n| chrono::Local.from_local_datetime(&n).single()).map(|d| d.timestamp_millis()).unwrap_or(0)
}
pub fn mtime_ms(p: &Path) -> f64 { std::fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0) }

pub fn split_args(s: &str) -> Vec<String> {
    let re = regex::Regex::new(r#""([^"]*)"|'([^']*)'|(\S+)"#).unwrap();
    re.captures_iter(s).map(|c| c.get(1).or(c.get(2)).or(c.get(3)).map(|m| m.as_str().to_string()).unwrap_or_default()).collect()
}
pub fn parse_env(txt: &str) -> Vec<(String, String)> {
    let re = regex::Regex::new(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$").unwrap();
    txt.lines().filter(|l| !l.trim_start().starts_with('#')).filter_map(|l| re.captures(l).map(|c| (c[1].to_string(), c[2].to_string()))).collect()
}
pub fn parse_ini(txt: &str) -> std::collections::HashMap<String, String> {
    let re = regex::Regex::new(r"^([^=#\[][^=]*)=(.*)$").unwrap();
    txt.lines().filter_map(|l| re.captures(l.trim_end_matches('\r')).map(|c| (c[1].trim().to_string(), c[2].trim().to_string()))).collect()
}
pub fn safe_rel(rel: &str) -> bool {
    let n = rel.replace('\\', "/");
    !n.is_empty() && !n.starts_with('/') && !(n.len() >= 2 && n.as_bytes()[1] == b':' && n.as_bytes()[0].is_ascii_alphabetic()) && !n.split('/').any(|x| x == "..")
}
pub fn copy_dir(src: &Path, dst: &Path, skip: &dyn Fn(&Path) -> bool) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for e in std::fs::read_dir(src)? {
        let e = e?; let p = e.path(); if skip(&p) { continue; }
        let t = dst.join(e.file_name());
        if e.file_type()?.is_dir() { copy_dir(&p, &t, skip)?; } else { std::fs::copy(&p, &t)?; }
    }
    Ok(())
}
pub fn file_stem_str(p: &Path) -> String { p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default() }
pub fn file_name_str(p: &Path) -> String { p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default() }
pub async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T { tokio::task::spawn_blocking(f).await.expect("blocking task panicked") }
pub fn sleep_ms(ms: u64) -> tokio::time::Sleep { tokio::time::sleep(std::time::Duration::from_millis(ms)) }
