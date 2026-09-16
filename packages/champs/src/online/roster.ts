import type { Champion } from '../data/champions';
import type { GameMode } from '../game/battleStore';
import type { MapSide } from '../game/rift/map';

/**
 * Champion-roster agreement: how two peers arrive at ONE team composition.
 *
 * The gap this closes is not "the lobby has no UI". It is that `composeTeams` is ASYMMETRIC — its second argument is the
 * ally pick and its third is the enemy pick — while each peer naturally thinks of ITSELF as the human. Wire two peers up
 * without an agreement and each calls
 *
 *     composeTeams(roster, myPick, theirPick, lanes, seed)
 *
 * with its own arguments, so the two sides build DIFFERENT ten-champion matchups from the same connection and every
 * subsequent tick is computed against a different world. No amount of rollback repairs that: rollback reconciles
 * divergent INPUT, not divergent setup, and the mismatch would surface as an unexplained desync on the first exchange.
 *
 * So this module's whole job is to turn two independent proposals into one CANONICAL set of composition inputs that both
 * peers compute identically, plus a note of which side each participant drives. "Which side am I" is a rendering and
 * input concern; it must not reach `composeTeams`.
 *
 * Pure and transport-free on purpose: it decides, it does not send. The data channel that carries a proposal belongs to
 * the connect flow, and champs has no networked path wired yet — this is the prerequisite that path needs, testable now.
 */

/**
 * Bumped when the shape of a proposal or the derivation of the seed changes.
 *
 * Separate from the match protocol version in protocol.ts: that one governs commands and events during a match, this one
 * governs the handshake before it. A peer on an older agreement version would derive a different seed from the same
 * nonces and desync silently, which is exactly what a version check is for.
 */
export const ROSTER_AGREEMENT_VERSION = 1 as const;

/** What one peer offers. Plain data — it crosses a data channel as JSON. */
export interface RosterProposal {
  version: number;
  /** Stable identifier for this peer, and the canonical tiebreak. Must be unique across the two. */
  participantId: string;
  /** The champion this peer wants to play. */
  championId: string;
  /**
   * This peer's contribution to the shared seed.
   *
   * Both contributions are mixed so neither side alone chooses the matchup. This is NOT a fairness guarantee: the peer
   * that sends second has seen the first contribution and can search for one that yields a seed it likes. Closing that
   * needs commit-reveal (exchange hashes, then the values), which is real work for a local-network game between two
   * people who can see each other. Recorded rather than implied.
   */
  seedContribution: string;
  /** Fixes the active lanes, so both peers must be starting the same mode. */
  mode: GameMode;
  /** {@link rosterDigest} of the champion data this peer holds. */
  rosterDigest: string;
}

export type RosterRefusalReason =
  | 'version-mismatch'
  | 'mode-mismatch'
  /** The two peers' champion data differs, so any composition would diverge. Caught BEFORE the match, not during it. */
  | 'roster-digest-mismatch'
  /** Both proposals carry the same participantId, so there is no canonical order to derive. */
  | 'duplicate-participant'
  | 'unknown-champion'
  | 'empty-seed-contribution';

export interface RosterRefused {
  kind: 'refused';
  reason: RosterRefusalReason;
}

export interface RosterAgreed {
  kind: 'agreed';
  /** Pass to `composeTeams` as-is, on BOTH peers. */
  seed: string;
  allyPickId: string;
  enemyPickId: string;
  mode: GameMode;
  /** Which side each participant drives. Local concern — never a composition input. */
  sides: Record<string, MapSide>;
  /**
   * Both peers named the same champion.
   *
   * `composeTeams` already resolves this deterministically — the ally side keeps the pick and the enemy side falls back
   * to a distinct champion of the same role — so the match is playable. It is surfaced because the resolution is
   * ASYMMETRIC: one peer silently stops playing the champion it chose. A lobby that does not tell them has lied to them.
   */
  duplicatePick: boolean;
}

export type RosterAgreement = RosterAgreed | RosterRefused;

/**
 * Agree a roster from two proposals.
 *
 * Order-independent by construction: the two proposals are sorted by `participantId` and every output is derived from
 * that order, never from which argument arrived first. That property is the whole point — the two peers call this with
 * their arguments in opposite orders, and a result that depended on argument order would put them in different matches
 * while looking perfectly successful.
 *
 * The LOWER participantId takes the ally side. An arbitrary rule, but it must be a rule rather than "whoever is the
 * host", because the host is a property of the connection and both peers must be able to derive the sides without
 * knowing anything about how the channel was established.
 */
export function agreeRoster(
  a: RosterProposal,
  b: RosterProposal,
  roster: readonly Champion[],
): RosterAgreement {
  if (a.version !== ROSTER_AGREEMENT_VERSION || b.version !== ROSTER_AGREEMENT_VERSION) {
    return { kind: 'refused', reason: 'version-mismatch' };
  }
  if (a.participantId === b.participantId) {
    return { kind: 'refused', reason: 'duplicate-participant' };
  }
  if (a.mode !== b.mode) return { kind: 'refused', reason: 'mode-mismatch' };
  if (a.rosterDigest !== b.rosterDigest) {
    return { kind: 'refused', reason: 'roster-digest-mismatch' };
  }
  if (!a.seedContribution || !b.seedContribution) {
    return { kind: 'refused', reason: 'empty-seed-contribution' };
  }
  const known = new Set(roster.map((champion) => champion.id));
  if (!known.has(a.championId) || !known.has(b.championId)) {
    return { kind: 'refused', reason: 'unknown-champion' };
  }

  const [first, second] = [a, b].sort((left, right) =>
    left.participantId.localeCompare(right.participantId),
  );

  return {
    kind: 'agreed',
    /**
     * Concatenated in canonical order rather than XORed or summed.
     *
     * A commutative mix would be order-independent too, but it throws information away in ways that matter here: XOR of
     * two equal contributions is zero, and a sum collides for any pair with the same total. Sorting first means the
     * derivation needs no algebraic property at all, so it stays right if the contribution format ever changes.
     */
    seed: `${first.seedContribution}:${second.seedContribution}`,
    allyPickId: first.championId,
    enemyPickId: second.championId,
    mode: first.mode,
    sides: { [first.participantId]: 'ally', [second.participantId]: 'enemy' },
    duplicatePick: first.championId === second.championId,
  };
}

/**
 * A stable digest of the champion data a peer holds.
 *
 * Two peers on different builds would compose different teams from identical picks, and the divergence would look like a
 * netcode bug rather than a version skew. Comparing digests in the handshake turns that into one refusal before the
 * match starts.
 *
 * Serialised by an explicit recursive key sort, NOT `JSON.stringify` on the champion objects: stringify preserves
 * insertion order, so two builds that construct the same champion with its fields written in a different order would
 * produce different digests for identical data — a false mismatch that refuses a perfectly good match.
 */
export function rosterDigest(roster: readonly Champion[]): string {
  const canonical = [...roster]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(stableSerialize)
    .join('|');
  return fnv1a32(canonical);
}

/** Deterministic serialisation: object keys sorted at every level, arrays kept in order. */
function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, inner]) => `${JSON.stringify(key)}:${stableSerialize(inner)}`);
  return `{${entries.join(',')}}`;
}

/**
 * FNV-1a, 32-bit, as eight lowercase hex digits.
 *
 * Not a cryptographic hash and not used as one: this detects an accidental version skew between two cooperating peers,
 * where any change to the data must change the digest. A peer that WANTS to lie about its roster can already lie about
 * its picks, so collision resistance would buy nothing here.
 */
function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // The FNV prime, via Math.imul so the multiply stays a 32-bit integer operation instead of losing precision past 2^53.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
