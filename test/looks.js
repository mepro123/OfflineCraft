// Style options. Run: OC_DATA=/tmp/ocl OC_BG=/tmp/bg-sunset.png DISPLAY=:0 node_modules/electron/dist/electron test/looks.js --no-sandbox
const { app } = require('electron'); const fs = require('fs'); require('../main.js');
const D = process.env.OC_DATA, OUT = process.env.OC_SHOTS || '/tmp/shots-looks'; const sleep = ms => new Promise(r => setTimeout(r, ms));
const mk = (id, o) => { fs.mkdirSync(`${D}/instances/${id}/minecraft`, { recursive: true }); fs.writeFileSync(`${D}/instances/${id}/instance.json`, JSON.stringify({ id, name: id, mc: '1.20.1', loader: 'fabric', loaderVer: '', versionId: '', ramMB: 0, javaPath: '', jvmArgs: '', width: 0, height: 0, fullscreen: false, ready: true, created: 1700000000, lastPlayed: Date.now() / 1000 - 3600, playTime: 7300, ...o })); };
mk('Survival Fabric', {}); mk('Create Pack', { loader: 'neoforge', lastPlayed: 0 }); mk('PvP', { mc: '1.8.9', loader: 'vanilla' }); mk('Skyblock', { mc: '1.21.1', loader: 'quilt' }); mk('Hardcore', { mc: '1.21.4', pinned: true });
let fails = 0;
app.on('browser-window-created', (e, w) => w.webContents.on('did-finish-load', async () => { try {
  const ev = s => w.webContents.executeJavaScript(s); fs.mkdirSync(OUT, { recursive: true });
  const shot = async n => { await sleep(700); fs.writeFileSync(`${OUT}/${n}.png`, (await w.webContents.capturePage()).toPNG()); };
  const set = async o => { await ev(`window.oc.call('saveSettings', ${JSON.stringify(o)})`); await sleep(450); };
  const ok = (c, m) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const cs = (sel, p) => ev(`getComputedStyle(document.querySelector(${JSON.stringify(sel)}))[${JSON.stringify(p)}]`);
  await sleep(1200); await set({ username: 'Tham' });
  ok(await ev(`['gall','bar-ah','dense','ff-inter','ff-pixel','cs-list','cs-compact'].every(c=>!document.querySelector('#app').classList.contains(c)) && getComputedStyle(document.querySelector('#fx')).display==='none'`), 'defaults leave the look unchanged');
  // perf: theme application skips unchanged CSS variables
  const t = await ev(`(()=>{const t0=performance.now();for(let i=0;i<300;i++)applyTheme();return (performance.now()-t0)/300})()`); ok(t < 2, `applyTheme ${t.toFixed(3)} ms per call`);
  if (process.env.OC_BG) { fs.mkdirSync(D + '/backgrounds', { recursive: true }); fs.copyFileSync(process.env.OC_BG, D + '/backgrounds/bg.png'); await set({ bgFile: 'bg.png', bgType: 'image', bgVer: 1, bgDim: 25, panelOpacity: 75 }); await sleep(600); }
  const before = await ev(`S.settings.accentA`);
  await set({ accentAuto: true }); await sleep(1200);
  const acc = await ev(`[S.settings.accentA,S.settings.accentB]`); ok(acc[0] !== before && /^#[0-9a-f]{6}$/.test(acc[0]) && /^#[0-9a-f]{6}$/.test(acc[1]), 'accent picked from background: ' + acc.join(' '));
  ok(await ev(`getComputedStyle(document.documentElement).getPropertyValue('--a').trim()`) === (() => { const h = acc[0].slice(1); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)).join(','); })(), 'accent applied to the theme');
  ok(JSON.stringify(await ev(`pickAccent(new Uint8ClampedArray([128,128,128,255,10,10,10,255]))`)) === 'null', 'grey image keeps your own accent');
  await shot('1-accent-from-bg');
  await set({ glassAll: true }); ok(/blur/.test(await cs('.card', 'backdropFilter')), 'glass everywhere: cards are frosted (' + await cs('.card', 'backdropFilter') + ')');
  ok(/blur/.test(await cs('.cont', 'backdropFilter')), 'glass everywhere: continue-playing panel'); await shot('2-glass-everywhere');
  await ev(`document.querySelector('.card .more').click()`); await sleep(300); ok(/blur/.test(await cs('.menu', 'backdropFilter')), 'glass everywhere: menus'); await shot('3-glass-menu'); await ev(`document.body.click()`); await sleep(200);
  await ev(`go('settings')`); await sleep(400); ok(/blur/.test(await cs('.panel', 'backdropFilter')), 'glass everywhere: settings panels');
  await ev(`document.querySelector('[data-key=looks]').scrollIntoView({block:'start'})`); await shot('4-style-settings');
  await ev(`document.querySelector('[data-key=lk-navs]').scrollIntoView({block:'center'})`); await shot('5-style-settings-2');
  await ev(`go('library')`); await set({ glassAll: false });
  // auto-hide
  await set({ secondBar: true, barAutoHide: true, sidebarPos: 'left', sidebarGlass: true });
  ok(await ev(`document.querySelector('#app').classList.contains('bar-ah') && getComputedStyle(document.querySelector('#side')).opacity==='0' && document.querySelector('#main').getBoundingClientRect().left < 40`), 'auto-hide: left bar hidden, content uses the space'); await shot('6-autohide-hidden');
  await ev(`document.querySelector('#edgez').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))`); await sleep(500);
  ok(await ev(`document.querySelector('#app').classList.contains('bar-show') && document.querySelector('#side').getBoundingClientRect().left >= 0`), 'auto-hide: edge reveals the bar'); await shot('7-autohide-shown');
  await ev(`document.querySelector('.card').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))`); await sleep(900); ok(await ev(`!document.querySelector('#app').classList.contains('bar-show')`), 'auto-hide: leaving hides it again');
  for (const p of ['right', 'bottom', 'top']) { await set({ sidebarPos: p }); const z = p === 'top' ? '#titlebar' : '#edgez'; ok(await ev(`getComputedStyle(document.querySelector('#side')).opacity==='0'`), `auto-hide ${p}: hidden`); await ev(`document.querySelector('${z}').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))`); await sleep(500); ok(await ev(`getComputedStyle(document.querySelector('#side')).opacity==='1'`), `auto-hide ${p}: revealed`); if (p === 'bottom') await shot('8-autohide-bottom'); await ev(`document.querySelector('.card').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))`); await sleep(800); }
  await set({ secondBar: false }); ok(await ev(`!document.querySelector('#app').classList.contains('bar-ah') && getComputedStyle(document.querySelector('#side')).opacity==='1'`), 'auto-hide needs the separate bar'); await set({ barAutoHide: false, sidebarPos: 'left', sidebarGlass: false });
  // scale + density
  await set({ uiScale: 110 }); await sleep(300); ok(Math.abs(w.webContents.getZoomFactor() - 1.1) < 0.01, 'UI scale zooms the page'); await shot('9-scale-110'); await set({ uiScale: 100 }); await sleep(300); ok(Math.abs(w.webContents.getZoomFactor() - 1) < 0.01, 'UI scale back to 100%');
  await set({ density: 'compact' }); ok(await cs('#main', 'paddingTop') === '18px', 'compact density'); await shot('10-compact');
  // fonts
  await set({ fontFamily: 'inter', fontPixel: true }); await sleep(600); await ev(`document.fonts.ready`);
  ok(/Inter/.test(await cs('#app', 'fontFamily')) && await ev(`document.fonts.check('14px Inter')`), 'Inter font loads');
  ok(/Monocraft/.test(await cs('.page-head h1', 'fontFamily')) && await ev(`document.fonts.check('20px Monocraft')`), 'Minecraft heading font loads'); await shot('11-fonts');
  await set({ fontFamily: 'system', fontPixel: false, density: 'comfortable' }); ok(/system-ui/.test(await cs('#app', 'fontFamily')), 'system font'); await set({ fontFamily: 'default' });
  // cards
  await set({ cardStyle: 'list' }); ok(await cs('.card', 'display') === 'flex' && await ev(`document.querySelector('.card').getBoundingClientRect().width > 700`), 'list cards'); await shot('12-cards-list');
  await set({ cardStyle: 'compact' }); ok(await ev(`document.querySelector('.cover').getBoundingClientRect().height < 70`), 'compact cards'); await shot('13-cards-compact');
  await ev(`document.querySelector('.card').click()`); await sleep(400); ok(await ev(`S.page==='instance'`), 'cards still open the instance'); await ev(`go('library')`); await set({ cardStyle: 'grid' });
  // glow
  await set({ glow: 200 }); ok(await ev(`getComputedStyle(document.documentElement).getPropertyValue('--glow').trim()`) === '2.00', 'glow intensity'); await set({ glow: 0 }); ok(/rgba\(\d+, \d+, \d+, 0\)/.test(await cs('.btn.primary', 'boxShadow')), 'glow 0 removes the button glow'); await set({ glow: 100 });
  // sidebar items
  await set({ navHidden: ['host', 'skins'], navOrder: ['discover', 'library', 'accounts', 'skins', 'host'] });
  ok(await ev(`[...document.querySelectorAll('#navitems .nav')].map(n=>n.dataset.p).join()`) === 'discover,library,accounts,settings', 'sidebar order + hidden items');
  await ev(`go('host')`); await sleep(400); ok(await ev(`S.page==='host'`), 'hidden page is still reachable'); await ev(`go('discover')`); await sleep(500);
  ok(await ev(`(()=>{const i=document.querySelector('#navind').getBoundingClientRect(),n=document.querySelector('.nav.on').getBoundingClientRect();return Math.abs(i.top-n.top)<3})()`), 'indicator follows reordered items'); await shot('14-nav-custom');
  await ev(`go('settings')`); await sleep(400); await ev(`document.querySelector('[data-lact=navmv][data-id=library][data-d="-1"]').click()`); await sleep(500); ok(await ev(`S.settings.navOrder[0]==='library'`), 'move-up button reorders');
  await ev(`document.querySelector('#lk-nav-host').click()`); await sleep(500); ok(await ev(`!S.settings.navHidden.includes('host')`), 'switch shows an item again');
  await set({ navHidden: [], navOrder: [] }); await ev(`go('library')`);
  // ambient
  for (const k of ['snow', 'fireflies', 'ash']) { await set({ ambient: k, ambientAmount: 80 }); await sleep(500); ok(await ev(`(()=>{const c=document.querySelector('#fx');const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=16)if(d[i])n++;return c.width>0&&n>50})()`), `ambient ${k} draws`); await shot('15-fx-' + k); }
  const moving = await ev(`(async()=>{const c=document.querySelector('#fx'),a=c.toDataURL();await new Promise(r=>setTimeout(r,300));return a!==c.toDataURL()})()`); ok(moving, 'ambient animates');
  await set({ ambient: 'off' }); ok(await ev(`getComputedStyle(document.querySelector('#fx')).display==='none' && document.querySelector('#fx').width===0`), 'ambient off frees the canvas');
  // theme files keep the new options
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
} catch (e) { console.log('HARNESS ERROR', e.stack); } app.quit(); }));
