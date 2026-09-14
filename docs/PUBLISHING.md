# Publishing a release

## Create the GitHub repository

1. Create an empty public repository named `3d-model-manager`.
2. Enable **Private vulnerability reporting** under the repository security settings.
3. Connect this local repository and push `main`.
4. Confirm the **Test, container, and release** workflow passes.
5. In the package settings, change the container package visibility to public.

## Publish a version

Keep the version in `package.json` and the newest `CHANGELOG.md` heading identical. Commit the release, then create and push an annotated tag:

```sh
git tag -a v2.2.0 -m "3D Model Manager 2.2.0"
git push origin main --tags
```

The tag runs all tests, builds the Docker image, publishes semantic tags to GitHub Container Registry, and creates a GitHub release with a portable source ZIP.

Container tags created from `v2.2.0` are:

- `2.2.0`
- `2.2`
- `2`

Pushes to `main` update `latest` after tests pass.

## Release checklist

- Confirm the app version in the header.
- Test a clean first-run setup and an upgrade using existing `/data`.
- Test SMB discovery, manual IP connection, preview, OpenSCAD rendering, and a recycle-bin restore.
- Download and restore a password-protected backup.
- Review screenshots and documentation for private names, addresses, and paths.
- Review dependency and container scan results.
- Summarize user-visible changes in `CHANGELOG.md`.
