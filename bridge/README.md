# 3D Model Manager Workstation Bridge

The bridge runs only on `127.0.0.1:3211`. It lets the browser application detect desktop slicers and explicitly approve local model folders. It never exposes the rest of the workstation.

Supported local files are STL, 3MF, OpenSCAD (`.scad`), STEP (`.step`, `.stp`, `.ste`), and Autodesk Fusion archives (`.f3d`, `.f3z`). When the user chooses **Sync**, the browser copies those files into `Workstations/<computer>/<folder>` in the Docker application's configured library. Existing synchronized files are updated; files are not deleted from the workstation.

## Run from source

1. Install Node.js 22 or newer.
2. Run `npm install` in this folder.
3. Run `npm start`.
4. Copy the six-digit code shown in the terminal into **Settings → Desktop slicers** in 3D Model Manager.

## Build a standalone application

Run `npm run build` to create an executable for the current computer. On Windows this also creates a versioned `3d-model-manager-bridge-setup-*-windows-x64.exe` installer. Run `npm run build:all` to create unsigned Windows x64, Linux x64/ARM64, and macOS x64/ARM64 executables. The first build downloads the matching Node runtimes.

On Windows, use the setup executable. It installs the bridge for the current user, adds Desktop and Start Menu shortcuts, and starts the bridge automatically when that user signs in. The bridge runs in the background without a command window. It adds a **3D Model Manager Bridge** icon to the system tray and opens a local status page when it starts. Double-click the tray icon to see the pairing code, or right-click it to open status or stop the bridge. The icon may be under Windows' hidden-icons arrow. Folder approval uses the native Windows folder browser. macOS uses Finder's folder picker; Linux uses Zenity, KDialog, or YAD when installed.

Windows may show an unknown-publisher warning the first time the unsigned setup is downloaded and launched. Avoiding that warning requires a trusted code-signing certificate and reputation. After installation, launch the installed shortcut or let Windows start the bridge at sign-in instead of repeatedly running the downloaded setup. macOS builds may also show an unknown-publisher warning and may need an ad-hoc signature (`codesign --sign - <file>`) when built on another platform.

The bridge stores approved folders, its pairing token, and slicer settings in `.3d-model-manager-bridge.json` in the current user's home folder.
