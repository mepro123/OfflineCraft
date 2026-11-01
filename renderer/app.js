'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const IC = {
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  pin: '<path d="M12 17v5M9 3h6l-1 6 3 3H7l3-3z"/>',
  library: '<rect x="3" y="3" width="7" height="7" rx="1.8"/><rect x="14" y="3" width="7" height="7" rx="1.8"/><rect x="3" y="14" width="7" height="7" rx="1.8"/><rect x="14" y="14" width="7" height="7" rx="1.8"/>',
  discover: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/>',
  chev: '<path d="M6 9l6 6 6-6"/>', check: '<path d="M5 12l5 5L20 7"/>', download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>', copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 6M20 5v6h-6"/>', back: '<path d="M15 6l-6 6 6 6"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  terminal: '<path d="M4 6l6 6-6 6M12 18h8"/>', dl: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>', heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>', file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5"/>',
};
const ic = (n, cls = '') => `<svg viewBox="0 0 24 24" class="${cls}">${IC[n]}</svg>`;
const ACC = [['Emerald', '52,211,153'], ['Violet', '139,92,246'], ['Sky', '56,189,248'], ['Rose', '244,63,94'], ['Amber', '251,191,36']];
const LOADERS = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge', 'rust'];
const RUST_MC = '26.3';   // Horizon (Rust) only targets this Minecraft version
const LN = l => ({ vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge', rust: 'Rust' }[l] || l);
const hue = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; return h % 360; };
const grad = () => 'var(--grad)';
const instBg = i => { if (!i.color) return 'var(--grad)'; const c = hex2rgb(i.color); return `linear-gradient(135deg,rgb(${c}),rgb(${c.map(v => Math.round(v * .6))}))`; };
const cssUrl = u => `url('${String(u).replace(/'/g, '%27')}')`;
const instCover = i => i.coverUrl ? `${cssUrl(i.coverUrl)} center/cover no-repeat` : instBg(i);
const instIcon = i => i.iconUrl ? `<img src="${esc(i.iconUrl)}" alt="" decoding="async">` : letter(i.name);
const instFg = i => { if (!i.color) return 'var(--onacc)'; const c = hex2rgb(i.color); return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) > 165 ? '#101418' : '#ffffff'; };
const hsize = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : b < 1073741824 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1073741824).toFixed(2) + ' GB';
const hcount = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);
const ago = t => { if (!t) return 'Never played'; const d = Date.now() / 1000 - t; return d < 60 ? 'Just now' : d < 3600 ? (d / 60 | 0) + 'm ago' : d < 86400 ? (d / 3600 | 0) + 'h ago' : (d / 86400 | 0) + 'd ago'; };
const letter = s => esc((s || '?').trim()[0]?.toUpperCase() || '?');
// Every backend call that takes more than a moment shows the thin loading bar at the top (frequent background polling is excluded).
const QUIET_CALLS = new Set(['serverStatus', 'winGetBounds', 'winSetBounds', 'winIsMax', 'instanceStats', 'console', 'hostList', 'hostNet', 'identify', 'worldSizes', 'hasUndo', 'rustStatus', 'skinLibrary']);
let pendingCalls = 0, loadTimer = 0;
const call = (name, ...a) => {
  const quiet = QUIET_CALLS.has(name); if (!quiet && ++pendingCalls === 1) loadTimer = setTimeout(() => document.documentElement.classList.add('loading'), 350);
  const p = window.oc.call(name, ...a), done = () => { if (!quiet && --pendingCalls <= 0) { pendingCalls = 0; clearTimeout(loadTimer); document.documentElement.classList.remove('loading'); } };
  p.then(done, done); return p;
};
const loadingHtml = t => `<div class="loading-row"><span class="spin"></span><span>${t}</span></div>`;

const S = {
  settings: { accent: 0, accounts: [], username: '' }, instances: [], running: {}, busy: [], versions: [], javas: [], root: '',
  page: 'library', conSrc: 'launcher', sel: null, tab: 'mods', filter: '', content: [], conLines: [],
  disc: { type: 'mod', q: '', sort: 'relevance', mc: '', loader: '', target: '', offset: 0, res: null, loading: false, seq: 0, installed: new Set(), installing: new Set() },
  cr: { name: '', mc: '', loader: 'vanilla', lv: '', filter: '', rel: true, snap: false, old: false },
};
const inst = id => S.instances.find(i => i.id === id);

// ---------- tooltips ----------
const tipify = h => h.replace(/<b>([^<]*)<\/b><span>([^<]*)<\/span>/g, (m, t, d) => d.trim() ? `<b class="tl" data-tip="${d.replace(/"/g, '&quot;')}">${t}</b>` : `<b>${t}</b>`);
const tipEl = $('#tooltip'); let tipFor = null, tipTimer = 0;
function showTip(t) {
  tipEl.textContent = t.dataset.tip; const r = t.getBoundingClientRect(); tipEl.style.left = '0px'; tipEl.style.top = '0px'; const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  let pos = t.dataset.tipPos || 'top', x, y;
  const place = p => { if (p === 'right') { x = r.right + 10; y = r.top + r.height / 2 - h / 2; } else if (p === 'left') { x = r.left - w - 10; y = r.top + r.height / 2 - h / 2; } else if (p === 'bottom') { x = r.left + r.width / 2 - w / 2; y = r.bottom + 8; } else { x = r.left + r.width / 2 - w / 2; y = r.top - h - 8; } };
  place(pos); if (pos === 'top' && y < 6) place('bottom');
  tipEl.style.left = Math.max(8, Math.min(innerWidth - w - 8, x)) + 'px'; tipEl.style.top = Math.max(8, Math.min(innerHeight - h - 8, y)) + 'px'; tipEl.classList.add('on');
}
function hideTip() { clearTimeout(tipTimer); tipFor = null; tipEl.classList.remove('on'); }
document.addEventListener('mouseover', e => {
  const t = e.target.closest && e.target.closest('[data-tip]');
  if (!t) { if (tipFor) hideTip(); return; } if (t === tipFor) return; clearTimeout(tipTimer); tipFor = t; tipTimer = setTimeout(() => showTip(t), 140);
});
document.addEventListener('scroll', hideTip, true); document.addEventListener('mousedown', hideTip, true);

// ---------- shell ----------
const PRESETS = [['Emerald', '#34d399', '#34d399'], ['Violet', '#8b5cf6', '#8b5cf6'], ['Sky', '#38bdf8', '#38bdf8'], ['Rose', '#f43f5e', '#f43f5e'], ['Amber', '#fbbf24', '#fbbf24'],
  ['Aurora', '#34d399', '#22d3ee'], ['Sunset', '#f97316', '#ec4899'], ['Ocean', '#06b6d4', '#6366f1'], ['Neon', '#a855f7', '#ec4899'], ['Fire', '#ef4444', '#f59e0b'], ['Lime', '#a3e635', '#22c55e']];
const hex2rgb = h => { h = String(h || '#34d399').replace('#', ''); if (h.length === 3) h = [...h].map(c => c + c).join(''); const n = parseInt(h, 16) || 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const themeVars = { c: {}, setProperty(k, v) { v = String(v); if (this.c[k] === v) return; this.c[k] = v; document.documentElement.style.setProperty(k, v); } };
function applyTheme() {
  if (window.layoutGrips) queueMicrotask(window.layoutGrips);
  const s = S.settings, r = themeVars, A = hex2rgb(s.accentA), B = hex2rgb(s.accentB || s.accentA);
  r.setProperty('--a', A.join(',')); r.setProperty('--a2', B.join(','));
  r.setProperty('--grad', `linear-gradient(135deg,rgb(${A}),rgb(${B}))`); r.setProperty('--gradv', `linear-gradient(180deg,rgb(${A}),rgb(${B}))`);
  const lum = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; r.setProperty('--onacc', (lum(A) + lum(B)) / 2 > 150 ? '#04120c' : '#ffffff');
  const PC = hex2rgb(s.panelColor || '#12151c'), WC = hex2rgb(s.appColor || '#0b0d12'), lift = (c, k) => c.map(v => Math.min(255, Math.round(v + (255 - v) * k))), dark = (c, k) => c.map(v => Math.round(v * k));
  r.setProperty('--panel', `rgba(${PC},var(--pa,1))`); r.setProperty('--panel2', `rgba(${lift(PC, .045)},var(--pa,1))`); r.setProperty('--pop', `rgb(${lift(PC, .03)})`); r.setProperty('--bg', `rgb(${WC})`);
  { const so = (s.sidebarOpacity ?? 100) / 100; r.setProperty('--bar', `rgba(${dark(WC, .75)},${so})`); r.setProperty('--side', `rgba(${dark(WC, .75)},${so})`); r.setProperty('--glass-base', `rgba(${dark(WC, .75)},${(so * .5).toFixed(3)})`); }
  const light = lum(PC) > 150; r.setProperty('--text', light ? '#10131a' : '#e9edf5'); r.setProperty('--dim', light ? '#4f5870' : '#8a93a8'); r.setProperty('--dim2', light ? '#737c92' : '#5d667b'); r.setProperty('--line', light ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.07)');
  const app = $('#app'), hasBg = !!(s.bgUrl && s.bgType && s.bgType !== 'none'); app.classList.toggle('noanim', s.animations === false);
  const pos = sidePos(); placeSide(pos); { const lab = s.sidebarLabels !== false; if (S._lab !== undefined && S._lab !== lab) trackInd(450); S._lab = lab; } app.classList.toggle('lite', ((S.gfx && S.gfx.level) || 0) >= 6);
  app.classList.toggle('has-bg', hasBg); app.classList.toggle('pblur', hasBg && (s.panelBlur || 0) > 0); r.setProperty('--pblur', (s.panelBlur || 0) + 'px'); app.classList.toggle('sblur', (s.sidebarBlur || 0) > 0); r.setProperty('--sblur', (s.sidebarBlur || 0) + 'px'); app.classList.remove('sb-left', 'sb-right', 'sb-top', 'sb-bottom'); app.classList.add('sb-' + pos); app.classList.toggle('sb-bar', !!s.secondBar); app.classList.toggle('lglass', !!s.sidebarGlass); { const d = $('#lg-disp'); if (d) d.setAttribute('scale', s.glassRefract ?? 14); } app.classList.toggle('sb-compact', s.sidebarLabels === false);
  if (window.looksApply) looksApply(s, hasBg);
  r.setProperty('--pa', hasBg ? (s.panelOpacity ?? 88) / 100 : 1); r.setProperty('--bgdim', (s.bgDim ?? 45) / 100); r.setProperty('--bgblur', (s.bgBlur || 0) + 'px');
  { const z = (s.uiScale || 100) / 100; r.setProperty('--win-r-set', (s.winRadius ?? 12) / z + 'px'); r.setProperty('--m-full', (s.winMargin || 14) / z + 'px'); } document.documentElement.classList.toggle('rounded', !!s.winRounded);
  { const oc = hex2rgb(s.outlineColor || '#ffffff'); r.setProperty('--ol', `rgba(${oc},${(s.outlineOpacity ?? 30) / 100})`); r.setProperty('--ol-w', (s.outlineSize ?? 2) + 'px'); }
  const bg = $('#bg'), key = hasBg ? s.bgType + s.bgUrl : '';
  const keyChanged = bg.dataset.key !== key;
  if (keyChanged) { bg.dataset.key = key; bg.innerHTML = !hasBg ? '' : s.bgType === 'video' ? `<video src="${esc(s.bgUrl)}" autoplay muted loop playsinline disablepictureinpicture preload="auto"></video>` : `<img src="${esc(s.bgUrl)}" alt="">`; }
  bg.classList.toggle('blurred', (s.bgBlur || 0) > 0);
  if (keyChanged) setTimeout(updateBgPlayback, 50);
}
// the separate bar always shows the navigation in the title row
const sidePos = () => S.settings.sidebarPos || 'left';
function trackInd(ms = 450) { const end = performance.now() + ms; const step = () => { moveInd(false); if (performance.now() < end) requestAnimationFrame(step); }; requestAnimationFrame(step); }
function placeSide(pos) {
  const side = $('#side'), tb = $('#titlebar'), body = $('#body'); if (!side) return; const changed = S._pos !== undefined && S._pos !== pos; S._pos = pos;
  const acct = $('#acct'), bar = !!S.settings.secondBar && (pos === 'top' || pos === 'bottom');
  if (pos === 'top') { if (side.parentElement !== tb) tb.insertBefore(side, acct.parentElement === tb ? acct : $('.winbtns')); }
  else if (side.parentElement !== body) body.insertBefore(side, $('#main'));
  if (bar && acct.parentElement !== side) side.appendChild(acct);
  else if (!bar && acct.parentElement !== tb) tb.insertBefore(acct, $('.winbtns'));
  if (changed) { side.classList.remove('sidein'); void side.offsetWidth; side.classList.add('sidein'); trackInd(500); }
}
const applyAccent = applyTheme;
// background playback manager: pause when it can't be seen / when the game is running
function bgShouldPause() { const s = S.settings; return document.hidden || (s.bgPauseUnfocused !== false && !document.hasFocus()); }
function updateBgPlayback() {
  const bg = $('#bg'), s = S.settings; if (!bg || !bg.firstElementChild) return; const pause = bgShouldPause(), v = bg.querySelector('video');
  if (v) { if (pause) { if (!v.paused) v.pause(); } else if (v.paused) v.play().catch(() => {}); return; }
  if (/\.gif(\?|$)/i.test(s.bgUrl || '')) {
    const img = bg.querySelector('img'), cv = bg.querySelector('canvas');
    if (pause && img && img.complete && img.naturalWidth) { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); img.replaceWith(c); }
    else if (!pause && cv) { const i = new Image(); i.alt = ''; i.src = s.bgUrl; cv.replaceWith(i); }
  }
}
window.addEventListener('blur', updateBgPlayback); window.addEventListener('focus', updateBgPlayback); document.addEventListener('visibilitychange', updateBgPlayback);
function avatarHtml(name, msId) {
  const s = S.settings, ms = msId && (s.msAccounts || []).find(x => x.id === msId), sk = !msId && s.skins && s.skins[name], url = ms ? ms.skinUrl : (sk && sk.url);
  if (url) { const u = cssUrl(url); return `<div class="avatar face" style="background-image:${u},${u}"></div>`; }
  return msId ? `<div class="avatar" style="background:var(--grad)"><img class="pimg" loading="lazy" decoding="async" data-l="${letter(name)}" src="https://mc-heads.net/avatar/${esc(msId)}/64" alt=""></div>` : `<div class="avatar" style="background:${grad(name)}">${letter(name)}</div>`;
}
function renderTop() {
  const u = S.settings.username;
  if (!u) { morph($('#acct'), `<button class="btn primary sm" data-key="acct:add" data-act="addacct">${ic('plus')}Add account</button>`); return; }
  morph($('#acct'), `<button class="pill" data-key="acct:pill" data-act="acctmenu">${avatarHtml(u, S.settings.activeMs)}<b style="font-weight:600">${esc(u)}</b>${ic('chev')}</button>`);
}
const NAV_ITEMS = [['library', 'Library', 'library'], ['discover', 'Discover', 'discover'], ['skins', 'Skins', 'user'], ['accounts', 'Accounts', 'users'], ['host', 'Server', 'server']];
function navList() { const o = (S.settings.navOrder || []).filter(id => NAV_ITEMS.some(n => n[0] === id)); NAV_ITEMS.forEach(n => { if (!o.includes(n[0])) o.push(n[0]); }); return o.map(id => NAV_ITEMS.find(n => n[0] === id)); }
function renderSide() {
  requestAnimationFrame(() => moveInd(true));
  const n = (id, label, icon) => `<button data-key="nav:${id}" class="nav ${S.page === id || (id === 'library' && S.page === 'instance') || (id === 'settings' && S.page === 'console') ? 'on' : ''}" data-act="nav" data-p="${id}" ${S.settings.sidebarLabels === false ? `data-tip="${label}" data-tip-pos="${({ right: 'left', top: 'bottom', bottom: 'top' })[sidePos()] || 'right'}"` : ''}>${ic(icon)}<span class="lbl">${label}</span>${id === 'library' && S.instances.length ? `<span class="badge">${S.instances.length}</span>` : ''}</button>`;
  const hid = S.settings.navHidden || [];
  morph($('#navitems'), navList().filter(([id]) => id === 'library' || !hid.includes(id)).map(([id, l, i]) => n(id, l, i)).join('') + '<div class="grow"></div>' + n('settings', 'Settings', 'settings'), { animate: false });
}
let indReady = false;
function moveInd(anim) {
  const ind = $('#navind'), side = $('#side'), on = side && side.querySelector('.nav.on'); if (!on) { ind.style.opacity = 0; return; }
  const sr = side.getBoundingClientRect(), nr = on.getBoundingClientRect();
  ind.classList.toggle('noanim', !anim || !indReady);
  ind.style.opacity = 1; ind.style.width = nr.width + 'px'; ind.style.height = nr.height + 'px';
  const tf = `translate(${nr.left - sr.left - side.clientLeft}px,${nr.top - sr.top - side.clientTop}px)`;
  ind.style.transform = tf; indReady = true;
}
new ResizeObserver(() => moveInd(false)).observe($('#side'));
function pgAnim(el) { if (!el) return; el.classList.remove('pg'); void el.offsetWidth; el.classList.add('pg'); }
function render(anim) {
  if (document.readyState !== 'complete') return; S.animIn = !!anim; applyAccent(); renderTop(); renderSide(); const m = $('#main'); const sc = m.scrollTop; const html = ({ library: pgLibrary, discover: pgDiscover, instance: pgInstance, settings: pgSettings, console: pgConsole, skins: pgSkins, host: pgHost, accounts: pgAccounts })[S.page](); if (anim || !m.firstElementChild) m.innerHTML = html; else morph(m, html, { animate: true }); if (S.page === 'discover') { renderResults(); } if (S.page === 'instance') afterInstance(); if (S.page === 'console') afterConsole(); if (S.page === 'host') afterHost(); if (S.page === 'skins') afterSkins(); m.scrollTop = sc; if (anim) pgAnim(m); }
function go(p, sel) { if (p === 'host') hostEnter(); S.page = p; if (sel !== undefined) S.sel = sel; closePop(); render(true); if (p === 'skins') loadSkinLib().then(() => { if (S.page === 'skins') render(); }); if (p === 'discover') { ensureTarget(); refreshInstalled(); if (!S.disc.res) runSearch(); } }

// ---------- library ----------
function pgLibrary() {
  if (S.libTab === 'servers') return pgServers();
  const list = (window.libApply ? libApply(S.instances) : S.instances).filter(i => i.name.toLowerCase().includes(S.filter.toLowerCase()));
  const head = `<div class="page-head"><h1>Library</h1>${libSeg()}<div class="grow"></div><div class="search"><input id="libq" placeholder="Search instances" value="${esc(S.filter)}">${ic('search')}</div><button class="btn" data-act="import">${ic('file')}Import .mrpack</button><button class="btn" data-xact="importprism" data-tip="Bring in an instance exported from MultiMC or Prism Launcher">${ic('file')}MultiMC / Prism</button><button class="btn primary" data-act="new">${ic('plus')}New instance</button></div>`;
  if (!S.instances.length) return head + `<div class="empty"><div><h3>No instances yet</h3><div>Create one, import a modpack, or grab a modpack from Discover.</div><div class="row" style="justify-content:center"><button class="btn primary" data-act="new">${ic('plus')}Create instance</button><button class="btn" data-act="nav" data-p="discover">Browse modpacks</button></div></div></div>`;
  const last = [...S.instances].filter(i => i.lastPlayed > 0).sort((x, y) => y.lastPlayed - x.lastPlayed)[0];
  const cont = last && !S.filter ? `<div class="cont" data-key="cont" style="--cover:${instCover(last)}"><div class="ic ${last.iconUrl ? 'img' : ''}" style="background:${last.iconUrl ? 'var(--panel)' : instBg(last)};color:${instFg(last)}">${instIcon(last)}</div><div class="grow"><div class="eyebrow">CONTINUE PLAYING</div><h2>${esc(last.name)}</h2><div class="chips"><span class="chip">${esc(last.mc)}</span><span class="chip acc">${LN(last.loader)}</span><span class="chip">${ago(last.lastPlayed)}</span><span class="chip">${(last.playTime / 3600 | 0)}h ${(last.playTime / 60 % 60 | 0)}m played</span></div></div>${playBtn(last)}</div>` : '';
  const pins = list.filter(i => i.pinned), rest = list.filter(i => !i.pinned), grid = (k, arr, off) => `<div class="grid ${S.animIn ? 'stagger' : ''}" data-key="grid:${k}">${arr.map((i, n) => card(i, n + off)).join('')}</div>`;
  return head + (window.libBar ? libBar() : '') + cont + (pins.length ? `<div class="sect" data-key="sect:pin">${ic('pin')}Pinned <span>${pins.length}</span></div>${grid('pin', pins, 0)}` : '') + (rest.length || !pins.length ? `<div class="sect" data-key="sect:all">${S.filter ? 'Results' : pins.length ? 'Other instances' : 'All instances'} <span>${rest.length}</span></div>${grid('all', rest, pins.length)}` : '');
}
function playBtn(i, big) {
  const run = S.running[i.id], b = S.busy.includes(i.id);
  if (run) return `<button class="btn danger" data-key="play:${esc(i.id)}:run" data-act="stop" data-id="${esc(i.id)}">${ic('stop')}Stop</button>`;
  if (b) return `<button class="btn" data-key="play:${esc(i.id)}:busy" disabled>Working…</button>`;
  return `<button class="btn primary" data-key="play:${esc(i.id)}:idle" data-act="play" data-id="${esc(i.id)}">${ic('play')}Play</button>`;
}
function card(i, idx = 0) {
  return `<div class="card" data-key="card:${esc(i.id)}" style="--d:${Math.min(idx, 12) * 28}ms" data-act="open" data-id="${esc(i.id)}"><div class="cover" style="background:${instCover(i)}">${i.pinned ? `<span class="pinmark">${ic('pin')}</span>` : ''}<button class="more" data-act="menu" data-id="${esc(i.id)}">${ic('more')}</button><div class="ic ${i.iconUrl ? 'img' : ''}" style="background:${i.iconUrl ? 'var(--panel)' : instBg(i)};color:${instFg(i)}">${instIcon(i)}</div></div>
  <div class="card-body"><div class="card-title">${esc(i.name)}</div><div class="chips"><span class="chip">${esc(i.mc)}</span><span class="chip acc">${LN(i.loader)}</span></div><div class="sub">${ago(i.lastPlayed)} · ${(i.playTime / 3600 | 0)}h ${(i.playTime / 60 % 60 | 0)}m played</div>${playBtn(i)}</div></div>`;
}

// ---------- instance page ----------
const KINDS = { mods: ['mod', 'Mods'], resourcepacks: ['resourcepack', 'Resource packs'], shaders: ['shader', 'Shaders'], worlds: ['world', 'Worlds'] };
function pgInstance() {
  const i = inst(S.sel); if (!i) { S.page = 'library'; return pgLibrary(); }
  const tabs = [...Object.entries(KINDS).map(([k, v]) => [k, v[1]]), ['shots', 'Screenshots'], ['backups', 'Backups'], ['console', 'Console'], ['settings', 'Settings']];
  return `<button class="btn sm" data-act="nav" data-p="library" style="margin-bottom:16px">${ic('back')}Library</button>
  <div class="hero" style="--cover:${instCover(i)}"><div class="ic ${i.iconUrl ? 'img' : ''}" style="background:${i.iconUrl ? 'var(--panel)' : instBg(i)};color:${instFg(i)}">${instIcon(i)}</div><div class="grow"><h1>${esc(i.name)}</h1><div class="chips"><span class="chip">Minecraft ${esc(i.mc)}</span><span class="chip acc">${LN(i.loader)}${i.loaderVer ? ' ' + esc(i.loaderVer) : ''}</span><span class="chip">${ago(i.lastPlayed)}</span></div></div>${window.heroExtras ? heroExtras(i) : ''}${playBtn(i, true)}</div>
  <div class="stats" id="stats"><div class="stat"><b>${(i.playTime / 3600 | 0)}h ${(i.playTime / 60 % 60 | 0)}m</b><span>Play time</span></div><div class="stat"><b id="st-mods" data-morph="skip">–</b><span>Mods</span></div><div class="stat"><b id="st-packs" data-morph="skip">–</b><span>Resource packs</span></div><div class="stat"><b id="st-worlds" data-morph="skip">–</b><span>Worlds</span></div></div>
  <div class="tabs">${tabs.map(([k, l]) => `<button class="${S.tab === k ? 'on' : ''}" data-act="tab" data-t="${k}">${l}</button>`).join('')}</div><div id="tabbody" data-morph="skip"></div>`;
}
async function afterInstance() {
  const i = inst(S.sel); if (!i) return; const tb = $('#tabbody');
  call('instanceStats', i.id).then(s => { if (!s || S.sel !== i.id || !$('#st-mods')) return; $('#st-mods').textContent = s.mods; $('#st-packs').textContent = s.packs; $('#st-worlds').textContent = s.worlds; });
  if (S.tab === 'shots' || S.tab === 'backups') { window.extraTab(i); return; }
  if (KINDS[S.tab]) { tb.innerHTML = loadingHtml('Loading…'); S.content = await call('listContent', i.id, KINDS[S.tab][0]); renderContent(); if (S.tab === 'worlds' && window.afterWorlds) window.afterWorlds(i); if (S.tab !== 'worlds') call('identify', i.id).then(async ch => { if (ch && S.page === 'instance' && S.sel === i.id && KINDS[S.tab]) { S.content = await call('listContent', i.id, KINDS[S.tab][0]); renderContent(); } }); }
  else if (S.tab === 'console') { S.conLines = await call('console', i.id); tb.innerHTML = `<div class="row" style="margin-bottom:10px"><button class="btn sm" data-act="copycon">${ic('copy')}Copy all</button><button class="btn sm" data-xact="sharelog" data-id="${esc(i.id)}" data-tip="Upload to mclo.gs and get a link">${ic('up')}Share log</button><input id="conq" placeholder="Filter lines…" style="width:190px;height:30px" autocomplete="off"><label class="tgl" style="gap:6px"><span>Warnings and errors only</span><span class="sw"><input type="checkbox" id="conerr"><i></i></span></label></div><div class="console" id="con"></div>`; const c = $('#con'); c.innerHTML = S.conLines.length ? S.conLines.map(conLine).join('') : '<span class="dim">Launch the game to see its live output here.</span>'; c.scrollTop = c.scrollHeight; }
  else { morph(tb, instSettings(i), { animate: false }); if (window.afterInstSettings) window.afterInstSettings(i); }
}
const conLine = l => `<div class="${/ERROR|Exception|FATAL/.test(l) ? 'e' : /WARN/.test(l) ? 'w' : l.startsWith('[launcher]') ? 'l' : ''}">${esc(l)}</div>`;
function renderContent() {
  const i = inst(S.sel), tb = $('#tabbody'); if (!tb || !i) return; const kind = KINDS[S.tab][0], name = KINDS[S.tab][1].toLowerCase();
  const bar = `<div class="row" style="margin-bottom:14px">${kind !== 'world' ? `<button class="btn primary" data-act="browse">${ic('plus')}Browse ${name}</button>` : ''}${kind === 'mod' ? `<button class="btn" data-act="updmods">${ic('up')}Update all</button>` : ''}<button class="btn" data-act="folder" data-sub="${{ mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks', world: 'saves' }[kind]}">${ic('folder')}Open folder</button><button class="btn icon" data-act="refreshc" title="Refresh">${ic('refresh')}</button><span class="dim">${S.content.length} ${name}</span></div>`;
  const rows = S.content.map(e => `<div class="item ${e.enabled ? '' : 'off'}" data-key="item:${esc(e.file)}"><div class="pic" style="background:${e.icon ? 'none' : grad(e.file)}">${e.icon ? `<img class="pimg" loading="lazy" decoding="async" data-l="${letter(e.title)}" src="${esc(e.icon)}" width="40" height="40" style="object-fit:contain">` : letter(e.title)}</div><div class="grow"><div class="n">${esc(e.title)}</div><div class="s">${e.ver ? esc(e.ver) + ' · ' : ''}${kind === 'world' && window.worldSub ? worldSub(e) : e.dir ? 'folder' : hsize(e.size)}</div></div>${kind !== 'world' ? `<label class="sw"><input type="checkbox" ${e.enabled ? 'checked' : ''} data-act="toggle" data-f="${esc(e.file)}"><i></i></label>` : ''}${kind === 'world' ? `<button class="btn sm" data-xact="wbackup" data-id="${esc(i.id)}" data-w="${esc(e.file)}">${ic('download')}Back up</button><button class="btn sm" data-xact="wexport" data-id="${esc(i.id)}" data-w="${esc(e.file)}" data-tip="Save as a .zip">${ic('up')}Export</button><button class="btn sm" data-xact="wcopy" data-id="${esc(i.id)}" data-w="${esc(e.file)}" data-tip="Make a copy of this world">${ic('copy')}Copy</button>` : ''}<button class="btn sm" data-act="rmc" data-f="${esc(e.file)}">${ic('trash')}</button></div>`).join('');
  morph(tb, bar + (rows || `<div class="dim" style="padding:30px 0">${kind === 'world' ? 'No worlds yet — they appear here after you play.' : 'Nothing installed yet. Use Browse to add some.'}</div>`), { animate: false });
}
function instSettings(i) { return tipify(instSettingsRaw(i)); }
function instSettingsRaw(i) {
  const ram = i.ramMB || S.settings.ramMB;
  return `${window.versionPanel ? versionPanel(i) : ''}${window.advPanel ? advPanel(i) : ''}<div class="panel"><div class="line"><div class="l"><b>Name</b></div><input id="i-name" value="${esc(i.name)}" style="width:300px"></div>
  <div class="line"><div class="l"><b>Logo</b><span>Your own icon for this instance. Reset goes back to the letter tile.</span></div><div class="row">${i.iconUrl ? `<img data-key="ic-thumb" class="bgthumb" style="width:48px;height:48px;border-radius:12px" src="${esc(i.iconUrl)}">` : ''}<button class="btn sm" data-key="ic-choose" data-act="pickimg" data-kind="icon">${ic('file')}Choose…</button>${i.iconUrl ? `<button class="btn sm" data-key="ic-reset" data-act="clearimg" data-kind="icon">Reset</button>` : ''}</div></div>
  <div class="line"><div class="l"><b>Card background</b><span>Image shown behind this instance's card and page header. Reset goes back to the color.</span></div><div class="row">${i.coverUrl ? `<img data-key="cv-thumb" class="bgthumb" src="${esc(i.coverUrl)}">` : ''}<button class="btn sm" data-key="cv-choose" data-act="pickimg" data-kind="cover">${ic('file')}Choose…</button>${i.coverUrl ? `<button class="btn sm" data-key="cv-reset" data-act="clearimg" data-kind="cover">Reset</button>` : ''}</div></div>
  <div class="line"><div class="l"><b>Card color</b><span>Color of this instance's card and icon. "Use accent" follows your theme color.</span></div><div class="row"><input type="color" id="i-color" value="${esc(i.color || S.settings.accentA || '#34d399')}"><button class="btn sm" data-act="icolor-reset">Use accent</button></div></div>
  <div class="line"><div class="l"><b>Memory</b><span>${i.ramMB ? 'Custom for this instance' : 'Using global default'}</span></div><div class="row"><input type="range" id="i-ram" min="1024" max="16384" step="256" value="${ram}"><b id="i-ramv" style="width:70px">${ram} MB</b><button class="btn sm" data-act="ramreset">Global</button></div></div>
  <div class="line"><div class="l"><b>Java</b><span>Auto picks the version Minecraft needs</span></div><select id="i-java" style="width:300px"><option value="">Auto (best match)</option>${S.javas.map(j => `<option value="${esc(j.exe)}" ${j.exe === i.javaPath ? 'selected' : ''}>Java ${esc(j.ver)} — ${esc(j.exe)}</option>`).join('')}</select></div>
  <div class="line"><div class="l"><b>Graphics report</b><span>Copies technical details about your graphics driver and any crashes, so you can send them to the developer.</span></div><button class="btn sm" data-act="gpureport">Copy report</button></div>
  <div class="line"><div class="l"><b>Extra JVM arguments</b></div><input id="i-jvm" value="${esc(i.jvmArgs)}" style="width:300px"></div>
  <div class="line"><div class="l"><b>Window size</b><span>0 = default</span></div><div class="row"><input id="i-w" type="number" value="${i.width}" style="width:90px"> × <input id="i-h" type="number" value="${i.height}" style="width:90px"></div></div>
  <div class="line"><div class="l"><b>Start fullscreen</b></div><label class="sw"><input type="checkbox" id="i-fs" ${i.fullscreen ? 'checked' : ''}><i></i></label></div></div>
  <div class="row"><button class="btn" data-act="repair">${ic('refresh')}Verify / repair files</button><button class="btn" data-act="folder" data-sub="root">${ic('folder')}Instance folder</button><button class="btn danger" data-act="del" data-id="${esc(i.id)}">${ic('trash')}Delete</button></div>
  <p class="dim" style="margin-top:14px">Version id: ${esc(i.versionId || '—')}</p>`;
}

// ---------- discover ----------
const DTYPES = [['mod', 'Mods'], ['modpack', 'Modpacks'], ['resourcepack', 'Resource Packs'], ['shader', 'Shaders']];
const DCATS = { mod: ['optimization', 'utility', 'adventure', 'technology', 'magic', 'worldgen', 'decoration', 'library', 'equipment', 'mobs', 'storage', 'food'], modpack: ['optimization', 'lightweight', 'adventure', 'magic', 'technology', 'quests', 'multiplayer', 'kitchen-sink', 'combat'], resourcepack: ['16x', '32x', '64x', 'vanilla-like', 'themed', 'gui', 'audio', 'fonts', 'realistic', 'cursed'], shader: ['realistic', 'semi-realistic', 'vanilla-like', 'cartoon', 'fantasy', 'potato', 'low', 'medium', 'high'] };
const catName = c => c.replace(/-/g, ' ').replace(/^./, x => x.toUpperCase());
function ensureTarget() { const d = S.disc; if (!d.target || !inst(d.target)) { const i = inst(S.sel) || S.instances[0]; if (i) setTarget(i.id, false); } }
function refreshInstalled() {
  const d = S.disc, id = d.target; if (!id) return;
  call('installedIds', id).then(x => { if (d.target === id) { d.installed = new Set(x); renderResults(); } });
  call('identify', id).then(ch => { if (ch && d.target === id) call('installedIds', id).then(x => { if (d.target === id) { d.installed = new Set(x); renderResults(); } }); });
}
function setTarget(id, search = true) { const d = S.disc, i = inst(id); d.target = id; if (i) { d.mc = i.mc; d.loader = i.loader === 'vanilla' || i.loader === 'rust' ? '' : i.loader; d.installed = new Set(); refreshInstalled(); } if (search) { d.offset = 0; runSearch(); } }
function pgDiscover() {
  const d = S.disc, packs = d.type === 'modpack', rel = S.versions.filter(v => v.type === 'release').slice(0, 90);
  const noInst = !packs && !S.instances.length;
  return `<div class="page-head"><h1>Discover</h1><span class="dim">powered by Modrinth</span></div>${noInst ? `<div class="panel" style="display:flex;align-items:center;gap:16px;border-color:rgba(var(--a),.4)"><div class="grow"><b>You don't have any instances yet.</b><div class="dim">Mods, resource packs and shaders install into an instance. Create one first (modpacks create their own).</div></div><button class="btn primary" data-act="new">${ic('plus')}Create instance</button></div>` : ''}
  <div class="seg">${DTYPES.map(([k, l]) => `<button class="${d.type === k ? 'on' : ''}" data-act="dtype" data-t="${k}">${l}</button>`).join('')}</div>
  <div class="cchips"><button class="cchip ${!d.cat ? 'on' : ''}" data-act="dcat" data-c="">All</button>${(DCATS[d.type] || []).map(c => `<button class="cchip ${d.cat === c ? 'on' : ''}" data-act="dcat" data-c="${c}">${catName(c)}</button>`).join('')}</div>
  <div class="filters"><div class="search"><input id="dq" placeholder="Search Modrinth…" value="${esc(d.q)}">${ic('search')}</div>
  ${!packs ? `<select id="dtarget">${S.instances.length ? '' : '<option>No instance</option>'}${S.instances.map(i => `<option value="${esc(i.id)}" ${i.id === d.target ? 'selected' : ''}>Install to: ${esc(i.name)}</option>`).join('')}</select>` : ''}
  <select id="dmc"><option value="">Any version</option>${rel.map(v => `<option ${v.id === d.mc ? 'selected' : ''}>${esc(v.id)}</option>`).join('')}</select>
  ${d.type === 'mod' ? `<select id="dloader"><option value="">Any loader</option>${LOADERS.slice(1).filter(l => l !== 'rust').map(l => `<option value="${l}" ${l === d.loader ? 'selected' : ''}>${LN(l)}</option>`).join('')}</select>` : ''}
  <select id="dsort">${[['relevance', 'Relevance'], ['downloads', 'Downloads'], ['follows', 'Follows'], ['newest', 'Newest'], ['updated', 'Updated']].map(([k, l]) => `<option value="${k}" ${k === d.sort ? 'selected' : ''}>${l}</option>`).join('')}</select></div><div id="results" data-morph="skip"></div>`;
}
function renderResults() {
  const el = $('#results'); if (!el || S.page !== 'discover') return; const d = S.disc;
  if (d.loading) { el.innerHTML = Array.from({ length: 5 }, () => '<div class="res sk"><div class="pic"></div><div class="info"><div class="skl" style="width:30%"></div><div class="skl" style="width:85%"></div><div class="skl" style="width:45%"></div></div></div>').join(''); return; }
  if (!d.res) { el.innerHTML = ''; return; }
  if (d.res.err) { el.innerHTML = `<div class="empty"><div><h3>Couldn't reach Modrinth</h3><div>Check your internet connection and try again.</div></div></div>`; return; }
  if (!d.res.hits.length) { el.innerHTML = '<div class="empty"><div><h3>No results</h3><div>Try loosening the filters.</div></div></div>'; return; }
  const packs = d.type === 'modpack';
  const rhtml = d.res.hits.map(h => {
    const ins = d.installing.has(h.id), have = !packs && d.installed.has(h.id);
    const btn = ins ? `<button class="btn" disabled>Installing…</button>` : have ? `<button class="btn" disabled>${ic('check')}Installed</button>` : `<button class="btn primary" data-act="install" data-id="${esc(h.id)}">${ic('download')}${packs ? 'Install pack' : 'Install'}</button>`;
    return `<div class="res" data-key="res:${esc(h.id)}" data-act="detail" data-id="${esc(h.id)}"><div class="pic" style="background:${h.icon ? 'none' : grad(h.title)}">${h.icon ? `<img class="pimg" data-l="${letter(h.title)}" src="${esc(h.icon)}" width="68" height="68" style="object-fit:contain" loading="lazy" decoding="async">` : letter(h.title)}</div>
    <div class="info"><div class="t">${esc(h.title)}<span>by ${esc(h.author)}</span></div><div class="d">${esc(h.desc)}</div><div class="chips" style="margin:0">${h.cats.map(c => `<span class="chip">${esc(c)}</span>`).join('')}</div></div>
    <div class="side"><div class="stat">${ic('dl')}${hcount(h.downloads)} downloads</div>${btn.replace('<button ', `<button data-key="ib:${esc(h.id)}:${ins ? 'ing' : have ? 'have' : 'new'}" `)}</div></div>`;
  }).join('') + `<div class="pager"><button class="btn sm" data-act="prev" ${d.offset < 20 ? 'disabled' : ''}>${ic('back')}Prev</button><span>${d.offset + 1}–${Math.min(d.offset + 20, d.res.total)} of ${d.res.total}</span><button class="btn sm" data-act="next" ${d.offset + 20 >= d.res.total ? 'disabled' : ''}>Next</button></div>`;
  morph(el, rhtml, { animate: true });
}
async function runSearch() {
  const d = S.disc, seq = ++d.seq; d.loading = true; renderResults();
  let r; try { r = await call('search', { type: d.type, query: d.q, mc: d.mc, loader: d.loader, sort: d.sort, offset: d.offset, category: d.cat }); } catch { r = { err: true, hits: [], total: 0 }; }
  if (seq !== d.seq) return; d.res = r; d.loading = false; renderResults();
}

// ---------- global console ----------
function pgConsole() {
  return `<div class="page-head"><button class="btn sm" data-act="nav" data-p="settings">${ic('back')}Settings</button><h1>Console</h1><div class="grow"></div><select id="consrc"><option value="launcher">Launcher log</option>${S.instances.map(i => `<option value="${esc(i.id)}" ${S.conSrc === i.id ? 'selected' : ''}>${esc(i.name)} (game output)</option>`).join('')}</select><button class="btn" data-act="copycon2">${ic('copy')}Copy all</button><button class="btn" data-act="opendata">${ic('folder')}Open data folder</button></div><div class="console" id="con" data-morph="skip" style="height:calc(100vh - 190px)"></div>`;
}
async function afterConsole() {
  S.conLines = S.conSrc === 'launcher' ? await call('launcherLog') : await call('console', S.conSrc);
  const c = $('#con'); if (!c) return; c.innerHTML = S.conLines.length ? S.conLines.map(conLine).join('') : '<span class="dim">Nothing here yet.</span>'; c.scrollTop = c.scrollHeight;
}
function pushCon(lines) {
  const c = $('#con'); if (!c || !lines.length) return; const stick = c.scrollTop + c.clientHeight >= c.scrollHeight - 30;
  if (!S.conLines.length) c.innerHTML = ''; S.conLines.push(...lines); if (S.conLines.length > 6000) S.conLines.splice(0, S.conLines.length - 6000);
  c.insertAdjacentHTML('beforeend', lines.map(conLine).join('')); while (c.childElementCount > 2500) c.firstElementChild.remove();
  if (stick) c.scrollTop = c.scrollHeight;
}

// ---------- settings ----------
function pgSettings() { return tipify(pgSettingsRaw()); }
function pgSettingsRaw() {
  const s = S.settings;
  const hasBg = !!(s.bgUrl && s.bgType !== 'none');
  const appearance = `<div class="panel"><h2>Appearance</h2>
  <div class="line"><div class="l"><b>Accent color</b><span>Solid colors and gradients</span></div><div class="swgrid">${PRESETS.map((p, k) => `<button class="swatch ${s.accentA === p[1] && s.accentB === p[2] ? 'on' : ''}" data-tip="${p[0]}" data-act="preset" data-k="${k}" style="background:linear-gradient(135deg,${p[1]},${p[2]})"></button>`).join('')}</div></div>
  <div class="line"><div class="l"><b>Custom accent</b><span>Any color — or two for a gradient</span></div><div class="row"><input type="color" id="ca" value="${esc(s.accentA)}"><input class="hex" id="ca-hex" value="${esc(s.accentA)}" maxlength="7"><input type="color" id="cb" value="${esc(s.accentB || s.accentA)}"><input class="hex" id="cb-hex" value="${esc(s.accentB || s.accentA)}" maxlength="7"><button class="btn sm" data-act="solidacc">Solid</button><div class="gprev"></div></div></div>
  <div class="line"><div class="l"><b>Panel color</b><span>Cards, lists, menus · dark colors work best</span></div><div class="row"><input type="color" id="pc" value="${esc(s.panelColor || '#12151c')}"><input class="hex" id="pc-hex" value="${esc(s.panelColor || '#12151c')}" maxlength="7"><button class="btn sm" data-act="resetpanel">Reset</button></div></div>
  <div class="line"><div class="l"><b>Window color</b><span>The base behind everything</span></div><div class="row"><input type="color" id="wc" value="${esc(s.appColor || '#0b0d12')}"><input class="hex" id="wc-hex" value="${esc(s.appColor || '#0b0d12')}" maxlength="7"></div></div>
  <div class="line"><div class="l"><b>Window style</b><span>Rounded floats the app inside a transparent frame: the outline sits outside the window and the corners are yours to set. Classic is the plain system-style window (use it if Rounded misbehaves on your PC, or start the launcher with --classic-window). The launcher restarts when you change this.</span></div><div class="seg">${[['rounded', 'Rounded'], ['classic', 'Classic']].map(([k, l]) => `<button class="${(s.winRounded ? 'rounded' : 'classic') === k ? 'on' : ''}" data-act="winstyle" data-v="${k}">${l}</button>`).join('')}</div></div>
  <div class="line"><div class="l"><b>Window corners</b><span>${s.winRounded ? 'How round the window corners are. 0 is square.' : 'Only available with the Rounded window style.'}</span></div><div class="row"><input type="range" id="win-r" min="0" max="28" value="${s.winRadius ?? 12}" ${s.winRounded ? '' : 'disabled'}><b style="width:44px" id="win-rv">${s.winRadius ?? 12}px</b></div></div>
  <div class="line"><div class="l"><b>App outline</b><span>A border around the whole launcher window${s.winRounded ? ', drawn outside the corners' : ''}</span></div><div class="row"><input type="color" id="olc" value="${esc(s.outlineColor || '#ffffff')}"><input class="hex" id="olc-hex" value="${esc(s.outlineColor || '#ffffff')}" maxlength="7"></div></div>
  <div class="line"><div class="l"><b>Outline opacity</b></div><div class="row"><input type="range" id="ol-op" min="0" max="100" value="${s.outlineOpacity ?? 30}"><b style="width:44px" id="ol-opv">${s.outlineOpacity ?? 30}%</b></div></div>
  <div class="line"><div class="l"><b>Outline size</b><span>0 hides it</span></div><div class="row"><input type="range" id="ol-sz" min="0" max="8" value="${s.outlineSize ?? 2}"><b style="width:44px" id="ol-szv">${s.outlineSize ?? 2}px</b></div></div>
  <div class="line"><div class="l"><b>Sidebar position</b></div><div class="seg">${[['left', 'Left'], ['right', 'Right'], ['top', 'Top'], ['bottom', 'Bottom']].map(([k, l]) => `<button class="${(s.sidebarPos || 'left') === k ? 'on' : ''}" data-act="sbpos" data-v="${k}">${l}</button>`).join('')}</div></div>
  <div class="line"><div class="l"><b>Sidebar style</b><span>Icons only makes it smaller</span></div><div class="seg"><button class="${s.sidebarLabels !== false ? 'on' : ''}" data-act="sblabels" data-v="1">Icons + text</button><button class="${s.sidebarLabels === false ? 'on' : ''}" data-act="sblabels" data-v="0">Icons only</button></div></div>
  <div class="line"><div class="l"><b>Separate bar</b><span>Detaches the navigation into its own floating bar on the chosen side. Top and Bottom also hold your account.</span></div><label class="sw"><input type="checkbox" id="s-bar" ${s.secondBar ? 'checked' : ''}><i></i></label></div>
  <div class="line"><div class="l"><b>Liquid glass</b><span>Turns the sidebar (or separate bar) into a floating glass panel. The selected option becomes a glass lens that slides between items. Looks best with a background.</span></div><label class="sw"><input type="checkbox" id="s-glass" ${s.sidebarGlass ? 'checked' : ''}><i></i></label></div>
  ${s.sidebarGlass ? `<div class="line" data-key="lg-ref"><div class="l"><b>Glass refraction</b><span>How much the glass bends the background behind it. 0 is plain frosted glass.</span></div><div class="row"><input type="range" id="s-lgr" min="0" max="40" value="${s.glassRefract ?? 14}"><b style="width:44px" id="s-lgrv">${s.glassRefract ?? 14}</b></div></div>` : ''}
  <div class="line"><div class="l"><b>Sidebar opacity</b><span>Lower it to see your background through the sidebar and title bar. Both change together so they stay one piece.</span></div><div class="row"><input type="range" id="s-sop" min="0" max="100" value="${s.sidebarOpacity ?? 100}"><b style="width:44px" id="s-sopv">${s.sidebarOpacity ?? 100}%</b></div></div>
  <div class="line"><div class="l"><b>Sidebar blur</b><span>Frosted glass behind the sidebar and title bar. Looks best with a background and a lowered sidebar opacity. Costs some performance.</span></div><div class="row"><input type="range" id="s-sbl" min="0" max="30" value="${s.sidebarBlur || 0}"><b style="width:44px" id="s-sblv">${s.sidebarBlur || 0}px</b></div></div>
  <div class="line"><div class="l"><b>Background</b><span>${hasBg ? (s.bgType === 'video' ? 'Video' : 'Image / GIF') + ' background active' : 'PNG, JPG, WebP, GIF, MP4 or WebM'}</span></div><div class="row">${hasBg ? (s.bgType === 'video' ? `<video data-key="bg-thumb" class="bgthumb" src="${esc(s.bgUrl)}" muted></video>` : `<img data-key="bg-thumb" class="bgthumb" src="${esc(s.bgUrl)}">`) : ''}<button class="btn" data-key="bg-choose" data-act="pickbg">${ic('file')}Choose file…</button>${hasBg ? `<button class="btn" data-key="bg-remove" data-act="clearbg">${ic('trash')}Remove</button>` : ''}</div></div>
  ${hasBg ? `<div class="line" data-key="bgx-dim"><div class="l"><b>Background dimming</b></div><div class="row"><input type="range" id="bg-dim" min="0" max="90" value="${s.bgDim ?? 45}"><b style="width:44px" id="bg-dimv">${s.bgDim ?? 45}%</b></div></div>
  <div class="line" data-key="bgx-blur"><div class="l"><b>Background blur</b><span>${s.bgType === 'video' ? 'Blur on video uses more CPU' : ''}</span></div><div class="row"><input type="range" id="bg-blur" min="0" max="30" value="${s.bgBlur || 0}"><b style="width:44px" id="bg-blurv">${s.bgBlur || 0}px</b></div></div>
  <div class="line" data-key="bgx-pb"><div class="l"><b>Panel blur</b><span>Frosted-glass effect behind cards and panels. Only visible when Panel opacity is below 100%. It costs performance, especially without hardware acceleration.</span></div><div class="row"><input type="range" id="bg-pb" min="0" max="30" value="${s.panelBlur || 0}"><b style="width:44px" id="bg-pbv">${s.panelBlur || 0}px</b></div></div>
  <div class="line" data-key="bgx-pa"><div class="l"><b>Panel opacity</b><span>Lower = more of your background shows through</span></div><div class="row"><input type="range" id="bg-pa" min="30" max="100" value="${s.panelOpacity ?? 88}"><b style="width:44px" id="bg-pav">${s.panelOpacity ?? 88}%</b></div></div>` : ''}</div>`;
  const themePanel = `<div class="panel"><h2>Theme</h2>
  <div class="line"><div class="l"><b>Share your theme</b><span>Saves your colors, outline, sidebar, blur, opacity and background into one .theme file (JSON inside). Import it on any PC to get the exact same look. Accounts and settings that aren't looks are never included.</span></div><div class="row"><button class="btn" data-act="themeexport">${ic('download')}Export</button><button class="btn" data-act="themeimport">${ic('file')}Import</button></div></div></div>`;
  const g = S.gfx || { mode: 'auto', level: 0 };
  const smooth = `<div class="panel"><h2>Smoothness</h2>
  <div class="line"><div class="l"><b>Smooth animations</b><span>Turn off for instant, zero-effort transitions</span></div><label class="sw"><input type="checkbox" id="s-anim" ${s.animations !== false ? 'checked' : ''}><i></i></label></div>
  <div class="line"><div class="l"><b>Pause background when launcher isn't focused</b><span>Saves CPU/GPU for videos and GIFs</span></div><label class="sw"><input type="checkbox" id="s-bgu" ${s.bgPauseUnfocused !== false ? 'checked' : ''}><i></i></label></div>
  <div class="line"><div class="l"><b>Hardware acceleration</b><span>Uses your graphics card for a smoother launcher. The launcher restarts when you change this.${g.level === 5 ? ' Running with the security sandbox off, because Windows crashed the launcher with it on. Hardware acceleration is working.' : g.level >= 6 ? ` Hardware acceleration failed${g.status && g.status.exit != null ? ' (code ' + g.status.exit + ')' : ''}. Updating your graphics driver may fix this.` : g.status ? ' Switched to a compatible graphics method automatically.' : ''}</span></div><label class="sw"><input type="checkbox" id="s-hw" ${g.level < 6 && g.mode !== 'software' ? 'checked' : ''}><i></i></label></div>
  <div class="line"><div class="l"><b>Graphics method</b><span>If hardware acceleration keeps failing, try another method. Automatic tests them one after another. The launcher restarts when you change this.</span></div><select id="s-gm">${[['auto', 'Automatic'], ['d3d11', 'Direct3D 11'], ['dcomp', 'Direct3D 11 (no DirectComposition)'], ['gl', 'OpenGL'], ['d3d11on12', 'Direct3D 11 on 12'], ['nosandbox', 'No GPU sandbox'], ['nosandboxall', 'Sandbox off (GPU on)'], ['software', 'Software (no GPU)']].map(([k, l]) => `<option value="${k}" ${g.mode === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>`;
  return `<div class="page-head"><h1>Settings</h1></div>
  ${appearance}
  ${window.looksPanel ? looksPanel(s, hasBg) : ''}
  ${themePanel}
  ${smooth}
  <div class="panel"><h2>Performance</h2><div class="line"><div class="l"><b>Default memory</b><span>Per-instance values override this</span></div><div class="row"><input type="range" id="s-ram" min="1024" max="16384" step="256" value="${s.ramMB}"><b id="s-ramv" style="width:70px">${s.ramMB} MB</b></div></div>
  <div class="line"><div class="l"><b>Optimized JVM flags</b><span>G1GC tuning for smoother frame times</span></div><label class="sw"><input type="checkbox" id="s-opt" ${s.optimizedFlags ? 'checked' : ''}><i></i></label></div>
  <div class="line"><div class="l"><b>Global JVM arguments</b></div><input id="s-jvm" value="${esc(s.jvmArgs)}" style="width:320px"></div>
  <div class="line"><div class="l"><b>Parallel downloads</b><span>More = faster installs</span></div><div class="row"><input type="range" id="s-thr" min="2" max="48" value="${s.threads}"><b id="s-thrv" style="width:30px">${s.threads}</b></div></div></div>
  ${window.backupsPanel ? backupsPanel(s) : ''}${window.storagePanel ? storagePanel() : ''}<div class="panel"><h2>Java</h2>${S.javas.length ? S.javas.map(j => `<div class="dim" style="padding:3px 0">Java ${esc(j.ver)} — ${esc(j.exe)}</div>`).join('') : '<div class="dim">No Java found on this PC yet.</div>'}
  <div class="line"><div class="l"><b>Auto-download the right Java</b><span>Fetches Temurin when an instance needs a version you don't have</span></div><label class="sw"><input type="checkbox" id="s-auto" ${s.autoJava ? 'checked' : ''}><i></i></label></div>
  <div class="row" style="margin-top:6px"><button class="btn sm" data-act="rescan">${ic('refresh')}Rescan</button>${[8, 17, 21].map(m => `<button class="btn sm" data-act="getjava" data-m="${m}">${ic('download')}Java ${m}</button>`).join('')}</div></div>
  <div class="panel"><h2>Launcher</h2>
  <div class="line"><div class="l"><b>Minimize while playing</b><span>Restores when the game closes</span></div><label class="sw"><input type="checkbox" id="s-min" ${s.minimizeOnLaunch ? 'checked' : ''}><i></i></label></div>
  <div class="line"><div class="l"><b>Data folder</b><span>${esc(S.root)}</span></div><button class="btn sm" data-act="opendata">${ic('folder')}Open</button></div></div>
  <div class="callout"><div class="co-ic">${ic('info')}</div><div class="co-t"><b>Offline mode</b><p>No Microsoft login needed. Servers with online-mode enabled will reject offline accounts. You can switch accounts from the top-right.</p></div></div>
  <div class="panel"><h2>Advanced</h2><div class="line"><div class="l"><b>Console</b><span>Launcher log and live game output. Handy when a game won\'t start.</span></div><button class="btn" data-act="nav" data-p="console">${ic('terminal')}Open console</button></div></div>`;
}

// ---------- popovers & modals ----------
function closePop() { const p = $('#popover'), m = p.firstElementChild; if (!m) return; m.classList.add('leaving'); setTimeout(() => { if (p.firstElementChild === m) p.innerHTML = ''; }, 110); }
function pop(html, x, y, right) { $('#popover').innerHTML = `<div class="menu" style="top:${y}px;${right ? `right:${innerWidth - x}px` : `left:${x}px`}">${html}</div>`; }
let modalTok = 0;
function modal(html) { const m = $('#modal'); modalTok++; m.classList.remove('leaving'); m.innerHTML = `<div class="dlg">${html}</div>`; m.classList.add('on'); }
function closeModal() { const m = $('#modal'); if (!m.classList.contains('on') || m.classList.contains('leaving')) return; const tok = modalTok; m.classList.add('leaving'); setTimeout(() => { if (tok === modalTok) { m.classList.remove('on', 'leaving'); m.innerHTML = ''; } }, 130); }
function toast(msg, err) { const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; $('#toasts').appendChild(t); setTimeout(() => { t.classList.add('leaving'); setTimeout(() => t.remove(), 220); }, err ? 7000 : 4000); }
function acctMenu(btn) {
  const r = btn.getBoundingClientRect(), s = S.settings, ms = s.msAccounts || [], row = (act, attr, av, name, sub, on, rm) => `<button class="mi acct ${on ? 'on' : ''}" data-act="${act}" ${attr}>${av}<div><div style="font-weight:600">${esc(name)}</div><div class="dim" style="font-size:11.5px">${sub}${on ? ' · active' : ''}</div></div><span class="x" data-act="${rm}" ${attr}>${ic('x')}</span></button>`;
  pop(`<div class="cap">ACCOUNTS</div>${ms.map(m => row('switchms', `data-id="${esc(m.id)}"`, avatarHtml(m.name, m.id), m.name, 'Microsoft', s.activeMs === m.id, 'rmms')).join('')}${s.accounts.map(n => row('switchacct', `data-n="${esc(n)}"`, avatarHtml(n, ''), n, 'Offline', !s.activeMs && n === s.username, 'rmacct')).join('')}<hr><button class="mi" data-act="addacct">${ic('plus')}Add account</button>`, r.right, r.bottom + 8, true);
}
function addAcctModal() {
  modal(`<h2>${(S.settings.accounts.length || (S.settings.msAccounts || []).length) ? 'Add account' : 'Add your account'}</h2>
  <button class="btn primary" id="msbtn" data-act="msloginbtn" style="width:100%;padding:13px">Sign in with Microsoft</button><div class="dim" style="margin:8px 0 2px;font-size:12.5px">For online servers, with your real name and skin. A Microsoft sign-in window opens.</div>
  <div class="dim" style="text-align:center;margin:14px 0 0">or play offline</div><label>Offline username</label><input id="na" placeholder="3–16 letters, numbers or _" maxlength="16"><div class="dim" id="nahint" style="margin-top:8px;font-size:12.5px">Offline accounts need no login.</div><div class="foot"><button class="btn" data-act="closemodal">Cancel</button><button class="btn" id="naok" data-act="doaddacct" disabled>Add offline account</button></div>`);
  const inp = $('#na');
  inp.oninput = async () => { const v = inp.value, ok = /^\w{3,16}$/.test(v), dup = S.settings.accounts.includes(v); $('#naok').disabled = !ok || dup; $('#nahint').textContent = !v ? 'Offline accounts need no login.' : !ok ? 'Use 3–16 letters, numbers or underscore.' : dup ? 'That account already exists.' : 'UUID: ' + await call('uuid', v); };
  inp.onkeydown = e => { if (e.key === 'Enter' && !$('#naok').disabled) $('#naok').click(); };
}
async function doAddAcct() { const v = $('#na').value; if (!/^\w{3,16}$/.test(v)) return; const s = S.settings; await call('saveSettings', { accounts: [...s.accounts, v], username: v }); closeModal(); }
function createModal() {
  S.cr = { name: '', mc: '', loader: 'vanilla', lv: '', filter: '', rel: true, snap: false, old: false };
  modal(`<h2>Create instance</h2><label>Name</label><input id="c-name" placeholder="My new world">
  <label>Minecraft version</label><input id="c-filter" placeholder="Search versions…"><div class="fchips" style="margin-top:10px"><label class="fchip"><input type="checkbox" id="c-rel" checked><span>Releases</span></label><label class="fchip"><input type="checkbox" id="c-snap"><span>Snapshots</span></label><label class="fchip"><input type="checkbox" id="c-old"><span>Old versions</span></label></div><div class="vlist" id="vlist"></div>
  <label>Mod loader</label><div class="seg" id="c-loader">${LOADERS.map(l => `<button class="${l === 'vanilla' ? 'on' : ''}" data-act="cloader" data-l="${l}">${LN(l)}</button>`).join('')}</div>
  <div id="c-lvwrap" style="display:none"><label>Loader version (optional)</label><input id="c-lv" placeholder="Leave empty for latest stable"></div>
  <div class="dim" id="c-hint" style="margin-top:12px"></div><div class="foot"><button class="btn" data-act="closemodal">Cancel</button><button class="btn primary" id="c-ok" data-act="docreate">${ic('plus')}Create</button></div>`);
  renderVList(); if (!S.versions.length) call('versions').then(v => { S.versions = v || []; renderVList(); });
  for (const id of ['c-filter', 'c-rel', 'c-snap', 'c-old']) $('#' + id).oninput = () => { S.cr.filter = $('#c-filter').value; S.cr.rel = $('#c-rel').checked; S.cr.snap = $('#c-snap').checked; S.cr.old = $('#c-old').checked; renderVList(); };
}
function setCreateState() {
  const ok = $('#c-ok'), h = $('#c-hint'); if (!ok) return; const c = S.cr;
  ok.disabled = !c.mc; if (h) h.textContent = c.mc ? `Will install Minecraft ${c.mc}${c.loader !== 'vanilla' ? ' + ' + LN(c.loader) : ''} and download everything now.${c.loader === 'rust' ? ' Rust (Horizon) is a native rewrite: Minecraft ' + RUST_MC + ' only, it prepares itself once (a few minutes), and Java mods do not run on it.' : ''}` : 'Select a Minecraft version from the list.';
}
function renderVList() {
  const c = S.cr, el = $('#vlist'); if (!el) return;
  if (!S.versions.length) { el.innerHTML = loadingHtml('Loading versions… (needs internet)') + '<div style="padding:0 12px"><button class="btn sm" data-act="retryver">Retry</button></div>'; setCreateState(); return; }
  if (!c.mc) { const r = S.versions.find(v => v.type === 'release'); if (r) c.mc = r.id; }
  if (c.loader === 'rust') { const r = S.versions.find(v => v.id === RUST_MC); c.mc = r ? RUST_MC : ''; el.innerHTML = r ? `<div class="vi on" data-act="pickver" data-v="${RUST_MC}"><span>${RUST_MC}</span><small>required by Rust</small></div>` : `<div class="dim" style="padding:12px">Minecraft ${RUST_MC} was not found in the version list (needs internet).</div>`; setCreateState(); return; }
  el.innerHTML = S.versions.filter(v => (v.type === 'release' && c.rel) || (v.type === 'snapshot' && c.snap) || (/old/.test(v.type) && c.old)).filter(v => v.id.includes(c.filter))
  .slice(0, 250).map(v => `<div class="vi ${v.id === c.mc ? 'on' : ''}" data-act="pickver" data-v="${esc(v.id)}"><span>${esc(v.id)}</span><small>${v.type === 'release' ? '' : v.type}</small></div>`).join('');
  setCreateState();
}
async function doCreate() {
  const c = S.cr; if (!c.mc) return toast('Pick a Minecraft version first', true);
  const name = $('#c-name').value.trim(), lv = $('#c-lv').value.trim(); closeModal(); S.page = 'library';
  try { await call('createInstance', { name, mc: c.mc, loader: c.loader, loaderVer: lv }); } catch (e) { toast('Could not create instance: ' + String(e.message || e).replace(/^.*Error: /, ''), true); } render();
}
function confirmDel(id) { const i = inst(id); modal(`<h2>Delete instance</h2><p>Permanently delete <b>${esc(i.name)}</b> and all of its worlds, mods and settings?</p><div class="foot"><button class="btn" data-act="closemodal">Cancel</button><button class="btn danger" data-act="dodel" data-id="${esc(id)}">${ic('trash')}Delete</button></div>`); }

// ---------- jobs (patched in place so nothing flashes) ----------
const jobEls = new Map(), jobPrev = new Map();
function renderJobs(list) {
  const box = $('#jobs'), seen = new Set(), now = performance.now();
  for (const j of list.slice(-5)) {
    seen.add(j.id); let el = jobEls.get(j.id);
    if (!el) {
      el = document.createElement('div'); el.className = 'job enter'; el.dataset.act = 'jobtoggle'; el.dataset.id = j.id;
      el.innerHTML = '<div class="jt"><span class="jtitle"></span><span class="jx"></span></div><div class="jl"></div><div class="bar"><i></i></div><div class="jn"></div><div class="detail"></div>';
      box.appendChild(el); jobEls.set(j.id, el); el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true });
    }
    const set = (sel, v) => { const n = el.querySelector(sel); if (n.textContent !== v) n.textContent = v; };
    set('.jtitle', j.title); set('.jl', j.finished ? 'Done' : (j.label || 'Working…'));
    const pct = j.total > 0 ? Math.min(100, j.done / j.total * 100) : 0, bar = el.querySelector('.bar'), fill = bar.firstElementChild;
    bar.classList.toggle('ind', !j.finished && j.total <= 0); bar.classList.toggle('done', !!j.finished); fill.style.setProperty('--p', (j.finished ? 100 : pct) / 100);
    const jx = el.querySelector('.jx'); if (el.dataset.fin !== String(!!j.finished)) { el.dataset.fin = String(!!j.finished); jx.innerHTML = j.finished ? `<span class="okmark">${ic('check')}</span>` : `<button class="btn sm icon" data-act="cancel" data-id="${j.id}" title="Cancel">${ic('x')}</button>`; }
    set('.jn', `${j.total > 0 ? `${j.done} / ${j.total} files · ` : ''}${hsize(j.bytes)}`);
    set('.detail', j.finished ? 'Finished' : (j.total > 0 ? `${Math.round(pct)}% of files` : 'Preparing…'));
  }
  for (const [id, el] of jobEls) if (!seen.has(id)) { el.classList.add('leave'); jobEls.delete(id); jobPrev.delete(id); setTimeout(() => el.remove(), 260); }
}
document.addEventListener('pointerdown', e => {
  const n = e.target.closest && e.target.closest('.nav');
  if (n && !e.button) { navDown = n; document.querySelectorAll('.nav.on').forEach(x => x.classList.remove('on')); n.classList.add('on'); moveInd(true); }
  const t = e.target.closest('.btn,.job,.card,.mi,.nav,.cchip,.swatch,.pill,.dd-btn,.ddi,.tabs>button,.seg>button,.fchip,.winbtns button'); if (!t || t.disabled || e.target.closest('[disabled]')) return;
  const r = t.getBoundingClientRect(), s = Math.max(r.width, r.height) * 2, sp = document.createElement('span'); sp.className = 'ripple';
  sp.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`; let rc = t.querySelector(':scope > .ripc'); if (!rc) { rc = document.createElement('span'); rc.className = 'ripc'; t.appendChild(rc); } rc.appendChild(sp); setTimeout(() => sp.remove(), 600);
});

// ---------- events ----------
document.addEventListener('click', async e => {
  const mdl = e.target.closest && e.target.closest('.md a'); if (mdl) { e.preventDefault(); call('openUrl', mdl.href); return; }
  const t = e.target.closest('[data-act]'); const inPop = e.target.closest('#popover');
  if (!t) { if (!inPop) closePop(); if (e.target.id === 'modal') closeModal(); return; }
  const a = t.dataset.act, id = t.dataset.id, i = inst(S.sel);
  if (a === 'toggle' || a === 'dtype' || a === 'cloader' || a === 'pickver') { /* handled below */ }
  else if (t.tagName === 'INPUT') return;
  e.stopPropagation(); if (!['menu', 'acctmenu'].includes(a)) closePop();
  switch (a) {
    case 'winstyle': if (t.dataset.v !== (S.settings.winRounded ? 'rounded' : 'classic') && confirm('The launcher will restart to change the window style. Continue?')) call('setWinStyle', t.dataset.v); break;
    case 'min': call('winMin'); break; case 'max': call('winMax'); break; case 'close': call('winClose'); break;
    case 'nav': go(t.dataset.p); break;
    case 'acctmenu': acctMenu(t); break;
    case 'switchacct': await call('saveSettings', { username: t.dataset.n, activeMs: '' }); break;
    case 'switchms': await call('switchMs', t.dataset.id); break;
    case 'rmms': await call('removeMsAccount', t.dataset.id); { const el = $('#acct button'); if (el && S.settings.username) acctMenu(el); } break;
    case 'msloginbtn': { t.disabled = true; t.textContent = 'Waiting for the sign-in window…'; const r = await call('msLogin'); if (r.err) { toast(r.err, true); t.disabled = false; t.textContent = 'Sign in with Microsoft'; } else { toast('Signed in as ' + r.name); closeModal(); } break; }
    case 'pin': { const ii = inst(id); await call('updateInstance', id, { pinned: !(ii && ii.pinned) }); break; }
    case 'rmacct': { const n = t.dataset.n, s = S.settings, rest = s.accounts.filter(x => x !== n); await call('saveSettings', { accounts: rest, username: n === s.username ? (rest[0] || '') : s.username }); const el = $('#acct button'); if (el && rest.length) acctMenu(el); break; }
    case 'addacct': addAcctModal(); break; case 'doaddacct': doAddAcct(); break;
    case 'closemodal': closeModal(); break;
    case 'new': createModal(); break; case 'docreate': doCreate(); break;
    case 'cloader': S.cr.loader = t.dataset.l; if (S.cr.loader === 'rust') S.cr.mc = RUST_MC; renderVList(); document.querySelectorAll('#c-loader button').forEach(b => b.classList.toggle('on', b.dataset.l === S.cr.loader)); setCreateState(); { const w = $('#c-lvwrap'), show = S.cr.loader !== 'vanilla', was = w.style.display === 'block'; w.style.display = show ? 'block' : 'none'; if (show && !was) popNew(w, 0); } break;
    case 'pickver': S.cr.mc = t.dataset.v; renderVList(); break;
    case 'retryver': S.versions = (await call('versions')) || []; renderVList(); if (!S.versions.length) toast('Still can\'t reach Mojang — check your internet connection', true); break;
    case 'import': call('importMrpack'); break;
    case 'open': S.tab = 'mods'; go('instance', id); break;
    case 'menu': { const r = t.getBoundingClientRect(); pop(`<button class="mi" data-act="open" data-id="${esc(id)}">${ic('play')}Open</button><button class="mi" data-act="folderof" data-id="${esc(id)}">${ic('folder')}Open folder</button><button class="mi" data-act="pin" data-id="${esc(id)}">${ic('pin')}${inst(id) && inst(id).pinned ? 'Unpin' : 'Pin to top'}</button><button class="mi" data-act="dup" data-id="${esc(id)}">${ic('copy')}Duplicate</button><hr><button class="mi red" data-act="del" data-id="${esc(id)}">${ic('trash')}Delete</button>`, r.right, r.bottom + 6, true); break; }
    case 'folderof': call('openFolder', id, ''); break; case 'dup': await call('duplicateInstance', id); toast('Duplicated'); break;
    case 'del': confirmDel(id); break; case 'dodel': closeModal(); await leaveEl([...document.querySelectorAll('.card')].find(c => c.dataset.key === 'card:' + id)); await call('deleteInstance', id); if (S.sel === id) S.page = 'library'; render(); break;
    case 'play': if (!S.settings.username) { toast('Add an account first — top-right corner', true); addAcctModal(); break; } call('launch', id); break; case 'stop': call('stop', id); break;
    case 'tab': S.tab = t.dataset.t; render(); pgAnim($('#tabbody')); break;
    case 'browse': S.disc.type = KINDS[S.tab][0]; S.disc.res = null; S.disc.offset = 0; setTarget(i.id, false); go('discover'); break;
    case 'folder': call('openFolder', i.id, t.dataset.sub); break;
    case 'refreshc': afterInstance(); break;
    case 'updmods': await call('updateMods', i.id); afterInstance(); break;
    case 'toggle': await call('toggleContent', i.id, KINDS[S.tab][0], t.dataset.f); afterInstance(); break;
    case 'rmc': await leaveEl(t.closest('.item')); await call('removeContent', i.id, KINDS[S.tab][0], t.dataset.f); S.disc.installed = new Set(await call('installedIds', i.id)); afterInstance(); break;
    case 'copycon2': navigator.clipboard.writeText(S.conLines.join('\n')); toast('Copied'); break;
    case 'copycon': navigator.clipboard.writeText(S.conLines.join('\n')); toast('Copied console output'); break;
    case 'pickimg': await call('pickInstanceImage', i.id, t.dataset.kind); afterInstance(); break;
    case 'clearimg': await call('clearInstanceImage', i.id, t.dataset.kind); afterInstance(); break;
    case 'icolor-reset': await call('updateInstance', i.id, { color: '' }); render(); break;
    case 'repair': call('repair', i.id); break; case 'ramreset': await call('updateInstance', i.id, { ramMB: 0 }); afterInstance(); break;
    case 'dcat': S.disc.cat = t.dataset.c; S.disc.offset = 0; document.querySelectorAll('.cchip').forEach(b => b.classList.toggle('on', b.dataset.c === S.disc.cat || (!S.disc.cat && b.dataset.c === ''))); runSearch(); break;
    case 'detail': openDetail(id, (S.disc.res && S.disc.res.hits.find(x => x.id === id)) || null); break;
    case 'closedetail': closeDetail(); break;
    case 'dtab': if (S.detail) { S.detail.tab = t.dataset.t; renderDrawer(); } break;
    case 'dinstall': if (S.detail) startInstall(S.detail.id, S.detail.data ? S.detail.data.project.title : (S.detail.hit || {}).title); break;
    case 'dver': if (S.detail && S.detail.data) startInstall(S.detail.id, S.detail.data.project.title, t.dataset.v); break;
    case 'dlink': call('openUrl', t.dataset.u); break;
    case 'gal': openLightbox(t.dataset.src); break; case 'closelb': closeLightbox(); break;
    case 'dtype': S.disc.type = t.dataset.t; S.disc.cat = ''; S.disc.offset = 0; S.disc.res = null; if (S.disc.type === 'modpack') { S.disc.mc = ''; S.disc.loader = ''; } else if (S.disc.target) setTarget(S.disc.target, false); render(); runSearch(); break;
    case 'prev': S.disc.offset = Math.max(0, S.disc.offset - 20); runSearch(); break; case 'next': S.disc.offset += 20; runSearch(); break;
    case 'install': { const hit = (S.disc.res && S.disc.res.hits.find(x => x.id === id)) || {}; startInstall(id, hit.title); break; }
    case 'gpureport': { const r = await call('gpuReport'); try { await navigator.clipboard.writeText(r); toast('Graphics report copied'); } catch { toast('Could not copy the report', true); } break; }
    case 'sk3d': if (t.dataset.v === 'reset') Skin3D.reset(); else { S.skin[t.dataset.v] = !S.skin[t.dataset.v]; render(); } break;
    case 'themeexport': { const r = await call('exportTheme'); if (r && r.err) toast(r.err, true); else if (r && r.ok) toast(r.bg ? 'Theme exported (with your background)' : r.bgSkipped ? 'Theme exported, but your background is too big to include' : 'Theme exported'); break; }
    case 'themeimport': { const r = await call('importTheme'); if (r && r.err) toast(r.err, true); else if (r && r.ok) { toast(r.bg ? 'Theme imported (with background)' : 'Theme imported'); render(); } break; }
    case 'skinsel': S.skin.sel = id; render(); break;
    case 'skinmodel': S.skin.model = t.dataset.v; render(); break;
    case 'skinpick': { const r = await call('pickSkinFile'); if (r && r.err) toast(r.err, true); else if (r && r.id) { await loadSkinLib(); S.skin.sel = r.id; render(); } break; }
    case 'skinimport': { const n = ($('#skinname').value || '').trim(); if (!n) { toast('Type a player name first', true); break; } t.disabled = true; const r = await call('importSkinByName', n); t.disabled = false; if (r.err) toast(r.err, true); else { await loadSkinLib(); S.skin.sel = r.id; S.skin.model = r.model || 'classic'; render(); } break; }
    case 'skinapply': { const r = await call('applySkin', { id: S.skin.sel, model: S.skin.model }); if (r.err) toast(r.err, true); else { toast(r.online ? 'Skin uploaded to your Microsoft account' : 'Skin saved. It shows in your next launch'); } render(); break; }
    case 'skindel': { const sk = S.skin.lib.find(x => x.id === S.skin.sel); if (!sk || !confirm('Delete this skin from your library? Your account keeps wearing it until you apply another one.')) break; const r = await call('deleteSkin', sk.id); if (r && r.err) toast(r.err, true); else { toast('Skin deleted'); S.skin.sel = null; await loadSkinLib(); } render(); break; }
    case 'skinreset': { const r = await call('resetSkin'); if (r.err) toast(r.err, true); else toast('Skin reset'); S.skin.sel = null; render(); break; }
    case 'solidacc': await call('saveSettings', { accentB: S.settings.accentA }); break;
    case 'resetpanel': await call('saveSettings', { panelColor: '#12151c', appColor: '#0b0d12' }); break;
    case 'gpumode': if (confirm('The launcher will restart to apply this. Continue?')) call('setGpuMode', t.dataset.v); break;
    case 'preset': { const p = PRESETS[+t.dataset.k]; await call('saveSettings', { accentA: p[1], accentB: p[2] }); break; }
    case 'sbpos': await call('saveSettings', { sidebarPos: t.dataset.v }); break;
    case 'sblabels': await call('saveSettings', { sidebarLabels: t.dataset.v === '1' }); break;
    case 'pickbg': await call('pickBackground'); break; case 'clearbg': await call('clearBackground'); break;
    case 'rescan': S.javas = await call('rescanJava'); render(); break;
    case 'getjava': await call('downloadJava', +t.dataset.m); S.javas = await call('javas'); if (S.page === 'settings') render(); break;
    case 'opendata': call('openData'); break;
    case 'cancel': call('cancelJob', +id); break;
    case 'jobtoggle': t.classList.toggle('open'); break;
  }
});
document.addEventListener('input', e => {
  const t = e.target, i = inst(S.sel), s = S.settings, d = S.disc;
  if (t.id === 'libq') { S.filter = t.value; const p = t.selectionStart; morph($('#main'), pgLibrary(), { animate: false }); }
  else if (t.id === 'dq') { d.q = t.value; d.offset = 0; clearTimeout(S._dt); S._dt = setTimeout(runSearch, 350); }
  else if (t.id === 's-ram') { $('#s-ramv').textContent = t.value + ' MB'; } else if (t.id === 's-thr') { $('#s-thrv').textContent = t.value; }
  else if (t.id === 'i-ram') { $('#i-ramv').textContent = t.value + ' MB'; }
  else if (t.id === 'ol-op') { S.settings.outlineOpacity = +t.value; $('#ol-opv').textContent = t.value + '%'; applyTheme(); }
  else if (t.id === 'ol-sz') { S.settings.outlineSize = +t.value; $('#ol-szv').textContent = t.value + 'px'; applyTheme(); }
  else if (t.id === 'win-r') { S.settings.winRadius = +t.value; $('#win-rv').textContent = t.value + 'px'; applyTheme(); }
  else if (t.id === 's-sop') { S.settings.sidebarOpacity = +t.value; $('#s-sopv').textContent = t.value + '%'; applyTheme(); }
  else if (t.id === 's-sbl') { S.settings.sidebarBlur = +t.value; $('#s-sblv').textContent = t.value + 'px'; applyTheme(); }
  else if (t.id === 's-lgr') { S.settings.glassRefract = +t.value; $('#s-lgrv').textContent = t.value; applyTheme(); }
  else if (t.id === 'bg-pb') { S.settings.panelBlur = +t.value; $('#bg-pbv').textContent = t.value + 'px'; applyTheme(); }
  else if (t.id === 'bg-dim') { S.settings.bgDim = +t.value; $('#bg-dimv').textContent = t.value + '%'; applyTheme(); }
  else if (t.id === 'bg-blur') { S.settings.bgBlur = +t.value; $('#bg-blurv').textContent = t.value + 'px'; applyTheme(); }
  else if (t.id === 'bg-pa') { S.settings.panelOpacity = +t.value; $('#bg-pav').textContent = t.value + '%'; applyTheme(); }
  else if (['ca', 'cb', 'pc', 'wc', 'olc'].includes(t.id)) { S.settings[{ ca: 'accentA', cb: 'accentB', pc: 'panelColor', wc: 'appColor', olc: 'outlineColor' }[t.id]] = t.value; applyTheme(); }
});
document.addEventListener('change', async e => {
  if (e.target.dataset && e.target.dataset.act === 'sk3dt') { S.skin[e.target.dataset.v] = e.target.checked; if (window.Skin3D && Skin3D.set) Skin3D.set({ auto: S.skin.auto, walk: S.skin.walk }); return; }
  const t = e.target, i = inst(S.sel), d = S.disc;
  const m = { 'd-': 0 };
  if (t.id === 'consrc') { S.conSrc = t.value; afterConsole(); } else if (t.id === 'dtarget') setTarget(t.value); else if (t.id === 'dmc') { d.mc = t.value; d.offset = 0; runSearch(); } else if (t.id === 'dloader') { d.loader = t.value; d.offset = 0; runSearch(); } else if (t.id === 'dsort') { d.sort = t.value; d.offset = 0; runSearch(); }
  else if (t.id === 'ol-op') call('saveSettings', { outlineOpacity: +t.value }); else if (t.id === 'ol-sz') call('saveSettings', { outlineSize: +t.value }); else if (t.id === 'win-r') call('saveSettings', { winRadius: +t.value }); else if (t.id === 'olc') call('saveSettings', { outlineColor: t.value });
  else if (t.id === 's-sop') call('saveSettings', { sidebarOpacity: +t.value }); else if (t.id === 's-sbl') call('saveSettings', { sidebarBlur: +t.value }); else if (t.id === 's-lgr') call('saveSettings', { glassRefract: +t.value }); else if (t.id === 's-bar') call('saveSettings', { secondBar: t.checked }); else if (t.id === 's-glass') call('saveSettings', { sidebarGlass: t.checked }); else if (t.id === 's-gm') { toast('Restarting to apply…'); setTimeout(() => call('setGpuMode', t.value), 500); } else if (t.id === 'bg-pb') call('saveSettings', { panelBlur: +t.value });
  else if (t.id === 'bg-dim') call('saveSettings', { bgDim: +t.value }); else if (t.id === 'bg-blur') call('saveSettings', { bgBlur: +t.value }); else if (t.id === 'bg-pa') call('saveSettings', { panelOpacity: +t.value });
  else if (t.id === 'ca') call('saveSettings', { accentA: t.value }); else if (t.id === 'cb') call('saveSettings', { accentB: t.value });
  else if (t.id === 'pc') call('saveSettings', { panelColor: t.value }); else if (t.id === 'wc') call('saveSettings', { appColor: t.value });
  else if (/^(ca|cb|pc|wc|olc)-hex$/.test(t.id)) { let v = t.value.trim(); if (!v.startsWith('#')) v = '#' + v; if (/^#[0-9a-f]{6}$/i.test(v)) call('saveSettings', { [{ ca: 'accentA', cb: 'accentB', pc: 'panelColor', wc: 'appColor', olc: 'outlineColor' }[t.id.replace('-hex', '')]]: v.toLowerCase() }); else { toast('Use a 6-digit hex color like #7c3aed', true); render(); } }
  else if (t.id === 's-hw') { toast(t.checked ? 'Trying hardware acceleration… if your graphics driver can\'t handle it, the launcher switches back by itself' : 'Restarting to apply…'); setTimeout(() => call('setGpuMode', t.checked ? 'auto' : 'software'), 500); }
  else if (t.id === 's-anim') call('saveSettings', { animations: t.checked }); else if (t.id === 's-bgu') call('saveSettings', { bgPauseUnfocused: t.checked });
  else if (t.id === 's-ram') call('saveSettings', { ramMB: +t.value }); else if (t.id === 's-thr') call('saveSettings', { threads: +t.value });
  else if (t.id === 's-opt') call('saveSettings', { optimizedFlags: t.checked }); else if (t.id === 's-auto') call('saveSettings', { autoJava: t.checked }); else if (t.id === 's-min') call('saveSettings', { minimizeOnLaunch: t.checked });
  else if (t.id === 's-jvm') call('saveSettings', { jvmArgs: t.value });
  else if (i && t.id === 'i-name') call('updateInstance', i.id, { name: t.value || i.name }); else if (i && t.id === 'i-ram') { await call('updateInstance', i.id, { ramMB: +t.value }); }
  else if (i && t.id === 'i-color') { await call('updateInstance', i.id, { color: t.value }); }
  else if (i && t.id === 'i-java') call('updateInstance', i.id, { javaPath: t.value }); else if (i && t.id === 'i-jvm') call('updateInstance', i.id, { jvmArgs: t.value });
  else if (i && t.id === 'i-w') call('updateInstance', i.id, { width: +t.value || 0 }); else if (i && t.id === 'i-h') call('updateInstance', i.id, { height: +t.value || 0 }); else if (i && t.id === 'i-fs') call('updateInstance', i.id, { fullscreen: t.checked });
});
document.addEventListener('error', e => { const t = e.target; if (!t || t.tagName !== 'IMG') return; if (t.classList.contains('pimg') && t.parentElement) { t.parentElement.style.background = 'var(--grad)'; t.parentElement.textContent = t.dataset.l || '?'; } else t.remove(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if ($('#lightbox').classList.contains('on')) { closeLightbox(); return; } if (S.detail && !$('#modal').classList.contains('on')) { closeDetail(); return; } closeModal(); closePop(); } });

window.oc.on('state', st => {
  const prevCount = S.instances.length; const prevRunning = Object.keys(S.running || {}).length;
  Object.assign(S, { instances: st.instances, running: st.running, busy: st.busy, settings: st.settings });
  applyTheme(); 
  const ae = document.activeElement, typing = ae && ((ae.tagName === 'INPUT' && !['checkbox', 'range', 'color', 'button'].includes(ae.type)) || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA');
  if (typing || (S.page === 'discover' && prevCount === S.instances.length)) { renderTop(); renderSide(); return; }
  if (!S._stRaf) S._stRaf = requestAnimationFrame(() => { S._stRaf = 0; render(); });
});
window.oc.on('jobs', renderJobs); window.oc.on('toast', t => toast(t.msg, t.err));
window.oc.on('versions', v => { S.versions = v; if ($('#vlist')) renderVList(); if (S.page === 'discover' && !document.activeElement.closest('.filters')) render(); });
window.oc.on('maxed', m => { document.documentElement.classList.toggle('maxed', !!m); $('#maxbtn').innerHTML = m ? '<svg viewBox="0 0 24 24"><rect x="5" y="8" width="11" height="11" rx="1"/><path d="M8 8V5h11v11h-3"/></svg>' : '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>'; });
window.oc.on('console', ({ id, lines }) => {
  S.lastCon = id;
  if ((S.page === 'instance' && S.tab === 'console' && S.sel === id) || (S.page === 'console' && S.conSrc === id)) pushCon(lines);
});
window.oc.on('log', ({ lines }) => { if (S.page === 'console' && S.conSrc === 'launcher') pushCon(lines); });

(async () => {
  // Wait until every script (servers.js, accounts.js, extras.js...) has run, so the first render can use all pages.
  if (document.readyState !== 'complete') await new Promise(r => window.addEventListener('load', r, { once: true }));
  const st = await call('init'); Object.assign(S, st); applyTheme(); renderSide(); S.running = st.running || {}; render();
})();


// ---------- sliding highlight for segmented controls + tab bars ----------
const segPos = {};
function initIndicators() {
  document.querySelectorAll('.segind').forEach(i => { if (!i.parentElement || !i.parentElement.matches('.seg, .tabs')) i.remove(); });
  document.querySelectorAll('.seg, .tabs').forEach((box, idx) => {
    const isTabs = box.classList.contains('tabs'); let ind = box.querySelector(':scope > .segind');
    if (!ind) { ind = document.createElement('i'); ind.className = 'segind'; box.prepend(ind); }
    const on = box.querySelector(':scope > button.on'); if (!on || !on.offsetWidth) { ind.style.opacity = 0; return; }
    const key = (box.closest('#modal') ? 'modal' : box.closest('#drawer') ? 'drawer' : S.page) + ':' + (isTabs ? 't' : 's') + idx, x = on.offsetLeft, w = on.offsetWidth, prev = segPos[key];
    ind.style.opacity = 1;
    if (prev && (prev.x !== x || prev.w !== w)) { ind.style.transition = 'none'; ind.style.transform = `translateX(${prev.x}px)`; ind.style.width = prev.w + 'px'; void ind.offsetWidth; ind.style.transition = ''; ind.style.transform = `translateX(${x}px)`; ind.style.width = w + 'px'; }
    else { ind.style.transition = 'none'; ind.style.transform = `translateX(${x}px)`; ind.style.width = w + 'px'; void ind.offsetWidth; ind.style.transition = ''; }
    segPos[key] = { x, w };
  });
}

// ---------- custom dropdowns (replace the plain native <select> list) ----------
const CHEV = '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';
let dd = null;
function closeDd() { if (!dd) return; const m = dd.menu; dd.btn.classList.remove('open'); m.classList.remove('open'); setTimeout(() => m.remove(), 120); dd = null; }
function openDd(sel, btn) {
  if (dd && dd.sel === sel) { closeDd(); return; } closeDd();
  const opts = [...sel.options], menu = document.createElement('div'); menu.className = 'ddm';
  menu.innerHTML = opts.map((o, i) => `<div class="ddi ${i === sel.selectedIndex ? 'sel' : ''}" data-i="${i}"><span>${esc(o.textContent)}</span>${i === sel.selectedIndex ? ic('check') : ''}</div>`).join('');
  document.body.appendChild(menu); const r = btn.getBoundingClientRect(), w = Math.max(r.width, 190); menu.style.minWidth = w + 'px';
  const h = Math.min(menu.scrollHeight, 300), below = innerHeight - r.bottom - 12, up = below < h && r.top > below;
  menu.style.maxHeight = Math.min(300, up ? r.top - 12 : below) + 'px'; menu.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left)) + 'px'; menu.style[up ? 'bottom' : 'top'] = (up ? innerHeight - r.top + 6 : r.bottom + 6) + 'px';
  btn.classList.add('open'); requestAnimationFrame(() => menu.classList.add('open')); const cur = menu.querySelector('.sel'); if (cur) cur.scrollIntoView({ block: 'center' });
  dd = { sel, btn, menu, typed: '', t: 0 };
  menu.addEventListener('mousedown', ev => { const it = ev.target.closest('.ddi'); if (!it) return; ev.preventDefault(); sel.selectedIndex = +it.dataset.i; sel.dispatchEvent(new Event('change', { bubbles: true })); if (sel._sync) sel._sync(); closeDd(); });
}
function enhanceSelects() {
  document.querySelectorAll('select:not([data-dd])').forEach(sel => {
    sel.dataset.dd = '1'; sel.style.display = 'none'; const b = document.createElement('button'); b.type = 'button'; b.className = 'dd-btn'; if (sel.style.width) b.style.width = sel.style.width;
    b.innerHTML = `<span class="dd-label"></span>${CHEV}`; sel.after(b); sel._btn = b;
    sel._sync = () => { const o = sel.selectedOptions[0]; b.querySelector('.dd-label').textContent = o ? o.textContent : ''; }; sel._sync();
    b.addEventListener('mousedown', ev => { ev.preventDefault(); ev.stopPropagation(); openDd(sel, b); }); sel.addEventListener('change', sel._sync);
  });
}
document.addEventListener('mousedown', ev => { if (dd && !ev.target.closest('.ddm') && !ev.target.closest('.dd-btn')) closeDd(); }, true);
document.addEventListener('scroll', ev => { if (dd && !(ev.target.closest && ev.target.closest('.ddm'))) closeDd(); }, true); window.addEventListener('resize', closeDd);
document.addEventListener('keydown', ev => {
  if (!dd) return; const items = [...dd.menu.querySelectorAll('.ddi')]; let cur = items.findIndex(i => i.classList.contains('hov')); if (cur < 0) cur = dd.sel.selectedIndex;
  const move = n => { const i = Math.max(0, Math.min(items.length - 1, n)); items.forEach(x => x.classList.remove('hov')); items[i].classList.add('hov'); items[i].scrollIntoView({ block: 'nearest' }); };
  if (ev.key === 'ArrowDown') { ev.preventDefault(); move(cur + 1); } else if (ev.key === 'ArrowUp') { ev.preventDefault(); move(cur - 1); }
  else if (ev.key === 'Enter') { ev.preventDefault(); const h = dd.menu.querySelector('.hov'); if (h) h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); else closeDd(); }
  else if (ev.key === 'Escape') { closeDd(); ev.stopPropagation(); }
  else if (ev.key.length === 1) { dd.typed += ev.key.toLowerCase(); clearTimeout(dd.t); dd.t = setTimeout(() => { if (dd) dd.typed = ''; }, 700); const i = [...dd.sel.options].findIndex(o => o.textContent.toLowerCase().startsWith(dd.typed)); if (i >= 0) move(i); }
}, true);
let uiRaf = 0;
const quietUi = m => m.target.closest && m.target.closest('#con,#jobs,#tooltip,#fx');
new MutationObserver(ms => { if (uiRaf || ms.every(quietUi)) return; uiRaf = requestAnimationFrame(() => { uiRaf = 0; enhanceSelects(); initIndicators(); }); }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
document.addEventListener('click', () => requestAnimationFrame(initIndicators), true);


// ---------- install flow shared by the list and the detail drawer ----------
async function startInstall(id, title, versionId) {
  const d = S.disc, type = (S.detail && S.detail.id === id && S.detail.data) ? S.detail.data.project.type : d.type;
  if (type !== 'modpack' && !inst(d.target)) { toast(S.instances.length ? 'Pick an instance in the "Install to" dropdown first' : 'Create an instance first, then install into it', true); if (!S.instances.length) createModal(); return; }
  d.installing.add(id); renderResults(); renderDrawer();
  const r = type === 'modpack' ? await call('installModpack', id, versionId) : await call('installProject', { instId: d.target, projectId: id, type, title, versionId });
  d.installing.delete(id); if (type !== 'modpack' && (!r.err || /already installed/i.test(String(r.err)))) d.installed.add(id); renderResults(); renderDrawer(); if (!r.err && type !== 'modpack') toast('Installed!');
}

// ---------- safe markdown for project descriptions ----------
const MD_OK = new Set(['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'code', 'pre', 'ul', 'ol', 'li', 'a', 'img', 'blockquote', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'details', 'summary', 'center', 'div', 'span', 'sub', 'sup', 'kbd']);
const MD_DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'link', 'meta', 'svg', 'video', 'audio', 'textarea', 'select', 'canvas']);
function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walk = node => {
    for (const ch of [...node.childNodes]) {
      if (ch.nodeType === 3) continue; if (ch.nodeType !== 1) { ch.remove(); continue; }
      const tag = ch.tagName.toLowerCase();
      if (MD_DROP.has(tag)) { ch.remove(); continue; }
      if (!MD_OK.has(tag)) { walk(ch); ch.replaceWith(...ch.childNodes); continue; }
      let bad = false;
      for (const at of [...ch.attributes]) {
        const n = at.name.toLowerCase();
        if (tag === 'a' && n === 'href') { if (!/^https?:\/\//i.test(at.value)) ch.removeAttribute(at.name); }
        else if (tag === 'img' && n === 'src') { if (!/^https:\/\//i.test(at.value)) bad = true; }
        else if (!['alt', 'width', 'height', 'title', 'align', 'colspan', 'rowspan'].includes(n)) ch.removeAttribute(at.name);
      }
      if (bad) { ch.remove(); continue; }
      if (tag === 'img') ch.setAttribute('loading', 'lazy');
      walk(ch);
    }
  };
  walk(doc.body); return doc.body.innerHTML;
}
function mdInline(s) {
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, '<img alt="$1" src="$2">');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*([^*]+?)\*\*|__([^_]+?)__/g, (m, x, y) => `<strong>${x || y}</strong>`);
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>'); s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  return s;
}
function renderMd(src) {
  src = String(src || '').replace(/\r\n?/g, '\n'); const tags = [];
  src = src.replace(/<!--[\s\S]*?-->/g, '').replace(/<\/?[a-zA-Z][^>]*>/g, m => { tags.push(m); return `\u0001${tags.length - 1}\u0001`; });
  const lines = src.split('\n'), out = []; let i = 0, para = [];
  const flush = () => { if (para.length) { out.push('<p>' + mdInline(para.join(' ')) + '</p>'); para = []; } };
  while (i < lines.length) {
    const ln = lines[i]; let m;
    if (/^```/.test(ln)) { flush(); const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>'); continue; }
    if ((m = ln.match(/^(#{1,6})\s+(.*)$/))) { flush(); out.push(`<h${m[1].length}>${mdInline(m[2])}</h${m[1].length}>`); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(ln)) { flush(); out.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(ln)) { flush(); const buf = []; while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, '')); out.push('<blockquote>' + mdInline(buf.join(' ')) + '</blockquote>'); continue; }
    if ((m = ln.match(/^\s*([-*+]|\d+\.)\s+(.*)$/))) { flush(); const ord = /\d/.test(m[1]), items = []; while (i < lines.length && (m = lines[i].match(/^\s*([-*+]|\d+\.)\s+(.*)$/))) { items.push('<li>' + mdInline(m[2]) + '</li>'); i++; } out.push(`<${ord ? 'ol' : 'ul'}>${items.join('')}</${ord ? 'ol' : 'ul'}>`); continue; }
    if (/^\s*$/.test(ln)) { flush(); i++; continue; }
    para.push(ln.trim()); i++;
  }
  flush();
  return sanitizeHtml(out.join('\n').replace(/\u0001(\d+)\u0001/g, (m, n) => tags[+n]));
}

// ---------- project detail drawer ----------
const fmtDate = s => { try { return new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return ''; } };
async function openDetail(id, hit) {
  S.detail = { id, hit, data: null, tab: 'desc', err: false };
  const root = $('#drawer'); root.classList.remove('leaving'); root.innerHTML = '<div class="dr-back" data-act="closedetail"></div><aside class="dr"></aside>'; root.classList.add('on'); renderDrawer();
  try { const data = await call('projectDetail', id); if (S.detail && S.detail.id === id) { S.detail.data = data; renderDrawer(); } }
  catch { if (S.detail && S.detail.id === id) { S.detail.err = true; renderDrawer(); } }
}
function closeDetail() { const root = $('#drawer'); if (!root.classList.contains('on') || root.classList.contains('leaving')) return; root.classList.add('leaving'); setTimeout(() => { if (root.classList.contains('leaving')) { root.classList.remove('on', 'leaving'); root.innerHTML = ''; S.detail = null; } }, 210); }
function renderDrawer() {
  const dr = $('#drawer .dr'); if (!dr || !S.detail) return; const D = S.detail, h = D.hit || {}, p = D.data && D.data.project;
  const title = p ? p.title : (h.title || '…'), icon = p ? p.icon : h.icon, desc = p ? p.description : (h.desc || ''), type = p ? p.type : S.disc.type, packs = type === 'modpack';
  const installed = !packs && S.disc.installed.has(D.id), installing = S.disc.installing.has(D.id);
  const btn = installing ? '<button data-key="dib:ing" class="btn" disabled>Installing…</button>' : installed ? `<button data-key="dib:have" class="btn" disabled>${ic('check')}Installed</button>` : `<button data-key="dib:new" class="btn primary" data-act="dinstall">${ic('download')}${packs ? 'Install pack' : 'Install'}</button>`;
  const links = p ? [['Source', p.source], ['Issues', p.issues], ['Wiki', p.wiki], ['Discord', p.discord], ['Modrinth', `https://modrinth.com/${p.type}/${p.slug}`]].filter(x => x[1]).map(x => `<button class="btn sm" data-act="dlink" data-u="${esc(x[1])}">${esc(x[0])}</button>`).join('') : '';
  const tabs = [['desc', 'Description'], ...(p && p.gallery.length ? [['gal', `Gallery (${p.gallery.length})`]] : []), ['ver', `Versions${D.data ? ' (' + D.data.versions.length + ')' : ''}`]];
  let body = '';
  if (D.err) body = '<div class="dim" style="padding:30px 0">Couldn\'t load details. Check your connection and try again.</div>';
  else if (!p) body = '<div class="skl" style="width:60%"></div><div class="skl" style="width:95%"></div><div class="skl" style="width:85%"></div><div class="skl" style="width:70%"></div>';
  else if (D.tab === 'desc') {
    const chips = [...p.loaders.map(l => `<span class="chip acc">${esc(LN(l))}</span>`), ...p.versions.slice(-6).reverse().map(v => `<span class="chip">${esc(v)}</span>`), p.versions.length > 6 ? `<span class="chip">+${p.versions.length - 6} more</span>` : ''].join('');
    const env = [p.client && p.client !== 'unknown' ? 'Client: ' + p.client : '', p.server && p.server !== 'unknown' ? 'Server: ' + p.server : ''].filter(Boolean).join(' · ');
    body = `<div class="dr-info"><div class="chips" style="margin:0 0 8px">${chips}</div><div class="dim" style="font-size:12.5px">${[env, p.license ? 'License: ' + esc(p.license) : '', 'By ' + esc(D.data.members.map(m => m.name).filter(Boolean).slice(0, 4).join(', ') || h.author || '—'), 'Updated ' + fmtDate(p.updated)].filter(Boolean).join(' · ')}</div></div><div class="md">${renderMd(p.body)}</div>`;
  } else if (D.tab === 'gal') body = `<div class="gal">${p.gallery.map(g => `<figure data-act="gal" data-src="${esc(g.url)}"><img loading="lazy" src="${esc(g.url)}" alt=""><figcaption>${esc(g.title)}</figcaption></figure>`).join('')}</div>`;
  else body = D.data.versions.map(v => `<div class="ver" data-key="ver:${esc(v.id)}"><div class="grow"><div><b>${esc(v.name || v.number)}</b> <span class="vt ${esc(v.type)}">${esc(v.type)}</span></div><div class="dim" style="font-size:12.5px">${esc(v.number)} · ${v.games.slice(-4).reverse().map(esc).join(', ')}${v.games.length > 4 ? '…' : ''} · ${v.loaders.map(l => esc(LN(l))).join(', ')} · ${fmtDate(v.date)} · ${hcount(v.downloads)} downloads</div></div>${installing || (!packs && installed) ? '' : `<button class="btn sm" data-act="dver" data-v="${esc(v.id)}">${ic('download')}${packs ? 'Install' : 'Get'}</button>`}</div>`).join('') || '<div class="dim">No versions.</div>';
  const keep = dr.querySelector('.dr-body'), scroll = keep ? keep.scrollTop : 0, sameTab = dr.dataset.tab === D.tab && dr.dataset.id === D.id;
  dr.dataset.tab = D.tab; dr.dataset.id = D.id;
  morph(dr, `<header class="dr-head" data-key="dr-head"><div class="pic" style="background:${icon ? 'none' : 'var(--grad)'};width:68px;height:68px">${icon ? `<img class="pimg" loading="lazy" decoding="async" data-l="${letter(title)}" src="${esc(icon)}" width="68" height="68" style="object-fit:contain">` : letter(title)}</div><div class="grow"><h2>${esc(title)}</h2><div class="dim">${esc(desc)}</div></div><button class="btn icon" data-act="closedetail" title="Close">${ic('x')}</button></header>
  <div class="dr-bar" data-key="dr-bar"><div class="stat-row"><span>${ic('dl')}${hcount(p ? p.downloads : (h.downloads || 0))} downloads</span>${p ? `<span>${ic('heart')}${hcount(p.followers)} followers</span>` : ''}</div><div class="grow"></div>${btn}</div>
  ${links ? `<div class="dr-links" data-key="dr-links">${links}</div>` : ''}
  <div class="tabs" data-key="dr-tabs" style="margin:6px 0 0">${tabs.map(([k, l]) => `<button class="${D.tab === k ? 'on' : ''}" data-act="dtab" data-t="${k}">${l}</button>`).join('')}</div><div class="dr-body" data-key="dr-body">${body}</div>`, { animate: false });
  const nb = dr.querySelector('.dr-body'); if (sameTab) nb.scrollTop = scroll; else { nb.scrollTop = 0; pgAnim(nb); }
}
function openLightbox(src) { const lb = $('#lightbox'); lb.innerHTML = `<img src="${esc(src)}" alt="" data-act="closelb">`; lb.classList.add('on'); }
function closeLightbox() { const lb = $('#lightbox'); lb.classList.remove('on'); setTimeout(() => { if (!lb.classList.contains('on')) lb.innerHTML = ''; }, 160); }


// ---------- in-place DOM patching: elements stay alive, so toggles/segments/colors animate and new things pop in ----------
const isPres = n => n.nodeType === 1 && (n.classList.contains('segind') || n.classList.contains('dd-btn') || n.classList.contains('ripc'));
const isWs = n => n.nodeType === 3 && !n.nodeValue.trim();
const keyOf = n => n.nodeType === 1 ? (n.getAttribute('data-key') || n.id || null) : null;
const STATE_CLS = new Set(['on', 'off', 'sel', 'open', 'hov', 'pop-in', 'leaving', 'leave-out', 'stagger', 'pg', 'sk']);
const roleOf = n => ((n.getAttribute('class') || '').split(/\s+/).find(c => c && !STATE_CLS.has(c))) || '';
const sameType = (x, y) => x.nodeType === y.nodeType && (x.nodeType !== 1 || (x.tagName === y.tagName && roleOf(x) === roleOf(y)));
const nextReal = n => { while (n && (isPres(n) || isWs(n))) n = n.nextSibling; return n; };
function popNew(el, k) { if (el.nodeType !== 1) return; el.style.animationDelay = Math.min(k, 12) * 24 + 'ms'; el.classList.add('pop-in'); el.addEventListener('animationend', () => { el.classList.remove('pop-in'); el.style.animationDelay = ''; }, { once: true }); }
function syncAttrs(from, to) {
  const keep = from.matches('select[data-dd]');
  for (const at of [...from.attributes]) { if (keep && (at.name === 'style' || at.name === 'data-dd')) continue; if (!to.hasAttribute(at.name)) from.removeAttribute(at.name); }
  for (const at of [...to.attributes]) { if (keep && at.name === 'style') continue; if (from.getAttribute(at.name) !== at.value) from.setAttribute(at.name, at.value); }
}
function patchNode(from, to) {
  if (from.nodeType === 3) { if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue; return from; }
  if (from.nodeType !== 1) return from;
  if (from.tagName !== to.tagName) { const n = to.cloneNode(true); from.replaceWith(n); return n; }
  syncAttrs(from, to);
  if (from.tagName === 'INPUT') {
    if (from.type === 'checkbox') from.checked = to.checked;
    else if (document.activeElement !== from) { const v = to.getAttribute('value') ?? ''; if (from.value !== v) from.value = v; }
    return from;
  }
  if (to.getAttribute('data-morph') === 'skip') return from;
  morphKids(from, to, true);
  if (from.tagName === 'SELECT') { from.selectedIndex = to.selectedIndex; if (from._sync) from._sync(); }
  return from;
}
function morphKids(from, to, animate) {
  const fk = [...from.childNodes].filter(n => !isWs(n)), tk = [...to.childNodes].filter(n => !isWs(n));
  const pool = fk.filter(n => !isPres(n)), keyed = new Map(); pool.forEach(n => { const k = keyOf(n); if (k && !keyed.has(k)) keyed.set(k, n); });
  const used = new Set(), result = []; let pi = 0;
  for (const t of tk) {
    const k = keyOf(t); let m = null;
    if (k) { m = keyed.get(k) || null; if (m && used.has(m)) m = null; }
    else { while (pi < pool.length && (used.has(pool[pi]) || keyOf(pool[pi]))) pi++; const c = pool[pi]; if (c && sameType(c, t)) { m = c; pi++; } }
    if (m) { used.add(m); result.push([patchNode(m, t), false]); } else result.push([t.cloneNode(true), true]);
  }
  let cur = nextReal(from.firstChild), added = 0;
  for (const [n, isNew] of result) {
    if (n === cur) cur = nextReal(cur.nextSibling); else from.insertBefore(n, cur);
    if (isNew && animate) popNew(n, added++);
  }
  pool.forEach(n => { if (!used.has(n) && n.parentNode === from) { if (n._btn) n._btn.remove(); n.remove(); } });
  from.querySelectorAll(':scope > select[data-dd]').forEach(s => { if (s._btn && s.nextElementSibling !== s._btn) s.after(s._btn); });
  from.querySelectorAll(':scope > .dd-btn').forEach(b => { const p = b.previousElementSibling; if (!(p && p._btn === b)) b.remove(); });
}
function morph(parent, html, opts = {}) {
  const tpl = document.createElement('template'); tpl.innerHTML = html;
  morphKids(parent, tpl.content, opts.animate !== undefined ? opts.animate : parent.childElementCount > 0);
}
function leaveEl(el) { return new Promise(r => { if (!el) return r(); el.classList.add('leave-out'); setTimeout(r, 175); }); }


// ---------- skins page (3D) ----------
S.skin = { sel: null, model: 'classic', lib: [], auto: true, walk: false };
async function loadSkinLib() { S.skin.lib = (await call('skinLibrary')) || []; }
function pgSkins() {
  const s = S.settings, name = s.username, ms = (s.msAccounts || []).find(x => x.id === s.activeMs), k = S.skin;
  if (!name) return `<div class="page-head"><h1>Skins</h1></div><div class="empty"><div><h3>Add an account first</h3><div>Skins belong to an account. Add one from the top-right corner.</div></div></div>`;
  const cur = ms ? { url: ms.skinUrl, model: ms.skinModel } : (s.skins && s.skins[name]) || {}, inUse = ms ? ms.skinId : (cur.id || ''), sel = k.sel && k.lib.find(x => x.id === k.sel), url = sel ? sel.url : (cur.url || ''), model = sel ? k.model : (cur.model || 'classic');
  const note = ms ? 'Your skin is uploaded to your Microsoft account, so everyone sees it in online games.' : 'Offline accounts have no real skin. OfflineCraft shows yours to you with a small resource pack. Other players still see a default skin.';
  return `<div class="page-head"><h1>Skins</h1><span class="dim ellip">${esc(name)} \u00b7 ${ms ? 'Microsoft account' : 'Offline account'}</span></div>
  <div class="skin-grid"><div class="panel skin-prev" data-key="skin-prev"><div class="sk3d" id="sk3d" data-morph="skip" data-url="${esc(url)}" data-model="${model}"></div>
    <div class="sk-hint">${url ? 'Drag to rotate \u00b7 scroll to zoom \u00b7 double-click to reset' : 'No skin chosen yet \u2014 pick one from the library'}</div>
    <div class="sk-tools"><div class="seg"><button class="${model === 'classic' ? 'on' : ''}" data-act="skinmodel" data-v="classic">Classic</button><button class="${model === 'slim' ? 'on' : ''}" data-act="skinmodel" data-v="slim">Slim</button></div>
    <div class="sk-toggles"><label class="tgl"><span>Auto-spin</span><span class="sw"><input type="checkbox" data-act="sk3dt" data-v="auto" ${k.auto ? 'checked' : ''}><i></i></span></label><label class="tgl"><span>Walking animation</span><span class="sw"><input type="checkbox" data-act="sk3dt" data-v="walk" ${k.walk ? 'checked' : ''}><i></i></span></label></div></div>
    <div class="row"><button class="btn primary" data-act="skinapply" ${sel && sel.id !== inUse ? '' : 'disabled'}>${sel && sel.id === inUse ? 'In use' : 'Apply skin'}</button><button class="btn" data-act="skinreset" ${cur.url ? '' : 'disabled'}>Reset</button><button class="btn danger" data-act="skindel" ${sel ? '' : 'disabled'}>${ic('trash')}Delete</button></div><div class="dim note">${note}</div></div>
  <div class="panel" data-key="skin-lib"><h2>Skin library</h2><div class="skin-add"><button class="btn" data-act="skinpick">${ic('file')}Choose file\u2026</button><div class="skin-get"><input id="skinname" placeholder="Player username" maxlength="16"><button class="btn" data-act="skinimport">${ic('download')}Copy skin</button></div></div>
  <div class="skin-lib">${k.lib.map(l => `<button class="skin-th ${k.sel === l.id ? 'on' : ''} ${inUse === l.id ? 'inuse' : ''}" data-key="sk:${l.id}" data-act="skinsel" data-id="${l.id}">${inUse === l.id ? '<span class="sk-badge">In use</span>' : ''}<div class="face-big facebg" style="background-image:${cssUrl(l.url)},${cssUrl(l.url)}"></div></button>`).join('') || '<div class="dim empty-lib">No skins yet. Choose a PNG file or copy a player\'s skin by username.</div>'}</div></div>${window.capesPanel ? capesPanel() : ''}</div>`;
}
function afterSkins() {
  const w = $('#sk3d'); if (!w) return;
  Skin3D.set({ auto: S.skin.auto, walk: S.skin.walk, anim: S.settings.animations !== false });
  let u = w.dataset.url;
  if (!u) {                                     // nothing chosen yet: show the real Steve (from the game files or Mojang)
    if (S.skin.steve === undefined) { S.skin.steve = ''; call('defaultSteve').then(x => { S.skin.steve = x || ''; if (S.page === 'skins') afterSkins(); }).catch(() => {}); }
    u = S.skin.steve || '';
  }
  Skin3D.mount(w, { url: u, slim: w.dataset.model === 'slim' });
}
// pressing a sidebar button and dragging away must not leave it highlighted
let navDown = null;
function syncNav() { document.querySelectorAll('.nav').forEach(x => x.classList.toggle('on', x.dataset.p === S.page || (x.dataset.p === 'library' && S.page === 'instance') || (x.dataset.p === 'settings' && S.page === 'console'))); moveInd(true); }
document.addEventListener('pointerup', e => { if (!navDown) return; const n = e.target.closest && e.target.closest('.nav'), same = n === navDown; navDown = null; if (!same) syncNav(); }, true);
window.addEventListener('blur', () => { if (navDown) { navDown = null; syncNav(); } });
document.addEventListener('dragend', () => { if (navDown) { navDown = null; syncNav(); } });

// ---------- animate anything that appears ----------
(() => {
  const app = $('#app'); if (!app) return;
  const NO = '.console,#bg,#tooltip,#navind,#outline,#jobs,#toasts,#popover,#modal,#lightbox,.sk3d,.ripc,.ripple,.pop-in,.pg,.stagger,.leaving,.leave-out,.dd-menu,.menu,.dlg,.toast,.job';
  new MutationObserver(muts => {
    if (app.classList.contains('noanim')) return;
    const added = new Set(); for (const m of muts) for (const n of m.addedNodes) if (n instanceof HTMLElement) added.add(n);
    if (!added.size) return; const idx = new Map();
    for (const n of added) {
      if (!n.isConnected || n.tagName === 'OPTION' || n.closest(NO)) continue;
      let inside = false; for (let p = n.parentElement; p && p !== app; p = p.parentElement) if (added.has(p)) { inside = true; break; }
      if (inside || getComputedStyle(n).animationName !== 'none') continue;
      const k = idx.get(n.parentElement) || 0; idx.set(n.parentElement, k + 1);
      n.style.animationDelay = Math.min(k, 10) * 28 + 'ms'; n.classList.add('pop-in');
      n.addEventListener('animationend', () => { n.classList.remove('pop-in'); n.style.animationDelay = ''; }, { once: true });
    }
  }).observe(app, { childList: true, subtree: true });
})();
call('winIsMax').then(m => document.documentElement.classList.toggle('maxed', !!m)).catch(() => {});
// Resize grips on every edge and corner. Rounded window: they fill the transparent margin around the app, so the grab area is OUTSIDE
// the window. Classic window: thin strips inside the edge, above the title bar's drag area (which swallows the top edge).
(function resizeGrips() {
  const MINW = () => 1000 + 2 * margin(), MINH = () => 640 + 2 * margin(), margin = () => (S.settings.winRounded ? (S.settings.winMargin || 14) : 0);
  const DIRS = [['n', 'ns-resize'], ['s', 'ns-resize'], ['w', 'ew-resize'], ['e', 'ew-resize'], ['nw', 'nwse-resize'], ['ne', 'nesw-resize'], ['sw', 'nesw-resize'], ['se', 'nwse-resize']], grips = {};
  const geom = d => {   // css for one grip
    const m = margin(), E = m || 5, C = m ? m + 4 : 10, T = m || 4;
    return { n: `top:0;left:${C}px;right:${C}px;height:${T}px`, s: `bottom:0;left:${C}px;right:${C}px;height:${E}px`, w: `left:0;top:${C}px;bottom:${C}px;width:${E}px`, e: `right:0;top:${C}px;bottom:${C}px;width:${E}px`,
      nw: `top:0;left:0;width:${C}px;height:${C}px`, ne: `top:0;right:0;width:${C}px;height:${C}px`, sw: `bottom:0;left:0;width:${C}px;height:${C}px`, se: `bottom:0;right:0;width:${C}px;height:${C}px` }[d];
  };
  const layout = () => { const maxed = document.documentElement.classList.contains('maxed'), native = !S.settings.winRounded && false; for (const [d, cur] of DIRS) { const g = grips[d]; g.style.cssText = `position:fixed;z-index:99999;-webkit-app-region:no-drag;cursor:${cur};${geom(d)};${maxed ? 'display:none' : ''}`; } };
  for (const [dir] of DIRS) {
    const g = document.createElement('div'); g.className = 'rsz'; grips[dir] = g; document.documentElement.appendChild(g);
    g.addEventListener('pointerdown', async e => {
      if (e.button !== 0 || document.documentElement.classList.contains('maxed')) return; e.preventDefault(); g.setPointerCapture(e.pointerId);
      const b = await call('winGetBounds'), sx = e.screenX, sy = e.screenY, mw = MINW(), mh = MINH(); let raf = 0, next = null;
      const move = ev => {
        const dx = ev.screenX - sx, dy = ev.screenY - sy; let { x, y, width: w, height: h } = b;
        if (dir.includes('e')) w = Math.max(mw, b.width + dx);
        if (dir.includes('s')) h = Math.max(mh, b.height + dy);
        if (dir.includes('w')) { w = Math.max(mw, b.width - dx); x = b.x + b.width - w; }
        if (dir.includes('n')) { h = Math.max(mh, b.height - dy); y = b.y + b.height - h; }
        next = { x, y, width: w, height: h }; if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (next) call('winSetBounds', next); });
      };
      const up = () => { g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up); };
      g.addEventListener('pointermove', move); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
    });
  }
  window.layoutGrips = layout; layout();
  new MutationObserver(layout).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  // the transparent window has no native double-click-to-maximize
  const tb = document.getElementById('titlebar'); if (tb) tb.addEventListener('dblclick', e => { if (!S.settings.winRounded || e.target.closest('.nodrag,button,input,select')) return; call('winMax'); });
})();

