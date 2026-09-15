import { describe, it, expect } from 'vitest';

import { createEffectState } from './effects';
import { advanceEffects, advanceLives, type WorldState } from './worldStep';
import type { Unit } from './combat';

/**
 * The live half of this check cannot run here - the scene needs Phaser and a canvas - so
 * it was run over the DevTools protocol against a real conquest match and its output is
 * pasted below as data. A champion was put into a dead phase with a 2 s respawn and its
 * phase sampled every 400 ms.
 *
 * This is the differential for life state. The movement differential compares positions;
 * that shape does not work here, because a phase is not a distance and there is no
 * tolerance to be inside of - it either matches at every sample or it does not.
 */
const LIVE_SAMPLES = [
  { t: 0.4, phase: 'respawning', dead: true },
  { t: 0.8, phase: 'respawning', dead: true },
  { t: 1.2, phase: 'respawning', dead: true },
  { t: 1.6, phase: 'respawning', dead: true },
  { t: 2.0, phase: 'invulnerable', dead: false },
  { t: 2.4, phase: 'invulnerable', dead: false },
  { t: 2.8, phase: 'invulnerable', dead: false },
  { t: 3.2, phase: 'invulnerable', dead: false },
] as const;

const RESPAWN_DELAY = 2;

const unit = (over: Partial<Unit> = {}): Unit => ({
  id: 'a',
  kind: 'champion',
  team: 'ally',
  pos: { x: 0, y: 0 },
  hp: 0,
  maxHp: 100,
  ad: 10,
  armor: 0,
  attackRange: 100,
  attackSpeed: 1,
  moveSpeed: 66,
  attackCdRemaining: 0,
  dead: true,
  ...over,
});

describe('advanceLives against a real match', () => {
  it('reproduces the phase sequence the scene produced', () => {
    const state: WorldState = {
      tick: 0,
      simTime: 0,
      units: [unit()],
      cooldowns: { a: { Q: 0, W: 0, E: 0, R: 0 } },
      effects: { a: createEffectState() },
      lives: { a: { phase: 'dead', diedAt: 0, respawnsAt: RESPAWN_DELAY, invulnerableUntil: null } },
      pendingImpacts: [],
      nextInsertionOrder: 0,
      passives: { counters: {}, deadlines: {} },
      recalls: {},
      teamFacts: { ally: { championKills: 0, objectivePoints: 0 }, enemy: { championKills: 0, objectivePoints: 0 } },
      outcome: { kind: 'ongoing' },
      resources: {},
      autoAttackers: [],
      targets: {},
      minions: [],
      waves: { spawnedWaves: 0, pending: [], nextOrder: 0 },
      structures: {},
      economy: {},
      moveGoals: {},
    };

    const observed: { t: number; phase: string; dead: boolean }[] = [];
    for (const sample of LIVE_SAMPLES) {
      // Step the clock to the sample time the way a tick would, then advance.
      advanceEffects(state, Number((sample.t - state.simTime).toFixed(4)));
      advanceLives(state, 'conquest');
      observed.push({
        t: Number(state.simTime.toFixed(2)),
        phase: state.lives.a.phase,
        dead: state.units[0].dead,
      });
    }

    expect(observed).toEqual(
      LIVE_SAMPLES.map((s) => ({ t: s.t, phase: s.phase, dead: s.dead })),
    );
  });

  it('flips to present exactly at the deadline, not a sample later', () => {
    // The boundary is where an off-by-one would hide: sampling every 400 ms would not
    // notice a phase that changes 100 ms late. Check the tick either side of it.
    const build = (simTime: number): WorldState => ({
      tick: 0,
      simTime,
      units: [unit()],
      cooldowns: { a: { Q: 0, W: 0, E: 0, R: 0 } },
      effects: { a: createEffectState() },
      lives: { a: { phase: 'dead', diedAt: 0, respawnsAt: RESPAWN_DELAY, invulnerableUntil: null } },
      pendingImpacts: [],
      nextInsertionOrder: 0,
      passives: { counters: {}, deadlines: {} },
      recalls: {},
      teamFacts: { ally: { championKills: 0, objectivePoints: 0 }, enemy: { championKills: 0, objectivePoints: 0 } },
      outcome: { kind: 'ongoing' },
      resources: {},
      autoAttackers: [],
      targets: {},
      minions: [],
      waves: { spawnedWaves: 0, pending: [], nextOrder: 0 },
      structures: {},
      economy: {},
      moveGoals: {},
    });

    const just_before = build(RESPAWN_DELAY - 0.001);
    advanceLives(just_before);
    expect(just_before.units[0].dead).toBe(true);

    const exactly_on = build(RESPAWN_DELAY);
    advanceLives(exactly_on);
    expect(exactly_on.units[0].dead, 'the deadline itself counts as respawned').toBe(false);
  });
});
