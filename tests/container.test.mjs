import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('the runtime image includes every local server module', async () => {
  const server = await fs.readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  const dockerfile = await fs.readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  const modules = [...server.matchAll(/from ['"](\.\/[^'"]+\.mjs)['"]/g)].map(match => match[1].slice(2));
  for (const module of modules) assert.match(dockerfile, new RegExp(`COPY ${module.replaceAll('.', '\\.')} \\.\\/${module.replaceAll('.', '\\.')}`), `${module} must be copied into the runtime image`);
});
