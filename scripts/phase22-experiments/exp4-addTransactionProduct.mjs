// Phase 22 — Experiment 4: REST transactions.addTransactionProduct with price:0 on the OPEN test order.
//
// PREPARED, NOT EXECUTED. This file was written so it exists and can be reviewed, per the task's explicit instruction
// ("Prepare the experiment tooling/code if necessary, but DO NOT execute the mutation yet"). It has never been run.
//
// It will not run by accident:
//   1. It refuses to do anything unless invoked with --confirm.
//   2. Even with --confirm, it requires typing the exact phrase "I HAVE OWNER APPROVAL FOR EXP4" at an interactive prompt.
//   3. It requires --transaction-id, --product-id, --spot-id, --spot-tablet-id to be passed explicitly — nothing is guessed
//      or defaulted, especially not transaction_id (see docs/PHASE-22-AUDIT.md §11.3: whether it maps reliably to the open
//      register order at all is the open question Experiment 3 answers FIRST).
//
// Per the brief: do not run this until (a) Experiment 3 has shown the open order's transaction_id, and (b) the owner has
// given explicit chat approval for this specific call.
import { createInterface } from 'node:readline/promises';
import { loadEnv, nowIso, posterPost } from './lib/poster-rest.mjs';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  if (!process.argv.includes('--confirm')) {
    console.log('Refusing to run without --confirm. This experiment mutates a real Poster order line. See the file header.');
    console.log('usage: node exp4-addTransactionProduct.mjs --confirm --transaction-id <id> --product-id <id> --spot-id <id> --spot-tablet-id <id>');
    return;
  }
  const transactionId = arg('transaction-id');
  const productId = arg('product-id');
  const spotId = arg('spot-id');
  const spotTabletId = arg('spot-tablet-id');
  if (!transactionId || !productId || !spotId || !spotTabletId) {
    console.log('Missing a required --transaction-id / --product-id / --spot-id / --spot-tablet-id. Nothing was sent.');
    return;
  }

  console.log('=== Phase 22 — Experiment 4: transactions.addTransactionProduct(price: 0) ===');
  console.log(`transaction_id=${transactionId}  product_id=${productId}  spot_id=${spotId}  spot_tablet_id=${spotTabletId}`);
  console.log('This is a REAL mutation against a REAL Poster order if that transaction_id is truly the open test order.');
  console.log('Do NOT proceed unless: (1) Experiment 3 already confirmed this transaction_id belongs to the ONE unpaid test');
  console.log('order, and (2) the owner explicitly approved this exact call in chat, just now.\n');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Type exactly "I HAVE OWNER APPROVAL FOR EXP4" to proceed, anything else cancels: ');
  rl.close();
  if (answer !== 'I HAVE OWNER APPROVAL FOR EXP4') {
    console.log('Cancelled. Nothing was sent.');
    return;
  }

  const env = loadEnv();
  console.log(`[${nowIso()}] sending transactions.addTransactionProduct ...`);
  const result = await posterPost(env, 'transactions.addTransactionProduct', {
    spot_id: Number(spotId),
    spot_tablet_id: Number(spotTabletId),
    transaction_id: Number(transactionId),
    product_id: Number(productId),
    price: 0,
  });
  console.log(JSON.stringify(result, null, 2));
  console.log('\nNow manually compare: does the register\'s own screen show this line, and at what price? Does the order total change?');
  console.log('Do NOT close or pay the order.');
}

main();
