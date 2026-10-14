# 3D Model Manager Workstation Bridge

The optional bridge connects 3D Model Manager in the browser to the current workstation. It detects supported slicers, opens downloaded models in a selected slicer, and synchronizes model files from folders the user approves.

Supported local files are STL, 3MF, OpenSCAD (`.scad`), STEP (`.step`, `.stp`, `.ste`), and Autodesk Fusion archives (`.f3d`, `.f3z`). When the user chooses **Sync**, the browser copies those files into `Workstations/<computer>/<folder>` in the Docker application's configured library. Existing synchronized files are updated; files are not deleted from the workstation.

## Install on Windows

1. Open the [latest GitHub release](https://github.com/nickm324/3d-model-manager/releases/latest).
2. Under **Assets**, download `3d-model-manager-bridge-setup-*-windows-x64.exe`.
3. Run the installer. If Microsoft Defender SmartScreen identifies it as an unknown app, select **More info → Run anyway** after confirming it came from this repository. The warning appears because the project does not currently use a commercial code-signing certificate.
4. Installation adds Desktop, Start Menu, and startup shortcuts. The bridge starts immediately, runs without a command window, and starts automatically at Windows sign-in.
5. Its local status page opens and shows the bridge version and six-digit pairing code. The same page is available by double-clicking the **3D Model Manager Bridge** system-tray icon. The icon may be inside Windows' hidden-icons menu.

To update the bridge, download and run the newer setup executable. It replaces the installed program while retaining the pairing and approved-folder configuration in the current user's home folder.

## Pair with 3D Model Manager

1. Open **Settings → Desktop slicers** in the web app.
2. Enter the six-digit code from the bridge status page and select **Pair bridge**.
3. Confirm that the green badge says **Connected** and shows this computer's name and bridge version.
4. Select **Detect slicers** if the detected slicer list does not refresh automatically, then choose the default slicer.

Pairing is tied to the web app address used during setup. Use **Re-pair bridge** if the Docker host address changes or the browser loses its saved bridge token.

## Synchronize a local folder

1. Under **Local model folders**, select **Choose local folder**.
2. Approve a folder in the operating system's folder picker. A website cannot directly browse the workstation, so the bridge opens this native dialog.
3. Select **Sync** beside one folder, or **Sync all folders**.
4. The app copies supported files into `Workstations/<computer>/<folder>` inside the configured Docker library. The `Workstations` root is added to the app's scan folders automatically, so synchronized folders appear in the left sidebar after indexing.

Synchronization copies new and changed supported files. It does not delete the originals or give the Docker container general access to the workstation. **Remove** revokes approval for future synchronization; it does not delete already imported models.

## Tray and status controls

- Double-click the tray icon to open the local status and pairing page.
- Right-click it to choose **Open status and pairing**, view **About · Version**, or **Stop bridge**.
- Stopping the bridge ends its background process. Start it again from the Desktop or Start Menu shortcut; it also starts at the next Windows sign-in.
- The local status page can be closed without stopping the bridge.

## macOS and Linux

Ready-to-install releases currently target Windows x64. To run the bridge on macOS or Linux, build it from source. Folder selection uses Finder on macOS and Zenity, KDialog, or YAD on Linux when available.

1. Install Node.js 22 or newer.
2. Run `npm install` in this folder.
3. Run `npm start` for development, or `npm run build` for the current computer.
4. Pair with the six-digit code shown in the terminal.

## Build standalone applications

Run `npm run build` to create an executable for the current computer. On Windows this also creates a versioned `3d-model-manager-bridge-setup-*-windows-x64.exe` installer. Run `npm run build:all` to create unsigned Windows x64, Linux x64/ARM64, and macOS x64/ARM64 executables. The first build downloads the matching Node runtimes.

## Security and configuration

The bridge listens only on `127.0.0.1:3211`, accepts requests only from the paired web-app origin, and serves files only from explicitly approved folders. It never exposes the rest of the workstation to the Docker container or local network.

The bridge stores approved folders, its pairing token, and slicer settings in `.3d-model-manager-bridge.json` in the current user's home folder.

macOS builds may show an unknown-publisher warning and may need an ad-hoc signature (`codesign --sign - <file>`) when built on another platform.
