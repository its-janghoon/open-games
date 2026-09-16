import { describe, it, expect } from 'vitest';
import {
  CAMPS,
  CAMP_RESPAWN_SECONDS,
  campRespawnAt,
  isCampAlive,
  BUFF_DURATION_SECONDS,
  BUFF_EFFECTS,
  createBuffState,
  applyBuff,
  expireBuffs,
  hasBuff,
  type Camp,
} from './jungle';

function findCamp(id: string): Camp {
  const camp = CAMPS.find((c) => c.id === id);
  if (!camp) throw new Error(`camp ${id} not found`);
  return camp;
}

describe('camps', () => {
  it('exposes camps with positive respawn timers and bounties', () => {
    expect(CAMPS.length).toBeGreaterThan(0);
    for (const camp of CAMPS) {
      expect(camp.respawnSeconds).toBeGreaterThan(0);
      expect(camp.bounty.gold).toBeGreaterThan(0);
      expect(camp.bounty.xp).toBeGreaterThan(0);
    }
  });

  it('includes both buff camps and a scuttle for each side', () => {
    expect(CAMPS.some((c) => c.type === 'blue')).toBe(true);
    expect(CAMPS.some((c) => c.type === 'red')).toBe(true);
    expect(CAMPS.filter((c) => c.type === 'scuttle').length).toBe(2);
  });
});

describe('camp respawn', () => {
  it('computes respawn time from kill time', () => {
    const blue = findCamp('ally-blue');
    expect(campRespawnAt(blue, 200)).toBe(200 + CAMP_RESPAWN_SECONDS.blue);
  });

  it('is dead until respawn, then alive', () => {
    const wolves = findCamp('ally-wolves');
    const killedAt = 100;
    expect(isCampAlive(wolves, killedAt + 1, killedAt)).toBe(false);
    expect(isCampAlive(wolves, killedAt + wolves.respawnSeconds - 1, killedAt)).toBe(false);
    expect(isCampAlive(wolves, killedAt + wolves.respawnSeconds, killedAt)).toBe(true);
  });

  it('is alive when never killed', () => {
    expect(isCampAlive(findCamp('ally-red'), 9999, null)).toBe(true);
  });
});

describe('buffs', () => {
  it('blue and red grant distinct numeric effects', () => {
    expect(BUFF_EFFECTS.blue.cooldownReduction).toBeGreaterThan(0);
    expect(BUFF_EFFECTS.blue.resourceRegenPerSecond).toBeGreaterThan(0);
    expect(BUFF_EFFECTS.red.bonusDamage).toBeGreaterThan(0);
    expect(BUFF_EFFECTS.red.slowPercent).toBeGreaterThan(0);
    expect(BUFF_EFFECTS.blue).not.toEqual(BUFF_EFFECTS.red);
  });

  it('applies and expires a buff on the state', () => {
    let state = createBuffState();
    applyBuff(state, 'blue', 0);
    expect(hasBuff(state, 'blue', 0)).toBe(true);
    expect(hasBuff(state, 'red', 0)).toBe(false);

    // Still active just before expiry, gone after.
    expect(hasBuff(state, 'blue', BUFF_DURATION_SECONDS - 1)).toBe(true);
    state = expireBuffs(state, BUFF_DURATION_SECONDS);
    expect(hasBuff(state, 'blue', BUFF_DURATION_SECONDS)).toBe(false);
    expect(state.buffs.length).toBe(0);
  });

  it('refreshes rather than stacks the same buff kind', () => {
    const state = createBuffState();
    applyBuff(state, 'red', 0);
    applyBuff(state, 'red', 10);
    expect(state.buffs.length).toBe(1);
    expect(state.buffs[0].expiresAt).toBe(10 + BUFF_DURATION_SECONDS);
  });

  it('tracks blue and red simultaneously', () => {
    const state = createBuffState();
    applyBuff(state, 'blue', 0);
    applyBuff(state, 'red', 0);
    expect(hasBuff(state, 'blue', 5)).toBe(true);
    expect(hasBuff(state, 'red', 5)).toBe(true);
    expect(state.buffs.length).toBe(2);
  });
});
