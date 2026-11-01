'use strict';
// ===== Server hosting page + Library server browser (loaded after app.js) =====
Object.assign(IC, {
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
});
S.libTab = 'instances';
S.srv = { status: {}, filter: 'all', view: 'mine', disc: { list: [], next: '', loading: false, loaded: false, err: '', q: '', sort: 'players', country: '', hideEmpty: false, tok: 0 } };
const SD_COUNTRIES = [['', 'Any country'], ['US', 'United States'], ['GB', 'United Kingdom'], ['DE', 'Germany'], ['FR', 'France'], ['CA', 'Canada'], ['BR', 'Brazil'], ['AU', 'Australia'], ['NL', 'Netherlands'], ['PL', 'Poland'], ['ES', 'Spain'], ['IT', 'Italy'], ['RU', 'Russia'], ['TR', 'Turkey'], ['MX', 'Mexico'], ['JP', 'Japan'], ['KR', 'South Korea'], ['IN', 'India'], ['SG', 'Singapore'], ['TH', 'Thailand'], ['ID', 'Indonesia'], ['PH', 'Philippines'], ['VN', 'Vietnam'], ['SE', 'Sweden'], ['FI', 'Finland'], ['AR', 'Argentina'], ['CL', 'Chile'], ['UA', 'Ukraine'], ['PT', 'Portugal'], ['CZ', 'Czechia'], ['RO', 'Romania']];
S.host = { list: [], sel: null, tab: 'over', logs: {}, net: {}, test: {}, howto: false, netT: 0 };
const CURATED = [
  { name: 'Hypixel', host: 'mc.hypixel.net' }, { name: 'Wynncraft', host: 'play.wynncraft.com' }, { name: 'CubeCraft', host: 'play.cubecraft.net' },
  { name: '2b2t', host: '2b2t.org' }, { name: 'MCC Island', host: 'play.mccisland.net' }, { name: 'Minemen Club', host: 'na.minemen.club' },
  { name: 'PikaNetwork', host: 'play.pika-network.net' }, { name: 'ManaCube', host: 'play.manacube.com' }, { name: 'Minehut', host: 'play.minehut.gg' },
  { name: 'Complex Gaming', host: 'hub.mc-complex.com' }, { name: 'Mineland', host: 'mineland.net' }, { name: 'Jartex Network', host: 'play.jartexnetwork.com' },
  { name: 'GommeHD', host: 'gommehd.net' }, { name: 'Funcraft', host: 'play.funcraft.net' }, { name: 'DogCraft', host: 'dogcraft.net' },
  { name: 'Simply Vanilla', host: 'play.simplyvanilla.net' }, { name: 'Mush', host: 'mush.com.br' },
];
const libSeg = () => `<div class="seg" data-key="libseg"><button class="${S.libTab !== 'servers' ? 'on' : ''}" data-hact="libtab" data-v="instances">Instances</button><button class="${S.libTab === 'servers' ? 'on' : ''}" data-hact="libtab" data-v="servers">Servers</button></div>`;
const srvKey = (h, p) => h + ':' + (p || '');
function parseAddr(s) { s = String(s || '').trim().replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, ''); const m = s.match(/^([^\s:]+)(?::(\d{1,5}))?$/); return m ? { host: m[1], port: m[2] ? +m[2] : 0 } : null; }
function srvEntries() {
  const saved = (S.settings.servers || []).map(s => ({ ...s, kind: 'saved' })), have = new Set(saved.map(s => srvKey(s.host, s.port)));
  const mine = (S.host.list || []).map(h => ({ id: 'host:' + h.id, name: h.name, host: 'localhost', port: parseInt((h.props || {})['server-port']) || 25565, kind: 'hosted' }));
  if (S.srv.view === 'disc') { const D = S.srv.disc; return D.list.length || !D.err ? D.list.map(x => ({ ...x, kind: 'disc' })) : CURATED.map(c => ({ ...c, id: 'cur:' + c.host, port: 0, kind: 'curated' })); }
  return [...mine, ...saved];
}
let srvRaf = 0;
function schedSrvRender() { if (srvRaf) return; srvRaf = requestAnimationFrame(() => { srvRaf = 0; if (S.page === 'library' && S.libTab === 'servers') render(); }); }
async function srvRefresh(force) {
  const now = Date.now(), todo = srvEntries().filter(e => { const st = S.srv.status[srvKey(e.host, e.port)]; return force || !st || (st.state !== 'loading' && now - st.t > 90000); }); if (!todo.length) return;
  todo.forEach(e => { const k = srvKey(e.host, e.port); S.srv.status[k] = { ...(S.srv.status[k] || {}), state: 'loading', t: now }; });
  let i = 0; const worker = async () => { while (i < todo.length) { const e = todo[i++], k = srvKey(e.host, e.port); let r; try { r = await call('serverStatus', { host: e.host, port: e.port }); } catch { r = { online: false }; } S.srv.status[k] = { ...r, state: 'done', t: Date.now() }; schedSrvRender(); } };
  await Promise.all(Array.from({ length: 10 }, worker));
}
function srvCard(e, st, ms) {
  const up = !!st.online, loading = st.state === 'loading' && st.online === undefined, need = up && st.mode === 'online' && !ms;
  const mode = !up ? '' : st.mode === 'online' ? `<span class="badge-m ms">${ic('lock')}Microsoft only</span>` : st.mode === 'offline' ? '<span class="badge-m off">Offline OK</span>' : '<span class="badge-m unk">Mode unknown</span>';
  const fav = st.favicon ? `<img class="pimg" data-l="${letter(e.name)}" src="${esc(st.favicon)}" width="56" height="56" style="image-rendering:pixelated">` : letter(e.name);
  const btn = e.kind === 'disc' ? `<button class="btn" data-hact="sdadd" data-host="${esc(e.host)}" data-port="${e.port || 0}" data-name="${esc(e.name)}">${ic('plus')}Add</button>` : e.kind === 'curated' ? `<button class="btn" data-hact="scur" data-host="${esc(e.host)}" data-name="${esc(e.name)}">${ic('plus')}Add</button>` : e.kind === 'saved' ? `<button class="btn icon" data-hact="srem" data-id="${esc(e.id)}" data-tip="Remove">${ic('trash')}</button>` : '';
  return `<div class="srv-card ${up ? '' : 'down'}" data-key="srv:${esc(e.id)}"><div class="row" style="flex-wrap:nowrap;align-items:flex-start"><div class="pic" style="width:56px;height:56px;font-size:22px;background:${st.favicon ? 'none' : 'var(--grad)'}">${fav}</div><div class="grow" style="min-width:0"><div class="srv-name">${esc(e.name)} ${e.kind === 'hosted' ? '<span class="chip acc">Hosted by you</span>' : ''}</div><div class="dim mono" style="font-size:12px">${esc(e.host)}${e.port ? ':' + e.port : ''}</div></div><span class="dot ${loading ? 'starting' : up ? 'running' : 'stopped'}" data-tip="${loading ? 'Checking…' : up ? 'Online' : 'Offline or unreachable'}"></span></div>
  <div class="srv-motd">${up ? esc(st.motd || ' ') : loading ? 'Checking…' : e.kind === 'disc' ? 'Listed as online. Its details could not be checked from here, you can still try to join.' : 'Could not reach this server.'}</div>
  <div class="row srv-stats">${up ? `<span>${ic('user')}${st.players.online}/${st.players.max}</span><span>${st.ms} ms</span><span>${esc(st.version)}</span>${e.country ? `<span>${esc(e.country)}</span>` : ''}` : e.kind === 'disc' ? `<span>${ic('user')}${e.players}/${e.max}</span>${e.country ? `<span>${esc(e.country)}</span>` : ''}` : ''}</div>
  <div class="row" style="margin-top:10px">${mode}</div>
  <div class="row" style="margin-top:12px"><button class="btn primary" data-hact="sjoin" data-host="${esc(e.host)}" data-port="${e.port || 0}" ${(up || e.kind === 'disc' || e.kind === 'curated') && !need ? '' : 'disabled'}>Join</button>${btn}${need ? '<span class="srv-note">Needs a Microsoft account</span>' : ''}</div></div>`;
}
async function discLoad(reset) {
  const D = S.srv.disc; if (D.loading && !reset) return; const tok = ++D.tok; D.loading = true; D.err = ''; if (reset) { D.list = []; D.next = ''; } schedSrvRender();
  try {
    const r = await call('srvDiscover', { search: D.q, sort: D.sort, country: D.country, next: reset ? '' : D.next }); if (tok !== D.tok) return;
    const have = new Set(D.list.map(x => x.id)); D.list.push(...r.servers.filter(x => !have.has(x.id))); D.next = r.next || '';
  } catch (e) { if (tok !== D.tok) return; D.err = String(e.message || e).replace(/^.*Error: /, ''); }
  D.loaded = true; D.loading = false; schedSrvRender(); srvRefresh();
}
function pgServers() {
  if (!S.srv.viewSet) { S.srv.viewSet = true; if (!(S.settings.servers || []).length) S.srv.view = 'disc'; }
  queueMicrotask(() => srvRefresh()); const ms = !!S.settings.activeMs, f = S.srv.filter, v = S.srv.view, D = S.srv.disc;
  if (v === 'disc' && !D.loaded && !D.loading) queueMicrotask(() => discLoad(true));
  const head = `<div class="page-head"><h1>Library</h1>${libSeg()}<div class="grow"></div><button class="btn icon" data-hact="srefresh" data-tip="Refresh">${ic('refresh')}</button></div>`;
  const acct = `<div class="srv-acct ${ms ? 'ms' : 'off'}" data-key="srvacct">${ic(ms ? 'check' : 'lock')}<span>Playing as <b>${esc(S.settings.username || 'nobody')}</b> · ${ms ? 'Microsoft account: you can join any server' : 'offline account: you can only join servers that allow offline players'}</span></div>`;
  const tabs = `<div class="tabs" data-key="svtabs" style="margin:16px 0 14px">${[['mine', 'My servers'], ['disc', 'Discover public servers']].map(([k, l]) => `<button class="${v === k ? 'on' : ''}" data-hact="sview" data-v="${k}">${l}</button>`).join('')}</div>`;
  const chips = `<div class="cchips" style="margin:0">${[['all', 'All'], ['ms', 'Microsoft only'], ['off', 'Offline friendly'], ['up', 'Online now']].map(([k, l]) => `<button class="cchip ${f === k ? 'on' : ''}" data-hact="sfilter" data-v="${k}">${l}</button>`).join('')}</div>`;
  const bar = v === 'disc'
    ? `<div class="row" style="margin:0 0 14px;gap:10px;flex-wrap:wrap" data-key="sdbar"><div class="search" style="flex:1;min-width:220px;max-width:360px"><input id="sdq" value="${esc(D.q)}" placeholder="Search by name or address" autocomplete="off">${ic('search')}</div><button class="btn primary" data-hact="sdsearch">Search</button>
      <select data-sd="sort" style="width:170px">${[['players', 'Most players'], ['rank', 'Top ranked']].map(([k, l]) => `<option value="${k}" ${D.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select data-sd="country" style="width:170px">${SD_COUNTRIES.map(([k, l]) => `<option value="${k}" ${D.country === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="cchip ${D.hideEmpty ? 'on' : ''}" data-hact="sdempty">Hide empty</button>${chips}</div>`
    : `<div class="row" style="margin:14px 0"><div class="search" style="flex:1;max-width:380px"><input id="srvadd" placeholder="Add a server, e.g. play.example.com:25565">${ic('plus')}</div><button class="btn primary" data-hact="sadd">Add</button><div style="margin-left:12px">${chips}</div></div>`;
  const all = srvEntries().map(e => ({ e, st: S.srv.status[srvKey(e.host, e.port)] || { state: 'loading' } }));
  const rows = all.filter(({ e, st }) => (f === 'all' || (f === 'ms' && st.mode === 'online') || (f === 'off' && st.mode === 'offline') || (f === 'up' && st.online)) && !(v === 'disc' && D.hideEmpty && e.kind === 'disc' && !(e.players > 0)));
  const cards = rows.map(({ e, st }) => srvCard(e, st, ms)).join('');
  let body;
  if (v === 'disc') {
    const fallback = D.err && !D.list.length;
    const note = D.err ? `<div class="chipwarn" data-key="sderr" style="margin:0 0 12px;display:flex;gap:10px;align-items:center">${esc(D.err)}${fallback ? ' Showing a few popular servers instead.' : ''}<button class="btn sm" data-hact="sdretry">Try again</button></div>` : '';
    const more = D.loading ? `<div data-key="sdload">${loadingHtml('Looking for servers…')}</div>` : D.next && !fallback ? `<div class="row" data-key="sdmore" style="justify-content:center;margin:18px 0"><button class="btn" data-hact="sdmore">Load more servers</button></div>` : '';
    const hint = !D.loading && D.list.length ? `<div class="dim" data-key="sdcount" style="margin:0 0 10px;font-size:12.5px">${rows.length} of ${D.list.length} loaded servers shown${f === 'ms' || f === 'off' ? ' (the Microsoft/offline check runs on each server, so it may take a moment)' : ''}.</div>` : '';
    body = note + hint + (cards ? `<div class="grid srv-grid" data-key="srvgrid">${cards}</div>` : D.loading ? '' : `<div class="empty" data-key="srvempty"><div><h3>No servers found</h3><div>Try another search, another country or a different filter.</div></div></div>`) + more;
  } else body = cards ? `<div class="grid srv-grid" data-key="srvgrid">${cards}</div>` : `<div class="empty" data-key="srvempty"><div><h3>No servers here yet</h3><div>Add one by its address, or open "Discover public servers" to find some.</div><div class="row" style="justify-content:center"><button class="btn primary" data-hact="sview" data-v="disc">${ic('globe')}Discover servers</button></div></div></div>`;
  return head + acct + tabs + bar + body;
}
const verParts = v => { const m = /^(\d+)\.(\d+)(?:\.(\d+|x))?/.exec(String(v)); return m ? [+m[1], +m[2], m[3] === undefined || m[3] === 'x' ? (m[3] === 'x' ? Infinity : 0) : +m[3]] : null; };
const verCmp = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0; };
// does a Minecraft version (1.21.4) fit what a server announces ("Paper 1.21.4", "1.8.x-1.21.x", "1.20")?
function verMatches(mc, text) {
  const v = verParts(mc), t = String(text || ''); if (!v || !t) return false;
  const rg = /(\d+\.\d+(?:\.(?:\d+|x))?)\s*(?:-|–|to)\s*(\d+\.\d+(?:\.(?:\d+|x))?)/.exec(t);
  if (rg) { const lo = verParts(rg[1]), hi = verParts(rg[2]); if (lo && hi && verCmp(v, lo) >= 0 && verCmp(v, hi) <= 0) return true; }
  return (t.match(/\d+\.\d+(?:\.\d+)?/g) || []).some(x => { const p = verParts(x); return p && p[0] === v[0] && p[1] === v[1] && (x.split('.').length < 3 || p[2] === v[2]); });
}
const serverMc = t => { const m = /(\d+\.\d+(?:\.\d+)?)(?!.*\d+\.\d+)/.exec(String(t || '')); return m ? m[1] : ''; };
function joinModal(host, port) {
  const st = S.srv.status[srvKey(host, port)] || {}, fits = i => verMatches(i.mc, st.version), ins = [...S.instances].sort((a, b) => fits(b) - fits(a) || (b.lastPlayed || 0) - (a.lastPlayed || 0));
  const want = serverMc(st.version), any = ins.some(fits), addr = `${host}${port ? ':' + port : ''}`;
  const make = want && !any ? `<div class="chipwarn" style="margin-top:12px">None of your instances is on ${esc(want)}. <button class="btn sm" data-hact="joinmake" data-mc="${esc(want)}" data-addr="${esc(addr)}">Create a ${esc(want)} instance</button></div>` : '';
  if (!ins.length && !want) { toast('Create an instance first, then join a server with it', true); return; }
  modal(`<h2>Join ${esc(host)}</h2><label>Play with this instance${st.version ? ` (server is on ${esc(st.version)})` : ''}</label>${ins.length ? `<select id="joininst">${ins.map(i => `<option value="${esc(i.id)}" ${i === ins[0] && fits(i) ? 'selected' : ''}>${esc(i.name)} · ${esc(i.mc)} ${LN(i.loader)}${fits(i) ? ' ✓ matches' : ''}</option>`).join('')}</select>` : '<div class="dim">You have no instances yet.</div>'}${make}<div class="dim" style="margin-top:10px;font-size:12.5px">Joining as <b>${esc(S.settings.username)}</b> (${S.settings.activeMs ? 'Microsoft account' : 'offline account'}). The game starts and connects automatically.</div><div class="foot"><button class="btn" data-act="closemodal">Cancel</button>${ins.length ? `<button class="btn primary" data-hact="dojoin" data-addr="${esc(addr)}">${ic('play')}Join server</button>` : ''}</div>`);
}

// ---- hosting your own server
const HDEF = { motd: 'A Minecraft Server', 'max-players': '20', 'server-port': '25565', difficulty: 'easy', gamemode: 'survival', 'force-gamemode': 'false', hardcore: 'false', pvp: 'true', 'white-list': 'false', 'enforce-whitelist': 'false', 'online-mode': 'true', 'level-name': 'world', 'level-seed': '', 'level-type': 'minecraft:normal', 'generate-structures': 'true', 'allow-nether': 'true', 'spawn-monsters': 'true', 'spawn-animals': 'true', 'spawn-npcs': 'true', 'spawn-protection': '16', 'max-world-size': '29999984', 'allow-flight': 'false', 'enable-command-block': 'false', 'player-idle-timeout': '0', 'view-distance': '10', 'simulation-distance': '10', 'network-compression-threshold': '256', 'entity-broadcast-range-percentage': '100', 'enable-status': 'true', 'hide-online-players': 'false', 'enable-query': 'false', 'prevent-proxy-connections': 'false' };
const B = (k, n, d) => ({ k, n, d, t: 'bool' }), N = (k, n, d, min, max) => ({ k, n, d, t: 'num', min, max }), T = (k, n, d) => ({ k, n, d, t: 'text' }), Sel = (k, n, d, o) => ({ k, n, d, t: 'sel', o });
const HGROUPS = [
  ['General', [T('motd', 'Server message (MOTD)', 'The text players see under your server name in their server list.'), N('max-players', 'Max players', 'How many people can be online at the same time.', 1, 1000), N('server-port', 'Port', 'The network port the server listens on. 25565 is the default. Friends need this number too.', 1024, 65535),
    B('online-mode', 'Require Microsoft accounts', 'On: only real Microsoft accounts can join (names and skins are verified). Off: anyone can join with any name, including offline accounts, but nothing is verified.'), B('white-list', 'Whitelist', 'Only players you add with the command "whitelist add NAME" can join.'), B('enforce-whitelist', 'Enforce whitelist', 'Kick players who are not on the whitelist right away when it changes.')]],
  ['Gameplay', [Sel('difficulty', 'Difficulty', 'How hard the game is for everyone on the server.', [['peaceful', 'Peaceful'], ['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']]), Sel('gamemode', 'Default game mode', 'The game mode new players start in.', [['survival', 'Survival'], ['creative', 'Creative'], ['adventure', 'Adventure'], ['spectator', 'Spectator']]), B('force-gamemode', 'Force game mode', 'Put players back in the default game mode every time they join.'), B('hardcore', 'Hardcore', 'Players are banned from the server when they die.'), B('pvp', 'Player vs player', 'Let players hurt each other.'), B('allow-flight', 'Allow flying', 'Stops the server from kicking players that fly. Needed for some mods and creative flying.'), B('enable-command-block', 'Command blocks', 'Allow command blocks to run commands.'), N('player-idle-timeout', 'Kick idle players (minutes)', '0 means never kick players for being idle.', 0, 1440)]],
  ['World', [T('level-name', 'World folder name', 'The folder name of the world. Change it to start a brand new world.'), T('level-seed', 'World seed', 'Leave empty for a random world. Only used when the world is first created.'), Sel('level-type', 'World type', 'Only used when the world is first created.', [['minecraft:normal', 'Normal'], ['minecraft:flat', 'Superflat'], ['minecraft:large_biomes', 'Large biomes'], ['minecraft:amplified', 'Amplified']]), B('generate-structures', 'Generate structures', 'Villages, temples, strongholds and so on.'), B('allow-nether', 'Nether', 'Allow players to travel to the Nether.'), B('spawn-monsters', 'Spawn monsters', 'Hostile mobs can appear.'), B('spawn-animals', 'Spawn animals', 'Animals can appear.'), B('spawn-npcs', 'Spawn villagers', 'Villagers can appear.'), N('spawn-protection', 'Spawn protection (blocks)', 'Only operators can build inside this radius around spawn. 0 turns it off.', 0, 1000), N('max-world-size', 'Max world size (blocks)', 'The world border radius limit.', 1, 29999984)]],
  ['Performance', [N('view-distance', 'View distance (chunks)', 'How far players can see. Lower this if the server lags.', 3, 32), N('simulation-distance', 'Simulation distance (chunks)', 'How far from players things like crops and mobs keep updating. Lower is faster.', 3, 32), N('network-compression-threshold', 'Network compression', 'Packets bigger than this many bytes get compressed. -1 turns compression off.', -1, 4096), N('entity-broadcast-range-percentage', 'Entity visibility range (%)', 'How far away mobs and players are shown to others. Lower is faster.', 10, 500)]],
  ['Network & privacy', [B('enable-status', 'Show in server list', 'Lets players see your server status (MOTD, player count) in their server list.'), B('hide-online-players', 'Hide player names', 'Do not show who is online in the server list.'), B('enable-query', 'Enable query', 'Lets other tools read information about your server.'), B('prevent-proxy-connections', 'Block VPN/proxy connections', 'Reject players that connect through a proxy or VPN.')]],
];
const HTYPE = { vanilla: 'Vanilla', paper: 'Paper', fabric: 'Fabric' };
function hostLine(d, val) {
  const ctl = d.t === 'bool' ? `<label class="sw"><input type="checkbox" data-hprop="${d.k}" ${val === 'true' ? 'checked' : ''}><i></i></label>` : d.t === 'sel' ? `<select data-hprop="${d.k}">${d.o.map(o => `<option value="${o[0]}" ${val === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>` : d.t === 'num' ? `<input type="number" data-hprop="${d.k}" value="${esc(val)}" min="${d.min}" max="${d.max}" style="width:130px">` : `<input data-hprop="${d.k}" value="${esc(val)}" style="width:260px">`;
  return `<div class="line" data-key="hl-${d.k}"><div class="l"><b>${esc(d.n)}</b><span>${esc(d.d)}</span></div>${ctl}</div>`;
}
function hostSettings(cur) {
  const props = { ...HDEF, ...(cur.props || {}) }, run = (cur.runtime || {}).state && cur.runtime.state !== 'stopped';
  const opts = `<div class="panel" data-key="hopts"><h2>Server options</h2>
  <div class="line" data-key="ho-name"><div class="l"><b>Server name</b><span>Only used inside OfflineCraft.</span></div><input data-hmeta="name" value="${esc(cur.name)}" style="width:260px"></div>
  <div class="line" data-key="ho-eula"><div class="l"><b>Accept the Minecraft EULA</b><span>You must agree to Mojang's EULA (aka.ms/MinecraftEULA) to run a server.</span></div><label class="sw"><input type="checkbox" data-hmeta="eula" ${cur.eula ? 'checked' : ''}><i></i></label></div>
  <div class="line" data-key="ho-ram"><div class="l"><b>Memory</b><span>How much RAM the server may use. 2 to 4 GB is plenty for friends.</span></div><div class="row"><input type="range" data-hmeta="ramMB" min="1024" max="16384" step="512" value="${cur.ramMB || 2048}"><b style="width:76px" data-hramv>${cur.ramMB || 2048} MB</b></div></div>
  <div class="line" data-key="ho-jvm"><div class="l"><b>Extra Java arguments</b><span>Advanced. Leave empty if you are not sure.</span></div><input data-hmeta="jvmArgs" value="${esc(cur.jvmArgs || '')}" style="width:260px"></div>${run ? '<div class="dim" style="margin-top:8px">Changes apply the next time the server starts.</div>' : ''}</div>`;
  return tipify(opts + HGROUPS.map(([g, defs]) => `<div class="panel" data-key="hg-${g}"><h2>${g}</h2>${defs.map(d => hostLine(d, props[d.k] ?? '')).join('')}</div>`).join(''));
}
function hostConsole() { return `<div class="console" id="hcon" data-morph="skip" style="height:calc(100vh - 430px);min-height:220px"></div><div class="row" style="margin-top:10px"><input id="hcmd" placeholder="Type a command, for example: say hello (no slash needed)" style="flex:1"><button class="btn primary" data-hact="hsend">Send</button></div><div class="row" style="margin-top:8px">${['list', 'save-all', 'time set day', 'weather clear', 'difficulty peaceful'].map(c => `<button class="chip qc" data-hact="hcmd" data-c="${c}">${c}</button>`).join('')}</div>`; }
function hostOverview(cur, rt, port) {
  const H = S.host, n = H.net[cur.id] || {}, up = rt.upnp, test = H.test[cur.id], pub = n.publicIp || '', lan = n.localIp || '…';
  const addr = (label, val) => `<div class="addr" data-key="ad:${esc(label)}"><div><div class="dim" style="font-size:12px">${label}</div><b class="mono">${esc(val)}</b></div><button class="btn sm" data-hact="hcopy" data-v="${esc(val)}">${ic('copy')}Copy</button></div>`;
  const net = `<div class="panel" data-key="hnet"><h2>Connect &amp; port forwarding</h2>${addr('On this PC', 'localhost' + (port === 25565 ? '' : ':' + port))}${addr('Same Wi-Fi or home network', lan + ':' + port)}${pub ? addr('Friends on the internet', pub + ':' + port) : '<div class="dim" data-key="nopub">Finding your public IP…</div>'}
  <div class="line" data-key="hl-upnp"><div class="l"><b>Open the port automatically (UPnP)</b><span>Asks your router to forward the port when the server starts and closes it when it stops. Works on most home routers.</span></div><label class="sw"><input type="checkbox" data-hmeta="upnp" ${cur.upnp !== false ? 'checked' : ''}><i></i></label></div>
  <div class="row" style="margin-top:6px">${up && up.ok ? `<span class="chipok" data-key="st-open">${ic('check')}Port ${port} is open on your router</span>` : up ? `<span class="chipwarn" data-key="st-err">${esc(up.err || 'The router did not open the port')}</span>` : '<span class="chip" data-key="st-none">Port not opened yet</span>'}${up && up.cgnat ? '<span class="chipwarn" data-key="st-cgnat">Your provider shares one public address (CGNAT), so friends outside your network cannot connect directly. Ask for a public IP or use a tunnel service.</span>' : ''}${test ? (test.err ? `<span class="chipwarn" data-key="st-test">${esc(test.err)}</span>` : test.online ? `<span class="chipok" data-key="st-test">${ic('check')}Reachable from the internet</span>` : '<span class="chipwarn" data-key="st-test">Not reachable from the internet yet</span>') : ''}</div>
  <div class="row" style="margin-top:12px"><button class="btn" data-hact="hmap" data-v="1">Open port now</button><button class="btn" data-hact="hmap" data-v="0">Close port</button><button class="btn" data-hact="htest" ${rt.state === 'running' ? '' : 'disabled'}>${ic('globe')}Test from the internet</button><button class="btn" data-hact="hfw">Allow in Windows Firewall</button></div>
  <details class="howto" data-key="howto" ${H.howto ? 'open' : ''}><summary>No UPnP? Forward the port by hand</summary><ol><li>Open your router page (often <b>192.168.0.1</b> or <b>192.168.1.1</b>).</li><li>Add a port forward: TCP, port <b>${port}</b>, to <b>${esc(lan)}</b> port <b>${port}</b>.</li><li>Press "Allow in Windows Firewall" above.</li><li>Share <b>${esc(pub || 'your public IP')}:${port}</b> with friends. The server has to be running for the test.</li></ol></details></div>`;
  const pl = `<div class="panel" data-key="hplayers"><h2>Players online <span class="chip">${(rt.players || []).length}</span></h2>${(rt.players || []).map(p => `<div class="item" data-key="pl:${esc(p)}"><div class="pic" style="width:34px;height:34px;font-size:15px;background:var(--grad)">${letter(p)}</div><div class="grow n">${esc(p)}</div><button class="btn sm" data-hact="hcmd" data-c="op ${esc(p)}">Op</button><button class="btn sm" data-hact="hcmd" data-c="kick ${esc(p)}">Kick</button><button class="btn sm" data-hact="hcmd" data-c="ban ${esc(p)}">Ban</button></div>`).join('') || `<div class="dim">${rt.state === 'running' ? 'Nobody is online right now.' : 'Start the server to see players.'}</div>`}</div>`;
  return net + pl;
}
function pgHost() {
  const H = S.host, cur = H.list.find(x => x.id === H.sel) || H.list[0];
  const head = `<div class="page-head"><h1>Server</h1><span class="dim">host your own Minecraft server</span><div class="grow"></div><button class="btn primary" data-key="hnewtop" data-hact="hnew">${ic('plus')}New server</button></div>`;
  if (!cur) return head + `<div class="empty" data-key="hempty"><div><h3>No server yet</h3><div>Create a Minecraft server on this PC in a minute. Pick the software and version and OfflineCraft does the rest, including opening the port on your router.</div><div class="row" style="justify-content:center"><button class="btn primary" data-hact="hnew">${ic('plus')}Create a server</button></div></div></div>`;
  const rt = cur.runtime || {}, st = rt.state || 'stopped', port = parseInt((cur.props || {})['server-port']) || 25565;
  const chips = `<div class="cchips" style="margin:0 0 14px" data-key="hchips">${H.list.map(s => `<button class="cchip ${s.id === cur.id ? 'on' : ''}" data-key="hs:${esc(s.id)}" data-hact="hsel" data-id="${esc(s.id)}"><span class="dot ${(s.runtime || {}).state || 'stopped'}"></span>${esc(s.name)}</button>`).join('')}</div>`;
  const ctl = st === 'stopped' ? `<button class="btn primary" data-key="hb:start" data-hact="hstart">${ic('play')}Start</button>` : st === 'running' ? `<button class="btn danger" data-key="hb:stop" data-hact="hstop">${ic('stop')}Stop</button><button class="btn" data-key="hb:restart" data-hact="hrestart">${ic('refresh')}Restart</button>` : `<button class="btn" data-key="hb:busy" disabled>${st === 'starting' ? 'Starting…' : 'Stopping…'}</button>`;
  const hero = `<div class="panel host-hero" data-key="hhero"><div class="grow"><div class="row"><h2 style="margin:0">${esc(cur.name)}</h2><span class="spill ${st}"><span class="dot ${st}"></span>${{ stopped: 'Stopped', starting: 'Starting…', running: 'Online', stopping: 'Stopping…' }[st]}</span></div><div class="dim">${HTYPE[cur.type] || cur.type} ${esc(cur.mc)} · ${(cur.ramMB || 2048) / 1024} GB RAM · port ${port}${rt.err ? ` · <span style="color:#fb7185">${esc(rt.err)}</span>` : ''}</div></div><div class="row">${ctl}<button class="btn icon" data-hact="hopen" data-tip="Open server folder">${ic('folder')}</button><button class="btn icon" data-hact="hdel" data-tip="Delete server">${ic('trash')}</button></div></div>`;
  const tabs = `<div class="tabs" data-key="htabs">${[['over', 'Overview'], ['con', 'Console'], ['set', 'Settings']].map(([k, l]) => `<button class="${H.tab === k ? 'on' : ''}" data-hact="htab" data-v="${k}">${l}</button>`).join('')}</div>`;
  return head + chips + hero + tabs + `<div id="hbody" data-key="hbody">${H.tab === 'over' ? hostOverview(cur, rt, port) : H.tab === 'con' ? hostConsole() : hostSettings(cur)}</div>`;
}
let hostRaf = 0;
function schedHostRender() { if (hostRaf) return; hostRaf = requestAnimationFrame(() => { hostRaf = 0; if (S.page === 'host') { const a = document.activeElement; if (a && a.id === 'hcmd') { return; } render(); } }); }
async function hostEnter() { S.host.list = (await call('hostList')) || []; if (!S.host.list.find(x => x.id === S.host.sel)) S.host.sel = S.host.list[0] && S.host.list[0].id; if (S.host.sel && !S.host.logs[S.host.sel]) S.host.logs[S.host.sel] = (await call('hostLog', S.host.sel)) || []; schedHostRender(); schedSrvRender(); }
function afterHost() {
  const H = S.host, id = H.sel; if (!id) return;
  if (H.tab === 'con') { const c = $('#hcon'); if (c && c._f !== id) { c._f = id; c.innerHTML = (H.logs[id] || []).map(conLine).join(''); c.scrollTop = c.scrollHeight; } }
  if (H.tab === 'over' && Date.now() - H.netT > 6000) { H.netT = Date.now(); call('hostNet', id).then(n => { H.net[id] = n; schedHostRender(); }); }
}
function pushHostCon(lines) { const c = $('#hcon'); if (!c || !lines.length) return; const stick = c.scrollTop + c.clientHeight >= c.scrollHeight - 30; c.insertAdjacentHTML('beforeend', lines.map(conLine).join('')); while (c.childElementCount > 2500) c.firstElementChild.remove(); if (stick) c.scrollTop = c.scrollHeight; }
async function loadHostVersions(type) {
  const sel = $('#hver'); if (!sel) return; sel.innerHTML = '<option value="">Loading…</option>'; sel._sync && sel._sync(); let v = [];
  try { v = await call('hostVersions', type); } catch { toast('Could not load versions (are you online?)', true); }
  if ($('#hver') !== sel) return; sel.innerHTML = v.slice(0, 150).map(x => `<option>${esc(x)}</option>`).join('') || '<option value="">None found</option>'; sel._sync && sel._sync();
}
function hostNewModal() {
  S.host.cr = { type: 'vanilla' };
  modal(`<h2>New server</h2><label>Name</label><input id="hname" placeholder="My server"><label>Server software</label><div class="seg">${[['vanilla', 'Vanilla'], ['paper', 'Paper'], ['fabric', 'Fabric']].map(([k, l]) => `<button class="${k === 'vanilla' ? 'on' : ''}" data-hact="htype" data-v="${k}">${l}</button>`).join('')}</div><div class="dim" style="margin-top:6px;font-size:12.5px">Vanilla is the official server. Paper is faster and supports plugins. Fabric supports Fabric mods.</div><label>Minecraft version</label><select id="hver"><option value="">Loading…</option></select><label>Memory</label><div class="row"><input type="range" id="hram" min="1024" max="16384" step="512" value="2048"><b id="hramv" style="width:76px">2048 MB</b></div><label class="row" style="margin-top:14px;gap:10px;color:var(--text);cursor:pointer"><input type="checkbox" id="heula"> I accept the Minecraft EULA (aka.ms/MinecraftEULA)</label><div class="foot"><button class="btn" data-act="closemodal">Cancel</button><button class="btn primary" data-hact="hcreate">${ic('plus')}Create server</button></div>`);
  loadHostVersions('vanilla');
}
const hostUpd = m => { if (!m) return; const i = S.host.list.findIndex(x => x.id === m.id); if (i >= 0) S.host.list[i] = { ...S.host.list[i], ...m, runtime: S.host.list[i].runtime }; };
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-hact]'); if (!t) return; e.stopPropagation(); const a = t.dataset.hact, H = S.host, id = H.sel;
  switch (a) {
    case 'libtab': S.libTab = t.dataset.v; render(true); if (S.libTab === 'servers') call('hostList').then(l => { H.list = l || []; schedSrvRender(); }); break;
    case 'sview': S.srv.view = t.dataset.v; render(true); break;
    case 'sdsearch': S.srv.disc.q = ($('#sdq') || {}).value || ''; discLoad(true); break;
    case 'sdmore': discLoad(false); break;
    case 'sdretry': discLoad(true); break;
    case 'sdempty': S.srv.disc.hideEmpty = !S.srv.disc.hideEmpty; render(); break;
    case 'sdadd': { const host = t.dataset.host, port = +t.dataset.port || 0; if ((S.settings.servers || []).some(x => srvKey(x.host, x.port) === srvKey(host, port))) { toast('Already in your list'); break; } await call('saveSettings', { servers: [...(S.settings.servers || []), { id: 'sv' + Date.now(), name: t.dataset.name, host, port }] }); toast(t.dataset.name + ' added to My servers'); break; }
    case 'srefresh': if (S.srv.view === 'disc') discLoad(true); else srvRefresh(true); break;
    case 'sfilter': S.srv.filter = t.dataset.v; render(); break;
    case 'sadd': { const p = parseAddr($('#srvadd').value); if (!p) { toast('Type a server address like play.example.com', true); break; } await call('saveSettings', { servers: [...(S.settings.servers || []), { id: 'sv' + Date.now(), name: p.host, host: p.host, port: p.port }] }); $('#srvadd').value = ''; break; }
    case 'scur': await call('saveSettings', { servers: [...(S.settings.servers || []), { id: 'sv' + Date.now(), name: t.dataset.name, host: t.dataset.host, port: 0 }] }); toast(t.dataset.name + ' added to your list'); break;
    case 'srem': await call('saveSettings', { servers: (S.settings.servers || []).filter(s => s.id !== t.dataset.id) }); break;
    case 'sjoin': joinModal(t.dataset.host, +t.dataset.port || 0); break;
    case 'joinmake': { closeModal(); try { const i = await call('createInstance', { name: 'Server ' + t.dataset.mc, mc: t.dataset.mc, loader: 'vanilla' }); if (i) toast(`Creating ${t.dataset.mc}. When it has finished installing, press Join again.`); } catch (e) { toast(String(e && e.message || e).replace(/^.*Error: /, ''), true); } break; }
    case 'dojoin': { const inst = $('#joininst').value; closeModal(); toast('Starting the game and joining…'); call('launch', inst, { join: t.dataset.addr }); break; }
    case 'hnew': hostNewModal(); break;
    case 'htype': { H.cr.type = t.dataset.v; t.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === t)); loadHostVersions(H.cr.type); break; }
    case 'hcreate': { const mc = $('#hver').value, name = $('#hname').value.trim(); if (!$('#heula').checked) { toast('Please accept the Minecraft EULA first', true); break; } if (!mc) { toast('Pick a Minecraft version', true); break; } closeModal(); const m = await call('hostCreate', { name: name || 'My server', type: H.cr.type, mc, ramMB: +$('#hram').value }); H.sel = m.id; H.tab = 'over'; await hostEnter(); toast('Downloading the server software…'); break; }
    case 'hsel': H.sel = t.dataset.id; H.netT = 0; if (!H.logs[H.sel]) H.logs[H.sel] = (await call('hostLog', H.sel)) || []; render(); break;
    case 'htab': H.tab = t.dataset.v; render(); pgAnim($('#hbody')); break;
    case 'hstart': { const r = await call('hostStart', id); if (r) toast(r, true); break; }
    case 'hstop': call('hostStop', id); break;
    case 'hrestart': { call('hostStop', id); const ok = setInterval(() => { const x = H.list.find(s => s.id === id); if (x && x.runtime.state === 'stopped') { clearInterval(ok); call('hostStart', id); } }, 600); setTimeout(() => clearInterval(ok), 45000); break; }
    case 'hopen': call('hostOpenFolder', id); break;
    case 'hdel': if (confirm('Delete this server and its world? This cannot be undone.')) { await call('hostDelete', id); H.sel = null; await hostEnter(); } break;
    case 'hcopy': try { await navigator.clipboard.writeText(t.dataset.v); toast('Copied ' + t.dataset.v); } catch { toast('Could not copy', true); } break;
    case 'hmap': { const r = await call('hostPortMap', id, t.dataset.v === '1'); toast(t.dataset.v === '1' ? (r && r.ok ? 'Port opened on your router' : (r && r.err) || 'Could not open the port') : 'Port closed', t.dataset.v === '1' && !(r && r.ok)); H.netT = 0; break; }
    case 'htest': { t.disabled = true; H.test[id] = await call('hostTest', id); schedHostRender(); break; }
    case 'hfw': call('hostFirewall', id); toast('Approve the Windows prompt to allow the port'); break;
    case 'hcmd': call('hostCommand', id, t.dataset.c); break;
    case 'hsend': { const i = $('#hcmd'); if (i && i.value.trim()) { call('hostCommand', id, i.value.trim().replace(/^\//, '')); i.value = ''; } break; }
  }
}, true);
document.addEventListener('input', e => { if (e.target.id === 'sdq') S.srv.disc.q = e.target.value; });
document.addEventListener('change', async e => {
  const t = e.target, H = S.host; if (!t.dataset) return;
  if (t.dataset.sd) { S.srv.disc[t.dataset.sd] = t.value; discLoad(true); return; }
  if (t.dataset.hprop) hostUpd(await call('hostSave', H.sel, { props: { [t.dataset.hprop]: t.type === 'checkbox' ? String(t.checked) : t.value } }));
  else if (t.dataset.hmeta) { const v = t.type === 'checkbox' ? t.checked : (t.type === 'range' || t.type === 'number') ? +t.value : t.value; hostUpd(await call('hostSave', H.sel, { [t.dataset.hmeta]: v })); if (t.dataset.hmeta === 'name') schedHostRender(); }
}, true);
document.addEventListener('input', e => {
  const t = e.target; if (t.dataset && t.dataset.hmeta === 'ramMB') { const b = t.parentElement.querySelector('[data-hramv]'); if (b) b.textContent = t.value + ' MB'; } else if (t.id === 'hram') $('#hramv').textContent = t.value + ' MB';
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'hcmd') { e.preventDefault(); const i = e.target; if (i.value.trim()) { call('hostCommand', S.host.sel, i.value.trim().replace(/^\//, '')); i.value = ''; } } else if (e.key === 'Enter' && e.target.id === 'sdq') document.querySelector('[data-hact=sdsearch]').click(); else if (e.key === 'Enter' && e.target.id === 'srvadd') document.querySelector('[data-hact=sadd]').click(); }, true);
document.addEventListener('toggle', e => { if (e.target.classList && e.target.classList.contains('howto')) S.host.howto = e.target.open; }, true);
window.oc.on('hoststate', r => { const x = S.host.list.find(h => h.id === r.id); if (x) x.runtime = r; S.host.netT = 0; if (S.page === 'host') schedHostRender(); schedSrvRender(); });
window.oc.on('hostlog', ({ id, lines }) => { const L = (S.host.logs[id] = S.host.logs[id] || []); L.push(...lines); if (L.length > 2500) L.splice(0, L.length - 2500); if (S.page === 'host' && S.host.sel === id && S.host.tab === 'con') pushHostCon(lines); });
window.oc.on('hostlist', () => hostEnter());
