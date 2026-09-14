import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const home = os.homedir(), configPath = path.join(home, '.3d-model-manager-bridge.json');
const candidates = process.platform === 'win32' ? [
  ['Bambu Studio', `${process.env.ProgramFiles}\\Bambu Studio\\bambu-studio.exe`], ['OrcaSlicer', `${process.env.ProgramFiles}\\OrcaSlicer\\orca-slicer.exe`],
  ['PrusaSlicer', `${process.env.ProgramFiles}\\Prusa3D\\PrusaSlicer\\prusa-slicer.exe`], ['Cura', `${process.env.ProgramFiles}\\UltiMaker Cura 5.10.0\\UltiMaker-Cura.exe`]
] : process.platform === 'darwin' ? [
  ['Bambu Studio', '/Applications/BambuStudio.app/Contents/MacOS/BambuStudio'], ['OrcaSlicer', '/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer'], ['PrusaSlicer', '/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer']
] : [['Bambu Studio', '/usr/bin/bambu-studio'], ['OrcaSlicer', '/usr/bin/orca-slicer'], ['PrusaSlicer', '/usr/bin/prusa-slicer'], ['Cura', '/usr/bin/ultimaker-cura']];
let config;
try { config = JSON.parse(await fs.readFile(configPath, 'utf8')); } catch { config = { code: String(Math.floor(100000 + Math.random() * 900000)), token: '', origin: '', defaultPath: '', manual: [] }; await fs.writeFile(configPath, JSON.stringify(config, null, 2)); }
const save = () => fs.writeFile(configPath, JSON.stringify(config, null, 2));
async function slicers() { const all = [...candidates, ...(config.manual || []).map(x => [x.name, x.path])], result = []; for (const [name, file] of all) try { await fs.access(file); result.push({ name, path: file, default: file === config.defaultPath }); } catch {} return result; }
const reply = (res, status, body, origin = '') => { res.writeHead(status, { 'Content-Type': 'application/json', ...(origin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type, X-Bridge-Token' } : {}) }); res.end(JSON.stringify(body)); };
http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  if (req.method === 'OPTIONS') return reply(res, 204, {}, origin);
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk); const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
    if (req.url === '/pair' && req.method === 'POST') { if (String(body.code) !== config.code) return reply(res, 401, { error: 'Pairing code is incorrect.' }, origin); config.token = randomBytes(24).toString('base64url'); config.origin = origin; await save(); return reply(res, 200, { token: config.token }, origin); }
    if (!config.token || req.headers['x-bridge-token'] !== config.token || origin !== config.origin) return reply(res, 401, { error: 'Bridge is not paired with this site.' }, origin);
    if (req.url === '/status') return reply(res, 200, { slicers: await slicers(), platform: process.platform }, origin);
    if (req.url === '/settings' && req.method === 'POST') { config.defaultPath = String(body.defaultPath || config.defaultPath || ''); if (body.manualAdd?.name && body.manualAdd?.path) config.manual = [...(config.manual || []).filter(x => x.path !== body.manualAdd.path), { name: String(body.manualAdd.name).slice(0, 80), path: String(body.manualAdd.path) }].slice(-20); await save(); return reply(res, 200, { slicers: await slicers() }, origin); }
    if (req.url === '/open' && req.method === 'POST') {
      const url = new URL(body.url); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP model links are supported.');
      const available = await slicers(), chosen = available.find(x => x.path === body.slicerPath) || available.find(x => x.default) || available[0]; if (!chosen) throw new Error('No slicer is configured.');
      const response = await fetch(url); if (!response.ok) throw new Error('The model could not be downloaded.'); const data = Buffer.from(await response.arrayBuffer()); if (data.length > 512 * 1048576) throw new Error('The model exceeds the bridge size limit.');
      const ext = path.extname(decodeURIComponent(url.pathname)) || '.3mf', dir = await fs.mkdtemp(path.join(os.tmpdir(), '3dmm-')), file = path.join(dir, `model${ext}`); await fs.writeFile(file, data);
      const child = spawn(chosen.path, [file], { detached: true, stdio: 'ignore' }); child.unref(); return reply(res, 200, { opened: true, slicer: chosen.name }, origin);
    }
    reply(res, 404, { error: 'Not found.' }, origin);
  } catch (error) { reply(res, 400, { error: error.message }, origin); }
}).listen(3211, '127.0.0.1', () => console.log(`3D Model Manager Bridge ready on port 3211. Pairing code: ${config.code}`));
