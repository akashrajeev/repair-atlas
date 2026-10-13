import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const port = Number(process.env.PORT ?? 5173);

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/ui/index.html';
    else if (!/^\/(ui|src|fixtures)\//.test(p)) p = '/ui' + p;
    if (p === '/fixtures/index.json') {
      const files = (await readdir(join(root, 'fixtures'))).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(files));
    }
    const full = normalize(join(root, p));
    if (!full.startsWith(root) || !/^\/(ui|src|fixtures)\//.test(p)) { res.writeHead(404); return res.end('not found'); }
    const body = await readFile(full);
    res.writeHead(200, { 'content-type': types[extname(full)] ?? 'text/plain', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Repair Atlas on http://127.0.0.1:${port}`));
