import { describe, it, expect } from 'vitest';
import {
  decideAction,
  decideScoredAction,
  scoreAiIntent,
  canCast,
  isNonOffensive,
  RETREAT_HP_THRESHOLD,
  SELF_SUSTAIN_HP_THRESHOLD,
  type AiSnapshot,
} from './ai';
import { createCooldownState } from './combat';
import type { AbilityBehavior } from '../data/champions';

function makeSnapshot(overrides: Partial<AiSnapshot> = {}): AiSnapshot {
  return {
    selfHpPct: 1,
    selfResourcePct: 1,
    distanceToTarget: 1000,
    hasTarget: true,
    attackRange: 150,
    cooldowns: createCooldownState(),
    abilityRanges: { Q: 500, W: 500, E: 500, R: 800 },
    abilityCosts: { Q: 40, W: 60, E: 50, R: 100 },
    // Default kit is fully offensive so range gating applies to every slot.
    abilityBehaviors: {
      Q: 'skillshot',
      W: 'aoe',
      E: 'skillshot',
      R: 'skillshot',
    } as Record<'Q' | 'W' | 'E' | 'R', AbilityBehavior>,
    maxResource: 300,
    targetLowHp: false,
    ...overrides,
  };
}

describe('decideAction', () => {
  it('approaches when there is no target', () => {
    expect(decideAction(makeSnapshot({ hasTarget: false }))).toBe('approach');
  });

  it('retreats at low hp when it cannot execute', () => {
    const s = makeSnapshot({
      selfHpPct: RETREAT_HP_THRESHOLD - 0.05,
      distanceToTarget: 200,
      targetLowHp: false,
    });
    expect(decideAction(s)).toBe('retreat');
  });

  it('does NOT retreat at low hp if it can execute a low-hp target in reach', () => {
    const s = makeSnapshot({
      selfHpPct: RETREAT_HP_THRESHOLD - 0.05,
      distanceToTarget: 100,
      attackRange: 150,
      targetLowHp: true,
      // no abilities in range/ready here beyond basic attack
      abilityRanges: { Q: 50, W: 50, E: 50, R: 50 },
    });
    expect(decideAction(s)).toBe('attack');
  });

  it('casts the highest-impact ready ability that is in range', () => {
    const s = makeSnapshot({ distanceToTarget: 400 });
    // All ready & affordable, Q/W/E in range (500) but R range is 800 so also in range.
    // R has highest priority.
    expect(decideAction(s)).toBe('castR');
  });

  it('falls back to a lower ability when higher ones are on cooldown', () => {
    const cds = createCooldownState();
    cds.R = 40;
    cds.W = 5;
    const s = makeSnapshot({ distanceToTarget: 400, cooldowns: cds });
    expect(decideAction(s)).toBe('castQ');
  });

  it('basic attacks when in range and no ability is castable', () => {
    const cds = createCooldownState();
    cds.Q = 5;
    cds.W = 5;
    cds.E = 5;
    cds.R = 5;
    const s = makeSnapshot({ distanceToTarget: 120, attackRange: 150, cooldowns: cds });
    expect(decideAction(s)).toBe('attack');
  });

  it('approaches when the target is out of every range', () => {
    const cds = createCooldownState();
    cds.Q = 5;
    cds.W = 5;
    cds.E = 5;
    cds.R = 5;
    const s = makeSnapshot({ distanceToTarget: 2000, cooldowns: cds });
    expect(decideAction(s)).toBe('approach');
  });

  it('does not cast an ability it cannot afford', () => {
    const s = makeSnapshot({
      distanceToTarget: 400,
      selfResourcePct: 0.1, // 0.1 * 300 = 30 resource, below every cost
    });
    // Nothing affordable, but in ability range and out of attack range -> approach.
    expect(decideAction(s)).toBe('approach');
  });
});

describe('canCast', () => {
  it('requires ready, affordable, and in range', () => {
    const s = makeSnapshot({ distanceToTarget: 400 });
    expect(canCast(s, 'Q')).toBe(true);
  });

  it('false when on cooldown', () => {
    const cds = createCooldownState();
    cds.Q = 3;
    expect(canCast(makeSnapshot({ distanceToTarget: 100, cooldowns: cds }), 'Q')).toBe(false);
  });

  it('false when out of range', () => {
    expect(canCast(makeSnapshot({ distanceToTarget: 9999 }), 'Q')).toBe(false);
  });

  it('false when unaffordable', () => {
    expect(
      canCast(makeSnapshot({ distanceToTarget: 100, selfResourcePct: 0 }), 'R'),
    ).toBe(false);
  });
});

describe('isNonOffensive', () => {
  it('treats heal and buff as non-offensive', () => {
    expect(isNonOffensive('heal')).toBe(true);
    expect(isNonOffensive('buff')).toBe(true);
  });

  it('treats damaging behaviors as offensive', () => {
    for (const b of ['skillshot', 'aoe', 'dash', 'stun'] as const) {
      expect(isNonOffensive(b)).toBe(false);
    }
  });
});

describe('non-offensive (self) abilities', () => {
  function healSnapshot(overrides: Partial<AiSnapshot> = {}): AiSnapshot {
    return makeSnapshot({
      // W is a self-heal, E is a self-buff; Q/R stay offensive.
      abilityBehaviors: { Q: 'skillshot', W: 'heal', E: 'buff', R: 'skillshot' },
      ...overrides,
    });
  }

  it('does NOT cast a self-heal at full health', () => {
    // Full hp, enemy far away: should not blow the heal.
    expect(canCast(healSnapshot({ selfHpPct: 1 }), 'W')).toBe(false);
  });

  it('casts a self-heal when hurt even with NO enemy in range', () => {
    const s = healSnapshot({
      selfHpPct: 0.5,
      hasTarget: false,
      distanceToTarget: Infinity,
    });
    expect(canCast(s, 'W')).toBe(true);
    // And decideAction prioritizes the sustain over walking down the lane.
    expect(decideAction(s)).toBe('castW');
  });

  it('self-heal ignores target range entirely (fires with target very far)', () => {
    const s = healSnapshot({ selfHpPct: 0.4, distanceToTarget: 99999 });
    expect(canCast(s, 'W')).toBe(true);
  });

  it('respects the self-sustain hp threshold boundary', () => {
    expect(canCast(healSnapshot({ selfHpPct: SELF_SUSTAIN_HP_THRESHOLD }), 'W')).toBe(true);
    expect(
      canCast(healSnapshot({ selfHpPct: SELF_SUSTAIN_HP_THRESHOLD + 0.01 }), 'W'),
    ).toBe(false);
  });

  it('an enemy enchanter can act: self-heals when hurt with no target', () => {
    // Mirrors Dawnsong's kit: W heal, E buff, R heal, Q offensive skillshot.
    const dawnsong = makeSnapshot({
      abilityBehaviors: { Q: 'skillshot', W: 'heal', E: 'buff', R: 'heal' },
      abilityRanges: { Q: 950, W: 700, E: 800, R: 900 },
      abilityCosts: { Q: 55, W: 80, E: 65, R: 100 },
      selfHpPct: 0.6,
      hasTarget: false,
      distanceToTarget: Infinity,
    });
    // R (heal) has highest cast priority and is affordable at full resource.
    expect(decideAction(dawnsong)).toBe('castR');
  });

  it('still retreats at critical hp rather than only healing', () => {
    // With heal on cooldown and hp critical, the bot should retreat.
    const cds = createCooldownState();
    cds.W = 5;
    cds.E = 5;
    cds.R = 5;
    const s = healSnapshot({
      selfHpPct: RETREAT_HP_THRESHOLD - 0.05,
      distanceToTarget: 300,
      cooldowns: cds,
    });
    expect(decideAction(s)).toBe('retreat');
  });
});


describe('contextual action scoring', () => {
  it('keeps approaching when role is the only strategic signal', () => {
    for (const role of ['marksman', 'enchanter'] as const) {
      const snapshot = makeSnapshot({
        distanceToTarget: 1_500,
        context: { role },
      });
      expect(decideAction(snapshot)).toBe('approach');
      expect(scoreAiIntent(snapshot, 'approach')).toBeGreaterThan(
        scoreAiIntent(snapshot, 'retreat'),
      );
    }
  });

  it('retreats from severe turret danger with a fragile ranged role', () => {
    const snapshot = makeSnapshot({
      distanceToTarget: 400,
      context: {
        role: 'marksman',
        turretDanger: 1,
        nearbyAllies: 0,
        nearbyEnemies: 2,
      },
    });
    expect(scoreAiIntent(snapshot, 'retreat')).toBeGreaterThan(
      scoreAiIntent(snapshot, 'castR'),
    );
    expect(decideScoredAction(snapshot)).toBe('retreat');
    expect(decideAction(snapshot)).toBe('retreat');
  });

  it('engages with allied wave and objective pressure when numbers are favorable', () => {
    const snapshot = makeSnapshot({
      distanceToTarget: 400,
      targetLowHp: true,
      context: {
        role: 'assassin',
        wavePressure: 1,
        objectivePressure: 1,
        nearbyAllies: 3,
        nearbyEnemies: 1,
      },
    });
    expect(decideAction(snapshot)).toBe('castR');
    expect(scoreAiIntent(snapshot, 'castR')).toBeGreaterThan(
      scoreAiIntent(snapshot, 'retreat'),
    );
  });

  it('values a shop reset when enough unspent gold is ready', () => {
    const snapshot = makeSnapshot({
      distanceToTarget: 1_500,
      context: {
        role: 'enchanter',
        gold: 1_200,
        nextPurchaseCost: 900,
        shopAvailable: false,
      },
    });
    expect(decideAction(snapshot)).toBe('retreat');

    const urgentObjective = makeSnapshot({
      distanceToTarget: 400,
      context: {
        role: 'bruiser',
        gold: 1_200,
        nextPurchaseCost: 900,
        objectivePressure: 1,
        wavePressure: 1,
        nearbyAllies: 2,
        nearbyEnemies: 1,
      },
    });
    expect(scoreAiIntent(urgentObjective, 'castR')).toBeGreaterThan(
      scoreAiIntent(urgentObjective, 'retreat'),
    );
  });
});
describe('determinism — the property the whole rollback rests on', () => {
  /**
   * The bot AI is structurally pure: no Math.random, no clock, no module-level mutable state. Nothing asserted it, and
   * a property nothing asserts is a property the next edit can remove for free.
   *
   * This matters more than most tests here. If two peers' bots decided differently from identical snapshots, every other
   * piece of extracted state would be correct and the match would still diverge — and the divergence would look like a
   * netcode bug rather than an AI one.
   */
  const VARIED: Partial<AiSnapshot>[] = [
    {},
    { hasTarget: false },
    { selfHpPct: 0.1 },
    { selfHpPct: 0.5, distanceToTarget: 200 },
    { selfResourcePct: 0, distanceToTarget: 100 },
    { targetLowHp: true, distanceToTarget: 120 },
    { distanceToTarget: 900 },
    { selfHpPct: RETREAT_HP_THRESHOLD - 0.01 },
    { selfHpPct: SELF_SUSTAIN_HP_THRESHOLD - 0.01, distanceToTarget: 300 },
  ];

  it('returns the same intent for the same snapshot, every time', () => {
    for (const overrides of VARIED) {
      const snapshot = makeSnapshot(overrides);
      const first = decideAction(snapshot);
      for (let i = 0; i < 20; i += 1) {
        expect(decideAction(makeSnapshot(overrides)), JSON.stringify(overrides)).toBe(first);
      }
    }
  });

  it('is the same for the scored path too', () => {
    for (const overrides of VARIED) {
      const first = decideScoredAction(makeSnapshot(overrides));
      expect(decideScoredAction(makeSnapshot(overrides))).toBe(first);
      expect(decideScoredAction(makeSnapshot(overrides))).toBe(first);
    }
  });

  it('does not depend on the order snapshots are evaluated in', () => {
    // A module-level accumulator would show up here and nowhere else: forward and reverse passes would disagree.
    const forward = VARIED.map((o) => decideAction(makeSnapshot(o)));
    const reverse = [...VARIED].reverse().map((o) => decideAction(makeSnapshot(o)));
    expect(reverse).toEqual([...forward].reverse());
  });

  it('does not mutate the snapshot it was given', () => {
    // A decision that wrote back into its input would make the SECOND call on a replayed tick different from the first.
    const snapshot = makeSnapshot({ selfHpPct: 0.4, distanceToTarget: 250 });
    const before = JSON.stringify(snapshot);
    decideAction(snapshot);
    decideScoredAction(snapshot);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('scores every intent identically on repeated calls', () => {
    const snapshot = makeSnapshot({ selfHpPct: 0.6, distanceToTarget: 300 });
    for (const intent of ['approach', 'retreat', 'attack'] as const) {
      expect(scoreAiIntent(snapshot, intent)).toBe(scoreAiIntent(snapshot, intent));
    }
  });
});
