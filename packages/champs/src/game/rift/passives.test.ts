import { describe, expect, it } from 'vitest';

import { BUFF_EFFECTS } from './jungle';
import {
  addTravelled,
  basicAttackBonus,
  clonePassiveState,
  createPassiveState,
  openDashWindow,
  passiveKeys,
  PASSIVE_TUNING,
  prunePassives,
  type PassiveState,
} from './passives';

const NOW = 100;

function context(over: Partial<Parameters<typeof basicAttackBonus>[0]> = {}) {
  return {
    championId: null as string | null,
    attackerId: 'a1',
    targetId: 't1',
    now: NOW,
    items: [] as string[],
    hasRedBuff: false,
    ...over,
  };
}

describe('basic-attack passives', () => {
  it('adds nothing for a champion with no passive and no items', () => {
    const result = basicAttackBonus(context(), createPassiveState());
    expect(result.bonusAd).toBe(0);
    expect(result.fired).toEqual([]);
  });

  it('is pure: the state it was given is untouched', () => {
    const state: PassiveState = { counters: { x: 1 }, deadlines: { y: 2 } };
    const before = JSON.stringify(state);
    basicAttackBonus(context({ championId: 'ashborne' }), state);
    expect(JSON.stringify(state)).toBe(before);
  });

  describe('duskarrow', () => {
    it('empowers a swing once enough distance has been travelled, then spends it', () => {
      let state = createPassiveState();
      state = addTravelled(state, 'a1', PASSIVE_TUNING.duskarrowDistance);
      const first = basicAttackBonus(context({ championId: 'duskarrow' }), state);
      expect(first.bonusAd).toBe(PASSIVE_TUNING.duskarrowBonus);
      // Spent: the very next swing must be plain, or walking once would empower every hit forever.
      const second = basicAttackBonus(context({ championId: 'duskarrow' }), first.state);
      expect(second.bonusAd).toBe(0);
    });

    it('resets the accumulator even when the swing was not empowered', () => {
      // Matches the scene: the distance is spent by SWINGING, not by landing a bonus. A swing that banked its progress
      // would let a champion accumulate across many short swings.
      let state = addTravelled(createPassiveState(), 'a1', PASSIVE_TUNING.duskarrowDistance - 1);
      state = basicAttackBonus(context({ championId: 'duskarrow' }), state).state;
      expect(state.counters[passiveKeys.duskarrowDistance('a1')]).toBe(0);
    });

    it('ignores a non-positive travel distance', () => {
      const state = addTravelled(createPassiveState(), 'a1', 0);
      expect(state.counters[passiveKeys.duskarrowDistance('a1')]).toBeUndefined();
    });
  });

  describe('nightveil', () => {
    it('empowers one swing inside the dash window and consumes it', () => {
      const state = openDashWindow(createPassiveState(), 'a1', NOW + 3);
      const first = basicAttackBonus(context({ championId: 'nightveil' }), state);
      expect(first.bonusAd).toBe(PASSIVE_TUNING.nightveilBonus);
      const second = basicAttackBonus(context({ championId: 'nightveil' }), first.state);
      expect(second.bonusAd, 'one dash empowers one hit, not every hit in the window').toBe(0);
    });

    it('does nothing once the window has passed', () => {
      const state = openDashWindow(createPassiveState(), 'a1', NOW - 1);
      expect(basicAttackBonus(context({ championId: 'nightveil' }), state).bonusAd).toBe(0);
    });
  });

  describe('ashborne', () => {
    it('lands its bonus on the third hit on the same target', () => {
      let state = createPassiveState();
      const bonuses: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        const result = basicAttackBonus(context({ championId: 'ashborne' }), state);
        bonuses.push(result.bonusAd);
        state = result.state;
      }
      expect(bonuses).toEqual([0, 0, PASSIVE_TUNING.ashborneBonus]);
    });

    it('counts stacks per TARGET, not per attacker', () => {
      // Two hits on one enemy and one on another must not add up to a proc.
      let state = createPassiveState();
      state = basicAttackBonus(context({ championId: 'ashborne', targetId: 'x' }), state).state;
      state = basicAttackBonus(context({ championId: 'ashborne', targetId: 'x' }), state).state;
      const other = basicAttackBonus(context({ championId: 'ashborne', targetId: 'y' }), state);
      expect(other.bonusAd).toBe(0);
    });

    it('drops stacks once the window lapses', () => {
      let state = createPassiveState();
      state = basicAttackBonus(context({ championId: 'ashborne' }), state).state;
      state = basicAttackBonus(context({ championId: 'ashborne' }), state).state;
      // Far past the window: this hit is the first again, so it must not proc.
      const late = basicAttackBonus(
        context({ championId: 'ashborne', now: NOW + PASSIVE_TUNING.ashborneWindowSeconds + 1 }),
        state,
      );
      expect(late.bonusAd).toBe(0);
    });
  });

  describe('sunfire', () => {
    it('empowers a hit and then waits out its interval on the SAME target', () => {
      const items = ['sunfireGreatblade'];
      const first = basicAttackBonus(context({ items }), createPassiveState());
      expect(first.bonusAd).toBe(PASSIVE_TUNING.sunfireBonus);
      const immediate = basicAttackBonus(context({ items }), first.state);
      expect(immediate.bonusAd).toBe(0);
      const later = basicAttackBonus(
        context({ items, now: NOW + PASSIVE_TUNING.sunfireIntervalSeconds }),
        first.state,
      );
      expect(later.bonusAd).toBe(PASSIVE_TUNING.sunfireBonus);
    });

    it('tracks the interval per PAIR, so a different target is not on cooldown', () => {
      const items = ['sunfireGreatblade'];
      const first = basicAttackBonus(context({ items }), createPassiveState());
      const other = basicAttackBonus(context({ items, targetId: 'other' }), first.state);
      expect(other.bonusAd).toBe(PASSIVE_TUNING.sunfireBonus);
    });

    it('does nothing without the item', () => {
      expect(basicAttackBonus(context(), createPassiveState()).bonusAd).toBe(0);
    });
  });

  it('adds the red buff on top of a champion passive', () => {
    // The bonuses stack, so a test that only checked one would pass with the other silently dropped.
    const state = openDashWindow(createPassiveState(), 'a1', NOW + 3);
    const result = basicAttackBonus(context({ championId: 'nightveil', hasRedBuff: true }), state);
    expect(result.bonusAd).toBe(PASSIVE_TUNING.nightveilBonus + BUFF_EFFECTS.red.bonusDamage);
    expect(result.fired).toContain('nightveil');
    expect(result.fired).toContain('red');
  });
});

describe('housekeeping', () => {
  it('clones independently', () => {
    const original: PassiveState = { counters: { a: 1 }, deadlines: { b: 2 } };
    const copy = clonePassiveState(original);
    copy.counters.a = 99;
    copy.deadlines.b = 99;
    expect(original.counters.a).toBe(1);
    expect(original.deadlines.b).toBe(2);
  });

  it('prunes only deadlines well past, keeping recently expired ones', () => {
    /**
     * Conservative on purpose: a deadline that is merely expired is still READ this tick, to decide that ashborne's
     * stacks do NOT carry forward. Dropping it early would silently make every lapsed window look like a fresh one.
     */
    const state: PassiveState = { counters: { c: 1 }, deadlines: { fresh: NOW, justGone: NOW - 5, ancient: NOW - 999 } };
    const pruned = prunePassives(state, NOW, 30);
    expect(pruned.deadlines.fresh).toBe(NOW);
    expect(pruned.deadlines.justGone).toBe(NOW - 5);
    expect(pruned.deadlines.ancient).toBeUndefined();
    expect(pruned.counters).toEqual({ c: 1 });
  });
});
