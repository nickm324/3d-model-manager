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

const runCapture = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = [], errors = [];
  child.stdout.on('data', chunk => output.push(chunk)); child.stderr.on('data', chunk => errors.push(chunk));
  child.once('error', reject);
  child.once('close', code => code === 0 ? resolve(Buffer.concat(output).toString('utf8').trim()) : reject(Object.assign(new Error(Buffer.concat(errors).toString('utf8').trim() || 'Folder selection was cancelled.'), { cancelled: true })));
});
async function pickFolder() {
  if (process.platform === 'win32') {
    const script = "Add-Type -AssemblyName System.Windows.Forms; $picker = New-Object System.Windows.Forms.FolderBrowserDialog; $picker.Description = 'Choose a model folder'; $picker.ShowNewFolderButton = $true; if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [Text.Encoding]::UTF8; Write-Output $picker.SelectedPath } else { exit 2 }";
    return runCapture('powershell.exe', ['-NoProfile', '-STA', '-Command', script]);
  }
  if (process.platform === 'darwin') return (await runCapture('osascript', ['-e', 'POSIX path of (choose folder with prompt "Choose a model folder")'])).replace(/\/$/, '');
  const choices = [['zenity', ['--file-selection', '--directory', '--title=Choose a model folder']], ['kdialog', ['--getexistingdirectory', os.homedir(), '--title', 'Choose a model folder']], ['yad', ['--file-selection', '--directory', '--title=Choose a model folder']]];
  for (const [command, args] of choices) try { return await runCapture(command, args); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  throw new Error('No supported folder picker was found. Install Zenity, KDialog, or YAD.');
}
const browserCommand = url => process.platform === 'win32' ? ['powershell.exe', ['-NoProfile', '-Command', `Start-Process '${url}'`]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
const openStatusPage = port => { const [command, args] = browserCommand(`http://127.0.0.1:${port}/`); const child = spawn(command, args, { detached: true, windowsHide: true, stdio: 'ignore' }); child.unref(); };
const page = (port, managementToken) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>3D Model Manager Bridge</title><style>body{margin:0;background:#101923;color:#edf3f9;font:16px system-ui;display:grid;place-items:center;min-height:100vh}.card{width:min(560px,calc(100% - 40px));background:#1a2735;border:1px solid #3a4a5d;border-radius:14px;padding:30px;box-shadow:0 24px 70px #0007}h1{margin:0 0 8px;font-size:1.5rem}p{color:#aebed0;line-height:1.55}.code{font:700 2.3rem ui-monospace,monospace;letter-spacing:.22em;color:#ffad54;background:#111b26;padding:15px 18px;border-radius:9px;text-align:center}button{background:#273648;color:#eef4fa;border:1px solid #53677e;border-radius:7px;padding:10px 14px;cursor:pointer}.ok{color:#9bd8ad}.row{display:flex;justify-content:space-between;align-items:center;gap:15px;margin-top:24px}</style><main class="card"><h1>3D Model Manager Bridge</h1><p class="ok">Running on this computer</p><p>Enter this code in <strong>3D Model Manager → Settings → Desktop slicers</strong> the first time you connect:</p><div class="code">${config.code}</div><div class="row"><p>You can close this browser tab. The bridge will keep running quietly in the background.</p><button id="stop">Stop bridge</button></div></main><script>document.querySelector('#stop').onclick=async()=>{await fetch('/quit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'${managementToken}'})});document.body.innerHTML='<main class="card"><h1>Bridge stopped</h1><p>You can close this tab.</p></main>'}</script></html>`;

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

export function startBridge(port = 3211, options = {}) {
  const chooseFolder = options.pickFolder || pickFolder;
  const managementToken = randomBytes(24).toString('base64url');
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    if (req.method === 'OPTIONS') return reply(res, 204, {}, origin);
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`), chunks = [];
      if (req.method !== 'GET') for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
      if (url.pathname === '/' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" }); return res.end(page(server.address()?.port || port, managementToken)); }
      if (url.pathname === '/quit' && req.method === 'POST') { if (body.token !== managementToken) return reply(res, 403, { error: 'Invalid management token.' }); reply(res, 200, { stopped: true }); setTimeout(() => server.close(() => process.exit(0)), 50); return; }
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
      if (url.pathname === '/folders/pick' && req.method === 'POST') {
        let folderPath;
        try { folderPath = await chooseFolder(); } catch (error) { if (error.cancelled) return reply(res, 200, { cancelled: true }, origin); throw error; }
        if (!folderPath) return reply(res, 200, { cancelled: true }, origin);
        folderPath = path.resolve(folderPath); const stat = await fs.stat(folderPath); if (!stat.isDirectory()) throw new Error('Choose a folder.');
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
  });
  return server.listen(port, '127.0.0.1', () => console.log(`3D Model Manager Bridge ready on port ${server.address().port}. Pairing code: ${config.code}`));
}

if (process.argv[1] && import.meta.url === new URL(`file:///${path.resolve(process.argv[1]).replaceAll('\\', '/')}`).href) {
  const port = Number(process.env.MODEL_MANAGER_BRIDGE_PORT || 3211), server = startBridge(port);
  server.once('listening', () => { if (process.env.MODEL_MANAGER_BRIDGE_NO_BROWSER !== '1') openStatusPage(server.address().port); });
  server.once('error', error => { if (error.code === 'EADDRINUSE') { if (process.env.MODEL_MANAGER_BRIDGE_NO_BROWSER !== '1') openStatusPage(port); process.exit(0); } throw error; });
}
