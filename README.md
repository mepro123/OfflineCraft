# Build OfflineCraft (Tauri, Windows)

1. Install Rust (https://rustup.rs), Node.js LTS, and the "Desktop development with C++" Build Tools (needed by Rust on Windows).
2. In this folder:

       npm install
       npm start          (dev run)
       npm run build      (release build -> dist\OfflineCraft-win32-x64)
       npm test           (Rust unit tests)

The UI is the unchanged `renderer/` folder; `renderer/tauri-shim.js` provides `window.oc` on top of Tauri.
The backend is `src-tauri/src/*.rs` (port of main.js, features.js, features2.js).
The splash launcher (`launcher/`) is unchanged: `OfflineCraft.exe` = splash, `OfflineCraft-app.exe` = the Tauri app.

## Notes
- Existing Microsoft logins from the Electron build must be redone once (Electron's encrypted tokens are unreadable here). Tokens are now protected with Windows DPAPI.
- Debug aid: set `OC_SELFTEST=<file.json>` (a list of `{"n":"apiName","a":[args]}`) to run backend calls after the UI loads; results go to `data/launcher.log`.
- Graphics fallback levels map to WebView2 flags via `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`.
