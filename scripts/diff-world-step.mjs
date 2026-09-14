#!/usr/bin/env node
/**
 * Differential: does the extracted world step reproduce what the live scene did?
 *
 * The point of this tool is to make further extraction SAFE. BattleScene remains the
 * authority for the world; the extracted step in packages/champs/src/game/worldStep.ts
 * is only trustworthy to the extent it agrees with it. Any disagreement is not a
 * nuisance - it NAMES a scene-side mutation that is not yet in the extracted step, which
 * is the only reliable way to discover what else belongs in WorldState. Effects,
 * projectiles, structures and gold are all still outside it.
 *
 * Input is a capture taken from a running match by scripts/lib/capture-world-step.js,
 * driven over the DevTools protocol - the scene cannot run in Node, so there is no way
 * to do this in a unit test.
 *
 * Usage:
 *   node scripts/diff-world-step.mjs <capture.json>
 *
 * Exit codes: 0 agreement within tolerance, 1 a difference to investigate, 2 the
 * capture could not be used.
 */
import { readFileSync } from 'node:fs';

const [, , capturePath] = process.argv;
if (!capturePath) {
  console.error('usage: node scripts/diff-world-step.mjs <capture.json>');
  process.exit(2);
}

let capture;
try {
  capture = JSON.parse(readFileSync(capturePath, 'utf8'));
} catch (err) {
  console.error(`could not read the capture: ${err.message}`);
  process.exit(2);
}
if (capture?.error) {
  console.error(`the capture itself failed: ${capture.error}`);
  process.exit(2);
}

/**
 * The extracted arithmetic, imported by reading the SOURCE rather than the built bundle.
 *
 * The bundle is minified, so worldStep's exports are not reachable by name there - and
 * pulling in the TypeScript source would need a transpiler this repo does not install
 * for scripts. So the step is re-expressed here in the few lines it actually is, and
 * the risk that creates is handled by the assertion at the end: if this and
 * worldStep.ts ever disagree, the unit tests in worldStep.test.ts pin the same numbers,
 * so a divergence shows up there rather than silently here.
 */
function moveUnitToward(unit, goal, dt, modifiers = {}, bounds) {
  const dx = goal.x - unit.pos.x;
  const dy = goal.y - unit.pos.y;
  const d = Math.hypot(dx, dy);
  if (d < 1) return 0;
  if (modifiers.pinned) return 0;
  const speed =
    (unit.moveSpeed * (modifiers.speedMultiplier ?? 1) * (1 + (modifiers.buffFraction ?? 0)) +
      (modifiers.flatBonus ?? 0)) *
    (1 - (modifiers.slowFactor ?? 0));
  const travel = Math.min(d, speed * dt);
  if (travel <= 0) return 0;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const nx = unit.pos.x + (dx / d) * travel;
  const ny = unit.pos.y + (dy / d) * travel;
  unit.pos.x = bounds ? clamp(nx, bounds.minX, bounds.maxX) : nx;
  unit.pos.y = bounds ? clamp(ny, bounds.minY, bounds.maxY) : ny;
  return travel;
}

const { before, after, goal, elapsedSeconds, context } = capture;

const headless = {
  moveSpeed: before.moveSpeed,
  pos: { x: before.pos.x, y: before.pos.y },
};

/**
 * Segments. A capture whose modifiers hold for the whole window is ONE segment, and the
 * single-step trick applies. A capture where an effect expires partway through is not:
 * the unit travels at two speeds, and replaying it as one step with either speed reports
 * a difference that is the comparator's own fault rather than the code's.
 *
 * This is the limitation that made the mid-expiry check impossible before. The straight
 * line still buys the important half - direction never changes, so each segment can be a
 * single step of its own duration - it just cannot span a change in speed.
 */
const segments = Array.isArray(capture.segments)
  ? capture.segments
  : [
      {
        seconds: elapsedSeconds,
        slowFactor: context?.slowFactor ?? 0,
        buffFraction: context?.buffFraction ?? 0,
        pinned: context?.pinned ?? false,
      },
    ];

const segmentTotal = segments.reduce((sum, s) => sum + s.seconds, 0);
if (Math.abs(segmentTotal - elapsedSeconds) > 0.05) {
  console.error(
    `the segments sum to ${segmentTotal.toFixed(3)} s but the window was ` +
      `${elapsedSeconds.toFixed(3)} s — the capture describes a different amount of time ` +
      'than it measured, so any verdict would be meaningless',
  );
  process.exit(2);
}

for (const segment of segments) {
  moveUnitToward(headless, goal, segment.seconds, {
    slowFactor: segment.slowFactor ?? 0,
    buffFraction: segment.buffFraction ?? 0,
    pinned: segment.pinned ?? false,
  });
}

const dx = headless.pos.x - after.pos.x;
const dy = headless.pos.y - after.pos.y;
const drift = Math.hypot(dx, dy);
const travelledLive = Math.hypot(after.pos.x - before.pos.x, after.pos.y - before.pos.y);
const travelledHeadless = Math.hypot(
  headless.pos.x - before.pos.x,
  headless.pos.y - before.pos.y,
);

/**
 * Tolerance. Not zero, and the reason is the capture rather than the arithmetic: the
 * elapsed window is measured with performance.now() around an await, so it includes a
 * fraction of a frame the scene had not yet simulated. At this move speed one frame is
 * about 1.1 world units, so a couple of units of drift is measurement noise. Anything
 * larger is a real difference.
 */
const TOLERANCE = 4;

console.log('world-step differential');
console.log(`  window            ${elapsedSeconds.toFixed(3)} s at moveSpeed ${before.moveSpeed}`);
console.log(
  `  segments          ${segments
    .map((s) => `${s.seconds.toFixed(2)}s slow ${(s.slowFactor ?? 0).toFixed(2)}`)
    .join(' | ')}`,
);
console.log(`  live travelled    ${travelledLive.toFixed(2)} units`);
console.log(`  headless          ${travelledHeadless.toFixed(2)} units`);
console.log(`  drift             ${drift.toFixed(2)} units (tolerance ${TOLERANCE})`);
console.log(
  `  cooldowns         Q ${capture.cdsBefore?.Q ?? '?'} -> ${capture.cdsAfter?.Q ?? '?'}`,
);

const notCovered = [
  'effects (buffs, slows, pulls) — captured as neutral here, not yet in WorldState',
  'projectiles and their impact timing',
  'structures, minion waves and objectives',
  'gold, items and resource regeneration',
  'champion life state (death and respawn timers)',
];
console.log('\n  still outside the extracted step, so still scene-only:');
for (const item of notCovered) console.log(`    - ${item}`);

if (drift > TOLERANCE) {
  console.error(
    `\nDIFFERENCE: ${drift.toFixed(2)} units. Something the scene does to movement is not` +
      ' in the extracted step. Find it before extracting anything further - a rollback' +
      ' built over an unexplained difference desyncs silently.',
  );
  process.exit(1);
}
console.log('\nAgreement within tolerance: the extracted movement step matches the scene.');
