import { RollbackSession, type Simulation } from './rollback';

/**
 * Input-only netcode over an abstract link.
 *
 * "Input-only" is the whole design: peers exchange the inputs they pressed and nothing else, and
 * each reconstructs the world by simulating. Nobody sends positions or health. That is what makes
 * a peer-to-peer game affordable to host - the messages are a few bytes a tick and there is no
 * server holding the truth - and it is also what makes it fragile, because two peers that
 * simulate the same inputs differently drift apart with nothing to correct them.
 *
 * So this layer carries a second kind of message whose only job is to NOTICE that. See
 * ChecksumMessage.
 *
 * There is deliberately no socket in this file. A WebRTC data channel, a WebSocket, a
 * BroadcastChannel between two tabs and a pair of in-process queues are all the same shape from
 * here, and the last of those is what the tests use - two real peers wired to each other, with no
 * network and no mocks of the thing being tested.
 */

/** One participant's input for one tick, as it travels. */
export interface InputMessage<Input> {
  type: 'input';
  tick: number;
  participantId: string;
  input: Input;
}

/**
 * A periodic agreement check.
 *
 * This exists to DETECT divergence, not to repair it, and the distinction is deliberate. Repair
 * would mean shipping world state, which abandons input-only and hands one peer authority over
 * another. Detection is honest: it turns a silent drift - where two players each see a coherent
 * match and disagree about who won - into a reported fault the game can act on.
 *
 * The hash covers a CONFIRMED tick only. Hashing a predicted tick would report a desync every time
 * two peers held different guesses about an input that had not arrived yet, which is normal
 * operation rather than a fault.
 */
export interface ChecksumMessage {
  type: 'checksum';
  tick: number;
  hash: string;
}

/**
 * Anything two peers must agree on BEFORE the match runs, carried as an opaque string.
 *
 * The session neither reads nor produces these — it ignores them — because pre-match negotiation is the game's business,
 * not the netcode's. What the netcode contributes is the channel: a game that needs to agree a roster, a map or a rule set
 * should not have to open a second connection to do it, and gridfall had already grown its own `handshake` envelope
 * outside this union for exactly that reason.
 *
 * Opaque on purpose. A typed payload would put every game's lobby vocabulary in shared, where a change to one game's
 * negotiation would recompile the others.
 */
export interface LobbyMessage {
  type: 'lobby';
  payload: string;
}

export type NetMessage<Input> = InputMessage<Input> | ChecksumMessage | LobbyMessage;

/**
 * The link. Send a message to the peer; be handed messages the peer sent.
 *
 * `send` may drop, delay or reorder - the rollback session already refuses inputs that are too old
 * and ignores ones it has already seen, so this interface promises nothing about delivery.
 */
export interface PeerLink<Input> {
  send(message: NetMessage<Input>): void;
  onMessage(handler: (message: NetMessage<Input>) => void): void;
}

export interface DesyncReport {
  tick: number;
  localHash: string;
  remoteHash: string;
}

export interface NetSessionOptions<State, Input> {
  sim: Simulation<State, Input>;
  participants: readonly string[];
  /** Which participant this peer plays. Its inputs are sent; the others' are received. */
  localParticipant: string;
  link: PeerLink<Input>;
  /**
   * Turn a state into a comparable string. Required rather than defaulted: only the game knows
   * which of its fields are simulation truth and which are presentation, and hashing a render
   * field would report a desync between two peers that agree about the match.
   */
  hashState(state: State): string;
  /** Ticks between checksum messages. */
  checksumInterval?: number;
  snapshotInterval?: number;
  maxRollbackTicks?: number;
  /** Called when a peer's checksum disagrees with ours for the same tick. */
  onDesync?(report: DesyncReport): void;
}

export const DEFAULT_CHECKSUM_INTERVAL = 30;

/**
 * Drives one peer: feeds received inputs into a RollbackSession, emits the local input each tick,
 * and compares checksums when they arrive.
 */
export class NetSession<State, Input> {
  private readonly session: RollbackSession<State, Input>;
  private readonly link: PeerLink<Input>;
  private readonly localParticipant: string;
  private readonly hashState: (state: State) => string;
  private readonly checksumInterval: number;
  private readonly onDesync?: (report: DesyncReport) => void;

  /**
   * Our own hash per checksummed tick, kept because a peer's checksum can arrive before OR after we
   * reach that tick. Storing both sides and comparing whenever the pair completes avoids a race
   * where an early-arriving checksum is silently dropped and a real desync goes unreported.
   */
  private readonly localHashes = new Map<number, string>();
  /** Earliest tick at which the next checksum may be taken. Advances only when one is actually sent. */
  private nextChecksumAt: number;
  private readonly remoteHashes = new Map<number, string>();
  private readonly reported = new Set<number>();

  private lastLocalInput: Input | undefined;

  /**
   * Per remote participant, the tick up to which their inputs have arrived CONTIGUOUSLY.
   *
   * Contiguous rather than highest-seen, because a gap matters: receiving ticks 1 and 3 does not
   * confirm tick 2, and treating it as confirmed would let a checksum be taken over a state that
   * still contains a prediction - which is how a checksum reports a desync during ordinary packet
   * loss and trains everyone to ignore the alarm.
   */
  private readonly remoteCursor = new Map<string, number>();
  private readonly remoteSeen = new Map<string, Set<number>>();

  constructor(options: NetSessionOptions<State, Input>) {
    this.link = options.link;
    this.localParticipant = options.localParticipant;
    this.hashState = options.hashState;
    this.checksumInterval = options.checksumInterval ?? DEFAULT_CHECKSUM_INTERVAL;
    this.nextChecksumAt = this.checksumInterval;
    this.onDesync = options.onDesync;
    this.session = new RollbackSession(options.sim, {
      participants: options.participants,
      snapshotInterval: options.snapshotInterval,
      maxRollbackTicks: options.maxRollbackTicks,
    });
    for (const id of options.participants) {
      if (id === options.localParticipant) continue;
      this.remoteCursor.set(id, 0);
      this.remoteSeen.set(id, new Set());
    }

    this.link.onMessage((message) => this.receive(message));
  }

  /** The current state. Predicted for any tick whose inputs have not all arrived. */
  peek(): State {
    return this.session.peek();
  }

  get tick(): number {
    return this.session.stats().tick;
  }

  /**
   * Advance one tick with the local input, sending it to the peer.
   *
   * The input is sent even when it is identical to the last one. Sending only changes would halve
   * the traffic and cost the peer its ability to tell "still holding the same key" from "packet
   * lost", which is exactly the ambiguity that makes a prediction wrong for longer than it needs
   * to be.
   */
  advance(input: Input): void {
    const at = this.session.stats().tick;
    this.lastLocalInput = input;
    this.session.setLocalInput(this.localParticipant, input);
    this.link.send({ type: 'input', tick: at, participantId: this.localParticipant, input });
    this.session.advanceTo(at + 1);
    this.maybeChecksum();
  }

  /** The last input this peer sent, for a caller that wants to re-send it after a reconnect. */
  get lastSentInput(): Input | undefined {
    return this.lastLocalInput;
  }

  /**
   * The tick up to which this peer's view is settled: every remote input for every earlier tick has
   * arrived. Reported for diagnostics; the checksum does not gate on it, for the reason below.
   */
  get confirmedThrough(): number {
    let confirmed = this.session.stats().tick;
    for (const cursor of this.remoteCursor.values()) confirmed = Math.min(confirmed, cursor);
    return confirmed;
  }

  private maybeChecksum(): void {
    const tick = this.session.stats().tick;
    if (tick === 0 || tick < this.nextChecksumAt) return;
    /**
     * Hash the CURRENT state, but only on a tick that is already fully confirmed — every remote input for every
     * earlier tick has arrived, so this state used no predictions and two correct peers necessarily agree.
     *
     * Two earlier mechanisms failed, both measured:
     *
     *   - Hashing at every interval multiple and comparing immediately reported a desync at tick 80 between two
     *     sessions that then agreed completely. Both hashes were honest hashes of PARTLY PREDICTED states: each
     *     side had the other's inputs only to about tick 74 and filled the rest with its own guesses.
     *   - Buffering the hash until its tick became confirmed looked right and exchanged nothing at all. A
     *     rollback arriving in the same delivery batch invalidates the buffered hash — correctly, since the
     *     replay rewrote that tick — and because that happens on essentially every interval, no checksum ever
     *     left the session and a genuinely drifting peer went unreported. The full test suite caught it.
     *
     * Waiting for a tick where the local state needs no prediction avoids both: nothing is held, so nothing can
     * be invalidated while held, and nothing predicted is ever compared. Under sustained lag the check simply
     * goes quiet, which is the right failure — a periodic check that pauses is useful, one that cries wolf while
     * packets are late is worse than none.
     */
    if (tick > this.confirmedThrough) return;
    this.nextChecksumAt = tick + this.checksumInterval;
    const hash = this.hashState(this.session.peek());
    this.localHashes.set(tick, hash);
    this.link.send({ type: 'checksum', tick, hash });
    this.compare(tick);
  }

  private receive(message: NetMessage<Input>): void {
    if (message.type === 'input') {
      // A peer's own input for a participant we do not own. Rejections are the session's business:
      // an input that is too old has no snapshot left to rewind to, and applying it to the wrong
      // base would desync quietly - the exact thing this layer exists to avoid.
      if (message.participantId === this.localParticipant) return;
      const result = this.session.applyRemoteInput(
        message.participantId,
        message.tick,
        message.input,
      );
      this.noteReceived(message.participantId, message.tick);
      // A replay rewrote every tick from here on, so any hash we cached for those ticks describes a
      // state that no longer happened. Discard them instead of comparing them: a stale hash is
      // indistinguishable from a real disagreement, and reporting one would be a false alarm during
      // ordinary late-packet handling.
      if (result.accepted && result.resimulated > 0) this.invalidateFrom(message.tick);
      // An arriving input moves the confirmed horizon, which is what can make a due checksum takeable.
      this.maybeChecksum();
      return;
    }
    /**
     * Dispatched explicitly rather than by falling through to "everything else is a checksum".
     *
     * That fall-through was safe while the union had two members and is a trap now it has three: a lobby message read as
     * a checksum would cache `undefined` under tick `undefined` and could report a desync against a hash that was never
     * sent. Ignoring an unknown message is the correct behaviour for a peer on a newer protocol, so this also stops a
     * future member breaking an older build in the worst possible way.
     */
    if (message.type !== 'checksum') return;
    this.remoteHashes.set(message.tick, message.hash);
    this.compare(message.tick);
  }

  /**
   * Forget cached hashes at or after `tick`, on both sides of the comparison.
   *
   * This is what makes the check trustworthy without needing to store past states. A hash SURVIVES
   * only if no rollback ever touched its tick - which is exactly the condition under which that
   * tick's state was never a prediction that got corrected. Gating on a "confirmed" horizon instead
   * was tried and does not work: confirmation always trails the current tick by at least one, so an
   * interval checksum never coincides with it and no checksum is ever sent. Measured: with that
   * gate, zero checksums fired across ten ticks and a genuine divergence went unreported.
   */
  private invalidateFrom(tick: number): void {
    for (const at of [...this.localHashes.keys()]) if (at >= tick) this.localHashes.delete(at);
    for (const at of [...this.remoteHashes.keys()]) if (at >= tick) this.remoteHashes.delete(at);

  }

  private noteReceived(participantId: string, tick: number): void {
    const seen = this.remoteSeen.get(participantId);
    if (!seen) return;
    seen.add(tick);
    let cursor = this.remoteCursor.get(participantId) ?? 0;
    while (seen.has(cursor)) {
      seen.delete(cursor);
      cursor += 1;
    }
    this.remoteCursor.set(participantId, cursor);
  }

  private compare(tick: number): void {
    if (this.reported.has(tick)) return;
    const localHash = this.localHashes.get(tick);
    const remoteHash = this.remoteHashes.get(tick);
    if (localHash === undefined || remoteHash === undefined) return;
    if (localHash === remoteHash) return;
    this.reported.add(tick);
    this.onDesync?.({ tick, localHash, remoteHash });
  }
}

/**
 * Two links wired to each other, for tests and for two tabs on one machine.
 *
 * `deliver` is manual on purpose. An automatic link would make every test implicitly synchronous
 * and hide the case that matters - an input arriving several ticks after the tick it belongs to -
 * which is the only reason rollback exists.
 */
export function createLinkPair<Input>(): {
  a: PeerLink<Input>;
  b: PeerLink<Input>;
  deliver(): void;
  pending(): number;
} {
  const toA: NetMessage<Input>[] = [];
  const toB: NetMessage<Input>[] = [];
  let handlerA: ((m: NetMessage<Input>) => void) | undefined;
  let handlerB: ((m: NetMessage<Input>) => void) | undefined;

  return {
    a: {
      send: (message) => toB.push(message),
      onMessage: (handler) => {
        handlerA = handler;
      },
    },
    b: {
      send: (message) => toA.push(message),
      onMessage: (handler) => {
        handlerB = handler;
      },
    },
    deliver(): void {
      // Drained into local arrays first: a handler can send while being called, and appending to
      // the array being iterated would deliver this round's replies in the same round.
      const forA = toA.splice(0, toA.length);
      const forB = toB.splice(0, toB.length);
      for (const message of forA) handlerA?.(message);
      for (const message of forB) handlerB?.(message);
    },
    pending: () => toA.length + toB.length,
  };
}
