import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('public release contains documentation, community files, and matching versions', async () => {
  const required = ['README.md', 'LICENSE', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'docs/INSTALLATION.md', 'docs/UPGRADING.md', 'docs/TROUBLESHOOTING.md', 'docs/PUBLISHING.md', 'docs/images/first-run.png', 'docs/images/library.png', 'docs/images/settings.png', '.github/workflows/container.yml', '.github/ISSUE_TEMPLATE/bug.yml', '.github/ISSUE_TEMPLATE/feature.yml', '.github/pull_request_template.md', 'compose.yaml', 'compose.portainer.yaml', 'compose.ghcr.yaml'];
  await Promise.all(required.map(file => fs.access(new URL(file, root))));
  const pkg = JSON.parse(await fs.readFile(new URL('package.json', root), 'utf8')), changelog = await fs.readFile(new URL('CHANGELOG.md', root), 'utf8');
  assert.match(changelog, new RegExp(`## \\[${pkg.version.replaceAll('.', '\\.')}\\]`));
});

test('public documentation contains no development workspace or private NAS references', async () => {
  const files = ['README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'docs/INSTALLATION.md', 'docs/UPGRADING.md', 'docs/TROUBLESHOOTING.md', 'docs/PUBLISHING.md'];
  const text = (await Promise.all(files.map(file => fs.readFile(new URL(file, root), 'utf8')))).join('\n');
  assert.doesNotMatch(text, /Zoro-NAS|OMV7NAS|google-drive-plugin|C:\\Users\\|192\.168\.0\.27/i);
});
