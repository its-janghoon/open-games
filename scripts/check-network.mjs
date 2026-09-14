#!/usr/bin/env node
/**
 * Mission gate: the shipped games must make ZERO third-party runtime requests.
 *
 * The promise is that a player on metered data pays for the game and nothing else
 * - no font CDN, no analytics beacon, no ad call - and that the games keep working
 * when the network does not. A promise nobody measures decays, so it is a build
 * gate, and its output is the evidence the sponsorship page is generated from.
 *
 * Runs on BUILT output: a dependency can emit a request the source never shows.
 *
 * Usage:
 *   node scripts/check-network.mjs            # fail on anything not baselined
 *   node scripts/check-network.mjs --list     # print findings, exit 0
 *   node scripts/check-network.mjs --json     # machine-readable, for the report
 *   node scripts/check-network.mjs --selftest # prove the gate still detects
 *   node scripts/check-network.mjs --update   # rewrite the baseline
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runGate } from './lib/gate-runner.mjs';
import { scanHtml, scanCode, JS_SHAPES, CSS_SHAPES } from './lib/network-refs.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * A gate that reports zero is indistinguishable from a gate that is broken, and
 * this one reports zero on real output - so the both-directions proof is built in
 * and runs before every scan. scripts/ has no test runner, which is why the proof
 * lives in the tool.
 */
const SELFTEST = {
  html: {
    text: [
      '<script src="https://cdn.jsdelivr.net/npm/x.js"></script>',
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">',
      '<link rel="preconnect" href="https://fonts.gstatic.com">',
      '<img src="//images.example.com/pixel.gif">',
      '<iframe src="https://ads.example.com/frame"></iframe>',
      '<use href="https://icons.example.com/sprite.svg#x"/>',
      '<meta http-equiv="refresh" content="0;url=https://elsewhere.example.com">',
      // Must NOT trip: an anchor fetches nothing until the user chooses to leave.
      '<a href="https://github.com/savagemanage/open-games">repo</a>',
      // Must NOT trip: a namespace identifier is never fetched.
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>',
    ].join('\n'),
    expect: 7,
    forbid: ['github.com', 'w3.org'],
  },
  css: {
    text: [
      '@import url("https://fonts.googleapis.com/css2?family=Archivo");',
      'body { background: url(https://cdn.example.com/bg.png); }',
      '.local { background: url(./local.png); }',
    ].join('\n'),
    expect: 3, // two url() plus the @import
    forbid: ['local.png'],
  },
  js: {
    text: [
      'fetch("https://api.example.com/track");',
      'navigator.sendBeacon("https://analytics.example.com/hit","x");',
      'new WebSocket("wss://relay.example.com");',
      'const w = new Worker("https://cdn.example.com/w.js");',
      'img.src = "https://tracker.example.com/p.gif";',
      'import("https://esm.sh/left-pad");',
      '// licence header, must NOT trip: https://opensource.org/licenses/Apache-2.0',
      'const local = await fetch("/api/local");',
    ].join('\n'),
    expect: 6,
    forbid: ['opensource.org', '/api/local'],
  },
};

function selftest() {
  let problems = 0;
  const cases = [
    ['html', scanHtml(SELFTEST.html.text, 'selftest.html'), SELFTEST.html],
    ['css', scanCode(SELFTEST.css.text, 'selftest.css', CSS_SHAPES), SELFTEST.css],
    ['js', scanCode(SELFTEST.js.text, 'selftest.js', JS_SHAPES), SELFTEST.js],
  ];
  for (const [name, found, spec] of cases) {
    if (found.length !== spec.expect) {
      console.error(
        `  selftest ${name}: expected ${spec.expect} finding(s), got ${found.length}` +
          ` -> ${found.map((f) => `${f.kind}@${f.host}`).join(', ')}`,
      );
      problems += 1;
    } else {
      console.log(`  selftest ${name}: ${found.length} caught, none leaked`);
    }
    for (const needle of spec.forbid) {
      // Checked against the matched TARGET only. An earlier version compared a
      // wide context slice and reported a phantom leak on a local url() that
      // merely sat on the next line; that is what prompted the target field.
      const leaked = found.filter((f) => `${f.host} ${f.target}`.includes(needle));
      if (leaked.length > 0) {
        console.error(`  selftest ${name}: FALSE POSITIVE on '${needle}' (${leaked[0].kind})`);
        problems += 1;
      }
    }
  }
  return problems;
}

runGate({
  name: 'check:network',
  root: ROOT,
  baselineFile: join(ROOT, 'scripts', 'network-baseline.json'),
  promise:
    'A player on metered data pays for the game and nothing else, and the games\n' +
    'work offline. Remove the request, or - if it is genuinely not a runtime fetch\n' +
    '- narrow the rule in scripts/lib/network-refs.mjs rather than baselining it.',
  scan: (text, file, ext) => {
    if (ext === '.html') return scanHtml(text, file);
    if (ext === '.css') return scanCode(text, file, CSS_SHAPES);
    if (ext === '.js' || ext === '.mjs') return scanCode(text, file, JS_SHAPES);
    return [];
  },
  selftest,
});
