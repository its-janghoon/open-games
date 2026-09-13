#!/usr/bin/env node
/**
 * Report every panel child that is proven to hang outside its own panel.
 *
 *   node scripts/check-panel-bounds.mjs [--json]
 *
 * Exits non-zero when any violation is found, so it can gate a build the same
 * way `docs:check` does. See scripts/lib/panel-bounds.mjs for why every result
 * is a real violation and not a heuristic guess.
 */
import { readFileSync } from 'node:fs';

import { analyzePackage } from './lib/panel-bounds.mjs';
import { loadListedGames } from './lib/games.mjs';

const asJson = process.argv.includes('--json');
const games = loadListedGames();
const report = [];
let confirmed = 0;
let suspect = 0;
let panels = 0;

for (const game of games) {
  const result = analyzePackage(game.packageDir);
  panels += result.panels;
  confirmed += result.violations.filter((v) => v.confidence === 'confirmed').length;
  suspect += result.violations.filter((v) => v.confidence === 'suspect').length;
  report.push({ slug: game.slug, ...result });
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const show = (entry, which) => {
    const list = entry.violations.filter((v) => v.confidence === which);
    if (!list.length) return;
    console.log(`  ${which.toUpperCase()}:`);
    for (const v of list) {
      const rel = v.file.replace(/^.*\/packages\//, 'packages/');
      const sides = Object.entries(v.outsideBy).map(([k, n]) => `${k} +${n}px`).join(', ');
      console.log(`    ${rel}:${v.line}  ${v.fn}()  ${v.label}`);
      console.log(`        centre ${v.buttonCentre.map((n) => Math.round(n)).join(',')}`
        + ` min-size ${v.buttonMinSize.join('x')}  panel ${v.panelBox.join(',')}`
        + `  -> outside: ${sides}`
        + (which === 'suspect' ? `  (centre ${v.centreOutsidePx}px outside panel - may not belong to it)` : ''));
    }
  };
  for (const entry of report) {
    const n = entry.violations.length;
    if (!n && !entry.skipped.length) {
      console.log(`[panels] ${entry.slug}: ${entry.panels} panel(s), clean`);
      continue;
    }
    console.log(`\n[panels] ${entry.slug}: ${entry.panels} panel(s), ${n} finding(s)`);
    show(entry, 'confirmed');
    show(entry, 'suspect');
    if (entry.skipped.length) {
      console.log(`    (${entry.skipped.length} construct(s) unresolvable, not counted)`);
    }
  }
  console.log(`\n[panels] ${panels} panel(s) analysed`);
  console.log(`[panels] ${confirmed} CONFIRMED (button centre inside its panel, extent spills out)`);
  console.log(`[panels] ${suspect} suspect (centre outside the panel - probably a separate element)`);
}

/* --- baseline comparison: fail on NEW violations, and on stale entries --- */
const baselineFile = new URL('./panel-bounds-baseline.json', import.meta.url);
const baseline = JSON.parse(readFileSync(baselineFile, 'utf8'));
delete baseline._comment;

const actual = {};
for (const entry of report) {
  for (const v of entry.violations) {
    if (v.confidence !== 'confirmed') continue;
    const rel = String(v.file).replace(/^.*\/packages\/[^/]+\//, '');
    const key = `${entry.slug}/${rel}#${v.fn}`;
    actual[key] = (actual[key] ?? 0) + 1;
  }
}

const added = [];
const fixed = [];
for (const key of new Set([...Object.keys(actual), ...Object.keys(baseline)])) {
  const now = actual[key] ?? 0;
  const was = baseline[key] ?? 0;
  if (now > was) added.push(`${key}: ${was} -> ${now}`);
  if (now < was) fixed.push(`${key}: ${was} -> ${now}`);
}

if (!asJson) {
  if (added.length) {
    console.log('\n[panels] NEW violations not in the baseline:');
    for (const line of added) console.log(`  + ${line}`);
  }
  if (fixed.length) {
    console.log('\n[panels] fixed since the baseline was written - lower these in'
      + ' scripts/panel-bounds-baseline.json:');
    for (const line of fixed) console.log(`  - ${line}`);
  }
  if (!added.length && !fixed.length) {
    console.log(`[panels] matches the baseline (${confirmed} known, 0 new)`);
  }
}

process.exit(added.length || fixed.length ? 1 : 0);
