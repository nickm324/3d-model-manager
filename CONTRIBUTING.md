# Contributing

Thanks for helping improve 3D Model Manager.

## Development

Use Node.js 22 or newer and install OpenSCAD. Then:

```sh
npm ci
npm run build
npm test
```

Set `LIBRARY_PATH`, `DATA_PATH`, and `OPENSCAD_BIN` before starting the app locally. Use a disposable library for development and tests. Never test write operations against someone else's model collection.

## Pull requests

- Keep changes focused and explain the user-visible behavior.
- Add or update meaningful tests for server behavior, file safety, and OpenSCAD parsing.
- Run the build and test suite before opening a pull request.
- Do not commit NAS credentials, `.env`, model libraries, application data, renders, or source backups.
- Preserve files in place and reject overwrites unless the user explicitly chose a safe replacement workflow.

By contributing, you agree that your contribution is licensed under the MIT License.
