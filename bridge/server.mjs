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
config = { code: String(config.code || Math.floor(100000 + Math.random() * 900000)), token: String(config.token || ''), origin: String(config.origin || ''), defaultPath: String(config.defaultPath || ''), installedPath: String(config.installedPath || ''), manual: Array.isArray(config.manual) ? config.manual : [], folders: Array.isArray(config.folders) ? config.folders : [] };
const save = () => fs.writeFile(configPath, JSON.stringify(config, null, 2));
await save();

const runCapture = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { windowsHide: options.windowsHide ?? true, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = [], errors = [];
  child.stdout.on('data', chunk => output.push(chunk)); child.stderr.on('data', chunk => errors.push(chunk));
  child.once('error', reject);
  child.once('close', code => code === 0 ? resolve(Buffer.concat(output).toString('utf8').trim()) : reject(Object.assign(new Error(Buffer.concat(errors).toString('utf8').trim() || 'Folder selection was cancelled.'), { cancelled: true })));
});
async function runVbs(script) {
  const file = path.join(os.tmpdir(), `3d-model-manager-${randomUUID()}.vbs`);
  await fs.writeFile(file, script, 'utf8');
  try { return await runCapture('cscript.exe', ['//Nologo', file]); }
  finally { await fs.rm(file, { force: true }).catch(() => {}); }
}
async function pickFolder() {
  if (process.platform === 'win32') {
    return runVbs(`Set shell = CreateObject("Shell.Application")\nSet folder = shell.BrowseForFolder(0, "Choose a model folder", 65, 0)\nIf folder Is Nothing Then WScript.Quit 2\nWScript.StdOut.Write folder.Self.Path`);
  }
  if (process.platform === 'darwin') return (await runCapture('osascript', ['-e', 'POSIX path of (choose folder with prompt "Choose a model folder")'])).replace(/\/$/, '');
  const choices = [['zenity', ['--file-selection', '--directory', '--title=Choose a model folder']], ['kdialog', ['--getexistingdirectory', os.homedir(), '--title', 'Choose a model folder']], ['yad', ['--file-selection', '--directory', '--title=Choose a model folder']]];
  for (const [command, args] of choices) try { return await runCapture(command, args); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  throw new Error('No supported folder picker was found. Install Zenity, KDialog, or YAD.');
}
const bridgeIcon = 'AAABAAEAICAQAAAAAADoAgAAFgAAACgAAAAgAAAAQAAAAAEABAAAAAAAgAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAACAAAAAgIAAgAAAAIAAgACAgAAAgICAAMDAwAAAAP8AAP8AAAD//wD/AAAA/wD/AP//AAD///8AAAAAAAAAADMzMAAAAAAAAAAAAAAAE3u7u7uzEAAAAAAAAAAAA7u7u7u7u7MQAAAAAAAAA7u7u7u7u7u7swAAAAAAADu7u7u7u7u7u7swAAAAAAO7u7u7s3O7u7u7swAAAAA7u7u7txAAB7u7u7swAAAAu7u7tzAAAAA3u7u7sQAAA7u7tzAAAwMwADe7u7MAAAu7u7MAA7MDswAAe7u7EAA7u7tzA3uzA7uzATu7uzAAO7u7MDu7swO7uzA7u7twALu7uzA7u7MDu7swO7u7sAC7u7swO7uzA7u7MDu7u7EBu7u7MDu7swO7uzA7u7uzAbu7uzA7u7MBu7swO7u7swG7u7swO7cQAAe7MDu7u7MAu7u7MDcwAAAANzA7u7uxALu7uzAQAAe3MAAQO7u7sAA7u7swAAO7u7MAADu7u3AAO7u7cAB7u7u7cAA7u7swAAe7u7MAA3u7cwADu7u7AAADu7u7cwADcwAAe7u7swAAAHu7u7swAAAAO7u7u3AAAAAHu7u7uzAwN7u7u7sQAAAAAbu7u7u3d7u7u7uzAAAAAAAXu7u7u7u7u7u7MAAAAAAAAHu7u7u7u7u7cQAAAAAAAAADe7u7u7u7swAAAAAAAAAAAAE7u7u7MwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///////gH///AAf//AAB//gAAP/wAAB/4AAAP8AAAB/AAAAfgAAAD4AAAA+AAAAPAAAABwAAAAcAAAAHAAAABwAAAAcAAAAHAAAAB4AAAA+AAAAPwAAAD8AAAB/gAAA/8AAAP/AAAH/8AAD//gAD//+AB///4D////////////w==';
const vbsString = value => String(value).replaceAll('"', '""');
async function stopExistingBridge(port) {
  try {
    const page = await fetch(`http://127.0.0.1:${port}/`, { headers: { Connection: 'close' } }), html = await page.text(), token = html.match(/token:'([^']+)'/)?.[1];
    if (token) await fetch(`http://127.0.0.1:${port}/quit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Connection: 'close' }, body: JSON.stringify({ token }) });
    await new Promise(resolve => setTimeout(resolve, 500));
  } catch {}
}
async function installWindowsBridge(port) {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), folder = path.join(local, '3D Model Manager Bridge');
  const executable = path.join(folder, '3d-model-manager-bridge.exe'), icon = path.join(folder, '3d-model-manager-bridge.ico');
  await stopExistingBridge(port); await fs.mkdir(folder, { recursive: true }); await fs.copyFile(process.execPath, executable); await fs.writeFile(icon, Buffer.from(bridgeIcon, 'base64'));
  const target = vbsString(executable), working = vbsString(folder), iconPath = vbsString(`${icon},0`);
  if (process.env.MODEL_MANAGER_BRIDGE_SKIP_SHORTCUTS !== '1') await runVbs(`Set shell = CreateObject("WScript.Shell")\nSub MakeShortcut(location)\n  Set shortcut = shell.CreateShortcut(location & "\\3D Model Manager Bridge.lnk")\n  shortcut.TargetPath = "${target}"\n  shortcut.WorkingDirectory = "${working}"\n  shortcut.IconLocation = "${iconPath}"\n  shortcut.Save\nEnd Sub\nMakeShortcut shell.SpecialFolders("Desktop")\nMakeShortcut shell.SpecialFolders("Startup")\nMakeShortcut shell.SpecialFolders("Programs")`);
  config.installedPath = executable; await save();
  const child = spawn(executable, [], { detached: true, windowsHide: true, stdio: 'ignore' }); child.unref();
}
const browserCommand = url => process.platform === 'win32' ? ['powershell.exe', ['-NoProfile', '-Command', `Start-Process '${url}'`]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
const openStatusPage = port => { const [command, args] = browserCommand(`http://127.0.0.1:${port}/`); const child = spawn(command, args, { detached: true, windowsHide: true, stdio: 'ignore' }); child.unref(); };
const startWindowsTray = (port, managementToken) => {
  if (process.platform !== 'win32' || process.env.MODEL_MANAGER_BRIDGE_NO_TRAY === '1') return null;
  const script = String.raw`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$statusUrl = $env:MODEL_MANAGER_BRIDGE_STATUS_URL
$quitToken = $env:MODEL_MANAGER_BRIDGE_MANAGEMENT_TOKEN
$context = New-Object System.Windows.Forms.ApplicationContext
$tray = New-Object System.Windows.Forms.NotifyIcon
$bitmap = New-Object System.Drawing.Bitmap 32, 32
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$orange = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 239, 158, 73))
$dark = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 22, 31, 42)), 2.2
$graphics.FillEllipse($orange, 1, 1, 30, 30)
$graphics.DrawLine($dark, 16, 7, 9, 11)
$graphics.DrawLine($dark, 16, 7, 23, 11)
$graphics.DrawLine($dark, 9, 11, 16, 15)
$graphics.DrawLine($dark, 23, 11, 16, 15)
$graphics.DrawLine($dark, 9, 11, 9, 21)
$graphics.DrawLine($dark, 23, 11, 23, 21)
$graphics.DrawLine($dark, 9, 21, 16, 25)
$graphics.DrawLine($dark, 23, 21, 16, 25)
$graphics.DrawLine($dark, 16, 15, 16, 25)
$icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
$tray.Icon = $icon
$tray.Text = '3D Model Manager Bridge'
$tray.Visible = $true
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$openItem = $menu.Items.Add('Open status and pairing')
$stopItem = $menu.Items.Add('Stop bridge')
$open = { Start-Process $statusUrl }
$openItem.add_Click($open)
$tray.add_DoubleClick($open)
$stopItem.add_Click({
  try {
    $body = @{ token = $quitToken } | ConvertTo-Json -Compress
    Invoke-WebRequest -UseBasicParsing -Method Post -Uri ($statusUrl + 'quit') -ContentType 'application/json' -Body $body | Out-Null
  } catch {}
  $tray.Visible = $false
  $context.ExitThread()
})
$tray.ContextMenuStrip = $menu
$tray.BalloonTipTitle = '3D Model Manager Bridge'
$tray.BalloonTipText = 'The bridge is running. Double-click this icon to pair or manage it.'
$tray.ShowBalloonTip(5000)
try { [System.Windows.Forms.Application]::Run($context) } finally { $tray.Visible = $false; $tray.Dispose(); $menu.Dispose(); $icon.Dispose(); $graphics.Dispose(); $orange.Dispose(); $dark.Dispose(); $bitmap.Dispose() }
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, MODEL_MANAGER_BRIDGE_STATUS_URL: `http://127.0.0.1:${port}/`, MODEL_MANAGER_BRIDGE_MANAGEMENT_TOKEN: managementToken }
  });
  child.once('error', () => openStatusPage(port));
  return child;
};
const page = (port, managementToken) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>3D Model Manager Bridge</title><style>body{margin:0;background:#101923;color:#edf3f9;font:16px system-ui;display:grid;place-items:center;min-height:100vh}.card{width:min(560px,calc(100% - 40px));background:#1a2735;border:1px solid #3a4a5d;border-radius:14px;padding:30px;box-shadow:0 24px 70px #0007}h1{margin:0 0 8px;font-size:1.5rem}p{color:#aebed0;line-height:1.55}.code{font:700 2.3rem ui-monospace,monospace;letter-spacing:.22em;color:#ffad54;background:#111b26;padding:15px 18px;border-radius:9px;text-align:center}button{background:#273648;color:#eef4fa;border:1px solid #53677e;border-radius:7px;padding:10px 14px;cursor:pointer}.ok{color:#9bd8ad}.row{display:flex;justify-content:space-between;align-items:center;gap:15px;margin-top:24px}</style><main class="card"><h1>3D Model Manager Bridge</h1><p class="ok">Running on this computer${config.installedPath ? ' · Starts with Windows' : ''}</p><p>Enter this code in <strong>3D Model Manager → Settings → Desktop slicers</strong> the first time you connect:</p><div class="code">${config.code}</div><div class="row"><p>You can close this browser tab. The bridge will keep running quietly in the background.</p><button id="stop">Stop bridge</button></div></main><script>document.querySelector('#stop').onclick=async()=>{await fetch('/quit',{method:'POST',headers:{'Content-Type':'application/json',Connection:'close'},body:JSON.stringify({token:'${managementToken}'})});document.body.innerHTML='<main class="card"><h1>Bridge stopped</h1><p>You can close this tab. It will start again the next time you sign in to Windows.</p></main>'}</script></html>`;

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
  const managementToken = options.managementToken || randomBytes(24).toString('base64url');
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    if (req.method === 'OPTIONS') return reply(res, 204, {}, origin);
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`), chunks = [];
      if (req.method !== 'GET') for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
      if (url.pathname === '/' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" }); return res.end(page(server.address()?.port || port, managementToken)); }
      if (url.pathname === '/quit' && req.method === 'POST') { if (body.token !== managementToken) return reply(res, 403, { error: 'Invalid management token.' }); reply(res, 200, { stopped: true }); setTimeout(() => { server.close(); server.closeAllConnections?.(); setTimeout(() => process.exit(0), 100); }, 50); return; }
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
  server.managementToken = managementToken;
  return server.listen(port, '127.0.0.1', () => console.log(`3D Model Manager Bridge ready on port ${server.address().port}. Pairing code: ${config.code}`));
}

if (process.argv[1] && import.meta.url === new URL(`file:///${path.resolve(process.argv[1]).replaceAll('\\', '/')}`).href) {
  const port = Number(process.env.MODEL_MANAGER_BRIDGE_PORT || 3211);
  if (process.platform === 'win32' && /setup/i.test(path.basename(process.execPath)) && process.env.MODEL_MANAGER_BRIDGE_SKIP_INSTALL !== '1') { await installWindowsBridge(port); process.exit(0); }
  const server = startBridge(port);
  let tray = null;
  server.once('listening', () => {
    tray = startWindowsTray(server.address().port, server.managementToken);
    if (process.env.MODEL_MANAGER_BRIDGE_NO_BROWSER !== '1') openStatusPage(server.address().port);
  });
  server.once('close', () => { if (tray && !tray.killed) tray.kill(); });
  server.once('error', error => { if (error.code === 'EADDRINUSE') { if (process.env.MODEL_MANAGER_BRIDGE_NO_BROWSER !== '1') openStatusPage(port); process.exit(0); } throw error; });
}
