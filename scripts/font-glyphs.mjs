#!/usr/bin/env node
/**
 * Derive the glyph set each game's Korean webfont actually needs, and report what it currently ships.
 *
 *   node scripts/font-glyphs.mjs [--out <dir>] [--only slug,slug]
 *
 * A Korean face carrying the whole syllable block is the single largest asset in this repo — larger than every
 * script bundle put together — and on a metered connection that is the difference between a game loading and a
 * game being abandoned. Which is the whole point of the project, so it is worth measuring precisely rather than
 * guessing.
 *
 * This tool does NOT subset. Subsetting needs a font library (`pyftsubset` from fonttools, or `hb-subset`) and
 * neither is installable here. What it does is the half that needs no tool: read every shipped source file, collect
 * the distinct Korean characters the game can actually display, and write them to a text file — which is precisely
 * the `--text-file=` input pyftsubset takes. So when the tool exists, subsetting is one command per font with a
 * glyph set that was derived rather than assumed.
 *
 * Test files are excluded: they are not shipped, so a string that exists only in an assertion must not pin a glyph
 * into the font a player downloads.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { loadListedGames, repoRoot } from './lib/games.mjs';

/**
 * Ranges the Korean face is responsible for.
 *
 * Precomposed syllables are the bulk. Conjoining and compatibility Jamo are included because a game that renders a
 * single consonant — a key hint, a grade letter — needs them and they are cheap. Latin is deliberately NOT here:
 * every game also loads a Latin face, and duplicating ASCII into the Korean subset pays for the same glyphs twice.
 */
const KOREAN_RANGES = [
  [0xac00, 0xd7a3], // Hangul syllables
  [0x1100, 0x11ff], // Hangul Jamo
  [0x3130, 0x318f], // Hangul compatibility Jamo
];

/** Punctuation and symbols that Korean UI text uses and a Latin subset often omits. */
const SHARED_RANGES = [
  [0x2010, 0x2027], // dashes, quotes, ellipsis
  [0x00b7, 0x00b7], // middle dot, used as a separator throughout
  [0x00d7, 0x00d7], // multiplication sign, used in counts
  [0x2190, 0x21ff], // arrows
];

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.html', '.css']);

function inRanges(code, ranges) {
  return ranges.some(([lo, hi]) => code >= lo && code <= hi);
}

/** Every shipped source file under a directory. Test files are excluded — they are not downloaded. */
function shippedFiles(dir, found = []) {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      shippedFiles(path, found);
    } else if (
      SOURCE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.'))) &&
      !/\.(test|spec)\./.test(entry.name)
    ) {
      found.push(path);
    }
  }
  return found;
}

function collect(game) {
  const korean = new Set();
  const shared = new Set();
  const files = shippedFiles(join(game.packageDir, 'src'));
  for (const file of [...files, join(game.packageDir, 'index.html')]) {
    if (!existsSync(file)) continue;
    for (const char of readFileSync(file, 'utf8')) {
      const code = char.codePointAt(0);
      if (inRanges(code, KOREAN_RANGES)) korean.add(char);
      else if (inRanges(code, SHARED_RANGES)) shared.add(char);
    }
  }
  return { korean, shared, fileCount: files.length };
}

/**
 * Which font files are the Korean face.
 *
 * Needed because the first version of this tool emitted a command that would have subset champs' Cinzel — a Latin
 * display face — down to a Korean glyph list, which would have destroyed it while looking like a saving. A font
 * matching neither list is reported as unclassified rather than assumed either way, so a new face cannot be
 * silently mis-subset by a tool run.
 */
const KOREAN_FACE = /noto.*kr|nanum|galmuri|pretendard|spoqa|gothic|myeongjo|batang/i;
const LATIN_FACE = /cinzel|inter|archivo|roboto|lato|montserrat|orbitron|jetbrains|mono/i;

function classify(path) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (KOREAN_FACE.test(name)) return 'korean';
  if (LATIN_FACE.test(name)) return 'latin';
  return 'unknown';
}

/** Font files a game ships, with their byte sizes. Reads `public/`, which is the source of truth for `dist/`. */
function fontsOf(game) {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(woff2?|[ot]tf)$/.test(entry.name)) {
        out.push({ path, bytes: statSync(path).size, kind: classify(path) });
      }
    }
  };
  walk(join(game.packageDir, 'public'));
  return out.sort((a, b) => b.bytes - a.bytes);
}

function main() {
  const argv = process.argv.slice(2);
  let outDir = join(repoRoot, 'site', 'font-glyphs');
  let only = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') outDir = join(repoRoot, argv[++i]);
    else if (argv[i] === '--only') only = argv[++i].split(',').map((s) => s.trim());
  }

  const games = loadListedGames().filter((g) => !only || only.includes(g.slug));
  mkdirSync(outDir, { recursive: true });

  const rows = [];
  for (const game of games) {
    const { korean, shared, fileCount } = collect(game);
    const fonts = fontsOf(game);
    if (korean.size === 0 && fonts.length === 0) continue;

    // Sorted so the file is stable across runs: an unstable glyph list would churn in every diff.
    const glyphs = [...korean, ...shared].sort();
    const listPath = join(outDir, `${game.slug}.txt`);
    writeFileSync(listPath, `${glyphs.join('')}\n`);

    const fontBytes = fonts.reduce((sum, f) => sum + f.bytes, 0);
    const koreanBytes = fonts
      .filter((f) => f.kind === 'korean')
      .reduce((sum, f) => sum + f.bytes, 0);
    rows.push({
      slug: game.slug,
      korean: korean.size,
      shared: shared.size,
      files: fileCount,
      fontBytes,
      koreanBytes,
      fonts,
      listPath: relative(repoRoot, listPath),
    });
  }

  rows.sort((a, b) => b.koreanBytes - a.koreanBytes);

  // Bytes per glyph is the comparison that matters, because it cancels out how much Korean a game happens to show.
  // whiteout displays about as many distinct characters as champs, so a large gap here is unsubset weight, not a
  // bigger vocabulary.
  const withKorean = rows.filter((row) => row.korean > 0 && row.koreanBytes > 0);
  const best = withKorean.reduce(
    (lowest, row) => Math.min(lowest, row.koreanBytes / row.korean),
    Infinity,
  );

  console.log('[fonts] Korean glyphs a game can display vs Korean font bytes it ships\n');
  console.log(
    `  ${'game'.padEnd(10)}${'glyphs'.padStart(7)}${'punct'.padStart(7)}${'KR font KB'.padStart(12)}` +
      `${'B/glyph'.padStart(9)}${'vs best'.padStart(9)}`,
  );
  for (const row of rows) {
    if (row.korean === 0 && row.koreanBytes === 0) continue;
    const per = row.koreanBytes > 0 && row.korean > 0 ? row.koreanBytes / row.korean : 0;
    console.log(
      `  ${row.slug.padEnd(10)}${String(row.korean).padStart(7)}${String(row.shared).padStart(7)}` +
        `${(row.koreanBytes / 1024).toFixed(1).padStart(12)}` +
        `${(per > 0 ? per.toFixed(0) : '-').padStart(9)}` +
        `${(per > 0 ? `${(per / best).toFixed(1)}x` : '-').padStart(9)}`,
    );
  }

  const unclassified = rows.flatMap((row) =>
    row.fonts.filter((f) => f.kind === 'unknown').map((f) => relative(repoRoot, f.path)),
  );
  if (unclassified.length > 0) {
    console.log('\n[fonts] UNCLASSIFIED — add to KOREAN_FACE or LATIN_FACE before subsetting:');
    for (const path of unclassified) console.log(`  ${path}`);
  }

  console.log('\n[fonts] glyph lists written (not published — build.mjs copies only named site files):');
  for (const row of rows) console.log(`  ${row.listPath}  (${row.korean + row.shared} characters)`);

  const targets = rows.flatMap((row) =>
    row.fonts
      .filter((f) => f.kind === 'korean' && row.korean > 0)
      .map((f) => ({ path: relative(repoRoot, f.path), list: row.listPath })),
  );
  console.log('\n[fonts] to subset, once a font tool is installed:');
  for (const target of targets) {
    console.log(
      `  pyftsubset ${target.path} --text-file=${target.list} \\\n` +
        `    --flavor=woff2 --layout-features='' --output-file=${target.path}`,
    );
  }

  const latin = rows.flatMap((row) =>
    row.fonts.filter((f) => f.kind === 'latin').map((f) => relative(repoRoot, f.path)),
  );
  if (latin.length > 0) {
    console.log(
      '\n[fonts] left alone (Latin faces — subsetting these to the Korean list would destroy them):',
    );
    for (const path of latin) console.log(`  ${path}`);
  }
  console.log(
    '\n[fonts] This tool does not subset — it only derives the glyph set. ' +
      'Install fonttools (pyftsubset) or harfbuzz (hb-subset) to apply it.',
  );
}

main();
