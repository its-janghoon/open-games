import { describe, it, expect } from 'vitest';

import type { PendingImpact, Unit } from './combat';
import { createChampionLifeState } from './championLifeState';
import { createEffectState } from './effects';
import {
  advanceEffects,
  cloneWorldState,
  drainDueImpacts,
  queueImpact,
  type WorldState,
} from './worldStep';

const unit = (over: Partial<Unit> = {}): Unit => ({
  id: 'a',
  kind: 'champion',
  team: 'ally',
  pos: { x: 0, y: 0 },
  hp: 100,
  maxHp: 100,
  ad: 10,
  armor: 0,
  attackRange: 100,
  attackSpeed: 1,
  moveSpeed: 66,
  attackCdRemaining: 0,
  dead: false,
  ...over,
});

const shot = (over: Partial<PendingImpact> = {}): Omit<PendingImpact, 'insertionOrder'> => ({
  dueAt: 10,
  source: unit({ id: 'caster', pos: { x: 5, y: 6 } }),
  radius: 30,
  rawDamage: 40,
  color: 0xffffff,
  stunDuration: 0,
  ability: true,
  ultimate: false,
  singleTarget: false,
  chronoProc: false,
  ...over,
});

const world = (simTime = 0): WorldState => ({
  tick: 0,
  simTime,
  units: [unit({ id: 'caster' }), unit({ id: 'victim', pos: { x: 100, y: 0 } })],
  cooldowns: { caster: { Q: 0, W: 0, E: 0, R: 0 } },
  effects: { caster: createEffectState(), victim: createEffectState() },
  lives: { caster: createChampionLifeState(), victim: createChampionLifeState() },
  pendingImpacts: [],
  nextInsertionOrder: 0,
});

describe('impact queue in the snapshot', () => {
  it('keeps a hit that is still in the air across a rewind', () => {
    // The reason the queue is in the snapshot at all. A cast several ticks ago decides damage
    // on a tick the rollback is about to replay; if the restored state has an empty queue the
    // hit simply never lands, and the player who already paid the cooldown loses the kill.
    const state = world(0);
    queueImpact(state, shot({ dueAt: 2, targetId: 'victim' }));
    const snapshot = cloneWorldState(state);

    advanceEffects(state, 3);
    expect(drainDueImpacts(state), 'landed in the original run').toHaveLength(1);
    expect(state.pendingImpacts).toHaveLength(0);

    const restored = cloneWorldState(snapshot);
    expect(restored.pendingImpacts, 'still in the air at the restored tick').toHaveLength(1);
    advanceEffects(restored, 3);
    const landed = drainDueImpacts(restored);
    expect(landed).toHaveLength(1);
    expect(landed[0].dueAt, 'and lands at the same deadline, not a recomputed one').toBe(2);
  });

  it('stamps a replayed cast above everything in the restored queue', () => {
    // The half that is easy to omit. Restore the queue but not the counter and a replayed cast
    // is stamped with a number an existing entry already holds - two impacts sharing a
    // deadline then have nothing left to break the tie on.
    const state = world(0);
    queueImpact(state, shot({ dueAt: 5 }));
    queueImpact(state, shot({ dueAt: 5 }));
    const snapshot = cloneWorldState(state);

    const restored = cloneWorldState(snapshot);
    const replayed = queueImpact(restored, shot({ dueAt: 5 }));
    const existing = restored.pendingImpacts
      .filter((i) => i !== replayed)
      .map((i) => i.insertionOrder);
    expect(Math.min(...existing.map((o) => replayed.insertionOrder - o))).toBeGreaterThan(0);
    expect(new Set(restored.pendingImpacts.map((i) => i.insertionOrder)).size).toBe(3);
  });

  it('does not share the geometry a hit is judged against', () => {
    // source.pos and the line box are what the hit is resolved against. Share them and a
    // champion moving after the shot was fired retroactively re-aims a shot already in the
    // air, which is exactly the independence the copy-at-cast design guarantees.
    const state = world(0);
    queueImpact(
      state,
      shot({
        point: { x: 1, y: 1 },
        line: {
          origin: { x: 0, y: 0 },
          endpoint: { x: 50, y: 0 },
          halfWidth: 10,
          subsequentDamageMultiplier: 0.5,
        },
      }),
    );
    const copy = cloneWorldState(state);

    copy.pendingImpacts[0].source.pos.x = -999;
    copy.pendingImpacts[0].point!.x = -999;
    copy.pendingImpacts[0].line!.endpoint.x = -999;
    copy.pendingImpacts[0].rawDamage = 9999;
    expect(state.pendingImpacts[0].source.pos.x).toBe(5);
    expect(state.pendingImpacts[0].point!.x).toBe(1);
    expect(state.pendingImpacts[0].line!.endpoint.x).toBe(50);
    expect(state.pendingImpacts[0].rawDamage).toBe(40);
  });

  it('does not share the queue array, so a replayed cast cannot appear in the snapshot', () => {
    const state = world(0);
    const snapshot = cloneWorldState(state);
    queueImpact(state, shot());
    expect(snapshot.pendingImpacts).toHaveLength(0);
    expect(snapshot.nextInsertionOrder).toBe(0);
  });

  it('leaves a hit queued until its deadline, and drains it exactly once', () => {
    const state = world(0);
    queueImpact(state, shot({ dueAt: 1 }));
    advanceEffects(state, 0.5);
    expect(drainDueImpacts(state)).toHaveLength(0);
    advanceEffects(state, 0.6);
    expect(drainDueImpacts(state)).toHaveLength(1);
    expect(drainDueImpacts(state), 'not delivered twice').toHaveLength(0);
  });

  it('drains same-deadline hits in cast order', () => {
    // Ordering decides which of two lethal hits lands first. Queued deliberately with the
    // later cast holding the earlier array position after a restore.
    const state = world(0);
    const first = queueImpact(state, shot({ dueAt: 1, rawDamage: 1 }));
    const second = queueImpact(state, shot({ dueAt: 1, rawDamage: 2 }));
    state.pendingImpacts = [second, first];

    advanceEffects(state, 2);
    expect(drainDueImpacts(state).map((i) => i.rawDamage)).toEqual([1, 2]);
  });
});
