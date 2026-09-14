import type { Simulation } from '@open-games/shared';

import {
  cloneFightState,
  createFightState,
  NEUTRAL_INPUT,
  type FightInput,
  type FightState,
} from './fightState';
import { stepFight } from './stepFight';

/**
 * The fighter as a rollback simulation.
 *
 * This is where phase 6 pays for itself. champs' adapter is honest but partial — its structures,
 * minion waves and gold never left the scene, so a rollback there is correct about champion combat
 * and silent about the rest. Here the state IS the world, so the equality test can compare the whole
 * object rather than a list of fields somebody remembered to check. A field added later is covered
 * automatically instead of quietly escaping the assertion.
 *
 * `predict` repeats the last input, which is right for a fighter for a specific reason: buttons are
 * held. A player walking forward is still holding forward next tick, so repeating is usually correct
 * and, when it is wrong, wrong for only the few ticks until the truth arrives.
 */
export function createFightSimulation(
  ids: readonly [string, string],
): Simulation<FightState, FightInput> {
  return {
    initial: () => createFightState(ids),
    step: (state, inputs, tick) => stepFight(state, inputs, tick),
    clone: cloneFightState,
    predict: (_participantId, lastKnown) => (lastKnown ? { ...lastKnown } : NEUTRAL_INPUT),
  };
}

/**
 * A hash for the netcode's divergence check.
 *
 * Every field of the simulation goes in, and nothing else does, because a hash over a render value
 * would report a desync between two peers who agree about the match while a hash that omits a
 * simulation field would miss a real one. Since the state is complete, "every field" is a short
 * list rather than a judgement call.
 *
 * Numbers are rounded to a fixed number of decimals before hashing. Two machines can differ in the
 * last bit of a float without having diverged in any way a player could observe, and a check that
 * fires on that trains people to ignore it.
 */
export function hashFightState(state: FightState): string {
  const round = (value: number) => value.toFixed(4);
  const fighters = state.fighters
    .map((f) =>
      [
        f.id,
        f.side,
        round(f.x),
        round(f.y),
        round(f.vx),
        round(f.vy),
        f.facing,
        round(f.hp),
        f.stance,
        f.stanceUntil,
        f.attack ?? '-',
        f.attackConnected ? '1' : '0',
        f.combo,
      ].join(','),
    )
    .join(';');
  const outcome =
    state.outcome.kind === 'ko' || state.outcome.kind === 'ringout'
      ? `${state.outcome.kind}:${state.outcome.winner}`
      : state.outcome.kind;
  return `${state.tick}|${fighters}|${outcome}`;
}
