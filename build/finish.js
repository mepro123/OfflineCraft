// Post-build step: lays out dist/OfflineCraft-win32-x64 as "native splash launcher + app", like the Electron version did.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), dir = path.join(root, 'dist', 'OfflineCraft-win32-x64');
const built = path.join(root, 'src-tauri', 'target', 'release', 'offlinecraft.exe');
if (!fs.existsSync(built)) { console.error('Run "tauri build --no-bundle" first (expected ' + built + ').'); process.exit(1); }
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
fs.copyFileSync(built, path.join(dir, 'OfflineCraft-app.exe'));
fs.copyFileSync(path.join(root, 'launcher', 'OfflineCraft-launcher.exe'), path.join(dir, 'OfflineCraft.exe'));
fs.copyFileSync(path.join(__dirname, 'icon.ico'), path.join(dir, 'icon.ico'));
const crlf = s => s.replace(/\r?\n/g, '\r\n');
fs.writeFileSync(path.join(dir, 'Start OfflineCraft.bat'), crlf(`@echo off
setlocal
cd /d "%~dp0"
if /i "%~1"=="run" goto :main
start "" /min cmd /c ""%~f0" run"
exit /b
:main
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%~dp0' -Recurse -Force | Unblock-File" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=New-Object -ComObject WScript.Shell; foreach($d in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'))){ $l=$s.CreateShortcut((Join-Path $d 'OfflineCraft.lnk')); $l.TargetPath='%~dp0OfflineCraft.exe'; $l.WorkingDirectory='%~dp0'; $l.IconLocation='%~dp0icon.ico'; $l.Save() }" >nul 2>&1
start "" "%~dp0OfflineCraft.exe"
exit /b
`));
fs.writeFileSync(path.join(dir, 'README.txt'), crlf(`OFFLINECRAFT (Tauri build)

1. Extract the whole zip (right-click > Extract All).
2. Double-click "Start OfflineCraft.bat" once (unblocks files, makes a desktop shortcut, starts the launcher).
3. Afterwards use the desktop shortcut.

Needs the Microsoft WebView2 runtime (already part of Windows 10/11).
Data lives in the "data" folder. Logs: data\\launcher.log
`));
console.log('Launcher + app installed into', dir);
