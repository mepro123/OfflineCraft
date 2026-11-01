'use strict';
// Style options: accent from background, glass everywhere, auto-hide bar, scale/density, fonts, card style, sidebar items, glow, ambient effects
(() => {
  const app = () => $('#app');
  const save = o => call('saveSettings', o);
  const sw = (id, on, extra = '') => `<label class="sw"><input type="checkbox" id="${id}" ${on ? 'checked' : ''} ${extra}><i></i></label>`;
  const seg = (act, cur, opts) => `<div class="seg">${opts.map(([k, l]) => `<button class="${cur === k ? 'on' : ''}" data-lact="${act}" data-v="${k}">${l}</button>`).join('')}</div>`;
  const line = (key, title, desc, ctl) => `<div class="line" data-key="lk-${key}"><div class="l"><b>${title}</b>${desc ? `<span>${desc}</span>` : ''}</div>${ctl}</div>`;
  const range = (id, min, max, step, v, unit) => `<div class="row"><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}"><b style="min-width:48px;text-align:right" id="${id}v">${v}${unit}</b></div>`;

  window.looksPanel = (s, hasBg) => {
    const hid = s.navHidden || [], nl = navList();
    const navRows = nl.map(([id, l, i], n) => `<div class="lk-nav" data-key="lknav:${id}"><span class="lk-ni">${ic(i)}</span><b>${l}</b><div class="grow"></div><button class="btn sm" data-lact="navmv" data-id="${id}" data-d="-1" ${n === 0 ? 'disabled' : ''} data-tip="Move up">&#8593;</button><button class="btn sm" data-lact="navmv" data-id="${id}" data-d="1" ${n === nl.length - 1 ? 'disabled' : ''} data-tip="Move down">&#8595;</button>${id === 'library' ? '<span class="lk-fixed">Always shown</span>' : sw('lk-nav-' + id, !hid.includes(id))}</div>`).join('');
    return `<div class="panel" data-key="looks"><h3>Style</h3>
    ${line('acc', 'Accent from background', hasBg ? 'Picks the accent colours from your background so they always match. Changing the background updates them.' : 'Set a background image or video first. Until then your own accent colours are used.', `<div class="row">${s.accentAuto && hasBg ? '<button class="btn sm" data-lact="accnow">Pick again</button>' : ''}${sw('lk-acc', s.accentAuto)}</div>`)}
    ${line('gall', 'Liquid glass everywhere', 'Cards, panels, dialogs and menus become frosted glass too. Looks best with a background.', sw('lk-gall', s.glassAll))}
    ${line('ah', 'Auto-hide bar', s.secondBar ? 'The separate bar slides away and comes back when your mouse reaches its edge.' : 'Turn on Separate bar (in Appearance) to use this.', sw('lk-ah', s.barAutoHide))}
    ${line('scale', 'UI scale', 'Makes everything bigger or smaller.', range('lk-scale', 80, 125, 5, s.uiScale || 100, '%'))}
    ${line('dens', 'Density', 'Compact fits more on screen.', seg('density', s.density || 'comfortable', [['comfortable', 'Comfortable'], ['compact', 'Compact']]))}
    ${line('font', 'Font', '', seg('font', s.fontFamily || 'default', [['default', 'Segoe UI'], ['inter', 'Inter'], ['system', 'System']]))}
    ${line('pix', 'Minecraft headings', 'Uses a blocky Minecraft-style font for titles.', sw('lk-pix', s.fontPixel))}
    ${line('cards', 'Instance cards', 'Set a custom banner per instance from its ⋯ menu → Edit.', seg('cards', s.cardStyle || 'grid', [['grid', 'Grid'], ['list', 'List'], ['compact', 'Compact']]))}
    ${line('glow', 'Glow intensity', 'How strongly accent-coloured things glow.', range('lk-glow', 0, 200, 10, s.glow ?? 100, '%'))}
    ${line('fx', 'Ambient effects', 'Light particles over the background. They pause while a game is running or the launcher is in the background.', seg('fx', s.ambient || 'off', [['off', 'Off'], ['snow', 'Snow'], ['fireflies', 'Fireflies'], ['ash', 'Nether ash']]))}
    ${(s.ambient || 'off') !== 'off' ? line('fxn', 'Effect amount', '', range('lk-fxn', 10, 100, 10, s.ambientAmount || 50, '%')) : ''}
    <div class="line" data-key="lk-navh"><div class="l"><b>Sidebar items</b><span>Reorder or hide items. Hidden pages stay reachable with Ctrl+K. Settings always stays last.</span></div></div>
    <div class="lk-navs" data-key="lk-navs">${navRows}</div></div>`;
  };

  document.addEventListener('click', async e => {
    const t = e.target.closest('[data-lact]'); if (!t || t.disabled) return; const v = t.dataset.v;
    switch (t.dataset.lact) {
      case 'density': save({ density: v }); break;
      case 'font': save({ fontFamily: v }); break;
      case 'cards': save({ cardStyle: v }); break;
      case 'fx': save({ ambient: v }); break;
      case 'accnow': accKey = null; autoAccent(true); break;
      case 'navmv': { const o = navList().map(n => n[0]), i = o.indexOf(t.dataset.id), j = i + +t.dataset.d; if (j < 0 || j >= o.length) break; [o[i], o[j]] = [o[j], o[i]]; save({ navOrder: o }); break; }
    }
  });
  document.addEventListener('input', e => {
    const t = e.target, r = document.documentElement.style;
    if (t.id === 'lk-glow') { $('#lk-glowv').textContent = t.value + '%'; r.setProperty('--glow', (t.value / 100).toFixed(2)); }
    else if (t.id === 'lk-scale' || t.id === 'lk-fxn') $('#' + t.id + 'v').textContent = t.value + '%';
  });
  document.addEventListener('change', e => {
    const t = e.target, id = t.id || ''; if (!id.startsWith('lk-')) return;
    if (id === 'lk-acc') save({ accentAuto: t.checked });
    else if (id === 'lk-gall') save({ glassAll: t.checked });
    else if (id === 'lk-ah') save(t.checked ? { barAutoHide: true, secondBar: true } : { barAutoHide: false });
    else if (id === 'lk-pix') save({ fontPixel: t.checked });
    else if (id === 'lk-scale') save({ uiScale: +t.value });
    else if (id === 'lk-glow') save({ glow: +t.value });
    else if (id === 'lk-fxn') save({ ambientAmount: +t.value });
    else if (id.startsWith('lk-nav-')) { const n = id.slice(7), h = new Set(S.settings.navHidden || []); t.checked ? h.delete(n) : h.add(n); save({ navHidden: [...h] }); }
  });

  // ---------- accent from background ----------
  let accKey = null, accBusy = false;
  const toHex = c => '#' + c.map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
  function tune([r, g, b]) {
    r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
    if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360;
    const l0 = (mx + mn) / 2, s0 = d ? d / (1 - Math.abs(2 * l0 - 1)) : 0, s = Math.max(s0, 0.62), l = Math.min(0.66, Math.max(0.52, l0));
    const C = (1 - Math.abs(2 * l - 1)) * s, X = C * (1 - Math.abs((h / 60) % 2 - 1)), m = l - C / 2;
    const [a, bb, c] = h < 60 ? [C, X, 0] : h < 120 ? [X, C, 0] : h < 180 ? [0, C, X] : h < 240 ? [0, X, C] : h < 300 ? [X, 0, C] : [C, 0, X];
    return toHex([(a + m) * 255, (bb + m) * 255, (c + m) * 255]);
  }
  window.pickAccent = data => {
    const N = 24, bins = Array.from({ length: N }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      const v = mx / 255, s = mx ? d / mx : 0; if (s < 0.22 || v < 0.22) continue;
      let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360;
      const w = s * s * v, k = bins[Math.floor(h / 360 * N) % N]; k.w += w; k.r += r * w; k.g += g * w; k.b += b * w;
    }
    const idx = bins.map((b, i) => i).filter(i => bins[i].w > 0).sort((x, y) => bins[y].w - bins[x].w); if (!idx.length) return null;
    const avg = i => [bins[i].r / bins[i].w, bins[i].g / bins[i].w, bins[i].b / bins[i].w], top = idx[0];
    const far = idx.find(i => { const d = Math.abs(i - top); return Math.min(d, N - d) >= 3 && bins[i].w >= bins[top].w * 0.12; });
    const A = tune(avg(top)); let B = far !== undefined ? tune(avg(far)) : null;
    if (!B) { const c = avg(top); B = tune([c[0] * 0.8 + 40, c[1] * 0.85 + 30, c[2] * 0.9 + 60]); if (B === A) B = tune([c[2], c[0], c[1]]); }
    return [A, B];
  };
  async function bgPixels() {
    const el = $('#bg img, #bg video, #bg canvas'); if (!el) return null;
    if (el.tagName === 'IMG' && !el.complete) await new Promise(r => { el.addEventListener('load', r, { once: true }); el.addEventListener('error', r, { once: true }); });
    if (el.tagName === 'VIDEO' && el.readyState < 2) await new Promise(r => { el.addEventListener('loadeddata', r, { once: true }); setTimeout(r, 4000); });
    const c = document.createElement('canvas'); c.width = 64; c.height = 40; const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(el, 0, 0, 64, 40); return x.getImageData(0, 0, 64, 40).data;
  }
  async function autoAccent(force) {
    const s = S.settings, key = s.bgType + '|' + s.bgUrl; if (accBusy || (!force && key === accKey)) return; accKey = key; accBusy = true;
    try { await new Promise(r => setTimeout(r, 60)); const px = await bgPixels(), p = px && pickAccent(px); if (p && (p[0] !== s.accentA || p[1] !== s.accentB)) await save({ accentA: p[0], accentB: p[1] }); }
    catch (err) { console.warn('accent from background:', err); } finally { accBusy = false; }
  }

  // ---------- auto-hide bar ----------
  let ahT = 0;
  const ahOn = () => app() && app().classList.contains('bar-ah');
  const show = () => { clearTimeout(ahT); if (!app().classList.contains('bar-show')) { app().classList.add('bar-show'); setTimeout(() => moveInd(false), 30); } };
  const hide = (ms = 450) => { clearTimeout(ahT); ahT = setTimeout(() => { const side = $('#side'); if (side && (side.matches(':hover') || side.contains(document.activeElement) && document.activeElement.matches(':focus-visible'))) return; app().classList.remove('bar-show'); }, ms); };
  const inZone = t => t && t.closest && (t.closest('#side,#edgez') || (sidePos() === 'top' && t.closest('#titlebar')));
  document.addEventListener('mouseover', e => { if (!ahOn()) return; if (inZone(e.target)) show(); else if (app().classList.contains('bar-show')) hide(); });
  document.addEventListener('mouseout', e => { if (ahOn() && !e.relatedTarget) hide(700); });
  document.addEventListener('focusin', e => { if (ahOn() && e.target.closest && e.target.closest('#side') && e.target.matches(':focus-visible')) show(); });

  // ---------- ambient effects (one canvas, capped at 30fps, paused when not visible) ----------
  const fx = { kind: 'off', amt: 50, ps: [], raf: 0, last: 0, w: 0, h: 0, sprite: null, spriteKey: '' };
  const fxCanvas = () => { let c = $('#fx'); if (!c) { c = document.createElement('canvas'); c.id = 'fx'; const bg = $('#bg'); bg ? bg.after(c) : app().prepend(c); } return c; };
  const makeSprite = (rgb, soft) => { const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'), g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, `rgba(${rgb},1)`); g.addColorStop(soft, `rgba(${rgb},.55)`); g.addColorStop(1, `rgba(${rgb},0)`); x.fillStyle = g; x.fillRect(0, 0, 32, 32); return c; };
  const rnd = (a, b) => a + Math.random() * (b - a);
  function spawn(p, top) {
    const { w, h } = fx; p.x = rnd(0, w); p.t = rnd(0, 6.28);
    if (fx.kind === 'snow') { p.y = top ? rnd(-h * 0.1, 0) : rnd(0, h); p.r = rnd(1.2, 3.6); p.vy = rnd(14, 38) * (p.r / 3); p.vx = rnd(-6, 6); p.a = rnd(0.35, 0.85); }
    else if (fx.kind === 'fireflies') { p.y = rnd(h * 0.15, h); p.r = rnd(2, 4.5); p.vx = rnd(-10, 10); p.vy = rnd(-8, 8); p.a = rnd(0.4, 1); }
    else { p.ember = Math.random() < 0.35; p.y = top ? (p.ember ? h + 10 : -10) : rnd(0, h); p.r = p.ember ? rnd(1.4, 3) : rnd(1.5, 3.5); p.vy = p.ember ? -rnd(14, 34) : rnd(8, 22); p.vx = rnd(-8, 8); p.a = p.ember ? rnd(0.5, 1) : rnd(0.25, 0.6); }
    return p;
  }
  function resize() { const c = fxCanvas(), d = Math.min(window.devicePixelRatio || 1, 1.5); fx.w = innerWidth; fx.h = innerHeight; c.width = Math.round(fx.w * d); c.height = Math.round(fx.h * d); c.getContext('2d').setTransform(d, 0, 0, d, 0, 0); }
  function populate() { const lite = app().classList.contains('lite'), n = Math.round(Math.min(160, (fx.amt / 100) * 140 * Math.max(0.5, fx.w * fx.h / (1280 * 800))) * (lite ? 0.5 : 1)); fx.ps = Array.from({ length: n }, () => spawn({}, false)); }
  const paused = () => fx.kind === 'off' || bgShouldPause() || Object.keys(S.running || {}).length > 0;
  function draw(dt) {
    const x = fxCanvas().getContext('2d'), { w, h } = fx; x.clearRect(0, 0, w, h); x.globalCompositeOperation = fx.kind === 'snow' ? 'source-over' : 'lighter';
    const ash = fx.kind === 'ash' ? (fx.ashSprite || (fx.ashSprite = makeSprite('150,140,135', 0.5))) : null;
    for (const p of fx.ps) {
      p.t += dt;
      if (fx.kind === 'snow') { p.x += (p.vx + Math.sin(p.t * 0.8) * 10) * dt; p.y += p.vy * dt; if (p.y > h + 6) spawn(p, true); }
      else if (fx.kind === 'fireflies') { p.vx += rnd(-12, 12) * dt; p.vy += rnd(-12, 12) * dt; p.vx = Math.max(-16, Math.min(16, p.vx)); p.vy = Math.max(-14, Math.min(14, p.vy)); p.x += p.vx * dt; p.y += p.vy * dt; if (p.y < -10 || p.y > h + 10) p.vy *= -1; }
      else { p.x += (p.vx + Math.sin(p.t * 1.3) * 6) * dt; p.y += p.vy * dt; if (p.y > h + 10 || p.y < -14) spawn(p, true); }
      if (p.x < -10) p.x = w + 8; else if (p.x > w + 10) p.x = -8;
      const a = fx.kind === 'fireflies' ? p.a * (0.45 + 0.55 * Math.sin(p.t * 2.2) ** 2) : p.ember ? p.a * (0.6 + 0.4 * Math.sin(p.t * 5)) : p.a;
      x.globalAlpha = a; const s = p.r * (fx.kind === 'snow' ? 2.2 : 3.4); x.drawImage(ash && !p.ember ? ash : fx.sprite, p.x - s / 2, p.y - s / 2, s, s);
    }
    x.globalAlpha = 1;
  }
  function loop(now) {
    fx.raf = 0; if (paused()) return;
    const dt = Math.min(0.1, (now - (fx.last || now)) / 1000); if (now - fx.last >= 32 || !fx.last) { fx.last = now; draw(dt || 1 / 30); }
    fx.raf = requestAnimationFrame(loop);
  }
  const wake = () => { if (!fx.raf && !paused() && S.settings.animations !== false) { fx.last = 0; fx.raf = requestAnimationFrame(loop); } };
  function setFx(kind, amt, accent) {
    const c = fxCanvas(), key = kind + '|' + accent; c.style.display = kind === 'off' ? 'none' : '';
    if (kind === 'off') { if (fx.raf) cancelAnimationFrame(fx.raf); fx.raf = 0; fx.kind = kind; fx.ps = []; c.width = c.height = 0; return; }
    if (fx.spriteKey !== key) { fx.spriteKey = key; fx.sprite = makeSprite(kind === 'snow' ? '255,255,255' : kind === 'ash' ? '255,140,60' : accent, kind === 'snow' ? 0.55 : 0.3); }
    const fresh = fx.kind !== kind || fx.amt !== amt || !c.width; fx.kind = kind; fx.amt = amt;
    if (fresh) { resize(); populate(); draw(0); }
    if (S.settings.animations === false) { if (fresh) draw(0); return; }
    wake();
  }
  window.addEventListener('resize', () => { if (fx.kind === 'off') return; clearTimeout(fx.rt); fx.rt = setTimeout(() => { resize(); populate(); draw(0); }, 150); });
  window.addEventListener('focus', wake); document.addEventListener('visibilitychange', wake);

  // ---------- apply ----------
  let zoomSent = null;
  window.looksApply = (s, hasBg) => {
    const a = app(), r = themeVars, cl = (c, on) => a.classList.toggle(c, !!on);
    cl('gall', s.glassAll);
    const ah = !!(s.barAutoHide && s.secondBar); cl('bar-ah', ah); if (!ah) a.classList.remove('bar-show');
    if (ah && !$('#edgez')) { const z = document.createElement('div'); z.id = 'edgez'; $('#body').appendChild(z); }
    cl('dense', s.density === 'compact');
    cl('ff-inter', s.fontFamily === 'inter'); cl('ff-system', s.fontFamily === 'system'); cl('ff-pixel', s.fontPixel);
    cl('cs-list', s.cardStyle === 'list'); cl('cs-compact', s.cardStyle === 'compact');
    r.setProperty('--glow', ((s.glow ?? 100) / 100).toFixed(2));
    r.setProperty('--pc', hex2rgb(s.panelColor || '#12151c').join(','));
    const z = s.uiScale || 100; if (zoomSent !== z) { zoomSent = z; call('applyZoom'); setTimeout(() => moveInd(false), 60); }
    setFx(s.ambient || 'off', s.ambientAmount || 50, hex2rgb(s.accentA || '#34d399').join(','));
    if (s.accentAuto && hasBg) autoAccent(false); else accKey = null;
  };
})();
