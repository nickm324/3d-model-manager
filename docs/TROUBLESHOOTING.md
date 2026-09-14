# Troubleshooting

## The container exits immediately

Run `docker logs 3d-model-manager`. The included `build-and-test-on-omv.sh` reports startup errors before an image is deployed.

## No SMB servers are discovered

Discovery is best effort and depends on LAN broadcasts. Enter the NAS IP address manually. Host networking, used by `compose.portainer.yaml`, gives discovery the best chance to work on Linux Docker hosts.

## The NAS hostname cannot be resolved

Use the NAS IP address. Confirm the container can reach TCP port 445 and that no Docker firewall rule blocks the NAS subnet.

## Shares cannot be listed

Verify the username and password by connecting from another SMB client. Confirm the account can list shares and read the selected folder. A NAS may allow direct access to a known share while refusing share enumeration; enter the share name manually in that case.

## Scanning is slow

The first scan reads metadata, hashes same-sized duplicate candidates, and generates thumbnails incrementally. Cached models remain usable during later scans. Avoid selecting the entire share when only a few model folders are needed.

## OpenSCAD reports missing imports

Keep imported files and libraries within the included SMB folder structure. Dependency files such as BOSL2 modules are hidden from the model list but staged for rendering. Library modules that intentionally produce no top-level geometry are classified and excluded from ordinary model results.

## A recycled file cannot be restored

Restoration never overwrites a file. Move or rename the file currently occupying the original path, then retry. Recycled content is stored under `/data/recycle` until its configured retention expires.

## Bambu Studio rejects an open link

Confirm the model downloads normally in the browser. Bambu Studio handles 3MF links through its registered operating-system protocol. STL files and other slicers require the optional desktop bridge described in `bridge/README.md`.
