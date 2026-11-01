# Build OfflineCraft (Windows)

1. Install Node.js LTS from https://nodejs.org
2. Open a terminal in this folder and run:

       npm install
       npm start          (test it)
       npm run build      (make the exe)

3. Your app is in `dist\OfflineCraft-win32-x64\OfflineCraft.exe`.
   Zip that whole folder to share it.


## Instant splash screen
`npm run build` also installs a tiny native launcher (`launcher/`). The file you double-click is the launcher (`OfflineCraft.exe`): it shows an animated splash immediately and starts the real app (`OfflineCraft-app.exe`). To change the splash, edit `launcher/splash.cpp` and rebuild it with MinGW:

    x86_64-w64-mingw32-windres icon.rc -O coff -o icon.o
    x86_64-w64-mingw32-g++ -O2 -std=c++17 -DUNICODE -D_UNICODE -mwindows -municode -static splash.cpp icon.o -o OfflineCraft-launcher.exe -lgdiplus -lshlwapi -lole32 -luuid -lgdi32 -luser32 -ladvapi32 -s
