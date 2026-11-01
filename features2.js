'use strict';
// OfflineCraft launcher essentials, part 2: launch hooks (wrapper / pre / post / env / extra args), log sharing, desktop shortcuts,
// importing MultiMC/Prism instances, world import/export/copy, Microsoft capes, copy options, storage manager.
const fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const AdmZip = require('adm-zip');
const { dirSize, stamp } = require('./features.js');

// ---------- pure helpers (tested) ----------
const splitArgs = s => { const out = [], re = /"([^"]*)"|'([^']*)'|(\S+)/g; let m; while ((m = re.exec(String(s || '')))) out.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]); return out; };
const parseEnv = txt => { const o = {}; for (const l of String(txt || '').split(/\r?\n/)) { if (/^\s*#/.test(l)) continue; const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l); if (m) o[m[1]] = m[2]; } return o; };
const parseIni = txt => { const o = {}; for (const l of String(txt || '').split(/\r?\n/)) { const m = /^([^=#\[][^=]*)=(.*)$/.exec(l); if (m) o[m[1].trim()] = m[2].trim(); } return o; };
const safeRel = rel => { const n = String(rel).replace(/\\/g, '/'); return !!n && !n.startsWith('/') && !/^[A-Za-z]:/.test(n) && !n.split('/').includes('..'); };
const MMC_LOADERS = [['net.fabricmc.fabric-loader', 'fabric'], ['org.quiltmc.quilt-loader', 'quilt'], ['net.neoforged', 'neoforge'], ['net.minecraftforge', 'forge']];

function install(ctx) {
  const { api, S, P, ROOT, getInst, saveInst, instDir, gameDir, startJob, stage, send, LOG, readJson, writeJson, exists, fsize, sanitize, pushState, running, makeInstance, runPrepare, listLoaderVersions, dialog, shell, app, getWin, decTok, ensureMsToken, instances, pathToFileURL } = ctx;
  const must = id => { const i = getInst(id); if (!i) throw new Error('Unknown instance'); return i; };
  const jobResult = p => p.then(e => ({ err: e || '' }));
  const uniqueDir = (parent, base) => { let n = sanitize(base) || 'World', d = path.join(parent, n), k = 2; while (exists(d)) d = path.join(parent, `${n} (${k++})`); return d; };

  // ---------------------------------------------------------------- launch hooks
  const hookEnv = i => ({ ...process.env, ...parseEnv(i.envVars), INST_ID: i.id, INST_NAME: i.name, INST_MC_VER: i.mc, INST_LOADER: i.loader, INST_DIR: instDir(i), INST_MC_DIR: gameDir(i) });
  function spawnSpec(i, lp) {
    let cmd = lp.java, args = [...lp.args, ...splitArgs(i.gameArgs)]; const w = splitArgs(i.wrapCmd);
    if (w.length) { args = [...w.slice(1), cmd, ...args]; cmd = w[0]; }
    return { cmd, args, env: hookEnv(i) };
  }
  function runHook(i, line, label, add, extraEnv = {}, timeoutMs = 60000) {
    return new Promise(res => {
      if (!line || !String(line).trim()) return res(0); add(`[launcher] ${label}: ${line}`);
      let pr; try { pr = cp.spawn(String(line), { shell: true, cwd: gameDir(i), env: { ...hookEnv(i), ...extraEnv }, windowsHide: true }); } catch (e) { add(`[launcher] ${label} failed: ${e.message}`); return res(-1); }
      const t = setTimeout(() => { try { pr.kill(); } catch {} add(`[launcher] ${label} took longer than ${timeoutMs / 1000} s and was stopped`); }, timeoutMs);
      const on = d => d.toString().split(/\r?\n/).filter(Boolean).forEach(l => add(`[${label}] ${l}`)); pr.stdout.on('data', on); pr.stderr.on('data', on);
      pr.on('close', c => { clearTimeout(t); res(c === null ? -1 : c); }); pr.on('error', e => { clearTimeout(t); add(`[launcher] ${label} failed: ${e.message}`); res(-1); });
    });
  }

  // ---------------------------------------------------------------- share a log (mclo.gs)
  const MCLOGS = process.env.OC_MCLOGS_BASE || 'https://api.mclo.gs';
  Object.assign(api, {
    async shareLog(id) {
      const i = must(id), r = running.get(id); let text = r && r.lines && r.lines.length ? r.lines.join('\n') : '';
      if (!text) { try { text = fs.readFileSync(path.join(gameDir(i), 'logs', 'latest.log'), 'utf8'); } catch {} }
      if (!text.trim()) throw new Error('There is no log to share yet. Launch the game first.');
      const lines = text.split(/\r?\n/); if (lines.length > 20000) text = lines.slice(-20000).join('\n');
      let res; try { res = await fetch(MCLOGS + '/1/log', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'content=' + encodeURIComponent(text), signal: AbortSignal.timeout(30000) }); } catch { throw new Error('Could not reach mclo.gs (are you online?)'); }
      const j = await res.json().catch(() => ({})); if (!res.ok || !j.success || !j.url) throw new Error('mclo.gs refused the log: ' + (j.error || res.status));
      return j.url;
    },
  });

  // ---------------------------------------------------------------- desktop shortcut + command line
  function findInstance(q) { q = String(q || '').trim().toLowerCase(); return instances().find(i => i.id.toLowerCase() === q) || instances().find(i => i.name.toLowerCase() === q) || null; }
  Object.assign(api, {
    makeShortcut(id) {
      const i = must(id); if (process.platform !== 'win32') return { err: 'Desktop shortcuts are only available on Windows' };
      const exe = process.execPath, args = (process.defaultApp ? `"${app.getAppPath()}" ` : '') + `--launch "${i.id}"`, lnk = path.join(app.getPath('desktop'), sanitize(i.name) + '.lnk');
      const ok = shell.writeShortcutLink(lnk, 'create', { target: exe, args, cwd: path.dirname(exe), description: 'Play ' + i.name + ' with OfflineCraft', icon: exe, iconIndex: 0 });
      return ok ? { path: lnk } : { err: 'Windows refused to create the shortcut' };
    },
  });
  // `OfflineCraft.exe --launch "<instance>" [--join host:port]`; also used by the second-instance hand-over
  function cli(argv) {
    const get = k => { const n = argv.indexOf(k); return n >= 0 && argv[n + 1] && !argv[n + 1].startsWith('--') ? argv[n + 1] : ''; };
    const q = get('--launch'); if (!q) return null; const i = findInstance(q); if (!i) { send('toast', { msg: `No instance called "${q}"`, err: true }); return null; }
    api.launch(i.id, { join: get('--join') || undefined }); return i.id;
  }

  // ---------------------------------------------------------------- import a MultiMC / Prism instance (.zip)
  async function importPrism(file, j) {
    stage(j, 'Reading the instance'); const z = new AdmZip(file), ents = z.getEntries().map(e => ({ e, n: e.entryName.replace(/\\/g, '/') }));
    const pk = ents.find(x => /(^|\/)mmc-pack\.json$/.test(x.n)); if (!pk) throw new Error('This is not a MultiMC / Prism instance export (mmc-pack.json is missing)');
    const base = pk.n.slice(0, pk.n.length - 'mmc-pack.json'.length), pack = JSON.parse(pk.e.getData().toString('utf8')), comp = {}; for (const c of pack.components || []) comp[c.uid] = c.version;
    const mc = comp['net.minecraft']; if (!mc) throw new Error('No Minecraft version found in this instance');
    let loader = 'vanilla', want = ''; for (const [uid, l] of MMC_LOADERS) if (comp[uid]) { loader = l; want = comp[uid]; }
    const cfgE = ents.find(x => x.n === base + 'instance.cfg'), cfg = parseIni(cfgE ? cfgE.e.getData().toString('utf8') : '');
    const name = cfg.name || path.basename(file, path.extname(file)), notes = []; let lv = '';
    if (loader !== 'vanilla') {
      stage(j, 'Finding the ' + loader + ' version'); const vs = await listLoaderVersions(loader, mc);
      const pick = vs.find(v => v.version === want) || vs.find(v => String(v.version).endsWith('-' + want)) || vs.find(v => String(v.version).includes(want));
      if (pick) lv = pick.version; else { const st = vs.find(v => v.stable) || vs[0]; if (!st) throw new Error(`${loader} has no build for Minecraft ${mc} yet`); lv = st.version; notes.push(`${loader} ${want} was not available, using ${lv}`); }
    }
    const inst = makeInstance(name, mc, loader, lv); if (+cfg.MaxMemAlloc >= 1024) inst.ramMB = +cfg.MaxMemAlloc; saveInst(inst); pushState();
    const prefix = ents.some(x => x.n.startsWith(base + '.minecraft/')) ? base + '.minecraft/' : base + 'minecraft/', gd = gameDir(inst); let n = 0;
    stage(j, 'Copying files'); const files = ents.filter(x => !x.e.isDirectory && x.n.startsWith(prefix));
    for (const x of files) { const rel = x.n.slice(prefix.length); if (!safeRel(rel) || /^(logs|crash-reports|\.cache)\//.test(rel)) continue; const dest = path.join(gd, rel); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, x.e.getData()); n++; }
    if (cfg.PreLaunchCommand || cfg.WrapperCommand || cfg.PostExitCommand) notes.push('launch commands were not imported, for safety');
    return { inst, files: n, notes };
  }
  Object.assign(api, {
    async importPrism() {
      const r = await dialog.showOpenDialog(getWin(), { title: 'Import a MultiMC / Prism instance', filters: [{ name: 'Instance export', extensions: ['zip'] }], properties: ['openFile'] }); if (r.canceled || !r.filePaths[0]) return null;
      return jobResult(startJob('Importing instance', async j => { const out = await importPrism(r.filePaths[0], j); await runPrepare(out.inst, j); pushState(); send('toast', { msg: `${out.inst.name} imported (${out.files} files)${out.notes.length ? '. Note: ' + out.notes.join('; ') : ''}` }); }));
    },
    _importPrismFile: (file, j) => importPrism(file, j),
  });

  // ---------------------------------------------------------------- worlds: import, export, copy
  const saves = i => path.join(gameDir(i), 'saves');
  Object.assign(api, {
    async worldImport(id, kind) {
      const i = must(id); fs.mkdirSync(saves(i), { recursive: true });
      const r = await dialog.showOpenDialog(getWin(), kind === 'folder' ? { title: 'Pick a world folder', properties: ['openDirectory'] } : { title: 'Pick a world .zip', filters: [{ name: 'World', extensions: ['zip'] }], properties: ['openFile'] }); if (r.canceled || !r.filePaths[0]) return null;
      return jobResult(startJob('Importing world', async j => {
        const src = r.filePaths[0]; stage(j, 'Importing world');
        if (kind === 'folder') { if (!exists(path.join(src, 'level.dat'))) throw new Error('That folder has no level.dat, so it is not a Minecraft world'); const d = uniqueDir(saves(i), path.basename(src)); fs.cpSync(src, d, { recursive: true, filter: s => !/session\.lock$/.test(s) }); send('toast', { msg: `Imported ${path.basename(d)}` }); return; }
        const z = new AdmZip(src), ents = z.getEntries().map(e => ({ e, n: e.entryName.replace(/\\/g, '/') })), lv = ents.filter(x => /(^|[^/]+\/)level\.dat$/.test(x.n) && x.n.split('/').length <= 2).sort((a, b) => a.n.split('/').length - b.n.split('/').length)[0];
        if (!lv) throw new Error('No level.dat found in that zip, so it is not a Minecraft world'); const top = lv.n.includes('/') ? lv.n.slice(0, lv.n.indexOf('/') + 1) : '';
        const d = uniqueDir(saves(i), top ? top.slice(0, -1) : path.basename(src, '.zip')); let n = 0;
        for (const x of ents) { if (x.e.isDirectory || !x.n.startsWith(top)) continue; const rel = x.n.slice(top.length); if (!safeRel(rel)) continue; const dest = path.join(d, rel); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, x.e.getData()); n++; }
        send('toast', { msg: `Imported ${path.basename(d)} (${n} files)` });
      }));
    },
    async worldExport(id, world) {
      const i = must(id), src = path.join(saves(i), path.basename(world)); if (!exists(src)) throw new Error('World not found');
      const r = await dialog.showSaveDialog(getWin(), { title: 'Export world', defaultPath: sanitize(world) + '.zip', filters: [{ name: 'Zip', extensions: ['zip'] }] }); if (r.canceled || !r.filePath) return null;
      return jobResult(startJob('Exporting ' + world, async j => { stage(j, 'Zipping the world'); const z = new AdmZip(); await z.addLocalFolderPromise(src, { zipPath: path.basename(world), filter: p => !/(^|[\\/])session\.lock$/.test(p) }); await z.writeZipPromise(r.filePath); send('toast', { msg: 'World exported' }); shell.showItemInFolder(r.filePath); }));
    },
    worldCopy(id, world) {
      const i = must(id), src = path.join(saves(i), path.basename(world)); if (!exists(src)) throw new Error('World not found'); if (running.get(id) && running.get(id).alive) throw new Error('Close the game first');
      return jobResult(startJob('Copying ' + world, async j => { stage(j, 'Copying the world'); const d = uniqueDir(saves(i), path.basename(world) + ' (copy)'); fs.cpSync(src, d, { recursive: true, filter: s => !/session\.lock$/.test(s) }); send('toast', { msg: `Copied to ${path.basename(d)}` }); }));
    },
    // copy options.txt (+ servers.dat, optionsof.txt) from another instance: same keybinds, video settings and server list everywhere
    copyOptions(fromId, toId) {
      const a = must(fromId), b = must(toId); if (a.id === b.id) throw new Error('Pick another instance'); if (running.get(toId) && running.get(toId).alive) throw new Error('Close the game first'); let n = 0;
      fs.mkdirSync(gameDir(b), { recursive: true }); for (const f of ['options.txt', 'optionsof.txt', 'servers.dat']) if (exists(path.join(gameDir(a), f))) { fs.copyFileSync(path.join(gameDir(a), f), path.join(gameDir(b), f)); n++; }
      if (!n) throw new Error(a.name + ' has no settings to copy yet. Launch it once first.'); return n;
    },
  });

  // ---------------------------------------------------------------- Microsoft capes
  const MS = process.env.OC_MS_SERVICES_BASE || 'https://api.minecraftservices.com';
  const activeMs = () => (S().msAccounts || []).find(x => x.id === S().activeMs);
  async function capeFile(url) {
    const id = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16), f = P('skins', 'capes', id + '.png');
    if (!exists(f)) { try { const r = await fetch(url, { signal: AbortSignal.timeout(20000) }); if (r.ok) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); } } catch {} }
    return exists(f) ? pathToFileURL(f).href : '';
  }
  const shapeCapes = async j => Promise.all((j.capes || []).map(async c => ({ id: c.id, alias: c.alias || 'Cape', active: String(c.state).toUpperCase() === 'ACTIVE', url: c.url ? await capeFile(c.url) : '' })));
  const capeCall = async (method, body) => {
    await ensureMsToken(); const a = activeMs(); if (!a) throw new Error('Sign in with a Microsoft account to use capes');
    const go = () => fetch(MS + '/minecraft/profile' + (method === 'GET' ? '' : '/capes/active'), { method, headers: { Authorization: 'Bearer ' + decTok(a.mcToken), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    let r = await go(); if (r.status === 401) { a.mcExpires = 0; await ensureMsToken(); r = await go(); }
    if (r.status === 429) throw new Error('Mojang says capes are being changed too often. Wait a minute.'); if (!r.ok) throw new Error(`Mojang refused (HTTP ${r.status})`); return r.json().catch(() => ({}));
  };
  Object.assign(api, {
    async capeList() { if (!activeMs()) return { ms: false, capes: [] }; return { ms: true, capes: await shapeCapes(await capeCall('GET')) }; },
    async capeSet(id) { const j = id ? await capeCall('PUT', { capeId: String(id) }) : await capeCall('DELETE'); return { capes: await shapeCapes(j) }; },
  });

  // ---------------------------------------------------------------- storage manager
  const SHARED = [['versions', 'Game versions'], ['libraries', 'Libraries'], ['assets', 'Assets (sounds, textures)'], ['runtimes', 'Java'], ['rust', 'Horizon (Rust) builds'], ['cache', 'Download cache'], ['backups', 'World backups'], ['snapshots', 'Update restore points'], ['skins', 'Skins and capes'], ['instances', 'Instances']];
  Object.assign(api, {
    async storageInfo() { const out = []; for (const [k, label] of SHARED) out.push({ key: k, label, bytes: await dirSize(P(k), 400000), path: P(k) }); return out; },
    async storageClean(kind) {
      let freed = 0; const rm = async d => { let st; try { st = fs.statSync(d); } catch { return; } freed += st.isDirectory() ? await dirSize(d, 400000) : st.size; fs.rmSync(d, { recursive: true, force: true }); };
      if (kind === 'cache') { for (const f of fs.existsSync(P('cache')) ? fs.readdirSync(P('cache')) : []) await rm(path.join(P('cache'), f)); }
      else if (kind === 'snapshots') { if (exists(P('snapshots'))) await rm(P('snapshots')); }
      else if (kind === 'backups') {   // keep the newest backup of every world, delete the rest
        for (const inst of exists(P('backups')) ? fs.readdirSync(P('backups')) : []) { const d = path.join(P('backups'), inst), byWorld = {}; for (const f of fs.readdirSync(d)) { const m = /^(.*)__(\d{8}-\d{6})__[a-z]+\.zip$/.exec(f); if (m) (byWorld[m[1]] = byWorld[m[1]] || []).push(f); }
          for (const arr of Object.values(byWorld)) for (const f of arr.sort().slice(0, -1)) { freed += fsize(path.join(d, f)); fs.rmSync(path.join(d, f), { force: true }); } } }
      else if (kind === 'versions') {   // game versions no instance uses (loaders keep the vanilla version they build on)
        const keep = new Set(); for (const i of instances()) { if (i.mc) keep.add(i.mc); if (i.versionId) keep.add(i.versionId); }
        for (const id of [...keep]) { const j = readJson(P('versions', id, id + '.json'), {}); if (j.inheritsFrom) keep.add(j.inheritsFrom); }
        for (const d of exists(P('versions')) ? fs.readdirSync(P('versions')) : []) if (!keep.has(d)) await rm(path.join(P('versions'), d));
      } else if (kind === 'rust') {
        const keep = new Set(instances().filter(i => i.loader === 'rust').map(i => sanitize(i.loaderVer || '')));
        for (const d of exists(P('rust')) ? fs.readdirSync(P('rust')) : []) if (!keep.has(d)) await rm(path.join(P('rust'), d));
      } else throw new Error('Unknown cleanup');
      pushState(); return freed;
    },
  });

  return { spawnSpec, runHook, cli, findInstance };
}

module.exports = { install, splitArgs, parseEnv, parseIni, safeRel };
