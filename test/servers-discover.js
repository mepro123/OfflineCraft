// Run with plain node: node test/servers-discover.js   (mock of the BattleMetrics list API)
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const block = src.slice(src.indexOf('// ================= public server discovery'), src.indexOf("app.on('before-quit', () => { for (const [, r] of hosted)"));
const seen = []; let rejectSort = false, status = 200, base;
const srv = http.createServer((req, rsp) => {
  const u = new URL(req.url, 'http://x'); seen.push(u.pathname + u.search); const send = (c, o) => { rsp.writeHead(c, { 'content-type': 'application/json' }); rsp.end(JSON.stringify(o)); };
  if (status !== 200) return send(status, {});
  if (rejectSort && u.searchParams.get('sort')) return send(400, { errors: [{ detail: 'bad sort' }] });
  const item = (id, a) => ({ id: String(id), type: 'server', attributes: a });
  send(200, { data: [
    item(1, { name: 'Big Network', address: 'play.big.net', ip: '1.2.3.4', port: 25565, players: 900, maxPlayers: 1000, country: 'us', rank: 3, details: { version: '1.21.4' } }),
    item(2, { name: 'Odd Port', ip: '5.6.7.8', port: 25570, players: 2, maxPlayers: 20, country: 'DE', rank: 99, details: {} }),
    item(3, { name: 'No host', players: 1 }),
    item(4, { name: 'Local', ip: '192.168.1.5', port: 25565 }),
    item(5, { name: 'Evil\'; rm', address: "x.com'; rm -rf /", port: 25565 }),
  ], links: { next: `${base}/servers?page%5Bkey%5D=abc&page%5Bsize%5D=30` } });
});
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${srv.address().port}`;
  const api = {}; new Function('api', 'UA', 'fetch', 'AbortSignal', block.replace("'https://api.battlemetrics.com'", `'${base}'`))(api, 'UA', fetch, AbortSignal);
  let r = await api.srvDiscover({ search: ' skyblock ', sort: 'players', country: 'us' });
  const q = new URL(base + seen[0]).searchParams;
  assert.equal(q.get('filter[game]'), 'minecraft'); assert.equal(q.get('filter[status]'), 'online'); assert.equal(q.get('page[size]'), '30'); assert.equal(q.get('filter[search]'), 'skyblock'); assert.equal(q.get('filter[countries]'), 'US'); assert.equal(q.get('sort'), '-players');
  assert.deepEqual(r.servers.map(x => x.id), ['bm1', 'bm2']);
  assert.deepEqual(r.servers[0], { id: 'bm1', name: 'Big Network', host: 'play.big.net', port: 0, players: 900, max: 1000, country: 'US', rank: 3, version: '1.21.4' });
  assert.deepEqual(r.servers[1], { id: 'bm2', name: 'Odd Port', host: '5.6.7.8', port: 25570, players: 2, max: 20, country: 'DE', rank: 99, version: '' });
  assert(r.next.startsWith(base + '/servers?page'));
  // next page, rank sort, bad country ignored
  seen.length = 0; await api.srvDiscover({ next: r.next }); assert(seen[0].includes('page%5Bkey%5D=abc'));
  seen.length = 0; await api.srvDiscover({ sort: 'rank', country: 'xx1' }); const q2 = new URL(base + seen[0]).searchParams; assert.equal(q2.get('sort'), 'rank'); assert.equal(q2.get('filter[countries]'), null);
  // foreign "next" links are refused
  await assert.rejects(api.srvDiscover({ next: 'https://evil.example/servers' }), /Unexpected server list address/);
  // if the API refuses the sort option, retry without it
  rejectSort = true; seen.length = 0; r = await api.srvDiscover({ sort: 'players' }); assert.equal(seen.length, 2); assert(!seen[1].includes('sort=')); assert.equal(r.servers.length, 2); rejectSort = false;
  // errors are readable
  status = 429; await assert.rejects(api.srvDiscover({}), /busy right now/); status = 500; await assert.rejects(api.srvDiscover({}), /error \(500\)/);
  console.log('SERVER DISCOVERY TESTS PASSED'); srv.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
