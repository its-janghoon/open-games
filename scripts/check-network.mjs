#!/usr/bin/env node
/**
 * Mission gate: the shipped games must make ZERO third-party runtime requests.
 *
 * This is the first of the mission gates, and the one the others lean on. The
 * promise is that a player on metered data pays for the game and nothing else -
 * no font CDN, no analytics beacon, no ad call - and that the games keep working
 * when the network does not. A promise nobody measures decays, so it is a build
 * gate.
 *
 * Runs on BUILT output, so `npm run build` must have produced it. Source is not
 * scanned on purpose: a dependency can emit a request the source never shows.
 *
 * Usage:
 *   node scripts/check-network.mjs           # fail on anything not baselined
 *   node scripts/check-network.mjs --list    # print findings, exit 0
 *   node scripts/check-network.mjs --update  # rewrite the baseline
 *   node scripts/check-network.mjs --selftest # prove the gate still detects
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanHtml, scanCode, JS_SHAPES, CSS_SHAPES } from './lib/network-refs.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const BASELINE = join(ROOT, 'scripts', 'network-baseline.json');
const SCAN_ROOTS = ['_site', ...readdirSyncSafe(join(ROOT, 'packages')).map((p) => `packages/${p}/dist`)];

/**
 * A gate that reports zero is indistinguishable from a gate that is broken, and
 * this one currently reports zero on real output. So the both-directions proof is
 * built in rather than run once by hand: --selftest feeds it code that MUST trip
 * it and code that must NOT, and fails if either expectation breaks. scripts/ has
 * no test runner, so this is how the proof stays runnable.
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
  let bad = 0;
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
      bad += 1;
    }
    for (const needle of spec.forbid) {
      // Checked against the matched TARGET only. An earlier version compared a
      // wide context slice and reported a phantom leak on a local url() that
      // merely sat on the next line; that is what prompted the target field.
      const leaked = found.filter((f) => `${f.host} ${f.target}`.includes(needle));
      if (leaked.length > 0) {
        console.error(`  selftest ${name}: FALSE POSITIVE on '${needle}' (${leaked[0].kind})`);
        bad += 1;
      }
    }
    if (found.length === spec.expect) console.log(`  selftest ${name}: ${found.length} caught, none leaked`);
  }
  if (bad > 0) {
    console.error(`check:network selftest FAILED with ${bad} problem(s) - the gate itself is wrong.`);
    process.exit(3);
  }
  console.log('check:network selftest OK - catches every request shape, ignores anchors and namespaces.');
}

function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

if (process.argv.includes('--selftest')) {
  selftest();
  process.exit(0);
}

// Always self-check before trusting a scan result. Cheap (three regex passes over
// a few hundred bytes) and it is the difference between "zero requests" and "the
// gate stopped working".
selftest();

const files = [];
for (const rel of SCAN_ROOTS) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) continue;
  files.push(...walk(abs));
}

if (files.length === 0) {
  console.error(
    'check:network found no built output to scan.\n' +
      'This gate reads what SHIPS, so run `npm run build` first.\n' +
      'Failing rather than passing: an empty scan is not evidence of compliance.',
  );
  process.exit(2);
}

const findings = [];
for (const file of files) {
  const rel = relative(ROOT, file);
  const ext = extname(file).toLowerCase();
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // binary asset
  }
  if (ext === '.html') findings.push(...scanHtml(text, rel));
  else if (ext === '.css') findings.push(...scanCode(text, rel, CSS_SHAPES));
  else if (ext === '.js' || ext === '.mjs') findings.push(...scanCode(text, rel, JS_SHAPES));
}

const key = (f) => `${f.file}::${f.kind}::${f.host}`;
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { allowed: [] };
const allowed = new Set(baseline.allowed.map((a) => `${a.file}::${a.kind}::${a.host}`));

if (process.argv.includes('--update')) {
  const allowedList = findings.map((f) => ({ file: f.file, kind: f.kind, host: f.host }));
  writeFileSync(BASELINE, `${JSON.stringify({ allowed: allowedList }, null, 2)}\n`);
  console.log(`check:network baseline updated with ${allowedList.length} entr(ies).`);
  process.exit(0);
}

const unlisted = findings.filter((f) => !allowed.has(key(f)));

if (process.argv.includes('--list')) {
  console.log(`check:network scanned ${files.length} built file(s); ${findings.length} finding(s).`);
  for (const f of findings) {
    console.log(`  ${f.file}:${f.line}  ${f.kind}  host=${f.host}\n      ${f.target}`);
  }
  process.exit(0);
}

if (unlisted.length > 0) {
  console.error(
    `check:network FAILED: ${unlisted.length} third-party runtime request(s) in built output.\n` +
      'The mission is that a player on metered data pays for the game and nothing\n' +
      'else, and that the games work offline. Remove the request, or - if it is\n' +
      'genuinely not a runtime fetch - narrow the rule in scripts/lib/network-refs.mjs\n' +
      'rather than baselining it.\n',
  );
  for (const f of unlisted) {
    console.error(`  ${f.file}:${f.line}  ${f.kind}  host=${f.host}\n      ${f.target}`);
  }
  process.exit(1);
}

console.log(
  `check:network OK - ${files.length} built file(s) scanned, zero third-party runtime requests` +
    `${allowed.size ? ` (${allowed.size} baselined)` : ''}.`,
);
