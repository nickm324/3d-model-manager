import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { LocalStorage } from '../smb-storage.mjs';

test('SMB provider path supports indexing, preview, editing, import, move, render, and delete', { timeout: 30000 }, async () => {
  const base = path.resolve(process.env.TEST_TMP || '../../work/test-runs'); await fs.mkdir(base, { recursive: true });
  const dir = await fs.mkdtemp(path.join(base, 'smb-')), library = path.join(dir, 'share'), data = path.join(dir, 'data');
  await fs.mkdir(path.join(library, 'Models/BOSL2'), { recursive: true }); await fs.writeFile(path.join(library, 'Models/test.scad'), 'cube(4);'); await fs.writeFile(path.join(library, 'Models/BOSL2/std.scad'), 'module core(){ cube(5); }'); await fs.writeFile(path.join(library, 'Models/BOSL2/skin.scad'), 'module helper(){ core(); }');
  const { server } = await createApp({ library, data, writable: true, compiler: process.env.OPENSCAD_BIN, storage: new LocalStorage(library) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
  const call = (url, method = 'GET', body) => fetch(origin + url, { method, headers: { 'X-Model-Manager': '1' }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  try {
    let response = await call('/api/library'); const initialLibrary = await response.json(); assert.deepEqual(initialLibrary.files.map(x => x.path), ['Models/test.scad']); assert.deepEqual(initialLibrary.hiddenLibraryFolders, ['Models/BOSL2']);
    response = await call('/api/file?path=Models/test.scad'); assert.equal(await response.text(), 'cube(4);');
    const opened = await (await call('/api/source?path=Models/test.scad')).json(); response = await call('/api/source', 'PUT', { path: 'Models/test.scad', source: 'sphere(3);', revision: opened.revision }); assert.equal(response.status, 200);
    response = await call('/api/upload?path=Models/new.stl', 'POST', 'solid empty\nendsolid empty'); assert.equal(response.status, 201);
    response = await call('/api/move', 'POST', { path: 'Models/new.stl', target: 'Models/moved.stl' }); assert.equal(response.status, 200);
    if (process.env.OPENSCAD_BIN) { const job = await (await call('/api/render', 'POST', { path: 'Models/test.scad', source: 'include <BOSL2/skin.scad>; helper();' })).json(); let status; for (let n = 0; n < 100; n++) { status = await (await call(`/api/render/${job.id}`)).json(); if (status.status !== 'running') break; await new Promise(r => setTimeout(r, 100)); } assert.equal(status.status, 'done', status.log); assert.match(status.log, /BOSL2\/std\.scad/); }
    response = await call('/api/file?path=Models/moved.stl', 'DELETE'); assert.equal(response.status, 200); assert.equal(await fs.access(path.join(library, 'Models/moved.stl')).then(() => true, () => false), false);
  } finally { await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }); }
});

test('network setup discovers servers and shares, encrypts credentials, and activates the selected library', async () => {
  const base = path.resolve(process.env.TEST_TMP || '../../work/test-runs'); await fs.mkdir(base, { recursive: true });
  const dir = await fs.mkdtemp(path.join(base, 'connect-')), share = path.join(dir, 'share'), data = path.join(dir, 'data'), fallback = path.join(dir, 'fallback');
  await fs.mkdir(path.join(share, 'Chosen'), { recursive: true }); await fs.mkdir(path.join(share, 'Another'), { recursive: true }); await fs.mkdir(fallback); await fs.writeFile(path.join(share, 'Chosen/model.scad'), 'cube(8);'); await fs.writeFile(path.join(share, 'Another/second.stl'), 'solid second\nendsolid second');
  const options = { library: fallback, data, writable: true, discoverServers: async () => [{ host: 'NAS-SERVER', address: '192.0.2.10' }], listShares: async () => [{ name: 'Models', description: 'Models' }], smbFactory: config => new LocalStorage(config.folder ? path.join(share, config.folder) : share) };
  const { server } = await createApp(options); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
  const call = (url, method = 'GET', body) => fetch(origin + url, { method, headers: { 'X-Model-Manager': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    assert.equal((await (await call('/api/network/servers')).json()).servers[0].host, 'NAS-SERVER');
    assert.equal((await (await call('/api/network/shares', 'POST', { host: 'NAS-SERVER', username: 'sam', password: 'secret' })).json()).shares[0].name, 'Models');
    const connected = await call('/api/network/connect', 'POST', { host: 'NAS-SERVER', share: 'Models', folder: 'Chosen', username: 'sam', password: 'secret' }); assert.equal(connected.status, 200);
    let library = await (await call('/api/library')).json(); assert.deepEqual(library.files.map(x => x.path), ['Chosen/model.scad']); assert.equal(library.config.smb.host, 'NAS-SERVER');
    const added = await call('/api/network/connect', 'POST', { host: 'NAS-SERVER', share: 'Models', folder: 'Another', username: 'sam', password: 'secret' }); assert.equal(added.status, 200);
    library = await (await call('/api/library')).json(); assert.deepEqual(library.files.map(x => x.path).sort(), ['Another/second.stl', 'Chosen/model.scad']); assert.deepEqual(library.config.scanFolders.sort(), ['Another', 'Chosen']);
    const settings = await (await call('/api/settings')).json(); assert.equal(settings.smb.hasPassword, true); assert.equal(settings.smb.password, undefined);
    const disk = await fs.readFile(path.join(data, 'library.json'), 'utf8'); assert.doesNotMatch(disk, /secret/); assert.match(disk, /NAS-SERVER/);
  } finally { await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }); }
});

