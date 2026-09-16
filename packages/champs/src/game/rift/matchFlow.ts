import type { GoldState } from './economy';

/**
 * Match flow: recall channels, the team facts a result is computed from, and whether the match is over.
 *
 * Three small things that belong together because they are all read to decide whether play continues.
 */

/* -------------------------------------------------------------------------- */
/* Recall                                                                      */
/* -------------------------------------------------------------------------- */

/** Seconds a recall channel takes before it teleports. */
export const RECALL_SECONDS = 6;

/**
 * When each participant's recall began, in absolute sim time, or null when not recalling.
 *
 * Absolute rather than a remaining duration, which is the whole reason this is rewindable: `elapsed - startedAt >= 6`
 * reaches the same verdict at whatever time a replay lands on, where a counter ticking down to zero cannot be rewound
 * without also knowing how many ticks were undone.
 */
export type RecallTable = Record<string, number | null>;

export interface RecallResult {
  recalls: RecallTable;
  /** Participants whose channel completed on this tick, so the caller can move them. */
  completed: string[];
}

/** Advance every recall channel. Pure: the table goes in, a new table and the completions come out. */
export function advanceRecalls(recalls: RecallTable, now: number): RecallResult {
  const next: RecallTable = {};
  const completed: string[] = [];
  for (const [id, startedAt] of Object.entries(recalls)) {
    if (startedAt !== null && now - startedAt >= RECALL_SECONDS) {
      completed.push(id);
      next[id] = null;
    } else {
      next[id] = startedAt;
    }
  }
  return { recalls: next, completed };
}

export function beginRecall(recalls: RecallTable, id: string, now: number): RecallTable {
  return { ...recalls, [id]: now };
}

/**
 * Cancel a recall.
 *
 * Idempotent, because the scene cancels on several unrelated events — taking damage, attacking, moving — and a cancel
 * that threw or double-counted on the second call would make the order of those events matter.
 */
export function cancelRecall(recalls: RecallTable, id: string): RecallTable {
  return { ...recalls, [id]: null };
}

/* -------------------------------------------------------------------------- */
/* Team facts                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What a match result is scored from, per team.
 *
 * In the snapshot because `resolveMatch` reads it to decide whether the game is over, and two peers that disagree about
 * it disagree about whether anyone has won.
 *
 * `gold` is deliberately NOT a field here — see teamGold below.
 *
 * `epicMonstersKilled` was added when BattleScene's adoption reached this type and found the scene keeping its OWN
 * four-field `TeamFacts` interface under the same name. It is not derivable from `objectivePoints`, which weights its
 * kills (dragon 1, herald 2, baron 3), so two teams with the same points can have killed different numbers of monsters.
 * It also drives the end-of-match summary, so it is authority rather than presentation.
 */
export interface TeamFacts {
  championKills: number;
  objectivePoints: number;
  epicMonstersKilled: number;
}

export interface TeamFactsTable {
  ally: TeamFacts;
  enemy: TeamFacts;
}

export function createTeamFacts(): TeamFactsTable {
  return {
    ally: { championKills: 0, objectivePoints: 0, epicMonstersKilled: 0 },
    enemy: { championKills: 0, objectivePoints: 0, epicMonstersKilled: 0 },
  };
}

export function cloneTeamFacts(facts: TeamFactsTable): TeamFactsTable {
  return { ally: { ...facts.ally }, enemy: { ...facts.enemy } };
}

/**
 * A team's earned gold, DERIVED from its participants rather than accumulated alongside them.
 *
 * The scene keeps a separate running total per team and adds to it every time a participant earns. That is correct
 * TODAY, and the distinction matters: BattleScene has no rollback wired into it, so nothing ever replays a tick there
 * and the two figures cannot drift. It is a trap laid for the moment the rollback does become the authority — a replay
 * of twenty ticks would add that gold to the team total twenty times while each participant's own total was correctly
 * restored, and the team figure would climb on every rollback with nothing to reconcile it.
 *
 * Deriving it removes the possibility rather than correcting for it: there is no second accumulator to fall out of step,
 * because the sum is recomputed from state that IS rewound. Cheap too — a handful of additions once per resolution
 * check, not per tick. The scene is deliberately left alone, because changing an authority that is currently correct
 * buys nothing and risks something.
 */
export function teamGold(
  economy: Record<string, GoldState>,
  participantsOnTeam: readonly string[],
): number {
  let total = 0;
  for (const id of participantsOnTeam) total += economy[id]?.totalEarned ?? 0;
  return total;
}

/* -------------------------------------------------------------------------- */
/* Outcome                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Whether the match is decided.
 *
 * IN the snapshot, for the reason Gridfall's outcome is: the step READS it to stop advancing, so two peers who disagree
 * about whether the match is over disagree about whether anyone may still act. Ringout's round TALLY is the opposite
 * case and is deliberately outside its state, because nothing in that simulation reads it.
 */
export type MatchOutcome =
  | { kind: 'ongoing' }
  | { kind: 'decided'; winner: 'ally' | 'enemy' | 'draw'; reason: string };

export function ongoing(): MatchOutcome {
  return { kind: 'ongoing' };
}

export function isDecided(outcome: MatchOutcome): boolean {
  return outcome.kind !== 'ongoing';
}
