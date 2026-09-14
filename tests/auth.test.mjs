import test from 'node:test';
import assert from 'node:assert/strict';
import { makePassword, verifyPassword, issueSession, readSession, normalizeAuth } from '../auth.mjs';

test('passwords are salted and sessions are signed', () => {
  const passwordHash = makePassword('correct horse'), user = { id: 'one', username: 'Owner', role: 'admin', passwordHash }, auth = normalizeAuth({ enabled: true, users: [user] }), key = Buffer.alloc(32, 7);
  assert.equal(verifyPassword('correct horse', passwordHash), true);
  assert.equal(verifyPassword('wrong password', passwordHash), false);
  const token = issueSession(user, key), request = { headers: { cookie: `model_manager_session=${token}` } };
  assert.equal(readSession(request, auth, key).username, 'Owner');
  assert.equal(readSession({ headers: { cookie: `model_manager_session=${token}x` } }, auth, key), null);
});

test('authentication remains optional and supports a trusted proxy header', () => {
  assert.equal(readSession({ headers: {} }, normalizeAuth(), Buffer.alloc(32)).role, 'admin');
  const auth = normalizeAuth({ enabled: true, proxyHeader: 'Remote-User' });
  assert.deepEqual(readSession({ headers: { 'remote-user': 'alex' } }, auth, Buffer.alloc(32)), { id: 'proxy', username: 'alex', role: 'admin' });
});
