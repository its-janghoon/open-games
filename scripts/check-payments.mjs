#!/usr/bin/env node
/**
 * Mission gate: the shipped games must contain NO payment code.
 *
 * Not "no aggressive monetisation" - none. The project is funded by sponsorship
 * and portal revenue share precisely so that a player who cannot pay is not a
 * second-class player, and the way that commitment survives contact with future
 * contributors is that the build refuses to produce a bundle able to take money.
 *
 * Runs on BUILT output: a dependency can carry a processor SDK the source never
 * mentions.
 *
 * Usage:
 *   node scripts/check-payments.mjs            # fail on anything not baselined
 *   node scripts/check-payments.mjs --list     # print findings, exit 0
 *   node scripts/check-payments.mjs --json     # machine-readable, for the report
 *   node scripts/check-payments.mjs --selftest # prove the gate still detects
 *   node scripts/check-payments.mjs --update   # rewrite the baseline
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runGate } from './lib/gate-runner.mjs';
import { scanPaymentHtml, scanPaymentCode } from './lib/payment-refs.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * Both directions, and the must-NOT-trip half is the important half here.
 *
 * champs is a MOBA with an in-match item shop, so its own vocabulary collides with
 * payment vocabulary everywhere: a `purchase` command type on the wire, a
 * PurchaseCommand interface, an item described as a "top-end purchase". Those exact
 * strings are fixtures below, because the failure mode for this gate is not missing
 * a Stripe SDK - it is crying wolf 40 times about gameplay until someone deletes
 * the gate.
 */
const MUST_TRIP = {
  html: [
    '<script src="https://js.stripe.com/v3/"></script>',
    '<iframe src="https://checkout.stripe.com/pay/cs_test_x"></iframe>',
    '<form action="https://www.paypal.com/cgi-bin/webscr" method="post"></form>',
  ].join('\n'),
  htmlExpect: 3,
  js: [
    'const stripe = new Stripe("pk_live_abc");',
    'paypal.Buttons({ createOrder }).render("#paypal");',
    'braintree.client.create({ authorization: t });',
    'new AdyenCheckout({ environment: "live" });',
    'new Razorpay({ key: "rzp_live_x" }).open();',
    'TossPayments("live_ck_x").requestPayment("카드", {});',
    'IMP.request_pay({ pg: "html5_inicis" });',
    'PortOne.requestPayment({ storeId: "store-x" });',
    'const req = new PaymentRequest(methods, details);',
    'if (window.ApplePaySession) {}',
    'google.payments.api.PaymentsClient;',
    'billing.launchBillingFlow(params);',
    'SKPaymentQueue.default().add(payment);',
    'CdvPurchase.store.register([]);',
    'store.order("com.example.gems");',
    'fetch("https://api.stripe.com/v1/charges");',
  ].join('\n'),
  jsExpect: 16, // 15 SDK/API shapes plus the api.stripe.com host
  // A card field is a payment form even with no named SDK. It lives in the code
  // shapes but is HTML, which is why the gate runs both scanners over .html - the
  // selftest is what surfaced that it was otherwise unreachable.
  cardHtml: '<input autocomplete="cc-number" name="card"><input autocomplete="cc-csc">',
  cardExpect: 2,
};

/** Real strings from this repo that MUST NOT trip the gate. */
const MUST_NOT_TRIP = {
  js: [
    // champs' wire protocol - gameplay, not money.
    "export type CommandType = 'move' | 'cast' | 'purchase' | 'surrender';",
    "export interface PurchaseCommand extends CommandBase { type: 'purchase'; }",
    '/** True for a build-defining legendary (top-end purchase for its archetype). */',
    'const cost = item.price * quantity; // in-match gold',
    'shop.purchase(itemId); // spends earned gold',
    // Documentation and licence text mentioning a processor is not an integration.
    '// We deliberately do not integrate Stripe or PayPal. See MISSION.md.',
    'const unlockPrice = 500; // earned currency, never real money',
  ].join('\n'),
  html: '<a href="https://github.com/savagemanage/open-games/blob/main/MISSION.md">why no payments</a>',
};

function selftest() {
  let problems = 0;

  const htmlHits = scanPaymentHtml(MUST_TRIP.html, 'selftest.html');
  if (htmlHits.length !== MUST_TRIP.htmlExpect) {
    console.error(
      `  selftest html: expected ${MUST_TRIP.htmlExpect}, got ${htmlHits.length}` +
        ` -> ${htmlHits.map((f) => f.kind).join(', ')}`,
    );
    problems += 1;
  } else {
    console.error(`  selftest html: ${htmlHits.length} integration(s) caught`);
  }

  const jsHits = scanPaymentCode(MUST_TRIP.js, 'selftest.js');
  if (jsHits.length !== MUST_TRIP.jsExpect) {
    console.error(
      `  selftest js: expected ${MUST_TRIP.jsExpect}, got ${jsHits.length}` +
        ` -> ${jsHits.map((f) => f.kind).join(', ')}`,
    );
    problems += 1;
  } else {
    console.error(`  selftest js: ${jsHits.length} integration(s) caught`);
  }

  const cardHits = scanPaymentCode(MUST_TRIP.cardHtml, 'selftest-card.html');
  if (cardHits.length !== MUST_TRIP.cardExpect) {
    console.error(`  selftest card fields: expected ${MUST_TRIP.cardExpect}, got ${cardHits.length}`);
    problems += 1;
  } else {
    console.error(`  selftest card fields: ${cardHits.length} caught`);
  }

  const falseJs = scanPaymentCode(MUST_NOT_TRIP.js, 'gameplay.js');
  const falseHtml = scanPaymentHtml(MUST_NOT_TRIP.html, 'gameplay.html');
  const leaked = [...falseJs, ...falseHtml];
  if (leaked.length > 0) {
    for (const f of leaked) console.error(`  selftest: FALSE POSITIVE ${f.kind} on '${f.target}'`);
    problems += 1;
  } else {
    console.error('  selftest gameplay: in-match shop vocabulary correctly ignored');
  }

  return problems;
}

runGate({
  name: 'check:payments',
  root: ROOT,
  baselineFile: join(ROOT, 'scripts', 'payments-baseline.json'),
  promise:
    'The games take no money. Funding is sponsorship and portal revenue share so\n' +
    'that a player who cannot pay is not a second-class player. Remove the\n' +
    'integration; do not baseline it.',
  scan: (text, file, ext) => {
    // HTML gets BOTH scanners. The selftest caught this: the card-field rule is an
    // HTML attribute but lived only in the code shapes, so it was unreachable for
    // .html files - an inline script or a payment form in markup would have walked
    // straight through the gate.
    if (ext === '.html') return [...scanPaymentHtml(text, file), ...scanPaymentCode(text, file)];
    if (ext === '.js' || ext === '.mjs' || ext === '.css') return scanPaymentCode(text, file);
    return [];
  },
  selftest,
});
