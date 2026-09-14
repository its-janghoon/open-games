import { describe, it, expect } from 'vitest';

import {
  BIAS_MAX,
  BIAS_MIN,
  GHOST_INTENTS,
  GHOST_VERSION,
  MIN_OBSERVATIONS,
  decodeGhost,
  encodeGhost,
  ghostDecide,
  learnGhost,
  neutralGhost,
  type GhostObservation,
  type GhostPolicy,
} from './ghost';
import { decideScoredAction, type AiSnapshot } from './ai';

/** A snapshot with everything a decision needs; override what a case cares about. */
const snap = (over: Partial<AiSnapshot> = {}): AiSnapshot => ({
  selfHpPct: 1,
  selfResourcePct: 1,
  distanceToTarget: 200,
  hasTarget: true,
  attackRange: 250,
  // Uppercase slots. The policy indexes these maps with 'Q'|'W'|'E'|'R', so a
  // lowercase fixture makes every lookup undefined and every ability permanently
  // unavailable - which is exactly how a first draft of this file silently tested
  // nothing about casting.
  cooldowns: { Q: 0, W: 0, E: 0, R: 0 },
  abilityRanges: { Q: 600, W: 600, E: 600, R: 600 },
  abilityCosts: { Q: 20, W: 20, E: 20, R: 40 },
  abilityBehaviors: { Q: 'skillshot', W: 'skillshot', E: 'skillshot', R: 'skillshot' },
  maxResource: 400,
  targetLowHp: false,
  ...over,
});

describe('ghost codes', () => {
  it('round-trips a ghost through a code', () => {
    const ghost: GhostPolicy = {
      version: GHOST_VERSION,
      bias: { approach: 12, attack: -7, castQ: 40, castW: 0, castE: -60, castR: 60, retreat: -25 },
      retreatHp: 0.42,
      engageRange: 1.75,
      abilityEagerness: 0.8,
    };
    const code = encodeGhost(ghost);
    const back = decodeGhost(code);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    for (const intent of GHOST_INTENTS) {
      expect(back.ghost.bias[intent]).toBe(ghost.bias[intent]);
    }
    // The scalars are quantised into one byte each, so they come back close, not exact.
    expect(back.ghost.retreatHp).toBeCloseTo(ghost.retreatHp, 2);
    expect(back.ghost.engageRange).toBeCloseTo(ghost.engageRange, 1);
    expect(back.ghost.abilityEagerness).toBeCloseTo(ghost.abilityEagerness, 2);
  });

  it('produces a code short enough to paste into a chat message', () => {
    const code = encodeGhost(neutralGhost());
    expect(code.replace(/-/g, '').length).toBeLessThanOrEqual(24);
    expect(code).toMatch(/^[0-9A-Z-]+$/);
  });

  it('reads back a code that has been mangled the way humans mangle codes', () => {
    const code = encodeGhost(neutralGhost());
    const plain = code.replace(/-/g, '');
    // Lower case, no grouping, stray spaces, and O/I typed for 0/1.
    const mangled = ` ${plain.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l')} `;
    const back = decodeGhost(mangled);
    expect(back.ok, 'a code differing only in case, spacing and lookalikes must still work').toBe(true);
  });

  it('refuses a corrupted code instead of inventing a ghost', () => {
    const code = encodeGhost(neutralGhost()).replace(/-/g, '');
    // Flip one character to another valid symbol: the checksum has to catch it.
    const flipped = `${code.slice(0, 3)}${code[3] === 'Z' ? 'Y' : 'Z'}${code.slice(4)}`;
    const back = decodeGhost(flipped);
    expect(back.ok).toBe(false);
    if (back.ok) return;
    expect(back.error).toBe('bad-checksum');
  });

  it('refuses a truncated code', () => {
    const code = encodeGhost(neutralGhost()).replace(/-/g, '');
    const back = decodeGhost(code.slice(0, 6));
    expect(back.ok).toBe(false);
    if (!back.ok) expect(back.error).toBe('wrong-length');
  });

  it('refuses text that is not a code at all', () => {
    for (const junk of ['', 'hello world!', '!!!!', '@@@@@@@@']) {
      const back = decodeGhost(junk);
      expect(back.ok, `'${junk}' should not decode`).toBe(false);
    }
  });

  it('refuses a code from a version it does not understand', () => {
    const future = { ...neutralGhost(), version: GHOST_VERSION + 1 };
    const back = decodeGhost(encodeGhost(future));
    expect(back.ok).toBe(false);
    if (!back.ok) expect(back.error).toBe('unsupported-version');
  });
});

describe('ghost learning', () => {
  it('returns a neutral ghost from too few observations rather than a confident one', () => {
    const few: GhostObservation[] = Array.from({ length: MIN_OBSERVATIONS - 1 }, () => ({
      snapshot: snap({ selfHpPct: 0.2 }),
      chosen: 'attack' as const,
    }));
    const ghost = learnGhost(few);
    for (const intent of GHOST_INTENTS) expect(ghost.bias[intent]).toBe(0);
  });

  it('learns nothing from a player who always agrees with the base policy', () => {
    // Agreement carries no information: if the policy would have done it anyway,
    // doing it says nothing about the player.
    const observations: GhostObservation[] = Array.from({ length: MIN_OBSERVATIONS * 2 }, () => {
      const snapshot = snap({ distanceToTarget: 120 });
      return { snapshot, chosen: decideScoredAction(snapshot) };
    });
    const ghost = learnGhost(observations);
    for (const intent of GHOST_INTENTS) expect(ghost.bias[intent]).toBe(0);
  });

  it('learns a bias from a player who consistently disagrees', () => {
    // A player who retreats in situations the policy wants to fight in.
    const observations: GhostObservation[] = Array.from({ length: MIN_OBSERVATIONS * 2 }, () => ({
      snapshot: snap({ selfHpPct: 0.9, distanceToTarget: 100, targetLowHp: true }),
      chosen: 'retreat' as const,
    }));
    const ghost = learnGhost(observations);
    expect(ghost.bias.retreat).toBeGreaterThan(0);
  });

  it('records the hp at which a player actually disengages', () => {
    const observations: GhostObservation[] = Array.from({ length: MIN_OBSERVATIONS * 2 }, () => ({
      snapshot: snap({ selfHpPct: 0.65 }),
      chosen: 'retreat' as const,
    }));
    expect(learnGhost(observations).retreatHp).toBeCloseTo(0.65, 2);
  });

  it('records how readily a player spends abilities', () => {
    // Inside attack range on purpose. Measured on the base policy: an OFFENSIVE cast
    // scores -Infinity while the target is outside basic-attack range, regardless of
    // the ability's own longer cast range - so at distance 300 with a 250 range there
    // is no cast opportunity to have an opinion about, and eagerness stays at its
    // default. abilityRanges is not what gates the cast score.
    const inRange = { distanceToTarget: 200, attackRange: 250 };
    const eager: GhostObservation[] = Array.from({ length: MIN_OBSERVATIONS * 2 }, () => ({
      snapshot: snap(inRange),
      chosen: 'castQ' as const,
    }));
    expect(learnGhost(eager).abilityEagerness).toBeGreaterThan(0.9);

    const frugal: GhostObservation[] = Array.from({ length: MIN_OBSERVATIONS * 2 }, () => ({
      snapshot: snap(inRange),
      chosen: 'approach' as const,
    }));
    expect(learnGhost(frugal).abilityEagerness).toBeLessThan(0.1);
  });

  it('keeps every bias inside the range a code can carry', () => {
    const extreme: GhostObservation[] = Array.from({ length: MIN_OBSERVATIONS * 4 }, () => ({
      snapshot: snap({ selfHpPct: 1, distanceToTarget: 50, targetLowHp: true }),
      chosen: 'retreat' as const,
    }));
    const ghost = learnGhost(extreme);
    for (const intent of GHOST_INTENTS) {
      expect(ghost.bias[intent]).toBeGreaterThanOrEqual(BIAS_MIN);
      expect(ghost.bias[intent]).toBeLessThanOrEqual(BIAS_MAX);
    }
    // And it survives a round-trip at the extremes.
    const back = decodeGhost(encodeGhost(ghost));
    expect(back.ok).toBe(true);
  });
});

describe('ghost acting', () => {
  it('behaves exactly like the base AI when neutral', () => {
    const cases = [
      snap({ distanceToTarget: 600 }),
      snap({ distanceToTarget: 100, targetLowHp: true }),
      snap({ selfHpPct: 0.1 }),
      snap({ hasTarget: false }),
    ];
    for (const snapshot of cases) {
      expect(ghostDecide(snapshot, neutralGhost())).toBe(decideScoredAction(snapshot));
    }
  });

  it('never chooses an action the base policy ruled out', () => {
    // Every ability on cooldown, and a ghost that wants nothing but abilities.
    const snapshot = snap({ cooldowns: { Q: 5000, W: 5000, E: 5000, R: 5000 } });
    const castHappy: GhostPolicy = {
      ...neutralGhost(),
      bias: { approach: BIAS_MIN, attack: BIAS_MIN, castQ: BIAS_MAX, castW: BIAS_MAX, castE: BIAS_MAX, castR: BIAS_MAX, retreat: BIAS_MIN },
      abilityEagerness: 1,
    };
    expect(ghostDecide(snapshot, castHappy).startsWith('cast')).toBe(false);
  });

  it('survives a hand-edited code without producing an illegal action', () => {
    // Someone will edit a code by hand. The clamps plus the base policy's own
    // impossibility rules have to absorb it.
    const wild: GhostPolicy = {
      version: GHOST_VERSION,
      bias: { approach: 9999, attack: -9999, castQ: 9999, castW: 0, castE: 0, castR: 0, retreat: 9999 },
      retreatHp: 42,
      engageRange: -3,
      abilityEagerness: 7,
    };
    const back = decodeGhost(encodeGhost(wild));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const snapshot = snap({ cooldowns: { Q: 900, W: 900, E: 900, R: 900 }, hasTarget: false });
    const intent = ghostDecide(snapshot, back.ghost);
    expect(GHOST_INTENTS).toContain(intent);
    expect(intent.startsWith('cast')).toBe(false);
  });

  it('a cautious ghost and an aggressive ghost disagree on the same situation', () => {
    // The point of the whole feature: two ghosts must actually play differently.
    const cautious: GhostPolicy = { ...neutralGhost(), bias: { ...neutralGhost().bias, retreat: 50 }, retreatHp: 0.9 };
    const aggressive: GhostPolicy = { ...neutralGhost(), bias: { ...neutralGhost().bias, attack: 50 } };
    const contested = snap({ selfHpPct: 0.5, distanceToTarget: 200 });
    expect(ghostDecide(contested, cautious)).not.toBe(ghostDecide(contested, aggressive));
  });
});
