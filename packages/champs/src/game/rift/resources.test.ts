import { describe, expect, it } from 'vitest';

import {
  advanceResources,
  canAfford,
  cloneResources,
  initialResource,
  regenerateResource,
  RESOURCE_REGEN_PER_SECOND,
  spendResource,
  type ResourceState,
} from './resources';

const TICK = 1 / 60;

describe('resource regeneration', () => {
  it('regenerates at the stated rate', () => {
    const after = regenerateResource({ current: 0, max: 300 }, 1);
    expect(after.current).toBeCloseTo(RESOURCE_REGEN_PER_SECOND, 6);
  });

  it('clamps at max rather than overshooting and being corrected later', () => {
    /**
     * An overshoot that some later step clamps would make the value depend on whether that step ran — exactly the order
     * dependence a replay exposes, and the reason clamping belongs here rather than downstream.
     */
    const after = regenerateResource({ current: 299, max: 300 }, 10);
    expect(after.current).toBe(300);
  });

  it('ignores a non-positive step, so a replayed zero-delta tick cannot rewind mana', () => {
    const state = { current: 100, max: 300 };
    expect(regenerateResource(state, 0)).toEqual(state);
    expect(regenerateResource(state, -1)).toEqual(state);
  });

  it('applies a per-participant bonus without knowing what a buff is', () => {
    const plain = regenerateResource({ current: 0, max: 300 }, 1);
    const buffed = regenerateResource({ current: 0, max: 300 }, 1, 10);
    expect(buffed.current).toBeCloseTo(plain.current + 10, 6);
  });

  it('advances every participant and can vary the bonus by id', () => {
    const before = { a: initialResource(300), b: initialResource(300) };
    const spent = { a: { current: 0, max: 300 }, b: { current: 0, max: 300 } };
    const after = advanceResources(spent, 1, (id) => (id === 'a' ? 60 : 0));
    expect(after.a.current).toBeGreaterThan(after.b.current);
    expect(before.a.current).toBe(300);
  });

  it('does not mutate what it was given', () => {
    const state = { a: { current: 10, max: 300 } };
    const before = JSON.stringify(state);
    advanceResources(state, 1);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('is deterministic over a long run', () => {
    let a: Record<string, ResourceState> = { p: { current: 0, max: 300 } };
    let b: Record<string, ResourceState> = { p: { current: 0, max: 300 } };
    for (let i = 0; i < 600; i += 1) {
      a = advanceResources(a, TICK);
      b = advanceResources(b, TICK);
    }
    expect(a).toEqual(b);
  });
});

describe('spending', () => {
  it('pays when affordable and refuses when not, in ONE call', () => {
    /**
     * The check and the spend are returned together on purpose. Splitting them into "can I?" then "do it" is where an
     * ability gets cast for free: two callers can both pass the check before either spends.
     */
    const rich = spendResource({ current: 100, max: 300 }, 60);
    expect(rich.paid).toBe(true);
    expect(rich.resource.current).toBe(40);

    const poor = spendResource({ current: 10, max: 300 }, 60);
    expect(poor.paid).toBe(false);
    expect(poor.resource.current, 'a refused cast must not deduct anything').toBe(10);
  });

  it('treats a free ability as always payable without touching the pool', () => {
    const result = spendResource({ current: 0, max: 300 }, 0);
    expect(result.paid).toBe(true);
    expect(result.resource.current).toBe(0);
  });

  it('pays an exactly-affordable cost', () => {
    // The boundary: `<` versus `<=` here is the difference between an ability being castable at exactly its cost or not.
    const result = spendResource({ current: 60, max: 300 }, 60);
    expect(result.paid).toBe(true);
    expect(result.resource.current).toBe(0);
  });

  it('canAfford agrees with spendResource', () => {
    for (const [current, cost] of [
      [100, 60],
      [60, 60],
      [59, 60],
      [0, 0],
    ] as const) {
      const resource = { current, max: 300 };
      expect(canAfford(resource, cost)).toBe(spendResource(resource, cost).paid);
    }
  });

  it('treats a missing participant as unable to afford anything', () => {
    expect(canAfford(undefined, 1)).toBe(false);
    expect(canAfford(undefined, 0)).toBe(true);
  });
});

describe('cloneResources', () => {
  it('copies each entry', () => {
    const original = { a: initialResource(300) };
    const copy = cloneResources(original);
    copy.a.current = 1;
    expect(original.a.current).toBe(300);
  });
});
