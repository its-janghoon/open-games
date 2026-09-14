#!/usr/bin/env node
/**
 * Generate the root landing page from the per-package `game.json` files.
 *
 *   node site/build.mjs [--out <dir>]
 *
 * Reads `site/index.template.html` and fills two markers:
 *
 *   <!-- @hero  -->  the flagship block, for the game marked `"focus": "active"`
 *   <!-- @cards -->  one editorial row per remaining game
 *
 * Games with `status: "archived"` are left out entirely. Images a package
 * declares (`thumbnail`, `hero`) are copied to `<out>/thumbs/` and
 * `<out>/heroes/`; a package with no thumbnail gets a generated monogram tile.
 *
 * Adding a game never requires touching this script or the template.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadListedGames, repoRoot } from '../scripts/lib/games.mjs';

const siteDir = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(siteDir, 'index.template.html');
const HERO_MARKER = '<!-- @hero -->';
const CARDS_MARKER = '<!-- @cards -->';

function parseArgs(argv) {
  let out = '_site';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') {
      out = argv[i + 1];
      i += 1;
      if (!out) throw new Error('--out needs a directory argument');
    }
  }
  return { outDir: resolve(repoRoot, out) };
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);

/**
 * Widely separated hues for the placeholder tiles.
 *
 * Hashing a slug straight to `hue % 360` put every real slug in the greens
 * (156, 109, 121, ...) and the tiles were indistinguishable. Pick from a fixed
 * wheel of far-apart hues instead: the choice is still stable per slug, but two
 * slugs can only ever land on the same hue, never on adjacent ones.
 */
const PLACEHOLDER_HUES = [210, 28, 145, 320, 45, 265, 175, 5, 95, 240];

function hueFor(slug) {
  let hash = 2166136261;
  for (const char of slug) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return PLACEHOLDER_HUES[hash % PLACEHOLDER_HUES.length];
}

/** "Arena Champions" -> "AC"; "Wirework" -> "WI". */
function monogram(title) {
  const words = title.split(/[\s:/-]+/).filter(Boolean);
  const letters = words.length > 1 ? words.slice(0, 2).map((w) => w[0]) : [title.slice(0, 2)];
  return letters.join('').toUpperCase();
}

/**
 * The player-facing state of a game, derived from the two axes already in
 * `game.json` - no new field, and nothing to keep in sync by hand.
 *
 * A survey of studio and publisher landing pages found none of them showing a
 * player-facing NUMBER above the fold (no scores, no sales, no counts) and most
 * of them labelling each title with its availability instead. `status` says
 * whether it runs; `focus` says whether it is the one being worked on.
 */
function stateLabel(game) {
  if (game.status === 'wip') return 'In development';
  return game.focus === 'active' ? 'Available now' : 'Playable now';
}

/** Copy a declared image into the output and return its relative URL. */
function copyAsset(game, field, folder, outDir) {
  const rel = game[field];
  if (!rel) return null;
  const ext = extname(rel) || '.png';
  const dest = `${folder}/${game.slug}${ext}`;
  mkdirSync(join(outDir, folder), { recursive: true });
  copyFileSync(join(game.packageDir, rel), join(outDir, dest));
  return dest;
}

function renderThumb(game, outDir) {
  const rel = copyAsset(game, 'thumbnail', 'thumbs', outDir);
  if (!rel) {
    return `<span class="shot shot--placeholder" style="--hue: ${hueFor(
      game.slug,
    )}" aria-hidden="true">${escapeHtml(monogram(game.title))}</span>`;
  }
  // Decorative: the row's own heading already names the game, so an alt text
  // here would just be read out twice.
  return `<img class="shot" src="${escapeHtml(
    rel,
  )}" alt="" width="640" height="360" loading="lazy" decoding="async" />`;
}

/**
 * The flagship block. Falls back to the game's thumbnail when it declares no
 * dedicated hero image, and renders no image layer at all when it has neither -
 * the type carries the hero either way.
 */
function renderHero(game, outDir) {
  const art = copyAsset(game, 'hero', 'heroes', outDir) ?? copyAsset(game, 'thumbnail', 'thumbs', outDir);
  const tex = art
    ? `\n      <div class="hero-tex" style="background-image: url('${escapeHtml(
        art,
      )}')" aria-hidden="true"></div>`
    : '';
  const titleKo =
    game.titleKo && game.titleKo !== game.title
      ? `\n          <p class="hero-ko" lang="ko">${escapeHtml(game.titleKo)}</p>`
      : '';
  const genre = game.genre ? `\n          <p class="hero-sub">${escapeHtml(game.genre)}</p>` : '';
  const pitch = game.summary
    ? `\n          <p class="hero-pitch">${escapeHtml(game.summary)}</p>`
    : '';

  return `    <div class="hero">${tex}
      <div class="hero-veil" aria-hidden="true"></div>
      <div class="wrap">
        <div class="hero-in">
          <p class="facts">
            <span class="live">${escapeHtml(stateLabel(game))}</span>
            <span class="sep">&middot;</span><span>Free, no account</span>
            <span class="sep">&middot;</span><span>Plays in your browser</span>
          </p>
          <h1 class="game">${escapeHtml(game.title)}</h1>${genre}${titleKo}${pitch}
          <div class="hero-cta">
            <a class="btn-play" href="./${escapeHtml(game.slug)}/">Play free</a>
            <a class="link-soft" href="https://github.com/savagemanage/open-games/tree/main/packages/${escapeHtml(
              game.slug,
            )}">Read its source</a>
          </div>
        </div>
      </div>
    </div>`;
}

/** One editorial row in the catalogue below the hero. */
function renderRow(game, outDir) {
  const badge =
    game.status === 'wip' ? '<span class="badge">work in progress</span>' : '';
  const titleKo =
    game.titleKo && game.titleKo !== game.title
      ? `\n              <span class="name-ko" lang="ko">${escapeHtml(game.titleKo)}</span>`
      : '';
  // genre and summary may still be empty on a work-in-progress game; render
  // nothing rather than an empty element.
  const summary = game.summary
    ? `\n              <span class="summary">${escapeHtml(game.summary)}</span>`
    : '';
  const genre = game.genre
    ? `\n              <span class="genre">${escapeHtml(game.genre)} &middot; plays in browser</span>`
    : '';

  // Links are relative so the page works at any base path (the project Pages
  // subpath, a user site, or a local preview) without being regenerated.
  return `        <li>
          <a class="game" href="./${escapeHtml(game.slug)}/">
            <span class="shot-frame">${renderThumb(game, outDir)}</span>
            <span>
              <span class="state">${escapeHtml(stateLabel(game))}</span>
              <span class="name">${escapeHtml(game.title)}${badge}</span>${titleKo}${summary}${genre}
            </span>
            <span class="play">Play</span>
          </a>
        </li>`;
}

function main() {
  const { outDir } = parseArgs(process.argv.slice(2));
  const games = loadListedGames();
  if (games.length === 0) {
    throw new Error(
      'No listed games found under packages/*/game.json; refusing to build an empty landing page.',
    );
  }

  const template = readFileSync(TEMPLATE, 'utf8');
  for (const marker of [HERO_MARKER, CARDS_MARKER]) {
    if (!template.includes(marker)) {
      throw new Error(`site/index.template.html is missing the ${marker} marker`);
    }
  }

  // The flagship is whichever game declares `"focus": "active"`. With none
  // declared - or several - fall back to the first listed game, so the page
  // always has a hero and the choice stays deterministic.
  const flagship = games.find((game) => game.focus === 'active') ?? games[0];
  const rest = games.filter((game) => game !== flagship);

  mkdirSync(outDir, { recursive: true });
  const html = template
    .replace(HERO_MARKER, renderHero(flagship, outDir).trimStart())
    .replace(CARDS_MARKER, rest.map((game) => renderRow(game, outDir)).join('\n').trimStart());
  writeFileSync(join(outDir, 'index.html'), html);

  const wip = games.filter((game) => game.status === 'wip').length;
  console.log(
    `[site] wrote ${join(outDir, 'index.html')} with ${games.length} game(s), ` +
      `flagship "${flagship.slug}"` +
      (wip > 0 ? ` (${wip} marked work in progress)` : ''),
  );

  // Shared chrome, so the two pages cannot drift into two visual languages.
  copyFileSync(join(siteDir, 'shell.css'), join(outDir, 'shell.css'));
  buildSponsorPage(template, outDir);
}

/**
 * Render the sponsorship page from the generated compliance report.
 *
 * The body is the report, deliberately. The reason to fund this project is what it
 * promises players, and a promise nobody can check is marketing - so the page shows
 * each promise, the command that checks it, and what that command measured. It is
 * generated rather than written for the same reason: prose about compliance drifts
 * from the build, and output cannot.
 *
 * The header and footer are lifted out of the landing template rather than
 * duplicated, so a change to the site's chrome reaches both pages.
 */
function buildSponsorPage(indexTemplate, outDir) {
  const reportPath = join(siteDir, 'compliance.json');
  if (!existsSync(reportPath)) {
    console.warn(
      '[site] no site/compliance.json; skipping the sponsor page. Run `npm run compliance` first.',
    );
    return;
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const template = readFileSync(join(siteDir, 'sponsor.template.html'), 'utf8');

  // Reuse the landing page's own header and footer markup verbatim.
  const between = (source, open, close) => {
    const start = source.indexOf(open);
    const end = source.indexOf(close, start);
    if (start === -1 || end === -1) return '';
    return source.slice(start, end + close.length);
  };
  const header = between(indexTemplate, '<header class="top">', '</header>');
  const footer = between(indexTemplate, '<footer', '</footer>');
  if (!header || !footer) {
    throw new Error('site/index.template.html no longer exposes a <header>/<footer> to share');
  }
  // On the sponsor page the header's in-page anchors would point at sections that
  // only exist on the landing page.
  // The page lives one directory down, so every root-relative "./" in the shared
  // chrome has to become "../". Missing this rendered the whole page unstyled: the
  // stylesheet resolved to /sponsor/shell.css, which does not exist, and the inline
  // wordmark expanded to full width with no CSS to size it.
  const upOneLevel = (markup) =>
    markup
      .replace(/href="#contribute"/g, 'href="../#contribute"')
      .replace(/href="#catalogue"/g, 'href="../#catalogue"')
      .replace(/href="#about"/g, 'href="../#about"')
      .replace(/href="\.\/"/g, 'href="../"')
      .replace(/(href|src)="\.\/(?!\/)/g, '$1="../');
  const sponsorHeader = upOneLevel(header);

  const claims = report.claims
    .map((claim) => {
      const verdictClass = claim.verdict === 'pass' ? 'pass' : claim.verdict === 'fail' ? 'fail' : '';
      const parts = [
        `<h2>${escapeHtml(claim.promise)}</h2>`,
        `<p class="measured">${escapeHtml(claim.measured)}</p>`,
        `<p class="how">Checked by ${escapeHtml(claim.checkedBy)}</p>`,
      ];
      if (Array.isArray(claim.games) && claim.games.length > 0) {
        const rows = claim.games
          .map(
            (g) =>
              `<tr><td>${escapeHtml(g.slug)}</td><td>${g.firstWaitKB} KB</td><td>${g.totalKB} KB</td></tr>`,
          )
          .join('');
        parts.push(
          '<table class="sizes"><thead><tr><th>Game</th><th>First wait</th>' +
            `<th>Full download</th></tr></thead><tbody>${rows}</tbody></table>`,
        );
      }
      if (Array.isArray(claim.findings) && claim.findings.length > 0) {
        parts.push(
          `<p class="how">Findings: ${claim.findings
            .map((f) => escapeHtml(`${f.file} — ${f.kind}`))
            .join('; ')}</p>`,
        );
      }
      if (claim.note) parts.push(`<p class="note">${escapeHtml(claim.note)}</p>`);
      for (const item of claim.notYetMeasured ?? []) {
        parts.push(`<p class="note">Not measured: ${escapeHtml(item)}</p>`);
      }
      return (
        `<li class="claim"><span class="verdict ${verdictClass}">${escapeHtml(claim.verdict)}</span>` +
        `<div>${parts.join('')}</div></li>`
      );
    })
    .join('\n');

  // Open work is shown as prominently as the passes. A page that could only report
  // successes would be the marketing this one exists instead of.
  const open =
    (report.openWork ?? []).length === 0
      ? ''
      : `<section class="block wrap" id="open"><h2>Known and not yet done</h2>${(report.openWork ?? [])
          .map(
            (item) =>
              `<div class="open-item"><h3>${escapeHtml(item.item)}</h3>` +
              `<p>${escapeHtml(item.size ?? '')}</p>` +
              `<p>${escapeHtml(item.why ?? '')}</p>` +
              (item.needs ? `<p>Needs: ${escapeHtml(item.needs)}</p>` : '') +
              '</div>',
          )
          .join('')}</section>`;

  const funding = Object.entries(report.funding ?? {})
    .map(
      ([key, value]) =>
        `<div><dt>${escapeHtml(key.replace(/([A-Z])/g, ' $1').toLowerCase())}</dt>` +
        `<dd>${escapeHtml(value)}</dd></div>`,
    )
    .join('');

  const html = template
    .replace('<!-- @header -->', sponsorHeader)
    .replace('<!-- @footer -->', upOneLevel(footer))
    .replace('<!-- @claims -->', claims)
    .replace('<!-- @open -->', open)
    .replace('<!-- @funding -->', funding)
    .replace(
      '<!-- @generated -->',
      escapeHtml(
        `Generated ${report.generated} by ${report.generatedBy} · ${report.summary.passing}/${report.summary.claims} checks passing · reproduce with: ${report.howToReproduce}`,
      ),
    );

  const dir = join(outDir, 'sponsor');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);
  console.log(
    `[site] wrote ${join(dir, 'index.html')} from the compliance report ` +
      `(${report.summary.passing}/${report.summary.claims} checks passing, ` +
      `${(report.openWork ?? []).length} open item(s))`,
  );
}

main();
