/**
 * Shared runner for the mission gates.
 *
 * The gates all have the same job: scan BUILT output for a shape that would break
 * a promise the project makes to players, report findings in one format, allow an
 * explicit baseline, and prove in both directions that the gate still works. Only
 * the shapes differ. This holds everything except the shapes.
 *
 * The identical finding record - {file, line, kind, target} - is deliberate: the
 * sponsorship page is meant to be generated FROM these gates' output, so a single
 * reader has to be able to fold every gate's results without special-casing each
 * one.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

/** Directory listing that tolerates a missing directory. */
function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Every file under a directory, recursively. */
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Line number of a string index, 1-based. */
export function lineAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

/** The built directories every gate scans: the site plus each game's bundle. */
export function builtRoots(root) {
  return ['_site', ...readdirSafe(join(root, 'packages')).map((p) => `packages/${p}/dist`)];
}

/**
 * Run one gate.
 *
 * @param {object} spec
 * @param {string} spec.name          Gate name used in output, e.g. 'check:network'.
 * @param {string} spec.root          Repo root.
 * @param {string} spec.baselineFile  Absolute path to the gate's baseline JSON.
 * @param {string} spec.promise       The player-facing promise, printed on failure.
 * @param {(text: string, file: string, ext: string) => object[]} spec.scan
 *        Returns findings for one file.
 * @param {() => number} spec.selftest
 *        Prints its own results and returns a count of PROBLEMS (0 = healthy).
 */
export function runGate(spec) {
  const argv = process.argv;

  // Always self-check before trusting a result. A gate that reports zero is
  // indistinguishable from a gate that has stopped working, and these gates are
  // expected to report zero, so the difference has to be measured every run.
  const problems = spec.selftest();
  if (problems > 0) {
    console.error(`${spec.name} selftest FAILED with ${problems} problem(s) - the gate itself is wrong.`);
    process.exit(3);
  }
  if (argv.includes('--selftest')) process.exit(0);

  const files = [];
  for (const rel of builtRoots(spec.root)) {
    const abs = join(spec.root, rel);
    if (existsSync(abs)) files.push(...walk(abs));
  }

  if (files.length === 0) {
    console.error(
      `${spec.name} found no built output to scan.\n` +
        'This gate reads what SHIPS, so run `npm run build` first.\n' +
        'Failing rather than passing: an empty scan is not evidence of compliance.',
    );
    process.exit(2);
  }

  const findings = [];
  for (const file of files) {
    const rel = relative(spec.root, file);
    const ext = extname(file).toLowerCase();
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue; // binary asset
    }
    findings.push(...spec.scan(text, rel, ext));
  }

  const key = (f) => `${f.file}::${f.kind}::${f.target}`;
  const baseline = existsSync(spec.baselineFile)
    ? JSON.parse(readFileSync(spec.baselineFile, 'utf8'))
    : { allowed: [] };
  const allowed = new Set((baseline.allowed ?? []).map((a) => `${a.file}::${a.kind}::${a.target}`));

  if (argv.includes('--update')) {
    const list = findings.map((f) => ({ file: f.file, kind: f.kind, target: f.target }));
    writeFileSync(spec.baselineFile, `${JSON.stringify({ allowed: list }, null, 2)}\n`);
    console.log(`${spec.name} baseline updated with ${list.length} entr(ies).`);
    process.exit(0);
  }

  if (argv.includes('--json')) {
    // Machine-readable, for the generated compliance report.
    console.log(JSON.stringify({ gate: spec.name, scanned: files.length, findings }, null, 2));
    process.exit(0);
  }

  if (argv.includes('--list')) {
    console.log(`${spec.name} scanned ${files.length} built file(s); ${findings.length} finding(s).`);
    for (const f of findings) console.log(`  ${f.file}:${f.line}  ${f.kind}\n      ${f.target}`);
    process.exit(0);
  }

  const unlisted = findings.filter((f) => !allowed.has(key(f)));
  if (unlisted.length > 0) {
    console.error(`${spec.name} FAILED: ${unlisted.length} violation(s) in built output.\n${spec.promise}\n`);
    for (const f of unlisted) console.error(`  ${f.file}:${f.line}  ${f.kind}\n      ${f.target}`);
    process.exit(1);
  }

  console.log(
    `${spec.name} OK - ${files.length} built file(s) scanned, clean` +
      `${allowed.size ? ` (${allowed.size} baselined)` : ''}.`,
  );
}
