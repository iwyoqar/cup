/*
 * Phase 22 — Experiments 1 & 2: what does the real Poster POS `orders.addProduct` / `orders.setOrderBonus` actually do to a
 * real open order?
 *
 * THIS IS NOT PART OF THE CUP CODEBASE. It is never bundled, never served, never run automatically. It is pasted, by hand,
 * into the browser DevTools console while the register (https://<account>.joinposter.com/pos) is open on the ONE agreed
 * unpaid test order. It exists ONLY because pos-widget/src/poster.ts deliberately does NOT expose addProduct / setOrderBonus
 * — the production widget cannot call them, by construction, and this script does not change that file.
 *
 * SAFETY RULES (same as docs/PHASE-22-AUDIT.md §12):
 *   - ONE unpaid test order. Never close it, never pay it, never send it to payment.
 *   - Read first (phase22.readOrder()), always, before and after any mutation.
 *   - Do NOT call exp1_addProduct or exp2_setOrderBonus until the owner has said "go" for THAT SPECIFIC call in chat.
 *   - Each mutating function still asks for confirmation in the browser itself (a native confirm() dialog) as a second gate.
 *   - No loops, no retries. Call each mutating function AT MOST ONCE per experiment step.
 *   - This script never calls closeOrder, create, setOrderClient, clients.create, or any `before*`-blocking flow.
 *
 * Usage:
 *   1. Paste this whole file into the console on the order screen for the test order.
 *   2. Run:  phase22.readOrder()                          -> copy the printed BEFORE state somewhere safe
 *   3. Only after explicit chat approval:
 *            phase22.exp1_addProduct(<posterProductId>)    -> confirm() will ask again; then it adds ONE unit of that product
 *   4. Run:  phase22.readOrder()                           -> copy the AFTER state; compare against BEFORE by hand
 *   5. Only after explicit chat approval:
 *            phase22.exp2_setOrderBonus(<smallTestAmount>) -> confirm() will ask again; use a small number, not a real reward value
 *   6. Run:  phase22.readOrder()                           -> copy the final state
 *   7. Do NOT close or pay the order. Leave it as is and report back what was printed.
 */
(function () {
  const P = typeof Poster !== 'undefined' ? Poster : window.Poster;
  if (!P) {
    console.error('[phase22] window.Poster / bare Poster is not available — is this console attached to the POS register page?');
    return;
  }

  function snapshot(label) {
    return P.orders
      .getActive()
      .then((data) => {
        const order = data && data.order;
        if (!order) {
          console.warn('[phase22] ' + label + ': no active order (are you on the order screen for the test order?)');
          return null;
        }
        const out = {
          label,
          at: new Date().toISOString(),
          id: order.id,
          clientId: order.clientId,
          total: order.total,
          subtotal: order.subtotal,
          discount: order.discount,
          payedSum: order.payedSum,
          payedBonus: order.payedBonus, // the field Experiment 2 is watching
          approvedBonus: order.approvedBonus,
          loyaltyAppId: order.loyaltyAppId, // the field Poster's docs say setOrderBonus also writes
          products: order.products,
        };
        console.log('[phase22] ' + label + ' snapshot:');
        console.log(JSON.stringify(out, null, 2));
        return out;
      })
      .catch((err) => {
        console.error('[phase22] ' + label + ': getActive() failed', err);
        return null;
      });
  }

  window.phase22 = {
    // Safe to call any time, as often as needed. Never mutates anything.
    readOrder: () => snapshot('read'),

    // EXPERIMENT 1 — mutates the order. Adds exactly ONE unit of the given Poster product id, at whatever price Poster's
    // own catalog has for it (documented: addProduct takes no price/discount argument). Call phase22.readOrder() before
    // and after. Requires the owner to supply a real, known, low-consequence Poster product id — this script does not
    // guess one.
    exp1_addProduct: async function (posterProductId) {
      if (!posterProductId) return console.error('[phase22] exp1_addProduct(productId) needs a Poster product id.');
      const orderId = (await P.orders.getActive()).order && (await P.orders.getActive()).order.id;
      if (!orderId) return console.error('[phase22] no active order — open the test order first.');
      const ok = window.confirm(
        '[Phase 22 — Experiment 1]\n\nThis will call Poster.orders.addProduct(' +
          orderId +
          ', { id: ' +
          posterProductId +
          ' }) on the CURRENT open order.\n\n' +
          'It will NOT close or pay the order. Only proceed if the owner explicitly approved THIS call in chat just now.\n\n' +
          'Proceed?',
      );
      if (!ok) return console.log('[phase22] exp1_addProduct: cancelled by operator.');
      console.log('[phase22] calling orders.addProduct(' + orderId + ', { id: ' + posterProductId + ' }) ...');
      try {
        const result = await P.orders.addProduct(orderId, { id: Number(posterProductId) });
        console.log('[phase22] addProduct result:');
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        console.error('[phase22] addProduct threw:', err);
      }
      await snapshot('after exp1_addProduct');
    },

    // EXPERIMENT 2 — mutates the order. Calls setOrderBonus with a SMALL TEST VALUE (never a real reward amount, since the
    // unit is unverified — see docs/PHASE-22-AUDIT.md §11.2). Call phase22.readOrder() before and after.
    exp2_setOrderBonus: async function (testAmount) {
      if (testAmount === undefined || testAmount === null) return console.error('[phase22] exp2_setOrderBonus(amount) needs a small test number, e.g. 1.');
      const orderId = (await P.orders.getActive()).order && (await P.orders.getActive()).order.id;
      if (!orderId) return console.error('[phase22] no active order — open the test order first.');
      const ok = window.confirm(
        '[Phase 22 — Experiment 2]\n\nThis will call Poster.orders.setOrderBonus(' +
          orderId +
          ', ' +
          testAmount +
          ') on the CURRENT open order.\n\n' +
          'Poster documents this as "amount paid via an external system" (points), not a discount. Its unit and effect on a real ' +
          'order are UNVERIFIED. It may overwrite an existing payedBonus.\n\n' +
          'It will NOT close or pay the order. Only proceed if the owner explicitly approved THIS call in chat just now.\n\n' +
          'Proceed?',
      );
      if (!ok) return console.log('[phase22] exp2_setOrderBonus: cancelled by operator.');
      console.log('[phase22] calling orders.setOrderBonus(' + orderId + ', ' + testAmount + ') ...');
      try {
        const result = await P.orders.setOrderBonus(orderId, testAmount);
        console.log('[phase22] setOrderBonus result:');
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        console.error('[phase22] setOrderBonus threw:', err);
      }
      await snapshot('after exp2_setOrderBonus');
    },
  };

  console.log('[phase22] ready. Run phase22.readOrder() first. Do not call the exp1_/exp2_ functions without explicit chat approval for that specific call.');
})();
