import { describe, it, expect } from 'vitest';

import {
  advanceEffects,
  advanceLives,
  advanceTimers,
  cloneWorldState,
  moveUnitToward,
  type MoveModifiers,
  type WorldBounds,
  type WorldState,
} from './worldStep';
import type { Unit } from './combat';
import { createChampionLifeState } from './championLifeState';
import { createEffectState } from './effects';

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
    simTime: 12.5,
    units: [unit({ id: 'a', pos: { x: 1, y: 2 } }), unit({ id: 'b', pos: { x: 3, y: 4 } })],
    cooldowns: { a: { Q: 1, W: 2, E: 3, R: 4 }, b: { Q: 0, W: 0, E: 0, R: 0 } },
    effects: {
      a: {
        shields: [{ source: 'q', amount: 50, expiresAt: 20 }],
        slows: [{ source: 'w', percent: 0.3, expiresAt: 20 }],
        armor: [{ source: 'e', amount: 10, expiresAt: 20 }],
        movement: [{ source: 'r', percent: 0.25, expiresAt: 20 }],
        pulls: [{ source: 'p', destination: { x: 9, y: 9 }, speed: 5, expiresAt: 20 }],
        burns: [{ sourceId: 'b', rawDamagePerSecond: 4, expiresAt: 20, accumulator: 0.5 }],
      },
      b: createEffectState(),
    },
    lives: {
      a: { phase: 'alive', diedAt: null, respawnsAt: null, invulnerableUntil: null },
      b: { phase: 'dead', diedAt: 11, respawnsAt: 25, invulnerableUntil: null },
    },
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

  it('gives each effect array its own identity, so pushing to the copy cannot slow the original', () => {
    // The shape this catches: spreading EffectState copies the OBJECT but shares its six
    // arrays. A rollback would then apply a replayed tick's new slow to the very snapshot
    // it was supposed to be able to fall back to.
    const original = state();
    const copy = cloneWorldState(original);

    copy.effects.a.slows.push({ source: 'injected', percent: 0.9, expiresAt: 99 });
    copy.effects.b.pulls.push({
      source: 'injected',
      destination: { x: 0, y: 0 },
      speed: 1,
      expiresAt: 99,
    });
    expect(original.effects.a.slows).toHaveLength(1);
    expect(original.effects.b.pulls).toHaveLength(0);

    // One level deeper: the fields a fight mutates in place.
    copy.effects.a.shields[0].amount = 0;
    copy.effects.a.burns[0].accumulator = 99;
    copy.effects.a.pulls[0].destination.x = -1;
    expect(original.effects.a.shields[0].amount, 'an absorbing shield must not leak back').toBe(50);
    expect(original.effects.a.burns[0].accumulator).toBe(0.5);
    expect(original.effects.a.pulls[0].destination.x).toBe(9);
  });

  it('copies the clock, because every expiry is a comparison against it', () => {
    const original = state();
    const copy = cloneWorldState(original);
    copy.simTime = 999;
    expect(original.simTime).toBe(12.5);
  });

  it('gives each life state its own identity', () => {
    // advanceChampionLife never mutates and returns the same object when nothing changed,
    // so sharing the reference would be safe TODAY. The copy is here so this function's
    // promise does not depend on an immutability convention kept in another file.
    const original = state();
    const copy = cloneWorldState(original);
    copy.lives.b.phase = 'alive';
    copy.lives.b.respawnsAt = null;
    expect(original.lives.b.phase).toBe('dead');
    expect(original.lives.b.respawnsAt).toBe(25);
  });
});

describe('advanceLives', () => {
  const deadAt = (respawnsAt: number, simTime: number): WorldState => ({
    tick: 0,
    simTime,
    units: [unit({ id: 'a', dead: true })],
    cooldowns: { a: { Q: 0, W: 0, E: 0, R: 0 } },
    effects: { a: createEffectState() },
    lives: { a: { phase: 'dead', diedAt: 0, respawnsAt, invulnerableUntil: null } },
  });

  it('leaves a champion dead before its deadline', () => {
    const state = deadAt(30, 10);
    advanceLives(state);
    expect(state.lives.a.phase).toBe('respawning');
    expect(state.units[0].dead, 'still not on the map').toBe(true);
  });

  it('brings a champion back once the clock passes the deadline', () => {
    const state = deadAt(30, 31);
    advanceLives(state);
    expect(state.lives.a.phase).toBe('invulnerable');
    expect(state.units[0].dead, 'present again, so damageable rules apply').toBe(false);
  });

  it('keeps unit.dead consistent with the phase, since it is derived from it', () => {
    // A snapshot describing a live phase beside a dead flag describes a champion that is
    // both, and whichever field the next system reads decides what the peers believe.
    const state = deadAt(30, 31);
    state.units[0].dead = true;
    advanceLives(state);
    expect(state.units[0].dead).toBe(false);
  });

  it('does not move the clock — advanceEffects owns that', () => {
    // Two subsystems each adding dt would make the result depend on how many were called,
    // which is a desync decided by call order rather than by inputs.
    const state = deadAt(30, 10);
    advanceLives(state);
    expect(state.simTime).toBe(10);
  });

  it('rewinds a respawn correctly, which is the whole reason lives are in the snapshot', () => {
    // Advance past the respawn, restore the earlier snapshot, and the champion must be
    // dead again - because at that tick it was. Leave lives out of the snapshot and the
    // rollback resurrects it: a live champion standing where a corpse was.
    const state = deadAt(30, 29.9);
    const snapshot = cloneWorldState(state);

    advanceEffects(state, 0.2);
    advanceLives(state);
    expect(state.units[0].dead).toBe(false);

    const restored = cloneWorldState(snapshot);
    advanceLives(restored);
    expect(restored.lives.a.phase, 'dead again at the restored tick').toBe('respawning');
    expect(restored.units[0].dead).toBe(true);

    // Replaying the same step from the restored state reaches the same place.
    advanceEffects(restored, 0.2);
    advanceLives(restored);
    expect(restored.lives.a.phase).toBe(state.lives.a.phase);
    expect(restored.units[0].dead).toBe(false);
  });

  it('ignores a life entry with no matching unit rather than throwing', () => {
    // A snapshot can outlive a unit - it is taken before a despawn the replay undoes.
    const state = deadAt(30, 31);
    state.lives.ghost = { phase: 'dead', diedAt: 0, respawnsAt: 30, invulnerableUntil: null };
    expect(() => advanceLives(state)).not.toThrow();
    expect(state.lives.ghost.phase).toBe('invulnerable');
  });
});

describe('advanceEffects', () => {
  const withSlow = (expiresAt: number): WorldState => ({
    tick: 0,
    simTime: 10,
    units: [unit({ id: 'a' })],
    cooldowns: { a: { Q: 0, W: 0, E: 0, R: 0 } },
    effects: {
      a: { ...createEffectState(), slows: [{ source: 'q', percent: 0.5, expiresAt }] },
    },
    lives: { a: createChampionLifeState() },
  });

  it('moves the clock and expires what the new clock has passed', () => {
    const state = withSlow(10.4);
    advanceEffects(state, 0.5);
    expect(state.simTime).toBe(10.5);
    expect(
      state.effects.a.slows,
      'expiry uses the clock AFTER it moves, matching the scene',
    ).toHaveLength(0);
  });

  it('leaves an effect that outlives the step', () => {
    const state = withSlow(30);
    advanceEffects(state, 0.5);
    expect(state.effects.a.slows).toHaveLength(1);
  });

  it('sweeps every unit, not only the first', () => {
    const state = withSlow(10.1);
    state.effects.b = {
      ...createEffectState(),
      slows: [{ source: 'q', percent: 0.5, expiresAt: 10.1 }],
    };
    advanceEffects(state, 0.5);
    expect(state.effects.a.slows).toHaveLength(0);
    expect(state.effects.b.slows).toHaveLength(0);
  });

  it('restores expiry correctly after a rollback rewinds the clock', () => {
    // The property the clock is in the snapshot FOR. Advance past an expiry, then restore
    // the earlier snapshot: the effect must be alive again, because at that tick it
    // genuinely was. Leave the clock out and this is unrecoverable - the restored state
    // reads its buffs against a future now and the effect stays dead.
    const state = withSlow(10.4);
    const snapshot = cloneWorldState(state);
    advanceEffects(state, 0.5);
    expect(state.effects.a.slows).toHaveLength(0);

    const restored = cloneWorldState(snapshot);
    expect(restored.simTime).toBe(10);
    expect(restored.effects.a.slows, 'the effect was alive at the restored tick').toHaveLength(1);

    // And replaying the same step from the restored state reaches the same place, which is
    // what makes a resimulation agree with the original run.
    advanceEffects(restored, 0.5);
    expect(restored.simTime).toBe(10.5);
    expect(restored.effects.a.slows).toHaveLength(0);
  });
});
