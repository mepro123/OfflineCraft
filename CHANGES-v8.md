# OfflineCraft v8 changes

- **Rust loader (Horizon)**: Create instance -> Rust. Minecraft 26.3 only. Signed release download, one-time prepare, runs horizon-client.exe.
- **Accounts page**: add/remove/switch accounts, instance picker + Play per account.
- **Server discovery**: Library -> Servers -> "Discover public servers" (BattleMetrics public list), search/sort/country/filters, Join/Add.
- **Window**: Settings -> Appearance -> Window style (Rounded/Classic) and Window corners slider. Rounded draws the outline outside the content
  and has resize grips in the transparent margin. Falls back to Classic when hardware acceleration is off. `--classic-window` forces Classic.
- **Skins**: applied Microsoft skins stay on screen ("In use"), Delete button for library skins.
- **Crash helper**: plain-language diagnosis + fix buttons after a crash.
- **Backups**: automatic world backups before playing, Backups tab (restore/delete), Settings -> Backups.
- **Safe mode**: launch once without mods (Safe mode button).
- **Update everything / Switch version / Undo**: Instance -> Settings -> Version & updates.
- **Export .mrpack**: Instance -> Settings -> Export modpack.
- **Worlds + Screenshots tabs**: world icon/size/last played, backup per world, screenshot gallery.
- **Horizon updates**: shown and updated from the same panel.
- **Ctrl+K** command palette. **Loading bar + spinners** while anything loads.

Tests: `node test/features.js`, `node test/servers-discover.js`, `NODE_PATH=... node test/rust.js` (plain Node).

## Launcher essentials (added later in v8)
- **Library**: group chips, loader filter, sort (recent / name / most played / newest version). Group + Notes in Instance -> Settings.
- **Launch options** (Instance -> Settings -> "Organize and launch options"): wrapper command (gamemoderun, prime-run...), extra game arguments,
  environment variables, pre-launch command (aborts the launch if it fails), post-exit command. `INST_NAME`, `INST_DIR`, `INST_MC_DIR`,
  `INST_MC_VER`, `INST_LOADER` and `INST_EXIT_CODE` are available to the commands. These are never imported from modpacks or other launchers.
- **Desktop shortcut + command line**: `OfflineCraft.exe --launch "<instance name or id>" [--join host:port]`. A second launch hands over to the running one.
- **Console**: filter box, "warnings and errors only", Share log (uploads to mclo.gs after confirmation).
- **Import from MultiMC / Prism** (.zip instance export): Minecraft version, loader, memory and all game files.
- **World tools**: import world from .zip or folder, export to .zip, copy a world, back up one world.
- **Copy settings** between instances (options.txt, optionsof.txt, servers.dat).
- **Capes** for Microsoft accounts (Skins page): equip / hide.
- **Storage** (Settings): sizes of every shared folder, clear cache / restore points, keep newest backups only, remove unused versions / old Horizon builds.

Tests: `node test/features2.js` (plain Node).

## Liquid glass + separate bar
- **Liquid glass** (Settings -> Appearance): the sidebar turns into a floating glass panel (blur, saturation, SVG refraction, specular edges).
  The selected option is a glass lens that slides with a springy wobble. **Glass refraction** slider (0 = plain frosted glass).
  Falls back to plain glass without backdrop effects when hardware acceleration is off.
- **Separate bar** (Settings -> Appearance): navigation + account move into their own floating capsule in the title row, between the
  logo and the window buttons. Picking a Sidebar position turns it off. Works with Liquid glass. Both are saved in .theme files.

Tests: `OC_DATA=/tmp/ocg node_modules/electron/dist/electron test/glass.js --no-sandbox` (set `OC_BG=<image>` to test over a background).

### Normal lens animation + bottom sidebar
- Liquid glass lens now slides with the app's normal indicator transition (wobble removed).
- New **Bottom** option in Settings → Appearance → Sidebar position: horizontal nav bar under the content; works with icons-only and Liquid glass (floating capsule).

### Separate bar on every side
- Separate bar now works with every Sidebar position (no longer forces Top / turns off when picking a position): Left/Right become a detached floating panel, Bottom a floating capsule with your account, Top stays in the title row.

- Tighter gap around the separate bar (5px from edges; title-row bar 52px tall).

### Style panel (Settings → Style)
- **Accent from background**: picks the accent gradient from your background image/video (falls back to your own colours for grey images or no background). "Pick again" button.
- **Liquid glass everywhere**: cards, panels, Continue-playing, mods/results lists, dialogs, menus, dropdowns and drawers become frosted glass. Skipped automatically in software-rendering mode.
- **Auto-hide bar**: the Separate bar slides away and returns when the mouse reaches its edge (all four positions).
- **UI scale** 80–125% (window corners/margins stay the same size) and **Density** (Comfortable / Compact).
- **Font**: Segoe UI / Inter / System, plus **Minecraft headings** (Monocraft). Fonts are bundled (OFL licences in renderer/fonts).
- **Instance cards**: Grid / List / Compact. Custom banners still come from each instance's Edit → card background.
- **Glow intensity** 0–200%.
- **Ambient effects**: Snow / Fireflies / Nether ash on one canvas, 30fps cap, paused when unfocused, hidden or while a game runs.
- **Sidebar items**: reorder and hide (Library and Settings always shown; hidden pages stay in Ctrl+K).
- All options save in .theme files. Theme presets intentionally not added.

### Performance
- Theme variables are only written when they change (state updates no longer restyle the whole page).
- UI observer ignores console, jobs and tooltip churn.
- Off-screen Discover results and mod lists skip layout/paint (content-visibility).
- Remote list icons load lazily and decode off the main thread.
- Page headers wrap instead of overflowing at high UI scale.
