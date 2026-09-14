#!/usr/bin/env node
/**
 * Mission gate: every asset a game loads at runtime is self-hosted and present.
 *
 * This is the gate the roadmap called "offline smoke", renamed to what it actually
 * proves, because measuring it first showed the original claim is FALSE today.
 * Driving a real browser over CDP (playwright is not installed here, so the
 * DevTools protocol directly) with Network.emulateNetworkConditions offline=true
 * and reloading whiteout produces Chrome's ERR_INTERNET_DISCONNECTED page:
 * window.__GAME__ is gone, no scenes are running. There is no service worker
 * anywhere in the repo, so nothing is cached and a same-origin request still needs
 * the network.
 *
 * A gate named check:offline that passed would therefore be certifying something
 * untrue. What IS true and worth pinning is the precondition: all 53 requests
 * whiteout makes are same-origin under its own directory, and nothing is fetched
 * from anywhere else. Self-hosting is necessary for offline play, and it is also
 * what keeps a metered-data player from paying a third party. Booting with the
 * network denied additionally requires a service worker, which is a feature to
 * build, not a rule to assert - it is recorded as such rather than papered over.
 *
 * The check: for every asset path a bundle names, that file must exist in dist. A
 * missing asset is a broken game, and it is exactly the failure that would strand
 * an offline player on a request that can never be served.
 *
 * Usage:
 *   node scripts/check-selfhosted.mjs            # fail on a missing or remote asset
 *   node scripts/check-selfhosted.mjs --list     # print what was resolved
 *   node scripts/check-selfhosted.mjs --json     # machine-readable, for the report
 *   node scripts/check-selfhosted.mjs --selftest # prove the gate still detects
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * Asset path literals a bundle names. Matched as quoted strings beginning with an
 * assets/ segment, which is how the loader refers to them after the build rewrites
 * paths. Remote URLs are matched separately so a cross-origin asset reports as a
 * different, more serious kind.
 */
const ASSET_LITERAL = /["'`]((?:\.\/)?assets\/[A-Za-z0-9._/-]+\.[A-Za-z0-9]{2,5})["'`]/g;
const REMOTE_ASSET = /["'`]((?:https?:)?\/\/[^"'`\s]*\/[A-Za-z0-9._-]+\.(?:png|jpg|jpeg|webp|gif|svg|wav|mp3|ogg|woff2?|ttf|json))["'`]/g;

export function findAssetRefs(text) {
  const local = new Set();
  const remote = new Set();
  for (const m of text.matchAll(ASSET_LITERAL)) local.add(m[1].replace(/^\.\//, ''));
  for (const m of text.matchAll(REMOTE_ASSET)) remote.add(m[1]);
  return { local: [...local], remote: [...remote] };
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

function selftest() {
  let problems = 0;

  const refs = findAssetRefs(
    [
      'this.load.audio("hit","assets/audio/battle_hit.wav");',
      'this.load.image("f","./assets/sprites/furnace.png");',
      'const remote = "https://cdn.example.com/sprites/boss.png";',
      // Must NOT be read as an asset: no extension, and not under assets/.
      'const key = "assets";',
      'const label = "sprites/furnace";',
    ].join('\n'),
  );
  if (refs.local.length !== 2) {
    console.error(`  selftest refs: expected 2 local, got ${refs.local.length} -> ${refs.local}`);
    problems += 1;
  }
  if (refs.remote.length !== 1) {
    console.error(`  selftest refs: expected 1 remote, got ${refs.remote.length} -> ${refs.remote}`);
    problems += 1;
  }
  if (refs.local.some((p) => p.startsWith('./'))) {
    console.error('  selftest refs: leading ./ should be normalised away');
    problems += 1;
  }
  if (problems === 0) console.log('  selftest: asset-literal extraction OK (local, remote, non-assets ignored)');
  return problems;
}

const problems = selftest();
if (problems > 0) {
  console.error(`check:selfhosted selftest FAILED with ${problems} problem(s) - the gate itself is wrong.`);
  process.exit(3);
}
if (process.argv.includes('--selftest')) process.exit(0);

const slugs = readdirSync(join(ROOT, 'packages')).filter((p) =>
  existsSync(join(ROOT, 'packages', p, 'dist')),
);
if (slugs.length === 0) {
  console.error(
    'check:selfhosted found no built output.\n' +
      'This gate reads what SHIPS, so run `npm run build` first.\n' +
      'Failing rather than passing: an empty scan is not evidence of compliance.',
  );
  process.exit(2);
}

const findings = [];
const summary = [];
for (const slug of slugs) {
  const dist = join(ROOT, 'packages', slug, 'dist');
  const present = new Set(
    walk(dist).map((f) => f.slice(dist.length + 1).split('\\').join('/')),
  );
  const named = new Set();
  const remotes = new Set();

  for (const file of walk(dist)) {
    if (!/\.(js|mjs|css|html)$/i.test(file)) continue;
    const refs = findAssetRefs(readFileSync(file, 'utf8'));
    const rel = file.slice(ROOT.length + 1);
    for (const p of refs.local) {
      named.add(p);
      if (!present.has(p)) {
        findings.push({
          file: rel,
          line: 0,
          kind: 'asset named but missing from dist',
          target: p,
        });
      }
    }
    for (const r of refs.remote) {
      remotes.add(r);
      findings.push({ file: rel, line: 0, kind: 'asset fetched cross-origin', target: r });
    }
  }
  summary.push({ slug, named: named.size, missing: findings.filter((f) => f.file.includes(`/${slug}/`)).length, remote: remotes.size });
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ gate: 'check:selfhosted', games: summary, findings }, null, 2));
  process.exit(0);
}

if (process.argv.includes('--list')) {
  for (const s of summary) {
    console.log(`  ${s.slug.padEnd(9)} ${String(s.named).padStart(3)} asset path(s) named, ${s.missing} missing, ${s.remote} remote`);
  }
  process.exit(0);
}

if (findings.length > 0) {
  console.error(
    `check:selfhosted FAILED: ${findings.length} problem(s).\n` +
      'Every asset a game loads must be served from the game itself. A missing file\n' +
      'is a broken game, and a cross-origin one makes a metered-data player pay a\n' +
      'third party.\n',
  );
  for (const f of findings) console.error(`  ${f.file}\n      ${f.kind}: ${f.target}`);
  process.exit(1);
}

const total = summary.reduce((n, s) => n + s.named, 0);
console.log(
  `check:selfhosted OK - ${total} asset path(s) across ${summary.length} game(s), all present and same-origin.`,
);
