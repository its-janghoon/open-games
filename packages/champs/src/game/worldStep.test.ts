import { describe, it, expect } from 'vitest';

import { moveUnitToward, type MoveModifiers, type WorldBounds } from './worldStep';
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
