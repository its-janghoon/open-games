import { describe, expect, it } from 'vitest';

import { initialGold, type GoldState } from './economy';
import {
  advanceRecalls,
  beginRecall,
  cancelRecall,
  cloneTeamFacts,
  createTeamFacts,
  isDecided,
  ongoing,
  RECALL_SECONDS,
  teamGold,
  type MatchOutcome,
  type RecallTable,
} from './matchFlow';

describe('recall channels', () => {
  it('does not complete before the channel time', () => {
    const recalls = beginRecall({}, 'p1', 100);
    const result = advanceRecalls(recalls, 100 + RECALL_SECONDS - 0.01);
    expect(result.completed).toEqual([]);
    expect(result.recalls.p1).toBe(100);
  });

  it('completes exactly at the channel time and clears the channel', () => {
    const recalls = beginRecall({}, 'p1', 100);
    const result = advanceRecalls(recalls, 100 + RECALL_SECONDS);
    expect(result.completed).toEqual(['p1']);
    expect(result.recalls.p1).toBeNull();
  });

  it('uses an ABSOLUTE start, so a replay at any time reaches the same verdict', () => {
    /**
     * The reason this is rewindable. A counter ticking down to zero cannot be rewound without also knowing how many
     * ticks were undone; a start time compared against the clock is simply true or not true at whatever moment a replay
     * lands on. Evaluating the same table at two times must give the two answers, with no memory of the order.
     */
    const recalls = beginRecall({}, 'p1', 100);
    expect(advanceRecalls(recalls, 103).completed).toEqual([]);
    expect(advanceRecalls(recalls, 110).completed).toEqual(['p1']);
    // And back again — order of evaluation carries nothing.
    expect(advanceRecalls(recalls, 103).completed).toEqual([]);
  });

  it('cancelling is idempotent', () => {
    // The scene cancels on damage, on attacking and on moving. A cancel that only worked once, or that threw on the
    // second call, would make the ORDER of those unrelated events matter.
    let recalls: RecallTable = beginRecall({}, 'p1', 100);
    recalls = cancelRecall(recalls, 'p1');
    recalls = cancelRecall(recalls, 'p1');
    expect(recalls.p1).toBeNull();
    expect(advanceRecalls(recalls, 999).completed).toEqual([]);
  });

  it('leaves other participants alone', () => {
    let recalls = beginRecall({}, 'p1', 100);
    recalls = beginRecall(recalls, 'p2', 100);
    recalls = cancelRecall(recalls, 'p1');
    expect(advanceRecalls(recalls, 110).completed).toEqual(['p2']);
  });

  it('does not mutate the table it was given', () => {
    const recalls = beginRecall({}, 'p1', 100);
    const before = JSON.stringify(recalls);
    advanceRecalls(recalls, 999);
    cancelRecall(recalls, 'p1');
    expect(JSON.stringify(recalls)).toBe(before);
  });
});

describe('team gold', () => {
  it('sums the participants that are on the team', () => {
    const economy: Record<string, GoldState> = {
      a: { ...initialGold(500), totalEarned: 120 },
      b: { ...initialGold(500), totalEarned: 80 },
      enemy: { ...initialGold(500), totalEarned: 999 },
    };
    expect(teamGold(economy, ['a', 'b'])).toBe(200);
  });

  it('is DERIVED, so it cannot drift from the participants it came from', () => {
    /**
     * The property that makes deriving worth it. Accumulating a team total alongside the participants leaves two
     * numbers that can disagree — and under rollback they would, because a replayed tick adds to the accumulator again
     * while each participant's own total is restored. Recomputing has no second number to fall out of step.
     */
    const economy: Record<string, GoldState> = { a: { ...initialGold(0), totalEarned: 7 } };
    const once = teamGold(economy, ['a']);
    const again = teamGold(economy, ['a']);
    expect(once).toBe(again);
    expect(once).toBe(7);
  });

  it('treats an unknown participant as zero rather than throwing', () => {
    // A participant that has not earned yet simply has no entry, and a resolution check must not fail on that.
    expect(teamGold({}, ['nobody'])).toBe(0);
  });
});

describe('team facts', () => {
  it('starts at zero for both teams', () => {
    const facts = createTeamFacts();
    expect(facts.ally).toEqual({ championKills: 0, objectivePoints: 0, epicMonstersKilled: 0 });
    expect(facts.enemy).toEqual({ championKills: 0, objectivePoints: 0, epicMonstersKilled: 0 });
  });

  it('clones each side independently', () => {
    const original = createTeamFacts();
    const copy = cloneTeamFacts(original);
    copy.ally.championKills = 5;
    expect(original.ally.championKills).toBe(0);
  });
});

describe('outcome', () => {
  it('starts ongoing', () => {
    expect(isDecided(ongoing())).toBe(false);
  });

  it('reports a decided match', () => {
    const decided: MatchOutcome = { kind: 'decided', winner: 'ally', reason: 'nexus-destroyed' };
    expect(isDecided(decided)).toBe(true);
  });

  it('carries a draw as a winner value rather than a separate kind', () => {
    // A draw is a decided match, so code that freezes on `decided` cannot accidentally keep playing one.
    expect(isDecided({ kind: 'decided', winner: 'draw', reason: 'time' })).toBe(true);
  });
});
