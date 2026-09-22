// Phase 22 experiment tooling — READ helper only (Experiment 3 / Experiment 4's pre-check use it).
// NOT production code: not imported by src/ or pos-widget/, not built, not shipped. Deliberately kept out of both so the
// compiled guarantee "the widget cannot call a mutating Poster method" (see pos-widget/src/poster.ts) is never touched.
//
// Mirrors src/modules/poster/poster.service.ts's own conventions exactly (same base URL, same token-as-query-param
// auth, same HTTP-200-error-envelope handling, same classification into "definite" vs "ambiguous" a failure) rather
// than inventing a second way to talk to Poster. It reads .env directly (same pattern used for every earlier
// read-only real-Poster check in this project) and never logs POSTER_API_TOKEN or POSTER_APPLICATION_SECRET.
import { readFileSync } from 'node:fs';

export function loadEnv(path = 'D:/cup/.env') {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#') && l.includes('='));
  const env = {};
  for (const line of lines) {
    const i = line.indexOf('=');
    env[line.slice(0, i)] = line.slice(i + 1).replace(/^"|"$/g, '');
  }
  return env;
}

const redact = (url) => url.replace(/token=[^&]+/, 'token=***REDACTED***');

// Same shape PosterService.execute() already classifies into: { kind: 'success', response } | { kind: 'definite', ... } (Poster
// processed and rejected — HTTP-200 error envelope or a clean 4xx) | { kind: 'ambiguous', ... } (network/timeout/malformed —
// outcome unknown). Never collapse the last two into one bucket; that distinction is the whole point of Phase 0's idempotency design.
export async function posterGet(env, method, query = {}) {
  const base = env.POSTER_API_BASE_URL.replace(/\/$/, '');
  const url = new URL(`${base}/${method}`);
  url.searchParams.set('token', env.POSTER_API_TOKEN);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

  let res;
  try {
    res = await fetch(url.toString());
  } catch (err) {
    return { kind: 'ambiguous', reason: 'network', message: String(err), urlRedacted: redact(url.toString()) };
  }
  const text = await res.text();
  let parsed;
  try {
    parsed = text.length ? JSON.parse(text) : undefined;
  } catch {
    return { kind: 'ambiguous', reason: 'non-json-body', status: res.status, bodyPreview: text.slice(0, 200), urlRedacted: redact(url.toString()) };
  }
  if (res.ok) {
    if (parsed && typeof parsed === 'object' && 'error' in parsed && parsed.error) {
      return { kind: 'definite', reason: 'poster-error-envelope', status: res.status, error: parsed.error, urlRedacted: redact(url.toString()) };
    }
    if (parsed && typeof parsed === 'object' && 'response' in parsed) {
      return { kind: 'success', response: parsed.response, urlRedacted: redact(url.toString()) };
    }
    return { kind: 'ambiguous', reason: 'no-response-or-error-key', status: res.status, urlRedacted: redact(url.toString()) };
  }
  if (res.status >= 400 && res.status < 500 && parsed) {
    return { kind: 'definite', reason: 'http-4xx', status: res.status, error: parsed, urlRedacted: redact(url.toString()) };
  }
  return { kind: 'ambiguous', reason: 'http-5xx-or-unparseable', status: res.status, urlRedacted: redact(url.toString()) };
}

// POST variant — used ONLY by exp4 (REST mutation), which is separately gated and not executed by this task. Same classification
// rules as posterGet. Poster's documented auth for web (REST) methods is the token as a query parameter on every call, GET and POST alike
// (see src/modules/poster/poster.service.ts's buildUrl) — the body carries the method's own parameters, not the token.
export async function posterPost(env, method, body = {}) {
  const base = env.POSTER_API_BASE_URL.replace(/\/$/, '');
  const url = new URL(`${base}/${method}`);
  url.searchParams.set('token', env.POSTER_API_TOKEN);
  let res;
  try {
    res = await fetch(url.toString(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch (err) {
    return { kind: 'ambiguous', reason: 'network', message: String(err), urlRedacted: redact(url.toString()) };
  }
  const text = await res.text();
  let parsed;
  try {
    parsed = text.length ? JSON.parse(text) : undefined;
  } catch {
    return { kind: 'ambiguous', reason: 'non-json-body', status: res.status, bodyPreview: text.slice(0, 200), urlRedacted: redact(url.toString()) };
  }
  if (res.ok) {
    if (parsed && typeof parsed === 'object' && 'error' in parsed && parsed.error) {
      return { kind: 'definite', reason: 'poster-error-envelope', status: res.status, error: parsed.error, urlRedacted: redact(url.toString()) };
    }
    if (parsed && typeof parsed === 'object' && 'response' in parsed) {
      return { kind: 'success', response: parsed.response, urlRedacted: redact(url.toString()) };
    }
    return { kind: 'ambiguous', reason: 'no-response-or-error-key', status: res.status, urlRedacted: redact(url.toString()) };
  }
  if (res.status >= 400 && res.status < 500 && parsed) {
    return { kind: 'definite', reason: 'http-4xx', status: res.status, error: parsed, urlRedacted: redact(url.toString()) };
  }
  return { kind: 'ambiguous', reason: 'http-5xx-or-unparseable', status: res.status, urlRedacted: redact(url.toString()) };
}

export const nowIso = () => new Date().toISOString();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
