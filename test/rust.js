const fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto'), assert = require('assert'), os = require('os');
const AdmZip = require('adm-zip');
const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const block = src.slice(src.indexOf('// ---------------- Rust loader'), src.indexOf('// ---------------- prepare / launch'));
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-')); const P = (...a) => path.join(ROOT, ...a);
const sanitize = s => s.replace(/[<>:"/\\|?*]/g, '_');
const exists = p => fs.existsSync(p), fsize = p => { try { return fs.statSync(p).size; } catch { return -1; } };
const readJson = (p, d = {}) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const stage = (j, l) => { j.label = l; }; const LOG = () => {};
// fake release set up
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
const z = new AdmZip(); z.addFile('horizon-windows-x64/horizon-client.exe', Buffer.from('EXE'));
z.addFile('horizon-windows-x64/horizon-prepare.exe', Buffer.from(`#!/usr/bin/env node\nconst fs=require('fs'),p=require('path');fs.writeFileSync(p.join(process.env.TESTLOG),JSON.stringify({a:process.argv.slice(2),java:process.env.JAVA_HOME}));if(process.argv[2]==='--root'){const r=process.argv[3];fs.mkdirSync(p.join(r,'.local/horizon-client/26.3'),{recursive:true});fs.writeFileSync(p.join(r,'.local/horizon-client/26.3/horizon-resources.json'),'{}');}\n`));
z.addFile('horizon-windows-x64/research-lock.json', Buffer.from('{"minecraft":{"java_major":25}}'));
const zipBuf = z.toBuffer(); const sha = crypto.createHash('sha256').update(zipBuf).digest('hex');
let TAMPER = false, BADSIG = false;
const sums = Buffer.from(`${sha}  horizon-windows-x64.zip\n`);
const sign = tag => crypto.sign(null, Buffer.concat([Buffer.from(`horizon release ${tag}\n`), sums]), privateKey).toString('base64');
const rels = [{ tag_name: 'nightly', name: 'Nightly 2026-10-28 · 0c02067', prerelease: true, draft: false, published_at: '2026-10-28T10:00:00Z', assets: [{ name: 'horizon-windows-x64.zip', browser_download_url: 'https://x/nightly.zip' }] },
  { tag_name: 'launcher-v9.0.0', draft: false, assets: [{ name: 'horizon-launcher-windows-x64.zip' }] },
  { tag_name: 'v2026.10.13', name: 'v2026.10.13', prerelease: false, draft: false, assets: [{ name: 'horizon-windows-x64.zip', browser_download_url: 'https://x/v.zip' }] },
  { tag_name: 'v0.0.1', draft: true, assets: [{ name: 'horizon-windows-x64.zip' }] }];
const getJson = async () => rels;
const fetchRetry = async url => ({ arrayBuffer: async () => { if (url.endsWith('SHA256SUMS')) return sums; if (url.endsWith('.sig')) return Buffer.from((BADSIG ? sign('wrong') : sign(url.includes('/nightly/') ? 'nightly' : 'v2026.10.13')) + '\n'); throw new Error('unexpected ' + url); } });
const download = async (url, dest) => { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, TAMPER ? Buffer.concat([zipBuf, Buffer.from('x')]) : zipBuf); };
async function unzip(zipPath, dest) { const zz = new AdmZip(zipPath); for (const e of zz.getEntries()) { if (e.isDirectory) continue; const out = path.join(dest, e.entryName); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, e.getData()); fs.chmodSync(out, 0o755); } }
const settings = { username: 'Tham' };
const gameDir = i => P('instances', i.id, 'minecraft');
const vjsonPath = id => P('versions', id, id + '.json');
const downloadAll = async tasks => { for (const t of tasks) { fs.mkdirSync(path.dirname(t.dest), { recursive: true }); fs.writeFileSync(t.dest, 'jar'); } };
const javaHome = P('jdk25'); fs.mkdirSync(path.join(javaHome, 'bin'), { recursive: true }); fs.writeFileSync(path.join(javaHome, 'bin', 'java.exe'), '');
const pickJava = async (inst, major) => { assert.equal(major, 25); return path.join(javaHome, 'bin', 'java.exe'); };
fs.mkdirSync(P('versions', '26.3'), { recursive: true }); fs.writeFileSync(vjsonPath('26.3'), JSON.stringify({ downloads: { server: { url: 'u', size: 3 } } }));
process.env.TESTLOG = P('prep.json');
const api = new Function('require', 'fs', 'path', 'cp', 'crypto', 'P', 'ROOT', 'sanitize', 'exists', 'fsize', 'readJson', 'stage', 'LOG', 'getJson', 'fetchRetry', 'download', 'unzip', 'settings', 'gameDir', 'vjsonPath', 'downloadAll', 'pickJava', 'process',
  block.replace("keys: ['MU4oiIQcCxkZvbwSjjXs7SySCuM6ywRQ3nGaJYZG0gw=']", `keys: ['${raw}']`) + '\nreturn { RUST, rustVersionOf, rustVersions, installRust, prepareRust, rustLaunch, rustPrepared, rustInstalled, rustDir, rustRes };')(require, fs, path, cp, crypto, P, ROOT, sanitize, exists, fsize, readJson, stage, LOG, getJson, fetchRetry, download, unzip, settings, gameDir, vjsonPath, downloadAll, pickJava, process);
(async () => {
  // version naming + listing
  assert.equal(api.rustVersionOf(rels[0]), 'nightly-2026-10-28-0c02067'); assert.equal(api.rustVersionOf(rels[2]), 'v2026.10.13');
  assert.equal(api.rustVersionOf({ tag_name: 'nightly', name: 'x', published_at: '2026-10-29T00:00:00Z' }), 'nightly-2026-10-29');
  const vs = await api.rustVersions('26.3'); assert.deepEqual(vs.map(v => v.version), ['nightly-2026-10-28-0c02067', 'v2026.10.13']); assert(vs[0].stable);
  assert.deepEqual(await api.rustVersions('1.21'), []);
  // wrong MC refused
  await assert.rejects(api.installRust({ mc: '1.21', loaderVer: '' }, {}), /only supports Minecraft 26.3/);
  // tamper / bad signature refused, nothing installed
  TAMPER = true; let inst = { mc: '26.3', loaderVer: '' }; await assert.rejects(api.installRust(inst, {}), /does not match its signed checksum/); assert(!api.rustInstalled(inst.loaderVer && inst.loaderVer)); TAMPER = false;
  BADSIG = true; await assert.rejects(api.installRust({ mc: '26.3', loaderVer: '' }, {}), /signature does not match/); BADSIG = false;
  // good install (latest = nightly)
  inst = { id: 'I', mc: '26.3', loaderVer: '' }; await api.installRust(inst, {});
  assert.equal(inst.loaderVer, 'nightly-2026-10-28-0c02067'); assert.equal(inst.versionId, 'rust-nightly-2026-10-28-0c02067'); assert(api.rustInstalled(inst.loaderVer)); assert(!api.rustPrepared(inst.loaderVer));
  assert(!fs.existsSync(api.rustDir(inst.loaderVer) + '.partial'));
  // pinned tagged release install
  const i2 = { id: 'J', mc: '26.3', loaderVer: 'v2026.10.13' }; await api.installRust(i2, {}); assert(api.rustInstalled('v2026.10.13'));
  // prepare
  await api.prepareRust(inst, {}); assert(api.rustPrepared(inst.loaderVer));
  const rec = JSON.parse(fs.readFileSync(P('prep.json'), 'utf8')); assert(rec.a.includes('sounds') || rec.a.includes('--minecraft-dir'));
  assert.equal(rec.java, javaHome);
  // launch
  inst.id = 'I'; let lp = api.rustLaunch(inst); assert.deepEqual(lp.args, ['--resources', api.rustRes(inst.loaderVer), '--name', 'Tham']); assert(lp.java.endsWith('horizon-client.exe')); assert.equal(lp.cwd, gameDir(inst));
  lp = api.rustLaunch({ ...inst, width: 1280, height: 720 }); assert.equal(lp.args.slice(-4).join(' '), '--width 1280 --height 720');
  assert.throws(() => api.rustLaunch(i2), /not installed or prepared/);
  console.log('RUST TESTS PASSED');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
