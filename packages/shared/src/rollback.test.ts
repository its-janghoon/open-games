import { describe, it, expect } from 'vitest';

import {
  DEFAULT_SNAPSHOT_INTERVAL,
  RollbackSession,
  type Simulation,
} from './rollback';

/**
 * A reference simulation: two players moving on a line, integer-only so equality is
 * exact and a floating-point difference cannot hide a real desync.
 *
 * Deliberately trivial. The purpose is to test the ROLLBACK machinery, and a complex
 * reference world would let a failure be blamed on the world instead.
 */
type Input = { dx: number };
interface State {
  pos: Record<string, number>;
  /** Sum of every step ever applied, so a wrong replay shows up even if pos matches. */
  work: number;
}

const reference: Simulation<State, Input> = {
  initial: () => ({ pos: { a: 0, b: 0 }, work: 0 }),
  // MUTATES and returns the same object, the way a real simulation does. An earlier
  // version of this reference built a fresh state every step, which quietly made the
  // clone() contract untestable: sharing a reference with a snapshot was harmless
  // because nothing ever wrote through it. Injecting `clone: (state) => state` did not
  // fail a single test, which is how that hole was found.
  step: (state, inputs, tick) => {
    // Sorted, because iteration order over the input map must not affect the result -
    // that is exactly the kind of hidden nondeterminism that desyncs a real game.
    for (const id of [...inputs.keys()].sort()) {
      state.pos[id] = (state.pos[id] ?? 0) + inputs.get(id)!.dx;
      state.work += inputs.get(id)!.dx * (tick + 1);
    }
    return state;
  },
  clone: (state) => ({ pos: { ...state.pos }, work: state.work }),
  // Predict that a player keeps doing what they were last seen doing - the standard
  // assumption, and correct most of the time at 60Hz.
  predict: (_id, lastKnown) => ({ dx: lastKnown?.dx ?? 0 }),
};

const session = (over: Partial<{ snapshotInterval: number; maxRollbackTicks: number }> = {}) =>
  new RollbackSession(reference, { participants: ['a', 'b'], ...over });

describe('determinism of the reference simulation', () => {
  it('produces identical state from identical inputs, twice', () => {
    // The property rollback depends on. Asserted here rather than assumed, because
    // rollback on a nondeterministic simulation does not fail - it silently desyncs.
    const run = () => {
      const s = session();
      for (let tick = 0; tick < 40; tick += 1) {
        s.setLocalInput('a', { dx: (tick % 3) - 1 });
        s.setLocalInput('b', { dx: tick % 2 });
        s.advance();
      }
      return s.peek();
    };
    expect(run()).toEqual(run());
  });

  it('does not depend on the order inputs are enumerated in', () => {
    const forward = new RollbackSession(reference, { participants: ['a', 'b'] });
    const reversed = new RollbackSession(reference, { participants: ['b', 'a'] });
    for (let tick = 0; tick < 20; tick += 1) {
      for (const s of [forward, reversed]) {
        s.setLocalInput('a', { dx: 1 });
        s.setLocalInput('b', { dx: -2 });
        s.advance();
      }
    }
    expect(forward.peek()).toEqual(reversed.peek());
  });
});

describe('RollbackSession without corrections', () => {
  it('advances and keeps snapshots at the interval', () => {
    const s = session({ snapshotInterval: 4 });
    s.advanceTo(12);
    expect(s.tick).toBe(12);
    // tick 0 plus 4, 8, 12
    expect(s.stats().snapshots).toBe(4);
  });

  it('predicts a missing input as a continuation of the last known one', () => {
    const s = session();
    s.setLocalInput('a', { dx: 5 });
    s.setLocalInput('b', { dx: 0 });
    s.advance();
    // No input for a at tick 1: prediction should carry dx 5 forward.
    s.setLocalInput('b', { dx: 0 });
    s.advance();
    expect(s.peek().pos.a).toBe(10);
  });
});

describe('RollbackSession corrections', () => {
  it('costs nothing when a late input confirms the prediction', () => {
    const s = session();
    s.setLocalInput('a', { dx: 2 });
    s.setLocalInput('b', { dx: 1 });
    s.advance();
    s.advanceTo(6); // b's inputs at ticks 1..5 are predicted as dx 1
    const result = s.applyRemoteInput('b', 3, { dx: 1 });
    expect(result.accepted).toBe(true);
    expect(result.resimulated, 'a correct prediction must not trigger work').toBe(0);
  });

  it('rewinds and replays when a late input contradicts the prediction', () => {
    const s = session({ snapshotInterval: 4 });
    s.setLocalInput('a', { dx: 0 });
    s.setLocalInput('b', { dx: 1 });
    s.advance();
    s.advanceTo(10);
    const before = s.peek().pos.b;
    const result = s.applyRemoteInput('b', 5, { dx: -4 });
    expect(result.accepted).toBe(true);
    expect(result.resimulated).toBeGreaterThan(0);
    expect(s.tick, 'the head must be restored, not left in the past').toBe(10);
    expect(s.peek().pos.b).not.toBe(before);
  });

  it('reaches exactly the state a run with the truth from the start would reach', () => {
    // The correctness property that matters: after correction, the rolled-back session
    // and a session that always knew the real input must be identical. Anything less
    // means the two players are now simulating different worlds.
    const truth = new Map<number, number>([
      [0, 1],
      [1, 1],
      [2, -3],
      [3, 0],
      [4, 2],
      [5, 2],
      [6, -1],
      [7, -1],
    ]);

    const ideal = session({ snapshotInterval: 3 });
    for (let tick = 0; tick < 8; tick += 1) {
      ideal.setLocalInput('a', { dx: tick });
      ideal.setLocalInput('b', { dx: truth.get(tick)! });
      ideal.advance();
    }

    const predicted = session({ snapshotInterval: 3 });
    for (let tick = 0; tick < 8; tick += 1) {
      predicted.setLocalInput('a', { dx: tick });
      // b's input only arrives for the first tick; the rest are predicted.
      if (tick === 0) predicted.setLocalInput('b', { dx: truth.get(0)! });
      predicted.advance();
    }
    // The truth arrives late, out of order, the way a network delivers it.
    for (const tick of [2, 6, 4, 5, 3, 7, 1]) {
      predicted.applyRemoteInput('b', tick, { dx: truth.get(tick)! });
    }

    expect(predicted.tick).toBe(ideal.tick);
    expect(predicted.peek()).toEqual(ideal.peek());
  });

  it('replays across more than one snapshot interval', () => {
    const s = session({ snapshotInterval: 2 });
    s.setLocalInput('a', { dx: 1 });
    s.setLocalInput('b', { dx: 1 });
    s.advance();
    s.advanceTo(20);
    const result = s.applyRemoteInput('b', 2, { dx: -9 });
    expect(result.resimulated).toBe(18);
    expect(s.tick).toBe(20);
  });

  it('replays the predictions it originally USED, not freshly recomputed ones', () => {
    // The subtle one, and the second hole injection found. During a replay,
    // lastKnownBefore() can see inputs confirmed AFTER the original run, so recomputing
    // a prediction produces a different guess for ticks nobody corrected - and those
    // ticks then silently change. Replay must reuse what was actually used.
    //
    // The setup has to withhold tick 0 during the live run, which an earlier version of
    // this test did not: with tick 0 already known, recomputing and reusing agree and
    // the bug walks through. So b sends NOTHING live - ticks 0..5 predict dx 0 because
    // there is no last-known input - and only afterwards does tick 0 arrive as dx 9.
    const s = session({ snapshotInterval: 8 });
    for (let tick = 0; tick < 6; tick += 1) {
      s.setLocalInput('a', { dx: 0 });
      s.advance();
    }
    expect(s.peek().pos.b, 'every tick of b was predicted as standing still').toBe(0);

    s.applyRemoteInput('b', 0, { dx: 9 });

    // Reusing the original predictions: only tick 0 changes, so b moved 9.
    // Recomputing them: ticks 1..5 would now predict dx 9 as well, giving 54.
    expect(s.peek().pos.b).toBe(9);
  });
});

describe('RollbackSession refusals', () => {
  it('refuses an input older than the rollback window instead of applying it wrongly', () => {
    // There is no snapshot left to rewind to, so applying it would corrupt the world
    // quietly. Refusing is the only honest answer.
    const s = session({ snapshotInterval: 4, maxRollbackTicks: 8 });
    s.advanceTo(40);
    const result = s.applyRemoteInput('b', 1, { dx: 3 });
    expect(result.accepted).toBe(false);
    expect(result.rejection).toBe('too-old');
    expect(result.resimulated).toBe(0);
  });

  it('refuses an input for a tick that has not happened yet', () => {
    const s = session();
    s.advanceTo(5);
    const result = s.applyRemoteInput('b', 50, { dx: 1 });
    expect(result.accepted).toBe(false);
    expect(result.rejection).toBe('future-tick');
  });

  it('refuses an unknown participant rather than inventing one mid-match', () => {
    const s = session();
    s.advanceTo(3);
    expect(s.applyRemoteInput('c', 1, { dx: 1 }).rejection).toBe('unknown-participant');
    expect(s.setLocalInput('c', { dx: 1 })).toBe(false);
  });

  it('accepts an input at exactly the head as a normal input, not a rollback', () => {
    const s = session();
    s.advanceTo(4);
    const result = s.applyRemoteInput('b', 4, { dx: 7 });
    expect(result.accepted).toBe(true);
    expect(result.resimulated).toBe(0);
    s.advance();
    expect(s.peek().pos.b).toBe(7);
  });
});

describe('RollbackSession memory', () => {
  it('bounds snapshots and input history to the rollback window', () => {
    // Without pruning, a long match holds every snapshot and every input forever - the
    // failure that only appears in the matches people care about.
    const s = session({ snapshotInterval: DEFAULT_SNAPSHOT_INTERVAL, maxRollbackTicks: 32 });
    s.advanceTo(2000);
    const stats = s.stats();
    expect(stats.tick).toBe(2000);
    expect(stats.snapshots).toBeLessThan(12);
    expect(stats.trackedTicks).toBeLessThan(64);
    expect(stats.oldestSnapshot).toBeGreaterThan(1900);
  });

  it('can still roll back to the oldest surviving snapshot after pruning', () => {
    const s = session({ snapshotInterval: 4, maxRollbackTicks: 20 });
    s.setLocalInput('a', { dx: 1 });
    s.setLocalInput('b', { dx: 1 });
    s.advanceTo(100);
    const oldest = s.stats().oldestSnapshot;
    const result = s.applyRemoteInput('b', oldest, { dx: -5 });
    expect(result.accepted, 'the oldest snapshot must remain a valid rollback base').toBe(true);
    expect(s.tick).toBe(100);
  });
});
