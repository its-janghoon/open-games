import { describe, expect, it } from 'vitest';

import {
  advanceBaron,
  advanceBuffs,
  advanceWardenCharges,
  cloneBaron,
  cloneBuffs,
  cloneObjectives,
  cloneWardenCharges,
  dueObjectives,
  markObjectiveAlive,
  retireObjective,
  type ObjectiveState,
} from './fieldState';
import { noBaronBuff, type BaronBuffState } from './objectives';
import type { BuffState } from './jungle';

const always = () => true;

function objectives(): ObjectiveState[] {
  return [
    { id: 'dragon', alive: false, nextSpawnAt: 300, permanentlyGone: false },
    { id: 'herald', alive: false, nextSpawnAt: 480, permanentlyGone: false },
  ];
}

describe('advanceBuffs', () => {
  it('drops lapsed buffs and keeps live ones', () => {
    const buffs: Record<string, BuffState> = {
      a: { buffs: [{ kind: 'blue', expiresAt: 10 }] },
      b: { buffs: [{ kind: 'red', expiresAt: 200 }] },
    };
    const after = advanceBuffs(buffs, 50);
    expect(after.a.buffs).toHaveLength(0);
    expect(after.b.buffs).toHaveLength(1);
  });

  it('does not mutate the state it was given', () => {
    /**
     * This is the property the commit is really about. expireBuffs used to assign into `state.buffs` and every caller
     * relied on that, so a function that reads like a query rewrote the world — and with buffs now in the snapshot, a
     * shared reference would reach backwards into a restored state.
     */
    const buffs: Record<string, BuffState> = { a: { buffs: [{ kind: 'blue', expiresAt: 10 }] } };
    const before = JSON.stringify(buffs);
    advanceBuffs(buffs, 50);
    advanceBuffs(buffs, 50);
    expect(JSON.stringify(buffs)).toBe(before);
  });

  it('is idempotent for a given time', () => {
    const buffs: Record<string, BuffState> = { a: { buffs: [{ kind: 'blue', expiresAt: 10 }] } };
    expect(advanceBuffs(buffs, 50)).toEqual(advanceBuffs(advanceBuffs(buffs, 50), 50));
  });
});

describe('advanceBaron', () => {
  it('clears a lapsed tyrant buff and keeps a live one', () => {
    const active: BaronBuffState = { active: true, modifiers: noBaronBuff().modifiers, expiresAt: 100 };
    expect(advanceBaron({ ally: active, enemy: active }, 150).ally.active).toBe(false);
    expect(advanceBaron({ ally: active, enemy: active }, 50).ally.active).toBe(true);
  });

  it('treats the expiry instant as expired', () => {
    const active: BaronBuffState = { active: true, modifiers: noBaronBuff().modifiers, expiresAt: 100 };
    expect(advanceBaron({ ally: active, enemy: active }, 100).ally.active).toBe(false);
  });

  it('advances the two sides independently', () => {
    const live: BaronBuffState = { active: true, modifiers: noBaronBuff().modifiers, expiresAt: 500 };
    const lapsed: BaronBuffState = { active: true, modifiers: noBaronBuff().modifiers, expiresAt: 10 };
    const after = advanceBaron({ ally: live, enemy: lapsed }, 50);
    expect(after.ally.active).toBe(true);
    expect(after.enemy.active).toBe(false);
  });
});

describe('advanceWardenCharges', () => {
  it('drops a lapsed charge and keeps a live one', () => {
    const after = advanceWardenCharges(
      { ally: { acquiredAt: 0, expiresAt: 10 }, enemy: { acquiredAt: 0, expiresAt: 100 } },
      50,
    );
    expect(after.ally).toBeNull();
    expect(after.enemy).not.toBeNull();
  });

  it('treats the expiry instant as lapsed', () => {
    expect(advanceWardenCharges({ ally: { acquiredAt: 0, expiresAt: 50 }, enemy: null }, 50).ally).toBeNull();
  });

  it('leaves an absent charge absent', () => {
    expect(advanceWardenCharges({ ally: null, enemy: null }, 50)).toEqual({ ally: null, enemy: null });
  });

  it('returns a copy, so the caller cannot write through into the old state', () => {
    const charges = { ally: { acquiredAt: 0, expiresAt: 100 }, enemy: null };
    const after = advanceWardenCharges(charges, 50);
    after.ally!.expiresAt = -1;
    expect(charges.ally.expiresAt).toBe(100);
  });
});

describe('dueObjectives', () => {
  it('reports a slot whose deadline has passed', () => {
    expect(dueObjectives(objectives(), 400, always)).toEqual(['dragon']);
  });

  it('does not report one already on the map', () => {
    const live = markObjectiveAlive(objectives(), 'dragon', true);
    expect(dueObjectives(live, 400, always)).toEqual([]);
  });

  it('never reports one retired for the match', () => {
    const gone = retireObjective(objectives(), 'dragon');
    expect(dueObjectives(gone, 9999, always)).toEqual(['herald']);
  });

  it('respects a closed window even when the deadline has passed', () => {
    // Only herald has a window, and its rule lives in objectives.ts — supplied rather than restated here so there is not
    // a second copy of a rule that decides whether a monster exists.
    const openExceptHerald = (id: string) => id !== 'herald';
    expect(dueObjectives(objectives(), 9999, openExceptHerald)).toEqual(['dragon']);
  });

  it('returns ids in a stable order', () => {
    expect(dueObjectives(objectives(), 9999, always)).toEqual(['dragon', 'herald']);
  });

  it('does not report before the deadline', () => {
    expect(dueObjectives(objectives(), 299, always)).toEqual([]);
    expect(dueObjectives(objectives(), 300, always)).toEqual(['dragon']);
  });
});

describe('retireObjective and markObjectiveAlive', () => {
  it('retiring also clears alive, so a retired monster cannot linger', () => {
    const live = markObjectiveAlive(objectives(), 'herald', true);
    const gone = retireObjective(live, 'herald');
    const herald = gone.find((o) => o.id === 'herald')!;
    expect(herald.permanentlyGone).toBe(true);
    expect(herald.alive).toBe(false);
  });

  it('touches only the named slot, and copies rather than mutates', () => {
    const before = objectives();
    const after = markObjectiveAlive(before, 'dragon', true);
    expect(after.find((o) => o.id === 'herald')).toEqual(before.find((o) => o.id === 'herald'));
    expect(before.find((o) => o.id === 'dragon')!.alive).toBe(false);
  });
});

describe('clone helpers', () => {
  it('copies each buff object, not just the array', () => {
    const original: Record<string, BuffState> = { a: { buffs: [{ kind: 'blue', expiresAt: 10 }] } };
    const copy = cloneBuffs(original);
    copy.a.buffs[0].expiresAt = -1;
    copy.a.buffs.push({ kind: 'red', expiresAt: 5 });
    expect(original.a.buffs).toHaveLength(1);
    expect(original.a.buffs[0].expiresAt).toBe(10);
  });

  it('copies the baron modifiers object', () => {
    const original = { ally: noBaronBuff(), enemy: noBaronBuff() };
    const copy = cloneBaron(original);
    copy.ally.modifiers.attackDamage = 999;
    expect(original.ally.modifiers.attackDamage).toBe(0);
  });

  it('copies objective slots', () => {
    const original = objectives();
    const copy = cloneObjectives(original);
    copy[0].nextSpawnAt = -1;
    expect(original[0].nextSpawnAt).toBe(300);
  });

  it('copies a warden charge and preserves null', () => {
    const original = { ally: { acquiredAt: 0, expiresAt: 100 }, enemy: null };
    const copy = cloneWardenCharges(original);
    copy.ally!.expiresAt = -1;
    expect(original.ally.expiresAt).toBe(100);
    expect(copy.enemy).toBeNull();
  });
});
