const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const script = path.join(__dirname, '..', 'server.js');

test('first-run configuration, authorization, assets, and persistence', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'calendar-test-'));
  const data = path.join(dir, 'db.json');
  const password = randomBytes(20).toString('hex');
  let child;
  try {
    const missing = spawnSync(process.execPath, [script], {
      env: { ...process.env, CALENDAR_DATA_FILE: data, CALENDAR_ADMIN_PASSWORD: '' },
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /First start requires/);
    child = spawn(process.execPath, [script], {
      env: { ...process.env, PORT: '0', CALENDAR_DATA_FILE: data, CALENDAR_ADMIN_PASSWORD: password },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const base = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Server startup timeout')), 8000);
      child.on('error', reject);
      child.on('exit', code => { clearTimeout(timer); reject(new Error(`Early exit ${code}`)); });
      child.stdout.on('data', chunk => {
        output += chunk;
        const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      });
    });
    assert.equal((await fetch(base + '/')).status, 200);
    assert.equal((await fetch(base + '/manifest.json')).status, 200);
    assert.equal((await fetch(base + '/sw.js')).status, 200);
    assert.equal((await fetch(base + '/api/admin/users')).status, 403);
    assert.equal((await fetch(base + '/api/indicators', { method: 'POST', body: '{}' })).status, 403);
    const login = await fetch(base + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password }),
    });
    assert.equal(login.status, 200);
    const session = await login.json();
    assert.match(session.token, /^tok_[0-9a-f]{64}$/);
    const admin = await fetch(base + '/api/admin/users', { headers: { 'X-Device-Token': session.token } });
    assert.equal(admin.status, 200);
    const users = await admin.json();
    assert.ok(!JSON.stringify(users).includes(password));
    assert.equal(JSON.parse(readFileSync(data, 'utf8')).users[0].username, 'admin');
    await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
    child = null;
    writeFileSync(data, '{broken');
    const corrupt = spawnSync(process.execPath, [script], {
      env: { ...process.env, CALENDAR_DATA_FILE: data, CALENDAR_ADMIN_PASSWORD: password },
      encoding: 'utf8', timeout: 5000,
    });
    assert.notEqual(corrupt.status, 0);
    assert.equal(readFileSync(data, 'utf8'), '{broken');
  } finally {
    if (child) await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
    rmSync(dir, { recursive: true, force: true });
  }
});
