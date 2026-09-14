/**
 * Rules for finding real payment code in a BUILT bundle.
 *
 * Why not a word search: measured on this repo's own bundles, "purchase" appears
 * 40 times and every one is legitimate. champs is a MOBA - it has an in-match item
 * shop, so its wire protocol carries a `purchase` command and its item table calls
 * a legendary a "top-end purchase for its archetype". Those are gameplay. A gate
 * that greps for payment WORDS would report 40 violations where the honest count is
 * zero, and a gate that cries wolf 40 times gets switched off.
 *
 * What is actually disqualifying is an INTEGRATION: code that can move real money
 * or reach a processor. That has a small number of recognisable shapes, and none of
 * them can be written by accident.
 */

/** Processor and billing hosts. A remote reference to one of these is decisive. */
const PROCESSOR_HOSTS = [
  'js.stripe.com',
  'checkout.stripe.com',
  'api.stripe.com',
  'paypal.com',
  'paypalobjects.com',
  'braintreegateway.com',
  'braintree-api.com',
  'checkoutshopper-live.adyen.com',
  'adyen.com',
  'checkout.razorpay.com',
  'api.razorpay.com',
  'js.tosspayments.com',
  'api.tosspayments.com',
  'cdn.iamport.kr',
  'cdn.portone.io',
  'pay.google.com',
  'apple-pay-gateway.apple.com',
  'squareupsandbox.com',
  'web.squarecdn.com',
  'checkout.lemonsqueezy.com',
  'js.paddle.com',
  'checkout.paddle.com',
  'pay.kakao.com',
  'nid.naver.com/paymentGateway',
];

/**
 * SDK entry points and platform billing APIs. These are matched as CALLS or
 * property accesses, not as bare words, so a comment mentioning Stripe does not
 * trip the gate while `new Stripe(...)` does.
 */
const CODE_SHAPES = [
  ['Stripe SDK', /\bnew\s+Stripe\s*\(|\bwindow\.Stripe\b|\bStripe\s*\(\s*["'`]pk_/g],
  ['PayPal SDK', /\bpaypal\s*\.\s*(Buttons|Marks|HostedFields|order)\b/g],
  ['Braintree SDK', /\bbraintree\s*\.\s*(client|hostedFields|dropin)\b/g],
  ['Adyen SDK', /\bnew\s+AdyenCheckout\s*\(|\bAdyenCheckout\s*\(\s*\{/g],
  ['Razorpay SDK', /\bnew\s+Razorpay\s*\(/g],
  ['Toss Payments SDK', /\bTossPayments\s*\(\s*["'`]/g],
  ['Iamport SDK', /\bIMP\s*\.\s*(init|request_pay)\s*\(/g],
  ['PortOne SDK', /\bPortOne\s*\.\s*requestPayment\s*\(/g],
  ['Payment Request API', /\bnew\s+PaymentRequest\s*\(/g],
  ['Apple Pay', /\bApplePaySession\b/g],
  ['Google Pay', /\bgoogle\s*\.\s*payments\s*\.\s*api\b/g],
  ['Play Billing', /\bBillingClient\b|\blaunchBillingFlow\s*\(/g],
  ['StoreKit', /\bSKPaymentQueue\b|\bSKProductsRequest\b/g],
  ['Cordova IAP plugin', /\bCdvPurchase\b|\bcordova\s*\.\s*plugins\s*\.\s*inAppPurchase\b/g],
  ['store.order()', /\bstore\s*\.\s*order\s*\(\s*["'`]/g],
  // A card field is a payment form even without a named SDK.
  ['card input field', /autocomplete\s*=\s*["'](cc-number|cc-csc|cc-exp)["']/g],
];

/** A remote target: absolute http(s) or protocol-relative. */
const REMOTE = String.raw`(?:https?:)?//`;

/** Tags whose remote target is fetched or submitted to. */
const SUBMITTING_TAGS = /<\s*(script|iframe|form|link)\b([^>]*)>/g;

function lineAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

function matchedHost(url) {
  const m = url.match(new RegExp(String.raw`(?:https?:)?//([^/"'\`)\s]+)`));
  return m ? m[1].toLowerCase() : '';
}

function isProcessorHost(host) {
  return PROCESSOR_HOSTS.some((h) => host === h || host.endsWith(`.${h}`) || host.includes(h));
}

/** Scan built HTML for a tag pointing at a processor. */
export function scanPaymentHtml(text, file) {
  const findings = [];
  let m;
  SUBMITTING_TAGS.lastIndex = 0;
  while ((m = SUBMITTING_TAGS.exec(text)) !== null) {
    const tag = m[1].toLowerCase();
    const attrRe = new RegExp(String.raw`\b(src|href|action)\s*=\s*["'](${REMOTE}[^"']*)["']`, 'i');
    const hit = m[2].match(attrRe);
    if (!hit) continue;
    const host = matchedHost(hit[2]);
    if (!isProcessorHost(host)) continue;
    findings.push({
      file,
      line: lineAt(text, m.index),
      kind: `<${tag}> to payment processor`,
      target: hit[2].slice(0, 90),
    });
  }
  return findings;
}

/** Scan built JS or CSS for a processor host or an SDK call. */
export function scanPaymentCode(text, file) {
  const findings = [];

  // A processor host anywhere in shipped code is disqualifying regardless of the
  // call that surrounds it: there is no innocent reason for it to be there.
  const urlRe = new RegExp(String.raw`${REMOTE}[^\s"'\`)]{3,120}`, 'g');
  let m;
  while ((m = urlRe.exec(text)) !== null) {
    const host = matchedHost(m[0]);
    if (!isProcessorHost(host)) continue;
    findings.push({
      file,
      line: lineAt(text, m.index),
      kind: 'payment processor host',
      target: m[0].slice(0, 90),
    });
  }

  for (const [kind, re] of CODE_SHAPES) {
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      findings.push({
        file,
        line: lineAt(text, m.index),
        kind,
        target: m[0].replace(/\s+/g, ' ').slice(0, 90),
      });
    }
  }
  return findings;
}

export { PROCESSOR_HOSTS, CODE_SHAPES };
