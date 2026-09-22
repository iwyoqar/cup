// Phase 22 — Experiment 3: how long does a still-OPEN Poster register order take to become visible over REST, and does its
// id line up with what the register shows? READ-ONLY. Mutates nothing, ever. Not production code (see lib/poster-rest.mjs).
//
// Uses dash.getTransactions with status '0' (all statuses — the same call src/modules/poster/poster.service.ts's
// getClosedTransactions already makes, just without pinning status to '2') because dash.getTransaction (singular) needs a
// transaction_id we do not have until the order is visible in the first place.
//
// Usage:
//   node exp3-open-order-visibility.mjs snapshot            # run BEFORE the owner opens the test order (safe any time)
//   node exp3-open-order-visibility.mjs watch [minutes]     # run AFTER the owner says "the test order is open now"
//   node exp3-open-order-visibility.mjs dry-run <knownId>   # plumbing check against an ALREADY-CLOSED, previously-seen receipt
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { loadEnv, nowIso, posterGet, sleep } from './lib/poster-rest.mjs';

const SNAPSHOT_FILE = new URL('./exp3-snapshot.json', import.meta.url);
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const todayWindow = () => {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000); // the account's business day is UTC+3; widen by a day like the existing reconciliation code does
  return { dateFrom: ymd(yesterday), dateTo: ymd(now) };
};

async function listAll(env) {
  const { dateFrom, dateTo } = todayWindow();
  const r = await posterGet(env, 'dash.getTransactions', { dateFrom, dateTo, status: '0', include_products: 'true' });
  return r;
}

async function cmdSnapshot(env) {
  console.log(`[${nowIso()}] reading dash.getTransactions (status=0, today's window) — this is the BEFORE picture, read-only`);
  const r = await listAll(env);
  if (r.kind !== 'success') return console.log('FAILED:', JSON.stringify(r, null, 1));
  const ids = (r.response || []).map((t) => String(t.transaction_id)).sort();
  writeFileSync(SNAPSHOT_FILE, JSON.stringify({ takenAt: nowIso(), ids }, null, 1));
  console.log(`Snapshot saved: ${ids.length} transaction id(s) seen. Now ask the owner to open the ONE unpaid test order, then run "watch".`);
}

async function cmdWatch(env, minutes) {
  if (!existsSync(SNAPSHOT_FILE)) return console.log('Run "snapshot" first (before the test order was opened).');
  const before = JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8'));
  const beforeSet = new Set(before.ids);
  const deadline = Date.now() + minutes * 60000;
  const t0 = Date.now();
  console.log(`[${nowIso()}] watching for a new transaction id (not in the before-snapshot of ${before.ids.length}), up to ${minutes} min, polling every 20 s (bounded, not a tight loop)`);
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    const r = await listAll(env);
    if (r.kind !== 'success') {
      console.log(`[${nowIso()}] attempt ${attempt}: FAILED ${JSON.stringify(r)}`);
    } else {
      const rows = r.response || [];
      const fresh = rows.filter((t) => !beforeSet.has(String(t.transaction_id)));
      console.log(`[${nowIso()}] attempt ${attempt}: ${rows.length} total, ${fresh.length} new`);
      if (fresh.length > 0) {
        const elapsedSec = Math.round((Date.now() - t0) / 1000);
        console.log(`\n=== NEW TRANSACTION VISIBLE after ~${elapsedSec}s ===`);
        for (const t of fresh) {
          console.log(
            JSON.stringify(
              {
                transaction_id: t.transaction_id,
                status: t.status, // 1 = open, 2 = closed, 3 = removed (per docs)
                spot_id: t.spot_id,
                table_id: t.table_id,
                client_id: t.client_id,
                sum: t.sum,
                payed_sum: t.payed_sum,
                bonus: t.bonus,
                discount: t.discount,
                date_close: t.date_close,
                productLines: Array.isArray(t.products) ? t.products.length : 'n/a',
                products: t.products,
              },
              null,
              1,
            ),
          );
        }
        console.log('\nCompare this against what the register shows (order id, products, total) and record the match/mismatch by hand.');
        return;
      }
    }
    await sleep(20000);
  }
  console.log(`[${nowIso()}] timed out after ${minutes} min with no new transaction visible. This itself is a finding (sync delay > ${minutes} min, or the order never syncs while open).`);
}

async function cmdDryRun(env, id) {
  console.log(`[${nowIso()}] plumbing check ONLY — reading an ALREADY-CLOSED, previously-imported receipt (#${id}) to prove auth + parsing work. This is NOT Experiment 3.`);
  const r = await posterGet(env, 'dash.getTransaction', { transaction_id: id, include_products: 'true', status: '0' });
  console.log(JSON.stringify(r.kind === 'success' ? { kind: 'success', transaction_id: r.response?.[0]?.transaction_id ?? r.response?.transaction_id, status: r.response?.[0]?.status ?? r.response?.status } : r, null, 1));
}

const [, , cmd, arg] = process.argv;
const env = loadEnv();
if (cmd === 'snapshot') await cmdSnapshot(env);
else if (cmd === 'watch') await cmdWatch(env, Number(arg || 8));
else if (cmd === 'dry-run' && arg) await cmdDryRun(env, arg);
else console.log('usage: node exp3-open-order-visibility.mjs snapshot | watch [minutes] | dry-run <knownClosedId>');
