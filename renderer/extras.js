'use strict';
// ===== Extra UI (loaded last): crash helper, backups, screenshots, version + updates, safe mode, export, Ctrl+K =====
const xErr = e => toast(String((e && e.message) || e).replace(/^.*Error: /, ''), true);
const xDate = t => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const verOrder = (a, b) => { const A = String(a).split('.').map(Number), B = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((A[i] || 0) !== (B[i] || 0)) return (A[i] || 0) - (B[i] || 0); return 0; };
const openInst = (id, tab) => { S.tab = tab; go('instance', id); };
Object.assign(IC, { camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>', shield: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/>', box: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>' });

// ------------------------------------------------------------------ crash helper
window.oc.on('crash', c => { S.crash = c; showCrash(c); });
function showCrash(c) {
  const acts = c.actions.map(a => `<button class="btn ${a.primary ? 'primary' : ''}" data-xact="crash" data-id="${esc(c.id)}" data-a="${esc(a.id)}">${esc(a.label)}</button>`).join('');
  modal(`<h2>${esc(c.title)}</h2><div class="dim" style="margin:-4px 0 12px">${esc(c.name)} closed with exit code ${c.code}</div><div class="crash-detail">${esc(c.detail).replace(/\n/g, '<br>')}</div>${c.mods && c.mods.length ? `<div class="chips" style="margin-top:10px">${c.mods.map(m => `<span class="chip">${esc(m)}</span>`).join('')}</div>` : ''}<div class="foot crash-foot">${acts}<button class="btn" data-act="closemodal">Close</button></div>`);
}
async function crashAction(id, a) {
  const c = S.crash || {};
  switch (a) {
    case 'console': closeModal(); openInst(id, 'console'); break;
    case 'mods': closeModal(); openInst(id, 'mods'); break;
    case 'backups': closeModal(); openInst(id, 'backups'); break;
    case 'copy': try { await navigator.clipboard.writeText(c.report || ''); toast('Crash report copied'); } catch { toast('Could not copy', true); } break;
    case 'safe': closeModal(); call('launch', id, { safe: true }); break;
    case 'updateall': closeModal(); call('updateEverything', id).catch(xErr); break;
    case 'undo': closeModal(); call('undoUpdate', id).catch(xErr); break;
    default: try { if (await call('crashFix', id, a)) { closeModal(); toast('Fixed. Press Play to try again.'); } } catch (e) { xErr(e); }
  }
}

// ------------------------------------------------------------------ extra tabs on the instance page
window.extraTab = function (i) { if (S.tab === 'backups') renderBackups(i); else if (S.tab === 'shots') renderShots(i); };
const REASON = { auto: 'Before playing', manual: 'Manual', update: 'Before an update', version: 'Before a version change' };
async function renderBackups(i) {
  const tb = $('#tabbody'); tb.innerHTML = loadingHtml('Loading backups…'); let list = [];
  try { list = await call('backupList', i.id); } catch (e) { xErr(e); } if (S.page !== 'instance' || S.tab !== 'backups' || S.sel !== i.id) return;
  const keep = S.settings.backupKeep || 5, byWorld = {}; for (const b of list) (byWorld[b.world] = byWorld[b.world] || []).push(b);
  const rows = Object.entries(byWorld).map(([w, arr]) => `<div class="cap-row">${esc(w)}</div>${arr.map(b => `<div class="item" data-key="bk:${esc(b.file)}"><div class="pic" style="background:var(--grad)">${ic('shield')}</div><div class="grow"><div class="n">${esc(xDate(b.ts))}</div><div class="s">${esc(REASON[b.reason] || b.reason)} · ${hsize(b.size)}</div></div><button class="btn sm" data-xact="bkrestore" data-id="${esc(i.id)}" data-f="${esc(b.file)}" data-w="${esc(w)}" data-t="${b.ts}">${ic('refresh')}Restore</button><button class="btn sm" data-xact="bkdel" data-id="${esc(i.id)}" data-f="${esc(b.file)}">${ic('trash')}</button></div>`).join('')}`).join('');
  tb.innerHTML = `<div class="row" style="margin-bottom:12px"><button class="btn primary" data-xact="bknow" data-id="${esc(i.id)}">${ic('plus')}Back up now</button><button class="btn" data-xact="bkfolder" data-id="${esc(i.id)}">${ic('folder')}Open folder</button><span class="dim">${S.settings.autoBackup === false ? 'Automatic backups are off (Settings)' : `Worlds are backed up before you play. The newest ${keep} of each world are kept.`}</span></div>${rows || `<div class="dim" style="padding:30px 0">No backups yet. They appear here the first time you play a world, or press "Back up now".</div>`}`;
}
async function renderShots(i) {
  const tb = $('#tabbody'); tb.innerHTML = loadingHtml('Loading screenshots…'); let list = [];
  try { list = await call('shotList', i.id); } catch (e) { xErr(e); } if (S.page !== 'instance' || S.tab !== 'shots' || S.sel !== i.id) return;
  tb.innerHTML = `<div class="row" style="margin-bottom:12px"><button class="btn" data-xact="shotfolder" data-id="${esc(i.id)}">${ic('folder')}Open folder</button><span class="dim">${list.length} screenshot${list.length === 1 ? '' : 's'} · press F2 in the game to take one</span></div>${list.length ? `<div class="shot-grid">${list.map(s => `<div class="shot" data-key="sh:${esc(s.file)}"><img loading="lazy" decoding="async" src="${esc(s.url)}" data-xact="shotview" data-u="${esc(s.url)}" alt=""><div class="shot-bar"><span>${esc(xDate(s.mtime))}</span><button class="btn sm icon" data-xact="shotcopy" data-id="${esc(i.id)}" data-f="${esc(s.file)}" data-tip="Copy image">${ic('copy')}</button><button class="btn sm icon" data-xact="shotshow" data-id="${esc(i.id)}" data-f="${esc(s.file)}" data-tip="Show in folder">${ic('folder')}</button><button class="btn sm icon" data-xact="shotdel" data-id="${esc(i.id)}" data-f="${esc(s.file)}" data-tip="Delete">${ic('trash')}</button></div></div>`).join('')}</div>` : `<div class="dim" style="padding:30px 0">No screenshots yet. Press F2 while playing.</div>`}`;
}
// worlds: size fills in after the list is shown
window.worldSub = e => `${e.mtime ? 'Played ' + ago(e.mtime / 1000) : 'World'}<span data-wsize="${esc(e.file)}"></span>`;
window.afterWorlds = async function (i) { try { const sz = await call('worldSizes', i.id); if (S.sel !== i.id || S.tab !== 'worlds') return; for (const [n, b] of Object.entries(sz)) { const el = [...document.querySelectorAll('[data-wsize]')].find(x => x.dataset.wsize === n); if (el) el.textContent = ' · ' + hsize(b); } } catch {} };

// ------------------------------------------------------------------ instance settings: version + updates
window.versionPanel = function (i) {
  const rust = i.loader === 'rust', modded = !['vanilla', 'rust'].includes(i.loader), id = esc(i.id);
  const rel = (S.versions || []).filter(v => v.type === 'release').map(v => v.id), list = rel.includes(i.mc) ? rel : [i.mc, ...rel];
  return `<div class="panel" data-key="xver"><h2>Version & updates</h2>
  <div class="line"><div class="l"><b>Minecraft version</b><span>${rust ? `Horizon (Rust) only supports ${esc(i.mc)}.` : `Move this instance to another version. Your worlds are backed up first${modded ? `, the loader and every mod move with it, and mods that have no build for the new version are turned off (never deleted)` : ''}. You can undo it.`}</span></div><div class="row"><select id="x-ver" style="width:150px" ${rust ? 'disabled' : ''}>${list.map(v => `<option value="${esc(v)}" ${v === i.mc ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select><button class="btn primary" data-xact="switchver" data-id="${id}" ${rust ? 'disabled' : ''}>Switch version</button></div></div>
  <div class="line"><div class="l"><b>Update everything</b><span>${rust ? 'Moves Horizon to its newest build.' : modded ? `Updates the loader and all mods for ${esc(i.mc)}. Worlds are backed up first, and it rolls back by itself if something fails.` : 'A vanilla instance has nothing to update. Switch the version above instead.'}</span></div><div class="row"><button class="btn" data-xact="updall" data-id="${id}" ${modded || rust ? '' : 'disabled'}>${ic('up')}Update everything</button><button class="btn" id="x-undo" data-xact="undo" data-id="${id}" style="display:none">${ic('back')}Undo last change</button></div></div>
  ${rust ? `<div class="line"><div class="l"><b>Horizon build</b><span id="x-rust">Checking for a newer build…</span></div></div>` : ''}
  ${modded ? `<div class="line"><div class="l"><b>Safe mode</b><span>Starts the game once with every mod set aside, to find out whether a mod is causing a crash. They come back when you close the game.</span></div><button class="btn" data-xact="safe" data-id="${id}">${ic('shield')}Launch without mods</button></div>` : ''}
  ${rust ? '' : `<div class="line"><div class="l"><b>Export modpack</b><span>Saves this instance as a .mrpack file that you can share or import again. Mods from Modrinth are linked, the rest is included in the file.</span></div><div class="row"><label class="tgl" style="gap:8px"><span>With worlds</span><span class="sw"><input type="checkbox" id="x-exp-worlds"><i></i></span></label><button class="btn" data-xact="export" data-id="${id}">${ic('box')}Export…</button></div></div>`}</div>`;
};
window.afterInstSettings = async function (i) {
  try { const u = await call('hasUndo', i.id), b = $('#x-undo'); if (b && u) { b.style.display = ''; b.title = u.why === 'version' ? 'Go back to Minecraft ' + u.mc : 'Go back to how it was before the last update'; } } catch {}
  if (i.loader === 'rust') { try { const r = await call('rustStatus', i.id), el = $('#x-rust'); if (el && r) el.innerHTML = r.outdated ? `You have <b>${esc(r.current || 'none')}</b>. A newer build is out: <b>${esc(r.latest)}</b>. Press "Update everything".` : r.latest ? `You are on the newest build (<b>${esc(r.current)}</b>).` : 'Could not check right now.'; } catch {} }
};
window.heroExtras = i => (!['vanilla', 'rust'].includes(i.loader) && !S.running[i.id] && !S.busy.includes(i.id)) ? `<button class="btn" data-xact="safe" data-id="${esc(i.id)}" data-tip="Start once without any mods">${ic('shield')}Safe mode</button>` : '';

// ------------------------------------------------------------------ settings: backups
window.backupsPanel = s => `<div class="panel" data-key="xbk"><h2>Backups</h2><div class="line"><div class="l"><b>Back up worlds before playing</b><span>A zipped copy of each changed world is saved before the game starts, so a corrupted or lost world can be restored from the instance's Backups tab.</span></div><label class="sw"><input type="checkbox" data-xchg="autobk" ${s.autoBackup === false ? '' : 'checked'}><i></i></label></div><div class="line"><div class="l"><b>Copies to keep</b><span>Per world. Older ones are deleted automatically.</span></div><select data-xchg="bkkeep" style="width:110px">${[2, 3, 5, 10, 20].map(n => `<option value="${n}" ${(s.backupKeep || 5) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>`;

// ------------------------------------------------------------------ click + change handling
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-xact]'); if (!t) return; const id = t.dataset.id, i = id && inst(id);
  switch (t.dataset.xact) {
    case 'crash': await crashAction(id, t.dataset.a); break;
    case 'safe': if (!S.settings.username) { toast('Add an account first', true); break; } toast('Starting without mods…'); call('launch', id, { safe: true }); break;
    case 'bknow': call('backupNow', id).then(r => { if (r && r.err) toast(r.err, true); else if (S.tab === 'backups') renderBackups(i); }).catch(xErr); break;
    case 'bkfolder': call('backupFolder', id); break;
    case 'bkrestore': if (confirm(`Restore "${t.dataset.w}" from ${xDate(+t.dataset.t)}?\n\nThe current copy of the world is kept next to it, nothing is deleted.`)) call('backupRestore', id, t.dataset.f).then(r => { if (r && r.err) toast(r.err, true); }).catch(xErr); break;
    case 'bkdel': if (confirm('Delete this backup?')) { await call('backupDelete', id, t.dataset.f); renderBackups(i); } break;
    case 'wbackup': call('backupNow', id, t.dataset.w).then(r => { if (r && r.err) toast(r.err, true); }).catch(xErr); break;
    case 'shotview': openLightbox(t.dataset.u); break;
    case 'shotcopy': try { toast(await call('shotCopy', id, t.dataset.f) ? 'Screenshot copied' : 'Could not copy', false); } catch (er) { xErr(er); } break;
    case 'shotshow': call('shotShow', id, t.dataset.f); break;
    case 'shotfolder': call('shotFolder', id); break;
    case 'shotdel': if (confirm('Delete this screenshot?')) { await call('shotDelete', id, t.dataset.f); renderShots(i); } break;
    case 'switchver': {
      const v = ($('#x-ver') || {}).value; if (!v || !i) break; if (v === i.mc) { toast('Already on ' + v); break; }
      const older = verOrder(v, i.mc) < 0;
      if (!confirm(`Switch "${i.name}" from ${i.mc} to ${v}?${older ? '\n\nGoing back to an OLDER version can stop newer worlds from loading. Your worlds are backed up first.' : ''}\n\nIt backs up your worlds, updates the loader and mods, and you can undo it afterwards.`)) break;
      call('changeVersion', id, v).then(r => { if (r && r.err) toast(r.err, true); }).catch(xErr); break;
    }
    case 'updall': call('updateEverything', id).then(r => { if (r && r.err) toast(r.err, true); }).catch(xErr); break;
    case 'undo': if (confirm('Go back to how this instance was before the last update or version change?')) call('undoUpdate', id).then(r => { if (r && r.err) toast(r.err, true); }).catch(xErr); break;
    case 'export': call('exportMrpack', id, { worlds: !!($('#x-exp-worlds') || {}).checked }).then(r => { if (r && r.err) toast(r.err, true); }).catch(xErr); break;
  }
}, true);
document.addEventListener('change', e => {
  const t = e.target; if (!t.dataset || !t.dataset.xchg) return;
  if (t.dataset.xchg === 'autobk') call('saveSettings', { autoBackup: t.checked });
  else if (t.dataset.xchg === 'bkkeep') call('saveSettings', { backupKeep: +t.value });
});

// ------------------------------------------------------------------ Ctrl+K command palette
let cmdSel = 0, cmdList = [];
function cmdItems() {
  const out = [], need = () => { if (!S.settings.username) { toast('Add an account first, top-right corner', true); return false; } return true; };
  for (const i of S.instances) {
    out.push({ t: 'Play ' + i.name, s: `Minecraft ${i.mc} · ${LN(i.loader)}`, i: 'play', run: () => { if (need()) call('launch', i.id); } });
    out.push({ t: 'Open ' + i.name, s: 'Instance', i: 'folder', run: () => openInst(i.id, 'mods') });
    if (!['vanilla', 'rust'].includes(i.loader)) out.push({ t: 'Safe mode: ' + i.name, s: 'Launch without mods', i: 'shield', run: () => { if (need()) call('launch', i.id, { safe: true }); } });
  }
  for (const a of (window.acctList ? acctList() : [])) if (!a.on) out.push({ t: 'Switch to ' + a.name, s: a.type === 'ms' ? 'Microsoft account' : 'Offline account', i: 'user', run: () => (a.type === 'ms' ? call('switchMs', a.id) : call('saveSettings', { username: a.name, activeMs: '' })).then(() => toast('Now playing as ' + a.name)) });
  for (const [p, l] of [['library', 'Library'], ['discover', 'Discover mods and modpacks'], ['skins', 'Skins'], ['accounts', 'Accounts'], ['host', 'Server'], ['settings', 'Settings']]) out.push({ t: 'Go to ' + l, s: 'Page', i: 'chev', run: () => go(p) });
  out.push({ t: 'New instance', s: 'Create a Minecraft instance', i: 'plus', run: () => createModal() }, { t: 'Import a modpack', s: '.mrpack file', i: 'download', run: () => call('importMrpack') }, { t: 'Add account', s: 'Microsoft or offline', i: 'user', run: () => addAcctModal() });
  return out;
}
function cmdRender() {
  const q = ($('#cmdq') || {}).value || '', toks = q.toLowerCase().split(/\s+/).filter(Boolean);
  cmdList = cmdItems().filter(x => toks.every(k => (x.t + ' ' + x.s).toLowerCase().includes(k))).sort((a, b) => (b.t.toLowerCase().startsWith(toks[0] || '~') ? 1 : 0) - (a.t.toLowerCase().startsWith(toks[0] || '~') ? 1 : 0)).slice(0, 9);
  cmdSel = Math.min(cmdSel, Math.max(0, cmdList.length - 1));
  $('#cmdlist').innerHTML = cmdList.map((x, n) => `<button class="cmd-item ${n === cmdSel ? 'on' : ''}" data-n="${n}"><span class="cmd-ic">${ic(x.i)}</span><span class="grow"><b>${esc(x.t)}</b><small>${esc(x.s)}</small></span></button>`).join('') || '<div class="dim" style="padding:16px">Nothing matches.</div>';
}
function cmdOpen() { let el = $('#cmdk'); if (!el) { el = document.createElement('div'); el.id = 'cmdk'; el.innerHTML = '<div class="cmd-box"><div class="cmd-in">' + ic('search') + '<input id="cmdq" placeholder="Play an instance, switch account, go to a page…" autocomplete="off" spellcheck="false"></div><div id="cmdlist"></div><div class="cmd-hint">↑ ↓ to move · Enter to run · Esc to close</div></div>'; document.getElementById('app').appendChild(el); el.addEventListener('mousedown', ev => { if (ev.target === el) cmdClose(); }); } cmdSel = 0; el.classList.add('on'); const q = $('#cmdq'); q.value = ''; cmdRender(); q.focus(); }
function cmdClose() { const el = $('#cmdk'); if (el) el.classList.remove('on'); }
function cmdRun(n) { const x = cmdList[n]; if (!x) return; cmdClose(); try { x.run(); } catch (e) { xErr(e); } }
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); const el = $('#cmdk'); el && el.classList.contains('on') ? cmdClose() : cmdOpen(); return; }
  const el = $('#cmdk'); if (!el || !el.classList.contains('on')) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cmdClose(); } else if (e.key === 'ArrowDown') { e.preventDefault(); cmdSel = Math.min(cmdList.length - 1, cmdSel + 1); cmdRender(); } else if (e.key === 'ArrowUp') { e.preventDefault(); cmdSel = Math.max(0, cmdSel - 1); cmdRender(); } else if (e.key === 'Enter') { e.preventDefault(); cmdRun(cmdSel); }
}, true);
document.addEventListener('input', e => { if (e.target.id === 'cmdq') { cmdSel = 0; cmdRender(); } });
document.addEventListener('click', e => { const b = e.target.closest('.cmd-item'); if (b) cmdRun(+b.dataset.n); });
