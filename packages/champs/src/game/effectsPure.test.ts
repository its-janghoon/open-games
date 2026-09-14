import { describe, it, expect } from 'vitest';

import {
  activePull,
  applyMovementBuff,
  applyPull,
  applySlow,
  createEffectState,
  expireEffects,
  readMovementBuff,
  readPull,
  readSlow,
  strongestMovementBuff,
  strongestSlow,
} from './effects';

/**
 * Why these exist, in one sentence: a query that mutates makes the world depend on the
 * PATTERN of reads instead of only on the inputs, and rollback replays a tick with a
 * different pattern.
 *
 * The tests below are paired on purpose - each shows the pure reader agreeing with the
 * mutating one on the answer, and then shows that only the mutating one changes the
 * state. Deleting the pure readers would make the second half of every pair fail, which
 * is the point.
 */
describe('pure effect readers', () => {
  it('agree with the mutating versions on the answer', () => {
    const a = createEffectState();
    applySlow(a, 'q', 0.3, 100);
    applyMovementBuff(a, 'w', 0.25, 100);
    applyPull(a, 'e', { x: 5, y: 5 }, 10, 100);

    const b = createEffectState();
    applySlow(b, 'q', 0.3, 100);
    applyMovementBuff(b, 'w', 0.25, 100);
    applyPull(b, 'e', { x: 5, y: 5 }, 10, 100);

    expect(readSlow(a, 50)).toBe(strongestSlow(b, 50));
    expect(readMovementBuff(a, 50)).toBe(strongestMovementBuff(b, 50));
    expect(readPull(a, 50)?.source).toBe(activePull(b, 50)?.source);
  });

  it('do not delete expired effects, where the mutating versions do', () => {
    // The hazard, stated as a difference. Asking a question must not change the world.
    const pure = createEffectState();
    applySlow(pure, 'q', 0.4, 10);
    expect(readSlow(pure, 999)).toBe(0);
    expect(pure.slows, 'a read must leave the state alone').toHaveLength(1);

    const mutating = createEffectState();
    applySlow(mutating, 'q', 0.4, 10);
    expect(strongestSlow(mutating, 999)).toBe(0);
    expect(mutating.slows, 'the mutating version deletes as it reads').toHaveLength(0);
  });

  it('give the same answer however many times they are called', () => {
    // The property a replay needs. With the mutating version the SECOND call can differ
    // from the first, because the first removed the effect it was asked about.
    const state = createEffectState();
    applySlow(state, 'q', 0.5, 10);
    const answers = [readSlow(state, 5), readSlow(state, 5), readSlow(state, 5)];
    expect(answers).toEqual([0.5, 0.5, 0.5]);
    // And after the boundary, still stable.
    expect([readSlow(state, 20), readSlow(state, 20)]).toEqual([0, 0]);
  });

  it('are unaffected by the ORDER of reads across an expiry boundary', () => {
    // Two read patterns over the same state and clock. With mutating queries, reading
    // late-then-early destroys the effect before the early read sees it, so the two
    // orders disagree - exactly the divergence a rollback replay would introduce.
    const build = () => {
      const s = createEffectState();
      applySlow(s, 'q', 0.6, 10);
      return s;
    };

    const pureEarlyFirst = build();
    const pureA = readSlow(pureEarlyFirst, 5);
    const pureB = readSlow(pureEarlyFirst, 20);
    const pureLateFirst = build();
    const pureC = readSlow(pureLateFirst, 20);
    const pureD = readSlow(pureLateFirst, 5);
    expect([pureA, pureB]).toEqual([0.6, 0]);
    expect([pureD, pureC], 'a pure read gives the same answers in either order').toEqual([0.6, 0]);

    const mutLateFirst = build();
    strongestSlow(mutLateFirst, 20);
    expect(
      strongestSlow(mutLateFirst, 5),
      'the mutating version has already deleted the effect, so the earlier tick reads 0',
    ).toBe(0);
  });

  it('resolve a pull with a total order, so two active pulls cannot swap', () => {
    // With two pulls active the chosen one decides where the unit is dragged, so an
    // unstable order is a desync rather than a cosmetic difference. Equal expiry is
    // broken by source id.
    const state = createEffectState();
    applyPull(state, 'zeta', { x: 1, y: 0 }, 5, 50);
    applyPull(state, 'alpha', { x: 9, y: 0 }, 5, 50);
    expect(readPull(state, 10)?.source).toBe('alpha');
    // Repeated reads never reorder.
    expect(readPull(state, 10)?.source).toBe('alpha');
  });

  it('report nothing once everything has expired, without needing a sweep first', () => {
    const state = createEffectState();
    applySlow(state, 'q', 0.5, 10);
    applyMovementBuff(state, 'w', 0.5, 10);
    applyPull(state, 'e', { x: 0, y: 0 }, 5, 10);
    expect(readSlow(state, 11)).toBe(0);
    expect(readMovementBuff(state, 11)).toBe(0);
    expect(readPull(state, 11)).toBeUndefined();
    // The state still holds them until the tick's single expiry runs.
    expect(state.slows).toHaveLength(1);
    expireEffects(state, 11);
    expect(state.slows).toHaveLength(0);
  });
});
