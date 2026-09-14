import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { zipSync, unzipSync } from 'three/examples/jsm/libs/fflate.module.js';

const base = path.resolve(process.env.TEST_TMP || '../../work/test-runs');
await fs.mkdir(base, { recursive: true });
async function fixture(writable = true) {
  const dir = await fs.mkdtemp(path.join(base, 'shelf-')), library = path.join(dir, 'library'), data = path.join(dir, 'data');
  await fs.mkdir(path.join(library, 'Parts'), { recursive: true });
  await fs.writeFile(path.join(library, 'Parts/test.scad'), 'cube([10,20,5]);');
  await fs.writeFile(path.join(library, 'notes.txt'), 'not a model');
  const { server } = await createApp({ library, data, writable, compiler: process.env.OPENSCAD_BIN });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = (url, method = 'GET', body, headers = {}) => fetch(origin + url, { method, headers: { 'X-Model-Manager': '1', ...headers }, body: body === undefined ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body) });
  const close = () => new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
  return { dir, library, data, call, close };
}

test('scan, metadata, source backup/conflict, move/import collision, and persistence', async () => {
  const app = await fixture();
  try {
    let response = await app.call('/api/library'); let library = await response.json(); assert.equal(library.files.length, 1); assert.deepEqual(library.folders, ['Parts']);
    response = await app.call('/api/open-link', 'POST', { path: 'Parts/test.scad' }); const openLink = await response.json(); assert.equal(response.status, 200); response = await app.call(openLink.url); assert.equal(response.status, 200); assert.match(await response.text(), /cube/); assert.equal((await app.call(openLink.url)).status, 404);
    response = await app.call('/api/meta', 'PUT', { path: 'Parts/test.scad', tags: ['tested', 'tested'], notes: 'PLA', favorite: true, collection: 'Workshop' }); assert.equal(response.status, 200);
    response = await app.call('/api/prints', 'POST', { path: 'Parts/test.scad', date: '2026-09-13', result: 'success', printer: 'Bambu Lab A1', filament: 'PLA Basic', color: 'Black', nozzle: 0.4, layerHeight: 0.2, quantity: 2, notes: 'Clean print' }); assert.equal(response.status, 201); const print = await response.json();
    const printPng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]); response = await app.call(`/api/print-photo?path=Parts/test.scad&id=${print.id}`, 'PUT', printPng); assert.equal(response.status, 200); const printPhoto = await response.json(); assert.equal((await app.call(printPhoto.photo)).status, 200);
    library = await (await app.call('/api/library')).json(); assert.equal(library.files[0].prints[0].printer, 'Bambu Lab A1'); assert.equal(library.files[0].prints[0].quantity, 2); assert.ok(library.files[0].prints[0].photo);
    response = await app.call('/api/prints', 'POST', { path: 'Parts/test.scad', result: 'failed', notes: 'Detached from bed' }); assert.equal(response.status, 201); const failedPrint = await response.json(); assert.equal(failedPrint.result, 'failed');
    response = await app.call(`/api/prints?path=Parts/test.scad&id=${failedPrint.id}`, 'DELETE'); assert.equal(response.status, 200);
    response = await app.call('/api/presets', 'PUT', { path: 'Parts/test.scad', name: 'Draft quality', values: { width: 20, enabled: true } }); assert.equal(response.status, 200);
    let dependencies = await (await app.call('/api/dependencies', 'POST', { path: 'Parts/test.scad', source: 'include <missing.scad>\ncube(1);' })).json(); assert.equal(dependencies.children[0].missing, true); assert.equal(dependencies.children[0].reference, 'missing.scad');
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]); response = await app.call('/api/cover?path=Parts/test.scad', 'PUT', png); assert.equal(response.status, 200);
    library = await (await app.call('/api/library')).json(); assert.match(library.files[0].thumbnail, /^\/api\/thumbnail\//); assert.ok(library.files[0].customCover);
    response = await app.call('/api/meta', 'PUT', { path: 'Parts/test.scad', tags: ['tested'], notes: 'PLA', favorite: true, collection: 'Workshop' }); assert.equal(response.status, 200);
    library = await (await app.call('/api/library')).json(); assert.ok(library.files[0].customCover, 'saving metadata preserves the custom cover'); assert.equal(library.files[0].presets['Draft quality'].width, 20);
    response = await app.call('/api/cover?path=Parts/test.scad', 'DELETE'); assert.equal(response.status, 200);
    library = await (await app.call('/api/library')).json(); assert.equal(library.files[0].customCover, undefined);
    const settingsAfterAssignment = await (await app.call('/api/settings')).json(); assert.deepEqual(settingsAfterAssignment.collections, ['Workshop']);
    response = await app.call('/api/backup/export', 'POST', { password: 'test-backup-password' }); assert.equal(response.status, 200); const backupZip = unzipSync(new Uint8Array(await response.arrayBuffer())), backup = JSON.parse(new TextDecoder().decode(backupZip['backup.json'])); assert.equal(backup.encrypted, true); assert.ok(backupZip[`print-photos/${library.files[0].prints[0].photo}`]);
    const automatic = await (await app.call('/api/backups')).json(); assert.ok(automatic.backups.length); response = await app.call(`/api/backups/${encodeURIComponent(automatic.backups[0].name)}`); assert.equal(response.status, 200); const automaticZip = unzipSync(new Uint8Array(await response.arrayBuffer())); assert.equal(JSON.parse(new TextDecoder().decode(automaticZip['backup.json'])).credentialsOmitted, true);
    response = await app.call('/api/backups-download', 'POST'); assert.equal(response.status, 200); const allBackups = unzipSync(new Uint8Array(await response.arrayBuffer())); assert.ok(Object.keys(allBackups).some(name => name.endsWith('.zip')));
    await app.call('/api/meta', 'PUT', { path: 'Parts/test.scad', notes: 'Changed after backup' }); response = await app.call('/api/backup/restore', 'POST', Buffer.from(zipSync(backupZip)), { 'Content-Type': 'application/zip', 'X-Backup-Password': 'test-backup-password' }); assert.equal(response.status, 200);
    library = await (await app.call('/api/library')).json(); assert.equal(library.files[0].notes, 'PLA');
    response = await app.call('/api/source?path=Parts/test.scad'); const source = await response.json();
    response = await app.call('/api/source', 'PUT', { path: 'Parts/test.scad', source: 'sphere(5);', revision: source.revision }); assert.equal(response.status, 200);
    const backups = (await fs.readdir(path.join(app.data, 'backups'))).filter(name => name.endsWith('.scad')); assert.equal(backups.length, 1); assert.equal(await fs.readFile(path.join(app.data, 'backups', backups[0]), 'utf8'), 'cube([10,20,5]);');
    response = await app.call('/api/source', 'PUT', { path: 'Parts/test.scad', source: 'cube(99);', revision: source.revision }); assert.equal(response.status, 409); assert.equal(await fs.readFile(path.join(app.library, 'Parts/test.scad'), 'utf8'), 'sphere(5);');
    response = await app.call('/api/upload?path=Parts/test.scad', 'POST', 'bad overwrite'); assert.equal(response.status, 409);
    response = await app.call('/api/folder', 'POST', { path: 'Printed' }); assert.equal(response.status, 201);
    response = await app.call('/api/move', 'POST', { path: 'Parts/test.scad', target: 'Printed/moved.scad' }); assert.equal(response.status, 200);
    library = await (await app.call('/api/library')).json(); assert.equal(library.files[0].favorite, true); assert.deepEqual(library.files[0].tags, ['tested']);
    response = await app.call('/api/upload?path=Printed/other.scad', 'POST', 'cube(2);'); assert.equal(response.status, 201);
    response = await app.call('/api/move', 'POST', { path: 'Printed/moved.scad', target: 'Printed/other.scad' }); assert.equal(response.status, 409); assert.equal(await fs.readFile(path.join(app.library, 'Printed/moved.scad'), 'utf8'), 'sphere(5);');
    response = await app.call('/api/file?path=Printed/other.scad', 'DELETE'); assert.equal(response.status, 200); assert.equal((await response.json()).deleted, true);
    assert.equal(await fs.stat(path.join(app.library, 'Printed/other.scad')).then(() => true, () => false), false);
    await app.close();
    const restarted = await createApp({ library: app.library, data: app.data }); await new Promise(resolve => restarted.server.listen(0, '127.0.0.1', resolve));
    const restored = await (await fetch(`http://127.0.0.1:${restarted.server.address().port}/api/library`)).json(); assert.equal(restored.files.find(f => f.path === 'Printed/moved.scad').notes, 'PLA');
    await new Promise(resolve => { restarted.server.close(resolve); restarted.server.closeIdleConnections(); });
  } finally { if (app.call) await app.close(); }
});

test('Thingiverse README applies to models in its project subfolders only', async () => {
  const app = await fixture();
  try {
    await fs.mkdir(path.join(app.library, 'Things', 'Gear Holder', 'files'), { recursive: true });
    await fs.mkdir(path.join(app.library, 'Things', 'Other Project', 'files'), { recursive: true });
    await fs.writeFile(path.join(app.library, 'Things', 'Gear Holder', 'README.txt'), '# Gear Holder\nDescription: A useful holder');
    await fs.writeFile(path.join(app.library, 'Things', 'Gear Holder', 'files', 'holder.stl'), 'solid holder\nendsolid holder');
    await fs.writeFile(path.join(app.library, 'Things', 'Other Project', 'files', 'other.stl'), 'solid other\nendsolid other');
    assert.equal((await app.call('/api/scan', 'POST')).status, 200);
    const library = await (await app.call('/api/library')).json();
    assert.equal(library.files.find(file => file.name === 'holder.stl').projectInfo.title, 'Gear Holder');
    assert.equal(library.files.find(file => file.name === 'other.stl').projectInfo, undefined);
  } finally { await app.close(); }
});

test('duplicate detection and bulk metadata/delete operations', async () => {
  const app = await fixture();
  try {
    await fs.writeFile(path.join(app.library, 'Parts', 'copy-a.stl'), 'solid duplicate\nendsolid duplicate');
    await fs.writeFile(path.join(app.library, 'Parts', 'copy-b.stl'), 'solid duplicate\nendsolid duplicate');
    assert.equal((await app.call('/api/scan', 'POST')).status, 200);
    let library = await (await app.call('/api/library')).json(); const copies = library.files.filter(file => file.name.startsWith('copy-'));
    assert.equal(copies.length, 2); assert.equal(copies[0].duplicateCount, 2); assert.equal(copies[0].duplicateGroup, copies[1].duplicateGroup);
    let response = await app.call('/api/projects', 'POST', { name: 'Copy Project', paths: [...copies.map(file => file.path), 'Parts/test.scad'] }); assert.equal(response.status, 201); const project = await response.json();
    response = await app.call('/api/bulk-download', 'POST', { paths: copies.map(file => file.path) }); assert.equal(response.status, 200); const archive = unzipSync(new Uint8Array(await response.arrayBuffer())); assert.deepEqual(Object.keys(archive).sort(), copies.map(file => file.path).sort());
    response = await app.call('/api/meta', 'PUT', { path: copies[0].path, projectId: project.id, role: 'export', sourcePath: 'Parts/test.scad' }); assert.equal(response.status, 200);
    library = await (await app.call('/api/library')).json(); assert.equal(library.projects[0].name, 'Copy Project'); assert.equal(library.files.find(file => file.path === copies[0].path).sourcePath, 'Parts/test.scad'); assert.equal(library.files.find(file => file.path === 'Parts/test.scad').role, 'source');
    response = await app.call('/api/bulk', 'POST', { action: 'collection', paths: copies.map(file => file.path), collection: 'Duplicates' }); assert.equal(response.status, 200);
    response = await app.call('/api/bulk', 'POST', { action: 'tags', paths: copies.map(file => file.path), tags: ['review'] }); assert.equal(response.status, 200);
    library = await (await app.call('/api/library')).json(); assert.ok(library.files.filter(file => file.name.startsWith('copy-')).every(file => file.collection === 'Duplicates' && file.tags.includes('review')));
    await fs.mkdir(path.join(app.library, 'Review')); response = await app.call('/api/bulk', 'POST', { action: 'move', paths: copies.map(file => file.path), folder: 'Review' }); assert.equal(response.status, 200);
    const movedPaths = copies.map(file => `Review/${file.name}`); response = await app.call('/api/bulk', 'POST', { action: 'delete', paths: movedPaths }); assert.equal(response.status, 200);
    library = await (await app.call('/api/library')).json(); assert.equal(library.files.some(file => file.name.startsWith('copy-')), false); assert.equal(library.scanning, false);
  } finally { await app.close(); }
});

test('reject traversal, cross-site writes, unsupported files, and read-only modifications', async () => {
  const app = await fixture(false);
  try {
    assert.equal((await app.call('/api/file?path=../secret.scad')).status, 400);
    assert.equal((await app.call('/api/file?path=%2Fetc%2Fpasswd')).status, 400);
    assert.equal((await app.call('/api/file?path=notes.txt')).status, 415);
    assert.equal((await app.call('/api/scan', 'POST', undefined, { Origin: 'https://other.example' })).status, 403);
    assert.equal((await app.call('/api/upload?path=new.scad', 'POST', 'cube(1);')).status, 403);
    assert.equal((await app.call('/api/source', 'PUT', { path: 'Parts/test.scad', source: 'cube(2)' })).status, 403);
    assert.equal((await app.call('/api/file?path=Parts/test.scad', 'DELETE')).status, 403);
    assert.equal((await app.call('/api/meta', 'PUT', { path: 'Parts/test.scad', favorite: true })).status, 200);
    const saved = JSON.parse(await fs.readFile(path.join(app.data, 'library.json'), 'utf8')); assert.equal(saved.items['Parts/test.scad'].favorite, true);
  } finally { await app.close(); }
});

test('real OpenSCAD rendering supports unsaved drafts and relative includes', { skip: !process.env.OPENSCAD_BIN, timeout: 30000 }, async () => {
  const app = await fixture(false);
  try {
    await fs.writeFile(path.join(app.library, 'Parts/shape.scad'), 'module part(){ cube([10,20,5]); }');
    const response = await app.call('/api/render', 'POST', { path: 'Parts/test.scad', source: 'include <shape.scad>\npart();' }); assert.equal(response.status, 202); const { id } = await response.json();
    let progress;
    for (let attempt = 0; attempt < 100; attempt++) { progress = await (await app.call(`/api/render/${id}`)).json(); if (progress.status !== 'running') break; await new Promise(resolve => setTimeout(resolve, 100)); }
    assert.equal(progress.status, 'done', progress.log);
    const result = await app.call(`/api/render/${id}/file`); assert.equal(result.status, 200); assert.ok((await result.arrayBuffer()).byteLength > 100);
    assert.equal(await fs.readFile(path.join(app.library, 'Parts/test.scad'), 'utf8'), 'cube([10,20,5]);');
    const bad = await (await app.call('/api/render', 'POST', { path: 'Parts/test.scad', source: 'this is invalid syntax @' })).json();
    for (let attempt = 0; attempt < 100; attempt++) { progress = await (await app.call(`/api/render/${bad.id}`)).json(); if (progress.status !== 'running') break; await new Promise(resolve => setTimeout(resolve, 100)); }
    assert.equal(progress.status, 'failed'); assert.match(progress.log, /error/i);
  } finally { await app.close(); }
});

test('an unavailable library gives a useful error without deleting metadata', async () => {
  const app = await fixture();
  try {
    await fs.rename(app.library, `${app.library}-offline`);
    const response = await app.call('/api/scan', 'POST'); const result = await response.json(); assert.match(result.error, /library/);
    const library = await (await app.call('/api/library')).json(); assert.equal(library.files.length, 1); assert.ok(library.error);
  } finally { await app.close(); }
});

test('administrative settings persist collections, defaults, and scan folders', async () => {
  const app = await fixture();
  try {
    await fs.mkdir(path.join(app.library, 'Hidden')); await fs.writeFile(path.join(app.library, 'Hidden/other.stl'), 'solid empty\nendsolid empty');
    let response = await app.call('/api/settings', 'PUT', { collections: ['Functional', 'Ideas', 'Functional'], scanFolders: ['Parts'], defaultSort: 'name', scanInterval: 900 });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).indexing, true);
    for (let attempt = 0; attempt < 50; attempt++) { const status = await (await app.call('/api/library')).json(); if (!status.scanning) break; await new Promise(resolve => setTimeout(resolve, 20)); }
    const settings = await (await app.call('/api/settings')).json();
    assert.deepEqual(settings.collections, ['Functional', 'Ideas']); assert.deepEqual(settings.scanFolders, ['Parts']); assert.equal(settings.defaultSort, 'name'); assert.equal(settings.scanInterval, 900);
    const library = await (await app.call('/api/library')).json(); assert.deepEqual(library.files.map(file => file.path), ['Parts/test.scad']); assert.ok(library.folders.includes('Hidden'));
    response = await app.call('/api/settings', 'PUT', { collections: ['Functional'], scanFolders: ['Parts'], defaultSort: 'modified', scanInterval: 300 }); assert.equal((await response.json()).indexing, false);
    response = await app.call('/api/settings', 'PUT', { collections: [], scanFolders: ['Missing'], defaultSort: 'modified', scanInterval: 300 }); assert.equal(response.status, 404);
    response = await app.call('/api/settings', 'PUT', { collections: [], scanFolders: [], defaultSort: 'modified', scanInterval: 5 }); assert.equal(response.status, 400);
  } finally { await app.close(); }
});

test('optional sign-in enforces administrator, editor, and read-only access', async () => {
  const app = await fixture();
  try {
    let response = await app.call('/api/auth/users', 'POST', { username: 'owner', password: 'owner password', role: 'admin' }); assert.equal(response.status, 201);
    response = await app.call('/api/auth/config', 'PUT', { enabled: true, proxyHeader: '' }); assert.equal(response.status, 200);
    assert.equal((await app.call('/api/library')).status, 401);
    response = await app.call('/api/auth/login', 'POST', { username: 'owner', password: 'owner password' }); assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    response = await app.call('/api/auth/users', 'POST', { username: 'guest', password: 'guest password', role: 'viewer' }, { Cookie: cookie }); assert.equal(response.status, 201);
    response = await app.call('/api/auth/login', 'POST', { username: 'guest', password: 'guest password' }); const guestCookie = response.headers.get('set-cookie').split(';')[0];
    assert.equal((await app.call('/api/library', 'GET', undefined, { Cookie: guestCookie })).status, 200);
    assert.equal((await app.call('/api/meta', 'PUT', { path: 'Parts/test.scad', tags: ['blocked'] }, { Cookie: guestCookie })).status, 403);
    assert.equal((await app.call('/api/settings', 'GET', undefined, { Cookie: guestCookie })).status, 403);
  } finally { await app.close(); }
});

test('deleted models can be restored from the recycle bin with activity history', async () => {
  const app = await fixture();
  try {
    let response = await app.call('/api/file?path=Parts/test.scad', 'DELETE'); assert.equal(response.status, 200);
    const recycle = await (await app.call('/api/recycle')).json(); assert.equal(recycle.items.length, 1); assert.equal(recycle.items[0].path, 'Parts/test.scad');
    response = await app.call('/api/backup/export', 'POST', { password: '' }); const archive = unzipSync(new Uint8Array(await response.arrayBuffer())); assert.ok(archive[`recycle/${recycle.items[0].id}`]);
    response = await app.call('/api/recycle/restore', 'POST', { id: recycle.items[0].id }); assert.equal(response.status, 200);
    assert.equal(await fs.readFile(path.join(app.library, 'Parts/test.scad'), 'utf8'), 'cube([10,20,5]);');
    const history = await (await app.call('/api/history')).json(); assert.deepEqual(history.history.slice(0, 2).map(item => item.action), ['restored', 'deleted']);
  } finally { await app.close(); }
});
