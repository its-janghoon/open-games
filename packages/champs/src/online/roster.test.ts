import { describe, it, expect } from 'vitest';
import {
  agreeRoster,
  rosterDigest,
  ROSTER_AGREEMENT_VERSION,
  type RosterProposal,
} from './roster';
import { CHAMPIONS } from '../data/champions';
import { composeTeams } from '../game/rift/teams';
import { LANES } from '../game/rift/map';

function proposal(overrides: Partial<RosterProposal> = {}): RosterProposal {
  return {
    version: ROSTER_AGREEMENT_VERSION,
    participantId: 'peer-a',
    championId: CHAMPIONS[0].id,
    seedContribution: 'aaaa1111',
    mode: 'conquest',
    rosterDigest: rosterDigest(CHAMPIONS),
    ...overrides,
  };
}

const host = proposal({ participantId: 'peer-a', championId: CHAMPIONS[0].id, seedContribution: 'aaaa1111' });
const guest = proposal({ participantId: 'peer-b', championId: CHAMPIONS[1].id, seedContribution: 'bbbb2222' });

describe('roster agreement', () => {
  /**
   * The property the module exists for.
   *
   * Both peers call this with their arguments in OPPOSITE orders — each holds its own proposal first. A result that
   * depended on argument order would put the two peers in different matches while reporting success on both.
   */
  it('is independent of the order the two proposals are supplied in', () => {
    expect(agreeRoster(host, guest, CHAMPIONS)).toEqual(agreeRoster(guest, host, CHAMPIONS));
  });

  it('gives the lower participantId the ally side, without consulting who hosted', () => {
    const agreement = agreeRoster(guest, host, CHAMPIONS);
    if (agreement.kind !== 'agreed') throw new Error(agreement.reason);
    expect(agreement.sides).toEqual({ 'peer-a': 'ally', 'peer-b': 'enemy' });
    expect(agreement.allyPickId).toBe(host.championId);
    expect(agreement.enemyPickId).toBe(guest.championId);
  });

  it('mixes both contributions into the seed in canonical order', () => {
    const agreement = agreeRoster(guest, host, CHAMPIONS);
    if (agreement.kind !== 'agreed') throw new Error(agreement.reason);
    expect(agreement.seed).toBe('aaaa1111:bbbb2222');
  });

  it('does not let one peer alone determine the seed', () => {
    const other = agreeRoster(host, proposal({ ...guest, seedContribution: 'cccc3333' }), CHAMPIONS);
    const first = agreeRoster(host, guest, CHAMPIONS);
    if (first.kind !== 'agreed' || other.kind !== 'agreed') throw new Error('expected agreement');
    expect(other.seed).not.toBe(first.seed);
  });

  /**
   * The failure this whole module prevents, asserted end to end.
   *
   * Without an agreement each peer would pass its OWN pick as composeTeams' ally argument, and the two would build
   * different ten-champion matchups from the same connection. Here both derive their arguments from the agreement, so
   * the compositions are identical — which is the precondition rollback needs before it can reconcile anything.
   */
  it('makes both peers compose the SAME ten champions', () => {
    const fromHostView = agreeRoster(host, guest, CHAMPIONS);
    const fromGuestView = agreeRoster(guest, host, CHAMPIONS);
    if (fromHostView.kind !== 'agreed' || fromGuestView.kind !== 'agreed') throw new Error('expected agreement');

    const compose = (a: typeof fromHostView) =>
      composeTeams(CHAMPIONS, a.allyPickId, a.enemyPickId, LANES, a.seed);

    expect(compose(fromHostView)).toEqual(compose(fromGuestView));
  });

  /** And the negative control: the naive per-peer call really does diverge, so the test above is not vacuous. */
  it('diverges when each peer passes its own pick as the ally argument', () => {
    const naiveHost = composeTeams(CHAMPIONS, host.championId, guest.championId, LANES, 'shared-seed');
    const naiveGuest = composeTeams(CHAMPIONS, guest.championId, host.championId, LANES, 'shared-seed');
    expect(naiveHost).not.toEqual(naiveGuest);
  });

  it('reports a duplicate pick rather than silently reassigning one peer champion', () => {
    const agreement = agreeRoster(host, proposal({ ...guest, championId: host.championId }), CHAMPIONS);
    if (agreement.kind !== 'agreed') throw new Error(agreement.reason);
    expect(agreement.duplicatePick).toBe(true);

    // Still playable: composeTeams keeps the ally pick and gives the enemy a distinct champion of that role.
    const composition = composeTeams(CHAMPIONS, agreement.allyPickId, agreement.enemyPickId, LANES, agreement.seed);
    const allyIds = composition.ally.map((slot) => slot.champion.id);
    const enemyIds = composition.enemy.map((slot) => slot.champion.id);
    expect(allyIds).toContain(host.championId);
    expect(allyIds.filter((id) => enemyIds.includes(id))).toEqual([]);
  });

  it('does not flag a duplicate when the picks differ', () => {
    const agreement = agreeRoster(host, guest, CHAMPIONS);
    if (agreement.kind !== 'agreed') throw new Error(agreement.reason);
    expect(agreement.duplicatePick).toBe(false);
  });
});

describe('roster agreement refusals', () => {
  const cases: Array<[string, RosterProposal, RosterProposal, string]> = [
    ['a version skew', proposal({ version: 0 }), guest, 'version-mismatch'],
    ['two peers claiming one id', host, proposal({ participantId: 'peer-a', championId: CHAMPIONS[1].id }), 'duplicate-participant'],
    ['different modes', host, proposal({ ...guest, mode: 'midline' }), 'mode-mismatch'],
    ['different champion data', host, proposal({ ...guest, rosterDigest: 'deadbeef' }), 'roster-digest-mismatch'],
    ['a missing nonce', host, proposal({ ...guest, seedContribution: '' }), 'empty-seed-contribution'],
    ['a champion not in the roster', host, proposal({ ...guest, championId: 'not-a-champion' }), 'unknown-champion'],
  ];

  for (const [name, a, b, reason] of cases) {
    it(`refuses ${name}`, () => {
      expect(agreeRoster(a, b, CHAMPIONS)).toEqual({ kind: 'refused', reason });
      // Refusals must be order-independent too, or one peer would start a match the other refused.
      expect(agreeRoster(b, a, CHAMPIONS)).toEqual({ kind: 'refused', reason });
    });
  }
});

describe('roster digest', () => {
  it('is stable across calls', () => {
    expect(rosterDigest(CHAMPIONS)).toBe(rosterDigest(CHAMPIONS));
  });

  it('ignores the order the roster is held in, so two builds do not falsely mismatch', () => {
    expect(rosterDigest([...CHAMPIONS].reverse())).toBe(rosterDigest(CHAMPIONS));
  });

  /**
   * Insertion order must not matter EITHER, which is why the digest sorts keys instead of calling JSON.stringify: two
   * builds that construct the same champion with its fields written in a different order hold identical data, and
   * refusing that match would be a false negative.
   */
  it('ignores object key insertion order within a champion', () => {
    const [first, ...rest] = CHAMPIONS;
    const reordered = Object.fromEntries(
      Object.entries(first).reverse(),
    ) as unknown as typeof first;
    expect(rosterDigest([reordered, ...rest])).toBe(rosterDigest(CHAMPIONS));
  });

  it('changes when any champion stat changes', () => {
    const [first, ...rest] = CHAMPIONS;
    const buffed = { ...first, stats: { ...first.stats, attackDamage: first.stats.attackDamage + 1 } };
    expect(rosterDigest([buffed, ...rest])).not.toBe(rosterDigest(CHAMPIONS));
  });

  it('changes when a champion is missing', () => {
    expect(rosterDigest(CHAMPIONS.slice(1))).not.toBe(rosterDigest(CHAMPIONS));
  });
});
