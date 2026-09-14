import { describe, it, expect } from 'vitest';

import {
  ATTACK_COMMIT_RANGE,
  GhostRecorder,
  LATERAL_TOLERANCE,
  MAX_OBSERVATIONS,
  intentForCommand,
  slotForAbility,
  type CommandContext,
} from './ghostRecorder';
import { MIN_OBSERVATIONS, learnGhost, type GhostObservation } from './ghost';
import { CHAMPIONS } from '../data/champions';
import type { AiSnapshot } from './ai';
import type { MatchCommand } from '../online/protocol';

const base = {
  protocolVersion: 1,
  matchId: 'm',
  participantId: 'p',
  commandId: 'c',
  sequence: 1,
  tick: 1,
} as unknown as MatchCommand;

const move = (x: number, y: number): MatchCommand =>
  ({ ...base, type: 'move', destination: { x, y } }) as MatchCommand;
const cast = (abilityId: string): MatchCommand =>
  ({ ...base, type: 'cast', abilityId, target: { kind: 'self' } }) as MatchCommand;

const ctx = (over: Partial<CommandContext> = {}): CommandContext => ({
  self: { x: 0, y: 0 },
  nearestEnemy: { x: 1000, y: 0 },
  attackRange: 250,
  ...over,
});

describe('intentForCommand', () => {
  it('reads a move that closes the gap as approach', () => {
    expect(intentForCommand(move(400, 0), ctx())).toBe('approach');
  });

  it('reads a move that opens the gap as retreat', () => {
    expect(intentForCommand(move(-400, 0), ctx())).toBe('retreat');
  });

  it('reads a move onto a reachable target as committing to attack', () => {
    // Already within two attack ranges, moving to inside one.
    const context = ctx({ self: { x: 700, y: 0 }, nearestEnemy: { x: 1000, y: 0 } });
    expect(intentForCommand(move(900, 0), context)).toBe('attack');
    expect(ATTACK_COMMIT_RANGE).toBeGreaterThan(1);
  });

  it('ignores a lateral move, which expresses no opinion about fighting', () => {
    // Sideways: the distance to the enemy barely changes. Dodging, pathing, or
    // grabbing something - reading it as approach would invent an intent.
    const sideways = intentForCommand(move(0, LATERAL_TOLERANCE / 2), ctx());
    expect(sideways).toBeNull();
  });

  it('ignores every move when there is nobody to fight', () => {
    expect(intentForCommand(move(500, 0), ctx({ nearestEnemy: null }))).toBeNull();
  });

  it('ignores shopping and surrendering', () => {
    const purchase = { ...base, type: 'purchase', itemId: 'x' } as MatchCommand;
    const surrender = { ...base, type: 'surrender' } as MatchCommand;
    expect(intentForCommand(purchase, ctx())).toBeNull();
    expect(intentForCommand(surrender, ctx())).toBeNull();
  });

  it('maps an ability to its own slot, not to a generic cast', () => {
    // Which ability someone reaches for is most of what distinguishes them, so the
    // slot has to survive the mapping.
    const champion = CHAMPIONS[0];
    const actives = champion.abilities.filter((a) => a.slot !== 'P');
    expect(actives.length).toBeGreaterThan(0);
    for (const ability of actives) {
      expect(intentForCommand(cast(`${champion.id}.${ability.slot}`), ctx())).toBe(
        `cast${ability.slot}`,
      );
      // A bare slot is accepted too, for the common unambiguous case.
      expect(intentForCommand(cast(ability.slot), ctx())).toBe(`cast${ability.slot}`);
    }
  });

  it('refuses an id that names no active ability instead of guessing a slot', () => {
    // An earlier version matched on an `id` field Ability does not have, so every
    // input returned the first ability in the table. A wrong slot is worse than none:
    // it teaches the ghost a preference the player never expressed.
    expect(slotForAbility('ashborne.P')).toBeNull();
    expect(slotForAbility('not-a-champion.Q')).toBeNull();
    expect(slotForAbility('not-an-ability')).toBeNull();
    expect(slotForAbility('')).toBeNull();
    expect(slotForAbility('X')).toBeNull();
    expect(intentForCommand(cast('not-an-ability'), ctx())).toBeNull();
  });
});

describe('GhostRecorder', () => {
  it('keeps the most recent observations and drops the oldest', () => {
    // Recent play describes how someone plays NOW - they learn during a match.
    const recorder = new GhostRecorder<number>(4);
    for (let i = 0; i < 10; i += 1) recorder.record(i);
    expect(recorder.size).toBe(4);
    expect(recorder.observations()).toEqual([6, 7, 8, 9]);
  });

  it('is bounded by default, so a long match cannot grow memory without limit', () => {
    const recorder = new GhostRecorder<number>();
    for (let i = 0; i < MAX_OBSERVATIONS * 3; i += 1) recorder.record(i);
    expect(recorder.size).toBe(MAX_OBSERVATIONS);
  });

  it('resets', () => {
    const recorder = new GhostRecorder<number>();
    recorder.record(1);
    recorder.reset();
    expect(recorder.size).toBe(0);
  });
});

describe('recording end to end', () => {
  const snapshot = (over: Partial<AiSnapshot> = {}): AiSnapshot => ({
    selfHpPct: 0.9,
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

  it('turns a scripted timid player into a ghost that prefers retreating', () => {
    // A player who walks away from winnable fights. The base policy wants to attack a
    // low-hp target in range, so every one of these is a disagreement.
    const recorder = new GhostRecorder<GhostObservation>();
    for (let i = 0; i < MIN_OBSERVATIONS * 2; i += 1) {
      const context = ctx({ self: { x: 900, y: 0 }, nearestEnemy: { x: 1000, y: 0 } });
      const intent = intentForCommand(move(200, 0), context);
      expect(intent).toBe('retreat');
      recorder.record({ snapshot: snapshot({ selfHpPct: 0.85 }), chosen: intent! });
    }
    const ghost = learnGhost([...recorder.observations()]);
    expect(ghost.bias.retreat).toBeGreaterThan(0);
    expect(ghost.retreatHp).toBeCloseTo(0.85, 2);
  });

  it('turns a scripted ability-hungry player into an eager ghost', () => {
    const recorder = new GhostRecorder<GhostObservation>();
    const q = CHAMPIONS[0].abilities.find((a) => a.slot === 'Q');
    expect(q).toBeDefined();
    for (let i = 0; i < MIN_OBSERVATIONS * 2; i += 1) {
      const intent = intentForCommand(cast(`${CHAMPIONS[0].id}.Q`), ctx());
      expect(intent).toBe('castQ');
      recorder.record({ snapshot: snapshot(), chosen: intent! });
    }
    const ghost = learnGhost([...recorder.observations()]);
    expect(ghost.abilityEagerness).toBeGreaterThan(0.9);
  });

  it('learns nothing from a player who only shops and sidesteps', () => {
    // Every command here is deliberately uninformative, so the ghost must stay
    // neutral rather than drifting on noise.
    const recorder = new GhostRecorder<GhostObservation>();
    for (let i = 0; i < MIN_OBSERVATIONS * 2; i += 1) {
      const lateral = intentForCommand(move(0, 10), ctx());
      const shopping = intentForCommand({ ...base, type: 'purchase', itemId: 'x' } as MatchCommand, ctx());
      expect(lateral).toBeNull();
      expect(shopping).toBeNull();
      if (lateral) recorder.record({ snapshot: snapshot(), chosen: lateral });
    }
    expect(recorder.size).toBe(0);
    const ghost = learnGhost([...recorder.observations()]);
    for (const value of Object.values(ghost.bias)) expect(value).toBe(0);
  });
});
