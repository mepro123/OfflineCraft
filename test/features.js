// Run with plain node: node test/features.js
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert'), crypto = require('crypto');
const AdmZip = require('adm-zip'); const F = require('../features.js');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'ocf-')), P = (...a) => path.join(T, ...a), j2 = o => JSON.stringify(o);
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL', m); } };

// ---------- crash analysis ----------
const A = (text, extra = {}) => F.analyzeCrash({ text, ...extra });
const cases = [
  ['java-version', 'Exception in thread "main" java.lang.UnsupportedClassVersionError: net/minecraft/client/main/Main has been compiled by a more recent version of the Java Runtime (class file version 65.0), this version of the Java Runtime only recognizes class file versions up to 61.0', 'autojava'],
  ['ram-too-high', 'Error occurred during initialization of VM\nCould not reserve enough space for 8388608KB object heap', 'lessram'],
  ['out-of-memory', 'Caused by: java.lang.OutOfMemoryError: Java heap space', 'moreram'],
  ['jvm-args', 'Unrecognized VM option \'UseShenandoahGC\'\nError: Could not create the Java Virtual Machine.', 'clearjvm'],
  ['corrupt', 'Error: Could not find or load main class net.minecraft.client.main.Main', 'repair'],
  ['world', 'Failed to load level "My World"', 'backups'],
  ['mod-deps', "net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!\n - Mod 'Sodium' (sodium) 0.5.8 requires any version of mod 'Fabric API' (fabric-api), which is missing!", 'updateall'],
  ['mod-deps', "Mod ID: 'create', Requested by: 'createaddition', Expected range: '[0.5,)', Actual version: '[MISSING]'", 'updateall'],
  ['duplicate', 'net.fabricmc.loader.impl.discovery.ModResolutionException: Found duplicate mods:\n   - sodium 0.5.8', 'mods'],
  ['mixin', 'org.spongepowered.asm.mixin.transformer.throwables.MixinApplyError: Mixin [lithium.mixins.json:gen.Foo] from phase [DEFAULT] failed', 'updateall'],
  ['mod-mismatch', 'java.lang.NoSuchMethodError: net.minecraft.class_310.method_1', 'updateall'],
  ['opengl', 'GLFW error 65542: WGL: The driver does not appear to support OpenGL', 'console'],
  ['native-crash', '# A fatal error has been detected by the Java Runtime Environment:\n#  EXCEPTION_ACCESS_VIOLATION (0xc0000005)', 'safe'],
  ['network', 'java.net.UnknownHostException: libraries.minecraft.net', 'repair'],
];
for (const [id, text, first] of cases) { const r = A(text); ok(r.id === id, `${id}: got ${r.id}`); ok(r.actions[0].id === first && r.actions[0].primary, `${id}: first action ${r.actions[0].id}`); ok(r.title && r.detail, id + ' has text'); }
ok(A("Mod 'Sodium' (sodium) 0.5.8 requires any version of mod 'Fabric API' (fabric-api), which is missing!").mods.includes('Fabric API'), 'dep mods parsed');
ok(A('Mixin apply failed lithium.mixins.json').mods.includes('lithium'), 'mixin mod parsed');
ok(A('boom', { loader: 'rust' }).id === 'rust', 'rust fallback'); const u = A('java.lang.RuntimeException: weird thing', { code: 1 }); ok(u.id === 'unknown' && u.detail.includes('weird thing'), 'unknown keeps last error');
console.log('crash analysis:', fails ? 'FAILED' : 'ok');

// ---------- harness for the stateful features ----------
let rustI = null; const inst = { id: 'I1', name: 'Test', mc: '1.20.1', loader: 'fabric', loaderVer: '0.14.0', versionId: 'fabric-loader-0.14.0-1.20.1', ready: true, ramMB: 0, jvmArgs: '', javaPath: '' };
const instDir = i => P('instances', i.id), gameDir = i => path.join(instDir(i), 'minecraft'), contentDir = (i, t) => path.join(gameDir(i), { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' }[t] || 'mods');
const readJson = (p, d = {}) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } }, writeJson = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); };
const exists = p => fs.existsSync(p), fsize = p => { try { return fs.statSync(p).size; } catch { return -1; } }, sanitize = s => s.replace(/[<>:"/\\|?*]/g, '_');
const api = {}, toasts = [], logs = [], prepared = [], saved = [], running = new Map(); let settings = { autoBackup: true, backupKeep: 2, ramMB: 4096 };
const sha1 = b => crypto.createHash('sha1').update(b).digest('hex');
// fake Modrinth: sodium has a 1.21 build, lithium does not, 'newmod' has a newer 1.20.1 build
const jar = { sodium: Buffer.from('sodium-old'), lithium: Buffer.from('lithium-old'), custom: Buffer.from('custom-private'), newmod: Buffer.from('newmod-old') };
const ver = (n, buf, num) => ({ version_number: num, files: [{ primary: true, filename: n + '-' + num + '.jar', url: 'https://cdn/' + n + num, hashes: { sha1: sha1(buf) } }] });
const newBuf = { sodium: Buffer.from('sodium-NEW-1.21'), newmod: Buffer.from('newmod-NEW') };
let lastBody = null;
const fetchRetry = async (url, opts) => {
  const body = JSON.parse(opts.body); lastBody = { url, body };
  if (url.endsWith('/version_files/update')) { const out = {}; for (const h of body.hashes) { if (h === sha1(jar.sodium) && body.game_versions[0] === '1.21') out[h] = ver('sodium', newBuf.sodium, '0.6.0'); else if (h === sha1(jar.newmod)) out[h] = ver('newmod', newBuf.newmod, '2.0'); else if (h === sha1(jar.sodium)) out[h] = ver('sodium', jar.sodium, '0.5.8'); } return { json: async () => out }; }
  if (url.endsWith('/version_files')) { const out = {}; for (const h of body.hashes) if (h === sha1(jar.sodium)) out[h] = { files: [{ url: 'https://cdn/sodium', hashes: { sha1: h } }] }; return { json: async () => out }; }
  throw new Error('unexpected ' + url);
};
const download = async (url, dest) => { const m = /cdn\/(sodium|newmod)/.exec(url); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, m[1] === 'sodium' ? newBuf.sodium : newBuf.newmod); };
const ctx = { api, S: () => settings, P, getInst: id => id === inst.id ? inst : id === 'R' ? rustI : null, saveInst: i => writeJson(path.join(instDir(i), 'instance.json'), i), instDir, gameDir, contentDir, startJob: async (t, fn) => { const j = { label: '', total: 0, done: 0, cancel: false }; try { await fn(j); return ''; } catch (e) { return e.message; } }, stage: (j, l, t = 0) => { j.label = l; j.total = t; j.done = 0; }, send: (c, d) => toasts.push([c, d && d.msg]), LOG: m => logs.push(m), readJson, writeJson, exists, fsize, sanitize, pushState() {}, running, MR: 'https://mr', fetchRetry, primaryFile: v => v.files[0], download,
  runPrepare: async i => { prepared.push(`${i.mc}|${i.loaderVer}`); i.ready = true; }, listLoaderVersions: async (l, mc) => mc === '1.99' ? [] : [{ version: '0.15.0-' + mc, stable: true }, { version: '0.16.0-beta', stable: false }], ensureVanillaJson: async id => { if (id === '9.9') throw new Error('Minecraft 9.9 does not exist'); },
  rustVersions: async () => [{ version: 'nightly-2026-10-30-abc', stable: true }], RUST: { mc: '26.3' }, updateMods: async () => {}, dialog: { showSaveDialog: async () => ({ filePath: P('out.mrpack') }) }, shell: { openPath() {}, showItemInFolder() {} }, clipboard: { writeImage() {} }, nativeImage: { createFromPath: () => ({ isEmpty: () => false }) }, getWin: () => null, pathToFileURL: p => ({ href: 'file://' + p }), instances: () => [inst] };
const feat = F.install(ctx);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const world = (n, data) => { const d = path.join(gameDir(inst), 'saves', n); fs.mkdirSync(path.join(d, 'region'), { recursive: true }); fs.writeFileSync(path.join(d, 'level.dat'), data); fs.writeFileSync(path.join(d, 'region', 'r.0.0.mca'), 'chunks-' + data); fs.writeFileSync(path.join(d, 'session.lock'), 'locked'); return d; };
const mods = (...names) => { const d = contentDir(inst, 'mod'); fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); for (const n of names) fs.writeFileSync(path.join(d, n.split(':')[0] + '.jar' + (n.endsWith(':off') ? '.disabled' : '')), jar[n.split(':')[0]]); };

(async () => {
  // ---------- backups ----------
  world('World A', 'v1'); await sleep(20);
  let n = await feat.autoBackup(inst, null, 'auto'); ok(n === 1, 'first auto backup made: ' + n);
  let list = api.backupList(inst.id); ok(list.length === 1 && list[0].world === 'World A' && list[0].reason === 'auto' && list[0].size > 0, 'backup listed');
  const z = new AdmZip(path.join(T, 'backups', inst.id, list[0].file)); ok(z.getEntries().some(e => e.entryName.replace(/\\/g, '/') === 'World A/region/r.0.0.mca'), 'region file in zip'); ok(!z.getEntries().some(e => /session\.lock/.test(e.entryName)), 'session.lock skipped');
  n = await feat.autoBackup(inst, null, 'auto'); ok(n === 0, 'unchanged world is not backed up again');
  await sleep(1100); fs.writeFileSync(path.join(gameDir(inst), 'saves', 'World A', 'level.dat'), 'v2'); n = await feat.autoBackup(inst, null, 'auto'); ok(n === 1, 'changed world is backed up');
  for (let k = 0; k < 3; k++) { await sleep(1100); fs.writeFileSync(path.join(gameDir(inst), 'saves', 'World A', 'level.dat'), 'v' + (3 + k)); await feat.autoBackup(inst, null, 'auto'); }
  list = api.backupList(inst.id); ok(list.length === 2, 'keeps only the newest 2 backups: ' + list.length);
  settings.autoBackup = false; fs.writeFileSync(path.join(gameDir(inst), 'saves', 'World A', 'level.dat'), 'zz'); ok(await feat.autoBackup(inst, null) === 0, 'auto backup can be switched off'); settings.autoBackup = true;
  // manual backup + restore
  await sleep(1100); await api.backupNow(inst.id, 'World A'); list = api.backupList(inst.id); const newest = list[0];
  fs.writeFileSync(path.join(gameDir(inst), 'saves', 'World A', 'level.dat'), 'CORRUPT'); const e1 = await api.backupRestore(inst.id, newest.file); ok(!e1.err, 'restore ok ' + e1.err);
  ok(fs.readFileSync(path.join(gameDir(inst), 'saves', 'World A', 'level.dat'), 'utf8') === 'zz', 'world content restored from the backup');
  ok(fs.readdirSync(path.join(gameDir(inst), 'saves')).some(d => d.startsWith('World A (before restore')), 'the replaced world is kept aside');
  running.set(inst.id, { alive: true }); let threw = false; try { api.backupRestore(inst.id, newest.file); } catch { threw = true; } ok(threw, 'cannot restore while the game runs'); running.delete(inst.id);
  ok(api.backupDelete(inst.id, newest.file) && api.backupList(inst.id).length === list.length - 1, 'backup deleted'); ok(api.backupDelete(inst.id, '../../x.zip') === false, 'path tricks refused');
  console.log('backups: ok');

  // ---------- worlds + screenshots ----------
  const sizes = await api.worldSizes(inst.id); ok(sizes['World A'] > 0, 'world size'); const sd = path.join(gameDir(inst), 'screenshots'); fs.mkdirSync(sd, { recursive: true }); fs.writeFileSync(path.join(sd, 'a.png'), 'x'); await sleep(20); fs.writeFileSync(path.join(sd, 'b.png'), 'y'); fs.writeFileSync(path.join(sd, 'notes.txt'), 'n');
  const shots = api.shotList(inst.id); ok(shots.length === 2 && shots[0].file === 'b.png', 'screenshots newest first, images only'); api.shotDelete(inst.id, '../b.png'); ok(api.shotList(inst.id).length === 1, 'screenshot deleted (path stripped)');

  // ---------- safe mode ----------
  mods('sodium', 'lithium', 'custom:off'); const held = feat.holdMods(inst); ok(held === 3 && fs.readdirSync(contentDir(inst, 'mod')).length === 0, 'safe mode sets mods aside'); ok(feat.holdMods(inst) === 0, 'no double hold');
  ok(feat.releaseMods(inst) === 3 && fs.readdirSync(contentDir(inst, 'mod')).sort().join() === 'custom.jar.disabled,lithium.jar,sodium.jar', 'mods come back with their disabled state'); ok(!exists(path.join(instDir(inst), 'safe-hold')), 'hold folder removed');
  feat.holdMods(inst); feat.restoreHolds(); ok(fs.readdirSync(contentDir(inst, 'mod')).length === 3, 'mods restored on startup after a crash of the launcher');
  console.log('safe mode: ok');

  // ---------- update everything + undo ----------
  mods('newmod', 'custom'); writeJson(path.join(instDir(inst), 'content.json'), { 'newmod.jar': { title: 'NewMod', project_id: 'p1' } }); toasts.length = 0; prepared.length = 0;
  let r = await api.updateEverything(inst.id); ok(!r.err, 'update ok: ' + r.err);
  ok(inst.loaderVer === '0.15.0-1.20.1' && prepared.includes('1.20.1|0.15.0-1.20.1'), 'loader moved to newest stable build, then prepared: ' + inst.loaderVer);
  ok(fs.readFileSync(path.join(contentDir(inst, 'mod'), 'newmod-2.0.jar'), 'utf8') === 'newmod-NEW' && !exists(path.join(contentDir(inst, 'mod'), 'newmod.jar')), 'mod updated and old file removed');
  ok(readJson(path.join(instDir(inst), 'content.json'))['newmod-2.0.jar'].title === 'NewMod', 'content record moved to the new file name'); ok(toasts.some(t => /Updated: .*Fabric 0\.15\.0.*1 mod/.test(t[1])), 'summary toast: ' + JSON.stringify(toasts));
  ok(api.hasUndo(inst.id) && api.hasUndo(inst.id).loaderVer === '0.14.0', 'restore point saved');
  r = await api.undoUpdate(inst.id); ok(!r.err && inst.loaderVer === '0.14.0' && fs.readdirSync(contentDir(inst, 'mod')).sort().join() === 'custom.jar,newmod.jar', 'undo brings back old loader and mods: ' + inst.loaderVer + ' ' + fs.readdirSync(contentDir(inst, 'mod')));
  ok(api.hasUndo(inst.id) === null, 'restore point consumed');
  // failed update rolls back automatically
  mods('newmod'); inst.loaderVer = '0.14.0'; const oldRun = ctx.runPrepare; ctx.runPrepare = async () => { throw new Error('install failed'); };
  const F2 = F.install({ ...ctx, runPrepare: async () => { throw new Error('install failed'); }, api: {} }); const api2 = {}; const F3 = F.install({ ...ctx, api: api2, runPrepare: async () => { throw new Error('install failed'); } });
  r = await api2.updateEverything(inst.id); ok(/install failed/.test(r.err) && inst.loaderVer === '0.14.0' && fs.readdirSync(contentDir(inst, 'mod')).join() === 'newmod.jar', 'failed update is rolled back: ' + r.err + ' ' + inst.loaderVer + ' ' + fs.readdirSync(contentDir(inst, 'mod')));
  console.log('update everything: ok');

  // ---------- switch Minecraft version ----------
  mods('sodium', 'lithium', 'custom'); writeJson(path.join(instDir(inst), 'content.json'), { 'sodium.jar': { title: 'Sodium', project_id: 'ps' } }); prepared.length = 0; toasts.length = 0; inst.loaderVer = '0.14.0'; inst.mc = '1.20.1';
  r = await api.changeVersion(inst.id, '1.21'); ok(!r.err, 'switch ok: ' + r.err); ok(inst.mc === '1.21' && inst.loaderVer === '0.15.0-1.21' && prepared.includes('1.21|0.15.0-1.21'), 'instance moved to 1.21 with matching loader');
  const left = fs.readdirSync(contentDir(inst, 'mod')).sort(); ok(left.join() === 'custom.jar.disabled,lithium.jar.disabled,sodium-0.6.0.jar', 'sodium updated, mods without a 1.21 build turned off: ' + left);
  ok(lastBody.body.game_versions[0] === '1.21' && lastBody.body.loaders[0] === 'fabric', 'asked Modrinth for 1.21 + fabric'); ok(toasts.some(t => /Now on 1\.21.*1 mod updated.*2 mods without/.test(t[1])), 'toast: ' + JSON.stringify(toasts.slice(-1)));
  r = await api.changeVersion(inst.id, '9.9'); ok(/does not exist/.test(r.err) && inst.mc === '1.21', 'invalid version rejected before touching anything'); r = await api.changeVersion(inst.id, '1.99'); ok(/no build for Minecraft 1.99/.test(r.err) && inst.mc === '1.21', 'no loader build -> nothing changed: ' + r.err);
  r = await api.changeVersion(inst.id, '1.21').catch(e => ({ err: e.message })); ok(/already/.test(r.err), 'same version refused');
  r = await api.undoUpdate(inst.id); ok(!r.err && inst.mc === '1.20.1' && fs.readdirSync(contentDir(inst, 'mod')).sort().join() === 'custom.jar,lithium.jar,sodium.jar', 'version switch can be undone: ' + inst.mc + ' err=' + r.err + ' files=' + fs.readdirSync(contentDir(inst, 'mod')));
  rustI = { ...inst, id: 'R', loader: 'rust', mc: '26.3', loaderVer: 'nightly-OLD' };
  ok(((await api.changeVersion('R', '1.21').catch(e => ({ err: e.message }))).err || '').includes('only supports'), 'Rust cannot switch version');
  console.log('switch version: ok');

  // ---------- Horizon update ----------
  const st = await api.rustStatus('R'); ok(st.outdated && st.latest === 'nightly-2026-10-30-abc', 'horizon update detected'); ok(await api.rustStatus(inst.id) === null, 'not a rust instance');
  fs.mkdirSync(path.join(instDir(rustI)), { recursive: true }); r = await api.updateEverything('R'); ok(!r.err && rustI.loaderVer === 'nightly-2026-10-30-abc' && rustI.versionId === '', 'horizon updated to the newest build: ' + r.err);
  console.log('horizon: ok');

  // ---------- export as .mrpack ----------
  mods('sodium', 'custom'); fs.mkdirSync(path.join(gameDir(inst), 'config'), { recursive: true }); fs.writeFileSync(path.join(gameDir(inst), 'config', 'a.toml'), 'k=1'); fs.writeFileSync(path.join(gameDir(inst), 'options.txt'), 'fov:70'); inst.loaderVer = '0.14.0';
  r = await api.exportMrpack(inst.id, { worlds: false }); ok(!r.err, 'export ok ' + r.err);
  const pack = new AdmZip(P('out.mrpack')), idx = JSON.parse(pack.getEntry('modrinth.index.json').getData().toString()), names = pack.getEntries().map(e => e.entryName.replace(/\\/g, '/'));
  ok(idx.formatVersion === 1 && idx.game === 'minecraft' && idx.dependencies.minecraft === '1.20.1' && idx.dependencies['fabric-loader'] === '0.14.0', 'index header and dependencies');
  ok(idx.files.length === 1 && idx.files[0].path === 'mods/sodium.jar' && idx.files[0].downloads[0] === 'https://cdn/sodium' && idx.files[0].hashes.sha1 && idx.files[0].hashes.sha512.length === 128, 'known mod is linked, with both hashes');
  ok(names.includes('overrides/mods/custom.jar') && names.includes('overrides/config/a.toml') && names.includes('overrides/options.txt') && !names.some(x => x.includes('overrides/saves')), 'unknown mod and configs are included, worlds are not');
  r = await api.exportMrpack(inst.id, { worlds: true }); ok(new AdmZip(P('out.mrpack')).getEntries().some(e => e.entryName.replace(/\\/g, '/').startsWith('overrides/saves/World A/')), 'worlds can be included');
  threwRust = (await api.exportMrpack('R', {}).catch(e => ({ err: e.message }))); ok(/no Java mods/.test(threwRust.err || ''), 'rust export refused');
  console.log('export: ok');

  // ---------- crash fixes ----------
  Object.assign(inst, { javaPath: 'C:/old/java.exe', jvmArgs: '-XX:+Bad', ramMB: 2048, ready: true });
  api.crashFix(inst.id, 'autojava'); ok(inst.javaPath === '', 'autojava'); api.crashFix(inst.id, 'clearjvm'); ok(inst.jvmArgs === '', 'clearjvm'); api.crashFix(inst.id, 'moreram'); ok(inst.ramMB > 2048 && inst.ramMB <= 4096, 'moreram adds memory, capped by the PC: ' + inst.ramMB); api.crashFix(inst.id, 'lessram'); ok(inst.ramMB >= 1024 && inst.ramMB <= os.totalmem() / 1048576, 'lessram sane: ' + inst.ramMB); api.crashFix(inst.id, 'repair'); ok(inst.ready === false, 'repair marks files for re-check'); ok(api.crashFix(inst.id, 'nope') === false, 'unknown action ignored');
  // exit hook
  toasts.length = 0; const sent = []; const ctx2 = { ...ctx, api: {}, send: (c, d) => sent.push([c, d]) }; const f2 = F.install(ctx2);
  f2.onExit(inst, { lines: ['java.lang.OutOfMemoryError: Java heap space'], started: Date.now() - 5000 }, 1, 5); ok(sent.length === 1 && sent[0][0] === 'crash' && sent[0][1].diag === 'out-of-memory' && sent[0][1].id === inst.id && sent[0][1].report.includes('OutOfMemoryError'), 'crash event sent');
  sent.length = 0; f2.onExit(inst, { lines: [], started: 0 }, 0, 60); f2.onExit(inst, { lines: [], started: 0, stopped: true }, 1, 60); ok(sent.length === 0, 'clean exit and user stop are not crashes');
  inst.loader = 'vanilla'; f2.onExit(inst, { lines: ['NoSuchMethodError x'], started: 0 }, 1, 5); ok(!sent[0][1].actions.some(a => a.id === 'safe' || a.id === 'updateall'), 'vanilla instances are not offered mod fixes'); inst.loader = 'fabric';
  console.log(fails ? `FEATURES TESTS FAILED (${fails})` : 'FEATURE TESTS PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
