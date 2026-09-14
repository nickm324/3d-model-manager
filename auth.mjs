import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const encode = value => Buffer.from(value).toString('base64url');
const passwordHash = (password, salt = randomBytes(16).toString('hex')) => `${salt}:${scryptSync(String(password), salt, 32).toString('hex')}`;
const safeEqual = (a, b) => { const left = Buffer.from(String(a)), right = Buffer.from(String(b)); return left.length === right.length && timingSafeEqual(left, right); };

export function normalizeAuth(value = {}) {
  return { enabled: value.enabled === true, proxyHeader: String(value.proxyHeader || '').toLowerCase().replace(/[^a-z0-9-]/g, ''), users: Array.isArray(value.users) ? value.users.filter(user => user?.username && user?.passwordHash).map(user => ({ id: String(user.id || user.username), username: String(user.username), role: ['admin', 'editor', 'viewer'].includes(user.role) ? user.role : 'viewer', passwordHash: String(user.passwordHash) })) : [] };
}
export function makePassword(password) { if (String(password).length < 8) throw Object.assign(new Error('Passwords must contain at least 8 characters.'), { status: 400 }); return passwordHash(password); }
export function verifyPassword(password, stored) { const salt = String(stored).split(':')[0]; return safeEqual(passwordHash(password, salt), stored); }
export function issueSession(user, key) { const payload = encode(JSON.stringify({ id: user.id, exp: Date.now() + 12 * 60 * 60 * 1000 })); return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`; }
export function readSession(req, auth, key) {
  if (!auth.enabled) return { id: 'local', username: 'Local administrator', role: 'admin' };
  if (auth.proxyHeader && req.headers[auth.proxyHeader]) return { id: 'proxy', username: String(req.headers[auth.proxyHeader]), role: 'admin' };
  const token = String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('model_manager_session='))?.split('=')[1];
  if (!token) return null;
  try { const [payload, signature] = token.split('.'); if (!safeEqual(signature, createHmac('sha256', key).update(payload).digest('base64url'))) return null; const session = JSON.parse(Buffer.from(payload, 'base64url')); if (session.exp < Date.now()) return null; return auth.users.find(user => user.id === session.id) || null; } catch { return null; }
}
