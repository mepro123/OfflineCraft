'use strict';
// OfflineCraft extra features: crash helper, world backups, safe mode, update everything / switch version
// (with rollback), .mrpack export, worlds + screenshots, Horizon (Rust) updates.
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const AdmZip = require('adm-zip');

// =====================================================================================
// Crash analysis (pure function, easy to test)
// =====================================================================================
function analyzeCrash({ text = '', loader = 'vanilla', ramMB = 0, code = 1 } = {}) {
  const A = (id, label, primary) => ({ id, label, primary: !!primary });
  const mods = new Set(), t = String(text);
  const first = re => { const m = t.match(re); return m || null; };
  let m;

  if ((m = first(/class file version (\d+)\.\d+[^\n]*?(?:recognizes|only recognizes)[^\n]*?up to (\d+)\.\d+/i)) || (m = first(/UnsupportedClassVersionError[^\n]*?(\d+)\.\d+/)) ) {
    const need = Math.max(8, (+m[1] || 52) - 44);
    return { id: 'java-version', title: 'This needs a newer Java', detail: `The game or one of its mods needs Java ${need} or newer, but an older Java was used.`, actions: [A('autojava', 'Pick the right Java automatically', true), A('console', 'Open the console')], mods: [] };
  }
  if (first(/Unsupported major\.minor version (\d+)\.\d+/)) {
    const need = Math.max(8, +first(/Unsupported major\.minor version (\d+)/)[1] - 44);
    return { id: 'java-version', title: 'This needs a newer Java', detail: `A mod needs Java ${need} or newer.`, actions: [A('autojava', 'Pick the right Java automatically', true), A('console', 'Open the console')], mods: [] };
  }
  if (first(/Could not reserve enough space|Invalid maximum heap size|There is insufficient memory for the Java Runtime|Error occurred during initialization of VM[\s\S]{0,200}(?:heap|memory)/i)) {
    return { id: 'ram-too-high', title: 'Not enough free memory to start', detail: 'The game asked for more memory than your PC could give it. Lowering the memory setting usually fixes this. Close other programs too.', actions: [A('lessram', 'Lower the memory', true), A('console', 'Open the console')], mods: [] };
  }
  if (first(/java\.lang\.OutOfMemoryError|GC overhead limit exceeded|Java heap space/)) {
    return { id: 'out-of-memory', title: 'The game ran out of memory', detail: `Minecraft used all of its ${ramMB || 'allowed'} MB. Giving it more memory (or removing heavy mods and shaders) fixes this.`, actions: [A('moreram', 'Give it more memory', true), A('safe', 'Try safe mode (no mods)')], mods: [] };
  }
  if (first(/Unrecognized (?:VM )?option|Unrecognized VM option|Could not create the Java Virtual Machine/i)) {
    return { id: 'jvm-args', title: 'A Java option is not supported', detail: 'One of the extra Java arguments is not understood by this Java version, so the game could not start.', actions: [A('clearjvm', 'Remove the extra Java arguments', true), A('autojava', 'Pick the right Java automatically')], mods: [] };
  }
  if (first(/Could not find or load main class|Error: Unable to initialize main class|java\.lang\.ClassNotFoundException: net\.minecraft\.client\.main/)) {
    return { id: 'corrupt', title: 'Some game files are missing or damaged', detail: 'A required file could not be found. Re-checking the files normally fixes this.', actions: [A('repair', 'Verify and repair the files', true), A('console', 'Open the console')], mods: [] };
  }
  if (first(/Failed to load level|Exception reading [^\n]*level\.dat|Failed to read [^\n]*\.mca|Unable to read the world|Level read error/i)) {
    return { id: 'world', title: 'A world could not be loaded', detail: 'A world file looks damaged. You can restore it from an automatic backup.', actions: [A('backups', 'Open the backups', true), A('safe', 'Try safe mode (no mods)')], mods: [] };
  }
  // dependency problems (Fabric / Quilt / Forge)
  const dep = [];
  for (const x of t.matchAll(/Mod '([^']+)'[^\n]*?requires[^\n]*?'([^']+)'[^\n]*/g)) { dep.push(`${x[1]} needs ${x[2]}`); mods.add(x[1]); mods.add(x[2]); }
  for (const x of t.matchAll(/Mod ID: '([^']+)', Requested by: '([^']+)'/g)) { dep.push(`${x[2]} needs ${x[1]}`); mods.add(x[2]); mods.add(x[1]); }
  if (dep.length || first(/Incompatible mod set|Missing or unsupported mandatory dependencies|Mod resolution failed|Some of your mods are incompatible/i)) {
    const list = [...new Set(dep)].slice(0, 6);
    return { id: 'mod-deps', title: 'Some mods need other mods or a different version', detail: (list.length ? 'Problems found:\n' + list.map(x => '• ' + x).join('\n') + '\n\n' : '') + 'Updating everything usually fixes mismatched versions. Safe mode starts the game without any mods so you can check.', actions: [A('updateall', 'Update everything', true), A('safe', 'Try safe mode (no mods)'), A('undo', 'Undo the last update')], mods: [...mods].slice(0, 12) };
  }
  if (first(/Found duplicate mods|Duplicate mods? (?:found|detected)|DuplicateModsFoundException/i)) {
    return { id: 'duplicate', title: 'The same mod is installed twice', detail: 'Two copies (or two versions) of one mod are in the mods folder. Remove one of them.', actions: [A('mods', 'Open the mods list', true), A('safe', 'Try safe mode (no mods)')], mods: [] };
  }
  if (first(/Mixin apply failed|MixinApplyError|InvalidMixinException|Mixin transformation of [^\n]* failed|MixinTransformerError/)) {
    for (const x of t.matchAll(/([\w-]+)\.mixins?\.json/g)) if (!/^(?:minecraft|mixins?)$/.test(x[1])) mods.add(x[1]);
    return { id: 'mixin', title: 'Two mods conflict with each other', detail: 'A mod tried to change the game in a way another mod (or this game version) does not allow.' + (mods.size ? '\nMods involved: ' + [...mods].slice(0, 6).join(', ') : ''), actions: [A('updateall', 'Update everything', true), A('safe', 'Try safe mode (no mods)'), A('mods', 'Open the mods list')], mods: [...mods].slice(0, 12) };
  }
  if (first(/NoSuchMethodError|NoSuchFieldError|NoClassDefFoundError|AbstractMethodError|IncompatibleClassChangeError/)) {
    return { id: 'mod-mismatch', title: 'A mod does not match this game version', detail: 'A mod was built for a different Minecraft or loader version. Updating the mods normally fixes it.', actions: [A('updateall', 'Update everything', true), A('safe', 'Try safe mode (no mods)'), A('undo', 'Undo the last update')], mods: [] };
  }
  if (first(/GLFW error 65542|WGL: The driver does not appear to support OpenGL|Pixel format not accelerated|GLFW error 65543|Failed to create window|OpenGL (?:version|context)[^\n]*(?:not supported|unsupported)/i)) {
    return { id: 'opengl', title: 'Your graphics driver is not supported', detail: 'The game could not start OpenGL. Update your graphics driver (NVIDIA, AMD or Intel). On a laptop, make sure Java uses the dedicated graphics card.', actions: [A('console', 'Open the console', true), A('safe', 'Try safe mode (no mods)')], mods: [] };
  }
  if (first(/EXCEPTION_ACCESS_VIOLATION|SIGSEGV|A fatal error has been detected by the Java Runtime|hs_err_pid/)) {
    return { id: 'native-crash', title: 'Java or the graphics driver crashed', detail: 'This is usually a graphics driver problem, or a mod or shader that does not agree with it. Update your graphics driver and try safe mode.', actions: [A('safe', 'Try safe mode (no mods)', true), A('console', 'Open the console')], mods: [] };
  }
  if (first(/UnknownHostException|Connection timed out|SSLHandshakeException|Failed to download/i) && code !== 0) {
    return { id: 'network', title: 'A file could not be downloaded', detail: 'Something the game needed could not be downloaded. Check your internet connection, then verify the files.', actions: [A('repair', 'Verify and repair the files', true)], mods: [] };
  }
  if (loader === 'rust') {
    return { id: 'rust', title: 'Horizon (Rust) stopped unexpectedly', detail: 'Horizon is still under development. Updating to the newest build, or preparing it again, often fixes crashes.', actions: [A('updateall', 'Update Horizon', true), A('repair', 'Prepare it again'), A('console', 'Open the console')], mods: [] };
  }
  const err = (t.split(/\r?\n/).reverse().find(l => /Exception|Error|FATAL/.test(l)) || '').trim().slice(0, 200);
  return { id: 'unknown', title: 'The game closed unexpectedly', detail: (err ? 'Last error: ' + err + '\n\n' : '') + `It exited with code ${code}. Safe mode (no mods) tells you whether a mod is the cause.`, actions: [A('safe', 'Try safe mode (no mods)', true), A('console', 'Open the console'), A('copy', 'Copy a crash report')], mods: [] };
}

// =====================================================================================
const stamp = (d = new Date()) => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
const stampToMs = s => { const m = /^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)$/.exec(s); return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : 0; };
async function dirSize(dir, cap = 30000) {   // total bytes, stops counting after `cap` files
  let total = 0, n = 0; const stack = [dir];
  while (stack.length) {
    const d = stack.pop(); let ents; try { ents = await fs.promises.readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) { const p = path.join(d, e.name); if (e.isDirectory()) stack.push(p); else { try { total += (await fs.promises.stat(p)).size; } catch {} if (++n >= cap) return total; } }
  }
  return total;
}
const newestMtime = dir => { let best = 0; try { for (const f of ['level.dat', 'level.dat_old']) { const m = fs.statSync(path.join(dir, f)).mtimeMs; if (m > best) best = m; } best = best || fs.statSync(dir).mtimeMs; } catch {} return best; };
const BKEEP = 5, BIG_WORLD = 3 * 1024 ** 3;

function install(ctx) {
  const { api, S, P, getInst, saveInst, instDir, gameDir, contentDir, startJob, stage, send, LOG, readJson, writeJson, exists, fsize, sanitize, pushState, running, MR, fetchRetry, primaryFile, download, runPrepare, listLoaderVersions, ensureVanillaJson, rustVersions, RUST, updateMods, dialog, shell, clipboard, nativeImage, getWin, pathToFileURL, instances } = ctx;
  const sha = (f, alg) => new Promise((res, rej) => { const h = crypto.createHash(alg); fs.createReadStream(f).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
  const must = id => { const i = getInst(id); if (!i) throw new Error('Unknown instance'); return i; };
  const saves = i => path.join(gameDir(i), 'saves');
  const jobResult = p => p.then(e => ({ err: e || '' }));

  // ---------------------------------------------------------------- backups
  const bdir = i => P('backups', i.id);
  const parseBackup = f => { const m = /^(.*)__(\d{8}-\d{6})__([a-z]+)\.zip$/.exec(f); return m ? { world: m[1], ts: stampToMs(m[2]), reason: m[3] } : null; };
  function listBackups(i) {
    let files = []; try { files = fs.readdirSync(bdir(i)); } catch {}
    return files.map(f => { const p = parseBackup(f); if (!p) return null; let m = 0; try { m = fs.statSync(path.join(bdir(i), f)).mtimeMs; } catch {} return { file: f, ...p, size: fsize(path.join(bdir(i), f)), mtime: m }; }).filter(Boolean).sort((a, b) => b.ts - a.ts);
  }
  function prune(i, world) {
    const keep = Math.max(1, +S().backupKeep || BKEEP), mine = listBackups(i).filter(b => b.world === sanitize(world));
    for (const b of mine.slice(keep)) fs.rmSync(path.join(bdir(i), b.file), { force: true });
  }
  async function backupWorld(i, world, reason) {
    const src = path.join(saves(i), world); if (!exists(src)) throw new Error('World not found');
    if (await dirSize(src, 200000) > BIG_WORLD) { LOG(`backup: ${world} is over 3 GB, skipped`); return null; }
    fs.mkdirSync(bdir(i), { recursive: true });
    const out = path.join(bdir(i), `${sanitize(world)}__${stamp()}__${reason}.zip`), z = new AdmZip();
    await z.addLocalFolderPromise(src, { zipPath: world, filter: p => !/(^|[\\/])session\.lock$/.test(p) });
    await z.writeZipPromise(out); prune(i, world); return out;
  }
  async function autoBackup(i, j, reason = 'auto') {
    if (S().autoBackup === false) return 0; let worlds = []; try { worlds = fs.readdirSync(saves(i), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch {}
    let n = 0;
    for (const w of worlds) {
      const last = Math.max(0, ...listBackups(i).filter(b => b.world === sanitize(w)).map(b => b.mtime)), changed = newestMtime(path.join(saves(i), w));
      if (last && changed <= last) continue;
      if (j) j.label = 'Backing up ' + w; try { if (await backupWorld(i, w, reason)) n++; } catch (e) { LOG('backup ' + w + ': ' + e.message); }
    }
    return n;
  }
  Object.assign(api, {
    backupList: id => listBackups(must(id)),
    backupNow(id, world) { const i = must(id); return jobResult(startJob('Backing up ' + (world || i.name), async j => { if (world) { stage(j, 'Backing up ' + world); await backupWorld(i, world, 'manual'); } else { let w = []; try { w = fs.readdirSync(saves(i), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch {} if (!w.length) throw new Error('There are no worlds to back up yet'); for (const x of w) { stage(j, 'Backing up ' + x); await backupWorld(i, x, 'manual'); } } send('toast', { msg: 'Backup done' }); })); },
    backupRestore(id, file) {
      const i = must(id), b = parseBackup(path.basename(file)); if (!b) throw new Error('Not a backup file'); const zf = path.join(bdir(i), path.basename(file)); if (!exists(zf)) throw new Error('Backup file is missing');
      if (running.get(id) && running.get(id).alive) throw new Error('Close the game first');
      return jobResult(startJob('Restoring ' + b.world, async j => {
        stage(j, 'Restoring ' + b.world); const z = new AdmZip(zf);
        for (const e of z.getEntries()) { const n = e.entryName.replace(/\\/g, '/'); if (n.includes('..') || n.startsWith('/') || /^[A-Za-z]:/.test(n)) throw new Error('Backup contains unsafe paths'); }
        fs.mkdirSync(saves(i), { recursive: true }); const target = path.join(saves(i), b.world);
        if (exists(target)) fs.renameSync(target, `${target} (before restore ${stamp()})`);
        await new Promise((res, rej) => z.extractAllToAsync(saves(i), true, false, e => e ? rej(e) : res()));
        send('toast', { msg: `${b.world} restored` });
      }));
    },
    backupDelete(id, file) { const i = must(id); if (!parseBackup(path.basename(file))) return false; fs.rmSync(path.join(bdir(i), path.basename(file)), { force: true }); return true; },
    backupFolder(id) { const i = must(id); fs.mkdirSync(bdir(i), { recursive: true }); shell.openPath(bdir(i)); },
  });

  // ---------------------------------------------------------------- worlds + screenshots
  Object.assign(api, {
    worldSizes: async id => { const i = must(id), out = {}; let w = []; try { w = fs.readdirSync(saves(i), { withFileTypes: true }).filter(e => e.isDirectory()); } catch {} for (const e of w) out[e.name] = await dirSize(path.join(saves(i), e.name)); return out; },
    shotList(id) {
      const i = must(id), dir = path.join(gameDir(i), 'screenshots'); let f = []; try { f = fs.readdirSync(dir); } catch {}
      return f.filter(x => /\.(png|jpe?g)$/i.test(x)).map(x => { const p = path.join(dir, x); let st; try { st = fs.statSync(p); } catch { return null; } return { file: x, url: pathToFileURL(p).href, size: st.size, mtime: st.mtimeMs }; }).filter(Boolean).sort((a, b) => b.mtime - a.mtime).slice(0, 400);
    },
    shotDelete(id, file) { const i = must(id); fs.rmSync(path.join(gameDir(i), 'screenshots', path.basename(file)), { force: true }); return true; },
    shotCopy(id, file) { const i = must(id), img = nativeImage.createFromPath(path.join(gameDir(i), 'screenshots', path.basename(file))); if (img.isEmpty()) return false; clipboard.writeImage(img); return true; },
    shotShow(id, file) { const i = must(id); shell.showItemInFolder(path.join(gameDir(i), 'screenshots', path.basename(file))); },
    shotFolder(id) { const i = must(id), d = path.join(gameDir(i), 'screenshots'); fs.mkdirSync(d, { recursive: true }); shell.openPath(d); },
  });

  // ---------------------------------------------------------------- safe mode (no mods for one launch)
  const holdDir = i => path.join(instDir(i), 'safe-hold');
  function holdMods(i) {
    const dir = contentDir(i, 'mod'); let files = []; try { files = fs.readdirSync(dir); } catch {} if (!files.length || exists(holdDir(i))) return 0;
    fs.mkdirSync(holdDir(i), { recursive: true }); for (const f of files) fs.renameSync(path.join(dir, f), path.join(holdDir(i), f)); return files.length;
  }
  function releaseMods(i) {
    if (!exists(holdDir(i))) return 0; const dir = contentDir(i, 'mod'); fs.mkdirSync(dir, { recursive: true }); let n = 0;
    for (const f of fs.readdirSync(holdDir(i))) { try { const dest = path.join(dir, f); if (!exists(dest)) { fs.renameSync(path.join(holdDir(i), f), dest); n++; } } catch (e) { LOG('safe mode restore ' + f + ': ' + e.message); } }
    try { fs.rmdirSync(holdDir(i)); } catch {} return n;
  }
  const restoreHolds = () => { for (const i of instances()) { try { if (exists(holdDir(i))) { const n = releaseMods(i); LOG(`safe mode: put ${n} mods back for ${i.name}`); } } catch {} } };

  // ---------------------------------------------------------------- snapshots (for undo)
  const sdir = i => P('snapshots', i.id);
  function snapshot(i, why) {
    let dest = path.join(sdir(i), stamp()), n = 1; while (exists(dest)) dest = path.join(sdir(i), stamp() + '-' + (n++)); fs.mkdirSync(dest, { recursive: true });
    const mods = contentDir(i, 'mod'); if (exists(mods)) fs.cpSync(mods, path.join(dest, 'mods'), { recursive: true });
    const cj = path.join(instDir(i), 'content.json'); if (exists(cj)) fs.copyFileSync(cj, path.join(dest, 'content.json'));
    writeJson(path.join(dest, 'meta.json'), { why, mc: i.mc, loaderVer: i.loaderVer, versionId: i.versionId, loader: i.loader, at: Date.now() });
    const all = fs.readdirSync(sdir(i)).sort(); for (const old of all.slice(0, Math.max(0, all.length - 2))) fs.rmSync(path.join(sdir(i), old), { recursive: true, force: true });
    return dest;
  }
  const latestSnapshot = i => { try { const all = fs.readdirSync(sdir(i)).sort(); return all.length ? path.join(sdir(i), all[all.length - 1]) : null; } catch { return null; } };
  function restoreSnapshot(i, dir) {
    const meta = readJson(path.join(dir, 'meta.json')); const mods = contentDir(i, 'mod');
    fs.rmSync(mods, { recursive: true, force: true }); if (exists(path.join(dir, 'mods'))) fs.cpSync(path.join(dir, 'mods'), mods, { recursive: true }); else fs.mkdirSync(mods, { recursive: true });
    if (exists(path.join(dir, 'content.json'))) fs.copyFileSync(path.join(dir, 'content.json'), path.join(instDir(i), 'content.json'));
    Object.assign(i, { mc: meta.mc, loaderVer: meta.loaderVer, versionId: meta.versionId, ready: false }); saveInst(i); return meta;
  }

  // ---------------------------------------------------------------- move every mod to a target Minecraft version
  async function syncMods(i, mc, j, { disableUnmatched }) {
    const dir = contentDir(i, 'mod'); let files = []; try { files = fs.readdirSync(dir).filter(f => /\.jar(\.disabled)?$/.test(f)); } catch {}
    const out = { updated: 0, disabled: [], total: files.length }; if (!files.length) return out;
    stage(j, 'Checking mods for ' + mc, files.length); const hashes = {};
    for (const f of files) hashes[await sha(path.join(dir, f), 'sha1')] = f;
    const body = { hashes: Object.keys(hashes), algorithm: 'sha1', game_versions: [mc] }; if (i.loader !== 'vanilla') body.loaders = [i.loader];
    const res = await (await fetchRetry(`${MR}/version_files/update`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    const rp = path.join(instDir(i), 'content.json');
    for (const [h, f] of Object.entries(hashes)) {
      if (j.cancel) throw new Error('cancelled'); const off = f.endsWith('.disabled'), base = off ? f.slice(0, -9) : f, v = res[h], pf = v && primaryFile(v);
      if (pf && pf.hashes && pf.hashes.sha1 !== h) {
        j.label = 'Updating ' + base; const nf = sanitize(pf.filename); await download(pf.url, path.join(dir, nf + (off ? '.disabled' : '')), j);
        const r = readJson(rp), prev = r[base] || {}; delete r[base]; r[nf] = { ...prev, version: v.version_number, sha1: pf.hashes.sha1 }; writeJson(rp, r);
        if (nf + (off ? '.disabled' : '') !== f) fs.rmSync(path.join(dir, f), { force: true }); out.updated++;
      } else if (!pf && disableUnmatched && !off) { fs.renameSync(path.join(dir, f), path.join(dir, f + '.disabled')); out.disabled.push(base); }
      j.done++;
    }
    return out;
  }
  async function latestLoader(i, mc) { const v = await listLoaderVersions(i.loader, mc); return (v.find(x => x.stable) || v[0] || {}).version || ''; }
  const NAMES = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge', rust: 'Rust', vanilla: 'Vanilla' };

  // Update loader + mods (+ Horizon) of one instance. Always backs up worlds and takes a snapshot first.
  async function updateEverything(i, j) {
    if (running.get(i.id) && running.get(i.id).alive) throw new Error('Close the game first');
    stage(j, 'Backing up worlds'); await autoBackup(i, j, 'update');
    stage(j, 'Saving a restore point'); snapshot(i, 'update'); const summary = [];
    try {
      if (i.loader === 'rust') {
        stage(j, 'Checking for a new Horizon build'); const v = await rustVersions(RUST.mc), latest = v[0] && v[0].version;
        if (!latest) throw new Error('Could not reach the Horizon releases'); if (latest !== i.loaderVer) { i.loaderVer = latest; i.versionId = ''; i.ready = false; summary.push('Horizon ' + latest); } else summary.push('Horizon is already up to date');
      } else {
        if (i.loader !== 'vanilla') { stage(j, 'Checking the ' + NAMES[i.loader] + ' version'); const lv = await latestLoader(i, i.mc); if (lv && lv !== i.loaderVer) { i.loaderVer = lv; i.versionId = ''; i.ready = false; summary.push(`${NAMES[i.loader]} ${lv}`); } }
        const r = await syncMods(i, i.mc, j, { disableUnmatched: false }); if (r.updated) summary.push(`${r.updated} mod${r.updated > 1 ? 's' : ''}`);
      }
      saveInst(i); if (!i.ready) await runPrepare(i, j); i.lastUpdate = { at: Date.now(), kind: 'update' }; saveInst(i); pushState();
      send('toast', { msg: summary.length ? 'Updated: ' + summary.join(', ') : 'Everything is already up to date' });
    } catch (e) { try { const s = latestSnapshot(i); if (s) { restoreSnapshot(i, s); fs.rmSync(s, { recursive: true, force: true }); } } catch (e2) { LOG('rollback: ' + e2.message); } pushState(); throw e; }
  }
  Object.assign(api, {
    updateEverything(id) { const i = must(id); return jobResult(startJob('Updating ' + i.name, j => updateEverything(i, j))); },
    hasUndo(id) { const i = getInst(id); const s = i && latestSnapshot(i); return s ? readJson(path.join(s, 'meta.json')) : null; },
    undoUpdate(id) {
      const i = must(id), s = latestSnapshot(i); if (!s) throw new Error('Nothing to undo'); if (running.get(id) && running.get(id).alive) throw new Error('Close the game first');
      return jobResult(startJob('Undoing the last update', async j => { stage(j, 'Restoring mods'); restoreSnapshot(i, s); fs.rmSync(s, { recursive: true, force: true }); await runPrepare(i, j); pushState(); send('toast', { msg: 'Went back to the version before the update' }); }));
    },
    async changeVersion(id, newMc) {
      const i = must(id); newMc = String(newMc || '').trim(); if (!newMc) throw new Error('Pick a version first'); if (newMc === i.mc) throw new Error('It is already on ' + newMc);
      if (i.loader === 'rust') throw new Error(`Horizon only supports Minecraft ${RUST.mc}`); if (running.get(id) && running.get(id).alive) throw new Error('Close the game first');
      return jobResult(startJob(`Switching ${i.name} to ${newMc}`, async j => {
        const old = { mc: i.mc, loaderVer: i.loaderVer, versionId: i.versionId };
        stage(j, 'Checking ' + newMc); await ensureVanillaJson(newMc);
        let lv = ''; if (i.loader !== 'vanilla') { lv = await latestLoader(i, newMc); if (!lv) throw new Error(`${NAMES[i.loader]} has no build for Minecraft ${newMc} yet`); }
        stage(j, 'Backing up worlds'); await autoBackup(i, j, 'version'); stage(j, 'Saving a restore point'); snapshot(i, 'version');
        try {
          i.mc = newMc; i.loaderVer = lv; i.versionId = ''; i.ready = false; saveInst(i);
          let r = { updated: 0, disabled: [] }; if (i.loader !== 'vanilla') r = await syncMods(i, newMc, j, { disableUnmatched: true });
          await runPrepare(i, j); i.lastUpdate = { at: Date.now(), kind: 'version', from: old.mc }; saveInst(i); pushState();
          send('toast', { msg: `Now on ${newMc}.${r.updated ? ` ${r.updated} mod${r.updated > 1 ? 's' : ''} updated.` : ''}${r.disabled.length ? ` ${r.disabled.length} mod${r.disabled.length > 1 ? 's' : ''} without a ${newMc} version were turned off.` : ''}` });
          if (r.disabled.length) LOG('switch version: turned off ' + r.disabled.join(', '));
        } catch (e) { try { const s = latestSnapshot(i); if (s) { restoreSnapshot(i, s); fs.rmSync(s, { recursive: true, force: true }); } else Object.assign(i, old, { ready: false }); saveInst(i); } catch (e2) { LOG('rollback: ' + e2.message); } pushState(); throw e; }
      }));
    },
    async rustStatus(id) { const i = must(id); if (i.loader !== 'rust') return null; try { const v = await rustVersions(RUST.mc), latest = v[0] ? v[0].version : ''; return { current: i.loaderVer, latest, outdated: !!latest && latest !== i.loaderVer }; } catch { return { current: i.loaderVer, latest: '', outdated: false }; } },
  });

  // ---------------------------------------------------------------- crash handling
  function crashText(i, r, code) {
    const lines = (r.lines || []).slice(-400); let extra = '';
    try {
      const cr = path.join(gameDir(i), 'crash-reports'); const f = fs.readdirSync(cr).map(n => ({ n, m: fs.statSync(path.join(cr, n)).mtimeMs })).filter(x => x.m >= r.started - 5000).sort((a, b) => b.m - a.m)[0];
      if (f) extra += fs.readFileSync(path.join(cr, f.n), 'utf8').slice(0, 60000);
    } catch {}
    try { const f = fs.readdirSync(gameDir(i)).filter(n => /^hs_err_pid\d+\.log$/.test(n)).map(n => ({ n, m: fs.statSync(path.join(gameDir(i), n)).mtimeMs })).filter(x => x.m >= r.started - 5000).sort((a, b) => b.m - a.m)[0]; if (f) extra += '\n' + fs.readFileSync(path.join(gameDir(i), f.n), 'utf8').slice(0, 8000); } catch {}
    return lines.join('\n') + '\n' + extra;
  }
  function onExit(i, r, code, dur) {
    if (code === 0 || r.stopped) return;
    const text = crashText(i, r, code), res = analyzeCrash({ text, loader: i.loader, ramMB: i.ramMB || S().ramMB, code });
    if (res.actions.some(a => a.id === 'undo') && !(i.lastUpdate && Date.now() - i.lastUpdate.at < 36e5 * 48 && latestSnapshot(i))) res.actions = res.actions.filter(a => a.id !== 'undo');
    if (['updateall'].includes(res.actions[0] && res.actions[0].id) && i.loader === 'vanilla') res.actions = res.actions.filter(a => a.id !== 'updateall');
    if (i.loader === 'vanilla' || i.loader === 'rust') res.actions = res.actions.filter(a => a.id !== 'safe' && a.id !== 'mods');
    LOG(`crash analysis for ${i.name}: ${res.id}`);
    send('crash', { ...res, diag: res.id, id: i.id, name: i.name, code, dur, report: [`OfflineCraft crash report`, `${i.name} · Minecraft ${i.mc} · ${i.loader} ${i.loaderVer || ''}`, `Exit code ${code} after ${dur}s`, `Diagnosis: ${res.title}`, '', text.split('\n').slice(-120).join('\n')].join('\n') });
  }
  Object.assign(api, {
    crashFix(id, action) {
      const i = must(id), mem = Math.floor(os.totalmem() / 1048576);
      switch (action) {
        case 'autojava': i.javaPath = ''; saveInst(i); break;
        case 'moreram': { const cur = i.ramMB || S().ramMB || 2048; i.ramMB = Math.max(cur, Math.min(cur + 2048, Math.max(2048, Math.floor(mem * 0.6 / 256) * 256))); saveInst(i); break; }
        case 'lessram': i.ramMB = Math.max(1024, Math.floor(mem * 0.5 / 256) * 256); saveInst(i); break;
        case 'clearjvm': i.jvmArgs = ''; saveInst(i); break;
        case 'repair': i.ready = false; i.versionId = i.loader === 'vanilla' ? '' : i.versionId; saveInst(i); break;
        default: return false;
      }
      pushState(); return true;
    },
    undoAvailable(id) { const i = getInst(id); return !!(i && latestSnapshot(i)); },
  });

  // ---------------------------------------------------------------- export as .mrpack
  Object.assign(api, {
    async exportMrpack(id, { worlds } = {}) {
      const i = must(id); if (i.loader === 'rust') throw new Error('Horizon instances have no Java mods to export');
      const dk = { fabric: 'fabric-loader', quilt: 'quilt-loader', forge: 'forge', neoforge: 'neoforge' }[i.loader]; if (i.loader !== 'vanilla' && !i.loaderVer) throw new Error('Launch the instance once first so its loader version is known');
      const r = await dialog.showSaveDialog(getWin(), { title: 'Export modpack', defaultPath: sanitize(i.name) + '.mrpack', filters: [{ name: 'Modrinth modpack', extensions: ['mrpack'] }] }); if (r.canceled || !r.filePath) return null;
      return jobResult(startJob('Exporting ' + i.name, async j => {
        stage(j, 'Reading files'); const gd = gameDir(i), z = new AdmZip(), files = [], embed = [];
        const groups = [['mods', 'mods'], ['resourcepacks', 'resourcepacks'], ['shaderpacks', 'shaderpacks']], found = [];
        for (const [sub] of groups) { let ents = []; try { ents = fs.readdirSync(path.join(gd, sub), { withFileTypes: true }); } catch {} for (const e of ents) if (e.isFile() && /\.(jar|zip)$/i.test(e.name)) found.push({ sub, name: e.name, full: path.join(gd, sub, e.name) }); }
        stage(j, 'Hashing files', found.length); for (const f of found) { f.sha1 = await sha(f.full, 'sha1'); f.sha512 = await sha(f.full, 'sha512'); f.size = fsize(f.full); j.done++; }
        stage(j, 'Matching files with Modrinth'); const known = {};
        try { for (let k = 0; k < found.length; k += 100) { const chunk = found.slice(k, k + 100), res = await (await fetchRetry(`${MR}/version_files`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hashes: chunk.map(f => f.sha1), algorithm: 'sha1' }) })).json(); Object.assign(known, res); } } catch (e) { LOG('export lookup: ' + e.message); }
        for (const f of found) {
          const v = known[f.sha1], vf = v && (v.files || []).find(x => x.hashes && x.hashes.sha1 === f.sha1);
          if (vf && vf.url) files.push({ path: `${f.sub}/${f.name}`, hashes: { sha1: f.sha1, sha512: f.sha512 }, env: { client: 'required', server: 'required' }, downloads: [vf.url], fileSize: f.size }); else embed.push(f);
        }
        stage(j, 'Writing the pack');
        for (const f of embed) z.addLocalFile(f.full, 'overrides/' + f.sub);
        for (const d of ['config', 'defaultconfigs', 'kubejs', 'scripts']) if (exists(path.join(gd, d))) z.addLocalFolder(path.join(gd, d), 'overrides/' + d);
        for (const f of ['options.txt', 'servers.dat']) if (exists(path.join(gd, f))) z.addLocalFile(path.join(gd, f), 'overrides');
        if (worlds && exists(saves(i))) z.addLocalFolder(saves(i), 'overrides/saves', p => !/session\.lock$/.test(p));
        const deps = { minecraft: i.mc }; if (dk) deps[dk] = i.loaderVer;
        z.addFile('modrinth.index.json', Buffer.from(JSON.stringify({ formatVersion: 1, game: 'minecraft', versionId: '1.0.0', name: i.name, summary: 'Exported from OfflineCraft', files, dependencies: deps }, null, 2)));
        await z.writeZipPromise(r.filePath); send('toast', { msg: `Exported ${i.name}: ${files.length} linked, ${embed.length} included in the file` }); shell.showItemInFolder(r.filePath);
      }));
    },
  });

  return { holdMods, releaseMods, restoreHolds, autoBackup, onExit, analyzeCrash, syncMods };
}

module.exports = { install, analyzeCrash, dirSize, stamp, stampToMs };
