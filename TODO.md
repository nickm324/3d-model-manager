# 3D Model Manager roadmap

## 1. Duplicate detection
- [x] Compare file hashes rather than filenames.
- [x] Group exact duplicates and show their full folders and sizes.
- [x] Keep every copy together and let the user preview each before selecting exact files for deletion.

## 2. Indexing activity panel
- [x] Show the current folder, files processed, elapsed time, and warnings.
- [x] Provide pause, resume, and cancel controls.
- [x] Keep model previews responsive while scans run.

## 3. Better model thumbnails
- [x] Generate and cache STL thumbnails incrementally.
- [x] Use embedded 3MF images.
- [x] Allow a custom PNG, JPEG, or WebP cover and restore the automatic cover.

## 4. Advanced search and filters
- [x] Filter by dimensions, file size, format, collection, designer, license, slicer, and modification date.
- [x] Save commonly used searches.
- [x] Search extracted README and 3MF descriptions.

## 5. Print history
- [x] Track printer, filament, color, nozzle, layer height, date, quantity, and result.
- [x] Record failures and successful settings.
- [x] Attach photos of completed prints.

## 6. Model relationships
- [x] Group several files as one project.
- [x] Mark files as parts, alternate versions, source files, or generated exports.
- [x] Convert STL models to metadata-rich 3MF files, with optional removal of the verified original.
- [x] Associate OpenSCAD source with rendered STL files.

## 7. OpenSCAD improvements
- [x] Automatically rerender after a short delay when parameters change.
- [x] Show dependency trees and missing imports.
- [x] Save parameter presets.
- [x] Compare the current draft with the saved source.

## 8. Bulk operations
- [x] Select multiple models.
- [x] Assign collections or tags in bulk.
- [x] Move or delete multiple files.
- [x] Download multiple files as one archive.
- [x] Find models with missing metadata.

## 9. Backup and recovery
- [x] Export metadata, collections, settings, and encrypted connection configuration.
- [x] Restore from an export.
- [x] Add scheduled metadata backups and retention settings.

## 10. User accounts and permissions
- [x] Add administrator, editor, and read-only roles.
- [x] Add optional authentication through an existing reverse proxy.

## 11. File change history
- [x] Record renames, moves, edits, and deletions.
- [x] Add a recycle bin with configurable retention.
- [x] Restore accidentally deleted NAS files when possible.

## 12. GitHub-ready setup
- [x] Add guided first-run setup.
- [x] Add Docker Compose and Portainer instructions.
- [x] Add upgrade and backup documentation.
- [x] Add automated releases, container images, changelog, screenshots, and issue templates.
- [ ] Publish signed desktop bridge installers when signing credentials are available.
