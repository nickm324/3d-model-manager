import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import dns from 'node:dns/promises';
import os from 'node:os';
import { Readable, Writable } from 'node:stream';

// libsmbclient is not safe when a background directory scan and an interactive
// file request use it at the same time. Keep native SMB work in one global lane;
// separate SmbStorage instances still share the same native library in-process.
let smbQueue = Promise.resolve();
const serializedSmb = operation => {
  const result = smbQueue.then(operation);
  smbQueue = result.catch(() => {});
  return result;
};

const exec = promisify(execFile);
const cleanHost = value => {
  const host = String(value || '').trim().replace(/^\\\\/, '').replace(/^smb:\/\//i, '').split(/[\\/]/)[0];
  if (!host || !/^[a-z0-9._-]+$/i.test(host)) throw Object.assign(new Error('Enter a valid server name or IP address.'), { status: 400 });
  return host;
};
const cleanShare = value => {
  const share = String(value || '').trim();
  if (!share || /[\\/\0]/.test(share)) throw Object.assign(new Error('Choose a valid share.'), { status: 400 });
  return share;
};
const cleanFolder = value => {
  const folder = String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (folder.includes('\0') || folder.split('/').some(part => part === '.' || part === '..' || part.startsWith('.'))) throw Object.assign(new Error('Choose a valid folder inside the share.'), { status: 400 });
  return folder;
};
const discoveredList = found => {
  const values = [...found.values()], isIp = value => /^\d+\.\d+\.\d+\.\d+$/.test(value);
  const namedAddresses = new Set(values.filter(x => x.address && !isIp(x.host)).map(x => x.address));
  const localAddresses = new Set(Object.values(os.networkInterfaces()).flat().filter(Boolean).map(x => x.address));
  return values.filter(x => !localAddresses.has(x.address || x.host) && !(isIp(x.host) && namedAddresses.has(x.address))).sort((a, b) => a.host.localeCompare(b.host));
};

async function authenticateWindows(host, share, username, password, domain = '') {
  if (!username) return host;
  const targets = [host];
  try { const resolved = await dns.lookup(host); if (resolved.address && resolved.address !== host) targets.push(resolved.address); } catch {}
  const accounts = domain ? [`${domain}\\${username}`, username] : [username, `WORKGROUP\\${username}`, `${host.split('.')[0]}\\${username}`];
  let lastError;
  for (const target of [...new Set(targets)]) {
    for (const account of [...new Set(accounts)]) {
      try {
        await exec('net.exe', ['use', `\\\\${target}\\${share}`, String(password), `/user:${account}`, '/persistent:no'], { timeout: 12000, windowsHide: true, maxBuffer: 1024 * 1024 });
        return target;
      } catch (error) {
        const detail = String(error.stdout || error.stderr || '');
        if (detail.includes('1219')) return target;
        lastError = error;
      }
    }
  }
  const detail = String(lastError?.stdout || lastError?.stderr || ''), number = detail.match(/System error\s+(\d+)/i)?.[1];
  throw Object.assign(new Error(`Windows could not authenticate with that NAS account${number ? ` (system error ${number})` : ''}.`), { status: 401, cause: lastError });
}

export async function discoverServers(extra = []) {
  const found = new Map(extra.map(host => [String(host).toLowerCase(), { host: String(host), address: '' }]));
  const initialCount = found.size;
  try {
    const { Bonjour } = await import('bonjour-service'), bonjour = new Bonjour();
    await new Promise(resolve => { const browser = bonjour.find({ type: 'smb' }, service => { const advertised = String(service.host || service.name || '').replace(/\.$/, ''), host = advertised.replace(/\.local$/i, ''); if (host) found.set(host.toLowerCase(), { host, address: service.addresses?.find(x => /^\d+\.\d+\.\d+\.\d+$/.test(x)) || '' }); }); setTimeout(() => { browser.stop(); bonjour.destroy(); resolve(); }, 1800); });
  } catch { /* continue with platform discovery */ }
  if (process.platform === 'win32') {
    // Existing mapped drives are the most reliable Windows discovery source and
    // already include NAS servers the user can browse in File Explorer.
    try {
      const { stdout } = await exec('net.exe', ['use'], { timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024 });
      for (const match of stdout.matchAll(/\\\\([^\\\s]+)\\[^\s]+/g)) {
        const host = match[1].replace(/\.local$/i, '');
        found.set(host.toLowerCase(), { host, address: '' });
      }
    } catch { /* continue with network discovery */ }
    try {
      const { stdout } = await exec('arp.exe', ['-a'], { timeout: 4000, windowsHide: true, maxBuffer: 1024 * 1024 });
      const addresses = [...stdout.matchAll(/\b((?:\d{1,3}\.){3}\d{1,3})\b/g)].map(x => x[1]);
      for (const entries of Object.values(os.networkInterfaces())) for (const entry of entries || []) {
        if (entry.family !== 'IPv4' || entry.internal || !entry.address.startsWith('192.168.')) continue;
        const prefix = entry.address.split('.').slice(0, 3).join('.');
        for (let last = 1; last < 255; last++) addresses.push(`${prefix}.${last}`);
      }
      const uniqueAddresses = [...new Set(addresses)].filter(ip => !ip.endsWith('.255'));
      await Promise.all(uniqueAddresses.map(ip => new Promise(resolve => {
        const socket = net.createConnection({ host: ip, port: 445 }); let settled = false;
        const done = async open => { if (settled) return; settled = true; socket.destroy(); if (open) { let host = ip; try { host = (await dns.reverse(ip))[0]?.replace(/\.$/, '').replace(/\.local$/i, '') || ip; } catch {} found.set(host.toLowerCase(), { host, address: ip }); } resolve(); };
        socket.setTimeout(450); socket.once('connect', () => done(true)); socket.once('timeout', () => done(false)); socket.once('error', () => done(false));
      })));
    } catch { /* continue with legacy discovery */ }
  }
  if (process.platform === 'win32' && found.size > initialCount) return discoveredList(found);
  try {
    if (process.platform === 'win32') {
      const { stdout } = await exec('net.exe', ['view'], { timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024 });
      for (const line of stdout.split(/\r?\n/)) { const match = line.match(/^\\\\([^\s]+)(?:\s{2,}.*)?$/); if (match) found.set(match[1].toLowerCase(), { host: match[1], address: '' }); }
      return discoveredList(found);
    }
    const { stdout } = await exec('nmblookup', ['-S', '*'], { timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024 });
    let address = '';
    for (const line of stdout.split(/\r?\n/)) {
      const header = line.match(/^\s*((?:\d{1,3}\.){3}\d{1,3})\s+/); if (header) address = header[1];
      const name = line.match(/^\s+([^\s<]+)\s+<00>\s+-\s+\s*<ACTIVE>/i);
      if (address && name && name[1] !== '*' && !name[1].startsWith('__')) found.set(name[1].toLowerCase(), { host: name[1], address });
    }
  } catch { /* discovery is best effort; manual entry remains available */ }
  return discoveredList(found);
}

export async function listShares({ host, username = '', password = '', domain = '' }) {
  host = cleanHost(host);
  if (process.platform === 'win32') {
    const parse = stdout => stdout.split(/\r?\n/).map(line => line.match(/^(.+?)\s{2,}Disk(?:\s{2,}(.*))?$/i)).filter(Boolean).map(match => ({ name: match[1].trim(), description: (match[2] || '').trim() }));
    // First use an existing Windows session (for example the user's mapped Z:
    // drive). This avoids depending on the NAS exposing the hidden IPC$ share.
    try {
      const { stdout } = await exec('net.exe', ['view', `\\\\${host}`], { timeout: 15000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
      const shares = parse(stdout);
      if (shares.length) return shares;
    } catch { /* supplied credentials may still establish a new session */ }
    let connectedHost;
    try { connectedHost = await authenticateWindows(host, 'IPC$', username, password, domain); }
    catch (error) {
      if (error.message.includes('system error 67')) throw Object.assign(new Error(`Windows cannot find \\\\${host}. Try the NAS IP address, or open \\\\${host} once in File Explorer and retry.`), { status: 502, cause: error });
      throw error;
    }
    try {
      const { stdout } = await exec('net.exe', ['view', `\\\\${connectedHost}`], { timeout: 15000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
      return parse(stdout);
    } catch (error) { throw Object.assign(new Error('Windows reached the server but could not list its shares. Check the username, password, and NAS permissions.'), { status: 502, cause: error }); }
  }
  const args = ['-g', '-L', `//${host}`, '-m', 'SMB3', '-U', `${domain ? `${domain}\\` : ''}${username}`];
  let stdout;
  try { ({ stdout } = await exec('smbclient', args, { env: { ...process.env, PASSWD: String(password) }, timeout: 15000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })); }
  catch (error) {
    if (error.code === 'ENOENT') throw Object.assign(new Error('The SMB client is missing from this installation. Rebuild the Docker image from the current package.'), { status: 503, cause: error });
    const detail = String(error.stderr || error.stdout || '').replace(/\s+/g, ' ').trim();
    let message = 'The NAS could not be reached or rejected the supplied SMB credentials.';
    if (/NT_STATUS_LOGON_FAILURE|NT_STATUS_WRONG_PASSWORD|LOGON_FAILURE/i.test(detail)) message = 'The NAS rejected the username or password.';
    else if (/NT_STATUS_ACCESS_DENIED|ACCESS_DENIED/i.test(detail)) message = 'The account connected, but the NAS denied permission to list shares.';
    else if (/name or service not known|resolve|NT_STATUS_NOT_FOUND/i.test(detail)) message = `The container could not resolve the server name ${host}. Use its IP address instead.`;
    else if (/connection refused/i.test(detail)) message = `The NAS at ${host} refused SMB connections on port 445.`;
    else if (/no route to host|network is unreachable|NT_STATUS_HOST_UNREACHABLE/i.test(detail)) message = `The container has no network route to ${host}.`;
    else if (/timed out|timeout/i.test(detail)) message = `The SMB connection to ${host} timed out.`;
    const safeDetail = detail.match(/NT_STATUS_[A-Z0-9_]+/i)?.[0];
    throw Object.assign(new Error(`${message}${safeDetail ? ` (${safeDetail})` : ''}`), { status: 502, cause: error });
  }
  return stdout.split(/\r?\n/).map(line => line.split('|')).filter(parts => parts[0] === 'Disk' && parts[1] && !parts[1].endsWith('$')).map(parts => ({ name: parts[1], description: parts[2] || '' }));
}

export class SmbStorage {
  constructor(config) { this.config = { ...config, host: cleanHost(config.host), share: cleanShare(config.share) }; this.base = cleanFolder(config.folder); this.client = null; this.windows = process.platform === 'win32'; }
  key(value = '') { const clean = String(value).replace(/\\/g, '/').replace(/^\/+/, ''); return [this.base, clean].filter(Boolean).join('/'); }
  async ready() {
    if (!this.client && this.windows) {
      const connectedHost = await authenticateWindows(this.config.host, this.config.share, this.config.username, this.config.password, this.config.domain);
      const remote = `\\\\${connectedHost}\\${this.config.share}`;
      this.client = new LocalStorage(path.win32.join(remote, ...this.base.split('/').filter(Boolean)));
    }
    if (!this.client) { const { SMB } = await import('@openinc/smb-client'); this.client = new SMB({ ...this.config, minProtocol: 'SMB2', maxProtocol: 'SMB3' }); }
    return this.client;
  }
  target(value = '') { return this.windows ? String(value).replace(/\\/g, '/').replace(/^\/+/, '') : this.key(value); }
  operation(method, ...values) { return serializedSmb(async () => (await this.ready())[method](...values.map(value => typeof value === 'string' ? this.target(value) : value))); }
  async readdir(value = '') { return this.operation('readdir', value); }
  async stat(value) { return this.operation('stat', value); }
  async exists(value) { return this.operation('exists', value); }
  async readFile(value) { return this.operation('readFile', value); }
  async writeFile(value, data) { return serializedSmb(async () => (await this.ready()).writeFile(this.target(value), data)); }
  async mkdir(value) { return this.operation('mkdir', value); }
  async rename(from, to) { return this.operation('rename', from, to); }
  async unlink(value) { return this.operation('unlink', value); }
  async createReadStream(value) { return Readable.from(await this.readFile(value)); }
  createWriteStream(value) {
    const chunks = [];
    return new Writable({ write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); }, final: done => { this.writeFile(value, Buffer.concat(chunks)).then(() => done(), done); } });
  }
  label() { return `\\\\${this.config.host}\\${this.config.share}${this.base ? `\\${this.base.replace(/\//g, '\\')}` : ''}`; }
}

export class LocalStorage {
  constructor(root) { this.root = path.resolve(root); }
  full(value = '') { return path.join(this.root, ...String(value).split('/').filter(Boolean)); }
  async readdir(value = '') { return Promise.all((await fs.readdir(this.full(value), { withFileTypes: true })).filter(x => !x.isSymbolicLink()).map(async entry => { const stat = await fs.stat(this.full(value ? `${value}/${entry.name}` : entry.name)); return { name: entry.name, type: entry.isDirectory() ? 'dir' : 'file', size: stat.size, mtime: stat.mtime }; })); }
  async stat(value) { const stat = await fs.stat(this.full(value)); return { size: stat.size, mtime: stat.mtime, isDirectory: stat.isDirectory() }; }
  async exists(value) { return fs.access(this.full(value)).then(() => true, () => false); }
  async readFile(value) { return fs.readFile(this.full(value)); }
  async writeFile(value, data) { return fs.writeFile(this.full(value), data); }
  async mkdir(value) { return fs.mkdir(this.full(value)); }
  async rename(from, to) { return fs.rename(this.full(from), this.full(to)); }
  async unlink(value) { return fs.unlink(this.full(value)); }
  createReadStream(value) { return createReadStream(this.full(value)); }
  createWriteStream(value, options) { return createWriteStream(this.full(value), options); }
  label() { return this.root; }
}
