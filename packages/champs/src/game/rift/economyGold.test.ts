import { describe, expect, it } from 'vitest';

import {
  advanceGold,
  initialGold,
  PASSIVE_GOLD_PER_SECOND,
  passiveGold,
  type GoldState,
} from './economy';

const TICK = 1 / 60;

describe('passive gold accrual', () => {
  it('grants no whole gold on a tick that does not cross a boundary', () => {
    // A tick earns 0.034 gold, so the first tick must bank nothing and carry everything.
    const after = advanceGold(initialGold(500), TICK);
    expect(after.gold).toBe(500);
    expect(after.totalEarned).toBe(0);
    expect(after.accrual).toBeCloseTo(PASSIVE_GOLD_PER_SECOND * TICK, 12);
  });

  it('banks only whole gold and carries the remainder', () => {
    let state = initialGold(0);
    for (let i = 0; i < 60; i += 1) state = advanceGold(state, TICK);
    // One second of trickle is 2.04, so exactly 2 is banked and 0.04 is still owed.
    expect(state.gold).toBe(2);
    expect(state.totalEarned).toBe(2);
    expect(state.accrual).toBeCloseTo(0.04, 6);
  });

  it('keeps the carry below one, so it can never bank the same gold twice', () => {
    let state = initialGold(0);
    for (let i = 0; i < 600; i += 1) {
      state = advanceGold(state, TICK);
      expect(state.accrual).toBeGreaterThanOrEqual(0);
      expect(state.accrual).toBeLessThan(1);
    }
  });

  it('loses nothing over a long run: banked plus carried equals the whole trickle', () => {
    /**
     * The invariant that makes the carry worth having. Ten seconds of trickle is 20.4 gold; whatever the split
     * between banked and carried, the two together must account for all of it. A carry that were dropped, double
     * counted, or reset would break this without necessarily changing the banked figure on any single tick.
     */
    const seconds = 10;
    const ticks = Math.round(seconds / TICK);
    let state = initialGold(0);
    for (let i = 0; i < ticks; i += 1) state = advanceGold(state, TICK);
    expect(state.gold + state.accrual).toBeCloseTo(passiveGold(ticks * TICK), 6);
  });

  it('does not mutate the state it was given', () => {
    const before = initialGold(120);
    const snapshot: GoldState = { ...before };
    advanceGold(before, TICK);
    expect(before).toEqual(snapshot);
  });

  it('ignores a non-positive step rather than running the economy backwards', () => {
    // passiveGold already floors at zero; this pins that advanceGold inherits it, so a replayed tick with a
    // zero delta cannot rewind someone's gold.
    const state = { gold: 300, accrual: 0.5, totalEarned: 7 };
    expect(advanceGold(state, 0)).toEqual(state);
    expect(advanceGold(state, -1)).toEqual(state);
  });

  it('banks several gold at once when handed a step large enough', () => {
    // A catch-up step must not silently bank only one. MAX_STEPS_PER_RENDER caps this in the scene, but the
    // arithmetic should be right regardless of who calls it.
    const after = advanceGold(initialGold(0), 10);
    expect(after.gold).toBe(20);
    expect(after.totalEarned).toBe(20);
    expect(after.accrual).toBeCloseTo(0.4, 6);
  });
});
