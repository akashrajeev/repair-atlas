import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

test('static server: encoded traversal cannot read files outside ui/src/fixtures', async () => {
  const port = 5600 + Math.floor(Math.random() * 300);
  const srv = spawn('node', ['scripts/serve.js'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((res) => srv.stdout.once('data', res));
    const get = async (p) => (await fetch(`http://127.0.0.1:${port}${p}`)).status;
    assert.equal(await get('/'), 200);
    assert.equal(await get('/src/model.js'), 200);
    assert.equal(await get('/fixtures/index.json'), 200);
    for (const p of ['/..%2fpackage.json', '/%2e%2e/package.json', '/ui/..%2fpackage.json', '/src/..%2f.git/HEAD', '/fixtures/..%2f..%2fetc/passwd', '/..%2ftest/cli.test.js']) {
      assert.equal(await get(p), 404, p);
    }
  } finally { srv.kill(); }
});
