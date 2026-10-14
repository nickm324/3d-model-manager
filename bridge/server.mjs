import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';

const configPath = process.env.MODEL_MANAGER_BRIDGE_CONFIG || path.join(os.homedir(), '.3d-model-manager-bridge.json');
const supported = new Set(['.stl', '.3mf', '.scad', '.step', '.stp', '.ste', '.f3d', '.f3z']);
const candidates = process.platform === 'win32' ? [
  ['Bambu Studio', `${process.env.ProgramFiles}\\Bambu Studio\\bambu-studio.exe`], ['OrcaSlicer', `${process.env.ProgramFiles}\\OrcaSlicer\\orca-slicer.exe`],
  ['PrusaSlicer', `${process.env.ProgramFiles}\\Prusa3D\\PrusaSlicer\\prusa-slicer.exe`], ['Cura', `${process.env.ProgramFiles}\\UltiMaker Cura 5.10.0\\UltiMaker-Cura.exe`]
] : process.platform === 'darwin' ? [
  ['Bambu Studio', '/Applications/BambuStudio.app/Contents/MacOS/BambuStudio'], ['OrcaSlicer', '/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer'], ['PrusaSlicer', '/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer']
] : [['Bambu Studio', '/usr/bin/bambu-studio'], ['OrcaSlicer', '/usr/bin/orca-slicer'], ['PrusaSlicer', '/usr/bin/prusa-slicer'], ['Cura', '/usr/bin/ultimaker-cura']];

let config;
try { config = JSON.parse(await fs.readFile(configPath, 'utf8')); } catch { config = {}; }
config = { code: String(config.code || Math.floor(100000 + Math.random() * 900000)), token: String(config.token || ''), origin: String(config.origin || ''), defaultPath: String(config.defaultPath || ''), manual: Array.isArray(config.manual) ? config.manual : [], folders: Array.isArray(config.folders) ? config.folders : [] };
const save = () => fs.writeFile(configPath, JSON.stringify(config, null, 2));
await save();

async function slicers() {
  const result = [];
  for (const [name, file] of [...candidates, ...config.manual.map(x => [x.name, x.path])]) try { await fs.access(file); result.push({ name, path: file, default: file === config.defaultPath }); } catch {}
  return result;
}
const publicFolder = folder => ({ id: folder.id, name: folder.name, path: folder.path, lastScan: folder.lastScan || '', count: folder.count || 0 });
const cors = origin => ({ 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type, X-Bridge-Token', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Cache-Control': 'no-store' });
const reply = (res, status, body, origin = '') => { res.writeHead(status, { 'Content-Type': 'application/json', ...cors(origin) }); res.end(JSON.stringify(body)); };
const safeFile = (folder, relative) => {
  const root = path.resolve(folder.path), target = path.resolve(root, String(relative || ''));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('That file is outside the approved folder.');
  return target;
};
async function scanFolder(folder) {
  const files = [], queue = [''];
  while (queue.length) {
    const relative = queue.shift();
    for (const entry of await fs.readdir(safeFile(folder, relative), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) queue.push(child);
      else if (entry.isFile() && supported.has(path.extname(entry.name).toLowerCase())) {
        const stat = await fs.stat(safeFile(folder, child));
        files.push({ path: child.replaceAll('\\', '/'), name: entry.name, size: stat.size, modified: stat.mtime.toISOString(), type: path.extname(entry.name).slice(1).toLowerCase() });
        if (files.length >= 20000) throw new Error('This folder contains more than 20,000 supported files. Add a smaller folder.');
      }
    }
  }
  folder.lastScan = new Date().toISOString(); folder.count = files.length; await save(); return files;
}

export function startBridge(port = 3211) {
  return http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    if (req.method === 'OPTIONS') return reply(res, 204, {}, origin);
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`), chunks = [];
      if (req.method !== 'GET') for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
      if (url.pathname === '/pair' && req.method === 'POST') {
        if (String(body.code) !== config.code) return reply(res, 401, { error: 'Pairing code is incorrect.' }, origin);
        config.token = randomBytes(24).toString('base64url'); config.origin = origin; await save(); return reply(res, 200, { token: config.token }, origin);
      }
      if (!config.token || req.headers['x-bridge-token'] !== config.token || origin !== config.origin) return reply(res, 401, { error: 'Bridge is not paired with this site.' }, origin);
      if (url.pathname === '/status') return reply(res, 200, { slicers: await slicers(), platform: process.platform, hostname: os.hostname(), folders: config.folders.map(publicFolder) }, origin);
      if (url.pathname === '/settings' && req.method === 'POST') {
        config.defaultPath = String(body.defaultPath || config.defaultPath || '');
        if (body.manualAdd?.name && body.manualAdd?.path) config.manual = [...config.manual.filter(x => x.path !== body.manualAdd.path), { name: String(body.manualAdd.name).slice(0, 80), path: String(body.manualAdd.path) }].slice(-20);
        await save(); return reply(res, 200, { slicers: await slicers() }, origin);
      }
      if (url.pathname === '/folders/add' && req.method === 'POST') {
        const folderPath = path.resolve(String(body.path || '')), stat = await fs.stat(folderPath); if (!stat.isDirectory()) throw new Error('Choose a folder.');
        let folder = config.folders.find(item => path.resolve(item.path) === folderPath);
        if (!folder) { folder = { id: randomUUID(), path: folderPath, name: path.basename(folderPath) || os.hostname(), lastScan: '', count: 0 }; config.folders.push(folder); await save(); }
        return reply(res, 201, { folder: publicFolder(folder), folders: config.folders.map(publicFolder) }, origin);
      }
      if (url.pathname === '/folders/remove' && req.method === 'POST') { config.folders = config.folders.filter(folder => folder.id !== body.id); await save(); return reply(res, 200, { folders: config.folders.map(publicFolder) }, origin); }
      if (url.pathname === '/folders/scan' && req.method === 'POST') {
        const folder = config.folders.find(item => item.id === body.id); if (!folder) throw new Error('Approved folder not found.');
        const files = await scanFolder(folder); return reply(res, 200, { folder: publicFolder(folder), files, hostname: os.hostname() }, origin);
      }
      if (url.pathname === '/folders/file' && req.method === 'GET') {
        const folder = config.folders.find(item => item.id === url.searchParams.get('id')); if (!folder) throw new Error('Approved folder not found.');
        const file = safeFile(folder, url.searchParams.get('path')), stat = await fs.stat(file); if (!stat.isFile() || !supported.has(path.extname(file).toLowerCase())) throw new Error('Unsupported local file.');
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': stat.size, ...cors(origin) }); return res.end(await fs.readFile(file));
      }
      if (url.pathname === '/open' && req.method === 'POST') {
        const modelUrl = new URL(body.url); if (!['http:', 'https:'].includes(modelUrl.protocol)) throw new Error('Only HTTP model links are supported.');
        const available = await slicers(), chosen = available.find(x => x.path === body.slicerPath) || available.find(x => x.default) || available[0]; if (!chosen) throw new Error('No slicer is configured.');
        const response = await fetch(modelUrl); if (!response.ok) throw new Error('The model could not be downloaded.'); const data = Buffer.from(await response.arrayBuffer()); if (data.length > 512 * 1048576) throw new Error('The model exceeds the bridge size limit.');
        const ext = path.extname(decodeURIComponent(modelUrl.pathname)) || '.3mf', dir = await fs.mkdtemp(path.join(os.tmpdir(), '3dmm-')), file = path.join(dir, `model${ext}`); await fs.writeFile(file, data);
        const child = spawn(chosen.path, [file], { detached: true, stdio: 'ignore' }); child.unref(); return reply(res, 200, { opened: true, slicer: chosen.name }, origin);
      }
      reply(res, 404, { error: 'Not found.' }, origin);
    } catch (error) { reply(res, 400, { error: error.message }, origin); }
  }).listen(port, '127.0.0.1', () => console.log(`3D Model Manager Bridge ready on port ${port}. Pairing code: ${config.code}`));
}

if (process.argv[1] && import.meta.url === new URL(`file:///${path.resolve(process.argv[1]).replaceAll('\\', '/')}`).href) startBridge();
