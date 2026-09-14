import { describe, expect, it } from 'vitest';

import { LANES } from './map';
import {
  cloneWaveSchedule,
  initialWaveSchedule,
  scheduleDueWaves,
  type WaveSchedule,
} from './waveSchedule';
import { nextWaveNumberAt } from './minions';

const STANDING = { killedAt: {} as Record<string, number | null> };
const alwaysAlive = () => true;
const neverAlive = () => false;

/** Elapsed time at which at least one wave is due, taken from the rules rather than hardcoded. */
function firstWaveTime(): number {
  for (let t = 0; t < 600; t += 0.5) {
    if (nextWaveNumberAt(t) >= 1) return t;
  }
  throw new Error('no wave is ever due, which would make every test below vacuous');
}

describe('wave schedule', () => {
  it('schedules nothing before the first wave is due', () => {
    const after = scheduleDueWaves(initialWaveSchedule(), 0, LANES, STANDING, alwaysAlive);
    expect(after.spawnedWaves).toBe(0);
    expect(after.pending).toEqual([]);
  });

  it('schedules a wave once it is due, for both teams and every lane', () => {
    const t = firstWaveTime();
    const after = scheduleDueWaves(initialWaveSchedule(), t, LANES, STANDING, alwaysAlive);
    expect(after.spawnedWaves).toBe(1);
    expect(after.pending.length).toBeGreaterThan(0);
    expect(new Set(after.pending.map((s) => s.team))).toEqual(new Set(['ally', 'enemy']));
    expect(new Set(after.pending.map((s) => s.lane))).toEqual(new Set(LANES));
  });

  it('does not schedule the same wave twice when called again at the same time', () => {
    // The catch-up loop compares against spawnedWaves, so a second call at the same instant must be a no-op. Without
    // that, every tick after the first wave would schedule another whole wave.
    const t = firstWaveTime();
    const once = scheduleDueWaves(initialWaveSchedule(), t, LANES, STANDING, alwaysAlive);
    const twice = scheduleDueWaves(once, t, LANES, STANDING, alwaysAlive);
    expect(twice.spawnedWaves).toBe(once.spawnedWaves);
    expect(twice.pending).toEqual(once.pending);
  });

  it('catches up when several wave intervals passed at once', () => {
    // A frame that swallowed time must still schedule every wave it skipped, exactly once each.
    const t = firstWaveTime() + 600;
    const wanted = nextWaveNumberAt(t);
    expect(wanted, 'the scenario must actually skip waves').toBeGreaterThan(1);
    const after = scheduleDueWaves(initialWaveSchedule(), t, LANES, STANDING, alwaysAlive);
    expect(after.spawnedWaves).toBe(wanted);
  });

  it('stamps every member with a distinct, monotonic insertion order', () => {
    /**
     * The half that is easy to leave out. Restore the queue but not the counter and a spawn scheduled after the
     * restore reuses a number an entry still queued already holds — so two spawns sharing a deadline become
     * indistinguishable and the tiebreak has nothing left to break on. Same failure the impact queue had.
     */
    const t = firstWaveTime() + 600;
    const after = scheduleDueWaves(initialWaveSchedule(), t, LANES, STANDING, alwaysAlive);
    const orders = after.pending.map((s) => s.insertionOrder);
    expect(new Set(orders).size, 'insertion orders must be unique').toBe(orders.length);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(after.nextOrder).toBe(Math.max(...orders) + 1);
  });

  it('upgrades a lane to super minions only when the enemy inhibitor is down', () => {
    const t = firstWaveTime();
    const standing = scheduleDueWaves(initialWaveSchedule(), t, LANES, STANDING, alwaysAlive);
    const fallen = scheduleDueWaves(initialWaveSchedule(), t, LANES, STANDING, neverAlive);
    expect(fallen.pending.length).toBeGreaterThan(standing.pending.length);
    expect(fallen.pending.some((s) => s.type === 'super')).toBe(true);
    expect(standing.pending.some((s) => s.type === 'super')).toBe(false);
  });

  it('uses ABSOLUTE due times, so a replayed tick reaches the same verdict', () => {
    const t = firstWaveTime();
    const after = scheduleDueWaves(initialWaveSchedule(), t, LANES, STANDING, alwaysAlive);
    for (const spawn of after.pending) expect(spawn.dueAt).toBeGreaterThanOrEqual(t);
  });

  it('is deterministic: the same inputs give byte-identical output', () => {
    const t = firstWaveTime() + 300;
    const a = scheduleDueWaves(initialWaveSchedule(), t, LANES, STANDING, alwaysAlive);
    const b = scheduleDueWaves(initialWaveSchedule(), t, LANES, STANDING, alwaysAlive);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('does not mutate the schedule it was given', () => {
    const t = firstWaveTime();
    const before = initialWaveSchedule();
    const snapshot = JSON.stringify(before);
    scheduleDueWaves(before, t, LANES, STANDING, alwaysAlive);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('clones independently, so a snapshot cannot be mutated through its copy', () => {
    const t = firstWaveTime();
    const original = scheduleDueWaves(initialWaveSchedule(), t, LANES, STANDING, alwaysAlive);
    const copy: WaveSchedule = cloneWaveSchedule(original);
    copy.spawnedWaves = 99;
    copy.nextOrder = 99;
    copy.pending[0].dueAt = -1;
    copy.pending.push({ ...copy.pending[0], insertionOrder: 999 });
    expect(original.spawnedWaves).toBe(1);
    expect(original.nextOrder).not.toBe(99);
    expect(original.pending[0].dueAt).toBeGreaterThanOrEqual(t);
    expect(original.pending.some((s) => s.insertionOrder === 999)).toBe(false);
  });
});
