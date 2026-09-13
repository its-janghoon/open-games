#!/usr/bin/env node
/**
 * Capture a landing-page thumbnail for each game.
 *
 *   node scripts/capture-thumbnails.mjs [--site _site] [--only slug,slug]
 *
 * Serves an already-assembled site directory, opens each game in headless
 * Chromium, waits for it to settle, and writes a cropped 16:9 PNG to
 * `packages/<slug>/thumb.png`. Declaring that file in the package's game.json
 * is what makes the landing page use it instead of a monogram placeholder.
 *
 * champs has no recipe: its UI is React DOM rather than Phaser objects and its
 * battle sits behind a menu flow (match type -> difficulty -> battlefield ->
 * start), so it needs a click-through plus a DOM sweep rather than the
 * display-list strip the others use. Its thumbnail is maintained by hand until
 * that flow is scripted here.
 *
 * This is a maintainer tool, not part of the build: thumbnails are committed so
 * a normal `npm run build` stays fast and needs no browser. Re-run it when a
 * game's look changes.
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

import { CAPTURE_RECIPES, STRIP_UI_JS } from './lib/capture-chrome.mjs';
import { loadListedGames, repoRoot } from './lib/games.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain',
};

/** Served under /open-games/ so each game's production base path resolves. */
const BASE_PATH = '/open-games';
const PORT = 4319;
const SHOT = { width: 1280, height: 720 };
/** Long enough for boot, preload, the title fade and one idle beat. */
const SETTLE_MS = 9000;

function parseArgs(argv) {
  const out = { site: '_site', only: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--site') out.site = argv[++i];
    else if (argv[i] === '--only') out.only = argv[++i].split(',').map((s) => s.trim());
  }
  return out;
}

function serve(root) {
  const server = createServer((req, res) => {
    let path = decodeURIComponent(req.url.split('?')[0]);
    if (path.startsWith(BASE_PATH)) path = path.slice(BASE_PATH.length);
    if (path === '' || path.endsWith('/')) path += 'index.html';
    const file = join(root, path);
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(PORT, () => ok(server)));
}

async function main() {
  const { site, only } = parseArgs(process.argv.slice(2));
  const root = resolve(repoRoot, site);
  if (!existsSync(root)) {
    throw new Error(`No assembled site at ${root}. Run \`npm run build\` first.`);
  }

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error(
      'playwright is not installed. This is a maintainer-only tool:\n' +
        '  npm i -D playwright   (browsers already present via PLAYWRIGHT_BROWSERS_PATH)',
    );
  }

  const games = loadListedGames().filter((g) => !only || only.includes(g.slug));
  const server = await serve(root);
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    args: ['--no-sandbox'],
  });

  for (const game of games) {
    const ctx = await browser.newContext({ viewport: SHOT, locale: 'ko-KR' });
    const page = await ctx.newPage();
    // ?debug exposes the window.__GAME__ hook the strip-UI routine needs.
    await page.goto(`http://127.0.0.1:${PORT}${BASE_PATH}/${game.slug}/?debug`, {
      waitUntil: 'load',
      timeout: 60000,
    });
    await page.waitForTimeout(SETTLE_MS);

    // Strip the game's own UI so the card shows the world, not the interface.
    // Without this the thumbnail is whatever screen the game happens to boot
    // into - usually its title screen, complete with language selector.
    const recipe = CAPTURE_RECIPES[game.slug];
    if (recipe) {
      const report = await page.evaluate(`(${STRIP_UI_JS})(${JSON.stringify(recipe)})`);
      if (report?.error) {
        console.warn(`[thumb] ${game.slug}: could not strip UI (${report.error}); shooting as-is`);
      } else {
        console.log(
          `[thumb] ${game.slug}: ${recipe.scene} kept ${report.kept}, hid ${report.hid} ` +
            `(+${report.siblings} sibling, +${report.a11y} a11y)`,
        );
      }
    }

    // Shoot the game surface, not the page. A Phaser game letterboxes itself
    // inside the viewport, and a portrait game leaves black bars down both
    // sides; cropping to the canvas keeps the card showing the game rather than
    // the space around it. A DOM game (no canvas) falls back to the viewport.
    const canvas = await page.$('canvas');
    let shot;
    const box = canvas ? await canvas.boundingBox() : null;
    if (box && recipe?.crop !== undefined) {
      // A portrait game cropped to its canvas is the wrong shape for a 16:9
      // card, and the landing page's object-fit: cover would show only its
      // middle band. Clip a 16:9 band centred where the recipe says the action
      // is - done with a screenshot clip so this needs no image library.
      const height = Math.round((box.width * 9) / 16);
      const centre = box.y + box.height * recipe.crop;
      const y = Math.max(box.y, Math.min(box.y + box.height - height, centre - height / 2));
      shot = await page.screenshot({
        type: 'png',
        clip: { x: box.x, y, width: box.width, height },
      });
    } else {
      shot = await (canvas ?? page).screenshot({ type: 'png' });
    }

    const out = join(game.packageDir, 'thumb.png');
    mkdirSync(game.packageDir, { recursive: true });
    writeFileSync(out, shot);
    console.log(`[thumb] ${game.slug} -> packages/${game.slug}/thumb.png`);
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log(
    `[thumb] captured ${games.length}. Add "thumbnail": "thumb.png" to each game.json, ` +
      'then `npm run build:site`.',
  );
}

await main();
