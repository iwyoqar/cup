// Local Poster POS simulator for the CUP widget (Phase 21 — development only, never deployed).
//
// It plays TWO roles, like the real system:
//   1. the register: simulator/index.html implements the documented `Poster` JS API the widget is allowed to use (and TRAPS every API it is not allowed to use);
//   2. Poster's SERVERS: Poster.makeRequest is proxied by Poster, which signs the request with the application secret. That happens here, server-side
//      (POST /__poster/makeRequest), so the browser page never sees the secret — exactly as in production.
//
// Env: SIM_PORT (default 5190), SIM_TARGET (CUP backend public base URL the widget was built with), SIM_APPLICATION_SECRET (DEV secret; must equal the backend's
// POSTER_APPLICATION_SECRET on the dev backend), SIM_ACCOUNT (default iwyoqar). Nothing here talks to real Poster.
import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SIM_PORT || 5190);
const SECRET = process.env.SIM_APPLICATION_SECRET || '';
const ACCOUNT = process.env.SIM_ACCOUNT || 'iwyoqar';
const sim = { mode: 'signed', latencyMs: 0, slowClients: {}, spot: '1', tablet: '1', calls: 0, lastHeaders: null };

const md5 = (s) => createHash('md5').update(s).digest('hex');
const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const readBody = (req) => new Promise((resolve) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => resolve(d)); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// What Poster's servers do with Poster.makeRequest(url, { method: 'get', timeout }): call the URL, adding X-Poster-* headers and (documented) the MD5 signature.
async function proxy(url, options) {
  sim.calls += 1;
  const timeout = Number(options?.timeout) || 10000;
  const clientId = new URL(url).searchParams.get('posterClientId');
  const delay = sim.latencyMs + (clientId && sim.slowClients[clientId] ? sim.slowClients[clientId] : 0);
  if (sim.mode === 'timeout') { await sleep(timeout + 250); return { result: false, code: 0 }; }
  if (delay > 0) await sleep(delay);
  if (sim.mode === 'down') return { result: false, code: 500 };

  const time = String(Math.floor(Date.now() / 1000) - (sim.mode === 'stale' ? 3600 : 0));
  const headers = { accept: 'application/json', 'x-poster-time': time, 'x-poster-url': sim.mode === 'wrongaccount' ? 'someone-else' : ACCOUNT, 'x-poster-spot-id': sim.spot, 'x-poster-tablet-id': sim.tablet };
  // GET: the body is excluded from the signature (documented) — md5(fullUrl + time + secret).
  if (sim.mode !== 'unsigned') headers['x-poster-signature'] = sim.mode === 'badsig' ? '0'.repeat(32) : md5(url + time + SECRET);
  sim.lastHeaders = Object.keys(headers);
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    const r = await fetch(url, { method: 'GET', headers, signal: ctl.signal });
    clearTimeout(t);
    const text = await r.text();
    let parsed = false;
    try { parsed = JSON.parse(text); } catch { return { result: false, code: 1 }; }
    return { result: parsed, code: r.status };
  } catch {
    return { result: false, code: 0 };
  }
}

http
  .createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    try {
      if (req.method === 'GET' && path === '/') return send(res, 200, readFileSync(join(here, 'index.html')), 'text/html; charset=utf-8');
      if (req.method === 'GET' && path === '/bundle.js') {
        const f = join(here, '..', 'dist', 'bundle.js');
        return existsSync(f) ? send(res, 200, readFileSync(f), 'text/javascript') : send(res, 404, 'run npm run build first', 'text/plain');
      }
      if (req.method === 'POST' && path === '/__poster/makeRequest') {
        const { url, options } = JSON.parse((await readBody(req)) || '{}');
        if (typeof url !== 'string') return send(res, 400, { error: 'url' });
        return send(res, 200, await proxy(url, options));
      }
      if (req.method === 'POST' && path === '/__sim/mode') {
        const b = JSON.parse((await readBody(req)) || '{}');
        if (b.mode) sim.mode = b.mode;
        if (b.latencyMs !== undefined) sim.latencyMs = Number(b.latencyMs) || 0;
        if (b.slowClients) sim.slowClients = b.slowClients;
        return send(res, 200, sim);
      }
      if (req.method === 'GET' && path === '/__sim/state') return send(res, 200, { ...sim, secretConfigured: SECRET !== '', target: process.env.SIM_TARGET || null, account: ACCOUNT });
      send(res, 404, { error: 'not found' });
    } catch (e) {
      send(res, 500, { error: String(e).slice(0, 120) });
    }
  })
  .listen(PORT, '127.0.0.1', () => console.log(`CUP POS simulator on http://127.0.0.1:${PORT}  (secret ${SECRET ? 'configured' : 'MISSING'}, account ${ACCOUNT})`));
