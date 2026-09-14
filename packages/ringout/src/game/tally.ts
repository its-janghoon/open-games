import type { Outcome } from '../game/fightState';

/**
 * The running score across rounds.
 *
 * Deliberately NOT part of FightState, and that is the important decision in this file. FightState is
 * the rollback snapshot: every field in it is something two peers must agree on tick by tick, and every
 * field costs a clone on every snapshot. A win tally is neither — it changes once a round, it is never
 * rewound, and nothing in the simulation reads it. Putting it in the state would make the score a thing
 * a desync could corrupt, for no benefit at all.
 *
 * Kept as a pure reducer rather than a mutable object on the scene so the rules for what counts as a
 * win are testable without a browser, and so a rematch cannot accidentally award a point twice by
 * being called from two places.
 */
export interface Tally {
  left: number;
  right: number;
  rounds: number;
}

export const EMPTY_TALLY: Tally = { left: 0, right: 0, rounds: 0 };

/**
 * Fold a finished round into the tally.
 *
 * An `ongoing` outcome returns the tally UNCHANGED rather than throwing. The scene checks the outcome
 * every frame, so this is called with 'ongoing' far more often than not; making that an error would push
 * the guard into the caller, where it would eventually be forgotten.
 *
 * A draw increments `rounds` without awarding anything, because a round that happened is a round that
 * happened — a rematch counter that skipped draws would disagree with the number of fights the players
 * remember having.
 */
export function recordRound(tally: Tally, outcome: Outcome, ids: readonly [string, string]): Tally {
  if (outcome.kind === 'ongoing') return tally;
  const next: Tally = { ...tally, rounds: tally.rounds + 1 };
  if (outcome.kind === 'draw') return next;
  if (outcome.winner === ids[0]) return { ...next, left: next.left + 1 };
  if (outcome.winner === ids[1]) return { ...next, right: next.right + 1 };
  // An unknown winner id awards nothing. Silently crediting the wrong side would be worse than a
  // scoreline that visibly fails to move.
  return next;
}
