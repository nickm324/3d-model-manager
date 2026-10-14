import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

test('workstation bridge approves, scans, and serves only supported files inside a folder', async () => {
  const base = path.resolve(process.env.TEST_TMP || '../../work/test-runs'); await fs.mkdir(base, { recursive: true });
  const dir = await fs.mkdtemp(path.join(base, 'bridge-')), models = path.join(dir, 'models');
  await fs.mkdir(path.join(models, 'nested'), { recursive: true });
  await fs.writeFile(path.join(models, 'part.step'), 'ISO-10303-21;'); await fs.writeFile(path.join(models, 'nested', 'design.f3d'), 'fusion'); await fs.writeFile(path.join(models, 'ignore.txt'), 'ignore');
  process.env.MODEL_MANAGER_BRIDGE_CONFIG = path.join(dir, 'bridge.json');
  const { startBridge } = await import(`../bridge/server.mjs?test=${Date.now()}`), server = startBridge(0); await new Promise(resolve => server.once('listening', resolve));
  const origin = 'http://model-manager.test', root = `http://127.0.0.1:${server.address().port}`, stored = JSON.parse(await fs.readFile(process.env.MODEL_MANAGER_BRIDGE_CONFIG, 'utf8'));
  const request = (route, body, token = '') => fetch(root + route, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Bridge-Token': token }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    let response = await request('/pair', { code: stored.code }); assert.equal(response.status, 200); const { token } = await response.json();
    response = await request('/folders/add', { path: models }, token); assert.equal(response.status, 201); const { folder } = await response.json();
    response = await request('/folders/scan', { id: folder.id }, token); const scan = await response.json(); assert.deepEqual(scan.files.map(file => file.path).sort(), ['nested/design.f3d', 'part.step']);
    response = await request(`/folders/file?id=${folder.id}&path=${encodeURIComponent('part.step')}`, undefined, token); assert.equal(response.status, 200); assert.equal(await response.text(), 'ISO-10303-21;');
    response = await request(`/folders/file?id=${folder.id}&path=${encodeURIComponent('../outside.step')}`, undefined, token); assert.equal(response.status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
