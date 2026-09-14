import { describe, it, expect } from 'vitest';

import {
  advanceTimers,
  cloneWorldState,
  moveUnitToward,
  type MoveModifiers,
  type WorldBounds,
  type WorldState,
} from './worldStep';
import type { Unit } from './combat';

/**
 * These pin the arithmetic BattleScene now delegates to. The value of extracting it was
 * never that the code got shorter - it was that this arithmetic became testable at all,
 * and that a headless rollback step and the scene cannot drift apart because there is
 * only one copy.
 */
const unit = (over: Partial<Unit> = {}): Unit =>
  ({
    id: 'u',
    kind: 'champion',
    team: 'ally',
    pos: { x: 0, y: 0 },
    hp: 100,
    maxHp: 100,
    ad: 10,
    armor: 0,
    attackRange: 100,
    attackSpeed: 1,
    moveSpeed: 100,
    attackCdRemaining: 0,
    dead: false,
    ...over,
  }) as Unit;

const bounds: WorldBounds = { minX: 0, maxX: 500, minY: 0, maxY: 500 };

describe('moveUnitToward', () => {
  it('moves at move speed for the elapsed time', () => {
    const u = unit();
    const travel = moveUnitToward(u, { x: 1000, y: 0 }, 0.5);
    expect(travel).toBe(50);
    expect(u.pos.x).toBe(50);
    expect(u.pos.y).toBe(0);
  });

  it('never overshoots the goal', () => {
    const u = unit({ pos: { x: 0, y: 0 }, moveSpeed: 1000 });
    const travel = moveUnitToward(u, { x: 30, y: 40 }, 1);
    expect(travel).toBe(50); // the exact distance
    expect(u.pos).toEqual({ x: 30, y: 40 });
  });

  it('treats a goal under one unit away as reached', () => {
    // The scene's own threshold, preserved so extraction changed nothing.
    const u = unit();
    expect(moveUnitToward(u, { x: 0.4, y: 0 }, 1)).toBe(0);
    expect(u.pos).toEqual({ x: 0, y: 0 });
  });

  it('does not move a pinned unit, whatever its speed', () => {
    // A pull effect pins a champion in place. The scene returned early for this; the
    // modifier carries it now.
    const u = unit({ moveSpeed: 9999 });
    expect(moveUnitToward(u, { x: 1000, y: 0 }, 1, { pinned: true })).toBe(0);
    expect(u.pos.x).toBe(0);
  });

  it('applies a speed multiplier, a flat bonus and a slow in the scene’s order', () => {
    // Order matters and is not commutative: the multiplier and buff scale base speed,
    // the flat bonus is added BEFORE the slow, and the slow scales the whole thing.
    // Getting this order wrong is a silent balance change, which is exactly why the
    // arithmetic is in one place now.
    const mods: MoveModifiers = { speedMultiplier: 1.2, flatBonus: 25, buffFraction: 0.5, slowFactor: 0.25 };
    const u = unit();
    const travel = moveUnitToward(u, { x: 10000, y: 0 }, 1, mods);
    // (100 * 1.2 * 1.5 + 25) * 0.75 = (180 + 25) * 0.75 = 153.75
    expect(travel).toBeCloseTo(153.75, 6);
  });

  it('a full slow stops the unit rather than reversing it', () => {
    const u = unit();
    expect(moveUnitToward(u, { x: 500, y: 0 }, 1, { slowFactor: 1 })).toBe(0);
    expect(u.pos.x).toBe(0);
  });

  it('clamps the result into the world when bounds are given', () => {
    const u = unit({ pos: { x: 480, y: 480 }, moveSpeed: 1000 });
    moveUnitToward(u, { x: 5000, y: 5000 }, 1, {}, bounds);
    expect(u.pos.x).toBe(bounds.maxX);
    expect(u.pos.y).toBe(bounds.maxY);
  });

  it('moves freely when no bounds are given, for a headless step with its own world', () => {
    const u = unit({ moveSpeed: 1000 });
    moveUnitToward(u, { x: 5000, y: 0 }, 1);
    expect(u.pos.x).toBe(1000);
  });

  it('is deterministic: the same unit and inputs give the same result every time', () => {
    // The property rollback depends on. Cheap to assert, and it would catch a clock or
    // a random creeping into this function later.
    const run = () => {
      const u = unit({ pos: { x: 3, y: 7 } });
      const path = [] as number[];
      for (let i = 0; i < 20; i += 1) {
        path.push(moveUnitToward(u, { x: 400, y: 300 }, 1 / 60, { slowFactor: 0.1 }, bounds));
      }
      return { path, pos: u.pos };
    };
    expect(run()).toEqual(run());
  });

  it('returns the travelled distance, which the scene needs and must not recompute', () => {
    // The scene uses this to decide whether a champion moved this frame, which drives a
    // passive and a tutorial trigger. Recomputing it outside would be a second place
    // for the same arithmetic to drift.
    const u = unit();
    expect(moveUnitToward(u, { x: 1000, y: 0 }, 0.25)).toBe(25);
    expect(moveUnitToward(u, { x: 1000, y: 0 }, 0)).toBe(0);
  });
});

describe('advanceTimers', () => {
  it('advances attack and ability cooldowns toward zero and never past it', () => {
    const u = unit({ attackCdRemaining: 0.3 });
    const cds = { Q: 1, W: 0.2, E: 0, R: 5 };
    advanceTimers([u], [cds], 0.5);
    expect(u.attackCdRemaining).toBe(0);
    expect(cds).toEqual({ Q: 0.5, W: 0, E: 0, R: 4.5 });
  });

  it('is a no-op at dt 0, so a paused frame cannot leak progress', () => {
    const u = unit({ attackCdRemaining: 0.4 });
    const cds = { Q: 1, W: 1, E: 1, R: 1 };
    advanceTimers([u], [cds], 0);
    expect(u.attackCdRemaining).toBe(0.4);
    expect(cds).toEqual({ Q: 1, W: 1, E: 1, R: 1 });
  });
});

describe('cloneWorldState', () => {
  const state = (): WorldState => ({
    tick: 7,
    units: [unit({ id: 'a', pos: { x: 1, y: 2 } }), unit({ id: 'b', pos: { x: 3, y: 4 } })],
    cooldowns: { a: { Q: 1, W: 2, E: 3, R: 4 }, b: { Q: 0, W: 0, E: 0, R: 0 } },
  });

  it('copies every value', () => {
    const original = state();
    expect(cloneWorldState(original)).toEqual(original);
  });

  it('mutating the copy cannot touch the original — the contract rollback depends on', () => {
    // This is the test whose absence let a shallow clone pass an entire rollback suite
    // last cycle: the reference simulation never mutated its state, so sharing a
    // reference with a snapshot was harmless. A real simulation mutates, so a snapshot
    // that shares structure restores a state that has already drifted.
    const original = state();
    const copy = cloneWorldState(original);

    copy.tick = 999;
    copy.units[0].pos.x = -100;
    copy.units[0].hp = 1;
    copy.units.push(unit({ id: 'c' }));
    copy.cooldowns.a.Q = 42;
    copy.cooldowns.z = { Q: 9, W: 9, E: 9, R: 9 };

    expect(original.tick).toBe(7);
    expect(original.units).toHaveLength(2);
    expect(original.units[0].pos.x).toBe(1);
    expect(original.units[0].hp).toBe(100);
    expect(original.cooldowns.a.Q).toBe(1);
    expect(original.cooldowns.z).toBeUndefined();
  });

  it('survives a step applied to the copy, which is how a rollback actually uses it', () => {
    const original = state();
    const copy = cloneWorldState(original);
    moveUnitToward(copy.units[0], { x: 500, y: 500 }, 1);
    advanceTimers(copy.units, Object.values(copy.cooldowns), 0.5);
    expect(original.units[0].pos).toEqual({ x: 1, y: 2 });
    expect(original.cooldowns.a).toEqual({ Q: 1, W: 2, E: 3, R: 4 });
  });

  it('round-trips through repeated cloning without drifting', () => {
    // A rollback clones from a clone, repeatedly, for the length of a match.
    let current = state();
    for (let i = 0; i < 50; i += 1) current = cloneWorldState(current);
    expect(current).toEqual(state());
  });
});
