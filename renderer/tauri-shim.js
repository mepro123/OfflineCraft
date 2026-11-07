// Replaces Electron's preload.js: exposes the same window.oc API on top of Tauri.
(function () {
  const T = window.__TAURI__;
  const invoke = T.core.invoke, listen = T.event.listen, cur = () => T.window.getCurrentWindow();
  window.oc = {
    call: (name, ...args) => invoke('oc', { name, args }).catch(e => { throw e instanceof Error ? e : new Error(String(e)); }),
    on: (ch, cb) => { listen(ch, e => cb(e.payload)); },
  };
  // Tauri has no CSS drag regions: drag the window by the title bar (not by buttons, the account menu or the navigation).
  const NO_DRAG = '.nodrag,button,input,select,textarea,a,#side,#acct,.winbtns';
  document.addEventListener('mousedown', e => {
    if (e.button !== 0 || e.detail > 1) return; const t = e.target;
    if (!t.closest || !t.closest('#titlebar') || t.closest(NO_DRAG)) return;
    cur().startDragging().catch(() => {});
  });
  // Classic (non-rounded) window: double-click the title bar to maximize. The rounded window handles this itself.
  document.addEventListener('dblclick', e => {
    const t = e.target; if (!t.closest || !t.closest('#titlebar') || t.closest(NO_DRAG)) return;
    if (typeof S !== 'undefined' && S.settings && !S.settings.winRounded) window.oc.call('winMax');
  });
})();
