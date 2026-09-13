import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { randomUUID, createHash, randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { LocalStorage, SmbStorage, discoverServers, listShares } from './smb-storage.mjs';
import { inspect3mf, inspectThingiverseReadme, add3mfMetadata } from './model-info.mjs';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'three/examples/jsm/libs/fflate.module.js';
import { normalizeAuth, makePassword, verifyPassword, issueSession, readSession } from './auth.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const types = new Set(['.stl', '.3mf', '.scad']);
const openScadLibraryFolders = new Set(['bosl2', 'bosl2-master', 'mcad']);
const isOpenScadLibraryPath = value => String(value).split('/').some(part => openScadLibraryFolders.has(part.toLowerCase()));
const fail = (status, message) => Object.assign(new Error(message), { status });
const hash = data => createHash('sha256').update(data).digest('hex');
const slash = value => value.split(path.sep).join('/');
function stlDimensions(buffer) {
  const limits = [[Infinity, -Infinity], [Infinity, -Infinity], [Infinity, -Infinity]];
  const add = (x, y, z) => [x, y, z].forEach((value, index) => { if (Number.isFinite(value)) { limits[index][0] = Math.min(limits[index][0], value); limits[index][1] = Math.max(limits[index][1], value); } });
  const count = buffer.length >= 84 ? buffer.readUInt32LE(80) : 0, binary = count > 0 && 84 + count * 50 <= buffer.length;
  if (binary) for (let offset = 84; offset + 50 <= buffer.length && offset < 84 + count * 50; offset += 50) for (let vertex = 0; vertex < 3; vertex++) { const at = offset + 12 + vertex * 12; add(buffer.readFloatLE(at), buffer.readFloatLE(at + 4), buffer.readFloatLE(at + 8)); }
  else { const source = buffer.toString('utf8'); for (const match of source.matchAll(/\bvertex\s+([-+\d.e]+)\s+([-+\d.e]+)\s+([-+\d.e]+)/gi)) add(Number(match[1]), Number(match[2]), Number(match[3])); }
  return limits.every(pair => pair.every(Number.isFinite)) ? limits.map(([min, max]) => max - min) : null;
}

export async function createApp(options = {}) {
  const appVersion = JSON.parse(await fs.readFile(path.join(here, 'package.json'), 'utf8')).version;
  const root = path.resolve(options.library || process.env.LIBRARY_PATH || './demo-library');
  const dataDir = path.resolve(options.data || process.env.DATA_PATH || './data');
  const writable = options.writable ?? process.env.LIBRARY_WRITABLE === 'true';
  const compiler = options.compiler || process.env.OPENSCAD_BIN || 'openscad';
  const makeSmb = options.smbFactory || (config => new SmbStorage(config));
  const findServers = options.discoverServers || discoverServers;
  const findShares = options.listShares || listShares;
  const maxBytes = Number(process.env.MAX_FILE_MB || 256) * 1024 * 1024;
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(path.join(dataDir, 'backups'), { recursive: true });
  await fs.mkdir(path.join(dataDir, 'renders'), { recursive: true });
  await fs.mkdir(path.join(dataDir, 'thumbnails'), { recursive: true });
  await fs.mkdir(path.join(dataDir, 'print-photos'), { recursive: true });
  await fs.mkdir(path.join(dataDir, 'recycle'), { recursive: true });
  const keyPath = path.join(dataDir, '.credential-key');
  let credentialKey;
  try { credentialKey = Buffer.from(await fs.readFile(keyPath, 'utf8'), 'base64'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; credentialKey = randomBytes(32); await fs.writeFile(keyPath, credentialKey.toString('base64'), { mode: 0o600 }); }
  const protect = value => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', credentialKey, iv), encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]); return [iv, cipher.getAuthTag(), encrypted].map(x => x.toString('base64')).join('.'); };
  const reveal = value => { if (!value) return ''; const [iv, tag, encrypted] = value.split('.').map(x => Buffer.from(x, 'base64')), decipher = createDecipheriv('aes-256-gcm', credentialKey, iv); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'); };
  const metaPath = path.join(dataDir, 'library.json');
  const catalogPath = path.join(dataDir, 'catalog.json');
  let metadata = { items: {}, config: { collections: [], scanFolders: [], defaultSort: 'modified', scanInterval: Number(process.env.SCAN_INTERVAL_SECONDS || 300) } };
  try { metadata = JSON.parse(await fs.readFile(metaPath, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw new Error('Could not read library.json. Restore its backup before starting.'); }
  metadata.items ||= {};
  metadata.projects ||= {};
  metadata.extracted ||= {};
  metadata.hashes ||= {};
  metadata.thumbnails ||= {};
  metadata.history ||= [];
  metadata.recycle ||= {};
  metadata.config = {
    collections: Array.isArray(metadata.config?.collections) ? metadata.config.collections : [],
    scanFolders: Array.isArray(metadata.config?.scanFolders) ? metadata.config.scanFolders : [],
    defaultSort: ['modified', 'name', 'size'].includes(metadata.config?.defaultSort) ? metadata.config.defaultSort : 'modified',
    scanInterval: Number.isFinite(Number(metadata.config?.scanInterval)) ? Number(metadata.config.scanInterval) : Number(process.env.SCAN_INTERVAL_SECONDS || 300),
    smb: metadata.config?.smb || null,
    backupInterval: [0, 24, 168].includes(Number(metadata.config?.backupInterval)) ? Number(metadata.config.backupInterval) : 24,
    backupRetention: Math.max(1, Math.min(30, Number(metadata.config?.backupRetention) || 7)),
    auth: normalizeAuth(metadata.config?.auth),
    recycleRetention: Math.max(1, Math.min(365, Number(metadata.config?.recycleRetention) || 30))
  };
  // Older releases rooted the provider at one selected folder. Store the share
  // root instead and keep selected folders as additive scan roots.
  if (metadata.config.smb?.folder) {
    metadata.config.scanFolders = [...new Set([metadata.config.smb.folder, ...metadata.config.scanFolders])];
    metadata.config.smb = { ...metadata.config.smb, folder: '' };
  }
  if (options.storage) metadata.config.smb ||= { host: 'test-nas', share: 'models', folder: '', username: '', domain: '', password: '' };
  let storage = options.storage || (metadata.config.smb ? makeSmb({ ...metadata.config.smb, password: reveal(metadata.config.smb.password) }) : new LocalStorage(root));
  const storageLabel = () => storage.label();
  const metaKey = rel => metadata.config.smb ? `smb://${[metadata.config.smb.host, metadata.config.smb.share, metadata.config.smb.folder, rel].filter(Boolean).join('/')}` : rel;
  const effectiveCollections = () => [...new Set([...metadata.config.collections, ...Object.values(metadata.items).map(item => item?.collection).filter(Boolean)])].sort((a, b) => a.localeCompare(b));
  let files = [], folders = [], hiddenLibraryFolders = [], scanError = null, scannedAt = null, scanning = null, rescanRequested = false, scanPausedUntil = 0;
  let scanControl = { phase: 'idle', current: '', processed: 0, total: 0, warnings: 0, paused: false, cancel: false, startedAt: null };
  const catalogSource = () => metadata.config.smb ? `smb://${metadata.config.smb.host}/${metadata.config.smb.share}` : `local://${root}`;
  try {
    const cached = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
    if (cached.source === catalogSource() && Array.isArray(cached.files) && Array.isArray(cached.folders)) {
      files = cached.files; folders = cached.folders; hiddenLibraryFolders = cached.hiddenLibraryFolders || []; scannedAt = cached.scannedAt || null;
    }
  } catch (e) { if (e.code !== 'ENOENT') console.warn('Ignoring unreadable catalog cache:', e.message); }
  let queue = Promise.resolve(), activeRender = null;
  const jobs = new Map();
  const openTokens = new Map();
  const exclusive = fn => { const next = queue.then(fn); queue = next.catch(() => {}); return next; };
  const persist = async () => {
    const temp = `${metaPath}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(metadata, null, 2));
    await fs.rename(temp, metaPath);
  };
  const persistCatalog = async () => {
    const temp = `${catalogPath}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify({ source: catalogSource(), files, folders, hiddenLibraryFolders, scannedAt }));
    await fs.rename(temp, catalogPath);
  };
  const addHistory = (action, filePath, user, details = {}) => { metadata.history.unshift({ id: randomUUID(), action, path: filePath, at: new Date().toISOString(), user: user?.username || 'System', ...details }); metadata.history = metadata.history.slice(0, 5000); };
  async function recycleFile(rel, user) {
    const file = await resolveFile(rel); if (!types.has(path.extname(file).toLowerCase())) throw fail(415, 'Unsupported file type.');
    const id = randomUUID(), saved = path.join(dataDir, 'recycle', id), key = metaKey(rel), stat = await storage.stat(storagePath(file));
    await pipeline(await storage.createReadStream(storagePath(file)), createWriteStream(saved, { flags: 'wx' }));
    metadata.recycle[id] = { id, path: rel, size: stat.size, deletedAt: new Date().toISOString(), user: user?.username || 'System', metadata: metadata.items[key] || null };
    try { await storage.unlink(storagePath(file)); } catch (error) { delete metadata.recycle[id]; await fs.rm(saved, { force: true }); throw error; }
    delete metadata.items[key]; delete metadata.hashes[key]; delete metadata.thumbnails[key]; for (const item of Object.values(metadata.items)) if (item.sourcePath === rel) item.sourcePath = '';
    addHistory('deleted', rel, user, { recycleId: id }); return metadata.recycle[id];
  }
  async function pruneRecycle() { const cutoff = Date.now() - metadata.config.recycleRetention * 86400000; let changed = false; for (const [id, item] of Object.entries(metadata.recycle)) if (new Date(item.deletedAt).getTime() < cutoff) { await fs.rm(path.join(dataDir, 'recycle', id), { force: true }); delete metadata.recycle[id]; changed = true; } return changed; }
  function relative(value, allowEmpty = false) {
    if (typeof value !== 'string' || (!allowEmpty && !value) || value.includes('\\') || value.includes('\0') || value.startsWith('/') || value.split('/').some(x => x === '..' || x === '.' || x.includes(':') || x.startsWith('.'))) throw fail(400, 'Choose a valid library path.');
    return value;
  }
  async function resolveFile(value, { parent = false, directory = false } = {}) {
    relative(value, directory);
    if (metadata.config.smb) {
      const checked = parent ? value.split('/').slice(0, -1).join('/') : value;
      try {
        if (checked && !await storage.exists(checked)) throw Object.assign(new Error(), { code: 'ENOENT' });
        if (directory && checked && !(await storage.stat(checked)).isDirectory) throw fail(400, `${value} is not a folder.`);
      } catch (e) { if (e.status) throw e; throw fail(e.code === 'ENOENT' ? 404 : 503, 'The file or library folder is unavailable. Check the SMB connection.'); }
      return value;
    }
    const full = path.join(root, value);
    const checked = parent ? path.dirname(full) : full;
    let base, real;
    try { base = await fs.realpath(root); real = await fs.realpath(checked); }
    catch (e) { throw fail(e.code === 'ENOENT' ? 404 : 503, 'The file or library folder is unavailable. Check the library connection.'); }
    const rel = path.relative(base, real);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw fail(403, 'This path is outside the library.');
    // Never follow links, including links back into the library.
    let cursor = root;
    for (const part of slash(path.relative(root, checked)).split('/').filter(Boolean)) {
      cursor = path.join(cursor, part);
      if ((await fs.lstat(cursor)).isSymbolicLink()) throw fail(403, 'Symbolic links are not supported.');
    }
    return full;
  }
  function requireWrite() { if (!writable) throw fail(403, 'Library is read-only. Enable LIBRARY_WRITABLE to save or move files. Tags, notes, and rendering still work.'); }
  const storagePath = value => metadata.config.smb ? value : slash(path.relative(root, value));
  async function removePrintPhotos(item) { await Promise.all((item?.prints || []).map(record => record.photo ? fs.rm(path.join(dataDir, 'print-photos', record.photo), { force: true }) : null)); }
  async function destinationExists(value) {
    if (!metadata.config.smb) return storage.exists(value);
    const normalized = slash(value), parent = path.posix.dirname(normalized) === '.' ? '' : path.posix.dirname(normalized), name = path.posix.basename(normalized).toLocaleLowerCase();
    const entries = await storage.readdir(parent);
    return entries.some(entry => entry.name.toLocaleLowerCase() === name);
  }
  async function generateStlThumbnail(file, key) {
    const id = hash(key).slice(0, 32), dir = await fs.mkdtemp(path.join(dataDir, 'renders', 'thumb-')), input = path.join(dir, 'model.stl'), source = path.join(dir, 'preview.scad'), output = path.join(dir, 'preview.png');
    try {
      await fs.writeFile(input, await storage.readFile(file.path)); await fs.writeFile(source, 'import("model.stl");');
      await new Promise((resolve, reject) => { const child = spawn(compiler, ['-o', output, '--imgsize=320,240', '--autocenter', '--viewall', source], { cwd: dir, env: { ...process.env, QT_QPA_PLATFORM: process.env.QT_QPA_PLATFORM || 'offscreen' }, stdio: 'ignore' }), timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Thumbnail timed out.')); }, 30000); child.once('error', reject); child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Thumbnail rendering failed.')); }); });
      await fs.copyFile(output, path.join(dataDir, 'thumbnails', id)); return id;
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  }
  async function scan() {
    if (scanning) { rescanRequested = true; return scanning; }
    scanning = (async () => {
      scanControl = { phase: 'discovering', current: '', processed: 0, total: 0, warnings: 0, paused: false, cancel: false, startedAt: new Date().toISOString() };
      const next = [], dirs = [], libraryDirs = [], readmes = [], warnings = [];
      if (metadata.config.smb?.host && metadata.config.scanFolders.length) folders = [...new Set([...folders, ...metadata.config.scanFolders])].sort();
      async function yieldToInteractiveWork() {
        if (scanControl.cancel) throw Object.assign(new Error('Scan cancelled.'), { cancelled: true });
        while (scanControl.paused || Date.now() < scanPausedUntil) { if (scanControl.cancel) throw Object.assign(new Error('Scan cancelled.'), { cancelled: true }); await new Promise(resolve => setTimeout(resolve, 100)); }
        await new Promise(resolve => setImmediate(resolve));
      }
      async function walk(prefix = '') {
        scanControl.current = prefix || 'Share root';
        await yieldToInteractiveWork();
        const entries = await storage.readdir(prefix);
        for (const entry of entries) {
          await yieldToInteractiveWork();
          scanControl.processed++;
          if (entry.name.startsWith('.') || entry.type === 'link') continue;
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.type === 'dir') {
            if (isOpenScadLibraryPath(rel)) { libraryDirs.push(rel); continue; }
            dirs.push(rel);
            try { await walk(rel); } catch (error) { if (error.cancelled) throw error; warnings.push(rel); }
          } else if (entry.type === 'file' && /^readme\.txt$/i.test(entry.name)) {
            readmes.push({ path: rel, folder: prefix, size: entry.size, modified: entry.mtime ? new Date(entry.mtime).toISOString() : '' });
          } else if (entry.type === 'file' && !isOpenScadLibraryPath(rel) && types.has(path.extname(entry.name).toLowerCase()) && (!metadata.config.scanFolders.length || metadata.config.scanFolders.some(rootFolder => prefix === rootFolder || prefix.startsWith(`${rootFolder}/`)))) {
            try {
              const stat = entry.size == null || !entry.mtime ? await storage.stat(rel) : entry;
              next.push({ path: rel, name: entry.name, folder: prefix, type: path.extname(entry.name).slice(1).toLowerCase(), size: stat.size, modified: new Date(stat.mtime).toISOString() });
            } catch { warnings.push(rel); }
          }
        }
      }
      try {
        if (metadata.config.smb && metadata.config.scanFolders.length) {
          for (const rootFolder of metadata.config.scanFolders) {
            dirs.push(rootFolder);
            try { await walk(rootFolder); } catch (error) { if (error.cancelled) throw error; warnings.push(rootFolder); }
          }
        } else await walk();
        const previousFiles = new Map(files.map(file => [file.path, file]));
        files = next.map(file => {
          const previous = previousFiles.get(file.path); if (!previous || previous.size !== file.size || previous.modified !== file.modified) return file;
          return { ...file, ...Object.fromEntries(['modelInfo', 'projectInfo', 'thumbnail', 'dimensions', 'contentHash', 'duplicateGroup', 'duplicateCount'].filter(key => previous[key] !== undefined).map(key => [key, previous[key]])) };
        }).sort((a, b) => b.modified.localeCompare(a.modified)); folders = dirs.sort(); hiddenLibraryFolders = libraryDirs.sort();
        scannedAt = new Date().toISOString(); scanError = null;
        // Publish the lightweight directory catalog before opening potentially
        // large 3MF archives. The UI and interactive file operations can work
        // while extracted details continue to populate.
        await persistCatalog();
        scanControl.phase = 'extracting'; scanControl.processed = 0; scanControl.total = readmes.length + files.filter(file => file.type === '3mf').length;
        const projects = new Map();
        for (const readme of readmes) {
          await yieldToInteractiveWork(); scanControl.current = readme.path;
          const key = metaKey(readme.path), signature = `readme-v3:${readme.size}:${readme.modified}`;
          let cached = metadata.extracted[key];
          if (!cached || cached.signature !== signature) {
            try { cached = { signature, kind: 'thingiverse', project: inspectThingiverseReadme((await storage.readFile(readme.path)).toString('utf8')) }; metadata.extracted[key] = cached; }
            catch { warnings.push(readme.path); continue; }
          }
          projects.set(readme.folder, cached.project);
          scanControl.processed++;
        }
        for (const file of files) {
          if (file.type === '3mf') {
            await yieldToInteractiveWork(); scanControl.current = file.path;
            const key = metaKey(file.path), signature = `3mf-v2:${file.size}:${file.modified}`;
            let cached = metadata.extracted[key];
            if (!cached || cached.signature !== signature) {
              try {
                const info = inspect3mf(await storage.readFile(file.path)); let thumbnailId = '';
                if (info.thumbnail?.data) { thumbnailId = hash(key).slice(0, 32); await fs.writeFile(path.join(dataDir, 'thumbnails', thumbnailId), info.thumbnail.data); }
                cached = { signature, kind: '3mf', standard: info.standard, bambu: info.bambu, thumbnailId }; metadata.extracted[key] = cached;
              } catch (error) { cached = { signature, kind: '3mf', error: error.message }; metadata.extracted[key] = cached; }
            }
            file.modelInfo = { standard: cached.standard, bambu: cached.bambu, error: cached.error }; if (cached.thumbnailId) file.thumbnail = `/api/thumbnail/${cached.thumbnailId}`;
            scanControl.processed++;
          }
          const projectFolder = [...projects.keys()].filter(folder => file.folder === folder || file.folder.startsWith(`${folder}/`)).sort((a, b) => b.length - a.length)[0];
          if (projectFolder !== undefined) file.projectInfo = projects.get(projectFolder);
        }
        const sizeGroups = new Map(); for (const file of files) { const group = sizeGroups.get(file.size) || []; group.push(file); sizeGroups.set(file.size, group); }
        const candidates = [...sizeGroups.values()].filter(group => group.length > 1).flat();
        scanControl.phase = 'duplicates'; scanControl.processed = 0; scanControl.total = candidates.length;
        for (const file of candidates) {
          await yieldToInteractiveWork(); scanControl.current = file.path; const key = metaKey(file.path), signature = `${file.size}:${file.modified}`;
          let cached = metadata.hashes[key]; if (!cached || cached.signature !== signature || (file.type === 'stl' && !cached.dimensions)) { const contents = await storage.readFile(file.path); cached = { signature, hash: hash(contents), ...(file.type === 'stl' ? { dimensions: stlDimensions(contents) } : {}) }; metadata.hashes[key] = cached; }
          file.contentHash = cached.hash; if (cached.dimensions) file.dimensions = cached.dimensions; scanControl.processed++;
        }
        const hashGroups = new Map(); for (const file of files.filter(file => file.contentHash)) { const group = hashGroups.get(file.contentHash) || []; group.push(file); hashGroups.set(file.contentHash, group); }
        for (const group of hashGroups.values()) if (group.length > 1) for (const file of group) { file.duplicateGroup = file.contentHash.slice(0, 12); file.duplicateCount = group.length; }
        const thumbnailCandidates = files.filter(file => { const cached = metadata.thumbnails[metaKey(file.path)], signature = `${file.size}:${file.modified}`; return file.type === 'stl' && (!cached || cached.signature !== signature); }).slice(0, 20);
        scanControl.phase = 'thumbnails'; scanControl.processed = 0; scanControl.total = thumbnailCandidates.length;
        for (const file of thumbnailCandidates) {
          await yieldToInteractiveWork(); scanControl.current = file.path; const key = metaKey(file.path), signature = `${file.size}:${file.modified}`;
          try { const id = await generateStlThumbnail(file, key); metadata.thumbnails[key] = { signature, id }; file.thumbnail = `/api/thumbnail/${id}`; } catch { metadata.thumbnails[key] = { signature, id: '', failed: true }; }
          scanControl.processed++;
        }
        for (const file of files.filter(file => file.type === 'stl')) { const cached = metadata.thumbnails[metaKey(file.path)]; if (cached?.id && cached.signature === `${file.size}:${file.modified}`) file.thumbnail = `/api/thumbnail/${cached.id}`; }
        scanError = warnings.length ? `${warnings.length} folders or files could not be read. Check share permissions.` : null;
        scanControl.warnings = warnings.length;
        await Promise.all([persistCatalog(), persist()]);
      } catch (error) { if (!error.cancelled) scanError = metadata.config.smb ? 'Cannot read the SMB library. Check the server, credentials, share, and folder.' : 'Cannot read the mounted library folder.'; }
    })().finally(() => {
      scanControl.phase = scanControl.cancel ? 'cancelled' : 'idle'; scanControl.current = '';
      scanning = null;
      if (rescanRequested) { rescanRequested = false; scan().catch(error => console.error('Queued SMB scan failed:', error)); }
    });
    return scanning;
  }
  function refreshDuplicateGroups() {
    for (const file of files) { delete file.duplicateGroup; delete file.duplicateCount; }
    const groups = new Map(); for (const file of files.filter(file => file.contentHash)) { const group = groups.get(file.contentHash) || []; group.push(file); groups.set(file.contentHash, group); }
    for (const group of groups.values()) if (group.length > 1) for (const file of group) { file.duplicateGroup = file.contentHash.slice(0, 12); file.duplicateCount = group.length; }
  }
  async function stopActiveScan() { if (!scanning) return; rescanRequested = false; scanControl.cancel = true; await scanning; rescanRequested = false; }
  if (metadata.config.smb && !options.storage) scan().catch(error => console.error('Initial SMB scan failed:', error));
  else await scan();
  let timer;
  function scheduleScan() {
    clearInterval(timer);
    timer = setInterval(() => scan(), metadata.config.scanInterval * 1000);
    timer.unref();
  }
  scheduleScan();
  let backupTimer;
  async function scheduledBackup(force = false) { const hours = metadata.config.backupInterval; if (!hours && !force) return; const dir = path.join(dataDir, 'backups'), entries = (await fs.readdir(dir)).filter(name => /^scheduled-.*\.json$/.test(name)).sort().reverse(); if (!force && entries[0]) { const age = Date.now() - (await fs.stat(path.join(dir, entries[0]))).mtimeMs; if (age < hours * 3600000) return; } await fs.writeFile(path.join(dir, `scheduled-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify({ format: 1, scheduled: true, metadata }, null, 2)); const all = (await fs.readdir(dir)).filter(name => /^scheduled-.*\.json$/.test(name)).sort().reverse(); await Promise.all(all.slice(metadata.config.backupRetention).map(name => fs.rm(path.join(dir, name), { force: true }))); }
  function scheduleBackups() { clearInterval(backupTimer); scheduledBackup().catch(error => console.error('Scheduled backup failed:', error)); backupTimer = setInterval(() => scheduledBackup().catch(error => console.error('Scheduled backup failed:', error)), 3600000); backupTimer.unref(); }
  scheduleBackups();
  async function jsonBody(req, limit = 2 * 1024 * 1024) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > limit) throw fail(413, 'The request is too large.'); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw fail(400, 'Invalid request.'); }
  }
  async function binaryBody(req, limit, message) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > limit) throw fail(413, message); chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
  async function makeBackupZip(payload, source = metadata, prefix = '') {
    const entries = { [`${prefix}backup.json`]: strToU8(JSON.stringify(payload, null, 2)) }, covers = new Set(), photos = new Set();
    for (const item of Object.values(source.items || {})) { if (item.customCover) covers.add(item.customCover); for (const record of item.prints || []) if (record.photo) photos.add(record.photo); }
    for (const id of covers) try { entries[`${prefix}thumbnails/${id}`] = new Uint8Array(await fs.readFile(path.join(dataDir, 'thumbnails', id))); } catch {}
    for (const id of photos) try { entries[`${prefix}print-photos/${id}`] = new Uint8Array(await fs.readFile(path.join(dataDir, 'print-photos', id))); } catch {}
    for (const id of Object.keys(source.recycle || {})) try { entries[`${prefix}recycle/${id}`] = new Uint8Array(await fs.readFile(path.join(dataDir, 'recycle', id))); } catch {}
    return entries;
  }
  function json(res, value, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
  async function stream(res, filename, downloadName, provider = null) {
    const stat = provider ? await provider.stat(filename) : await fs.stat(filename);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': 'no-store', ...(downloadName ? { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}` } : {}) });
    await pipeline(provider ? await provider.createReadStream(filename) : createReadStream(filename), res);
  }
  async function backup(file, rel) {
    const dest = `${Date.now()}-${randomUUID()}-${path.basename(rel)}`;
    if (metadata.config.smb) await fs.writeFile(path.join(dataDir, 'backups', dest), await storage.readFile(file));
    else await fs.copyFile(file, path.join(dataDir, 'backups', dest));
    return dest;
  }
  async function inspectDependencies(rel, sourceOverride) {
    const roots = [...new Set(['', ...metadata.config.scanFolders])], visited = new Set(); let count = 0;
    const safe = value => { const normalized = path.posix.normalize(String(value).replace(/\\/g, '/')).replace(/^\/+/, ''); return !normalized || normalized === '..' || normalized.startsWith('../') ? null : normalized; };
    async function locate(from, reference) { for (const candidate of [...new Set([path.posix.join(path.posix.dirname(from), reference), ...roots.map(rootFolder => path.posix.join(rootFolder, reference))].map(safe).filter(Boolean))]) try { if (await storage.exists(candidate) && !(await storage.stat(candidate)).isDirectory) return candidate; } catch {} return null; }
    async function visit(file, supplied) {
      if (++count > 250) return { path: file, truncated: true, children: [] }; if (visited.has(file)) return { path: file, circular: true, children: [] }; visited.add(file);
      let source; try { source = supplied ?? (await storage.readFile(file)).toString('utf8'); } catch { return { path: file, missing: true, children: [] }; }
      const refs = [...source.matchAll(/\b(include|use)\s*<([^>]+)>|\b(import|surface)\s*\(\s*(?:file\s*=\s*)?["']([^"'\n]+)["']/g)].map(match => ({ kind: match[1] || match[3], reference: match[2] || match[4] }));
      const children = []; for (const ref of refs) { const found = await locate(file, ref.reference); children.push(found ? { kind: ref.kind, reference: ref.reference, ...(path.extname(found).toLowerCase() === '.scad' ? await visit(found) : { path: found, children: [] }) } : { kind: ref.kind, reference: ref.reference, missing: true, children: [] }); }
      return { path: file, children };
    }
    return visit(rel, sourceOverride);
  }
  async function startRender(body) {
    if (activeRender) throw fail(429, 'Another model is rendering. Try again when it finishes.');
    const original = await resolveFile(body.path);
    if (path.extname(original).toLowerCase() !== '.scad' || typeof body.source !== 'string') throw fail(400, 'Choose an OpenSCAD file.');
    const id = randomUUID(), dir = path.join(dataDir, 'renders', id);
    await fs.mkdir(dir);
    let renderParent = path.dirname(original), renderSearchPaths = [renderParent, root], renderPrelude = '', renderNotice = '';
    if (metadata.config.smb) {
      const remoteParent = path.posix.dirname(original) === '.' ? '' : path.posix.dirname(original), staged = path.join(dir, 'share');
      await fs.mkdir(staged);
      let stagedBytes = 0; const visited = new Set();
      const searchRoots = [...new Set(['', ...metadata.config.scanFolders, ...metadata.config.scanFolders.map(folder => path.posix.dirname(folder)).filter(folder => folder !== '.')])];
      const safeRemote = value => { const normalized = path.posix.normalize(String(value).replace(/\\/g, '/')).replace(/^\/+/, ''); return !normalized || normalized === '..' || normalized.startsWith('../') ? null : normalized; };
      async function locateDependency(fromFile, dependency) {
        if (!dependency || path.posix.isAbsolute(dependency) || /^[a-z]:/i.test(dependency)) return null;
        const candidates = [...new Set([path.posix.join(path.posix.dirname(fromFile), dependency), ...searchRoots.map(rootFolder => path.posix.join(rootFolder, dependency))].map(safeRemote).filter(Boolean))];
        for (const candidate of candidates) try { if (await storage.exists(candidate) && !(await storage.stat(candidate)).isDirectory) return candidate; } catch {}
        return null;
      }
      async function stageFile(remoteFile, suppliedData) {
        remoteFile = safeRemote(remoteFile); if (!remoteFile || visited.has(remoteFile)) return; visited.add(remoteFile);
        const data = suppliedData ?? await storage.readFile(remoteFile); stagedBytes += data.length;
        if (stagedBytes > maxBytes * 2) throw fail(413, 'The files required by this OpenSCAD model exceed the staging limit.');
        const localFile = path.join(staged, ...remoteFile.split('/')); await fs.mkdir(path.dirname(localFile), { recursive: true }); await fs.writeFile(localFile, data);
        if (path.extname(remoteFile).toLowerCase() !== '.scad') return;
        const sourceText = data.toString('utf8'), references = [...sourceText.matchAll(/\b(?:include|use)\s*<([^>]+)>|\b(?:import|surface)\s*\(\s*(?:file\s*=\s*)?["']([^"'\n]+)["']/g)].map(match => match[1] || match[2]);
        for (const reference of references) { const dependency = await locateDependency(remoteFile, reference); if (dependency) await stageFile(dependency); }
      }
      await stageFile(original, Buffer.from(body.source));
      const stagedScad = [...visited].filter(file => file !== original && path.extname(file).toLowerCase() === '.scad' && path.posix.basename(file).toLowerCase() !== 'std.scad');
      let stdRemote = [...visited].find(file => path.posix.basename(file).toLowerCase() === 'std.scad');
      if (!stdRemote) for (const moduleFile of stagedScad) {
        const sibling = path.posix.join(path.posix.dirname(moduleFile), 'std.scad');
        try { if (await storage.exists(sibling) && !(await storage.stat(sibling)).isDirectory) { stdRemote = sibling; break; } } catch {}
      }
      if (stdRemote && !body.source.match(/\b(?:include|use)\s*<[^>]*std\.scad>/i)) {
        await stageFile(stdRemote);
        renderPrelude = `include <${slash(path.join(staged, ...stdRemote.split('/')))}>\n`;
        renderNotice = `3D Model Manager loaded ${stdRemote} before its dependent library modules.\n`;
      }
      renderParent = path.join(staged, ...remoteParent.split('/').filter(Boolean));
      renderSearchPaths = [renderParent, staged, ...searchRoots.map(remoteRoot => path.join(staged, ...remoteRoot.split('/').filter(Boolean)))];
    }
    // Resolve literal sibling imports against the original document, while keeping
    // include/use search paths and dynamic relative imports available via cwd.
    const parent = renderParent;
    let source = renderPrelude + body.source.replace(/\b(include|use)\s*<([^>]+)>/g, (all, keyword, name) => {
      if (path.isAbsolute(name) || !existsSync(path.resolve(parent, name))) return all;
      return `${keyword} <${slash(path.resolve(parent, name))}>`;
    }).replace(/\b(import|surface)\s*\(\s*(file\s*=\s*)?"([^"\n]+)"/g, (all, keyword, named, name) => `${keyword}(${named || ''}${JSON.stringify(slash(path.resolve(parent, name)))}`);
    const input = metadata.config.smb ? path.join(parent, path.basename(original)) : path.join(dir, 'draft.scad'), output = path.join(dir, 'model.stl');
    await fs.writeFile(input, source);
    const job = { id, status: 'running', log: renderNotice, output, created: Date.now(), name: `${path.basename(original, path.extname(original))}.stl`, sourcePath: body.path };
    jobs.set(id, job); activeRender = job;
    const child = spawn(compiler, ['-o', output, input], { cwd: parent, windowsHide: true, env: { ...process.env, QT_QPA_PLATFORM: 'offscreen', OPENSCADPATH: [...renderSearchPaths, process.env.OPENSCADPATH].filter(Boolean).join(path.delimiter) }, stdio: ['ignore', 'pipe', 'pipe'] });
    job.child = child;
    const capture = chunk => { job.log = (job.log + chunk.toString()).slice(-30000); };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    const timeout = setTimeout(() => { job.timedOut = true; child.kill('SIGKILL'); }, Number(process.env.RENDER_TIMEOUT_SECONDS || 120) * 1000);
    child.on('error', error => { job.status = 'failed'; job.log += `\nOpenSCAD could not start: ${error.message}`; });
    child.on('close', async code => {
      clearTimeout(timeout);
      try { const stat = await fs.stat(output); job.status = code === 0 && stat.size > 0 && stat.size <= maxBytes && !job.cancelled ? 'done' : 'failed'; }
      catch { job.status = 'failed'; }
      if (job.timedOut) job.log += '\nRender timed out. Simplify the model or increase RENDER_TIMEOUT_SECONDS.';
      if (job.cancelled) { job.status = 'cancelled'; job.log += '\nRender cancelled.'; }
      if (activeRender === job) activeRender = null;
    });
    return { id, status: job.status };
  }
  // Render files are temporary; source backups intentionally persist.
  const cleanup = setInterval(async () => {
    for (const entry of await fs.readdir(path.join(dataDir, 'renders'), { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === activeRender?.id) continue;
      const dir = path.join(dataDir, 'renders', entry.name);
      try { if (Date.now() - (await fs.stat(dir)).mtimeMs > 86400000) { await fs.rm(dir, { recursive: true }); jobs.delete(entry.name); } } catch { /* retry next time */ }
    }
    try { if (await pruneRecycle()) await persist(); } catch (error) { console.error('Recycle-bin cleanup failed:', error); }
  }, 3600000); cleanup.unref();
      const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' http://127.0.0.1:3211; worker-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'");
    try {
      const url = new URL(req.url, 'http://localhost');
      const endpoint = url.pathname, method = req.method;
      if ((method === 'GET' && /^\/api\/(?:file|source|parameters)/.test(endpoint)) || (method === 'POST' && endpoint === '/api/render')) scanPausedUntil = Date.now() + 2000;
      if (!['GET', 'HEAD'].includes(method)) {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) throw fail(403, 'Cross-site requests are not allowed.');
        if (req.headers['x-model-manager'] !== '1') throw fail(403, 'Request must come from 3D Model Manager.');
      }
      if (endpoint === '/api/health') return json(res, { ok: true, version: appVersion, libraryAvailable: !scanError });
      if (endpoint === '/api/auth' && method === 'GET') { const user = readSession(req, metadata.config.auth, credentialKey); return json(res, { enabled: metadata.config.auth.enabled, authenticated: !!user, user: user ? { username: user.username, role: user.role } : null }); }
      if (endpoint === '/api/auth/login' && method === 'POST') {
        const body = await jsonBody(req), user = metadata.config.auth.users.find(item => item.username.toLowerCase() === String(body.username || '').trim().toLowerCase());
        if (!user || !verifyPassword(String(body.password || ''), user.passwordHash)) throw fail(401, 'The username or password is incorrect.');
        res.setHeader('Set-Cookie', `model_manager_session=${issueSession(user, credentialKey)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200`); return json(res, { username: user.username, role: user.role });
      }
      if (endpoint === '/api/auth/logout' && method === 'POST') { res.setHeader('Set-Cookie', 'model_manager_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'); return json(res, { loggedOut: true }); }
      const currentUser = readSession(req, metadata.config.auth, credentialKey);
      if (endpoint.startsWith('/api/') && !endpoint.startsWith('/api/open-file/') && !currentUser) throw fail(401, 'Sign in to use 3D Model Manager.');
      const adminRoute = endpoint.startsWith('/api/settings') || endpoint.startsWith('/api/network') || endpoint.startsWith('/api/backup') || endpoint.startsWith('/api/history') || endpoint.startsWith('/api/recycle');
      const viewerWrite = !['GET', 'HEAD'].includes(method) && !endpoint.startsWith('/api/auth/') && !['/api/open-link', '/api/dependencies', '/api/bulk-download', '/api/render'].includes(endpoint);
      if (adminRoute && currentUser.role !== 'admin') throw fail(403, 'Administrator access is required.');
      if (viewerWrite && currentUser.role === 'viewer') throw fail(403, 'Read-only accounts cannot change the library.');
      if (endpoint === '/api/auth/users' && method === 'POST') {
        if (currentUser.role !== 'admin') throw fail(403, 'Administrator access is required.');
        const body = await jsonBody(req), username = String(body.username || '').trim(), role = ['admin', 'editor', 'viewer'].includes(body.role) ? body.role : 'viewer'; if (!username) throw fail(400, 'Enter a username.');
        const existing = metadata.config.auth.users.find(user => user.username.toLowerCase() === username.toLowerCase()), user = { id: existing?.id || randomUUID(), username, role, passwordHash: body.password ? makePassword(String(body.password)) : existing?.passwordHash }; if (!user.passwordHash) throw fail(400, 'Enter a password for the new account.');
        metadata.config.auth.users = [...metadata.config.auth.users.filter(item => item.id !== user.id), user]; await persist(); return json(res, { id: user.id, username, role }, existing ? 200 : 201);
      }
      if (endpoint === '/api/auth/users' && method === 'DELETE') { if (currentUser.role !== 'admin') throw fail(403, 'Administrator access is required.'); const body = await jsonBody(req); const remaining = metadata.config.auth.users.filter(user => user.id !== body.id); if (metadata.config.auth.enabled && !remaining.some(user => user.role === 'admin')) throw fail(400, 'At least one administrator is required.'); metadata.config.auth.users = remaining; await persist(); return json(res, { deleted: true }); }
      if (endpoint === '/api/auth/config' && method === 'PUT') { if (currentUser.role !== 'admin') throw fail(403, 'Administrator access is required.'); const body = await jsonBody(req), enabled = body.enabled === true; if (enabled && !metadata.config.auth.users.some(user => user.role === 'admin')) throw fail(400, 'Create an administrator account before enabling sign-in.'); metadata.config.auth.enabled = enabled; metadata.config.auth.proxyHeader = String(body.proxyHeader || '').toLowerCase().replace(/[^a-z0-9-]/g, ''); await persist(); return json(res, { enabled, proxyHeader: metadata.config.auth.proxyHeader }); }
      if (endpoint === '/api/open-link' && method === 'POST') {
        const body = await jsonBody(req); const file = await resolveFile(body.path); if (!types.has(path.extname(file).toLowerCase())) throw fail(415, 'Unsupported file type.');
        const token = randomBytes(24).toString('base64url'); openTokens.set(token, { path: body.path, expires: Date.now() + 120000 });
        return json(res, { url: `/api/open-file/${token}/${encodeURIComponent(path.basename(body.path))}`, expiresIn: 120 });
      }
      if (method === 'GET' && endpoint.startsWith('/api/open-file/')) {
        const token = endpoint.split('/')[3], grant = openTokens.get(token); if (!grant || grant.expires < Date.now()) { openTokens.delete(token); throw fail(404, 'This open link has expired.'); }
        openTokens.delete(token); const file = await resolveFile(grant.path); return stream(res, storagePath(file), path.basename(file), storage);
      }
      if (method === 'GET' && endpoint.startsWith('/api/thumbnail/')) {
        const id = endpoint.slice('/api/thumbnail/'.length); if (!/^[a-f0-9]{32}$/.test(id)) throw fail(404, 'Thumbnail not found.');
        const filename = path.join(dataDir, 'thumbnails', id); const image = await fs.readFile(filename); const contentType = image[0] === 0xff && image[1] === 0xd8 ? 'image/jpeg' : image.subarray(0, 4).toString() === 'RIFF' && image.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : 'image/png'; res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'private, max-age=86400' }); return res.end(image);
      }
      if (method === 'GET' && endpoint.startsWith('/api/print-photo/')) {
        const id = endpoint.slice('/api/print-photo/'.length); if (!/^[a-f0-9]{32}$/.test(id)) throw fail(404, 'Print photo not found.');
        const filename = path.join(dataDir, 'print-photos', id), image = await fs.readFile(filename); const contentType = image[0] === 0xff && image[1] === 0xd8 ? 'image/jpeg' : image.subarray(0, 4).toString() === 'RIFF' && image.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : 'image/png'; res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'private, max-age=86400' }); return res.end(image);
      }
      if (endpoint === '/api/library' && method === 'GET') return json(res, { version: appVersion, user: metadata.config.auth.enabled ? { username: currentUser.username, role: currentUser.role } : null, files: files.map(file => { const item = metadata.items[metaKey(file.path)] || {}; return { ...file, ...item, thumbnail: item.customCover ? `/api/thumbnail/${item.customCover}` : file.thumbnail }; }), projects: Object.entries(metadata.projects).map(([id, project]) => ({ id, ...project })).sort((a, b) => a.name.localeCompare(b.name)), folders, hiddenLibraryFolders, writable: writable && currentUser.role !== 'viewer', scannedAt, error: scanError, scanning: !!scanning, scan: { ...scanControl }, config: { ...metadata.config, auth: { enabled: metadata.config.auth.enabled }, smb: metadata.config.smb ? { host: metadata.config.smb.host, share: metadata.config.smb.share, folder: metadata.config.smb.folder } : null } });
      if (endpoint === '/api/settings' && method === 'GET') return json(res, { ...metadata.config, auth: { enabled: metadata.config.auth.enabled, proxyHeader: metadata.config.auth.proxyHeader, users: metadata.config.auth.users.map(({ passwordHash, ...user }) => user) }, version: appVersion, collections: effectiveCollections(), smb: metadata.config.smb ? { ...metadata.config.smb, password: undefined, hasPassword: !!metadata.config.smb.password } : null, folders, writable, libraryPath: storageLabel(), limits: { previewMb: maxBytes / 1048576, sourceMb: 2, renderSeconds: Number(process.env.RENDER_TIMEOUT_SECONDS || 120) } });
      if (endpoint === '/api/history' && method === 'GET') return json(res, { history: metadata.history.slice(0, 250) });
      if (endpoint === '/api/recycle' && method === 'GET') { if (await pruneRecycle()) await persist(); return json(res, { items: Object.values(metadata.recycle).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)), retention: metadata.config.recycleRetention }); }
      if (endpoint === '/api/recycle/restore' && method === 'POST') {
        requireWrite(); const body = await jsonBody(req), item = metadata.recycle[String(body.id || '')]; if (!item) throw fail(404, 'Recycle-bin item not found.'); const target = await resolveFile(item.path, { parent: true }); const targetKey = metadata.config.smb ? item.path : storagePath(target); if (await storage.exists(targetKey)) throw fail(409, 'A file already exists at the original location. Move or rename it before restoring this copy.');
        await storage.writeFile(targetKey, await fs.readFile(path.join(dataDir, 'recycle', item.id))); await fs.rm(path.join(dataDir, 'recycle', item.id), { force: true }); if (item.metadata) metadata.items[metaKey(item.path)] = item.metadata; delete metadata.recycle[item.id]; addHistory('restored', item.path, currentUser); await persist(); scan().catch(error => console.error('Restore scan failed:', error)); return json(res, { restored: true, path: item.path });
      }
      if (endpoint === '/api/recycle' && method === 'DELETE') { const body = await jsonBody(req), item = metadata.recycle[String(body.id || '')]; if (!item) throw fail(404, 'Recycle-bin item not found.'); await fs.rm(path.join(dataDir, 'recycle', item.id), { force: true }); delete metadata.recycle[item.id]; addHistory('permanently deleted', item.path, currentUser); await persist(); return json(res, { deleted: true }); }
      if (endpoint === '/api/network/servers' && method === 'GET') return json(res, { servers: await findServers(metadata.config.smb?.host ? [metadata.config.smb.host] : []) });
      if (endpoint === '/api/network/shares' && method === 'POST') {
        const body = await jsonBody(req);
        if (String(body.share || '').trim()) {
          const candidate = makeSmb(body); await candidate.readdir('');
          return json(res, { shares: [{ name: String(body.share).trim(), description: 'Connection verified' }] });
        }
        return json(res, { shares: await findShares(body) });
      }
      if (endpoint === '/api/network/folders' && method === 'POST') {
        const body = await jsonBody(req), candidate = makeSmb(body);
        const entries = await candidate.readdir(''), parent = String(body.folder || '').replace(/^\/+|\/+$/g, '');
        return json(res, { current: parent, folders: entries.filter(x => x.type === 'dir').map(x => [parent, x.name].filter(Boolean).join('/')).sort() });
      }
      if (endpoint === '/api/network/connect' && method === 'POST') {
        const body = await jsonBody(req), config = { host: String(body.host || '').trim(), share: String(body.share || '').trim(), folder: String(body.folder || '').replace(/^\/+|\/+$/g, ''), username: String(body.username || ''), domain: String(body.domain || ''), password: String(body.password || '') };
        const selected = makeSmb(config); await selected.readdir('');
        const rootConfig = { ...config, folder: '' }, candidate = makeSmb(rootConfig);
        const sameShare = metadata.config.smb && metadata.config.smb.host === config.host && metadata.config.smb.share === config.share;
        const scanFolders = !config.folder ? [] : sameShare && metadata.config.scanFolders.length ? [...new Set([...metadata.config.scanFolders, config.folder])] : [config.folder];
        const stored = { ...rootConfig, password: protect(config.password) };
        await exclusive(async () => { metadata.config.smb = stored; metadata.config.scanFolders = scanFolders; await persist(); }); storage = candidate;
        const indexing = scan();
        if (options.smbFactory) await indexing;
        else indexing.catch(error => console.error('SMB indexing failed:', error));
        return json(res, { connected: true, indexing: true, label: candidate.label(), scanFolders });
      }
      if (endpoint === '/api/network/disconnect' && method === 'POST') {
        await exclusive(async () => { metadata.config.smb = null; metadata.config.scanFolders = []; await persist(); }); storage = new LocalStorage(root); await scan(); return json(res, { connected: false });
      }
      if (endpoint === '/api/settings' && method === 'PUT') {
        const body = await jsonBody(req);
        const collections = Array.isArray(body.collections) ? [...new Set(body.collections.map(String).map(x => x.trim()).filter(Boolean))].slice(0, 200) : [];
        if (collections.some(x => x.length > 100)) throw fail(400, 'Collection names must be 100 characters or fewer.');
        const scanFolders = Array.isArray(body.scanFolders) ? [...new Set(body.scanFolders.map(String).map(x => x.trim()).filter(Boolean))].slice(0, 100) : [];
        const scanFoldersChanged = JSON.stringify(scanFolders) !== JSON.stringify(metadata.config.scanFolders);
        if (scanFoldersChanged) for (const folder of scanFolders) { const dir = await resolveFile(folder, { directory: true }); if (!(await storage.stat(metadata.config.smb ? dir : slash(path.relative(root, dir)))).isDirectory) throw fail(400, `${folder} is not a folder.`); }
        const defaultSort = ['modified', 'name', 'size'].includes(body.defaultSort) ? body.defaultSort : 'modified';
        const scanInterval = Number(body.scanInterval);
        if (!Number.isInteger(scanInterval) || scanInterval < 30 || scanInterval > 86400) throw fail(400, 'Automatic scan interval must be between 30 seconds and 24 hours.');
        await exclusive(async () => {
          metadata.config = { collections, scanFolders, defaultSort, scanInterval, smb: metadata.config.smb, backupInterval: [0, 24, 168].includes(Number(body.backupInterval)) ? Number(body.backupInterval) : metadata.config.backupInterval, backupRetention: Math.max(1, Math.min(30, Number(body.backupRetention) || metadata.config.backupRetention)), auth: metadata.config.auth, recycleRetention: Math.max(1, Math.min(365, Number(body.recycleRetention) || metadata.config.recycleRetention)) };
          for (const item of Object.values(metadata.items)) if (item.collection && !collections.includes(item.collection)) item.collection = '';
          await persist();
        });
        scheduleScan(); scheduleBackups();
        if (scanFoldersChanged) scan().catch(error => console.error('Settings-triggered scan failed:', error));
        return json(res, { ...metadata.config, indexing: scanFoldersChanged });
      }
      if (endpoint === '/api/backup/export' && method === 'POST') {
        const body = await jsonBody(req), password = String(body.password || ''), copy = structuredClone(metadata); let payload;
        if (password) { if (copy.config.smb?.password) copy.config.smb.password = reveal(copy.config.smb.password); const salt = randomBytes(16), iv = randomBytes(12), key = scryptSync(password, salt, 32), cipher = createCipheriv('aes-256-gcm', key, iv), encrypted = Buffer.concat([cipher.update(JSON.stringify({ format: 1, version: appVersion, exportedAt: new Date().toISOString(), metadata: copy })), cipher.final()]); payload = { format: 1, encrypted: true, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') }; }
        else { if (copy.config.smb) copy.config.smb.password = ''; payload = { format: 1, encrypted: false, credentialsOmitted: true, version: appVersion, exportedAt: new Date().toISOString(), metadata: copy }; }
        const data = Buffer.from(zipSync(await makeBackupZip(payload, metadata), { level: 6 })); res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': data.length, 'Content-Disposition': `attachment; filename="3d-model-manager-backup-${new Date().toISOString().slice(0, 10)}.zip"` }); return res.end(data);
      }
      if (endpoint === '/api/backups' && method === 'GET') {
        const names = (await fs.readdir(path.join(dataDir, 'backups'))).filter(name => /^scheduled-[\w.-]+\.json$/.test(name)).sort().reverse(), backups = await Promise.all(names.map(async name => { const stat = await fs.stat(path.join(dataDir, 'backups', name)); return { name, size: stat.size, created: stat.mtime.toISOString() }; })); return json(res, { backups });
      }
      if (method === 'GET' && endpoint.startsWith('/api/backups/')) {
        const name = decodeURIComponent(endpoint.slice('/api/backups/'.length)); if (!/^scheduled-[\w.-]+\.json$/.test(name)) throw fail(404, 'Backup not found.'); const saved = JSON.parse(await fs.readFile(path.join(dataDir, 'backups', name), 'utf8')), copy = structuredClone(saved); if (copy.metadata?.config?.smb) copy.metadata.config.smb.password = ''; copy.credentialsOmitted = true; const data = Buffer.from(zipSync(await makeBackupZip(copy, saved.metadata), { level: 6 })); res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': data.length, 'Content-Disposition': `attachment; filename="${name.replace(/\.json$/, '.zip')}"` }); return res.end(data);
      }
      if (endpoint === '/api/backups-download' && method === 'POST') {
        const names = (await fs.readdir(path.join(dataDir, 'backups'))).filter(name => /^scheduled-[\w.-]+\.json$/.test(name)).sort().reverse(); if (!names.length) throw fail(404, 'No automatic backups are available yet.'); const entries = {}; for (const name of names) { const saved = JSON.parse(await fs.readFile(path.join(dataDir, 'backups', name), 'utf8')); if (saved.metadata?.config?.smb) saved.metadata.config.smb.password = ''; saved.credentialsOmitted = true; entries[name.replace(/\.json$/, '.zip')] = zipSync(await makeBackupZip(saved, saved.metadata), { level: 6 }); } const archive = Buffer.from(zipSync(entries, { level: 6 })); res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': archive.length, 'Content-Disposition': 'attachment; filename="3d-model-manager-automatic-backups.zip"' }); return res.end(archive);
      }
      if (endpoint === '/api/backup/restore' && method === 'POST') {
        let envelope, archive = null, password = ''; if ((req.headers['content-type'] || '').includes('application/zip')) { archive = unzipSync(new Uint8Array(await binaryBody(req, 250 * 1024 * 1024, 'Backup packages must be 250 MB or smaller.'))); if (!archive['backup.json']) throw fail(400, 'The backup package has no backup.json file.'); envelope = JSON.parse(strFromU8(archive['backup.json'])); password = String(req.headers['x-backup-password'] || ''); } else { const body = await jsonBody(req, 25 * 1024 * 1024); envelope = body.backup; password = String(body.password || ''); } let restored;
        try { if (envelope?.encrypted) { const key = scryptSync(password, Buffer.from(envelope.salt, 'base64'), 32), decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64')); decipher.setAuthTag(Buffer.from(envelope.tag, 'base64')); restored = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString()).metadata; } else restored = envelope?.metadata; } catch { throw fail(400, 'The backup password is incorrect or the file is damaged.'); }
        if (!restored?.items || !restored?.config) throw fail(400, 'This is not a valid 3D Model Manager backup.'); await fs.copyFile(metaPath, path.join(dataDir, 'backups', `before-restore-${Date.now()}.json`)).catch(() => {});
        if (archive) for (const [name, data] of Object.entries(archive)) { const match = name.match(/^(thumbnails|print-photos)\/([a-f0-9]{32})$|^(recycle)\/([a-f0-9-]{36})$/); if (match) await fs.writeFile(path.join(dataDir, match[1] || match[3], match[2] || match[4]), data); }
        if (restored.config.smb?.password) restored.config.smb.password = protect(restored.config.smb.password); metadata = restored; metadata.projects ||= {}; metadata.extracted ||= {}; metadata.hashes ||= {}; metadata.thumbnails ||= {}; metadata.config.auth = normalizeAuth(metadata.config.auth); metadata.config.recycleRetention = Math.max(1, Math.min(365, Number(metadata.config.recycleRetention) || 30)); metadata.history ||= []; metadata.recycle ||= {}; await persist(); storage = metadata.config.smb ? makeSmb({ ...metadata.config.smb, password: reveal(metadata.config.smb.password) }) : new LocalStorage(root); scheduleScan(); await scan(); return json(res, { restored: true });
      }
      if (endpoint === '/api/scan' && method === 'POST') { await scan(); return json(res, { count: files.length, error: scanError }); }
      if (endpoint === '/api/scan/start' && method === 'POST') { scan().catch(error => console.error('Manual scan failed:', error)); return json(res, { started: true }, 202); }
      if (endpoint === '/api/scan/pause' && method === 'POST') { if (scanning) scanControl.paused = !scanControl.paused; return json(res, { ...scanControl }); }
      if (endpoint === '/api/scan/cancel' && method === 'POST') { if (scanning) scanControl.cancel = true; return json(res, { ...scanControl }); }
      if (endpoint === '/api/meta' && method === 'PUT') {
        const body = await jsonBody(req); await resolveFile(body.path);
        const existing = metadata.items[metaKey(body.path)] || {};
        const projectId = String(body.projectId || ''), role = String(body.role || ''), sourcePath = String(body.sourcePath || '');
        if (projectId && !metadata.projects[projectId]) throw fail(400, 'Choose an existing project.');
        if (role && !['part', 'alternate', 'source', 'export', 'assembly', 'support'].includes(role)) throw fail(400, 'Choose a valid file role.');
        if (sourcePath) { const source = await resolveFile(sourcePath); if (path.extname(source).toLowerCase() !== '.scad') throw fail(400, 'The related source must be an OpenSCAD file.'); }
        const item = { ...existing, tags: Array.isArray(body.tags) ? [...new Set(body.tags.map(String).map(x => x.trim().slice(0, 60)).filter(Boolean))].slice(0, 30) : [], notes: String(body.notes || '').slice(0, 20000), favorite: !!body.favorite, collection: String(body.collection || '').trim().slice(0, 100), projectId, role, sourcePath };
        await exclusive(async () => {
          metadata.items[metaKey(body.path)] = item;
          if (item.collection && !metadata.config.collections.includes(item.collection)) metadata.config.collections.push(item.collection);
          addHistory('updated details', body.path, currentUser);
          await persist();
        }); return json(res, item);
      }
      if (endpoint === '/api/prints' && method === 'POST') {
        const body = await jsonBody(req); await resolveFile(body.path); const number = (value, min, max) => { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null; };
        const result = ['success', 'failed', 'partial', 'test'].includes(body.result) ? body.result : 'success', date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || '')) ? body.date : new Date().toISOString().slice(0, 10);
        const record = { id: randomUUID(), date, result, printer: String(body.printer || '').trim().slice(0, 120), filament: String(body.filament || '').trim().slice(0, 120), color: String(body.color || '').trim().slice(0, 80), nozzle: number(body.nozzle, 0.05, 5), layerHeight: number(body.layerHeight, 0.01, 5), quantity: Math.round(number(body.quantity, 1, 10000) || 1), notes: String(body.notes || '').trim().slice(0, 10000), created: new Date().toISOString() };
        await exclusive(async () => { const key = metaKey(body.path), item = metadata.items[key] || { tags: [], notes: '', favorite: false, collection: '' }; item.prints ||= []; item.prints.unshift(record); metadata.items[key] = item; await persist(); }); return json(res, record, 201);
      }
      if (endpoint === '/api/prints' && method === 'DELETE') {
        const rel = url.searchParams.get('path'), id = String(url.searchParams.get('id') || ''); await resolveFile(rel); let photo = '';
        await exclusive(async () => { const item = metadata.items[metaKey(rel)], record = item?.prints?.find(entry => entry.id === id); if (!record) throw fail(404, 'Print record not found.'); photo = record.photo || ''; item.prints = item.prints.filter(entry => entry.id !== id); await persist(); });
        if (photo) await fs.rm(path.join(dataDir, 'print-photos', photo), { force: true }); return json(res, { deleted: true });
      }
      if (endpoint === '/api/print-photo' && method === 'PUT') {
        const rel = url.searchParams.get('path'), printId = String(url.searchParams.get('id') || ''); await resolveFile(rel); if (!metadata.items[metaKey(rel)]?.prints?.some(entry => entry.id === printId)) throw fail(404, 'Print record not found.'); const image = await binaryBody(req, 15 * 1024 * 1024, 'Print photos must be 15 MB or smaller.');
        const png = image.length >= 8 && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), jpeg = image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff, webp = image.length >= 12 && image.subarray(0, 4).toString() === 'RIFF' && image.subarray(8, 12).toString() === 'WEBP'; if (!png && !jpeg && !webp) throw fail(415, 'Choose a PNG, JPEG, or WebP photo.');
        const photo = hash(Buffer.concat([Buffer.from(printId), image])).slice(0, 32); await fs.writeFile(path.join(dataDir, 'print-photos', photo), image);
        await exclusive(async () => { const item = metadata.items[metaKey(rel)], record = item?.prints?.find(entry => entry.id === printId); if (!record) throw fail(404, 'Print record not found.'); record.photo = photo; await persist(); }); return json(res, { photo: `/api/print-photo/${photo}` });
      }
      if (endpoint === '/api/dependencies' && method === 'POST') { const body = await jsonBody(req), file = await resolveFile(body.path); if (path.extname(file).toLowerCase() !== '.scad') throw fail(415, 'Choose an OpenSCAD file.'); return json(res, await inspectDependencies(body.path, typeof body.source === 'string' ? body.source : undefined)); }
      if (endpoint === '/api/presets' && method === 'PUT') {
        const body = await jsonBody(req); await resolveFile(body.path); const name = String(body.name || '').trim().slice(0, 80), values = body.values && typeof body.values === 'object' && !Array.isArray(body.values) ? body.values : null; if (!name || !values) throw fail(400, 'Enter a preset name and parameter values.');
        const clean = Object.fromEntries(Object.entries(values).slice(0, 200).map(([key, value]) => [String(key).slice(0, 100), typeof value === 'string' ? value.slice(0, 1000) : value])); await exclusive(async () => { const key = metaKey(body.path), item = metadata.items[key] || { tags: [], notes: '', favorite: false, collection: '' }; item.presets ||= {}; item.presets[name] = clean; metadata.items[key] = item; await persist(); }); return json(res, { name, values: clean });
      }
      if (endpoint === '/api/presets' && method === 'DELETE') { const body = await jsonBody(req); await resolveFile(body.path); await exclusive(async () => { const item = metadata.items[metaKey(body.path)]; if (item?.presets) { delete item.presets[String(body.name || '')]; await persist(); } }); return json(res, { deleted: true }); }
      if (endpoint === '/api/projects' && method === 'POST') {
        const body = await jsonBody(req), name = String(body.name || '').trim().slice(0, 120), selected = Array.isArray(body.paths) ? [...new Set(body.paths.map(String))].slice(0, 500) : [];
        if (!name) throw fail(400, 'Enter a project name.'); if (!selected.length) throw fail(400, 'Select at least one model.');
        for (const rel of selected) if (!files.some(file => file.path === rel)) throw fail(404, `Model not found: ${rel}`);
        const existing = Object.entries(metadata.projects).find(([, project]) => project.name.toLowerCase() === name.toLowerCase()), id = existing?.[0] || randomUUID();
        await exclusive(async () => { metadata.projects[id] ||= { name, created: new Date().toISOString() }; for (const rel of selected) { const key = metaKey(rel), item = metadata.items[key] || { tags: [], notes: '', favorite: false, collection: '' }; item.projectId = id; item.role ||= path.extname(rel).toLowerCase() === '.scad' ? 'source' : path.extname(rel).toLowerCase() === '.3mf' ? 'assembly' : 'part'; metadata.items[key] = item; } await persist(); });
        return json(res, { id, ...metadata.projects[id], updated: selected.length }, existing ? 200 : 201);
      }
      if (endpoint === '/api/cover' && method === 'PUT') {
        const rel = url.searchParams.get('path'); await resolveFile(rel);
        const image = await binaryBody(req, 10 * 1024 * 1024, 'Cover images must be 10 MB or smaller.');
        const png = image.length >= 8 && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        const jpeg = image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
        const webp = image.length >= 12 && image.subarray(0, 4).toString() === 'RIFF' && image.subarray(8, 12).toString() === 'WEBP';
        if (!png && !jpeg && !webp) throw fail(415, 'Choose a PNG, JPEG, or WebP image.');
        const id = hash(image).slice(0, 32); await fs.writeFile(path.join(dataDir, 'thumbnails', id), image);
        await exclusive(async () => { const key = metaKey(rel), item = metadata.items[key] || { tags: [], notes: '', favorite: false, collection: '' }; item.customCover = id; metadata.items[key] = item; await persist(); });
        return json(res, { thumbnail: `/api/thumbnail/${id}`, custom: true });
      }
      if (endpoint === '/api/cover' && method === 'DELETE') {
        const rel = url.searchParams.get('path'); await resolveFile(rel);
        await exclusive(async () => { const item = metadata.items[metaKey(rel)]; if (item) { delete item.customCover; await persist(); } });
        const file = files.find(candidate => candidate.path === rel); return json(res, { thumbnail: file?.thumbnail || '', custom: false });
      }
      if (endpoint === '/api/bulk' && method === 'POST') {
        const body = await jsonBody(req), selected = Array.isArray(body.paths) ? [...new Set(body.paths.map(String))].slice(0, 500) : [];
        if (!selected.length) throw fail(400, 'Select at least one model.');
        for (const rel of selected) { relative(rel); if (!files.some(file => file.path === rel)) throw fail(404, `Model not found: ${rel}`); }
        if (body.action === 'delete') {
          await stopActiveScan();
          requireWrite(); for (const rel of selected) await recycleFile(rel, currentUser);
          files = files.filter(file => !selected.includes(file.path)); refreshDuplicateGroups(); await Promise.all([persist(), persistCatalog()]); return json(res, { updated: selected.length });
        }
        if (body.action === 'move') {
          requireWrite(); const folder = relative(String(body.folder || ''), true); await resolveFile(folder, { directory: true });
          const moves = selected.map(rel => ({ from: rel, to: [folder, path.posix.basename(rel)].filter(Boolean).join('/') }));
          for (const move of moves) if (await storage.exists(move.to)) throw fail(409, `${move.to} already exists.`);
          for (const move of moves) { await storage.rename(move.from, move.to); for (const bucket of [metadata.items, metadata.hashes, metadata.thumbnails]) { const before = metaKey(move.from), after = metaKey(move.to); if (bucket[before]) { bucket[after] = bucket[before]; delete bucket[before]; } } for (const item of Object.values(metadata.items)) if (item.sourcePath === move.from) item.sourcePath = move.to; addHistory('moved', move.from, currentUser, { target: move.to }); }
          await persist(); await scan(); return json(res, { updated: moves.length });
        }
        if (!['collection', 'tags'].includes(body.action)) throw fail(400, 'Choose a supported bulk action.');
        const collection = String(body.collection || '').trim().slice(0, 100), addedTags = Array.isArray(body.tags) ? [...new Set(body.tags.map(String).map(tag => tag.trim().slice(0, 60)).filter(Boolean))].slice(0, 30) : [];
        await exclusive(async () => {
          for (const rel of selected) { const key = metaKey(rel), item = metadata.items[key] || { tags: [], notes: '', favorite: false, collection: '' }; if (body.action === 'collection') item.collection = collection; else item.tags = [...new Set([...(item.tags || []), ...addedTags])].slice(0, 30); metadata.items[key] = item; }
          if (collection && !metadata.config.collections.includes(collection)) metadata.config.collections.push(collection); await persist();
        }); return json(res, { updated: selected.length });
      }
      if (endpoint === '/api/bulk-download' && method === 'POST') {
        const body = await jsonBody(req), selected = Array.isArray(body.paths) ? [...new Set(body.paths.map(String))].slice(0, 200) : []; if (!selected.length) throw fail(400, 'Select at least one model.');
        const entries = {}, limit = 512 * 1024 * 1024; let total = 0;
        for (const rel of selected) { const file = await resolveFile(rel), stat = await storage.stat(storagePath(file)); total += stat.size; if (total > limit) throw fail(413, 'Selected files exceed the 512 MB archive limit. Download fewer files at a time.'); entries[rel] = new Uint8Array(await storage.readFile(storagePath(file))); }
        const archive = Buffer.from(zipSync(entries, { level: 0 })); res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': archive.length, 'Content-Disposition': `attachment; filename="3d-model-manager-${new Date().toISOString().slice(0, 10)}.zip"`, 'Cache-Control': 'no-store' }); return res.end(archive);
      }
      if (endpoint === '/api/file' && method === 'DELETE') {
        await stopActiveScan();
        requireWrite(); const rel = url.searchParams.get('path');
        await exclusive(async () => {
          await recycleFile(rel, currentUser); await persist();
        });
        files = files.filter(file => file.path !== rel); refreshDuplicateGroups(); await persistCatalog(); return json(res, { path: rel, deleted: true });
      }
      if (endpoint === '/api/file' && method === 'GET') {
        const file = await resolveFile(url.searchParams.get('path'));
        if (!types.has(path.extname(file).toLowerCase())) throw fail(415, 'Unsupported file type.');
        if ((await storage.stat(storagePath(file))).size > maxBytes) throw fail(413, `File exceeds the ${maxBytes / 1048576} MB preview limit.`);
        return await stream(res, storagePath(file), url.searchParams.has('download') ? path.basename(file) : null, storage);
      }
      if (endpoint === '/api/convert' && method === 'POST') {
        requireWrite(); const body = await jsonBody(req), rel = relative(String(body.path || '')), targetRel = relative(String(body.target || '')), sourceFile = await resolveFile(rel), target = await resolveFile(targetRel, { parent: true });
        if (path.extname(sourceFile).toLowerCase() !== '.stl' || path.extname(targetRel).toLowerCase() !== '.3mf') throw fail(400, 'Choose an STL source and a 3MF destination.');
        if (await destinationExists(metadata.config.smb ? targetRel : storagePath(target))) throw fail(409, 'That 3MF file already exists. Choose another name.');
        const dir = await fs.mkdtemp(path.join(dataDir, 'renders', 'convert-')), input = path.join(dir, 'model.stl'), scad = path.join(dir, 'convert.scad'), output = path.join(dir, 'model.3mf');
        try {
          await fs.writeFile(input, await storage.readFile(storagePath(sourceFile))); await fs.writeFile(scad, 'import("model.stl");');
          const log = await new Promise((resolve, reject) => { let outputText = ''; const child = spawn(compiler, ['-o', output, scad], { cwd: dir, windowsHide: true, env: { ...process.env, QT_QPA_PLATFORM: 'offscreen' }, stdio: ['ignore', 'pipe', 'pipe'] }), timer = setTimeout(() => { child.kill('SIGKILL'); reject(fail(504, 'STL conversion timed out.')); }, Number(process.env.RENDER_TIMEOUT_SECONDS || 120) * 1000); child.stdout.on('data', chunk => outputText += chunk); child.stderr.on('data', chunk => outputText += chunk); child.once('error', reject); child.once('close', code => { clearTimeout(timer); code === 0 ? resolve(outputText) : reject(fail(422, `OpenSCAD could not convert this STL.${outputText ? ` ${outputText.slice(-500)}` : ''}`)); }); });
          const source = files.find(file => file.path === rel) || {}, item = metadata.items[metaKey(rel)] || {}, project = source.projectInfo || {}, description = [...new Set([project.description, project.printingNotes ? `Printing notes:\n${project.printingNotes}` : '', item.notes, project.sourceUrl ? `Source: ${project.sourceUrl}` : ''].filter(Boolean))].join('\n\n');
          const converted = add3mfMetadata(await fs.readFile(output), { Title: project.title || path.posix.basename(rel, path.posix.extname(rel)), Designer: project.attribution || '', Description: description, LicenseTerms: project.license || '', Application: '3D Model Manager' }); inspect3mf(converted);
          await storage.writeFile(metadata.config.smb ? targetRel : storagePath(target), converted); const written = await storage.stat(metadata.config.smb ? targetRel : storagePath(target)); if (!written.size) throw fail(500, 'The converted 3MF could not be verified. The original STL was kept.');
          if (body.deleteOriginal) await recycleFile(rel, currentUser);
          await exclusive(async () => { const linked = { ...item, role: item.projectId ? 'alternate' : item.role || '', convertedFrom: body.deleteOriginal ? '' : rel }; delete linked.presets; metadata.items[metaKey(targetRel)] = linked; if (body.deleteOriginal) { delete metadata.items[metaKey(rel)]; delete metadata.hashes[metaKey(rel)]; delete metadata.thumbnails[metaKey(rel)]; for (const other of Object.values(metadata.items)) if (other.convertedFrom === rel) other.convertedFrom = ''; } addHistory('converted to 3MF', rel, currentUser, { target: targetRel }); await persist(); }); await scan(); return json(res, { path: targetRel, bytes: converted.length, originalDeleted: !!body.deleteOriginal, log }, 201);
        } finally { await fs.rm(dir, { recursive: true, force: true }); }
      }
      if (endpoint === '/api/source' && method === 'GET') {
        const file = await resolveFile(url.searchParams.get('path'));
        if (path.extname(file).toLowerCase() !== '.scad') throw fail(415, 'Choose an OpenSCAD file.');
        if ((await storage.stat(storagePath(file))).size > 2 * 1048576) throw fail(413, 'Source exceeds the 2 MB editor limit.');
        const source = (await storage.readFile(storagePath(file))).toString('utf8'); return json(res, { source, revision: hash(source) });
      }
      if (endpoint === '/api/source' && method === 'PUT') {
        requireWrite(); const body = await jsonBody(req);
        await exclusive(async () => {
          const file = await resolveFile(body.path);
          if (path.extname(file).toLowerCase() !== '.scad' || typeof body.source !== 'string') throw fail(400, 'Invalid OpenSCAD source.');
          const existing = (await storage.readFile(storagePath(file))).toString('utf8');
          if (hash(existing) !== body.revision) throw fail(409, 'This file changed outside the app. Download your draft, then reopen the file before saving.');
          await backup(file, body.path);
          await storage.writeFile(storagePath(file), body.source);
          addHistory('edited source', body.path, currentUser); await persist();
        });
        await scan(); return json(res, { revision: hash(body.source) });
      }
      if (endpoint === '/api/folder' && method === 'POST') {
        requireWrite(); const body = await jsonBody(req); const dir = await resolveFile(body.path, { parent: true });
        await storage.mkdir(metadata.config.smb ? body.path : storagePath(dir)); await scan(); return json(res, { path: body.path }, 201);
      }
      if (endpoint === '/api/move' && method === 'POST') {
        requireWrite(); const body = await jsonBody(req);
        await exclusive(async () => {
          const source = await resolveFile(body.path), target = await resolveFile(body.target, { parent: true });
          if (!types.has(path.extname(source).toLowerCase()) || path.extname(source).toLowerCase() !== path.extname(target).toLowerCase()) throw fail(400, 'Keep the original file extension.');
          if (source === target) throw fail(400, 'Choose a different name or folder.');
          // Exclusive copy avoids overwriting a destination on SMB filesystems.
          const sourceKey = storagePath(source), targetKey = storagePath(target);
          if (await storage.exists(targetKey)) throw fail(409, 'That name already exists. Choose another name.');
          await storage.rename(sourceKey, targetKey);
          if (metadata.items[metaKey(body.path)]) { metadata.items[metaKey(body.target)] = metadata.items[metaKey(body.path)]; delete metadata.items[metaKey(body.path)]; }
          for (const item of Object.values(metadata.items)) if (item.sourcePath === body.path) item.sourcePath = body.target;
          addHistory('moved', body.path, currentUser, { target: body.target });
          await persist();
        });
        await scan(); return json(res, { path: body.target });
      }
      if (endpoint === '/api/upload' && method === 'POST') {
        requireWrite(); const rel = url.searchParams.get('path'); const target = await resolveFile(rel, { parent: true });
        if (!types.has(path.extname(target).toLowerCase())) throw fail(415, 'Import STL, 3MF, or SCAD files.');
        if (await storage.exists(metadata.config.smb ? rel : storagePath(target))) throw fail(409, 'That name already exists. Choose another name.');
        if (metadata.config.smb) {
          const chunks = []; let size = 0;
          for await (const chunk of req) { size += chunk.length; if (size > maxBytes) throw fail(413, 'File is too large.'); chunks.push(chunk); }
          await storage.writeFile(rel, Buffer.concat(chunks)); await scan(); return json(res, { path: rel }, 201);
        }
        const temp = path.join(path.dirname(target), `.3d-model-manager-${randomUUID()}.tmp`);
        let size = 0;
        const limit = new Transform({ transform(chunk, enc, cb) { size += chunk.length; cb(size > maxBytes ? fail(413, 'File is too large.') : null, chunk); } });
        try { await pipeline(req, limit, createWriteStream(temp, { flags: 'wx' })); await fs.copyFile(temp, target, 1); }
        finally { await fs.rm(temp, { force: true }).catch(() => {}); }
        await scan(); return json(res, { path: rel }, 201);
      }
      if (endpoint === '/api/render' && method === 'POST') return json(res, await exclusive(() => jsonBody(req).then(startRender)), 202);
      if (endpoint.startsWith('/api/render/')) {
        const id = endpoint.split('/')[3]; const job = jobs.get(id);
        if (!job) throw fail(404, 'Render expired. Render the source again.');
        if (method === 'DELETE') { job.cancelled = true; job.child?.kill('SIGKILL'); return json(res, { status: 'cancelled' }); }
        if (method === 'POST' && endpoint.endsWith('/save')) {
          requireWrite(); if (job.status !== 'done') throw fail(409, 'Render is not ready.'); const body = await jsonBody(req), targetRel = relative(String(body.target || '')); if (path.extname(targetRel).toLowerCase() !== '.stl') throw fail(400, 'Use an STL filename.');
          const target = await resolveFile(targetRel, { parent: true }); if (await storage.exists(metadata.config.smb ? targetRel : storagePath(target))) throw fail(409, 'That STL already exists. Choose another name.');
          await storage.writeFile(metadata.config.smb ? targetRel : storagePath(target), await fs.readFile(job.output));
          await exclusive(async () => { const sourceItem = metadata.items[metaKey(job.sourcePath)] || { tags: [], notes: '', favorite: false, collection: '' }; let projectId = sourceItem.projectId; if (!projectId) { projectId = randomUUID(); metadata.projects[projectId] = { name: path.posix.basename(job.sourcePath, '.scad'), created: new Date().toISOString() }; sourceItem.projectId = projectId; sourceItem.role = 'source'; metadata.items[metaKey(job.sourcePath)] = sourceItem; } metadata.items[metaKey(targetRel)] = { tags: [], notes: '', favorite: false, collection: sourceItem.collection || '', projectId, role: 'export', sourcePath: job.sourcePath }; await persist(); });
          await scan(); return json(res, { path: targetRel, projectId: metadata.items[metaKey(targetRel)].projectId }, 201);
        }
        if (method === 'GET' && endpoint.endsWith('/file')) { if (job.status !== 'done') throw fail(409, 'Render is not ready.'); return await stream(res, job.output, url.searchParams.has('download') ? job.name : null); }
        if (method === 'GET') return json(res, { id, status: job.status, log: job.log });
      }
      if (endpoint.startsWith('/api/')) throw fail(404, 'Unknown request.');
      const staticFiles = { '/': ['index.html', 'text/html'], '/file-open.js': ['file-open.js', 'text/javascript'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
      if (!staticFiles[endpoint] || !['GET', 'HEAD'].includes(method)) throw fail(404, 'Page not found.');
      const [name, mime] = staticFiles[endpoint]; const content = await fs.readFile(path.join(here, 'public', name));
      res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8`, 'Cache-Control': 'no-cache' }); res.end(method === 'HEAD' ? undefined : content);
    } catch (e) {
      if (res.headersSent || res.destroyed) { res.destroy(); return; }
      const status = e.status || (e.code === 'EEXIST' ? 409 : e.code === 'EACCES' || e.code === 'EROFS' ? 403 : e.code === 'ENOENT' ? 404 : 500);
      const message = e.status ? e.message : status === 409 ? 'That name already exists. Choose another name.' : status === 403 ? 'The share does not allow this change. Check the NAS account and folder permissions.' : status === 404 ? 'File not found.' : 'The operation failed. Check the server log and SMB connection.';
      if (status === 500) console.error(e);
      json(res, { error: message }, status);
    }
  });
  server.on('close', () => { clearInterval(timer); clearInterval(cleanup); activeRender?.child?.kill(); });
  return { server, scan };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('3D Model Manager initializing storage and selected library folders...');
  const { server } = await createApp();
  server.listen(Number(process.env.PORT || 3210), process.env.HOST || '0.0.0.0', () => console.log(`3D Model Manager listening on port ${process.env.PORT || 3210}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
}



