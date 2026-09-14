#!/usr/bin/env node
/**
 * Mission gate: transfer budget.
 *
 * The promise is that these games are reachable on a metered connection and a
 * cheap phone. That is a BYTE promise, and bytes only ever drift upward unless
 * something refuses them, so each game carries a per-asset-class ceiling and the
 * build fails when a bundle grows past it.
 *
 * Measured in GZIPPED bytes, which is what a player actually pays for. Two
 * aggregates per game, because they answer different questions:
 *
 *   coldLoad - index.html plus everything it directly references (scripts and
 *              preloaded fonts). This is the wait before anything is playable.
 *   total    - every shipped file. Audio and images are fetched by Phaser's loader
 *              during play rather than up front, so they are not part of the first
 *              wait, but the player still pays for them.
 *
 * Ceilings are set from what the games measure TODAY plus a little headroom, not
 * from an aspiration. A budget nobody can meet gets raised or deleted; a budget
 * that pins today's number catches the regression it exists to catch, and the two
 * real wins are recorded in the baseline file as work items rather than pretended
 * away.
 *
 * Usage:
 *   node scripts/check-budget.mjs            # fail when a game is over ceiling
 *   node scripts/check-budget.mjs --list     # print the measured table
 *   node scripts/check-budget.mjs --json     # machine-readable, for the report
 *   node scripts/check-budget.mjs --selftest # prove the gate still detects
 *   node scripts/check-budget.mjs --update   # rewrite ceilings from measurement
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const BASELINE = join(ROOT, 'scripts', 'budget-baseline.json');

/** Asset classes. Ordered so the first match wins. */
const CLASSES = [
  ['html', ['.html']],
  ['js', ['.js', '.mjs']],
  ['css', ['.css']],
  ['font', ['.woff2', '.woff', '.ttf', '.otf']],
  ['audio', ['.wav', '.mp3', '.ogg', '.m4a', '.webm']],
  ['image', ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif']],
];

export function classify(file) {
  const ext = extname(file).toLowerCase();
  for (const [name, exts] of CLASSES) if (exts.includes(ext)) return name;
  return 'other';
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

/** Gzipped size in bytes. Already-compressed formats are counted as-is. */
export function transferBytes(buf, file) {
  const cls = classify(file);
  // woff2, png and mp3/ogg are already compressed; gzipping them again measures
  // nothing a server would do. Counting the raw size is the honest figure.
  if (cls === 'font' || cls === 'image' || ['.mp3', '.ogg', '.m4a', '.webm'].includes(extname(file)))
    return buf.length;
  return gzipSync(buf, { level: 9 }).length;
}

const KB = (n) => Math.round((n / 1024) * 10) / 10;

/** Everything index.html directly references, resolved to file names. */
function coldLoadFiles(distDir) {
  const indexPath = join(distDir, 'index.html');
  if (!existsSync(indexPath)) return [];
  const html = readFileSync(indexPath, 'utf8');
  const names = new Set([indexPath]);
  for (const m of html.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)) {
    const ref = m[1];
    if (ref.startsWith('data:')) continue;
    // Match by file name: the built paths are absolute to a deploy base that does
    // not exist on disk, so resolving them literally would find nothing.
    const name = basename(ref.split('?')[0]);
    for (const f of walk(distDir)) if (basename(f) === name) names.add(f);
  }
  return [...names];
}

/** Measure one game. */
function measureGame(slug) {
  const dist = join(ROOT, 'packages', slug, 'dist');
  if (!existsSync(dist)) return null;
  const files = walk(dist);
  const byClass = {};
  let total = 0;
  for (const f of files) {
    const bytes = transferBytes(readFileSync(f), f);
    const cls = classify(f);
    byClass[cls] = (byClass[cls] ?? 0) + bytes;
    total += bytes;
  }
  const cold = coldLoadFiles(dist);
  const coldLoad = cold.reduce((sum, f) => sum + transferBytes(readFileSync(f), f), 0);
  return { slug, files: files.length, byClass, total, coldLoad, coldFiles: cold.length };
}

const slugs = readdirSync(join(ROOT, 'packages')).filter((p) =>
  existsSync(join(ROOT, 'packages', p, 'dist')),
);
const measured = slugs.map(measureGame).filter(Boolean);

if (measured.length === 0) {
  console.error(
    'check:budget found no built output to measure.\n' +
      'This gate reads what SHIPS, so run `npm run build` first.\n' +
      'Failing rather than passing: an empty measurement is not evidence of compliance.',
  );
  process.exit(2);
}

/** Ceiling from a measured value: +8% or +16 KB, whichever is larger. */
const ceilingFor = (bytes) => Math.round(Math.max(bytes * 1.08, bytes + 16 * 1024));

function selftest() {
  let problems = 0;

  const cases = [
    ['a.js', 'js'],
    ['a.mjs', 'js'],
    ['b.woff2', 'font'],
    ['c.wav', 'audio'],
    ['d.png', 'image'],
    ['e.html', 'html'],
    ['f.css', 'css'],
    ['g.bin', 'other'],
  ];
  for (const [file, expected] of cases) {
    if (classify(file) !== expected) {
      console.error(`  selftest classify: ${file} -> ${classify(file)}, expected ${expected}`);
      problems += 1;
    }
  }

  // An already-compressed asset must not be double-counted through gzip, or the
  // font budget would read smaller than the bytes actually sent.
  const fontish = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 37) % 251));
  if (transferBytes(fontish, 'x.woff2') !== fontish.length) {
    console.error('  selftest transferBytes: woff2 should be counted raw, not gzipped');
    problems += 1;
  }
  const texty = Buffer.from('a'.repeat(4096));
  if (transferBytes(texty, 'x.js') >= texty.length) {
    console.error('  selftest transferBytes: js should be counted gzipped');
    problems += 1;
  }

  // The comparison itself, both directions.
  if (!(ceilingFor(100 * 1024) > 100 * 1024)) {
    console.error('  selftest ceiling: a ceiling must exceed the measurement it came from');
    problems += 1;
  }
  const over = 100 * 1024;
  if (over <= ceilingFor(over) - 16 * 1024 - 1) {
    console.error('  selftest ceiling: headroom arithmetic is wrong');
    problems += 1;
  }

  if (problems === 0) console.error('  selftest: classifier, byte counting and ceiling arithmetic OK');
  return problems;
}

const problems = selftest();
if (problems > 0) {
  console.error(`check:budget selftest FAILED with ${problems} problem(s) - the gate itself is wrong.`);
  process.exit(3);
}
if (process.argv.includes('--selftest')) process.exit(0);

if (process.argv.includes('--update')) {
  const budgets = {};
  for (const m of measured) {
    budgets[m.slug] = {
      coldLoad: ceilingFor(m.coldLoad),
      total: ceilingFor(m.total),
      byClass: Object.fromEntries(Object.entries(m.byClass).map(([k, v]) => [k, ceilingFor(v)])),
    };
  }
  const doc = {
    _why:
      'Gzipped transfer ceilings per game. The mission is that these games are ' +
      'reachable on metered data, so bytes need something that refuses them. ' +
      'Ceilings are measured-today plus ~8% headroom, deliberately not an ' +
      'aspiration: a budget nobody can meet gets raised until it means nothing.',
    _knownWins: [
      'Audio ships as WAV (uncompressed PCM), 850-1265 KB gzipped per game - ' +
        'larger than the Phaser engine itself. Ogg/Opus would cut this by roughly ' +
        'an order of magnitude and is the single biggest available saving.',
      'Korean webfonts are unevenly subset. whiteout ships NanumGothicCoding at ' +
        '76 KB for two weights; lastwar ships NotoSansKR at 557 KB and champs 1.09 MB ' +
        'across two weights, both named .subset but evidently not subset to the ' +
        'glyphs used. whiteout proves ~40 KB per weight is achievable for the same job.',
      'champs PRELOADS its two 540 KB Korean fonts from index.html, so they are ' +
        'part of the first wait rather than a background cost.',
    ],
    budgets,
  };
  writeFileSync(BASELINE, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`check:budget ceilings written for ${measured.length} game(s).`);
  process.exit(0);
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ gate: 'check:budget', games: measured }, null, 2));
  process.exit(0);
}

if (process.argv.includes('--list')) {
  for (const m of measured) {
    console.log(
      `  ${m.slug.padEnd(9)} cold=${String(KB(m.coldLoad)).padStart(7)} KB (${m.coldFiles} files)` +
        `  total=${String(KB(m.total)).padStart(7)} KB (${m.files} files)`,
    );
    const parts = Object.entries(m.byClass)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${KB(v)}`);
    console.log(`             ${parts.join('  ')}`);
  }
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(
    'check:budget has no ceilings yet. Run `node scripts/check-budget.mjs --update`\n' +
      'and commit scripts/budget-baseline.json.',
  );
  process.exit(2);
}

const { budgets } = JSON.parse(readFileSync(BASELINE, 'utf8'));
const violations = [];
for (const m of measured) {
  const budget = budgets[m.slug];
  if (!budget) {
    violations.push({
      file: `packages/${m.slug}/dist`,
      line: 0,
      kind: 'no transfer budget',
      target: `${m.slug} has no ceiling; run --update and commit the baseline`,
    });
    continue;
  }
  const checks = [
    ['coldLoad', m.coldLoad, budget.coldLoad],
    ['total', m.total, budget.total],
    ...Object.entries(m.byClass).map(([cls, bytes]) => [`${cls}`, bytes, budget.byClass?.[cls]]),
  ];
  for (const [name, bytes, ceiling] of checks) {
    if (ceiling === undefined) {
      violations.push({
        file: `packages/${m.slug}/dist`,
        line: 0,
        kind: `new asset class '${name}'`,
        target: `${KB(bytes)} KB with no ceiling - add one via --update if intended`,
      });
    } else if (bytes > ceiling) {
      violations.push({
        file: `packages/${m.slug}/dist`,
        line: 0,
        kind: `${name} over budget`,
        target: `${KB(bytes)} KB > ${KB(ceiling)} KB ceiling (+${KB(bytes - ceiling)} KB)`,
      });
    }
  }
}

if (violations.length > 0) {
  console.error(
    `check:budget FAILED: ${violations.length} budget violation(s).\n` +
      'These games are meant to be reachable on metered data and a cheap phone.\n' +
      'Shrink the asset, or raise the ceiling deliberately with --update and say why\n' +
      'in the commit - do not raise it silently.\n',
  );
  for (const v of violations) console.error(`  ${v.file}  ${v.kind}\n      ${v.target}`);
  process.exit(1);
}

const worst = measured.reduce((a, b) => (b.coldLoad > a.coldLoad ? b : a));
console.log(
  `check:budget OK - ${measured.length} game(s) within ceilings ` +
    `(largest first wait: ${worst.slug} at ${KB(worst.coldLoad)} KB).`,
);
