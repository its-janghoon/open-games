/**
 * Shared loader for the per-package `game.json` metadata files.
 *
 * `packages/<slug>/game.json` is the single source of truth for everything
 * repo-level that needs to know which games exist: the landing page
 * (`site/build.mjs`), the README tables (`scripts/gen-readme.mjs`), and the
 * Pages workflow. Nothing outside a package should hard-code a game name or a
 * game count, so this module is the only place that walks `packages/`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const packagesDir = join(repoRoot, 'packages');

/** Allowed `status` values, in the order games should be listed. */
export const STATUSES = ['playable', 'wip', 'archived'];

/** Must be present and non-empty on every game, whatever its status. */
const REQUIRED_STRINGS = ['slug', 'title'];
/**
 * Must be present and non-empty once a game is listed as `playable`. A game
 * still at `wip` may leave them empty: a freshly scaffolded package should
 * build before anyone has written its copy, and an empty string is the honest
 * value for something nobody has decided yet.
 */
const REQUIRED_WHEN_PLAYABLE = ['genre', 'summary'];
const OPTIONAL_STRINGS = ['titleKo', 'summaryKo', 'thumbnail', 'hero'];

/**
 * Directories under `packages/` that are not games. Anything starting with an
 * underscore is scaffolding (`packages/_template`) and anything starting with a
 * dot is tooling noise.
 */
function isGameDir(name) {
  return !name.startsWith('_') && !name.startsWith('.');
}

function validate(meta, dir, metaPath) {
  const where = `packages/${dir}/game.json`;
  const problems = [];

  for (const key of REQUIRED_STRINGS) {
    if (typeof meta[key] !== 'string' || meta[key].trim() === '') {
      problems.push(`"${key}" is required and must be a non-empty string`);
    }
  }
  for (const key of REQUIRED_WHEN_PLAYABLE) {
    if (typeof meta[key] !== 'string') {
      problems.push(`"${key}" is required and must be a string (empty is allowed while status is not "playable")`);
    } else if (meta[key].trim() === '' && meta.status === 'playable') {
      problems.push(`"${key}" must be filled in before status is set to "playable"`);
    }
  }
  for (const key of OPTIONAL_STRINGS) {
    if (key in meta && typeof meta[key] !== 'string') {
      problems.push(`"${key}" must be a string when present`);
    }
  }
  if (meta.slug !== dir) {
    problems.push(`"slug" is "${meta.slug}" but the directory is "${dir}"; they must match`);
  }
  if (!STATUSES.includes(meta.status)) {
    problems.push(`"status" must be one of ${STATUSES.join(' | ')} (got ${JSON.stringify(meta.status)})`);
  }
  if (!Array.isArray(meta.stack) || meta.stack.some((s) => typeof s !== 'string')) {
    problems.push('"stack" must be an array of strings');
  }
  if (meta.thumbnail && !existsSync(join(packagesDir, dir, meta.thumbnail))) {
    problems.push(`"thumbnail" points at ${meta.thumbnail}, which does not exist in the package`);
  }
  if (meta.hero && !existsSync(join(packagesDir, dir, meta.hero))) {
    problems.push(`"hero" points at ${meta.hero}, which does not exist in the package`);
  }

  if (problems.length > 0) {
    throw new Error(`${where} is invalid:\n  - ${problems.join('\n  - ')}\n(read from ${metaPath})`);
  }
}

/**
 * Read and validate every `packages/<slug>/game.json`.
 *
 * A workspace with no `game.json` is skipped with a warning rather than
 * failing the build, so a future non-game workspace (a shared library, say)
 * does not break the site. A `game.json` that *is* present must be valid.
 *
 * @returns {Array<object>} games sorted by status (playable, then wip, then
 *   archived) and then by title.
 */
export function loadGames() {
  const dirs = readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isGameDir(entry.name))
    .map((entry) => entry.name);

  const games = [];
  for (const dir of dirs) {
    const metaPath = join(packagesDir, dir, 'game.json');
    if (!existsSync(metaPath)) {
      console.warn(`[games] packages/${dir} has no game.json; skipping.`);
      continue;
    }
    let meta;
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    } catch (error) {
      throw new Error(`packages/${dir}/game.json is not valid JSON: ${error.message}`);
    }
    validate(meta, dir, metaPath);
    games.push({ ...meta, dir, packageDir: join(packagesDir, dir) });
  }

  games.sort((a, b) => {
    const byStatus = STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status);
    return byStatus !== 0 ? byStatus : a.title.localeCompare(b.title, 'en');
  });
  return games;
}

/** Games that should appear in public listings: everything but `archived`. */
export function loadListedGames() {
  return loadGames().filter((game) => game.status !== 'archived');
}
