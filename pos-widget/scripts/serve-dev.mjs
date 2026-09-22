// Development helper. Two read-only static files, each on an exact-path allow-list, nothing else (no directory listing, no other path, GET / HEAD only):
//   /bundle.js  the POS widget (dist/bundle.js), for Poster's POS "Development mode":  http://127.0.0.1:8080/bundle.js.  CORS is open because the register may fetch it
//               from another origin.
//   /           the CUP application page Poster opens for "Подключить" / Manage Platform (connect/index.html). Plain HTML, no CORS, and deliberately frameable, because
//               Poster shows it inside its management console iframe (so no X-Frame-Options / frame-ancestors). Its CSP allows only its own inline script and style, and NO
//               network access at all (default-src 'none': no fetch, no images, no frames of its own).
// It talks to nothing and holds no secret. Usage: npm run build && npm run serve   (PORT=8081 to change the port, HOST=0.0.0.0 to reach it from a tablet on the LAN)
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = join(root, 'dist', 'bundle.js');
const page = join(root, 'connect', 'index.html');
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '127.0.0.1';

const bundleHeaders = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': '*', 'access-control-allow-private-network': 'true', 'cache-control': 'no-store', 'content-type': 'text/javascript; charset=utf-8' };
const pageHeaders = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
};

http
  .createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    // one line per request, so a register that never fetches the bundle is visible here (method, path, who asked; no query string, no cookies, no secrets)
    res.on('finish', () => console.log(`${new Date().toISOString().slice(11, 19)}  ${req.method} ${path} -> ${res.statusCode}  dest=${req.headers['sec-fetch-dest'] ?? '-'} site=${req.headers['sec-fetch-site'] ?? '-'} referer=${(req.headers.referer ?? '-').split('?')[0].slice(0, 80)} origin=${req.headers.origin ?? '-'} pna=${req.headers['access-control-request-private-network'] ?? '-'} ua=${(req.headers['user-agent'] ?? '-').slice(0, 40)}`));
    const head = req.method === 'HEAD';
    if (req.method === 'OPTIONS' && path === '/bundle.js') return void res.writeHead(204, bundleHeaders).end();
    if (req.method !== 'GET' && !head) return void res.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' }).end();
    if (path === '/bundle.js') {
      if (!existsSync(bundle)) return void res.writeHead(404, bundleHeaders).end('run "npm run build" first');
      return void res.writeHead(200, bundleHeaders).end(head ? undefined : readFileSync(bundle));
    }
    if (path === '/') {
      if (!existsSync(page)) return void res.writeHead(404, pageHeaders).end('connect/index.html is missing');
      return void res.writeHead(200, pageHeaders).end(head ? undefined : readFileSync(page));
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end('only / and /bundle.js are served');
  })
  .listen(port, host, () => console.log(`serving http://${host}:${port}/  (Poster application page)  and  http://${host}:${port}/bundle.js  (POS widget)`));
