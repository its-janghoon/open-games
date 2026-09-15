import { describe, expect, it } from 'vitest';

import {
  admitDueMinions,
  advanceMinions,
  cloneMinions,
  minionFromSpawn,
  minionIdFor,
  reapMinions,
  type MinionState,
} from './minionBodies';
import type { PendingWaveSpawn, WaveSchedule } from './waveSchedule';

function spawn(order: number, over: Partial<PendingWaveSpawn> = {}): PendingWaveSpawn {
  return {
    dueAt: 10,
    insertionOrder: order,
    type: 'melee',
    team: 'ally',
    lane: 'mid',
    ...over,
  };
}

function schedule(pending: PendingWaveSpawn[]): WaveSchedule {
  return { spawnedWaves: 1, nextOrder: 100, pending };
}

describe('minion identity', () => {
  it('derives an id from the schedule counter, so a replay reproduces it exactly', () => {
    /**
     * The property that makes a DYNAMIC set rewindable. A minion created during a replayed tick must be the same minion
     * as the one created the first time, or the two peers disagree about which body took which hit. An id from a
     * counter that resets, from array position, or from anything the renderer touches cannot promise that.
     */
    expect(minionIdFor(spawn(7))).toBe(minionIdFor(spawn(7)));
    expect(minionIdFor(spawn(7))).not.toBe(minionIdFor(spawn(8)));
  });

  it('distinguishes the same order in different lanes and teams', () => {
    // insertionOrder is unique across a wave, but including team and lane makes an id readable in a log and survives
    // any future change that made the counter per-lane.
    const ids = new Set([
      minionIdFor(spawn(1)),
      minionIdFor(spawn(1, { lane: 'top' })),
      minionIdFor(spawn(1, { team: 'enemy' })),
    ]);
    expect(ids.size).toBe(3);
  });

  it('gives a fresh minion full health from its own stat table', () => {
    const minion = minionFromSpawn(spawn(1));
    expect(minion.hp).toBe(minion.maxHp);
    expect(minion.hp).toBeGreaterThan(0);
    expect(minion.dead).toBe(false);
    expect(minion.atEnd).toBe(false);
  });
});

describe('admitting minions', () => {
  it('admits an entry whose time has come and removes it from the queue', () => {
    const result = admitDueMinions([], schedule([spawn(1)]), 10, 12, 1);
    expect(result.minions).toHaveLength(1);
    expect(result.waves.pending).toHaveLength(0);
  });

  it('leaves an entry alone until its deadline', () => {
    const result = admitDueMinions([], schedule([spawn(1, { dueAt: 99 })]), 10, 12, 1);
    expect(result.minions).toHaveLength(0);
    expect(result.waves.pending).toHaveLength(1);
  });

  it('DEFERS rather than drops when the lane is full', () => {
    /**
     * A scheduled wave member is authoritative. Dropping one that cannot be admitted would make the two peers'
     * populations depend on the order they happened to process the queue; deferring keeps it queued with a later
     * deadline, which both peers compute identically from the same state.
     */
    const full: MinionState[] = Array.from({ length: 3 }, (_, i) => minionFromSpawn(spawn(i)));
    const result = admitDueMinions(full, schedule([spawn(50)]), 10, 3, 1.5);
    expect(result.minions).toHaveLength(3);
    expect(result.waves.pending).toHaveLength(1);
    expect(result.waves.pending[0].dueAt).toBe(11.5);
    expect(result.waves.pending[0].insertionOrder, 'identity survives a deferral').toBe(50);
  });

  it('counts only LIVING minions against the cap', () => {
    // A corpse occupying a slot would starve the lane of reinforcements.
    const dead = [{ ...minionFromSpawn(spawn(0)), dead: true }];
    const result = admitDueMinions(dead, schedule([spawn(50)]), 10, 1, 1);
    expect(result.minions.filter((m) => !m.dead)).toHaveLength(1);
    expect(result.waves.pending).toHaveLength(0);
  });

  it('admits due entries in deadline then insertion order', () => {
    // The same tiebreak the impact queue uses: two entries sharing a deadline must not be ordered by array position.
    const pending = [spawn(9, { dueAt: 5 }), spawn(3, { dueAt: 5 }), spawn(1, { dueAt: 1 })];
    const result = admitDueMinions([], schedule(pending), 10, 12, 1);
    expect(result.minions.map((m) => m.id)).toEqual([
      minionIdFor(spawn(1)),
      minionIdFor(spawn(3)),
      minionIdFor(spawn(9)),
    ]);
  });

  it('does not mutate what it was given', () => {
    const before = schedule([spawn(1)]);
    const snapshot = JSON.stringify(before);
    admitDueMinions([], before, 10, 12, 1);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('advancing minions', () => {
  it('moves a living minion along its lane', () => {
    const [minion] = admitDueMinions([], schedule([spawn(1)]), 10, 12, 1).minions;
    const after = advanceMinions([minion], 1)[0];
    expect(after.distanceTravelled).toBeGreaterThan(minion.distanceTravelled);
  });

  it('leaves a dead minion exactly where it fell', () => {
    const [minion] = admitDueMinions([], schedule([spawn(1)]), 10, 12, 1).minions;
    const dead = { ...minion, dead: true };
    const after = advanceMinions([dead], 1)[0];
    expect(after.pos).toEqual(dead.pos);
    expect(after.distanceTravelled).toBe(dead.distanceTravelled);
  });

  it('is deterministic and does not mutate its input', () => {
    const [minion] = admitDueMinions([], schedule([spawn(1)]), 10, 12, 1).minions;
    const snapshot = JSON.stringify(minion);
    const a = advanceMinions([minion], 0.5);
    const b = advanceMinions([minion], 0.5);
    expect(JSON.stringify(minion)).toBe(snapshot);
    expect(a).toEqual(b);
  });

  it('eventually reports reaching the end of the lane', () => {
    // Without atEnd nothing downstream can tell a minion that arrived from one still walking.
    let minions = admitDueMinions([], schedule([spawn(1)]), 10, 12, 1).minions;
    for (let i = 0; i < 400 && !minions[0].atEnd; i += 1) minions = advanceMinions(minions, 0.5);
    expect(minions[0].atEnd).toBe(true);
  });
});

describe('cloning and reaping', () => {
  it('clones independently, including the position object', () => {
    // pos is an object, so a shallow copy would share it and a snapshot would drift with the live state.
    const original = admitDueMinions([], schedule([spawn(1)]), 10, 12, 1).minions;
    const copy = cloneMinions(original);
    copy[0].pos.x = -999;
    copy[0].hp = 1;
    expect(original[0].pos.x).not.toBe(-999);
    expect(original[0].hp).toBe(original[0].maxHp);
  });

  it('reaps the dead and keeps the living', () => {
    const live = minionFromSpawn(spawn(1));
    const dead = { ...minionFromSpawn(spawn(2)), dead: true };
    expect(reapMinions([live, dead]).map((m) => m.id)).toEqual([live.id]);
  });
});
