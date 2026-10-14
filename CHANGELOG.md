# Changelog

All notable changes are documented here. This project follows semantic versioning.

## [2.3.2] - 2026-10-14

### Fixed

- Allow the bundled OpenCascade WebAssembly runtime to compile under the app Content Security Policy so STEP and STP previews load in supported browsers.
- Explain that native Fusion F3D/F3Z projects must be exported as STEP or 3MF instead of launching a slicer that cannot import them.

## [2.3.1] - 2026-10-14

### Added

- Native workstation folder picker for bridge folder approval.
- Background Windows bridge executable with a browser-based status and pairing page.
- STEP and Fusion 360 entries in the library file-type filter.

### Changed

- STEP filtering includes `.step`, `.stp`, and `.ste`; Fusion filtering includes `.f3d` and `.f3z`.

## [2.3.0] - 2026-10-14

### Added

- Interactive STEP previews for `.step`, `.stp`, and `.ste` files using OpenCascade in the browser.
- Autodesk Fusion `.f3d` and `.f3z` indexing with embedded project-preview extraction.
- Workstation Bridge folder approval, recursive model discovery, and synchronization into the Docker library.
- Standalone bridge build targets for Windows, Linux, and macOS.

## [2.2.1] - 2026-09-29

### Fixed

- Backup ZIPs now retain custom covers and print photos belonging to models currently in the recycle bin.

## [2.2.0] - 2026-09-13

### Added

- Guided first-run NAS setup.
- Public installation, Portainer, upgrade, recovery, and troubleshooting documentation.
- Automated semantic container tags and GitHub release archives.
- Repository screenshots and issue templates.

## [2.1.0] - 2026-09-13

### Added

- Restorable recycle bin with configurable retention.
- User-attributed history for metadata edits, source changes, moves, conversions, deletions, and restoration.
- Recycled files in full backup archives.

## [2.0.1] - 2026-09-13

### Fixed

- Included the authentication module in the runtime container image.
- Improved stopped-container reporting in the OMV build test.

## [2.0.0] - 2026-09-13

### Added

- Optional local user accounts with administrator, editor, and read-only roles.
- Optional trusted reverse-proxy username header.

## [1.9.4] - 2026-09-13

### Fixed

- Settings changes no longer wait for an unnecessary full library scan.

## [1.9.3] - 2026-09-13

### Changed

- Search uses complete words and supports exact `tag:name` queries and quoted phrases.

Earlier 1.x releases established direct SMB libraries, model previews, metadata extraction, duplicates, thumbnails, advanced search, print history, projects, OpenSCAD tools, bulk operations, slicer links, STL-to-3MF conversion, and backup recovery.
