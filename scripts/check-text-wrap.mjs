#!/usr/bin/env node
/**
 * Fail the build when a Text and a button divide one frame and the text has no
 * wrap width.
 *
 *   node scripts/check-text-wrap.mjs
 *
 * Companion to check-panel-bounds.mjs, which checks BUTTON geometry and so
 * cannot see this: whiteout's objective strip put an instruction line and a Skip
 * button in one 600x44 frame with no wordWrap, and the instruction ran under the
 * button and out past the border. Static analysis, so it covers screens no
 * browser run reaches - the same reason the panel checker is static.
 *
 * Only `confirmed` findings gate. See scripts/lib/text-wrap.mjs for why the rule
 * is as narrow as it is and which two looser rules were measured and rejected.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from './lib/games.mjs';
import { analyzeTextWrapPackage } from './lib/text-wrap.mjs';

const packagesDir = join(repoRoot, 'packages');
const packages = readdirSync(packagesDir)
  .filter((d) => !d.startsWith('_') && !d.startsWith('.'))
  .filter((d) => statSync(join(packagesDir, d)).isDirectory())
  .sort();

let confirmed = 0;
let suspect = 0;
const actual = {};

for (const pkg of packages) {
  const { violations } = analyzeTextWrapPackage(join(packagesDir, pkg));
  if (violations.length === 0) continue;

  const c = violations.filter((v) => v.confidence === 'confirmed');
  const s = violations.filter((v) => v.confidence === 'suspect');
  confirmed += c.length;
  suspect += s.length;

  console.log(`\n[text] ${pkg}`);
  for (const v of [...c, ...s]) {
    const rel = v.file.replace(`${repoRoot}/`, '');
    console.log(
      `  ${v.confidence === 'confirmed' ? 'CONFIRMED' : 'suspect  '} ${rel}:${v.line}` +
        ` in ${v.fn}()  ${v.content}\n              ${v.reason}`,
    );
    if (v.confidence === 'confirmed') {
      const key = `${pkg}:${v.fn}`;
      actual[key] = (actual[key] ?? 0) + 1;
    }
  }
}

console.log(`\n[text] ${confirmed} CONFIRMED (unbounded text sharing a frame with a button)`);
console.log(`[text] ${suspect} suspect (fixed-length text in a shared frame - reported only)`);

/* --- baseline comparison: fail on NEW violations, and on stale entries --- */
const baselineFile = new URL('./text-wrap-baseline.json', import.meta.url);
const baseline = JSON.parse(readFileSync(baselineFile, 'utf8'));
delete baseline._comment;

const added = [];
const fixed = [];
for (const key of new Set([...Object.keys(actual), ...Object.keys(baseline)])) {
  const now = actual[key] ?? 0;
  const was = baseline[key] ?? 0;
  if (now > was) added.push(`${key}: ${was} -> ${now}`);
  if (now < was) fixed.push(`${key}: ${was} -> ${now}`);
}

if (added.length > 0) {
  console.log('\n[text] NEW violations not in the baseline:');
  for (const line of added) console.log(`  ${line}`);
  process.exit(1);
}
if (fixed.length > 0) {
  console.log(
    '\n[text] fixed since the baseline was written - lower these in' +
      ' scripts/text-wrap-baseline.json:',
  );
  for (const line of fixed) console.log(`  ${line}`);
  process.exit(1);
}
console.log(`[text] matches the baseline (${confirmed} known, 0 new)`);
