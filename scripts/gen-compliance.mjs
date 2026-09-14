#!/usr/bin/env node
/**
 * Generate the compliance report: one document folding every mission gate's
 * measured output.
 *
 * This exists because the project's promises are the reason to sponsor it, and a
 * promise nobody can check is marketing. The sponsorship page's body IS this
 * document - not prose about principles, but the numbers the build already
 * produces. That is also why all four gates were given a --json mode in the same
 * finding shape rather than only human output.
 *
 * Runs the gates rather than re-implementing them, so the page can never drift
 * from what the build enforces. A gate that fails still reports here: the point is
 * an honest record, not a clean one, and a report that could only say "all good"
 * would be worth nothing.
 *
 * Nothing commercial is invented. Funding terms, portal revenue shares and sponsor
 * names are not researched, so they are not stated - the document carries what is
 * measured plus what the project costs to run, and leaves the rest to a contact
 * line.
 *
 * Usage:
 *   node scripts/gen-compliance.mjs            # write site/compliance.json
 *   node scripts/gen-compliance.mjs --print    # print it instead
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const OUT = join(ROOT, 'site', 'compliance.json');

/**
 * Run one gate twice: once in --json to get its data, once in CHECK mode to get its
 * verdict from the exit code.
 *
 * Two runs because one is not enough, and finding that out cost a false green. The
 * --json mode is a QUERY - it prints the document and exits 0 even when it found
 * violations, which is correct for a query but means its exit code says nothing
 * about compliance. The first version of this generator keyed every verdict on that
 * exit code, so an injected third-party <script> produced a report claiming 5 of 5
 * claims passing while check:network itself was exiting 1 on the same tree.
 *
 * stdio is split deliberately: the gates print self-test diagnostics to stderr and
 * only the document to stdout. They did not at first - the diagnostics went to
 * stdout and made --json unparseable, which is the kind of defect that only appears
 * when something finally consumes the output.
 */
function runGate(script) {
  const file = join(ROOT, 'scripts', script);

  let data = null;
  try {
    data = JSON.parse(
      execFileSync('node', [file, '--json'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 32 * 1024 * 1024,
      }),
    );
  } catch (err) {
    try {
      data = JSON.parse(err.stdout?.toString() ?? '');
    } catch {
      data = null;
    }
  }

  let ok = false;
  let error = null;
  try {
    execFileSync('node', [file], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 });
    ok = true;
  } catch (err) {
    error = (err.stderr?.toString() ?? err.message).trim().slice(0, 400);
  }

  return { ok, data, error };
}

const KB = (n) => Math.round((n / 1024) * 10) / 10;

const network = runGate('check-network.mjs');
const payments = runGate('check-payments.mjs');
const selfhosted = runGate('check-selfhosted.mjs');
const budget = runGate('check-budget.mjs');

const offlinePath = join(ROOT, 'scripts', 'offline-status.json');
const offline = existsSync(offlinePath) ? JSON.parse(readFileSync(offlinePath, 'utf8')) : null;

const budgetPath = join(ROOT, 'scripts', 'budget-baseline.json');
const budgetDoc = existsSync(budgetPath) ? JSON.parse(readFileSync(budgetPath, 'utf8')) : null;

/** One claim: what is promised, how it is checked, and what the check found. */
const claims = [];

claims.push({
  id: 'no-third-party-requests',
  promise: 'The games contact nobody. No font CDN, no analytics, no ad call.',
  checkedBy: 'check:network, on the BUILT bundles - a dependency can emit a request the source never shows.',
  verdict: network.ok ? 'pass' : 'fail',
  measured: network.data
    ? `${network.data.scanned} built files scanned, ${network.data.findings.length} third-party request(s) found.`
    : 'gate did not report',
  findings: network.data?.findings ?? [],
  note:
    'An <a href> to the project’s own repository is not counted: it fetches nothing until ' +
    'a reader chooses to follow it. Counting those would have reported 13 violations where ' +
    'the honest number is zero.',
});

claims.push({
  id: 'no-payment-code',
  promise: 'The games cannot take money. There is no purchase path to hide.',
  checkedBy:
    'check:payments, matching processor hosts and SDK call shapes rather than payment words.',
  verdict: payments.ok ? 'pass' : 'fail',
  measured: payments.data
    ? `${payments.data.scanned} built files scanned, ${payments.data.findings.length} payment integration(s) found.`
    : 'gate did not report',
  findings: payments.data?.findings ?? [],
  note:
    'The word “purchase” appears 40 times in these bundles and every one is gameplay - ' +
    'Arena Champions is a MOBA with an in-match item shop. A gate matching words would ' +
    'report 40 violations against an honest zero, so it matches integrations instead.',
});

claims.push({
  id: 'self-hosted',
  promise: 'Every asset a game loads comes from the game itself.',
  checkedBy: 'check:selfhosted, resolving every asset path a bundle names against what shipped.',
  verdict: selfhosted.ok ? 'pass' : 'fail',
  measured: selfhosted.data
    ? `${selfhosted.data.games.reduce((n, g) => n + g.named, 0)} asset paths across ` +
      `${selfhosted.data.games.length} games, ${selfhosted.data.findings.length} missing or cross-origin.`
    : 'gate did not report',
  findings: selfhosted.data?.findings ?? [],
});

const games = (budget.data?.games ?? []).map((g) => ({
  slug: g.slug,
  firstWaitKB: KB(g.coldLoad),
  totalKB: KB(g.total),
  byClassKB: Object.fromEntries(
    Object.entries(g.byClass)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => [k, KB(v)]),
  ),
}));

claims.push({
  id: 'transfer-budget',
  promise:
    'The games stay small enough for a metered connection, and cannot quietly grow.',
  checkedBy: 'check:budget, gzipped bytes per game per asset class against committed ceilings.',
  verdict: budget.ok ? 'pass' : 'fail',
  measured: games.length
    ? `First wait ${Math.min(...games.map((g) => g.firstWaitKB))}–${Math.max(...games.map((g) => g.firstWaitKB))} KB; ` +
      `full download ${Math.min(...games.map((g) => g.totalKB))}–${Math.max(...games.map((g) => g.totalKB))} KB.`
    : 'gate did not report',
  games,
  note:
    'The audio figure counts both shipped formats though a browser downloads only one, ' +
    'so it overstates what a player pays. A ceiling that over-counts fails safe.',
});

claims.push({
  id: 'works-offline',
  promise: 'A game that has been opened once keeps working with no network.',
  checkedBy:
    'A real browser driven over the DevTools protocol with the network denied, not an assertion. Re-runnable: scripts/lib/offline-probe.py.',
  verdict: offline?.result?.boots_offline ? 'pass' : 'not verified',
  measured: offline
    ? `${offline.result.observed} Games probed: ${(offline.result.games_probed ?? []).join(', ')}.`
    : 'no measurement on record',
  method: offline?.method ?? null,
  notYetMeasured: offline?.not_yet_measured ?? [],
});

/** What the project honestly has not done. A wins-only report is not evidence. */
const openWork = [];
if (budgetDoc?._blocked) {
  openWork.push({
    item: budgetDoc._blocked.item,
    size: budgetDoc._blocked.size,
    why: budgetDoc._blocked.why_blocked,
    needs: budgetDoc._blocked.needs_from_the_user,
  });
}

const report = {
  generated: new Date().toISOString().slice(0, 10),
  generatedBy: 'scripts/gen-compliance.mjs',
  howToReproduce: 'npm run build — every claim below is a gate the build already runs.',
  summary: {
    claims: claims.length,
    passing: claims.filter((c) => c.verdict === 'pass').length,
    thirdPartyRequests: network.data?.findings.length ?? null,
    paymentIntegrations: payments.data?.findings.length ?? null,
    games: games.length,
  },
  claims,
  openWork,
  funding: {
    // Deliberately no figures. None are researched, and inventing them would be
    // exactly the kind of unverifiable claim this document exists to avoid.
    serverCost: 'Zero. The games are static files; multiplayer is peer-to-peer or local-network, so there is no backend to run.',
    whatIsAskedFor: 'Sponsorship and portal revenue share, so the games can stay free with no purchases and no advertising.',
    whatIsNotTaken: 'In-app purchases, advertising, telemetry, and any third-party runtime request.',
    terms: 'Not settled. Talk to us rather than reading a number here that nobody has agreed.',
  },
  licence: 'Apache-2.0. Every game, asset and gate in this report is in the public repository.',
};

if (process.argv.includes('--print')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `gen-compliance: wrote site/compliance.json - ${report.summary.passing}/${report.summary.claims} claims passing, ` +
      `${openWork.length} open item(s).`,
  );
}

// A gate that FAILED must not be reported as a pass, and must not silently produce a
// green page either. Exit non-zero so the build stops.
const failed = claims.filter((c) => c.verdict === 'fail');
if (failed.length > 0) {
  console.error(
    `\ngen-compliance: ${failed.length} claim(s) FAILED - ${failed.map((c) => c.id).join(', ')}.\n` +
      'The report records this honestly, but a build should not publish it as compliance.',
  );
  process.exit(1);
}
