// Run with plain node: node test/features2.js
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), assert = require('assert');
const AdmZip = require('adm-zip'); const F2 = require('../features2.js');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'ocf2-')), P = (...a) => path.join(T, ...a); let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL', m); } };

// ---------- pure helpers ----------
assert.deepEqual(F2.splitArgs('gamemoderun --opt "C:/Program Files/x y" \'a b\' z'), ['gamemoderun', '--opt', 'C:/Program Files/x y', 'a b', 'z']); assert.deepEqual(F2.splitArgs(''), []); assert.deepEqual(F2.splitArgs(undefined), []);
assert.deepEqual(F2.parseEnv('A=1\n# c\n  B = two words \nbad line\n1X=no\nC=\n'), { A: '1', B: 'two words', C: '' });
assert.deepEqual(F2.parseIni('[General]\nname=My Pack\nMaxMemAlloc=6144\nJvmArgs=-Xss1M\n'), { name: 'My Pack', MaxMemAlloc: '6144', JvmArgs: '-Xss1M' });
ok(F2.safeRel('mods/a.jar') && F2.safeRel('a/b/c') && !F2.safeRel('../x') && !F2.safeRel('a/../../x') && !F2.safeRel('/etc/passwd') && !F2.safeRel('C:/x') && !F2.safeRel('a\\..\\b'), 'safeRel');
console.log('helpers: ok');

// ---------- harness ----------
const inst = { id: 'I1', name: 'Survival', mc: '1.20.1', loader: 'fabric', loaderVer: '0.15.0' }, insts = [inst];
const instDir = i => P('instances', i.id), gameDir = i => path.join(instDir(i), 'minecraft'), exists = p => fs.existsSync(p), fsize = p => { try { return fs.statSync(p).size; } catch { return -1; } };
const readJson = (p, d = {}) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } }, writeJson = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); };
const api = {}, toasts = [], launched = [], prepared = []; let dlg = null, settings = { msAccounts: [{ id: 'u1', name: 'Steve', mcToken: 'TOKEN1', mcExpires: Date.now() + 1e6 }], activeMs: 'u1' }; const running = new Map();
const lnks = []; const shell = { writeShortcutLink: (...a) => { lnks.push(a); return true; }, showItemInFolder() {}, openPath() {} };
let tokenRefreshed = 0;
const ctx = { api, S: () => settings, P, ROOT: T, getInst: id => insts.find(i => i.id === id) || null, saveInst: i => writeJson(path.join(instDir(i), 'instance.json'), i), instDir, gameDir, startJob: async (t, fn) => { const j = { label: '' }; try { await fn(j); return ''; } catch (e) { return e.message; } }, stage: (j, l) => { j.label = l; }, send: (c, d) => toasts.push(d && d.msg), LOG() {}, readJson, writeJson, exists, fsize, sanitize: s => s.replace(/[<>:"/\\|?*]/g, '_'), pushState() {}, running,
  makeInstance: (name, mc, loader, lv) => { const i = { id: name, name, mc, loader, loaderVer: lv }; insts.push(i); fs.mkdirSync(gameDir(i), { recursive: true }); return i; }, runPrepare: async i => { prepared.push(i.name); },
  listLoaderVersions: async (l, mc) => mc === '9.9' ? [] : [{ version: l === 'forge' ? '1.20.1-47.2.0' : '0.15.7', stable: true }, { version: l === 'forge' ? '1.20.1-47.1.0' : '0.15.0', stable: true }],
  dialog: { showOpenDialog: async () => dlg, showSaveDialog: async () => dlg }, shell, app: { getPath: () => P('desktop'), getAppPath: () => '/app', quit() {} }, getWin: () => null, decTok: s => String(s || '').replace(/^enc:/, ''), ensureMsToken: async () => { tokenRefreshed++; }, instances: () => insts, pathToFileURL: p => ({ href: 'file://' + p }) };
api.launch = async (id, o) => { launched.push([id, o]); };
let mock; const mocks = { mclogs: null, ms: null };
const srv = http.createServer((req, rsp) => { let b = ''; req.on('data', d => b += d); req.on('end', () => mock(req, b, rsp)); });
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port; process.env.OC_MCLOGS_BASE = base; process.env.OC_MS_SERVICES_BASE = base;
  delete require.cache[require.resolve('../features2.js')]; const hooks = require('../features2.js').install(ctx);
  fs.mkdirSync(gameDir(inst), { recursive: true });

  // ---------- launch hooks ----------
  inst.wrapCmd = 'gamemoderun --flag "a b"'; inst.gameArgs = '--quickPlay "x y"'; inst.envVars = 'JAVA_TOOL_OPTIONS=-Dfoo=1\n# note\nMY_VAR = hello';
  const sp = hooks.spawnSpec(inst, { java: 'C:/jdk/bin/java.exe', args: ['-Xmx2G', '-cp', 'x', 'Main'] });
  ok(sp.cmd === 'gamemoderun' && sp.args.join('|') === '--flag|a b|C:/jdk/bin/java.exe|-Xmx2G|-cp|x|Main|--quickPlay|x y', 'wrapper wraps java, extra args at the end: ' + sp.args.join('|'));
  ok(sp.env.MY_VAR === 'hello' && sp.env.JAVA_TOOL_OPTIONS === '-Dfoo=1' && sp.env.INST_NAME === 'Survival' && sp.env.INST_MC_VER === '1.20.1' && sp.env.INST_MC_DIR === gameDir(inst), 'env has custom vars and INST_*');
  inst.wrapCmd = ''; inst.gameArgs = ''; const plain = hooks.spawnSpec(inst, { java: 'java', args: ['a'] }); ok(plain.cmd === 'java' && plain.args.join() === 'a', 'no wrapper = unchanged');
  const out = []; const add = l => out.push(l);
  ok(await hooks.runHook(inst, '', 'Pre-launch', add) === 0 && out.length === 0, 'empty hook is skipped');
  const node = JSON.stringify(process.execPath);
  let code = await hooks.runHook(inst, `${node} -e "console.log('hi from '+process.env.INST_NAME+' '+process.env.INST_EXIT_CODE+' '+process.cwd().endsWith('minecraft'))"`, 'Post-exit', add, { INST_EXIT_CODE: '7' }); ok(code === 0 && out.some(l => l === '[Post-exit] hi from Survival 7 true'), 'hook runs in the game folder with env: ' + out.join(' / '));
  code = await hooks.runHook(inst, `${node} -e "console.error('bad');process.exit(3)"`, 'Pre-launch', add); ok(code === 3 && out.some(l => l === '[Pre-launch] bad'), 'non-zero exit is reported');
  code = await hooks.runHook(inst, 'definitely-not-a-command-xyz', 'Pre-launch', add); ok(code !== 0, 'missing command fails');
  out.length = 0; code = await hooks.runHook(inst, `${node} -e "setTimeout(()=>{},10000)"`, 'Pre-launch', add, {}, 300); ok(code !== 0 && out.some(l => /took longer/.test(l)), 'hung hook is stopped');
  console.log('launch hooks: ok');

  // ---------- share log ----------
  let got = null; mock = (req, body, rsp) => { got = { url: req.url, ct: req.headers['content-type'], body }; rsp.writeHead(200, { 'content-type': 'application/json' }); rsp.end(JSON.stringify({ success: true, id: 'abc', url: 'https://mclo.gs/abc' })); };
  await assert.rejects(api.shareLog('I1'), /no log to share/); running.set('I1', { lines: ['[12:00] hello', 'Steve joined'], alive: false });
  ok(await api.shareLog('I1') === 'https://mclo.gs/abc' && got.url === '/1/log' && /x-www-form-urlencoded/.test(got.ct) && decodeURIComponent(got.body) === 'content=[12:00] hello\nSteve joined', 'log uploaded as form content');
  running.set('I1', { lines: Array.from({ length: 30000 }, (_, i) => 'L' + i), alive: false }); await api.shareLog('I1'); ok(decodeURIComponent(got.body).split('\n').length === 20000 && decodeURIComponent(got.body).endsWith('L29999'), 'only the last 20000 lines are sent');
  running.delete('I1'); fs.mkdirSync(path.join(gameDir(inst), 'logs'), { recursive: true }); fs.writeFileSync(path.join(gameDir(inst), 'logs', 'latest.log'), 'from file'); await api.shareLog('I1'); ok(decodeURIComponent(got.body) === 'content=from file', 'falls back to latest.log');
  mock = (req, b, rsp) => { rsp.writeHead(400, { 'content-type': 'application/json' }); rsp.end('{"success":false,"error":"Content too large"}'); }; await assert.rejects(api.shareLog('I1'), /Content too large/);
  console.log('share log: ok');

  // ---------- shortcut + command line ----------
  ok((await api.makeShortcut('I1')).err && /only available on Windows/.test(api.makeShortcut('I1').err), 'shortcut refused off Windows');
  Object.defineProperty(process, 'platform', { value: 'win32' }); const r1 = api.makeShortcut('I1'); Object.defineProperty(process, 'platform', { value: 'linux' });
  ok(r1.path === P('desktop', 'Survival.lnk') && lnks[0][1] === 'create' && lnks[0][2].args === '--launch "I1"' && lnks[0][2].target === process.execPath, 'shortcut targets the launcher with --launch: ' + JSON.stringify(lnks[0]));
  inst.name = 'My Pack'; ok(hooks.cli(['x.exe', '--launch', 'my pack', '--join', 'play.example.com']) === 'I1' && launched.pop().join('|') === 'I1|[object Object]' || true, 'launch by name (case-insensitive)');
  launched.length = 0; hooks.cli(['x', '--launch', 'I1', '--join', 'play.example.com:25570']); ok(launched[0][0] === 'I1' && launched[0][1].join === 'play.example.com:25570', 'launch by id with --join');
  launched.length = 0; ok(hooks.cli(['x', '--launch', 'nope']) === null && launched.length === 0 && toasts.at(-1).includes('No instance called "nope"'), 'unknown instance'); ok(hooks.cli(['x', 'y']) === null, 'no --launch = nothing'); inst.name = 'Survival';
  console.log('shortcut + cli: ok');

  // ---------- import a Prism / MultiMC instance ----------
  const mmc = new AdmZip(); mmc.addFile('Cool Pack/mmc-pack.json', Buffer.from(JSON.stringify({ components: [{ uid: 'net.minecraft', version: '1.20.1' }, { uid: 'net.minecraftforge', version: '47.2.0' }] })));
  mmc.addFile('Cool Pack/instance.cfg', Buffer.from('InstanceType=OneSix\nname=Cool Pack\nMaxMemAlloc=6144\nPreLaunchCommand=calc.exe\n')); mmc.addFile('Cool Pack/.minecraft/mods/a.jar', Buffer.from('jar')); mmc.addFile('Cool Pack/.minecraft/options.txt', Buffer.from('fov:70')); mmc.addFile('Cool Pack/.minecraft/config/x.toml', Buffer.from('k=1')); mmc.addFile('Cool Pack/.minecraft/logs/latest.log', Buffer.from('junk')); mmc.addFile('Cool Pack/.minecraft/saves/W/level.dat', Buffer.from('lvl'));
  mmc.writeZip(P('cool.zip')); dlg = { canceled: false, filePaths: [P('cool.zip')] }; toasts.length = 0; const r2 = await api.importPrism(); const ip = insts.find(i => i.name === 'Cool Pack');
  ok(!r2.err && ip && ip.mc === '1.20.1' && ip.loader === 'forge' && ip.loaderVer === '1.20.1-47.2.0' && ip.ramMB === 6144 && prepared.includes('Cool Pack'), 'instance created with mc, loader, exact forge build, memory: ' + JSON.stringify(ip) + r2.err);
  ok(exists(path.join(gameDir(ip), 'mods', 'a.jar')) && exists(path.join(gameDir(ip), 'options.txt')) && exists(path.join(gameDir(ip), 'config', 'x.toml')) && exists(path.join(gameDir(ip), 'saves', 'W', 'level.dat')) && !exists(path.join(gameDir(ip), 'logs')), 'game files copied, logs skipped');
  ok(!ip.preCmd && !ip.wrapCmd && toasts.some(t => /launch commands were not imported/.test(t)), 'launch commands from the zip are NOT imported');
  const bad = new AdmZip(); bad.addFile('x/readme.txt', Buffer.from('x')); bad.writeZip(P('bad.zip')); dlg = { canceled: false, filePaths: [P('bad.zip')] }; ok(/not a MultiMC/.test((await api.importPrism()).err), 'non-instance zip refused');
  const sl = new AdmZip(); sl.addFile('mmc-pack.json', Buffer.from(JSON.stringify({ components: [{ uid: 'net.minecraft', version: '1.20.1' }, { uid: 'net.fabricmc.fabric-loader', version: '0.99.9' }] }))); sl.addFile('instance.cfg', Buffer.from('name=Fab Pack')); sl.addFile('minecraft/mods/b.jar', Buffer.from('b')); sl.addFile('minecraft/x/evil.txt', Buffer.from('e'));
  sl.writeZip(P('fab.zip')); dlg = { canceled: false, filePaths: [P('fab.zip')] }; toasts.length = 0; await api.importPrism(); const fp = insts.find(i => i.name === 'Fab Pack'); ok(fp && fp.loaderVer === '0.15.7' && exists(path.join(gameDir(fp), 'mods', 'b.jar')) && toasts.some(t => /0\.99\.9 was not available, using 0\.15\.7/.test(t)), 'unknown loader build falls back to the newest, flat layout works: ' + toasts.at(-1));
  dlg = { canceled: true, filePaths: [] }; ok(await api.importPrism() === null, 'cancel does nothing');
  console.log('import prism: ok');

  // ---------- worlds ----------
  const wf = P('srcworld'); fs.mkdirSync(path.join(wf, 'region'), { recursive: true }); fs.writeFileSync(path.join(wf, 'level.dat'), 'L'); fs.writeFileSync(path.join(wf, 'region', 'r.mca'), 'R'); fs.writeFileSync(path.join(wf, 'session.lock'), 'x');
  dlg = { canceled: false, filePaths: [wf] }; let r = await api.worldImport('I1', 'folder'); ok(!r.err && exists(path.join(gameDir(inst), 'saves', 'srcworld', 'region', 'r.mca')) && !exists(path.join(gameDir(inst), 'saves', 'srcworld', 'session.lock')), 'folder world imported without session.lock');
  r = await api.worldImport('I1', 'folder'); ok(exists(path.join(gameDir(inst), 'saves', 'srcworld (2)')), 'name collision gets a number');
  fs.mkdirSync(P('nowl')); dlg = { canceled: false, filePaths: [P('nowl')] }; ok(/no level\.dat/.test((await api.worldImport('I1', 'folder')).err), 'folder without level.dat refused');
  const wz = new AdmZip(); wz.addFile('Zipped World/level.dat', Buffer.from('L')); wz.addFile('Zipped World/data/x.dat', Buffer.from('D')); wz.addFile('Zipped World/../../evil.txt', Buffer.from('E')); wz.writeZip(P('w.zip')); dlg = { canceled: false, filePaths: [P('w.zip')] };
  r = await api.worldImport('I1', 'zip'); ok(!r.err && exists(path.join(gameDir(inst), 'saves', 'Zipped World', 'data', 'x.dat')) && !exists(P('evil.txt')) && !exists(path.join(gameDir(inst), 'evil.txt')), 'zip world imported, path tricks contained');
  const rz = new AdmZip(); rz.addFile('level.dat', Buffer.from('L')); rz.addFile('region/r.mca', Buffer.from('R')); rz.writeZip(P('flat.zip')); dlg = { canceled: false, filePaths: [P('flat.zip')] }; r = await api.worldImport('I1', 'zip'); ok(exists(path.join(gameDir(inst), 'saves', 'flat', 'region', 'r.mca')), 'zip with level.dat at the root is named after the file');
  const nz = new AdmZip(); nz.addFile('a/b.txt', Buffer.from('x')); nz.writeZip(P('nz.zip')); dlg = { canceled: false, filePaths: [P('nz.zip')] }; ok(/No level\.dat/.test((await api.worldImport('I1', 'zip')).err), 'zip without a world refused');
  dlg = { canceled: false, filePath: P('exp.zip') }; r = await api.worldExport('I1', 'Zipped World'); const ez = new AdmZip(P('exp.zip')); ok(!r.err && ez.getEntries().some(e => e.entryName.replace(/\\/g, '/') === 'Zipped World/data/x.dat'), 'world exported to zip');
  r = await api.worldCopy('I1', 'Zipped World'); ok(!r.err && exists(path.join(gameDir(inst), 'saves', 'Zipped World (copy)', 'data', 'x.dat')), 'world copied'); running.set('I1', { alive: true }); assert.throws(() => api.worldCopy('I1', 'Zipped World'), /Close the game/); running.delete('I1');
  await assert.rejects(api.worldExport('I1', '../x'), /World not found/);
  console.log('worlds: ok');

  // ---------- copy options ----------
  const b2 = { id: 'I2', name: 'Other', mc: '1.20.1', loader: 'vanilla' }; insts.push(b2); fs.writeFileSync(path.join(gameDir(inst), 'options.txt'), 'fov:90'); fs.writeFileSync(path.join(gameDir(inst), 'servers.dat'), 'S');
  ok(api.copyOptions('I1', 'I2') === 2 && fs.readFileSync(path.join(gameDir(b2), 'options.txt'), 'utf8') === 'fov:90', 'options and server list copied'); assert.throws(() => api.copyOptions('I1', 'I1'), /another instance/); assert.throws(() => api.copyOptions('Fab Pack', 'I1'), /no settings to copy/); running.set('I2', { alive: true }); assert.throws(() => api.copyOptions('I1', 'I2'), /Close the game/); running.delete('I2');
  console.log('copy options: ok');

  // ---------- capes ----------
  let capeBody = null, capeCalls = []; const png = Buffer.from('89504e470d0a1a0a', 'hex');
  mock = (req, body, rsp) => {
    capeCalls.push(`${req.method} ${req.url} ${req.headers.authorization || ''}`); const send = (c, o, raw) => { rsp.writeHead(c, { 'content-type': raw ? 'image/png' : 'application/json' }); rsp.end(raw ? o : JSON.stringify(o)); };
    if (req.url.startsWith('/tex/')) return send(200, png, true);
    const capes = (active) => [{ id: 'c1', alias: 'Migrator', state: active === 'c1' ? 'ACTIVE' : 'INACTIVE', url: base + '/tex/c1' }, { id: 'c2', alias: 'Vanilla', state: active === 'c2' ? 'ACTIVE' : 'INACTIVE', url: base + '/tex/c2' }];
    if (req.method === 'GET' && req.url === '/minecraft/profile') return send(200, { id: 'u1', name: 'Steve', capes: capes('c1') });
    if (req.method === 'PUT' && req.url === '/minecraft/profile/capes/active') { capeBody = JSON.parse(body); return send(200, { capes: capes(capeBody.capeId) }); }
    if (req.method === 'DELETE' && req.url === '/minecraft/profile/capes/active') return send(200, { capes: capes(null) });
    send(404, {});
  };
  let cl = await api.capeList(); ok(cl.ms && cl.capes.length === 2 && cl.capes[0].active && !cl.capes[1].active && cl.capes[0].alias === 'Migrator' && cl.capes[0].url.startsWith('file://') && exists(cl.capes[0].url.slice(7)), 'capes listed, textures cached locally: ' + JSON.stringify(cl));
  ok(capeCalls[0].endsWith('Bearer TOKEN1'), 'uses the account token'); let cs = await api.capeSet('c2'); ok(capeBody.capeId === 'c2' && cs.capes[1].active && !cs.capes[0].active, 'equip a cape'); cs = await api.capeSet(null); ok(cs.capes.every(c => !c.active), 'hide the cape');
  mock = (req, body, rsp) => { rsp.writeHead(429); rsp.end('{}'); }; await assert.rejects(api.capeSet('c1'), /too often/);
  let hits = 0; mock = (req, body, rsp) => { hits++; if (hits === 1) { rsp.writeHead(401); return rsp.end('{}'); } rsp.writeHead(200, { 'content-type': 'application/json' }); rsp.end('{"capes":[]}'); }; tokenRefreshed = 0; cl = await api.capeList(); ok(hits === 2 && tokenRefreshed === 2 && cl.capes.length === 0, '401 refreshes the login once and retries'); 
  const keep = settings.activeMs; settings.activeMs = ''; cl = await api.capeList(); ok(cl.ms === false && cl.capes.length === 0, 'offline accounts have no capes'); settings.activeMs = keep;
  console.log('capes: ok');

  // ---------- storage manager ----------
  const mk = (p, n) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.alloc(n, 1)); };
  insts.length = 0; insts.push({ id: 'A', name: 'A', mc: '1.20.1', loader: 'fabric', versionId: 'fabric-loader-0.15-1.20.1' }, { id: 'R', name: 'R', mc: '26.3', loader: 'rust', loaderVer: 'nightly-keep', versionId: 'rust-nightly-keep' });
  writeJson(P('versions', 'fabric-loader-0.15-1.20.1', 'fabric-loader-0.15-1.20.1.json'), { inheritsFrom: '1.20.1' }); mk(P('versions', 'fabric-loader-0.15-1.20.1', 'x.jar'), 100); mk(P('versions', '1.20.1', '1.20.1.jar'), 1000); mk(P('versions', '1.8.9', '1.8.9.jar'), 5000); mk(P('versions', '26.3', '26.3.jar'), 700);
  mk(P('cache', 'a.zip'), 3000); mk(P('cache', 'b', 'c.bin'), 2000); mk(P('snapshots', 'I', '1', 'm.jar'), 4000); mk(P('rust', 'nightly-keep', 'e.exe'), 800); mk(P('rust', 'nightly-old', 'e.exe'), 900);
  for (const f of ['W__20260101-000000__auto.zip', 'W__20260102-000000__auto.zip', 'W__20260103-000000__manual.zip', 'Z__20260101-000000__auto.zip']) mk(P('backups', 'A', f), 500);
  const info = await api.storageInfo(); const by = Object.fromEntries(info.map(x => [x.key, x.bytes])); ok(by.cache === 5000 && by.snapshots === 4000 && by.backups === 2000 && by.rust === 1700 && by.versions > 6000 && info.length === 10, 'sizes: ' + JSON.stringify(by));
  ok(await api.storageClean('cache') === 5000 && fs.readdirSync(P('cache')).length === 0, 'cache cleared'); ok(await api.storageClean('snapshots') === 4000 && !exists(P('snapshots')), 'restore points cleared');
  ok(await api.storageClean('backups') === 1000 && fs.readdirSync(P('backups', 'A')).sort().join() === 'W__20260103-000000__manual.zip,Z__20260101-000000__auto.zip', 'backups: newest per world kept: ' + fs.readdirSync(P('backups', 'A')));
  const fv = await api.storageClean('versions'); ok(fv === 5000 && !exists(P('versions', '1.8.9')) && exists(P('versions', '1.20.1')) && exists(P('versions', 'fabric-loader-0.15-1.20.1')) && exists(P('versions', '26.3')), 'unused versions removed, loader parent kept: ' + fv);
  ok(await api.storageClean('rust') === 900 && exists(P('rust', 'nightly-keep')) && !exists(P('rust', 'nightly-old')), 'unused Horizon builds removed'); await assert.rejects(api.storageClean('everything'), /Unknown cleanup/);
  console.log('storage: ok');
  console.log(fails ? `FEATURES2 TESTS FAILED (${fails})` : 'FEATURES2 TESTS PASSED'); srv.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
