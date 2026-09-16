import type { NetMessage, PeerLink } from '@open-games/shared';
import type { Champion } from '../data/champions';
import {
  agreeRoster,
  ROSTER_AGREEMENT_VERSION,
  rosterDigest,
  type RosterAgreement,
  type RosterProposal,
} from './roster';

/**
 * Run the roster agreement across a live link.
 *
 * {@link agreeRoster} decides; this delivers. The split is deliberate — the decision is a pure function of two proposals
 * and is tested as one, while everything that can go wrong on a wire (a proposal arriving twice, arriving before the
 * local side has sent its own, arriving malformed) is handled here.
 *
 * Both peers run the SAME code with no host/guest distinction. There is no request/response: each side announces its
 * proposal as soon as the channel is up and resolves as soon as it holds both. A handshake with a designated asker would
 * need one peer to know it was the asker, which is a fact about the connection that the agreement deliberately refuses to
 * depend on.
 */

/** Wire form. Versioned separately from the agreement so a shape change is detectable before it is parsed. */
interface RosterEnvelope {
  kind: 'roster-proposal';
  version: number;
  proposal: RosterProposal;
}

export interface RosterHandshakeOptions {
  link: PeerLink<never>;
  /** This peer's stable id. Also the canonical tiebreak, so it must differ from the remote's. */
  participantId: string;
  championId: string;
  mode: RosterProposal['mode'];
  roster: readonly Champion[];
  /**
   * This peer's seed nonce.
   *
   * Injected rather than generated here so a test is deterministic and so the caller can decide where its randomness
   * comes from. A caller with nothing better should use `crypto.getRandomValues`.
   */
  seedContribution: string;
  /** How long to wait for the peer's proposal before giving up. */
  timeoutMs?: number;
  /**
   * How often to re-announce this peer's proposal while waiting.
   *
   * Not decoration — announcing ONCE does not work. Both peers announce as soon as their channel is up, so whichever
   * gets there first sends into a peer that has not attached its handler yet and that announcement is simply gone. The
   * first version of this module did exactly that and one side reliably timed out while the other agreed, which is the
   * worst shape of failure available: one peer walks into a match alone. Re-announcing costs a few hundred bytes and
   * removes the race entirely, and `PeerLink` already promises nothing about delivery, so a protocol that needed a
   * single send to land was wrong on its own terms.
   */
  announceIntervalMs?: number;
}

export type RosterHandshakeResult =
  | { kind: 'agreed'; agreement: Extract<RosterAgreement, { kind: 'agreed' }> }
  | { kind: 'refused'; reason: string }
  | { kind: 'timeout' }
  /** The peer sent something this build cannot parse as a proposal. */
  | { kind: 'unreadable' };

const DEFAULT_TIMEOUT_MS = 15000;
/** Fast enough that a human never notices the wait, slow enough to be negligible traffic. */
const DEFAULT_ANNOUNCE_INTERVAL_MS = 250;

/**
 * Announce this peer's proposal, wait for the other, and return the agreement.
 *
 * Idempotent against a repeated remote proposal: the FIRST readable one wins and later copies are dropped. A link may
 * duplicate or reorder — `PeerLink` promises nothing about delivery — and re-running the agreement on a second copy
 * would be harmless today but would silently pick a different result the moment a peer were allowed to revise a pick.
 */
export function runRosterHandshake(options: RosterHandshakeOptions): Promise<RosterHandshakeResult> {
  const { link, participantId, championId, mode, roster, seedContribution } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const local: RosterProposal = {
    version: ROSTER_AGREEMENT_VERSION,
    participantId,
    championId,
    seedContribution,
    mode,
    rosterDigest: rosterDigest(roster),
  };

  return new Promise((resolve) => {
    let settled = false;
    /**
     * Declared before `finish` rather than at first use.
     *
     * A synchronous link delivers the peer's answer DURING the opening `announce()`, which is before a `const announcer`
     * further down would be initialised — so `finish` reaching for it threw "cannot access before initialization" and the
     * handshake failed on exactly the transport a test can drive. `clearInterval(undefined)` is a no-op, so the optional
     * type is the whole fix.
     */
    let announcer: ReturnType<typeof setInterval> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: RosterHandshakeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(announcer);
      resolve(result);
    };
    timer = setTimeout(() => finish({ kind: 'timeout' }), timeoutMs);

    const envelope: RosterEnvelope = {
      kind: 'roster-proposal',
      version: ROSTER_AGREEMENT_VERSION,
      proposal: local,
    };
    const announce = () => link.send({ type: 'lobby', payload: JSON.stringify(envelope) });

    link.onMessage((message: NetMessage<never>) => {
      if (settled || message.type !== 'lobby') return;
      const remote = parseEnvelope(message.payload);
      if (!remote) {
        finish({ kind: 'unreadable' });
        return;
      }
      // Our own announcement echoed back by a transport that reflects, rather than the peer's.
      if (remote.participantId === participantId) return;

      /**
       * Settle FIRST, then answer with our own proposal exactly once.
       *
       * Two defects sit either side of this ordering and the test that drives both peers through one wire found both.
       *
       * Answering is necessary: both peers announce as soon as their channel is up, so whichever gets there first sends
       * into a peer that has not attached its handler yet, and that announcement is gone. The peer that hears settles,
       * which stops its re-announce loop, and the peer that spoke first waits out its timeout while its partner treats
       * the match as agreed — one player walking into a match alone.
       *
       * Answering BEFORE settling is worse: `settled` is still false when the answer comes back, so each side replies to
       * every reply. On a synchronous link that is immediate stack exhaustion; on a real data channel it is a message
       * storm that never stops. Settling first makes the handler ignore the answer, so exactly one reply is sent.
       */
      const agreement = agreeRoster(local, remote, roster);
      finish(
        agreement.kind === 'agreed'
          ? { kind: 'agreed', agreement }
          : { kind: 'refused', reason: agreement.reason },
      );
      announce();
    });

    // Registered first, announced second: a handler attached after the first send would miss a reply that arrived at once.
    announce();
    announcer = setInterval(() => {
      if (settled) clearInterval(announcer);
      else announce();
    }, options.announceIntervalMs ?? DEFAULT_ANNOUNCE_INTERVAL_MS);

  });
}

/**
 * Parse a proposal off the wire, returning null for anything that is not one.
 *
 * Every field is checked. A partially-validated proposal is worse than a rejected one: a missing `seedContribution`
 * would sail through `agreeRoster`'s emptiness check as `undefined` and derive a seed containing the string
 * "undefined" on one side only.
 */
function parseEnvelope(payload: string): RosterProposal | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const envelope = parsed as Partial<RosterEnvelope>;
  if (envelope.kind !== 'roster-proposal') return null;
  const proposal = envelope.proposal;
  if (!proposal || typeof proposal !== 'object') return null;
  const isString = (value: unknown): value is string => typeof value === 'string';
  if (
    typeof proposal.version !== 'number' ||
    !isString(proposal.participantId) ||
    !isString(proposal.championId) ||
    !isString(proposal.seedContribution) ||
    !isString(proposal.rosterDigest) ||
    (proposal.mode !== 'conquest' && proposal.mode !== 'midline')
  ) {
    return null;
  }
  return proposal;
}
