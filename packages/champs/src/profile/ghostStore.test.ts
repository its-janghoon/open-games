import { describe, it, expect } from 'vitest';

import {
  forgetGhostCode,
  ghostForOpponent,
  importGhostCode,
  saveLearnedGhost,
} from './ghostStore';
import { MAX_GHOST_CODES, createDefaultProfile, migrateProfile } from './profile';
import { MIN_OBSERVATIONS, encodeGhost, neutralGhost, type GhostObservation } from '../game/ghost';
import type { AiSnapshot } from '../game/ai';

const snapshot = (over: Partial<AiSnapshot> = {}): AiSnapshot => ({
  selfHpPct: 0.8,
  selfResourcePct: 1,
  distanceToTarget: 120,
  hasTarget: true,
  attackRange: 250,
  cooldowns: { Q: 0, W: 0, E: 0, R: 0 },
  abilityRanges: { Q: 600, W: 600, E: 600, R: 600 },
  abilityCosts: { Q: 20, W: 20, E: 20, R: 40 },
  abilityBehaviors: { Q: 'skillshot', W: 'skillshot', E: 'skillshot', R: 'skillshot' },
  maxResource: 400,
  targetLowHp: true,
  ...over,
});

const observations = (count: number): GhostObservation[] =>
  Array.from({ length: count }, () => ({ snapshot: snapshot(), chosen: 'retreat' as const }));

const aCode = () => {
  const ghost = neutralGhost();
  ghost.bias.attack = 30;
  return encodeGhost(ghost);
};

describe('profile migration carries ghost fields', () => {
  it('survives a round-trip through migrateProfile', () => {
    // THE test for this file. migrateProfile rebuilds the profile from named keys, so a
    // field nobody listed there is silently dropped on every reload - whiteout's
    // normalizeSettings sprang exactly this trap once, and it looks like the feature
    // failing to save rather than like a migration bug.
    const code = aCode();
    const profile = { ...createDefaultProfile(), myGhostCode: code, ghostCodes: [code] };
    const migrated = migrateProfile(JSON.parse(JSON.stringify(profile)));
    expect(migrated.myGhostCode).toBe(code);
    expect(migrated.ghostCodes).toEqual([code]);
  });

  it('gives an older profile with no ghost fields an empty list, not undefined', () => {
    const legacy = { ...createDefaultProfile() } as Record<string, unknown>;
    delete legacy.ghostCodes;
    const migrated = migrateProfile(legacy);
    expect(migrated.ghostCodes).toEqual([]);
    expect(migrated.myGhostCode).toBeUndefined();
  });

  it('discards a corrupt stored code during migration rather than at the point of use', () => {
    const profile = {
      ...createDefaultProfile(),
      myGhostCode: 'GARBAGE!!',
      ghostCodes: ['ALSO-JUNK', aCode()],
    };
    const migrated = migrateProfile(JSON.parse(JSON.stringify(profile)));
    expect(migrated.myGhostCode).toBeUndefined();
    expect(migrated.ghostCodes).toEqual([aCode()]);
  });
});

describe('saveLearnedGhost', () => {
  it('stores a code once there is enough to learn from', () => {
    const result = saveLearnedGhost(createDefaultProfile(), observations(MIN_OBSERVATIONS * 2));
    expect(result.outcome).toBe('saved');
    expect(result.profile.myGhostCode).toBeTruthy();
  });

  it('refuses to save a ghost learned from a handful of decisions', () => {
    // A near-neutral code stored under the player's name would misrepresent them to
    // whoever fights it.
    const result = saveLearnedGhost(createDefaultProfile(), observations(MIN_OBSERVATIONS - 1));
    expect(result.outcome).toBe('too-few-observations');
    expect(result.profile.myGhostCode).toBeUndefined();
  });

  it('reports an unchanged ghost as a duplicate rather than rewriting it', () => {
    const first = saveLearnedGhost(createDefaultProfile(), observations(MIN_OBSERVATIONS * 2));
    const again = saveLearnedGhost(first.profile, observations(MIN_OBSERVATIONS * 2));
    expect(again.outcome).toBe('duplicate');
  });
});

describe('importGhostCode', () => {
  it('accepts a valid code, newest first', () => {
    const one = importGhostCode(createDefaultProfile(), aCode());
    expect(one.outcome).toBe('saved');
    const second = encodeGhost({ ...neutralGhost(), retreatHp: 0.7 });
    const two = importGhostCode(one.profile, second);
    expect(two.profile.ghostCodes[0]).toBe(second);
  });

  it('refuses a bad paste at the moment the player can still see it', () => {
    for (const junk of ['', 'nope', 'AAAA-BBBB-CCCC']) {
      expect(importGhostCode(createDefaultProfile(), junk).outcome).toBe('rejected');
    }
  });

  it('treats codes differing only in case and grouping as the same ghost', () => {
    const code = aCode();
    const first = importGhostCode(createDefaultProfile(), code);
    const messy = code.replace(/-/g, '').toLowerCase();
    const again = importGhostCode(first.profile, messy);
    expect(again.outcome).toBe('duplicate');
    expect(again.profile.ghostCodes).toHaveLength(1);
  });

  it('caps the list so pasting cannot grow a profile forever', () => {
    let profile = createDefaultProfile();
    for (let i = 0; i < MAX_GHOST_CODES + 6; i += 1) {
      const ghost = neutralGhost();
      ghost.bias.attack = i - 3; // a distinct ghost each time
      profile = importGhostCode(profile, encodeGhost(ghost)).profile;
    }
    expect(profile.ghostCodes).toHaveLength(MAX_GHOST_CODES);
  });
});

describe('forgetGhostCode', () => {
  it('removes a code, and removing it twice is not an error', () => {
    const code = aCode();
    const profile = importGhostCode(createDefaultProfile(), code).profile;
    const once = forgetGhostCode(profile, code);
    expect(once.ghostCodes).toEqual([]);
    expect(forgetGhostCode(once, code).ghostCodes).toEqual([]);
  });
});

describe('ghostForOpponent', () => {
  it('returns nothing unless a ghost was explicitly requested', () => {
    const profile = importGhostCode(createDefaultProfile(), aCode()).profile;
    expect(ghostForOpponent(profile, null)).toBeNull();
    expect(ghostForOpponent(profile, undefined)).toBeNull();
    expect(ghostForOpponent(profile, '')).toBeNull();
  });

  it('returns a stored ghost when asked for it', () => {
    const code = aCode();
    const profile = importGhostCode(createDefaultProfile(), code).profile;
    const ghost = ghostForOpponent(profile, code);
    expect(ghost).not.toBeNull();
    expect(ghost?.bias.attack).toBe(30);
  });

  it('falls back to the ordinary AI for a ghost the profile does not hold', () => {
    // A code removed since it was chosen, or a corrupt store. A broken ghost must not
    // become a broken match.
    const stranger = encodeGhost({ ...neutralGhost(), retreatHp: 0.9 });
    expect(ghostForOpponent(createDefaultProfile(), stranger)).toBeNull();
    expect(ghostForOpponent(createDefaultProfile(), 'GARBAGE')).toBeNull();
  });

  it('accepts the player fighting their own ghost', () => {
    const learned = saveLearnedGhost(createDefaultProfile(), observations(MIN_OBSERVATIONS * 2));
    expect(ghostForOpponent(learned.profile, learned.profile.myGhostCode)).not.toBeNull();
  });
});
