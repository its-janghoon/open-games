import { describe, expect, it } from 'vitest';

import type { Unit } from '../combat';
import { minionFromSpawn, type MinionState } from './minionBodies';
import {
  MINION_ATTACK_INTERVAL,
  minionCanAttack,
  pruneTargets,
  resolveMinionCombat,
  type TargetTable,
} from './minionCombat';
import type { PendingWaveSpawn } from './waveSchedule';
import { minionStats } from './minions';

function spawn(order: number, over: Partial<PendingWaveSpawn> = {}): PendingWaveSpawn {
  return { dueAt: 0, insertionOrder: order, type: 'melee', team: 'ally', lane: 'mid', ...over };
}

/** A minion parked at a known point so range is exact rather than wherever the lane path starts. */
function minionAt(order: number, x: number, y: number): MinionState {
  return { ...minionFromSpawn(spawn(order)), pos: { x, y } };
}

function enemy(id: string, x: number, y: number, over: Partial<Unit> = {}): Unit {
  return {
    id,
    kind: 'champion',
    team: 'enemy',
    pos: { x, y },
    hp: 600,
    maxHp: 600,
    ad: 60,
    armor: 0,
    attackRange: 150,
    attackSpeed: 0.8,
    moveSpeed: 340,
    attackCdRemaining: 0,
    dead: false,
    ...over,
  };
}

const RANGE = minionStats('melee').attackRange;

describe('minion combat', () => {
  it('attacks a hostile in range and starts its cooldown', () => {
    const minion = minionAt(1, 0, 0);
    const result = resolveMinionCombat([minion], [enemy('e1', RANGE / 2, 0)], {}, 1 / 60);
    expect(result.damage).toHaveLength(1);
    expect(result.damage[0].targetId).toBe('e1');
    expect(result.damage[0].sourceId).toBe(minion.id);
    expect(result.minions[0].attackCdRemaining).toBe(MINION_ATTACK_INTERVAL);
  });

  it('does not attack an enemy out of range', () => {
    const result = resolveMinionCombat([minionAt(1, 0, 0)], [enemy('e1', RANGE * 3, 0)], {}, 1 / 60);
    expect(result.damage).toHaveLength(0);
    expect(result.targets[minionFromSpawn(spawn(1)).id]).toBeNull();
  });

  it('never attacks its own team', () => {
    const friendly = enemy('f1', RANGE / 2, 0, { team: 'ally' });
    const result = resolveMinionCombat([minionAt(1, 0, 0)], [friendly], {}, 1 / 60);
    expect(result.damage).toHaveLength(0);
  });

  it('holds its lock while the target stays reachable', () => {
    /**
     * Target persistence is BEHAVIOUR, not a cache, which is why it belongs in the snapshot. A minion that re-picked
     * the nearest enemy every tick would flick between two equidistant enemies and land its damage on neither.
     */
    const minion = minionAt(1, 0, 0);
    const far = enemy('far', RANGE * 0.9, 0);
    const near = enemy('near', RANGE * 0.1, 0);
    const locked: TargetTable = { [minion.id]: 'far' };
    const result = resolveMinionCombat([minion], [far, near], locked, 1 / 60);
    expect(result.targets[minion.id], 'the existing lock must survive a nearer arrival').toBe('far');
    expect(result.damage[0].targetId).toBe('far');
  });

  it('re-acquires when the lock leaves range', () => {
    const minion = minionAt(1, 0, 0);
    const gone = enemy('gone', RANGE * 5, 0);
    const near = enemy('near', RANGE * 0.2, 0);
    const result = resolveMinionCombat([minion], [gone, near], { [minion.id]: 'gone' }, 1 / 60);
    expect(result.targets[minion.id]).toBe('near');
  });

  it('re-acquires when the lock dies', () => {
    const minion = minionAt(1, 0, 0);
    const corpse = enemy('corpse', RANGE * 0.2, 0, { dead: true });
    const alive = enemy('alive', RANGE * 0.5, 0);
    const result = resolveMinionCombat([minion], [corpse, alive], { [minion.id]: 'corpse' }, 1 / 60);
    expect(result.targets[minion.id]).toBe('alive');
  });

  it('breaks a distance tie by id, not by array order', () => {
    // Two enemies at the same distance must be resolved identically by both peers. Array order is not something two
    // peers can agree on, and this is the same reasoning that moved the impact queue's tiebreak off array position.
    const minion = minionAt(1, 0, 0);
    const b = enemy('bbb', RANGE / 2, 0);
    const a = enemy('aaa', RANGE / 2, 0);
    const forward = resolveMinionCombat([minion], [b, a], {}, 1 / 60);
    const reversed = resolveMinionCombat([minion], [a, b], {}, 1 / 60);
    expect(forward.targets[minion.id]).toBe('aaa');
    expect(reversed.targets[minion.id]).toBe(forward.targets[minion.id]);
  });

  it('waits out its cooldown instead of swinging every tick', () => {
    const minion = { ...minionAt(1, 0, 0), attackCdRemaining: MINION_ATTACK_INTERVAL };
    const foe = [enemy('e1', RANGE / 2, 0)];
    const result = resolveMinionCombat([minion], foe, {}, 1 / 60);
    expect(result.damage).toHaveLength(0);
    expect(result.minions[0].attackCdRemaining).toBeLessThan(MINION_ATTACK_INTERVAL);
  });

  it('swings again once the cooldown elapses, at the specified rate', () => {
    let minions = [minionAt(1, 0, 0)];
    const foe = [enemy('e1', RANGE / 2, 0)];
    let swings = 0;
    // Two full intervals of ticks should give two or three swings, never one and never a swing every tick.
    const ticks = Math.round((MINION_ATTACK_INTERVAL * 2) / (1 / 60));
    for (let i = 0; i < ticks; i += 1) {
      const result = resolveMinionCombat(minions, foe, {}, 1 / 60);
      minions = result.minions;
      swings += result.damage.length;
    }
    expect(swings).toBeGreaterThan(1);
    expect(swings).toBeLessThan(5);
  });

  it('clears a dead minion’s lock, so a corpse cannot hold a target', () => {
    const minion = { ...minionAt(1, 0, 0), dead: true };
    const result = resolveMinionCombat([minion], [enemy('e1', RANGE / 2, 0)], { [minion.id]: 'e1' }, 1 / 60);
    expect(result.targets[minion.id]).toBeNull();
    expect(result.damage).toHaveLength(0);
  });

  it('scales damage by the target’s armour', () => {
    const soft = resolveMinionCombat([minionAt(1, 0, 0)], [enemy('s', RANGE / 2, 0, { armor: 0 })], {}, 1 / 60);
    const hard = resolveMinionCombat([minionAt(1, 0, 0)], [enemy('h', RANGE / 2, 0, { armor: 200 })], {}, 1 / 60);
    expect(hard.damage[0].amount).toBeLessThan(soft.damage[0].amount);
  });

  it('does not mutate what it was given', () => {
    const minion = minionAt(1, 0, 0);
    const targets: TargetTable = { [minion.id]: null };
    const before = JSON.stringify({ minion, targets });
    resolveMinionCombat([minion], [enemy('e1', RANGE / 2, 0)], targets, 1 / 60);
    expect(JSON.stringify({ minion, targets })).toBe(before);
  });

  it('is deterministic', () => {
    const minion = minionAt(1, 0, 0);
    const foe = [enemy('e1', RANGE / 2, 0)];
    expect(resolveMinionCombat([minion], foe, {}, 1 / 60)).toEqual(
      resolveMinionCombat([minion], foe, {}, 1 / 60),
    );
  });
});

describe('minionCanAttack', () => {
  it('refuses a corpse and a minion still on cooldown', () => {
    expect(minionCanAttack(minionAt(1, 0, 0))).toBe(true);
    expect(minionCanAttack({ ...minionAt(1, 0, 0), dead: true })).toBe(false);
    expect(minionCanAttack({ ...minionAt(1, 0, 0), attackCdRemaining: 0.5 })).toBe(false);
  });
});

describe('pruneTargets', () => {
  it('drops attackers that are gone and clears locks on units that are gone', () => {
    // Without this the table grows for the whole match and keeps ids nothing can resolve.
    const table: TargetTable = { a: 'x', b: 'gone', gone: 'a' };
    expect(pruneTargets(table, new Set(['a', 'b', 'x']))).toEqual({ a: 'x', b: null });
  });
});
