'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, clipboard, nativeImage, screen } = require('electron');
const path = require('path'), fs = require('fs'), fsp = fs.promises, cp = require('child_process'), crypto = require('crypto');
const { pathToFileURL } = require('url');
const { Readable } = require('stream'), { pipeline } = require('stream/promises');
const AdmZip = require('adm-zip');

const BASE = app.isPackaged ? path.dirname(process.execPath) : __dirname;
const os = require('os');
function pickRoot() {
  if (process.env.OC_DATA) return process.env.OC_DATA;
  const c = path.join(BASE, 'data');
  try { fs.mkdirSync(c, { recursive: true }); const t = path.join(c, '.w'); fs.writeFileSync(t, '1'); fs.unlinkSync(t); return c; }
  catch { const f = path.join(process.env.LOCALAPPDATA || os.homedir(), 'OfflineCraft', 'data'); fs.mkdirSync(f, { recursive: true }); return f; }
}
const ROOT = pickRoot();
try { fs.rmSync(path.join(ROOT, '.ui-ready'), { force: true }); } catch {}   // the launcher's splash waits for this file
app.setPath('userData', path.join(ROOT, 'electron'));
const UA = 'OfflineCraft/2.0 (offline launcher)';
const MR = 'https://api.modrinth.com/v2';
const P = (...a) => path.join(ROOT, ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const exists = p => { try { fs.accessSync(p); return true; } catch { return false; } };
const fsize = p => { try { return fs.statSync(p).size; } catch { return -1; } };
const readJson = (p, d = {}) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const writeJson = (p, j) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(j, null, 2)); };
const sanitize = s => (s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[ .]+$/, '') || 'unnamed');
let win = null;
const send = (ch, d) => { try { if (win && !win.isDestroyed() && !win.webContents.isDestroyed() && !win.webContents.isCrashed()) win.webContents.send(ch, d); } catch {} };
const logLines = [];
let logBuf = [], logTimer = null, logCount = 0, logQ = [], logQT = null;
const flushLog = () => { logTimer = null; if (!logBuf.length) return; const s = logBuf.join('\n') + '\n'; logBuf = []; try { fs.mkdirSync(ROOT, { recursive: true }); fs.appendFileSync(path.join(ROOT, 'launcher.log'), s); } catch {} };
const LOG = s => {
  const line = `[${new Date().toLocaleTimeString()}] ${s}`; logLines.push(line); if (logLines.length > 3000) logLines.shift();
  logBuf.push(line); if (++logCount <= 60) flushLog(); else if (!logTimer) logTimer = setTimeout(flushLog, 300);
  logQ.push(line); if (!logQT) logQT = setTimeout(() => { logQT = null; const l = logQ; logQ = []; send('log', { lines: l }); }, 100);
};
// crash-loop guard: if the previous start never finished showing the UI, fall back to software rendering
app.on('will-finish-launching', () => LOG('lifecycle: will-finish-launching'));
let fellBack = false;
function fallbackGraphics(reason, exit) {
  if (fellBack || level >= 7) return; fellBack = true; const next = level + 1;
  try { writeJson(P('gpu-status.json'), { reason, exit, level, at: Date.now() }); } catch {}
  LOG(`${reason} - restarting with safer graphics (level ${next})`);
  try { writeJson(SAFE_FILE, { level: next }); } catch {} flushLog();
  app.relaunch({ args: process.argv.slice(1) }); app.exit(0);
}
app.on('child-process-gone', (e, d) => { LOG(`child process gone: ${d.type} reason=${d.reason} exit=${d.exitCode}`); if (d.type === 'GPU') fallbackGraphics('GPU process crashed', d.exitCode); });
app.on('render-process-gone', (e, wc, d) => { LOG(`render process gone: ${d.reason} exit=${d.exitCode}`); if (['crashed', 'launch-failed', 'abnormal-exit', 'integrity-failure'].includes(d.reason)) fallbackGraphics('renderer crashed', d.exitCode); });
app.on('before-quit', () => LOG('lifecycle: before-quit'));
app.on('window-all-closed', () => LOG('lifecycle: window-all-closed'));
process.on('exit', c => { LOG('process exit code ' + c); flushLog(); });
try { fs.mkdirSync(ROOT, { recursive: true }); fs.writeFileSync(START_MARK, String(Date.now())); } catch {}
LOG(`startup: electron ${process.versions.electron} ${process.platform} ${os.release()} exe=${process.execPath} data=${ROOT}`);
process.on('uncaughtException', e => { LOG('UNCAUGHT: ' + (e.stack || e)); flushLog(); });
process.on('unhandledRejection', e => { LOG('UNHANDLED: ' + ((e && e.stack) || e)); });

// ---------------- settings / instances ----------------
const DEF = { username: '', accounts: [], ramMB: 4096, optimizedFlags: true, autoJava: true, minimizeOnLaunch: false, threads: 16, accent: 0, jvmArgs: '',
  accentA: '#34d399', accentB: '#22d3ee', sidebarPos: 'left', sidebarLabels: true, bgFile: '', bgType: 'none', bgVer: 0, bgDim: 45, bgBlur: 0, panelOpacity: 88,
  panelColor: '#12151c', appColor: '#0b0d12', animations: true, bgPauseUnfocused: true, gpuMode: 'auto', panelBlur: 0, sidebarOpacity: 100, sidebarBlur: 0, sidebarGlass: false, glassRefract: 14, secondBar: false, accentAuto: false, glassAll: false, barAutoHide: false, uiScale: 100, density: 'comfortable', fontFamily: 'default', fontPixel: false, cardStyle: 'grid', glow: 100, ambient: 'off', ambientAmount: 50, navOrder: [], navHidden: [], outlineColor: '#ffffff', outlineOpacity: 30, outlineSize: 2, winStyle: 'rounded', winRadius: 12, msAccounts: [], activeMs: '', skins: {}, servers: [] };
let settings = { ...DEF, ...readJson(P('settings.json')) };
if (settings.username && !settings.activeMs && !settings.accounts.includes(settings.username)) settings.accounts.unshift(settings.username);
if (!settings.v3) { if (settings.accounts.length === 1 && settings.accounts[0] === 'Player') { settings.accounts = []; settings.username = ''; } settings.v3 = true; }
if (!settings.v2) { settings.minimizeOnLaunch = false; settings.v2 = true; }
const saveSettings = () => writeJson(P('settings.json'), settings);
const START_MARK = path.join(ROOT, '.starting'), SAFE_FILE = path.join(ROOT, 'safe-level.json');
let level = 0, fails = 0;
// Rounded window = transparent frameless window with a transparent margin (WIN_M) around the visible app: the outline is drawn in that margin
// (outside the content), corners are CSS, and the margin is where the resize grips live. Needs hardware compositing, so it falls back to the classic window.
const WIN_M = 14; let ROUNDED = false;
const wantRounded = () => settings.winStyle !== 'classic' && settings.gpuMode !== 'software' && level < 6 && !process.argv.includes('--classic-window');
try { level = readJson(SAFE_FILE, {}).level || 0; } catch {}
try { fails = parseInt(fs.readFileSync(START_MARK, 'utf8')) || 0; } catch {}
if (fails > 6) fails = 1;
if (fails > 0) { level = Math.max(level, Math.min(7, fails)); LOG(`WARNING: previous start did not finish (${fails}x) - using safer graphics level ${level}`); }
const MODE_LEVEL = { d3d11: 0, dcomp: 1, gl: 2, d3d11on12: 3, nosandbox: 4, nosandboxall: 5, software: 6 };
if (MODE_LEVEL[settings.gpuMode] !== undefined) level = Math.max(level, MODE_LEVEL[settings.gpuMode]);
try { fs.writeFileSync(START_MARK, String(fails + 1)); } catch {}
if (level === 1) app.commandLine.appendSwitch('disable-direct-composition');   // hardware without DirectComposition
if (level === 2) app.commandLine.appendSwitch('use-angle', 'gl');                // hardware via OpenGL
if (level === 3) app.commandLine.appendSwitch('use-angle', 'd3d11on12');         // hardware via Direct3D 11-on-12
if (level === 4) app.commandLine.appendSwitch('disable-gpu-sandbox');            // hardware without the GPU sandbox
if (level >= 6) { app.disableHardwareAcceleration(); for (const s of ['disable-gpu', 'in-process-gpu', 'disable-gpu-sandbox']) app.commandLine.appendSwitch(s); app.commandLine.appendSwitch('num-raster-threads', String(Math.max(2, Math.min(6, os.cpus().length - 1)))); }   // software
if (level === 5 || level >= 7) app.commandLine.appendSwitch('no-sandbox');   // security sandbox off (some Windows builds crash every sandboxed process); level 5 keeps the GPU on
app.commandLine.appendSwitch('disable-breakpad'); app.commandLine.appendSwitch('enable-smooth-scrolling');
LOG(`graphics: level ${level} (${['hardware (Direct3D 11)', 'hardware (no DirectComposition)', 'hardware (OpenGL)', 'hardware (Direct3D 11 on 12)', 'hardware (GPU sandbox off)', 'hardware (sandbox off)', 'software rendering', 'software + compatibility mode'][level]}), mode=${settings.gpuMode}`);
let instances = [];
const instDir = i => P('instances', i.id), gameDir = i => path.join(instDir(i), 'minecraft');
const saveInst = i => writeJson(path.join(instDir(i), 'instance.json'), i);
const getInst = id => instances.find(i => i.id === id);
function loadInstances() {
  instances = [];
  try { for (const d of fs.readdirSync(P('instances'))) { const j = readJson(P('instances', d, 'instance.json'), null); if (j) { j.id = d; instances.push(j); } } } catch {}
  sortInst();
}
const sortInst = () => instances.sort((a, b) => Math.max(b.lastPlayed || 0, b.created || 0) - Math.max(a.lastPlayed || 0, a.created || 0));
function makeInstance(name, mc, loader, loaderVer) {
  const base = sanitize(name || 'New instance'); let id = base, n = 2;
  while (exists(P('instances', id))) id = `${base} (${n++})`;
  const i = { id, name: name || 'New instance', mc, loader: loader || 'vanilla', loaderVer: loaderVer || '', versionId: '', color: '', iconFile: '', coverFile: '', assetVer: 0, pinned: false, ramMB: 0, javaPath: '', jvmArgs: '', width: 0, height: 0, fullscreen: false, ready: false, created: Date.now() / 1000 | 0, lastPlayed: 0, playTime: 0 };
  fs.mkdirSync(gameDir(i), { recursive: true }); saveInst(i); instances.unshift(i); return i;
}
const running = new Map(); // id -> {proc, lines, started, alive}
const conQ = new Map(); let conT = null;
function emitConsole(id, line) {
  (conQ.get(id) || conQ.set(id, []).get(id)).push(line);
  if (!conT) conT = setTimeout(() => { conT = null; for (const [i, ls] of conQ) send('console', { id: i, lines: ls }); conQ.clear(); }, 80);
}
const busy = new Set();
function rmLater(p, tries = 10) { try { fs.rmSync(p, { force: true }); } catch { if (tries > 0) setTimeout(() => rmLater(p, tries - 1), 1500); } }
const bgUrl = () => (settings.bgFile && exists(P('backgrounds', settings.bgFile))) ? pathToFileURL(P('backgrounds', settings.bgFile)).href + '?v=' + (settings.bgVer || 0) : '';
const skinFile = id => P('skins', 'lib', id + '.png');
const rs = () => ({ ...settings, winRounded: ROUNDED, winMargin: WIN_M, msAccounts: (settings.msAccounts || []).map(a => { const ap = a.appliedSkin && exists(skinFile(a.appliedSkin.id)) ? a.appliedSkin : null, cf = a.skinCache && path.join(P('skins', 'cache'), a.skinCache + '.png'); return { id: a.id, name: a.name, skinId: ap ? ap.id : '', skinModel: ap ? ap.model : a.skinModel, skinUrl: ap ? pathToFileURL(skinFile(ap.id)).href : (cf && exists(cf)) ? pathToFileURL(cf).href : a.skinUrl }; }), skins: Object.fromEntries(Object.entries(settings.skins || {}).filter(([, s]) => exists(skinFile(s.id))).map(([n, s]) => [n, { ...s, url: pathToFileURL(skinFile(s.id)).href }])), bgUrl: bgUrl() });
const instAsset = (i, f) => f && exists(path.join(instDir(i), f)) ? pathToFileURL(path.join(instDir(i), f)).href + '?v=' + (i.assetVer || 0) : '';
const viewInst = i => ({ ...i, iconUrl: instAsset(i, i.iconFile), coverUrl: instAsset(i, i.coverFile) });
let pushTimer = null;
const applyZoom = () => { try { if (win && !win.isDestroyed()) win.webContents.setZoomFactor(Math.max(0.8, Math.min(1.25, (+settings.uiScale || 100) / 100))); } catch {} };
function pushState() { if (pushTimer) return; pushTimer = setTimeout(() => { pushTimer = null; doPushState(); }, 25); }
function doPushState() {
  const r = {}; for (const [id, x] of running) if (x.alive) r[id] = true;
  send('state', { instances: instances.map(viewInst), running: r, busy: [...busy], settings: rs() });
}

// ---------------- jobs ----------------
const jobs = new Map(); let jobSeq = 0;
function startJob(title, fn) {
  const j = { id: ++jobSeq, title, label: '', total: 0, done: 0, bytes: 0, finished: false, err: '', cancel: false };
  jobs.set(j.id, j);
  return (async () => {
    try { await fn(j); } catch (e) { j.err = e.message || String(e); LOG(`[job] ${title} failed: ${j.err}`); }
    j.finished = true; j.endedAt = Date.now();
    if (j.err && !j.cancel) send('toast', { msg: `${title}: ${j.err}`, err: true });
    return j.err;
  })();
}
const stage = (j, label, total = 0) => { j.label = label; j.total = total; j.done = 0; };
let lastJobCount = 0;
setInterval(() => {
  for (const [id, j] of jobs) if (j.finished && Date.now() - j.endedAt > 1200) jobs.delete(id);
  const arr = [...jobs.values()].map(({ id, title, label, total, done, bytes, finished }) => ({ id, title, label, total, done, bytes, finished }));
  if (arr.length || lastJobCount) send('jobs', arr);
  lastJobCount = arr.length;
}, 200);

// ---------------- network ----------------
async function fetchRetry(url, opts = {}, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, { ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) } }); if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`); return r; }
    catch (e) { err = e; await sleep(300 * (i + 1)); }
  }
  throw err;
}
const getJson = async url => (await fetchRetry(url)).json();
async function download(url, dest, j) {
  let err;
  for (let i = 0; i < 3; i++) {
    if (j && j.cancel) throw new Error('cancelled');
    try {
      const res = await fetchRetry(url, {}, 1); fs.mkdirSync(path.dirname(dest), { recursive: true });
      const tmp = dest + '.part', rs = Readable.fromWeb(res.body);
      rs.on('data', c => { if (j) j.bytes += c.length; });
      await pipeline(rs, fs.createWriteStream(tmp)); fs.renameSync(tmp, dest); return;
    } catch (e) { err = e; await sleep(250 * (i + 1)); }
  }
  throw err;
}
async function downloadAll(tasks, j) {
  const todo = tasks.filter(t => t.url && !(fsize(t.dest) > 0 && (!t.size || fsize(t.dest) === t.size)));
  j.total = todo.length; j.done = 0; let idx = 0, failed = 0;
  const worker = async () => {
    while (idx < todo.length && !j.cancel) {
      const t = todo[idx++];
      try { await download(t.url, t.dest, j); } catch (e) { failed++; LOG('download failed: ' + t.url); }
      j.done++;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(settings.threads || 16, todo.length)) }, worker));
  if (j.cancel) throw new Error('cancelled');
  return failed;
}
async function unzip(zipPath, dest, { strip = '', filter = null, flat = false } = {}) {
  const z = new AdmZip(zipPath); let n = 0;
  for (const e of z.getEntries()) {
    if (e.isDirectory) continue; let name = e.entryName;
    if (strip) { if (!name.startsWith(strip)) continue; name = name.slice(strip.length); }
    if (!name || name.includes('..') || name.startsWith('/') || name.includes(':')) continue;
    if (filter && !filter(name)) continue;
    const out = path.join(dest, flat ? path.basename(name) : name); await fsp.mkdir(path.dirname(out), { recursive: true }); await fsp.writeFile(out, e.getData());
    if (++n % 6 === 0) await new Promise(r => setImmediate(r));
  }
}

// ---------------- minecraft metadata ----------------
let manifest = [];
async function loadManifest() {
  const cache = P('cache', 'version_manifest.json'); let body;
  try { body = await getJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'); writeJson(cache, body); } catch (e) { LOG('version manifest download failed: ' + e.message); body = readJson(cache, null); }
  if (body) manifest = body.versions.map(v => ({ id: v.id, type: v.type, url: v.url, time: v.releaseTime }));
  return manifest;
}
const vjsonPath = id => P('versions', id, id + '.json');
async function ensureVanillaJson(id) {
  if (fsize(vjsonPath(id)) > 0) return true;
  if (!manifest.length) await loadManifest();
  const v = manifest.find(x => x.id === id); if (!v) return false;
  await download(v.url, vjsonPath(id)); return true;
}
function rulesOk(rules, custom = false) {
  if (!Array.isArray(rules) || !rules.length) return true; let allowed = false;
  for (const r of rules) {
    let m = true;
    if (r.os) { if (r.os.name && r.os.name !== 'windows') m = false; if (r.os.arch === 'x86') m = false; }
    if (r.features) for (const [k, v] of Object.entries(r.features)) if ((k === 'has_custom_resolution' ? custom : false) !== v) m = false;
    if (m) allowed = (r.action || 'allow') === 'allow';
  }
  return allowed;
}
const libKey = n => { const p = n.split(':'); return p.length < 2 ? n : p[0] + ':' + p[1] + (p.length > 3 ? ':' + p[3] : ''); };
function mergedVersion(id, depth = 0) {
  const v = readJson(vjsonPath(id), null); if (!v) throw new Error('Missing version json: ' + id);
  if (!v.inheritsFrom || depth > 5) { v._jarId = v.jar || id; return v; }
  const p = mergedVersion(v.inheritsFrom, depth + 1), r = { ...p };
  for (const [k, val] of Object.entries(v)) if (!['libraries', 'arguments', 'inheritsFrom'].includes(k)) r[k] = val;
  const seen = new Set(), libs = [];
  for (const src of [v, p]) for (const l of src.libraries || []) { const k = libKey(l.name || ''); if (!seen.has(k)) { seen.add(k); libs.push(l); } }
  r.libraries = libs;
  const args = { jvm: [], game: [] };
  for (const src of [p, v]) if (src.arguments) for (const k of ['jvm', 'game']) args[k].push(...(src.arguments[k] || []));
  if (args.jvm.length || args.game.length) r.arguments = args;
  if (v.minecraftArguments) delete r.arguments;
  r._jarId = v.jar || p._jarId || id; return r;
}
function mavenPath(name) {
  let n = name, ext = 'jar'; const at = n.indexOf('@'); if (at >= 0) { ext = n.slice(at + 1); n = n.slice(0, at); }
  const p = n.split(':'); if (p.length < 3) return '';
  return `${p[0].replace(/\./g, '/')}/${p[1]}/${p[2]}/${p[1]}-${p[2]}${p.length > 3 ? '-' + p[3] : ''}.${ext}`;
}
function collectLibs(mv) {
  const out = [], seen = new Set();
  for (const l of mv.libraries || []) {
    if (l.rules && !rulesOk(l.rules)) continue;
    const name = l.name || '', parts = name.split(':');
    if (parts.length > 3 && parts[3].startsWith('natives-') && parts[3] !== 'natives-windows') continue;
    const newNative = parts.length > 3 && parts[3] === 'natives-windows';
    if (l.natives) {
      let key = l.natives.windows; if (!key) continue; key = key.replace('${arch}', '64');
      const f = { native: true, onClasspath: false, size: 0 };
      const c = l.downloads && l.downloads.classifiers && l.downloads.classifiers[key];
      if (c) { f.path = c.path; f.url = c.url; f.size = c.size || 0; } else { f.path = mavenPath(name + ':' + key); f.url = (l.url || 'https://libraries.minecraft.net/') + f.path; }
      if (f.path && !seen.has(f.path)) { seen.add(f.path); out.push(f); }
      if (!(l.downloads && l.downloads.artifact)) continue;
    }
    const f = { native: newNative, onClasspath: true, size: 0 };
    if (l.downloads && l.downloads.artifact) { const a = l.downloads.artifact; f.path = a.path || mavenPath(name); f.url = a.url || ''; f.size = a.size || 0; }
    else { f.path = mavenPath(name); if (!f.path) continue; let b = l.url || 'https://libraries.minecraft.net/'; if (!b.endsWith('/')) b += '/'; f.url = b + f.path; }
    if (!seen.has(f.path)) { seen.add(f.path); out.push(f); }
  }
  return out;
}

// ---------------- java ----------------
let javas = [];
const parseMajor = v => !v ? 0 : v.startsWith('1.') ? parseInt(v.slice(2)) || 0 : parseInt(v) || 0;
function scanDirJava(d, depth, out) {
  const exe = path.join(d, 'bin', 'java.exe');
  if (exists(exe)) {
    let ver = ''; try { const m = fs.readFileSync(path.join(d, 'release'), 'utf8').match(/JAVA_VERSION="([^"]+)"/); if (m) ver = m[1]; } catch {}
    let major = parseMajor(ver); if (!major) { const m = path.basename(d).match(/(\d+)/); if (m) major = +m[1]; }
    if (major) out.push({ exe, major, ver: ver || String(major) }); return;
  }
  if (depth <= 0) return;
  try { for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) scanDirJava(path.join(d, e.name), depth - 1, out); } catch {}
}
function scanJavas() {
  const out = [], env = process.env, roots = [P('runtimes')];
  if (env.JAVA_HOME) scanDirJava(env.JAVA_HOME, 0, out);
  for (const pf of [env.ProgramFiles, env['ProgramFiles(x86)']]) if (pf) for (const s of ['Java', 'Eclipse Adoptium', 'Microsoft', 'Zulu', 'BellSoft', 'Amazon Corretto', 'Semeru', 'AdoptOpenJDK', 'Eclipse Foundation']) roots.push(path.join(pf, s));
  if (env.APPDATA) roots.push(path.join(env.APPDATA, '.minecraft', 'runtime'));
  for (const r of roots) if (exists(r)) scanDirJava(r, 4, out);
  for (const d of (env.PATH || '').split(path.delimiter)) if (d && exists(path.join(d, 'java.exe'))) scanDirJava(path.dirname(d), 0, out);
  const seen = new Set(); javas = out.filter(j => { const k = j.exe.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.major - b.major);
  return javas;
}
async function downloadJava(major, j) {
  stage(j, `Downloading Java ${major} runtime`);
  const zip = P('cache', `java${major}.zip`);
  await download(`https://api.adoptium.net/v3/binary/latest/${major}/ga/windows/x64/jre/hotspot/normal/eclipse`, zip, j);
  stage(j, `Extracting Java ${major}`);
  const dest = P('runtimes', 'java' + major); fs.rmSync(dest, { recursive: true, force: true }); await unzip(zip, dest); fs.rmSync(zip, { force: true }); scanJavas();
}
async function pickJava(inst, major, j) {
  if (inst.javaPath && exists(inst.javaPath)) return inst.javaPath;
  if (!javas.length) scanJavas();
  let f = javas.find(x => x.major === major); if (f) return f.exe;
  scanJavas(); f = javas.find(x => x.major === major); if (f) return f.exe;
  if (settings.autoJava) { try { await downloadJava(major, j); f = javas.find(x => x.major === major); if (f) return f.exe; } catch (e) { LOG('java download failed: ' + e.message); } }
  f = javas.find(x => x.major >= major); if (f) return f.exe;
  throw new Error(`No Java ${major}+ found. Install it or enable auto-download in Settings.`);
}
const requiredJava = mv => (mv.javaVersion && mv.javaVersion.majorVersion) || 8;

// ---------------- loaders ----------------
async function listLoaderVersions(loader, mc) {
  try {
    if (loader === 'fabric' || loader === 'quilt') {
      const base = loader === 'fabric' ? 'https://meta.fabricmc.net/v2/versions/loader/' : 'https://meta.quiltmc.org/v3/versions/loader/';
      return (await getJson(base + encodeURIComponent(mc))).map(e => ({ version: e.loader.version, stable: e.loader.stable !== undefined ? e.loader.stable : !e.loader.version.includes('-') }));
    }
    if (loader === 'forge') {
      const pr = (await getJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json')).promos, out = [];
      if (pr[mc + '-recommended']) out.push({ version: pr[mc + '-recommended'], stable: true });
      if (pr[mc + '-latest'] && pr[mc + '-latest'] !== pr[mc + '-recommended']) out.push({ version: pr[mc + '-latest'], stable: !out.length });
      return out;
    }
    if (loader === 'neoforge') {
      const p = mc.split('.'); if (p.length < 2) return []; const prefix = `${p[1]}.${p[2] || '0'}.`;
      return (await getJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge')).versions.filter(v => v.startsWith(prefix)).reverse().map(v => ({ version: v, stable: !v.includes('beta') }));
    }
    if (loader === 'rust') return await rustVersions(mc);
  } catch {}
  return [];
}
async function installLoader(inst, j) {
  let lv = inst.loaderVer;
  if (!lv) { const v = await listLoaderVersions(inst.loader, inst.mc); const s = v.find(x => x.stable) || v[0]; lv = s && s.version; }
  if (!lv) throw new Error(`No ${inst.loader} version found for Minecraft ${inst.mc}`);
  inst.loaderVer = lv;
  if (inst.loader === 'fabric' || inst.loader === 'quilt') {
    const base = inst.loader === 'fabric' ? 'https://meta.fabricmc.net/v2/versions/loader/' : 'https://meta.quiltmc.org/v3/versions/loader/';
    const prof = await getJson(`${base}${encodeURIComponent(inst.mc)}/${encodeURIComponent(lv)}/profile/json`);
    if (!prof.id) throw new Error('Bad loader profile'); writeJson(vjsonPath(prof.id), prof); inst.versionId = prof.id; return;
  }
  const predicted = inst.loader === 'forge' ? `${inst.mc}-forge-${lv}` : `neoforge-${lv}`;
  if (fsize(vjsonPath(predicted)) > 0) { inst.versionId = predicted; return; }
  let url, name;
  if (inst.loader === 'forge') { const full = `${inst.mc}-${lv}`; url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`; name = `forge-${full}-installer.jar`; }
  else { url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${lv}/neoforge-${lv}-installer.jar`; name = `neoforge-${lv}-installer.jar`; }
  const jar = P('cache', name); stage(j, `Downloading ${inst.loader} installer`); await download(url, jar, j);
  const java = await pickJava(inst, requiredJava(mergedVersion(inst.mc)), j);
  if (!exists(P('launcher_profiles.json'))) writeJson(P('launcher_profiles.json'), { profiles: {}, selectedProfile: '', version: 3 });
  const before = new Set(fs.readdirSync(P('versions')));
  stage(j, `Running ${inst.loader} installer (can take a minute)`);
  const code = await new Promise(res => {
    const pr = cp.spawn(java, ['-jar', jar, '--installClient', ROOT], { cwd: ROOT, windowsHide: true });
    const on = d => d.toString().split(/\r?\n/).filter(Boolean).forEach(l => { j.label = 'Installer: ' + l.slice(0, 90); LOG('[installer] ' + l); });
    pr.stdout.on('data', on); pr.stderr.on('data', on); pr.on('close', res); pr.on('error', () => res(-1));
  });
  if (fsize(vjsonPath(predicted)) > 0) { inst.versionId = predicted; return; }
  for (const d of fs.readdirSync(P('versions'))) if (!before.has(d) && fsize(vjsonPath(d)) > 0) { inst.versionId = d; return; }
  throw new Error(`${inst.loader} installer failed (exit ${code}). Check the launcher log.`);
}

// ---------------- Rust loader (Horizon: Minecraft Java rewritten in Rust) ----------------
// Not a Java mod loader: Horizon is a native game, so there is no version json, classpath or JVM. We install its
// release zip, "prepare" it once from the Minecraft files we already download (versions/ libraries/ assets/),
// then run horizon-client.exe directly. Horizon only targets one Minecraft version (RUST.mc).
const RUST = { repo: 'horizon-rust/horizon', mc: '26.3', asset: 'horizon-windows-x64.zip', keys: ['MU4oiIQcCxkZvbwSjjXs7SySCuM6ywRQ3nGaJYZG0gw='] };   // keys: Horizon's release signing key(s), crates/horizon-release-sign/release-keys.txt
const rustDir = lv => P('rust', sanitize(lv)), rustExe = lv => path.join(rustDir(lv), 'horizon-client.exe'), rustRes = lv => path.join(rustDir(lv), '.local', 'horizon-client', RUST.mc);
const rustInstalled = lv => !!lv && fsize(rustExe(lv)) > 0, rustPrepared = lv => rustInstalled(lv) && fsize(path.join(rustRes(lv), 'horizon-resources.json')) > 0;
const isNightlyTag = t => t === 'nightly' || String(t).startsWith('nightly-');
function rustVersionOf(r) {   // the Nightly build keeps moving under one tag, so it is named by its title: "Nightly 2026-10-28 · 0c02067" -> nightly-2026-10-28-0c02067
  if (!isNightlyTag(r.tag_name)) return r.tag_name;
  const m = String(r.name || '').match(/^Nightly (\d{4}-\d\d-\d\d)(?: · ([0-9a-f]+))?/i), d = m ? m[1] : String(r.published_at || '').slice(0, 10);
  return 'nightly-' + d + (m && m[2] ? '-' + m[2] : '');
}
async function rustReleases() {
  const list = await getJson(`https://api.github.com/repos/${RUST.repo}/releases?per_page=100`);
  return (Array.isArray(list) ? list : []).filter(r => !r.draft && (r.assets || []).some(a => a.name === RUST.asset));
}
async function rustVersions(mc) {
  if (mc !== RUST.mc) return [];
  return (await rustReleases()).map((r, i) => ({ version: rustVersionOf(r), stable: i === 0 || !r.prerelease }));
}
const sha256File = f => new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(f).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
const fetchSmall = async url => Buffer.from(await (await fetchRetry(url)).arrayBuffer());
// Same scheme as Horizon's own launcher: SHA256SUMS signed (Ed25519) over "horizon release <tag>\n" + the file; a Nightly is signed for "nightly".
function rustSignedDigest(tag, sums, sigText) {
  const msg = Buffer.concat([Buffer.from(`horizon release ${isNightlyTag(tag) ? 'nightly' : tag}\n`), sums]), spki = Buffer.from('302a300506032b6570032100', 'hex');
  const keys = RUST.keys.map(k => crypto.createPublicKey({ key: Buffer.concat([spki, Buffer.from(k, 'base64')]), format: 'der', type: 'spki' }));
  const ok = sigText.split(/\r?\n/).map(x => x.trim()).filter(Boolean).some(sig => keys.some(k => { try { return crypto.verify(null, msg, k, Buffer.from(sig, 'base64')); } catch { return false; } }));
  if (!ok) throw new Error(`${tag}: the release signature does not match Horizon's release key, so it was not installed.`);
  for (const l of sums.toString('utf8').split(/\r?\n/)) { const m = l.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/); if (m && m[2] === RUST.asset) return m[1].toLowerCase(); }
  throw new Error(`${RUST.asset} is not in ${tag}'s signed checksums.`);
}
async function installRust(inst, j) {
  if (inst.mc !== RUST.mc) throw new Error(`Rust (Horizon) only supports Minecraft ${RUST.mc}`);
  stage(j, 'Finding Horizon release'); const rels = await rustReleases();
  const rel = inst.loaderVer ? rels.find(r => rustVersionOf(r) === inst.loaderVer || r.tag_name === inst.loaderVer) : rels[0];
  if (!rel) { if (inst.loaderVer && rustInstalled(inst.loaderVer)) { inst.versionId = 'rust-' + inst.loaderVer; return; } throw new Error(inst.loaderVer ? `Horizon build "${inst.loaderVer}" was not found` : 'No Horizon release found for Windows (offline?)'); }
  const lv = rustVersionOf(rel); inst.loaderVer = lv; inst.versionId = 'rust-' + lv;
  if (rustInstalled(lv)) return;
  const base = `https://github.com/${RUST.repo}/releases/download/${rel.tag_name}/`;
  stage(j, 'Verifying Horizon release');
  let want; try { want = rustSignedDigest(rel.tag_name, await fetchSmall(base + 'SHA256SUMS'), (await fetchSmall(base + 'SHA256SUMS.sig')).toString('utf8')); }
  catch (e) { throw new Error(/signature|signed checksums/.test(e.message) ? e.message : `Could not verify ${lv} (it needs a signed SHA256SUMS): ${e.message}`); }
  const asset = rel.assets.find(a => a.name === RUST.asset), zip = P('cache', sanitize(lv) + '-' + RUST.asset);
  stage(j, 'Downloading Horizon (Rust)'); await download(asset.browser_download_url, zip, j);
  if ((await sha256File(zip)) !== want) { fs.rmSync(zip, { force: true }); throw new Error('The Horizon download does not match its signed checksum (corrupted or tampered with). Try again.'); }
  stage(j, 'Unpacking Horizon'); const tmp = rustDir(lv) + '.partial'; fs.rmSync(tmp, { recursive: true, force: true }); await unzip(zip, tmp);
  const ents = fs.readdirSync(tmp), top = ents.length === 1 && fs.statSync(path.join(tmp, ents[0])).isDirectory() ? path.join(tmp, ents[0]) : tmp;   // the zip holds one top folder
  if (fsize(path.join(top, 'horizon-client.exe')) <= 0) { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error('The Horizon download has no horizon-client.exe'); }
  fs.rmSync(rustDir(lv), { recursive: true, force: true }); fs.mkdirSync(path.dirname(rustDir(lv)), { recursive: true }); fs.renameSync(top, rustDir(lv)); fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(zip, { force: true });
}
function runLogged(exe, args, opts, j, tag) {
  return new Promise(res => {
    const pr = cp.spawn(exe, args, { ...opts, windowsHide: true });
    const on = d => d.toString().split(/\r?\n/).filter(Boolean).forEach(l => { j.label = tag + l.slice(0, 90); LOG(`[${tag.trim().replace(/:$/, '')}] ${l}`); });
    pr.stdout.on('data', on); pr.stderr.on('data', on); pr.on('close', res); pr.on('error', e => { LOG('[horizon] ' + e.message); res(-1); });
  });
}
async function prepareRust(inst, j) {   // runs after the vanilla client, libraries and assets for RUST.mc are in ROOT
  const lv = inst.loaderVer; if (rustPrepared(lv)) return;
  const dir = rustDir(lv), prep = path.join(dir, 'horizon-prepare.exe'); if (!exists(prep)) throw new Error('This Horizon build has no horizon-prepare.exe');
  const sv = readJson(vjsonPath(inst.mc)).downloads; if (!sv || !sv.server) throw new Error(`Minecraft ${inst.mc} has no server download to prepare from`);
  stage(j, 'Minecraft server jar'); const jar = P('cache', `server-${inst.mc}.jar`); await downloadAll([{ url: sv.server.url, dest: jar, size: sv.server.size }], j);
  if (fsize(jar) <= 0) throw new Error('Server jar download failed');
  const major = (readJson(path.join(dir, 'research-lock.json')).minecraft || {}).java_major || 25;
  stage(j, 'Java runtime'); const java = await pickJava(inst, major, j), home = path.basename(path.dirname(java)).toLowerCase() === 'bin' ? path.dirname(path.dirname(java)) : path.dirname(java);
  const env = { ...process.env, JAVA_HOME: home }, pk = Object.keys(process.env).find(k => k.toLowerCase() === 'path') || 'PATH'; env[pk] = path.join(home, 'bin') + path.delimiter + (process.env[pk] || '');
  stage(j, 'Preparing Horizon (a few minutes, only once)');
  const code = await runLogged(prep, ['--root', dir, '--prepare', '--server-jar', jar, '--minecraft-dir', ROOT], { cwd: dir, env }, j, 'Preparing: ');
  if (!rustPrepared(lv)) throw new Error(`Horizon preparation failed (exit ${code}). Check the launcher log.`);
  stage(j, 'Copying sounds'); await runLogged(prep, ['sounds', '--root', dir, '--minecraft-dir', ROOT], { cwd: dir, env }, j, 'Sounds: ');   // optional: no sounds is not an error
}
function rustLaunch(inst) {   // Horizon runs offline with --name; its Microsoft sign-in is the Horizon launcher's, not ours
  const lv = inst.loaderVer; if (!rustPrepared(lv)) throw new Error('Horizon is not installed or prepared yet. Use Repair on this instance.');
  const args = ['--resources', rustRes(lv), '--name', settings.username];
  if (inst.width > 0 && inst.height > 0) args.push('--width', String(inst.width), '--height', String(inst.height));
  return { java: rustExe(lv), args, cwd: gameDir(inst) };
}

// ---------------- prepare / launch ----------------
function quickCheck(inst) {
  if (inst.loader === 'rust') return !!inst.ready && inst.versionId === 'rust-' + inst.loaderVer && rustPrepared(inst.loaderVer);
  if (!inst.ready || !inst.versionId || fsize(vjsonPath(inst.versionId)) <= 0) return false;
  try {
    const mv = mergedVersion(inst.versionId), jid = mv._jarId || inst.mc;
    if (fsize(P('versions', jid, jid + '.jar')) <= 0) return false;
    for (const l of collectLibs(mv)) if ((l.url || l.onClasspath) && fsize(P('libraries', l.path)) <= 0) return false;
  } catch { return false; }
  return true;
}
async function prepareInstance(inst, j) {
  stage(j, 'Fetching version list'); if (!manifest.length) await loadManifest();
  stage(j, 'Version metadata');
  if (!(await ensureVanillaJson(inst.mc))) throw new Error(`Could not get metadata for Minecraft ${inst.mc} (offline?)`);
  const rust = inst.loader === 'rust';
  if (inst.loader === 'vanilla') inst.versionId = inst.mc;
  else if (rust) await installRust(inst, j);
  else if (!inst.versionId || fsize(vjsonPath(inst.versionId)) <= 0) await installLoader(inst, j);
  const mv = mergedVersion(rust ? inst.mc : inst.versionId), jid = mv._jarId || inst.mc; await ensureVanillaJson(jid);
  stage(j, 'Game client');
  const cj = readJson(vjsonPath(jid)); const cl = cj.downloads && cj.downloads.client;
  if (cl) await downloadAll([{ url: cl.url, dest: P('versions', jid, jid + '.jar'), size: cl.size }], j);
  if (fsize(P('versions', jid, jid + '.jar')) <= 0) throw new Error('Client jar download failed');
  stage(j, 'Libraries'); const libs = collectLibs(mv);
  await downloadAll(libs.map(l => ({ url: l.url, dest: P('libraries', l.path), size: l.size })), j);
  for (const l of libs) if (l.onClasspath && fsize(P('libraries', l.path)) <= 0) throw new Error('Missing library: ' + l.path);
  const lf = mv.logging && mv.logging.client && mv.logging.client.file;
  if (lf) await downloadAll([{ url: lf.url, dest: P('assets', 'log_configs', lf.id || 'log.xml'), size: lf.size }], j);
  if (mv.assetIndex) {
    stage(j, 'Asset index'); const ai = mv.assetIndex, aid = ai.id || 'legacy', idx = P('assets', 'indexes', aid + '.json');
    await downloadAll([{ url: ai.url, dest: idx, size: ai.size }], j);
    const aj = readJson(idx, null); if (!aj || !aj.objects) throw new Error('Asset index download failed');
    stage(j, 'Assets');
    const ents = Object.entries(aj.objects);
    await downloadAll(ents.map(([, o]) => ({ url: `https://resources.download.minecraft.net/${o.hash.slice(0, 2)}/${o.hash}`, dest: P('assets', 'objects', o.hash.slice(0, 2), o.hash), size: o.size })), j);
    if (aj.virtual || aj.map_to_resources) {
      stage(j, 'Preparing legacy assets');
      for (const [k, o] of ents) {
        const src = P('assets', 'objects', o.hash.slice(0, 2), o.hash);
        for (const d of [aj.virtual && P('assets', 'virtual', aid, k), aj.map_to_resources && path.join(gameDir(inst), 'resources', k)]) if (d && !exists(d)) { fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(src, d); }
      }
    }
  }
  if (rust) { await prepareRust(inst, j); inst.ready = true; return; }
  stage(j, 'Natives'); const nd = path.join(instDir(inst), 'natives'), mk = path.join(nd, '.done');
  if (!exists(mk) || fs.readFileSync(mk, 'utf8') !== inst.versionId) {
    fs.rmSync(nd, { recursive: true, force: true }); fs.mkdirSync(nd, { recursive: true });
    for (const l of libs) if (l.native) await unzip(P('libraries', l.path), nd, { flat: true, filter: n => n.toLowerCase().endsWith('.dll') && !n.includes('META-INF') });
    fs.writeFileSync(mk, inst.versionId);
  }
  stage(j, 'Java runtime'); await pickJava(inst, requiredJava(mv), j); inst.ready = true;
}
function offlineUuid(name) {
  const h = crypto.createHash('md5').update('OfflinePlayer:' + name).digest(); h[6] = (h[6] & 0x0f) | 0x30; h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex'); return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
function buildLaunch(inst, mv, java) {
  const jid = mv._jarId || inst.mc; const seen = new Set(); let cp = '';
  for (const l of collectLibs(mv)) if (l.onClasspath) { const f = P('libraries', l.path); if (!seen.has(f)) { seen.add(f); cp += f + ';'; } }
  cp += P('versions', jid, jid + '.jar');
  const aid = mv.assetIndex ? mv.assetIndex.id || 'legacy' : 'legacy', aj = readJson(P('assets', 'indexes', aid + '.json'));
  const ms = settings.activeMs && (settings.msAccounts || []).find(x => x.id === settings.activeMs), dash = h => h.length === 32 ? `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` : h;
  const uuid = ms ? dash(ms.id) : offlineUuid(settings.username), tok = ms ? decTok(ms.mcToken) : '0';
  const v = { auth_player_name: ms ? ms.name : settings.username, version_name: inst.versionId, game_directory: gameDir(inst), assets_root: P('assets'), assets_index_name: aid, auth_uuid: uuid, auth_access_token: tok, auth_session: 'token:' + tok + ':' + uuid, clientid: ms ? MS_CLIENT : 'offline', auth_xuid: '0', user_type: ms ? 'msa' : 'legacy', user_properties: '{}', version_type: mv.type || 'release', natives_directory: path.join(instDir(inst), 'natives'), launcher_name: 'OfflineCraft', launcher_version: '2.0', classpath: cp, classpath_separator: ';', library_directory: P('libraries'), game_assets: aj.virtual ? P('assets', 'virtual', aid) : P('assets'), resolution_width: String(inst.width), resolution_height: String(inst.height) };
  const sub = s => s.replace(/\$\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
  const custom = inst.width > 0 && inst.height > 0;
  const expand = (arr, out) => { for (const a of arr) { if (typeof a === 'string') { out.push(sub(a)); continue; } if (a.rules && !rulesOk(a.rules, custom)) continue; for (const x of [].concat(a.value)) out.push(sub(x)); } };
  const ram = inst.ramMB > 0 ? inst.ramMB : settings.ramMB, args = [`-Xmx${ram}M`, `-Xms${Math.min(ram, 512)}M`, '-Xshare:auto'];
  if (settings.optimizedFlags) args.push('-XX:+UseG1GC', '-XX:+UnlockExperimentalVMOptions', '-XX:G1NewSizePercent=20', '-XX:G1ReservePercent=20', '-XX:MaxGCPauseMillis=50', '-XX:G1HeapRegionSize=32M', '-XX:+DisableExplicitGC', '-XX:+AlwaysPreTouch');
  for (const ua of [settings.jvmArgs, inst.jvmArgs]) if (ua) args.push(...ua.split(/\s+/).filter(Boolean));
  args.push('-Dminecraft.launcher.brand=OfflineCraft');
  if (mv.arguments) expand(mv.arguments.jvm || [], args); else args.push('-Djava.library.path=' + v.natives_directory, '-cp', cp);
  if (!args.includes(cp)) args.push('-cp', cp);
  if (!args.some(a => a.startsWith('-Djava.library.path'))) args.push('-Djava.library.path=' + v.natives_directory);
  const lg = mv.logging && mv.logging.client;
  if (lg && lg.argument && lg.file) { const lf = P('assets', 'log_configs', lg.file.id || ''); if (fsize(lf) > 0) args.push(lg.argument.replace('${path}', lf)); }
  args.push(mv.mainClass || 'net.minecraft.client.main.Main');
  if (mv.arguments) expand(mv.arguments.game || [], args); else if (mv.minecraftArguments) args.push(...mv.minecraftArguments.split(/\s+/).filter(Boolean).map(sub));
  if (custom && !mv.arguments) args.push('--width', String(inst.width), '--height', String(inst.height));
  if (inst.fullscreen) args.push('--fullscreen');
  return { java, args, cwd: gameDir(inst) };
}

// ---------------- Microsoft account login ----------------
const MS_CLIENT = '00000000402b5328', MS_REDIRECT = 'https://login.live.com/oauth20_desktop.srf';
const encTok = s => { try { if (s && safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(s).toString('base64'); } catch {} return s || ''; };
const decTok = s => { try { if (s && s.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64')); } catch {} return s || ''; };
async function postJson(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA }, body: JSON.stringify(body) });
  let j = {}; try { j = JSON.parse(await r.text()); } catch {}
  if (!r.ok) { const e = new Error(j.XErr ? 'Xbox error ' + j.XErr : (j.errorMessage || j.error || 'HTTP ' + r.status)); e.xerr = j.XErr; throw e; } return j;
}
async function msTokenRequest(params) {
  const r = await fetch('https://login.live.com/oauth20_token.srf', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA }, body: new URLSearchParams({ client_id: MS_CLIENT, scope: 'XboxLive.signin offline_access', redirect_uri: MS_REDIRECT, ...params }).toString() });
  const j = await r.json().catch(() => ({})); if (!r.ok || !j.access_token) throw new Error(j.error_description || j.error || 'Microsoft sign-in failed'); return j;
}
async function msChain(liveToken) {
  const xbl = await postJson('https://user.auth.xboxlive.com/user/authenticate', { Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + liveToken }, RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT' });
  let xsts;
  try { xsts = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', { Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] }, RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT' }); }
  catch (e) { throw new Error({ 2148916233: 'This Microsoft account has no Xbox profile yet. Sign in once at xbox.com to create one.', 2148916235: 'Xbox Live is not available in your country.', 2148916238: 'This is a child account. An adult must add it to a Microsoft family first.' }[e.xerr] || e.message); }
  const mc = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', { identityToken: `XBL3.0 x=${xsts.DisplayClaims.xui[0].uhs};${xsts.Token}` });
  const pr = await fetch('https://api.minecraftservices.com/minecraft/profile', { headers: { Authorization: 'Bearer ' + mc.access_token, 'User-Agent': UA } });
  if (pr.status === 404) throw new Error('This Microsoft account does not own Minecraft: Java Edition.');
  if (!pr.ok) throw new Error('Could not load your Minecraft profile (HTTP ' + pr.status + ')');
  const prof = await pr.json();
  const sk = (prof.skins || []).find(s => s.state === 'ACTIVE');
  return { id: prof.id, name: prof.name, mcToken: mc.access_token, mcExpires: Date.now() + (mc.expires_in || 86400) * 1000 - 120000, skinUrl: sk && sk.url, skinModel: sk && String(sk.variant).toUpperCase() === 'SLIM' ? 'slim' : 'classic' };
}
function msAuthWindow() {
  return new Promise((resolve, reject) => {
    const url = 'https://login.live.com/oauth20_authorize.srf?' + new URLSearchParams({ client_id: MS_CLIENT, response_type: 'code', redirect_uri: MS_REDIRECT, scope: 'XboxLive.signin offline_access', prompt: 'select_account' }).toString();
    const w = new BrowserWindow({ parent: win, modal: true, width: 520, height: 720, title: 'Sign in with Microsoft', autoHideMenuBar: true, webPreferences: { partition: 'ms-login-' + Date.now(), contextIsolation: true, nodeIntegration: false } });
    let done = false; const finish = (err, code) => { if (done) return; done = true; if (!w.isDestroyed()) w.destroy(); err ? reject(err) : resolve(code); };
    const check = u => { if (!u.startsWith(MS_REDIRECT)) return false; const p = new URL(u).searchParams; if (p.get('code')) finish(null, p.get('code')); else finish(new Error(p.get('error_description') || 'Sign-in was cancelled')); return true; };
    w.webContents.on('will-redirect', (e, u) => { if (check(u)) e.preventDefault(); }); w.webContents.on('will-navigate', (e, u) => { if (check(u)) e.preventDefault(); });
    w.on('closed', () => finish(new Error('The sign-in window was closed'))); w.loadURL(url).catch(() => {});
  });
}
async function ensureMsToken() {
  if (!settings.activeMs) return; const a = (settings.msAccounts || []).find(x => x.id === settings.activeMs); if (!a) { settings.activeMs = ''; return; }
  if (Date.now() < a.mcExpires) return;
  try { const tok = await msTokenRequest({ grant_type: 'refresh_token', refresh_token: decTok(a.refresh) }); const n = await msChain(tok.access_token); a.name = n.name; a.mcToken = encTok(n.mcToken); a.mcExpires = n.mcExpires; { const ap = a.appliedSkin; if (ap && exists(skinFile(ap.id)) && ((ap.url && n.skinUrl === ap.url) || Date.now() - ap.at < 15 * 60 * 1000)) { /* keep the skin we applied */ } else { a.skinUrl = n.skinUrl; a.skinModel = n.skinModel; if (ap) delete a.appliedSkin; } } if (tok.refresh_token) a.refresh = encTok(tok.refresh_token); settings.username = n.name; saveSettings(); cacheMsSkins(); }
  catch (e) { throw new Error('Your Microsoft login expired, please sign in again (' + e.message + ')'); }
}

// ---------------- skins ----------------
const SKIN_PATHS = ['entity/steve', 'entity/alex', ...['steve', 'ari', 'kai', 'noor', 'sunny', 'zuri', 'makena', 'efe'].map(n => 'entity/player/wide/' + n), ...['alex', 'ari', 'kai', 'noor', 'sunny', 'zuri', 'makena', 'efe'].map(n => 'entity/player/slim/' + n)].map(p => `assets/minecraft/textures/${p}.png`);
function packFormat(mc) {
  const [a, b = 0, c = 0] = String(mc).split('.').map(x => parseInt(x) || 0); if (a !== 1) return 46;
  if (b < 9) return 1; if (b < 11) return 2; if (b < 13) return 3; if (b < 15) return 4; if (b === 15) return 5; if (b === 16) return c >= 2 ? 6 : 5; if (b === 17) return 7; if (b === 18) return 8;
  if (b === 19) return c >= 4 ? 13 : c >= 3 ? 12 : 9; if (b === 20) return c >= 5 ? 32 : c >= 3 ? 22 : c >= 2 ? 18 : 15; if (b === 21) return c >= 4 ? 46 : c >= 2 ? 42 : 34; return 46;
}
// Offline accounts can't have a real skin, so we show yours with a tiny resource pack that replaces the default skins (visible to you only).
function applySkinPack(inst) {
  const gd = gameDir(inst), packFile = path.join(gd, 'resourcepacks', 'OfflineCraft-Skin.zip'), opt = path.join(gd, 'options.txt');
  const sk = !settings.activeMs && settings.skins && settings.skins[settings.username]; const legacy = (() => { const p = String(inst.mc).split('.').map(Number); return p[0] === 1 && p[1] < 13; })();
  const entry = legacy ? 'OfflineCraft-Skin.zip' : 'file/OfflineCraft-Skin.zip';
  let txt = ''; try { txt = fs.readFileSync(opt, 'utf8'); } catch {}
  const mt = txt.match(/^resourcePacks:(\[.*\])\s*$/m); let list = ['vanilla']; if (mt) { try { list = JSON.parse(mt[1]); } catch {} }
  const had = list.includes(entry); list = list.filter(x => x !== entry);
  if (sk && exists(skinFile(sk.id))) {
    const z = new AdmZip(), buf = fs.readFileSync(skinFile(sk.id)); z.addFile('pack.mcmeta', Buffer.from(JSON.stringify({ pack: { pack_format: packFormat(inst.mc), supported_formats: [1, 999], description: 'OfflineCraft skin' } })));
    for (const p of SKIN_PATHS) z.addFile(p, buf); fs.mkdirSync(path.dirname(packFile), { recursive: true }); z.writeZip(packFile); list.push(entry);
  } else { if (!had && !exists(packFile)) return; fs.rmSync(packFile, { force: true }); }
  const line = 'resourcePacks:' + JSON.stringify(list); const out = mt ? txt.replace(/^resourcePacks:.*$/m, line) : (txt ? txt.replace(/\s*$/, '\n') : '') + line + '\n';
  if (out !== txt) fs.writeFileSync(opt, out);
}
function savePng(buf) {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('That file is not a PNG image.');
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20); if (w !== 64 || (h !== 64 && h !== 32)) throw new Error(`Skins must be 64×64 (or old 64×32) pixels. This image is ${w}×${h}.`);
  const id = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16); fs.mkdirSync(P('skins', 'lib'), { recursive: true }); fs.writeFileSync(skinFile(id), buf); return id;
}
const skinEntry = id => ({ id, url: pathToFileURL(skinFile(id)).href });

// ---------------- modrinth ----------------
async function mrSearch({ type, query, mc, loader, sort, offset, category }) {
  const facets = [[`project_type:${type}`]]; if (category) facets.push([`categories:${category}`]); if (mc) facets.push([`versions:${mc}`]); if (loader && type === 'mod') facets.push([`categories:${loader}`]);
  const u = `${MR}/search?query=${encodeURIComponent(query || '')}&facets=${encodeURIComponent(JSON.stringify(facets))}&index=${sort || 'relevance'}&limit=20&offset=${offset || 0}`;
  const j = await getJson(u);
  return { total: j.total_hits, hits: j.hits.map(h => ({ id: h.project_id, slug: h.slug, title: h.title, desc: h.description, icon: h.icon_url || '', author: h.author, type: h.project_type, downloads: h.downloads, follows: h.follows, cats: (h.display_categories || []).slice(0, 4), color: h.color })) };
}
async function mrPickVersion(pid, mc, loader, useLoader) {
  const q = []; if (mc) q.push('game_versions=' + encodeURIComponent(JSON.stringify([mc])));
  if (useLoader && loader && loader !== 'vanilla') q.push('loaders=' + encodeURIComponent(JSON.stringify([loader])));
  let arr; try { arr = await getJson(`${MR}/project/${pid}/version${q.length ? '?' + q.join('&') : ''}`); } catch { return null; }
  if (!Array.isArray(arr) || !arr.length) return null; return arr.find(v => v.version_type === 'release') || arr[0];
}
const primaryFile = v => v && v.files && (v.files.find(f => f.primary) || v.files[0]);
const SUB = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks', world: 'saves' };
const contentDir = (inst, type) => path.join(gameDir(inst), SUB[type] || 'mods');
function record(inst, file, rec) { const p = path.join(instDir(inst), 'content.json'), j = readJson(p); j[file] = rec; writeJson(p, j); }
async function mrInstall(inst, pid, type, j, visited, forceVersion, depth = 0) {
  if (visited.has(pid)) return; visited.add(pid);
  if (depth === 0) { j.label = 'Checking what is already installed'; await identifyContent(inst); }
  if (installedIdSet(inst).has(pid)) { if (depth === 0) throw new Error('Already installed in this instance'); return; }
  if (type === 'mod' && inst.loader === 'rust') throw new Error('Horizon (Rust) cannot run Java mods. It has its own WebAssembly mod system. Resource packs and data packs work.');
  let proj = {}; try { proj = await getJson(`${MR}/project/${pid}`); } catch {}
  const title = proj.title || pid; j.label = 'Installing ' + title;
  let ver = null; if (forceVersion) { try { ver = await getJson(`${MR}/version/${forceVersion}`); } catch {} }
  if (!ver) ver = await mrPickVersion(pid, inst.mc, inst.loader, type === 'mod');
  if (!ver) throw new Error(`No compatible version of ${title} for ${inst.mc}${type === 'mod' ? ' (' + inst.loader + ')' : ''}`);
  const f = primaryFile(ver); if (!f) throw new Error('No file for ' + title);
  const fname = sanitize(f.filename); await download(f.url, path.join(contentDir(inst, type), fname), j);
  record(inst, fname, { project_id: pid, title, version: ver.version_number, icon: proj.icon_url || '', type, sha1: f.hashes && f.hashes.sha1 });
  if (type === 'mod' && depth < 4) for (const d of ver.dependencies || []) if (d.dependency_type === 'required' && d.project_id) { try { await mrInstall(inst, d.project_id, 'mod', j, visited, d.version_id, depth + 1); } catch (e) { LOG('dependency: ' + e.message); } }
}
async function installMrpack(file, j) {
  stage(j, 'Reading modpack'); const z = new AdmZip(file), ie = z.getEntry('modrinth.index.json'); if (!ie) throw new Error('Not a valid .mrpack');
  const idx = JSON.parse(ie.getData().toString('utf8')), deps = idx.dependencies || {}; let loader = 'vanilla', lv = '';
  for (const [k, n] of [['fabric-loader', 'fabric'], ['quilt-loader', 'quilt'], ['forge', 'forge'], ['neoforge', 'neoforge']]) if (deps[k]) { loader = n; lv = deps[k]; }
  if (!deps.minecraft) throw new Error('Modpack has no Minecraft version');
  const inst = makeInstance(idx.name || 'Modpack', deps.minecraft, loader, lv), gd = gameDir(inst); pushState();
  const tasks = [];
  for (const f of idx.files || []) {
    if (f.env && f.env.client === 'unsupported') continue; const rel = f.path || '';
    if (!rel || rel.includes('..') || rel.startsWith('/') || rel.includes(':') || !f.downloads || !f.downloads.length) continue;
    tasks.push({ url: f.downloads[0], dest: path.join(gd, rel), size: f.fileSize || 0 });
  }
  stage(j, 'Downloading pack files'); await downloadAll(tasks, j);
  stage(j, 'Applying overrides'); await unzip(file, gd, { strip: 'overrides/' }); await unzip(file, gd, { strip: 'client-overrides/' });
  saveInst(inst); return inst;
}
async function runPrepare(inst, j) {
  busy.add(inst.id); pushState();
  try { await prepareInstance(inst, j); saveInst(inst); } finally { busy.delete(inst.id); pushState(); }
}

// ---------------- content identification ----------------
const sha1File = f => new Promise((res, rej) => { const h = crypto.createHash('sha1'); fs.createReadStream(f).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
const installedIdSet = inst => new Set(Object.values(readJson(path.join(instDir(inst), 'content.json'))).map(r => r.project_id).filter(Boolean));
async function identifyContent(inst) {
  const cp = path.join(instDir(inst), 'hash-cache.json'), cache = readJson(cp), rp = path.join(instDir(inst), 'content.json'), rec = readJson(rp);
  const files = [];
  for (const [type, sub] of [['mod', 'mods'], ['resourcepack', 'resourcepacks'], ['shader', 'shaderpacks']]) {
    let ents = []; try { ents = fs.readdirSync(path.join(gameDir(inst), sub), { withFileTypes: true }); } catch {}
    for (const e of ents) { const base = e.name.replace(/\.disabled$/, ''); if (e.isFile() && /\.(jar|zip)$/i.test(base)) files.push({ type, name: base, full: path.join(gameDir(inst), sub, e.name) }); }
  }
  const need = files.filter(f => !(rec[f.name] && rec[f.name].project_id)); if (!need.length) return false;
  for (const f of need) { const st = fs.statSync(f.full); f.key = `${f.type}/${f.name}|${st.size}|${Math.floor(st.mtimeMs)}`; if (!cache[f.key]) cache[f.key] = { sha1: await sha1File(f.full) }; f.sha1 = cache[f.key].sha1; }
  const unknown = need.filter(f => cache[f.key].pid === undefined);
  try {
    for (let i = 0; i < unknown.length; i += 100) {
      const chunk = unknown.slice(i, i + 100);
      const res = await (await fetchRetry(`${MR}/version_files`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hashes: chunk.map(f => f.sha1), algorithm: 'sha1' }) })).json();
      for (const f of chunk) { const v = res[f.sha1]; cache[f.key].pid = v ? v.project_id : null; cache[f.key].ver = v ? v.version_number : ''; }
    }
    const pids = [...new Set(need.map(f => cache[f.key].pid).filter(Boolean))], info = {};
    for (let i = 0; i < pids.length; i += 100) {
      const arr = await (await fetchRetry(`${MR}/projects?ids=${encodeURIComponent(JSON.stringify(pids.slice(i, i + 100)))}`)).json();
      for (const p of arr) info[p.id] = { title: p.title, icon: p.icon_url || '' };
    }
    let changed = false;
    for (const f of need) { const c = cache[f.key]; if (c.pid) { rec[f.name] = { project_id: c.pid, title: (info[c.pid] || {}).title || f.name, version: c.ver || '', icon: (info[c.pid] || {}).icon || '', type: f.type, sha1: f.sha1 }; changed = true; } }
    if (changed) writeJson(rp, rec); writeJson(cp, cache); return changed;
  } catch (e) { LOG('identify failed: ' + e.message); writeJson(cp, cache); return false; }
}

// ---------------- content listing ----------------
function listContent(inst, kind) {
  const dir = contentDir(inst, kind), rec = readJson(path.join(instDir(inst), 'content.json')), out = [];
  let names = []; try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch {}
  for (const e of names) {
    const f = e.name;
    if (kind === 'world') { if (e.isDirectory()) { let icon = '', mt = 0; try { icon = 'data:image/png;base64,' + fs.readFileSync(path.join(dir, f, 'icon.png')).toString('base64'); } catch {} try { mt = fs.statSync(path.join(dir, f, 'level.dat')).mtimeMs; } catch { try { mt = fs.statSync(path.join(dir, f)).mtimeMs; } catch {} } out.push({ file: f, title: f, enabled: true, size: 0, dir: true, icon, mtime: mt }); } continue; }
    const dis = f.endsWith('.disabled'), base = dis ? f.slice(0, -9) : f, r = rec[base] || {};
    out.push({ file: f, title: r.title || base, ver: r.version || '', icon: r.icon || '', enabled: !dis, size: e.isDirectory() ? 0 : fsize(path.join(dir, f)), dir: e.isDirectory() });
  }
  return out.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
}
async function updateMods(inst, j) {
  const dir = contentDir(inst, 'mod'); let files = []; try { files = fs.readdirSync(dir).filter(f => f.endsWith('.jar')); } catch {}
  if (!files.length) throw new Error('No mods to update');
  stage(j, 'Checking for updates'); const hashes = {};
  for (const f of files) hashes[crypto.createHash('sha1').update(fs.readFileSync(path.join(dir, f))).digest('hex')] = f;
  const body = { hashes: Object.keys(hashes), algorithm: 'sha1', game_versions: [inst.mc] }; if (inst.loader !== 'vanilla') body.loaders = [inst.loader];
  const res = await (await fetchRetry(`${MR}/version_files/update`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  const upd = Object.entries(res).filter(([h, v]) => { const f = primaryFile(v); return f && f.hashes.sha1 !== h; });
  if (!upd.length) { j.label = 'Everything is up to date'; return; }
  stage(j, 'Updating mods', upd.length);
  for (const [h, v] of upd) {
    const f = primaryFile(v), old = hashes[h], nf = sanitize(f.filename); j.label = 'Updating ' + nf;
    await download(f.url, path.join(dir, nf), j);
    const rp = path.join(instDir(inst), 'content.json'), r = readJson(rp), prev = r[old] || {}; delete r[old];
    r[nf] = { ...prev, version: v.version_number, sha1: f.hashes.sha1 }; writeJson(rp, r);
    if (old !== nf) fs.rmSync(path.join(dir, old), { force: true }); j.done++;
  }
  send('toast', { msg: `Updated ${upd.length} mod(s)` });
}

// ---------------- API exposed to renderer ----------------

// ---- theme files (.theme = JSON) ----
const NAV_IDS = ['library', 'discover', 'skins', 'accounts', 'host'];
const THEME_SPEC = { accentA: 'hex', accentB: 'hex', panelColor: 'hex', appColor: 'hex', outlineColor: 'hex', sidebarPos: ['left', 'right', 'top', 'bottom'], sidebarLabels: 'bool', animations: 'bool', bgPauseUnfocused: 'bool', bgDim: [0, 90], bgBlur: [0, 30], panelOpacity: [30, 100], panelBlur: [0, 30], sidebarOpacity: [0, 100], sidebarBlur: [0, 30], sidebarGlass: 'bool', glassRefract: [0, 40], secondBar: 'bool', accentAuto: 'bool', glassAll: 'bool', barAutoHide: 'bool', uiScale: [80, 125], density: ['comfortable', 'compact'], fontFamily: ['default', 'inter', 'system'], fontPixel: 'bool', cardStyle: ['grid', 'list', 'compact'], glow: [0, 200], ambient: ['off', 'snow', 'fireflies', 'ash'], ambientAmount: [10, 100], navOrder: { list: NAV_IDS }, navHidden: { list: NAV_IDS.filter(x => x !== 'library') }, outlineOpacity: [0, 100], outlineSize: [0, 8] };
const BG_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.mp4', '.webm', '.m4v'], VIDEO_EXTS = ['.mp4', '.webm', '.m4v'];
function cleanTheme(src) {
  const o = {};
  for (const [k, spec] of Object.entries(THEME_SPEC)) {
    const v = src[k]; if (v === undefined || v === null) continue;
    if (spec === 'hex') { if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) o[k] = v.toLowerCase(); }
    else if (spec === 'bool') { if (typeof v === 'boolean') o[k] = v; }
    else if (spec.list) { if (Array.isArray(v)) o[k] = [...new Set(v.filter(x => spec.list.includes(x)))]; }
    else if (typeof spec[0] === 'string') { if (spec.includes(v)) o[k] = v; }
    else if (Number.isFinite(+v)) o[k] = Math.max(spec[0], Math.min(spec[1], Math.round(+v)));
  }
  return o;
}

const api = {
  async init() { loadInstances(); if (!javas.length) setTimeout(scanJavas, 50); loadManifest().then(() => send('versions', manifest)); return { gfx: { mode: settings.gpuMode, level, status: readJson(P('gpu-status.json'), null) }, settings: rs(), instances: instances.map(viewInst), root: ROOT, running: {}, busy: [], versions: manifest, javas }; },
  versions: async () => manifest.length ? manifest : loadManifest(),
  applyZoom: () => { applyZoom(); return true; },
  saveSettings: s => { settings = { ...settings, ...s }; if (settings.username && !settings.activeMs && !settings.accounts.includes(settings.username)) settings.accounts.push(settings.username); saveSettings(); pushState(); return rs(); },
  uuid: n => offlineUuid(n),
  async msLogin() {
    try {
      const code = await msAuthWindow(), tok = await msTokenRequest({ grant_type: 'authorization_code', code }), a = await msChain(tok.access_token);
      const rec = { id: a.id, name: a.name, refresh: encTok(tok.refresh_token), mcToken: encTok(a.mcToken), mcExpires: a.mcExpires, skinUrl: a.skinUrl, skinModel: a.skinModel };
      settings.msAccounts = [...(settings.msAccounts || []).filter(x => x.id !== a.id), rec]; settings.activeMs = a.id; settings.username = a.name; saveSettings(); pushState(); cacheMsSkins(); return { ok: true, name: a.name };
    } catch (e) { return { err: e.message || String(e) }; }
  },
  async defaultSteve() {
    const out = P('cache', 'steve-default.png'), url = () => pathToFileURL(out).href;
    const okPng = b => b && b.length > 100 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(16) === 64 && [32, 64].includes(b.readUInt32BE(20));
    try { if (okPng(fs.readFileSync(out))) return url(); } catch {}
    fs.mkdirSync(path.dirname(out), { recursive: true });
    try {                                         // 1) straight from an installed game version
      let tried = 0;
      for (const d of fs.readdirSync(P('versions'))) {
        const jar = P('versions', d, d + '.jar'); if (fsize(jar) <= 0 || tried++ > 4) continue;
        const z = new AdmZip(jar), e = z.getEntry('assets/minecraft/textures/entity/player/wide/steve.png') || z.getEntry('assets/minecraft/textures/entity/steve.png');
        if (e && okPng(e.getData())) { fs.writeFileSync(out, e.getData()); return url(); }
      }
    } catch {}
    try {                                         // 2) from Mojang's texture server
      const r = await fetchRetry('https://textures.minecraft.net/texture/31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb', {}, 2), b = Buffer.from(await r.arrayBuffer());
      if (okPng(b)) { fs.writeFileSync(out, b); return url(); }
    } catch {}
    return null;
  },
  deleteSkin(id) {
    if (!/^[0-9a-f]{8,40}$/.test(String(id))) return { err: 'Unknown skin' };
    fs.rmSync(skinFile(id), { force: true });
    for (const [n, sk] of Object.entries(settings.skins || {})) if (sk.id === id) delete settings.skins[n];
    for (const a of settings.msAccounts || []) if (a.appliedSkin && a.appliedSkin.id === id) delete a.appliedSkin;
    saveSettings(); pushState(); return { ok: true };
  },
  skinLibrary() { try { return fs.readdirSync(P('skins', 'lib')).filter(f => f.endsWith('.png')).map(f => skinEntry(f.slice(0, -4))); } catch { return []; } },
  async pickSkinFile() {
    const r = await dialog.showOpenDialog(win, { title: 'Choose a skin', filters: [{ name: 'Minecraft skin (PNG)', extensions: ['png'] }], properties: ['openFile'] }); if (r.canceled) return null;
    try { return skinEntry(savePng(fs.readFileSync(r.filePaths[0]))); } catch (e) { return { err: e.message }; }
  },
  async importSkinByName(name) {
    try {
      if (!/^\w{1,16}$/.test(name)) throw new Error('That is not a valid Minecraft username.');
      const r = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`, { headers: { 'User-Agent': UA } }); if (r.status === 404 || r.status === 204) throw new Error('No Minecraft player called "' + name + '" was found.'); if (!r.ok) throw new Error('Mojang lookup failed (HTTP ' + r.status + ')');
      const id = (await r.json()).id, prof = await getJson(`https://sessionserver.mojang.com/session/minecraft/profile/${id}`), tex = JSON.parse(Buffer.from(prof.properties.find(p => p.name === 'textures').value, 'base64').toString()).textures;
      if (!tex.SKIN) throw new Error(name + ' uses a default skin (nothing to copy).');
      const buf = Buffer.from(await (await fetchRetry(tex.SKIN.url)).arrayBuffer()); return { ...skinEntry(savePng(buf)), model: tex.SKIN.metadata && tex.SKIN.metadata.model === 'slim' ? 'slim' : 'classic' };
    } catch (e) { return { err: e.message || String(e) }; }
  },
  async applySkin({ id, model }) {
    try {
      if (!exists(skinFile(id))) throw new Error('Pick a skin first.');
      if (settings.activeMs) {
        await ensureMsToken(); const a = (settings.msAccounts || []).find(x => x.id === settings.activeMs), fd = new FormData();
        fd.append('variant', model === 'slim' ? 'slim' : 'classic'); fd.append('file', new Blob([fs.readFileSync(skinFile(id))], { type: 'image/png' }), 'skin.png');
        const variant = model === 'slim' ? 'slim' : 'classic', post = () => { const f2 = new FormData(); f2.append('variant', variant); f2.append('file', new Blob([fs.readFileSync(skinFile(id))], { type: 'image/png' }), 'skin.png'); return fetch('https://api.minecraftservices.com/minecraft/profile/skins', { method: 'POST', headers: { Authorization: 'Bearer ' + decTok(a.mcToken), 'User-Agent': UA }, body: f2 }); };
        let r = await post(); if (r.status === 401) { a.mcExpires = 0; await ensureMsToken(); r = await post(); }
        if (!r.ok) {
          let msg = ''; try { const jj = JSON.parse(await r.text()); msg = jj.errorMessage || jj.error || ''; } catch {}
          throw new Error(r.status === 429 ? 'Mojang says skins are being changed too often. Wait a minute and try again.' : r.status === 401 || r.status === 403 ? 'Mojang refused the login. Sign in again from the account menu at the top right.' : `Mojang rejected the skin (HTTP ${r.status})${msg ? ': ' + msg : ''}`);
        }
        const j = await r.json().catch(() => ({})), sk = (j.skins || []).find(s => s.state === 'ACTIVE'); if (sk) { a.skinUrl = sk.url; a.skinModel = String(sk.variant).toUpperCase() === 'SLIM' ? 'slim' : 'classic'; }
        // Remember what was applied: Mojang's profile can lag behind for a while, and it must not bring the old skin back on screen.
        a.appliedSkin = { id, model: variant, at: Date.now(), url: sk ? sk.url : '' }; a.skinCache = ''; a.skinCacheUrl = '';
      } else { settings.skins = { ...(settings.skins || {}), [settings.username]: { id, model: model === 'slim' ? 'slim' : 'classic' } }; }
      saveSettings(); pushState(); cacheMsSkins(); return { ok: true, online: !!settings.activeMs };
    } catch (e) { return { err: e.message || String(e) }; }
  },
  async resetSkin() {
    try {
      if (settings.activeMs) { await ensureMsToken(); const a = (settings.msAccounts || []).find(x => x.id === settings.activeMs); const r = await fetch('https://api.minecraftservices.com/minecraft/profile/skins/active', { method: 'DELETE', headers: { Authorization: 'Bearer ' + decTok(a.mcToken), 'User-Agent': UA } }); if (!r.ok) throw new Error('Mojang refused (HTTP ' + r.status + ')'); a.skinUrl = ''; a.skinCache = ''; a.skinCacheUrl = ''; delete a.appliedSkin; }
      else { const s = { ...(settings.skins || {}) }; delete s[settings.username]; settings.skins = s; }
      saveSettings(); pushState(); return { ok: true };
    } catch (e) { return { err: e.message || String(e) }; }
  },
  switchMs(id) { const a = (settings.msAccounts || []).find(x => x.id === id); if (!a) return; settings.activeMs = id; settings.username = a.name; saveSettings(); pushState(); },
  removeMsAccount(id) { settings.msAccounts = (settings.msAccounts || []).filter(x => x.id !== id); if (settings.activeMs === id) { settings.activeMs = ''; settings.username = settings.accounts[0] || ''; } saveSettings(); pushState(); },
  graphics: () => ({ mode: settings.gpuMode, level, status: readJson(P('gpu-status.json'), null) }),
  async gpuReport() { let gpu = null; try { gpu = await app.getGPUInfo('basic'); } catch {} return JSON.stringify({ level, mode: settings.gpuMode, status: readJson(P('gpu-status.json'), null), gpu: gpu && gpu.gpuDevice, features: app.getGPUFeatureStatus(), electron: process.versions.electron, os: os.release(), log: logLines.slice(-40) }, null, 2); },
  setGpuMode(mode) { settings.gpuMode = mode; if (mode === 'auto') { try { fs.unlinkSync(SAFE_FILE); } catch {} try { fs.unlinkSync(P('gpu-status.json')); } catch {} } saveSettings(); app.relaunch(); app.exit(0); },
  restart() { app.relaunch(); app.exit(0); },
  async pickBackground() {
    const oldFile = settings.bgFile;
    const r = await dialog.showOpenDialog(win, { title: 'Choose a background', filters: [{ name: 'Images, GIFs & videos', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'mp4', 'webm', 'm4v'] }], properties: ['openFile'] });
    if (r.canceled) return false;
    const src = r.filePaths[0], ext = path.extname(src).toLowerCase(), dir = P('backgrounds'); fs.mkdirSync(dir, { recursive: true });
    const name = 'bg-' + Date.now() + ext; fs.copyFileSync(src, path.join(dir, name));
    settings.bgFile = name; settings.bgType = ['.mp4', '.webm', '.m4v'].includes(ext) ? 'video' : 'image'; settings.bgVer = Date.now(); saveSettings(); pushState();
    if (oldFile) rmLater(path.join(dir, oldFile)); return true;
  },
  async pickInstanceImage(id, kind) {
    const i = getInst(id); if (!i) return false; const key = kind === 'cover' ? 'coverFile' : 'iconFile';
    const r = await dialog.showOpenDialog(win, { title: kind === 'cover' ? 'Choose a card background' : 'Choose a logo', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }], properties: ['openFile'] }); if (r.canceled) return false;
    const old = i[key], name = `${kind}-${Date.now()}${path.extname(r.filePaths[0]).toLowerCase()}`;
    fs.copyFileSync(r.filePaths[0], path.join(instDir(i), name)); i[key] = name; i.assetVer = Date.now(); saveInst(i); pushState(); if (old) rmLater(path.join(instDir(i), old)); return true;
  },
  clearInstanceImage(id, kind) { const i = getInst(id); if (!i) return; const key = kind === 'cover' ? 'coverFile' : 'iconFile', old = i[key]; i[key] = ''; i.assetVer = Date.now(); saveInst(i); pushState(); if (old) rmLater(path.join(instDir(i), old)); return true; },
  openUrl(u) { if (/^https:\/\//i.test(String(u))) shell.openExternal(String(u)); },
  async projectDetail(id) {
    const [p, vers, mem] = await Promise.all([getJson(`${MR}/project/${id}`), getJson(`${MR}/project/${id}/version`).catch(() => []), getJson(`${MR}/project/${id}/members`).catch(() => [])]);
    return {
      project: { id: p.id, slug: p.slug, type: p.project_type, title: p.title, description: p.description, body: p.body || '', icon: p.icon_url || '', downloads: p.downloads, followers: p.followers, categories: p.categories || [], loaders: p.loaders || [], versions: p.game_versions || [],
        client: p.client_side, server: p.server_side, license: p.license && (p.license.name || p.license.id), source: p.source_url, issues: p.issues_url, wiki: p.wiki_url, discord: p.discord_url, published: p.published, updated: p.updated,
        gallery: (p.gallery || []).map(g => ({ url: g.url, title: g.title || '', description: g.description || '' })) },
      versions: (Array.isArray(vers) ? vers : []).slice(0, 40).map(v => ({ id: v.id, name: v.name, number: v.version_number, type: v.version_type, games: v.game_versions || [], loaders: v.loaders || [], date: v.date_published, downloads: v.downloads })),
      members: (Array.isArray(mem) ? mem : []).map(x => ({ name: x.user && x.user.username, role: x.role })),
    };
  },
  instanceStats(id) {
    const i = getInst(id); if (!i) return null; const cnt = (sub, dirs) => { try { return fs.readdirSync(path.join(gameDir(i), sub), { withFileTypes: true }).filter(e => dirs ? e.isDirectory() : e.isFile() && !e.name.endsWith('.part')).length; } catch { return 0; } };
    return { mods: cnt('mods', false), packs: cnt('resourcepacks', false), shaders: cnt('shaderpacks', false), worlds: cnt('saves', true) };
  },
  async exportTheme() {
    const obj = { format: 'offlinecraft-theme', version: 1, exportedAt: new Date().toISOString(), settings: {}, background: null };
    for (const k of Object.keys(THEME_SPEC)) if (settings[k] !== undefined) obj.settings[k] = settings[k];
    let bgSkipped = false;
    if (settings.bgFile && settings.bgType !== 'none') {
      const f = P('backgrounds', settings.bgFile);
      try { if (fs.statSync(f).size > 200 * 1024 * 1024) bgSkipped = true; else obj.background = { type: settings.bgType, ext: path.extname(settings.bgFile).toLowerCase(), data: fs.readFileSync(f).toString('base64') }; } catch {}
    }
    const r = await dialog.showSaveDialog(win, { title: 'Export theme', defaultPath: path.join(app.getPath('documents'), 'OfflineCraft.theme'), filters: [{ name: 'OfflineCraft theme', extensions: ['theme'] }] });
    if (r.canceled || !r.filePath) return null;
    const fp = /\.theme$/i.test(r.filePath) ? r.filePath : r.filePath + '.theme';
    try { fs.writeFileSync(fp, JSON.stringify(obj, null, 2)); } catch (e) { return { err: 'Could not save the file: ' + e.message }; }
    return { ok: true, path: fp, bg: !!obj.background, bgSkipped };
  },
  async importTheme() {
    const r = await dialog.showOpenDialog(win, { title: 'Import theme', filters: [{ name: 'OfflineCraft theme', extensions: ['theme', 'json'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    let t;
    try { if (fs.statSync(r.filePaths[0]).size > 400 * 1024 * 1024) return { err: 'That file is too big to be a theme.' }; t = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); } catch { return { err: 'That file is not a valid theme.' }; }
    if (!t || t.format !== 'offlinecraft-theme' || !t.settings || typeof t.settings !== 'object') return { err: 'That file is not an OfflineCraft theme.' };
    const clean = cleanTheme(t.settings), dir = P('backgrounds'), oldFile = settings.bgFile; let bg = false;
    if (t.background && typeof t.background.data === 'string') {
      const ext = String(t.background.ext || '').toLowerCase();
      if (BG_EXTS.includes(ext)) {
        fs.mkdirSync(dir, { recursive: true }); const name = 'bg-' + Date.now() + ext;
        fs.writeFileSync(path.join(dir, name), Buffer.from(t.background.data, 'base64'));
        clean.bgFile = name; clean.bgType = VIDEO_EXTS.includes(ext) ? 'video' : 'image'; clean.bgVer = Date.now(); bg = true;
      }
    }
    if (!bg) { clean.bgFile = ''; clean.bgType = 'none'; }
    settings = { ...settings, ...clean }; saveSettings(); pushState();
    if (oldFile && oldFile !== settings.bgFile) rmLater(path.join(dir, oldFile));
    return { ok: true, bg };
  },
  clearBackground() { const old = settings.bgFile; settings.bgFile = ''; settings.bgType = 'none'; saveSettings(); pushState(); if (old) rmLater(P('backgrounds', old)); return true; },
  async createInstance({ name, mc, loader, loaderVer }) { if (!mc) { send('toast', { msg: 'Pick a Minecraft version first', err: true }); return null; } const i = makeInstance(name || (mc + (loader !== 'vanilla' ? ' ' + loader : '')), mc, loader, loaderVer); pushState(); startJob('Installing ' + i.name, j => runPrepare(i, j)).then(e => { if (!e) send('toast', { msg: i.name + ' is ready to play' }); }); return i; },
  updateInstance(id, patch) { const i = getInst(id); if (!i) return null; Object.assign(i, patch); saveInst(i); pushState(); return i; },
  deleteInstance(id) { const i = getInst(id); if (!i) return; fs.rmSync(instDir(i), { recursive: true, force: true }); instances = instances.filter(x => x !== i); pushState(); },
  duplicateInstance(id) {
    const o = getInst(id); if (!o) return; const n = makeInstance(o.name + ' copy', o.mc, o.loader, o.loaderVer); fs.cpSync(instDir(o), instDir(n), { recursive: true });
    Object.assign(n, { ...o, id: n.id, name: o.name + ' copy', created: Date.now() / 1000 | 0, lastPlayed: 0, playTime: 0, ready: false }); saveInst(n); pushState(); return n;
  },
  openFolder(id, sub) { const i = getInst(id); if (!i) return; const d = sub === 'root' ? instDir(i) : path.join(gameDir(i), sub || ''); fs.mkdirSync(d, { recursive: true }); shell.openPath(d); },
  openData() { shell.openPath(ROOT); },
  repair(id) { const i = getInst(id); if (!i) return; i.ready = false; return startJob('Repairing ' + i.name, j => runPrepare(i, j)); },
  async launch(id, opts = {}) {
    if (!settings.username) { send('toast', { msg: 'Add an account first (top-right corner)', err: true }); return; }
    const inst = getInst(id); if (!inst || busy.has(id)) return; const ex = running.get(id); if (ex && ex.alive) return;
    busy.add(id); pushState();
    const fail = msg => { const r = running.get(id) && running.get(id).alive ? running.get(id) : { lines: [], alive: false }; running.set(id, r); const l = '[launcher] ERROR: ' + msg; r.lines.push(l); emitConsole(id, l); LOG(`launch ${inst.name}: ${msg}`); };
    const err = await startJob('Launching ' + inst.name, async j => {
     try {
      if (!quickCheck(inst)) { await prepareInstance(inst, j); saveInst(inst); }
      try { stage(j, 'Backing up worlds'); await features.autoBackup(inst, j); } catch (e) { LOG('auto backup: ' + e.message); }
      stage(j, 'Starting game'); await ensureMsToken(); let java, lp;
      if (inst.loader === 'rust') { lp = rustLaunch(inst); java = lp.java; if (opts && opts.join) lp.args.push('--server', String(opts.join)); }
      else { try { applySkinPack(inst); } catch (e) { LOG('skin pack: ' + e.message); } const mv = mergedVersion(inst.versionId); java = await pickJava(inst, requiredJava(mv), j); lp = buildLaunch(inst, mv, java); if (opts && opts.join) lp.args.push(...joinArgs(inst, String(opts.join))); }
      const r = { lines: [], alive: true, started: Date.now(), proc: null }; running.set(id, r); LOG(`launch ${inst.name}: ${java} ${lp.args.length} args`);
      const add = l => { r.lines.push(l); if (r.lines.length > 6000) r.lines.shift(); emitConsole(id, l); };
      if (opts && opts.safe && inst.loader !== 'vanilla' && inst.loader !== 'rust') { try { const n = features.holdMods(inst); add(`[launcher] Safe mode: ${n} mod(s) set aside for this launch, they come back when the game closes`); } catch (e) { add('[launcher] Safe mode failed: ' + e.message); } }
      add(`[launcher] ${java}`); add(`[launcher] Minecraft ${inst.mc} / ${inst.versionId} as ${settings.username} (offline)`);
      { const pre = await features2.runHook(inst, inst.preCmd, 'Pre-launch', add); if (pre !== 0) { r.alive = false; throw new Error('The pre-launch command failed (exit code ' + pre + '). Its output is in the console.'); } }
      const sp = features2.spawnSpec(inst, lp); if (sp.cmd !== lp.java) add('[launcher] Wrapper: ' + sp.cmd);
      const pr = cp.spawn(sp.cmd, sp.args, { cwd: lp.cwd, windowsHide: true, env: sp.env }); r.proc = pr;
      const on = d => d.toString().split(/\r?\n/).filter(Boolean).forEach(add); pr.stdout.on('data', on); pr.stderr.on('data', on);
      const fin = code => { if (!r.alive) return; r.alive = false; try { features.releaseMods(inst); } catch {} const dur = (Date.now() - r.started) / 1000 | 0; add(`[launcher] Game exited with code ${code}`); inst.playTime = (inst.playTime || 0) + dur; saveInst(inst); if (settings.minimizeOnLaunch && win) win.restore(); try { features.onExit(inst, r, code, dur); } catch (e) { LOG('crash helper: ' + e.message); } features2.runHook(inst, inst.postCmd, 'Post-exit', add, { INST_EXIT_CODE: String(code) }); pushState(); };
      pr.on('close', fin); pr.on('error', e => { add('[launcher] ' + e.message); fin(-1); });
      inst.lastPlayed = Date.now() / 1000 | 0; saveInst(inst); if (settings.minimizeOnLaunch && win) win.minimize();
     } catch (e) { fail(e.message || String(e)); throw e; }
    });
    busy.delete(id); pushState(); return err;
  },
  stop(id) { const r = running.get(id); if (r && r.alive && r.proc) { r.stopped = true; r.proc.kill(); } },
  console: id => { const r = running.get(id); return r ? r.lines : []; },
  listContent: (id, kind) => { const i = getInst(id); return i ? listContent(i, kind) : []; },
  identify: async id => { const i = getInst(id); return i ? identifyContent(i) : false; },
  installedIds: id => { const i = getInst(id); return i ? Object.values(readJson(path.join(instDir(i), 'content.json'))).map(r => r.project_id) : []; },
  toggleContent(id, kind, file) { const i = getInst(id), d = contentDir(i, kind), a = path.join(d, file); fs.renameSync(a, file.endsWith('.disabled') ? a.slice(0, -9) : a + '.disabled'); },
  removeContent(id, kind, file) {
    const i = getInst(id); fs.rmSync(path.join(contentDir(i, kind), file), { recursive: true, force: true });
    if (kind !== 'world') { const p = path.join(instDir(i), 'content.json'), r = readJson(p); delete r[file.replace(/\.disabled$/, '')]; writeJson(p, r); }
  },
  search: a => mrSearch(a),
  installProject: ({ instId, projectId, type, title, versionId }) => { const i = getInst(instId); if (!i) { send('toast', { msg: 'Choose an instance to install into first (create one in the Library).', err: true }); return { err: 'no instance' }; } return startJob('Install ' + (title || projectId), async j => { await mrInstall(i, projectId, type, j, new Set(), versionId || ''); }).then(e => ({ err: e })); },
  async installModpack(pid, versionId) {
    return startJob('Modpack', async j => {
      const ver = versionId ? await getJson(`${MR}/version/${versionId}`) : await mrPickVersion(pid, '', '', false); if (!ver) throw new Error('No downloadable version found');
      const f = primaryFile(ver), tmp = P('cache', sanitize(f.filename)); stage(j, 'Downloading modpack'); await download(f.url, tmp, j);
      const inst = await installMrpack(tmp, j); await runPrepare(inst, j); send('toast', { msg: inst.name + ' installed — find it in your Library' });
    }).then(e => ({ err: e }));
  },
  async importMrpack() {
    const r = await dialog.showOpenDialog(win, { filters: [{ name: 'Modrinth modpack', extensions: ['mrpack'] }], properties: ['openFile'] }); if (r.canceled) return;
    startJob('Importing modpack', async j => { const inst = await installMrpack(r.filePaths[0], j); await runPrepare(inst, j); send('toast', { msg: inst.name + ' imported' }); });
  },
  updateMods(id) { const i = getInst(id); return startJob('Updating mods', j => updateMods(i, j)); },
  cancelJob(id) { const j = jobs.get(id); if (j) j.cancel = true; },
  javas: () => javas, rescanJava: () => scanJavas(),
  downloadJava: major => startJob(`Java ${major}`, j => downloadJava(major, j)),
  launcherLog: () => logLines,
  winMin: () => win.minimize(), winMax: () => {
    if (!ROUNDED) { win.isMaximized() ? win.unmaximize() : win.maximize(); return; }
    if (win._maxed) { if (win._restore) win.setBounds(win._restore); win._maxed = false; send('maxed', false); }
    else { win._restore = win.getBounds(); win.setBounds(screen.getDisplayMatching(win._restore).workArea); win._maxed = true; send('maxed', true); }
  }, winClose: () => win.close(), winIsMax: () => ROUNDED ? !!win._maxed : win.isMaximized(),
  setWinStyle(style) { if (!['rounded', 'classic'].includes(style)) return; settings.winStyle = style; saveSettings(); app.relaunch(); app.exit(0); },
  winGetBounds: () => win.getBounds(), winSetBounds: b => { if (!b || win._maxed || win.isMaximized() || win.isFullScreen()) return; const mw = 1000 + (ROUNDED ? 2 * WIN_M : 0), mh = 640 + (ROUNDED ? 2 * WIN_M : 0); win.setBounds({ x: Math.round(b.x), y: Math.round(b.y), width: Math.max(mw, Math.round(b.width)), height: Math.max(mh, Math.round(b.height)) }); },
};

ipcMain.handle('oc', async (e, name, ...a) => { try { return await api[name](...a); } catch (err) { LOG(`[api:${name}] ${err.message}`); throw err; } });

function createWindow() {
  ROUNDED = wantRounded(); LOG('window style: ' + (ROUNDED ? 'rounded (transparent)' : 'classic'));
  win = new BrowserWindow({ width: 1320 + (ROUNDED ? 2 * WIN_M : 0), height: 820 + (ROUNDED ? 2 * WIN_M : 0), minWidth: 1000 + (ROUNDED ? 2 * WIN_M : 0), minHeight: 640 + (ROUNDED ? 2 * WIN_M : 0), frame: false, transparent: ROUNDED, resizable: !ROUNDED, hasShadow: !ROUNDED, backgroundColor: ROUNDED ? '#00000000' : '#0b0d12', show: false, title: 'OfflineCraft', icon: path.join(__dirname, 'renderer', 'logo.png'), webPreferences: { spellcheck: false, preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  LOG('lifecycle: window created');
  win.setMenuBarVisibility(false);
  for (const ev of ['show', 'hide', 'closed', 'unresponsive']) win.on(ev, () => LOG('window ' + ev));
  for (const ev of ['did-start-loading', 'dom-ready', 'did-finish-load']) win.webContents.on(ev, () => LOG('page ' + ev));
  win.webContents.on('console-message', (e, level, msg, line, src) => { if (level >= 2) LOG(`page console [${level}] ${msg} (${path.basename(src || '')}:${line})`); });
  win.webContents.on('preload-error', (e, p, err) => LOG('preload error: ' + err));
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  let loaded = false; win.webContents.once('did-finish-load', () => { loaded = true; setTimeout(() => { try { features2.cli(process.argv); } catch (err) { LOG('cli: ' + err.message); } }, 1500); setTimeout(() => { try { fs.unlinkSync(START_MARK); } catch {} if (level > 0 && settings.gpuMode !== 'software') writeJson(SAFE_FILE, { level }); }, 1500); LOG('UI loaded'); setTimeout(() => { try { fs.writeFileSync(path.join(ROOT, '.ui-ready'), String(Date.now())); } catch {} }, 120); });
  setTimeout(() => { if (!loaded && level < 2 && !process.argv.includes('--oc-relaunched')) { LOG('UI not loaded after 8s - relaunching in safer graphics mode'); app.relaunch({ args: process.argv.slice(1).concat('--oc-relaunched') }); app.exit(0); } }, 8000);
  setTimeout(() => { if (!loaded) dialog.showErrorBox('OfflineCraft', 'The interface did not load within 15 seconds.\nSee data\\launcher.log for details.'); }, 15000);
  const show = () => { if (win && !win.isDestroyed() && !win.isVisible()) win.show(); };
  win.once('ready-to-show', show); win.webContents.once('did-finish-load', show); setTimeout(show, 3000);
  win.webContents.on('render-process-gone', (e, d) => LOG('renderer gone: ' + d.reason));
  win.webContents.on('did-fail-load', (e, code, desc) => { LOG('load failed: ' + desc); dialog.showErrorBox('OfflineCraft', 'UI failed to load: ' + desc); });
  win.on('maximize', () => send('maxed', true)); win.on('unmaximize', () => send('maxed', false));
  win.on('moved', () => { if (!ROUNDED || !win._maxed) return; const d = screen.getDisplayMatching(win.getBounds()).workArea, b = win.getBounds(); if (b.x !== d.x || b.y !== d.y || b.width !== d.width || b.height !== d.height) { win._maxed = false; send('maxed', false); } });
}
// One launcher at a time: a desktop shortcut (OfflineCraft.exe --launch "My instance") hands over to the running one.
const SECOND_INSTANCE = !app.requestSingleInstanceLock();
if (SECOND_INSTANCE) app.quit(); else app.on('second-instance', (e, argv) => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } try { features2.cli(argv); } catch (err) { LOG('cli: ' + err.message); } });
if (!SECOND_INSTANCE && (require.main === module || process.versions.electron)) {
  app.whenReady().then(() => {
    LOG('lifecycle: app ready'); setTimeout(() => cacheMsSkins(), 1500);
    app.getGPUInfo('basic').then(i => LOG('gpu: ' + JSON.stringify((i.gpuDevice || []).map(d => ({ vendor: d.vendorId, device: d.deviceId, driver: d.driverVersion, active: d.active }))))).catch(() => {});
    try { for (const f of fs.readdirSync(P('backgrounds'))) if (f !== settings.bgFile) rmLater(P('backgrounds', f)); } catch {}
    try { ['instances', 'versions', 'libraries', 'assets', 'cache', 'runtimes'].forEach(d => fs.mkdirSync(P(d), { recursive: true })); createWindow(); }
    catch (e) { LOG('startup failed: ' + (e.stack || e)); dialog.showErrorBox('OfflineCraft failed to start', String(e.stack || e)); app.quit(); }
  });
  app.on('window-all-closed', () => app.quit());
}

// ================= Microsoft skin cache =================
async function cacheMsSkins() {
  let changed = false;
  for (const a of settings.msAccounts || []) {
    const f = a.skinCache && path.join(P('skins', 'cache'), a.skinCache + '.png');
    if (a.skinUrl && /^https:\/\//.test(a.skinUrl) && (a.skinCacheUrl !== a.skinUrl || !f || !exists(f))) {
      try { const id = crypto.createHash('sha1').update(a.skinUrl).digest('hex').slice(0, 16), buf = Buffer.from(await (await fetchRetry(a.skinUrl)).arrayBuffer()); fs.mkdirSync(P('skins', 'cache'), { recursive: true }); fs.writeFileSync(path.join(P('skins', 'cache'), id + '.png'), buf); a.skinCache = id; a.skinCacheUrl = a.skinUrl; changed = true; }
      catch (e) { LOG('skin cache: ' + e.message); }
    }
  }
  if (changed) { saveSettings(); pushState(); }
}

// ================= Minecraft server list protocol (status + online/offline-mode probe) =================
const _net = require('net'), _dgram = require('dgram'), _dns = require('dns').promises;
const varint = n => { const b = []; do { let x = n & 0x7f; n >>>= 7; if (n) x |= 0x80; b.push(x); } while (n); return Buffer.from(b); };
const mcStr = s => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([varint(b.length), b]); };
const mcPacket = (id, ...parts) => { const body = Buffer.concat([varint(id), ...parts]); return Buffer.concat([varint(body.length), body]); };
function readVarint(buf, off) { let r = 0, s = 0, b; do { if (off >= buf.length) return null; b = buf[off++]; r |= (b & 0x7f) << s; s += 7; if (s > 35) return null; } while (b & 0x80); return [r, off]; }
const flatText = d => typeof d === 'string' ? d : d ? (d.text || '') + (d.extra || []).map(flatText).join('') : '';
function mcPing(host, port, timeout = 4500) {
  return new Promise(resolve => {
    let done = false, buf = Buffer.alloc(0); const t0 = Date.now(), sock = _net.connect({ host, port });
    const fin = r => { if (done) return; done = true; try { sock.destroy(); } catch {} resolve(r); };
    sock.setTimeout(timeout, () => fin({ online: false, err: 'timeout' })); sock.on('error', e => fin({ online: false, err: e.code || e.message }));
    sock.on('connect', () => { sock.write(Buffer.concat([mcPacket(0, varint(767), mcStr(host), Buffer.from([port >> 8, port & 255]), varint(1)), mcPacket(0)])); });
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]); const l = readVarint(buf, 0); if (!l || buf.length < l[1] + l[0]) return;
      try {
        let o = l[1]; const id = readVarint(buf, o); o = id[1]; const sl = readVarint(buf, o); o = sl[1]; const j = JSON.parse(buf.slice(o, o + sl[0]).toString('utf8'));
        fin({ online: true, ms: Date.now() - t0, version: (j.version && j.version.name) || '', protocol: (j.version && j.version.protocol) || 767, players: { online: (j.players && j.players.online) || 0, max: (j.players && j.players.max) || 0, sample: ((j.players && j.players.sample) || []).map(p => p.name) }, motd: flatText(j.description).replace(/§./g, '').replace(/\s+/g, ' ').trim(), favicon: j.favicon || '' });
      } catch { fin({ online: false, err: 'bad response' }); }
    });
  });
}
// Online-mode servers answer a login attempt with an Encryption Request (they need a real Microsoft account); offline-mode servers just accept.
function mcProbe(host, port, protocol, vhost, timeout = 4500) {
  return new Promise(resolve => {
    let done = false, buf = Buffer.alloc(0); const sock = _net.connect({ host, port });
    const fin = r => { if (done) return; done = true; try { sock.destroy(); } catch {} resolve(r); };
    sock.setTimeout(timeout, () => fin('unknown')); sock.on('error', () => fin('unknown'));
    sock.on('connect', () => {
      sock.write(mcPacket(0, varint(protocol), mcStr(vhost || host), Buffer.from([port >> 8, port & 255]), varint(2)));
      const name = mcStr('OCProbe'); sock.write(mcPacket(0, protocol >= 764 ? Buffer.concat([name, Buffer.alloc(16)]) : protocol >= 761 ? Buffer.concat([name, Buffer.from([0])]) : protocol >= 759 ? Buffer.concat([name, Buffer.from([0, 0])]) : name));
    });
    sock.on('data', d => { buf = Buffer.concat([buf, d]); const l = readVarint(buf, 0); if (!l || buf.length < l[1] + l[0]) return; const id = readVarint(buf, l[1]); fin(!id ? 'unknown' : id[0] === 1 ? 'online' : (id[0] === 2 || id[0] === 3) ? 'offline' : 'unknown'); });
  });
}
const modeCache = new Map();
async function serverStatus({ host, port }) {
  host = String(host || '').trim(); let h = host, p = port || 25565;
  if (!port && host && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) { try { const r = await Promise.race([_dns.resolveSrv('_minecraft._tcp.' + host), new Promise((_, rej) => setTimeout(() => rej(new Error('t')), 1500))]); if (r && r[0]) { h = r[0].name; p = r[0].port; } } catch {} }
  const st = await mcPing(h, p); if (!st.online) return st;
  const key = host + ':' + (port || ''), c = modeCache.get(key);
  if (c && Date.now() - c.t < 900000) st.mode = c.mode; else { st.mode = await mcProbe(h, p, st.protocol, host); modeCache.set(key, { mode: st.mode, t: Date.now() }); }
  return st;
}
function joinArgs(inst, addr) {
  const [a, b = 0] = String(inst.mc).split('.').map(x => parseInt(x) || 0), i = addr.lastIndexOf(':'), host = i > 0 ? addr.slice(0, i) : addr, port = i > 0 ? addr.slice(i + 1) : '25565';
  return (a > 1 || (a === 1 && b >= 20)) ? ['--quickPlayMultiplayer', addr] : ['--server', host, '--port', port];
}

// ================= UPnP port forwarding =================
function upnpDiscover(timeout = 2500) {
  return new Promise(resolve => {
    let done = false; const s = _dgram.createSocket('udp4'), fin = v => { if (done) return; done = true; try { s.close(); } catch {} resolve(v); };
    s.on('message', m => { const loc = (m.toString().match(/^location:\s*(.+)$/im) || [])[1]; if (loc) fin(loc.trim()); }); s.on('error', () => fin(null));
    const q = st => Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`);
    s.bind(0, () => { for (const st of ['urn:schemas-upnp-org:device:InternetGatewayDevice:1', 'urn:schemas-upnp-org:service:WANIPConnection:1', 'upnp:rootdevice']) { try { s.send(q(st), 1900, '239.255.255.250'); } catch {} } });
    setTimeout(() => fin(null), timeout);
  });
}
async function upnpService(loc) {
  const xml = await (await fetch(loc)).text();
  for (const blk of xml.match(/<service>[\s\S]*?<\/service>/g) || []) { const st = (blk.match(/<serviceType>(.*?)<\/serviceType>/) || [])[1] || ''; if (/WAN(IP|PPP)Connection/.test(st)) { const cu = (blk.match(/<controlURL>(.*?)<\/controlURL>/) || [])[1]; if (cu) return { type: st, url: new URL(cu, loc).href }; } }
  return null;
}
async function upnpSoap(svc, action, args) {
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${svc.type}">${Object.entries(args).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</u:${action}></s:Body></s:Envelope>`;
  const r = await fetch(svc.url, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${svc.type}#${action}"` }, body }), t = await r.text();
  if (!r.ok) throw new Error((t.match(/<errorDescription>(.*?)</) || [])[1] || 'router said HTTP ' + r.status); return t;
}
function localIp() {
  const ips = []; for (const l of Object.values(os.networkInterfaces())) for (const i of l || []) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
  return ips.find(x => /^192\.168\./.test(x)) || ips.find(x => /^10\./.test(x)) || ips.find(x => /^172\.(1[6-9]|2\d|3[01])\./.test(x)) || ips[0] || '127.0.0.1';
}
const isPrivateIp = ip => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.)/.test(ip) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);
async function upnpOpen(port, desc = 'OfflineCraft Minecraft server') {
  const loc = await upnpDiscover(); if (!loc) return { ok: false, err: 'No UPnP router found. Forward the port manually (see the steps below).' };
  try {
    const svc = await upnpService(loc); if (!svc) throw new Error('Router has no port-mapping service');
    await upnpSoap(svc, 'AddPortMapping', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: 'TCP', NewInternalPort: port, NewInternalClient: localIp(), NewEnabled: 1, NewPortMappingDescription: desc, NewLeaseDuration: 0 });
    let ip = ''; try { ip = (await upnpSoap(svc, 'GetExternalIPAddress', {})).match(/<NewExternalIPAddress>(.*?)</)[1]; } catch {}
    return { ok: true, ip, cgnat: !!ip && isPrivateIp(ip), svc };
  } catch (e) { return { ok: false, err: 'Router refused: ' + e.message }; }
}
async function upnpClose(svc, port) { try { await upnpSoap(svc, 'DeletePortMapping', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: 'TCP' }); } catch {} }
async function publicIp() { try { return (await (await fetch('https://api.ipify.org')).text()).trim(); } catch { return ''; } }

// ================= hosting your own server =================
const hostDir = id => P('servers', id), hosted = new Map();
const hostMeta = id => { const m = readJson(path.join(hostDir(id), 'server.json'), null); if (m) m.id = id; return m; };
const saveHostMeta = m => writeJson(path.join(hostDir(m.id), 'server.json'), m);
const hostPort = m => parseInt((m.props || {})['server-port']) || 25565;
function hostPublic(id) { const r = hosted.get(id); return r ? { id, state: r.state, players: [...r.players], started: r.started, upnp: r.upnp ? { ok: r.upnp.ok, ip: r.upnp.ip, err: r.upnp.err, cgnat: r.upnp.cgnat } : null, err: r.err || '' } : { id, state: 'stopped', players: [], started: 0, upnp: null, err: '' }; }
const emitHost = id => send('hoststate', hostPublic(id));
const hostQ = new Map(); let hostQT = null;
function hostLogLine(id, line) { const r = hosted.get(id); if (!r) return; r.lines.push(line); if (r.lines.length > 2500) r.lines.shift(); (hostQ.get(id) || hostQ.set(id, []).get(id)).push(line); if (!hostQT) hostQT = setTimeout(() => { hostQT = null; for (const [i, ls] of hostQ) send('hostlog', { id: i, lines: ls }); hostQ.clear(); }, 80); }
function writeProps(m) {
  const f = path.join(hostDir(m.id), 'server.properties'); let cur = {}; const order = [];
  try { for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) { const k = l.indexOf('='); if (!l.startsWith('#') && k > 0) { cur[l.slice(0, k)] = l.slice(k + 1); order.push(l.slice(0, k)); } } } catch {}
  for (const [k, v] of Object.entries(m.props || {})) { if (!/^[a-z0-9.-]+$/.test(k)) continue; if (!(k in cur)) order.push(k); cur[k] = String(v).replace(/[\r\n]/g, ' '); }
  fs.writeFileSync(f, '#Generated by OfflineCraft\n' + order.map(k => `${k}=${cur[k]}`).join('\n') + '\n');
}
async function hostJarUrl(m) {
  let url;
  if (m.type === 'paper') { const b = (await getJson(`https://api.papermc.io/v2/projects/paper/versions/${m.mc}/builds`)).builds.pop(); if (!b) throw new Error('No Paper build for ' + m.mc); url = `https://api.papermc.io/v2/projects/paper/versions/${m.mc}/builds/${b.build}/downloads/${b.downloads.application.name}`; }
  else if (m.type === 'fabric') { const lv = ((await getJson(`https://meta.fabricmc.net/v2/versions/loader/${m.mc}`)).find(x => x.loader.stable) || {}).loader, iv = (await getJson('https://meta.fabricmc.net/v2/versions/installer')).find(x => x.stable); if (!lv || !iv) throw new Error('No Fabric server for ' + m.mc); url = `https://meta.fabricmc.net/v2/versions/loader/${m.mc}/${lv.version}/${iv.version}/server/jar`; }
  else { if (!(await ensureVanillaJson(m.mc))) throw new Error('Unknown Minecraft version ' + m.mc); const sv = (readJson(vjsonPath(m.mc), {}).downloads || {}).server; if (!sv) throw new Error('Minecraft ' + m.mc + ' has no official server download'); url = sv.url; }
  return url;
}
async function hostInstallJar(m, j) {
  fs.mkdirSync(hostDir(m.id), { recursive: true }); stage(j, 'Finding the server download'); const url = await hostJarUrl(m);
  stage(j, 'Downloading the server'); await download(url, path.join(hostDir(m.id), 'server.jar'), j);
}
async function hostClosePort(rt, port) { if (rt && rt.upnp && rt.upnp.ok && rt.upnp.svc) { await upnpClose(rt.upnp.svc, port); rt.upnp = null; } }
Object.assign(api, {
  serverStatus: a => serverStatus(a),
  async hostVersions(type) {
    if (type === 'paper') return [...(await getJson('https://api.papermc.io/v2/projects/paper')).versions].reverse().filter(v => /^\d+\.\d+(\.\d+)?$/.test(v));
    if (type === 'fabric') return (await getJson('https://meta.fabricmc.net/v2/versions/game')).filter(v => v.stable).map(v => v.version);
    if (!manifest.length) await loadManifest(); return manifest.filter(v => v.type === 'release').map(v => v.id);
  },
  hostList() { try { return fs.readdirSync(P('servers')).map(hostMeta).filter(Boolean).map(m => ({ ...m, runtime: hostPublic(m.id) })).sort((a, b) => (a.created || 0) - (b.created || 0)); } catch { return []; } },
  async hostCreate({ name, type, mc, ramMB }) {
    const base = sanitize(name || 'My server'); let id = base, n = 2; while (exists(hostDir(id))) id = `${base} (${n++})`;
    const m = { id, name: name || 'My server', type: type || 'vanilla', mc, ramMB: ramMB || 2048, javaPath: '', upnp: true, eula: true, props: { motd: (name || 'My server') + ' - hosted with OfflineCraft' }, created: Date.now() / 1000 | 0 };
    fs.mkdirSync(hostDir(id), { recursive: true }); saveHostMeta(m);
    startJob('Setting up ' + m.name, async j => { await hostInstallJar(m, j); send('toast', { msg: m.name + ' is ready. Press Start!' }); }).then(() => send('hostlist', {}));
    return m;
  },
  hostSave(id, patch) {
    const m = hostMeta(id); if (!m) return null; const { props, ...rest } = patch || {};
    for (const k of ['name', 'ramMB', 'javaPath', 'upnp', 'eula', 'jvmArgs']) if (k in rest) m[k] = rest[k];
    if (props) m.props = { ...(m.props || {}), ...props }; saveHostMeta(m); try { if (exists(path.join(hostDir(id), 'server.properties')) || props) writeProps(m); } catch {} return m;
  },
  hostStart(id) {
    const m = hostMeta(id); if (!m) throw new Error('Unknown server'); if (!m.eula) throw new Error('Accept the Minecraft EULA first (Settings tab).');
    const old = hosted.get(id); if (old && old.state !== 'stopped') return ''; const rt = { state: 'starting', lines: [], players: new Set(), started: 0, proc: null, upnp: null, err: '' }; hosted.set(id, rt); emitHost(id);
    return startJob('Starting ' + m.name, async j => {
      try {
        if (fsize(path.join(hostDir(id), 'server.jar')) <= 0) await hostInstallJar(m, j);
        stage(j, 'Preparing Java'); await ensureVanillaJson(m.mc); const java = await pickJava({ javaPath: m.javaPath || '' }, requiredJava(readJson(vjsonPath(m.mc), {})), j);
        fs.writeFileSync(path.join(hostDir(id), 'eula.txt'), 'eula=true\n'); writeProps(m); const ram = m.ramMB || 2048;
        stage(j, 'Starting the server'); const pr = cp.spawn(java, [`-Xmx${ram}M`, `-Xms${Math.min(ram, 1024)}M`, ...String(m.jvmArgs || '').split(/\s+/).filter(Boolean), '-jar', 'server.jar', 'nogui'], { cwd: hostDir(id), windowsHide: true }); rt.proc = pr;
        const feed = d => d.toString().split(/\r?\n/).filter(Boolean).forEach(l => {
          hostLogLine(id, l);
          if (/Done \(.*\)! For help/.test(l)) { rt.state = 'running'; rt.started = Date.now(); emitHost(id); }
          let x; if ((x = l.match(/: (\w{1,16}) joined the game/))) { rt.players.add(x[1]); emitHost(id); } else if ((x = l.match(/: (\w{1,16}) left the game/))) { rt.players.delete(x[1]); emitHost(id); }
        });
        pr.stdout.on('data', feed); pr.stderr.on('data', feed);
        pr.on('close', async code => { hostLogLine(id, `[OfflineCraft] Server stopped (exit code ${code})`); const up = rt; rt.state = 'stopped'; rt.players.clear(); rt.started = 0; await hostClosePort(up, hostPort(m)); emitHost(id); });
        pr.on('error', e => { rt.err = e.message; rt.state = 'stopped'; emitHost(id); });
        if (m.upnp) { rt.upnp = await upnpOpen(hostPort(m)); hostLogLine(id, rt.upnp.ok ? `[OfflineCraft] Port ${hostPort(m)} opened on your router (UPnP). Public IP: ${rt.upnp.ip || 'unknown'}` : '[OfflineCraft] ' + rt.upnp.err); emitHost(id); }
      } catch (e) { rt.state = 'stopped'; rt.err = e.message; emitHost(id); throw e; }
    });
  },
  hostStop(id) { const r = hosted.get(id); if (!r || !r.proc || r.state === 'stopped') return; r.state = 'stopping'; emitHost(id); try { r.proc.stdin.write('stop\n'); } catch {} setTimeout(() => { try { if (r.state !== 'stopped') r.proc.kill(); } catch {} }, 30000); },
  hostCommand(id, c) { const r = hosted.get(id); if (!r || !r.proc || r.state === 'stopped') return false; try { r.proc.stdin.write(String(c).replace(/[\r\n]+/g, ' ') + '\n'); hostLogLine(id, '> ' + c); return true; } catch { return false; } },
  hostLog: id => (hosted.get(id) || { lines: [] }).lines,
  hostDelete(id) { const r = hosted.get(id); if (r && r.proc && r.state !== 'stopped') { try { r.proc.kill(); } catch {} } hosted.delete(id); fs.rmSync(hostDir(id), { recursive: true, force: true }); },
  hostOpenFolder(id) { fs.mkdirSync(hostDir(id), { recursive: true }); shell.openPath(hostDir(id)); },
  async hostNet(id) { const m = hostMeta(id), r = hosted.get(id); return { localIp: localIp(), port: m ? hostPort(m) : 25565, publicIp: (r && r.upnp && r.upnp.ip) || await publicIp(), upnp: hostPublic(id).upnp }; },
  async hostPortMap(id, on) { const m = hostMeta(id); if (!m) return null; const r = hosted.get(id) || (hosted.set(id, { state: 'stopped', lines: [], players: new Set(), started: 0, proc: null, upnp: null, err: '' }), hosted.get(id)); if (on) r.upnp = await upnpOpen(hostPort(m)); else await hostClosePort(r, hostPort(m)); emitHost(id); return hostPublic(id).upnp; },
  async hostTest(id) { const m = hostMeta(id), ip = await publicIp(); if (!ip) return { err: 'Could not find your public IP (no internet?)' }; try { const j = await getJson(`https://api.mcsrvstat.us/3/${ip}:${hostPort(m)}`); return { ip, port: hostPort(m), online: !!j.online }; } catch (e) { return { err: 'The test service did not answer: ' + e.message }; } },
  hostFirewall(id) { const m = hostMeta(id), port = hostPort(m); cp.spawn('powershell', ['-NoProfile', '-Command', `Start-Process netsh -Verb RunAs -ArgumentList 'advfirewall firewall add rule name="OfflineCraft server ${port}" dir=in action=allow protocol=TCP localport=${port}'`], { windowsHide: true, detached: true }).on('error', () => {}); return true; },
});

// ================= public server discovery (BattleMetrics public API, no key needed) =================
const BM = process.env.OC_BM_BASE || 'https://api.battlemetrics.com';
async function bmGet(url) {
  if (!url.startsWith(BM + '/')) throw new Error('Unexpected server list address');
  let r; try { r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) }); } catch { throw new Error('Could not reach the server list (are you online?)'); }
  if (r.status === 429) throw new Error('The server list is busy right now. Try again in a minute.');
  if (!r.ok) { const e = new Error(`The server list answered with an error (${r.status})`); e.status = r.status; throw e; }
  return r.json();
}
Object.assign(api, {
  // One page of online public Minecraft servers. Pass the returned `next` back in to load more.
  async srvDiscover({ search, sort, country, next } = {}) {
    let url;
    if (next) url = String(next);
    else {
      const q = new URLSearchParams({ 'filter[game]': 'minecraft', 'filter[status]': 'online', 'page[size]': '30' });
      if (search && String(search).trim()) q.set('filter[search]', String(search).trim().slice(0, 60));
      if (/^[A-Za-z]{2}$/.test(country || '')) q.set('filter[countries]', country.toUpperCase());
      url = `${BM}/servers?${q}`; if (sort === 'players') url += '&sort=-players'; else if (sort === 'rank') url += '&sort=rank';
    }
    let j; try { j = await bmGet(url); } catch (e) { if (e.status === 400 && /[?&]sort=/.test(url)) j = await bmGet(url.replace(/&sort=[^&]*/, '')); else throw e; }
    const servers = (j.data || []).map(d => { const a = d.attributes || {}, host = String(a.address || a.ip || '').trim(), port = parseInt(a.port) || 0, det = a.details || {};
      return { id: 'bm' + d.id, name: String(a.name || host).slice(0, 80), host, port: port === 25565 ? 0 : port, players: a.players | 0, max: a.maxPlayers | 0, country: /^[A-Za-z]{2}$/.test(a.country || '') ? a.country.toUpperCase() : '', rank: a.rank | 0, version: typeof det.version === 'string' ? det.version.slice(0, 20) : '' };
    }).filter(x => x.host && /^[\w.\-:]+$/.test(x.host) && !isPrivateHost(x.host));
    return { servers, next: (j.links && j.links.next) || '' };
  },
});
function isPrivateHost(h) { return /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1)/.test(h); }

app.on('before-quit', () => { for (const [, r] of hosted) if (r.proc && r.state !== 'stopped') { try { r.proc.stdin.write('stop\n'); } catch {} } });

const features = require('./features.js').install({ api, S: () => settings, P, getInst, saveInst, instDir, gameDir, contentDir, startJob, stage, send, LOG, readJson, writeJson, exists, fsize, sanitize, pushState, running, MR, fetchRetry, primaryFile, download, runPrepare, listLoaderVersions, ensureVanillaJson, rustVersions, RUST, updateMods, dialog, shell, clipboard, nativeImage, getWin: () => win, pathToFileURL, instances: () => instances });
features.restoreHolds();
const features2 = require('./features2.js').install({ api, S: () => settings, P, ROOT, getInst, saveInst, instDir, gameDir, startJob, stage, send, LOG, readJson, writeJson, exists, fsize, sanitize, pushState, running, makeInstance, runPrepare, listLoaderVersions, dialog, shell, app, getWin: () => win, decTok, ensureMsToken, instances: () => instances, pathToFileURL });
module.exports = { _srv: { mcPing, mcProbe, serverStatus, upnpService, upnpSoap, joinArgs, cacheMsSkins, varint, mcPacket, mcStr },  _skins: { applySkinPack, savePng, packFormat }, _ms: { msChain, msTokenRequest, ensureMsToken, encTok, decTok }, _getSettings: () => settings, rulesOk, mergedVersion, collectLibs, buildLaunch, offlineUuid, mavenPath, _setSettings: s => { settings = s; } };
