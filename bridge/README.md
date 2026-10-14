# 3D Model Manager Workstation Bridge

The bridge runs only on `127.0.0.1:3211`. It lets the browser application detect desktop slicers and explicitly approve local model folders. It never exposes the rest of the workstation.

Supported local files are STL, 3MF, OpenSCAD (`.scad`), STEP (`.step`, `.stp`, `.ste`), and Autodesk Fusion archives (`.f3d`, `.f3z`). When the user chooses **Sync**, the browser copies those files into `Workstations/<computer>/<folder>` in the Docker application's configured library. Existing synchronized files are updated; files are not deleted from the workstation.

## Run from source

1. Install Node.js 22 or newer.
2. Run `npm install` in this folder.
3. Run `npm start`.
4. Copy the six-digit code shown in the terminal into **Settings → Desktop slicers** in 3D Model Manager.

## Build a standalone application

Run `npm run build` to create an executable for the current computer. Run `npm run build:all` to create unsigned Windows x64, Linux x64/ARM64, and macOS x64/ARM64 executables. The first build downloads the matching Node runtimes.

On Windows, the packaged bridge runs as a background application without a command window. Double-clicking it opens a local status page that shows the pairing code and provides a **Stop bridge** button. Folder approval uses the operating system's folder picker. macOS uses Finder's folder picker; Linux uses Zenity, KDialog, or YAD when installed.

Windows and macOS may show an unknown-publisher warning until release binaries are code signed. macOS builds may need an ad-hoc signature (`codesign --sign - <file>`) when built on another platform.

The bridge stores approved folders, its pairing token, and slicer settings in `.3d-model-manager-bridge.json` in the current user's home folder.
