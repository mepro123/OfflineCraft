'use strict';
// ===== Launcher essentials UI: library groups + sorting, launch options, log filter + share, world tools, capes, storage =====
const x2Err = e => toast(String((e && e.message) || e).replace(/^.*Error: /, ''), true);
const x2Size = b => b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(0) + ' MB' : b >= 1024 ? (b / 1024 | 0) + ' KB' : b + ' B';

// ------------------------------------------------------------------ Library: groups, sorting, loader filter
S.libGroup = ''; S.libLoader = ''; S.libSort = 'recent';
window.libApply = list => {
  const k = { recent: (a, b) => Math.max(b.lastPlayed || 0, b.created || 0) - Math.max(a.lastPlayed || 0, a.created || 0), name: (a, b) => a.name.localeCompare(b.name), played: (a, b) => (b.playTime || 0) - (a.playTime || 0), version: (a, b) => (typeof verOrder === 'function' ? verOrder(b.mc, a.mc) : 0) || a.name.localeCompare(b.name) }[S.libSort] || (() => 0);
  return list.filter(i => (!S.libGroup || (S.libGroup === '__none' ? !i.group : i.group === S.libGroup)) && (!S.libLoader || i.loader === S.libLoader)).sort(k);
};
window.libBar = () => {
  if (S.instances.length < 2) return '';
  const groups = [...new Set(S.instances.map(i => i.group).filter(Boolean))].sort(), loaders = [...new Set(S.instances.map(i => i.loader))];
  const chip = (act, v, label, on) => `<button class="cchip ${on ? 'on' : ''}" data-xact="${act}" data-v="${esc(v)}">${esc(label)}</button>`;
  return `<div class="row lib-bar" data-key="libbar" style="gap:8px;margin:0 0 14px;flex-wrap:wrap">${groups.length ? `<div class="cchips" style="margin:0">${chip('libgroup', '', 'All', !S.libGroup)}${groups.map(g => chip('libgroup', g, g, S.libGroup === g)).join('')}${S.instances.some(i => !i.group) ? chip('libgroup', '__none', 'Ungrouped', S.libGroup === '__none') : ''}</div>` : ''}${loaders.length > 1 ? `<div class="cchips" style="margin:0">${chip('libloader', '', 'Any loader', !S.libLoader)}${loaders.map(l => chip('libloader', l, LN(l), S.libLoader === l)).join('')}</div>` : ''}<div class="grow"></div><select data-xchg2="libsort" style="width:170px">${[['recent', 'Recently played'], ['name', 'Name'], ['played', 'Most played'], ['version', 'Newest version']].map(([k, l]) => `<option value="${k}" ${S.libSort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
};

// ------------------------------------------------------------------ Instance settings: launch options, notes, group, copy settings, shortcut
window.advPanel = i => {
  const id = esc(i.id), groups = [...new Set(S.instances.map(x => x.group).filter(Boolean))], others = S.instances.filter(x => x.id !== i.id), f = (k, label, tip, ph, wide) => `<div class="line"><div class="l"><b>${label}</b><span>${tip}</span></div><input data-ifield="${k}" data-id="${id}" value="${esc(i[k] || '')}" placeholder="${esc(ph || '')}" style="width:${wide || 300}px" spellcheck="false" autocomplete="off"></div>`;
  return `<div class="panel" data-key="xadv"><h2>Organize and launch options</h2>
  <div class="line"><div class="l"><b>Group</b><span>Instances with the same group are shown together. Use the chips at the top of the Library to filter by it.</span></div><div class="row"><input data-ifield="group" data-id="${id}" list="x-groups" value="${esc(i.group || '')}" placeholder="e.g. Survival, Modpacks" style="width:220px" autocomplete="off"><datalist id="x-groups">${groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist></div></div>
  <div class="line" style="align-items:flex-start"><div class="l"><b>Notes</b><span>Anything you want to remember about this instance.</span></div><textarea data-ifield="notes" data-id="${id}" placeholder="Seed, coordinates, mod list…" style="width:300px;height:70px">${esc(i.notes || '')}</textarea></div>
  ${f('gameArgs', 'Extra game arguments', 'Added after the normal Minecraft arguments.', '--quickPlayMultiplayer play.example.com')}
  ${f('wrapCmd', 'Wrapper command', 'The game is started through this program, for example <code>gamemoderun</code> or <code>prime-run</code>.', 'gamemoderun')}
  ${f('preCmd', 'Before launch', 'Runs on your PC right before the game starts. If it fails, the game is not started.', 'e.g. a backup script')}
  ${f('postCmd', 'After the game closes', 'Runs on your PC when the game exits. The exit code is in <code>INST_EXIT_CODE</code>.', 'e.g. a sync script')}
  <div class="line" style="align-items:flex-start"><div class="l"><b>Environment variables</b><span>One <code>NAME=value</code> per line. Also available to the commands above: <code>INST_NAME</code>, <code>INST_DIR</code>, <code>INST_MC_DIR</code>, <code>INST_MC_VER</code>.</span></div><textarea data-ifield="envVars" data-id="${id}" placeholder="__GL_THREADED_OPTIMIZATIONS=1" style="width:300px;height:70px;font-family:monospace;font-size:12px" spellcheck="false">${esc(i.envVars || '')}</textarea></div>
  <div class="chipwarn" style="margin:6px 0 2px">The commands above run on your PC every time you play. Only put commands in there that you trust.</div>
  ${others.length ? `<div class="line"><div class="l"><b>Copy settings from another instance</b><span>Copies options.txt (keybinds, video settings) and the multiplayer server list.</span></div><div class="row"><select id="x-copyfrom" style="width:200px">${others.map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}</select><button class="btn" data-xact="copyopts" data-id="${id}">Copy</button></div></div>` : ''}
  <div class="line"><div class="l"><b>Desktop shortcut</b><span>A shortcut that starts this instance directly. Or run the launcher with <code>--launch "${esc(i.name)}"</code>.</span></div><button class="btn" data-xact="shortcut" data-id="${id}">${ic('play')}Create shortcut</button></div></div>`;
};

// ------------------------------------------------------------------ Console: filter + share
const conApply = () => {
  const q = (($('#conq') || {}).value || '').toLowerCase(), errs = !!($('#conerr') || {}).checked, c = $('#con'); if (!c) return;
  for (const n of c.children) { const t = n.textContent.toLowerCase(); n.hidden = !!((q && !t.includes(q)) || (errs && !/error|exception|fatal|warn|caused by/.test(t))); }
};
document.addEventListener('input', e => { if (e.target.id === 'conq') conApply(); });
document.addEventListener('change', e => { if (e.target.id === 'conerr') conApply(); });
new MutationObserver(() => { const q = ($('#conq') || {}).value, errs = ($('#conerr') || {}).checked; if (q || errs) conApply(); }).observe(document.body, { childList: true, subtree: true });

// ------------------------------------------------------------------ Worlds: toolbar + per-world buttons
window.worldTools = () => `<button class="btn sm" data-xact="wimport" data-v="zip">${ic('download')}Import .zip</button><button class="btn sm" data-xact="wimport" data-v="folder">${ic('folder')}Import folder</button>`;
const afterWorlds0 = window.afterWorlds; window.afterWorlds = async function (i) {
  const row = document.querySelector('#tabbody > .row'); if (row && !row.querySelector('[data-xact=wimport]')) row.insertAdjacentHTML('beforeend', worldTools().replace(/data-xact="wimport"/g, `data-id="${esc(i.id)}" data-xact="wimport"`));
  return afterWorlds0 && afterWorlds0(i);
};

// ------------------------------------------------------------------ Skins page: capes (Microsoft accounts)
S.capes = null; let capesBusy = false;
async function loadCapes(force) { if (capesBusy || (S.capes && !force)) return; capesBusy = true; try { S.capes = await call('capeList'); } catch (e) { S.capes = { ms: true, capes: [], err: String(e.message || e).replace(/^.*Error: /, '') }; } capesBusy = false; if (S.page === 'skins') render(); }
window.capesPanel = () => {
  if (S._capeAcct !== S.settings.activeMs) { S._capeAcct = S.settings.activeMs; S.capes = null; }
  if (!S.settings.activeMs) return ''; if (!S.capes) { loadCapes(); return `<div class="panel" data-key="xcapes"><h2>Capes</h2>${loadingHtml('Loading your capes…')}</div>`; }
  const cs = S.capes.capes || [];
  return `<div class="panel" data-key="xcapes"><h2>Capes</h2>${S.capes.err ? `<div class="chipwarn">${esc(S.capes.err)}</div>` : ''}${cs.length ? `<div class="cape-grid">${cs.map(c => `<div class="cape ${c.active ? 'on' : ''}" data-key="cape:${esc(c.id)}"><div class="cape-img" style="background-image:url('${esc(c.url)}')"></div><b>${esc(c.alias)}</b><button class="btn sm ${c.active ? '' : 'primary'}" data-xact="capeset" data-id="${esc(c.active ? '' : c.id)}">${c.active ? 'Hide' : 'Equip'}</button></div>`).join('')}</div>` : `<div class="dim">${S.capes.err ? '' : 'This account does not own any capes. Capes come from Mojang events, Minecon and some purchases.'}</div>`}<div class="row" style="margin-top:10px"><button class="btn sm" data-xact="capesrefresh">${ic('refresh')}Refresh</button></div></div>`;
};

// ------------------------------------------------------------------ Settings: storage
S.storage = null;
window.storagePanel = () => `<div class="panel" data-key="xstore"><h2>Storage</h2><div class="dim" style="margin:-4px 0 10px">What the launcher keeps on your disk. Shared files like game versions and libraries are used by every instance.</div>${S.storage ? S.storage.map(r => `<div class="line"><div class="l"><b>${esc(r.label)}</b></div><div class="row"><span class="dim" style="min-width:70px;text-align:right">${x2Size(r.bytes)}</span>${({ cache: ['cache', 'Clear'], snapshots: ['snapshots', 'Clear'], backups: ['backups', 'Keep newest only'], versions: ['versions', 'Remove unused'], rust: ['rust', 'Remove old builds'] })[r.key] ? `<button class="btn sm" data-xact="storeclean" data-v="${r.key}">${({ cache: 'Clear', snapshots: 'Clear', backups: 'Keep newest only', versions: 'Remove unused', rust: 'Remove old builds' })[r.key]}</button>` : ''}</div></div>`).join('') + `<div class="line"><div class="l"><b>Total</b></div><b>${x2Size(S.storage.reduce((a, r) => a + r.bytes, 0))}</b></div>` : ''}<div class="row" style="margin-top:8px"><button class="btn" data-xact="storecalc">${ic('refresh')}${S.storage ? 'Recalculate' : 'Calculate sizes'}</button><button class="btn" data-act="opendata">${ic('folder')}Open data folder</button></div></div>`;

// ------------------------------------------------------------------ events
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-xact]'); if (!t) return; const id = t.dataset.id, v = t.dataset.v;
  switch (t.dataset.xact) {
    case 'libgroup': S.libGroup = v; render(); break;
    case 'libloader': S.libLoader = v; render(); break;
    case 'importprism': call('importPrism').then(r => { if (r && r.err) toast(r.err, true); }).catch(x2Err); break;
    case 'sharelog': if (!confirm('Upload this log to mclo.gs and get a link you can share?\n\nThe log can contain your username and file paths. Only share it with people you trust.')) break; try { toast('Uploading…'); const url = await call('shareLog', id); await navigator.clipboard.writeText(url).catch(() => {}); modal(`<h2>Log shared</h2><div class="dim" style="margin-bottom:10px">The link is copied to your clipboard.</div><input readonly value="${esc(url)}" style="width:100%" onclick="this.select()"><div class="foot"><button class="btn" data-act="closemodal">Close</button><button class="btn primary" data-act="dlink" data-u="${esc(url)}">Open</button></div>`); } catch (er) { x2Err(er); } break;
    case 'wimport': call('worldImport', id, v).then(r => { if (r && r.err) toast(r.err, true); else if (r) setTimeout(() => go('instance', id), 400); }).catch(x2Err); break;
    case 'wexport': call('worldExport', id, t.dataset.w).then(r => { if (r && r.err) toast(r.err, true); }).catch(x2Err); break;
    case 'wcopy': call('worldCopy', id, t.dataset.w).then(r => { if (r && r.err) toast(r.err, true); else setTimeout(() => go('instance', id), 600); }).catch(x2Err); break;
    case 'copyopts': { const from = ($('#x-copyfrom') || {}).value; if (!from || !confirm('Replace this instance\'s options.txt and server list with the ones from the other instance?')) break; try { const n = await call('copyOptions', from, id); toast(`Copied ${n} file${n > 1 ? 's' : ''}`); } catch (er) { x2Err(er); } break; }
    case 'shortcut': try { const r = await call('makeShortcut', id); if (r && r.err) toast(r.err, true); else toast('Shortcut created on your desktop'); } catch (er) { x2Err(er); } break;
    case 'capeset': try { const r = await call('capeSet', id || null); S.capes = { ms: true, capes: r.capes }; toast(id ? 'Cape equipped' : 'Cape hidden'); render(); } catch (er) { x2Err(er); } break;
    case 'capesrefresh': loadCapes(true); break;
    case 'storecalc': t.disabled = true; try { S.storage = await call('storageInfo'); render(); } catch (er) { x2Err(er); } break;
    case 'storeclean': { const msg = { cache: 'Clear the download cache?', snapshots: 'Delete the restore points that "Undo" uses?', backups: 'Delete all world backups except the newest one of each world?', versions: 'Delete game versions that no instance uses? They download again if you need them.', rust: 'Delete Horizon builds that no instance uses?' }[v]; if (!confirm(msg)) break; try { const freed = await call('storageClean', v); toast(`Freed ${x2Size(freed)}`); S.storage = await call('storageInfo'); render(); } catch (er) { x2Err(er); } break; }
  }
}, true);
document.addEventListener('change', e => {
  const t = e.target; if (!t.dataset) return;
  if (t.dataset.xchg2 === 'libsort') { S.libSort = t.value; render(); }
  else if (t.dataset.ifield) { const i = inst(t.dataset.id); if (!i) return; const v = t.value.trim(); i[t.dataset.ifield] = v; call('updateInstance', t.dataset.id, { [t.dataset.ifield]: v }).catch(x2Err); }
});
