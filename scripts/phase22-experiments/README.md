# Phase 22 experiment tooling

**Not part of the CUP application.** Nothing here is imported by `src/`, `pos-widget/src/`, built,
or shipped. It exists only to answer the blocking questions in
[`docs/PHASE-22-AUDIT.md`](../../docs/PHASE-22-AUDIT.md) §11, safely, with the owner's explicit
approval before every mutating call. Read that document first.

## Status right now

| Experiment | Prepared | Executed | Notes |
| --- | --- | --- | --- |
| 1 — POS `addProduct` | Yes (`exp1-exp2-console.js`) | **No** | needs a named test product id from the owner |
| 2 — POS `setOrderBonus` | Yes (same file) | **No** | run only after Experiment 1, same test order |
| 3 — REST open-order visibility | Yes (`exp3-open-order-visibility.mjs`) | **Plumbing dry run only**, against an already-closed receipt | the real experiment needs the owner's open test order |
| 4 — REST `addTransactionProduct` | Yes (`exp4-addTransactionProduct.mjs`) | **No** | double-gated; needs Experiment 3's `transaction_id` first |
| §7 — POST signature | Not preparable in this pass | No | requires a widget change (a POST call) that does not exist; explicitly out of scope for an audit-only task |

## The one rule that matters

**Nothing here runs against a real order without the owner's explicit chat approval, immediately
before that specific call.** Every mutating script or function has its own extra gate on top of
that (a `confirm()` dialog in the browser scripts, a typed confirmation phrase in the Node
script) — those are defense in depth, not a substitute for asking first.

## Order of operations

1. **Owner:** create ONE unpaid test order on a real (or test) register. Do not close or pay it,
   at any point, for the whole sequence below.
2. **Before** the order exists (or right after, either is fine — it only needs to predate the
   order): run
   ```
   node scripts/phase22-experiments/exp3-open-order-visibility.mjs snapshot
   ```
   Safe, read-only, no approval needed — it only lists today's already-existing transactions.
3. **After** the test order is open, tell me. I run
   ```
   node scripts/phase22-experiments/exp3-open-order-visibility.mjs watch 8
   ```
   Read-only. Reports the new transaction's id, status, products, total and the time it took to
   become visible.
4. On the register itself, open DevTools, paste `exp1-exp2-console.js`, then run
   `phase22.readOrder()` — safe, any time.
5. Only once you approve Experiment 1 specifically, with a real Poster product id in hand: run
   `phase22.exp1_addProduct(<productId>)` in that same console. It will ask again via a browser
   confirm dialog. Then `phase22.readOrder()` again.
6. Only once you approve Experiment 2 specifically, with a small test number (not a real reward
   value): run `phase22.exp2_setOrderBonus(<smallNumber>)`. Same double gate. Then
   `phase22.readOrder()` again.
7. Experiment 4 is not run in this pass. If it is ever approved later, it additionally requires
   Experiment 3's `transaction_id` for the same order and the exact confirmation phrase printed by
   the script.
8. Leave the test order open and unpaid at the end. Nothing here ever closes or pays it.

## What is NOT included

- Any change to `pos-widget/src/poster.ts`'s `PosterApi` — it still cannot express a forbidden
  call; nothing here weakens that.
- Any change to the backend, the reward services, or the database.
- A working answer to §7 (POST signature) — it needs a widget change, which is out of scope for
  an audit/experiment-preparation task.
