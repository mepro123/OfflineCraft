'use strict';
// ===== Accounts page (loaded after app.js): manage every account, pick an instance, play as that account =====
Object.assign(IC, {
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.3c2 .7 3.5 2.5 3.5 5.7"/>',
});
function acctList() {
  const s = S.settings;
  return [
    ...(s.msAccounts || []).map(m => ({ key: 'ms:' + m.id, type: 'ms', id: m.id, name: m.name, on: s.activeMs === m.id })),
    ...(s.accounts || []).map(n => ({ key: 'off:' + n, type: 'off', name: n, on: !s.activeMs && n === s.username })),
  ];
}
function acctDefaultInst(key) {
  const saved = (S.settings.acctInst || {})[key]; if (saved && inst(saved)) return saved;
  const last = [...S.instances].sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0))[0]; return last ? last.id : '';
}
function acctRow(a) {
  const sel = acctDefaultInst(a.key), none = !S.instances.length;
  const opts = none ? '<option value="">No instances yet</option>' : S.instances.map(i => `<option value="${esc(i.id)}" ${i.id === sel ? 'selected' : ''}>${esc(i.name)} · ${esc(i.mc)} ${esc(LN(i.loader))}</option>`).join('');
  const sub = a.type === 'ms' ? 'Microsoft account · real name and skin, can join online servers' : 'Offline account · no login, only for singleplayer and servers that allow offline players';
  return `<div class="item acct-row ${a.on ? 'on' : ''}" data-key="ac:${esc(a.key)}">
    <div class="acct-av">${avatarHtml(a.name, a.type === 'ms' ? a.id : '')}</div>
    <div class="grow" style="min-width:0"><div class="n">${esc(a.name)} <span class="chip">${a.type === 'ms' ? 'Microsoft' : 'Offline'}</span>${a.on ? ' <span class="chip acc">Active</span>' : ''}</div><div class="dim" style="font-size:12.5px">${sub}</div></div>
    <select class="acct-inst" data-ai="${esc(a.key)}" ${none ? 'disabled' : ''} data-tip="Instance to play">${opts}</select>
    <button class="btn primary" data-aact="aplay" data-k="${esc(a.key)}" ${none ? 'disabled' : ''}>${ic('play')}Play</button>
    ${a.on ? '' : `<button class="btn" data-aact="ause" data-k="${esc(a.key)}">Make active</button>`}
    <button class="btn icon" data-aact="arm" data-k="${esc(a.key)}" data-tip="Remove account">${ic('trash')}</button></div>`;
}
function pgAccounts() {
  const list = acctList();
  const head = `<div class="page-head"><h1>Accounts</h1><span class="dim">add as many as you like, play as any of them</span><div class="grow"></div><button class="btn primary" data-act="addacct" data-key="acct-add">${ic('plus')}Add account</button></div>`;
  if (!list.length) return head + `<div class="empty"><div><h3>No accounts yet</h3><div>Sign in with Microsoft for online servers, or add an offline name to play without a login.</div><div class="row" style="justify-content:center"><button class="btn primary" data-act="addacct">${ic('plus')}Add account</button></div></div></div>`;
  const ms = list.filter(a => a.type === 'ms'), off = list.filter(a => a.type === 'off');
  const group = (title, arr) => arr.length ? `<div style="margin:20px 0 8px;font-size:11.5px;letter-spacing:.08em;font-weight:700;color:var(--dim2)" data-key="cap:${title}">${title}</div>${arr.map(acctRow).join('')}` : '';
  return head + `<div class="dim" style="margin:-4px 0 4px;font-size:13px">The active account is the one shown at the top right and used by every Play button. Pressing Play here switches to that account first.</div>` + group('MICROSOFT ACCOUNTS', ms) + group('OFFLINE ACCOUNTS', off);
}
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-aact]'); if (!t) return; e.stopPropagation();
  const a = acctList().find(x => x.key === t.dataset.k); if (!a) return;
  const use = async () => { if (a.type === 'ms') await call('switchMs', a.id); else await call('saveSettings', { username: a.name, activeMs: '' }); };
  switch (t.dataset.aact) {
    case 'ause': await use(); toast('Now playing as ' + a.name); break;
    case 'aplay': {
      const row = t.closest('.acct-row'), id = (row && row.querySelector('.acct-inst') || {}).value || acctDefaultInst(a.key);
      if (!id || !inst(id)) { toast('Create an instance first', true); break; }
      await use(); if ((S.settings.acctInst || {})[a.key] !== id) call('saveSettings', { acctInst: { ...(S.settings.acctInst || {}), [a.key]: id } });
      toast(`Starting ${inst(id).name} as ${a.name}…`); call('launch', id); break;
    }
    case 'arm':
      if (!confirm(`Remove ${a.name}? ${a.type === 'ms' ? 'You will have to sign in with Microsoft again to use it.' : 'The name is only removed from this list; your worlds stay.'}`)) break;
      if (a.type === 'ms') await call('removeMsAccount', a.id); else { const s = S.settings, rest = s.accounts.filter(x => x !== a.name); await call('saveSettings', { accounts: rest, username: a.on ? (rest[0] || '') : s.username }); }
      break;
  }
}, true);
document.addEventListener('change', e => {
  const t = e.target; if (!t.dataset || !t.dataset.ai) return;
  call('saveSettings', { acctInst: { ...(S.settings.acctInst || {}), [t.dataset.ai]: t.value } });
});
