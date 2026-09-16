import { describe, expect, it } from 'vitest';

import { classifyVictim, resolveKill } from './killRewards';

describe('resolveKill', () => {
  it('pays a champion takedown and counts it for the killer side', () => {
    const outcome = resolveKill({ victimKind: 'champion', killerSide: 'ally' });
    expect(outcome.bounty.gold).toBeGreaterThan(0);
    expect(outcome.championKillDelta).toBe(1);
  });

  it('pays nothing and counts nothing when the kill has no attributable side', () => {
    const outcome = resolveKill({ victimKind: 'champion', killerSide: null });
    expect(outcome.bounty).toEqual({ gold: 0, xp: 0 });
    expect(outcome.championKillDelta, 'an unattributed kill must not credit a team').toBe(0);
  });

  it('returns a ZERO bounty rather than null for an unattributed kill', () => {
    /**
     * Deliberate: the caller adds the bounty unconditionally, so a null would need a check at every call site and one of
     * them would eventually be forgotten. A zero is safe to add.
     */
    for (const kind of ['champion', 'minion', 'turret', 'inhibitor', 'nexus', 'monster'] as const) {
      const outcome = resolveKill({ victimKind: kind, killerSide: null });
      expect(outcome.bounty, kind).toEqual({ gold: 0, xp: 0 });
    }
  });

  it('pays a minion by its type', () => {
    const melee = resolveKill({ victimKind: 'minion', minionType: 'melee', killerSide: 'ally' });
    const siege = resolveKill({ victimKind: 'minion', minionType: 'siege', killerSide: 'ally' });
    expect(melee.bounty.gold).toBeGreaterThan(0);
    expect(siege.bounty.gold).not.toBe(melee.bounty.gold);
  });

  it('defaults an unspecified minion type to melee rather than throwing', () => {
    expect(resolveKill({ victimKind: 'minion', killerSide: 'ally' }).bounty).toEqual(
      resolveKill({ victimKind: 'minion', minionType: 'melee', killerSide: 'ally' }).bounty,
    );
  });

  it('pays each structure kind differently', () => {
    const turret = resolveKill({ victimKind: 'turret', killerSide: 'ally' }).bounty.gold;
    const inhibitor = resolveKill({ victimKind: 'inhibitor', killerSide: 'ally' }).bounty.gold;
    const nexus = resolveKill({ victimKind: 'nexus', killerSide: 'ally' }).bounty.gold;
    expect(new Set([turret, inhibitor, nexus]).size, 'three kinds must not collapse to one payout').toBe(3);
  });

  it('starts an inhibitor respawn EVEN when the kill is unattributed', () => {
    // The respawn is the inhibitor's own consequence, not a reward — an inhibitor felled by a minion wave still respawns.
    expect(resolveKill({ victimKind: 'inhibitor', killerSide: null }).startsInhibitorRespawn).toBe(true);
    expect(resolveKill({ victimKind: 'turret', killerSide: 'ally' }).startsInhibitorRespawn).toBe(false);
  });

  it('pays nothing for a jungle monster', () => {
    // Their reward is the buff they grant, which the caller applies.
    expect(resolveKill({ victimKind: 'monster', killerSide: 'ally' }).bounty).toEqual({ gold: 0, xp: 0 });
  });

  it('is deterministic', () => {
    const a = resolveKill({ victimKind: 'champion', killerSide: 'enemy' });
    const b = resolveKill({ victimKind: 'champion', killerSide: 'enemy' });
    expect(a).toEqual(b);
  });
});

describe('classifyVictim', () => {
  it('tells an inhibitor from a turret by its NODE, not its unit kind', () => {
    /**
     * `unit.kind` is 'turret' for an inhibitor. Classifying separately from the payout is exactly how an inhibitor comes to
     * pay a turret's bounty, which is why the two live in one module.
     */
    expect(classifyVictim('turret', 'inhibitor')).toBe('inhibitor');
    expect(classifyVictim('turret', 'outerTurret')).toBe('turret');
    expect(classifyVictim('turret', undefined)).toBe('turret');
  });

  it('classifies a nexus by node even when the unit kind says turret', () => {
    expect(classifyVictim('turret', 'nexus')).toBe('nexus');
  });

  it('passes through the simple kinds', () => {
    expect(classifyVictim('champion', undefined)).toBe('champion');
    expect(classifyVictim('minion', undefined)).toBe('minion');
    expect(classifyVictim('monster', undefined)).toBe('monster');
  });

  it('classifies an inhibitor payout differently from a turret one end to end', () => {
    const asInhibitor = resolveKill({ victimKind: classifyVictim('turret', 'inhibitor'), killerSide: 'ally' });
    const asTurret = resolveKill({ victimKind: classifyVictim('turret', 'outerTurret'), killerSide: 'ally' });
    expect(asInhibitor.bounty.gold).not.toBe(asTurret.bounty.gold);
    expect(asInhibitor.startsInhibitorRespawn).toBe(true);
    expect(asTurret.startsInhibitorRespawn).toBe(false);
  });
});
