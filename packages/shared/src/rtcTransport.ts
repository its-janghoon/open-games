import type { NetMessage, PeerLink } from './netcode';

/**
 * A real network transport: an RTCDataChannel between two machines, with NO server of any kind.
 *
 * This exists because the catalogue already claimed it. Both new games' summaries said two people on the same
 * network could play with no server between them, and that was FALSE: the only transport was a BroadcastChannel,
 * which reaches other contexts of one browser on one machine, and Ringout had no transport at all. A shipped promise
 * the code cannot keep is worse than a smaller promise, so this closes the gap rather than the sentence.
 *
 * ## No ICE servers, deliberately
 *
 * `iceServers` is empty, so the only candidates gathered are HOST candidates — this machine's own interface
 * addresses. That is not a limitation worked around; it is the exact shape of the claim. Host candidates let two
 * machines on ONE local network reach each other directly, and they need no STUN, no TURN and no third-party request
 * of any kind. A public STUN server would be a request to someone else's infrastructure on every match, which this
 * project's self-hosting gates exist to prevent and which a metered-data player would pay for.
 *
 * The honest consequence, stated rather than glossed: this connects two peers on the same LAN. It does NOT traverse
 * NAT to the open internet, because that is what STUN and TURN are for. "Same network" is the whole claim.
 *
 * ## No signalling server, either
 *
 * WebRTC needs the two peers to exchange a description before a channel exists, and that exchange normally goes
 * through a server. Here it is a code the players pass to each other by whatever means they already have — the same
 * shape as this repo's ghost codes, which encode a policy into a pasteable string rather than storing it anywhere.
 *
 * ICE is NON-TRICKLE for that reason: gathering is allowed to finish before the code is produced, so the code is
 * self-contained. Trickle ICE sends candidates as they are discovered, which needs a live channel to send them
 * over — precisely the thing that does not exist yet.
 */

/** Which side of the handshake this peer is on. Named for what it does, not for authority — neither side is server. */
export type RtcSide = 'offerer' | 'answerer';

export interface RtcSignal {
  /** Session description type, mirroring RTCSdpType for the two values this uses. */
  type: 'offer' | 'answer';
  sdp: string;
}

/** True when this browser can do a data channel at all. */
export function rtcAvailable(): boolean {
  return typeof RTCPeerConnection === 'function';
}

/* -------------------------------------------------------------------------- */
/* Signal codes                                                                */
/* -------------------------------------------------------------------------- */

const MAGIC = 'OG1';

// btoa/atob rather than Buffer: they are standard in the browser AND present in Node, so the same code path runs in
// both and the tests exercise exactly what ships. Buffer would have needed @types/node, which is not installable here.
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Turn a session description into a code a player can send to the other player.
 *
 * Gzipped before base64 because an SDP is extremely repetitive text and a code someone has to copy should be as
 * short as the format allows. The SDP is carried WHOLE rather than reduced to its interesting fields and rebuilt on
 * the far side: reconstructing an SDP is the same class of hazard as hand-rolling a font parser — format-sensitive,
 * browser-version-sensitive, and wrong in ways that are hard to see. Here the cost of being conservative is a longer
 * string, which is a cost the user pays once per match.
 */
export async function encodeSignal(signal: RtcSignal): Promise<string> {
  const payload = new TextEncoder().encode(JSON.stringify(signal));
  return `${MAGIC}:${toBase64(await gzip(payload))}`;
}

/** Read a code back. Throws with a readable reason, because a mistyped code is the expected failure here. */
export async function decodeSignal(code: string): Promise<RtcSignal> {
  const trimmed = code.trim().replace(/\s+/g, '');
  if (!trimmed.startsWith(`${MAGIC}:`)) {
    throw new Error(`not an Open Games connection code (expected it to start with ${MAGIC}:)`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(await gunzip(fromBase64(trimmed.slice(MAGIC.length + 1)))));
  } catch {
    throw new Error('this connection code is damaged — copy the whole thing and try again');
  }
  const signal = parsed as RtcSignal;
  if (!signal || (signal.type !== 'offer' && signal.type !== 'answer') || typeof signal.sdp !== 'string') {
    throw new Error('this connection code does not describe a connection');
  }
  return signal;
}

/* -------------------------------------------------------------------------- */
/* The link                                                                    */
/* -------------------------------------------------------------------------- */

export interface RtcTransport<Input> {
  link: PeerLink<Input>;
  /** Resolves once the data channel is open in both directions. */
  ready: Promise<void>;
  /** Fires if the channel closes or fails after being established. */
  onLost(callback: (reason: string) => void): void;
  close(): void;
}

const CHANNEL_LABEL = 'open-games';

/**
 * Wait for ICE gathering to finish so the description is self-contained.
 *
 * Bounded, because gathering can legitimately never report complete on some setups and a match must not hang on it.
 * On timeout the description is used AS IT STANDS — a partial candidate set can still connect if it contains a usable
 * host candidate, and failing outright would refuse connections that would have worked.
 */
function gatheringComplete(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

export interface RtcOptions {
  /** How long to let ICE gather before producing a code. */
  gatherTimeoutMs?: number;
  /**
   * Factory for the connection, so a test can supply a stub.
   *
   * There is no way to exercise a real data channel in Node — RTCPeerConnection does not exist there — so the seam is
   * here rather than nowhere. The real thing is verified in a browser instead, with both peers in one page.
   */
  createConnection?: () => RTCPeerConnection;
}

function newConnection(options: RtcOptions): RTCPeerConnection {
  if (options.createConnection) return options.createConnection();
  // Empty iceServers is the point: host candidates only, no third-party request.
  return new RTCPeerConnection({ iceServers: [] });
}

function wrapChannel<Input>(channel: RTCDataChannel): PeerLink<Input> {
  const handlers: ((message: NetMessage<Input>) => void)[] = [];
  channel.addEventListener('message', (event: MessageEvent) => {
    let parsed: NetMessage<Input>;
    try {
      parsed = JSON.parse(String(event.data)) as NetMessage<Input>;
    } catch {
      // A corrupt frame is dropped rather than thrown: PeerLink promises nothing about delivery, and the rollback
      // session already tolerates missing inputs by predicting them.
      return;
    }
    for (const handler of handlers) handler(parsed);
  });
  return {
    send(message) {
      // Guarded because send() throws on a channel that has closed, and a closing channel during a match is normal.
      if (channel.readyState !== 'open') return;
      try {
        channel.send(JSON.stringify(message));
      } catch {
        // Dropped, per the PeerLink contract.
      }
    },
    onMessage(handler) {
      handlers.push(handler);
    },
  };
}

/** Shared plumbing for both sides: a link over the channel, plus liveness reporting. */
function transportFor<Input>(
  pc: RTCPeerConnection,
  channelPromise: Promise<RTCDataChannel>,
): RtcTransport<Input> {
  const lostHandlers: ((reason: string) => void)[] = [];
  let established = false;

  const announceLost = (reason: string) => {
    if (!established) return;
    established = false;
    for (const handler of lostHandlers) handler(reason);
  };
  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'failed') announceLost('the connection failed');
    else if (pc.connectionState === 'disconnected') announceLost('the other player dropped off the network');
    else if (pc.connectionState === 'closed') announceLost('the connection closed');
  });

  /**
   * Handlers registered before the channel exists are held here and attached when it opens.
   *
   * Needed because a scene wires up onMessage during setup, which happens well before a player has pasted a code.
   * Dropping those handlers would mean a connection that establishes correctly and then delivers nothing.
   */
  const pending: ((message: NetMessage<Input>) => void)[] = [];
  let realLink: PeerLink<Input> | null = null;

  const ready = channelPromise.then((channel) => {
    realLink = wrapChannel<Input>(channel);
    for (const handler of pending) realLink.onMessage(handler);
    pending.length = 0;
    established = true;
    channel.addEventListener('close', () => announceLost('the data channel closed'));
  });

  const facade: PeerLink<Input> = {
    send(message) {
      realLink?.send(message);
    },
    onMessage(handler) {
      if (realLink) realLink.onMessage(handler);
      else pending.push(handler);
    },
  };

  return {
    link: facade,
    ready,
    onLost(callback) {
      lostHandlers.push(callback);
    },
    close() {
      try {
        pc.close();
      } catch {
        // Closing an already-closed connection is not an error worth surfacing.
      }
    },
  };
}

/** Wait for a data channel to reach `open`. */
function channelOpen(channel: RTCDataChannel): Promise<RTCDataChannel> {
  if (channel.readyState === 'open') return Promise.resolve(channel);
  return new Promise((resolve, reject) => {
    channel.addEventListener('open', () => resolve(channel));
    channel.addEventListener('error', () => reject(new Error('the data channel failed to open')));
  });
}

export interface OfferResult<Input> {
  /** The code to hand to the other player. */
  code: string;
  transport: RtcTransport<Input>;
  /** Feed the answer code back in to finish the handshake. */
  accept(answerCode: string): Promise<void>;
}

/** Start a match: produce an offer code, then accept the answer code that comes back. */
export async function createOffer<Input>(options: RtcOptions = {}): Promise<OfferResult<Input>> {
  const pc = newConnection(options);
  // The offerer creates the channel; the answerer receives it via ondatachannel.
  const channel = pc.createDataChannel(CHANNEL_LABEL, {
    // Inputs are tiny, ordered-by-tick already, and a late input is useless — so an unreliable, unordered channel
    // suits them better than TCP-like guarantees. The rollback session re-requests nothing and predicts what is
    // missing, which is exactly the behaviour an unordered channel needs from its consumer.
    ordered: false,
    maxRetransmits: 0,
  });
  const transport = transportFor<Input>(pc, channelOpen(channel));

  await pc.setLocalDescription(await pc.createOffer());
  await gatheringComplete(pc, options.gatherTimeoutMs ?? 3000);
  const local = pc.localDescription;
  if (!local) throw new Error('the browser produced no offer');

  return {
    code: await encodeSignal({ type: 'offer', sdp: local.sdp }),
    transport,
    async accept(answerCode: string) {
      const signal = await decodeSignal(answerCode);
      if (signal.type !== 'answer') throw new Error('that is an offer code, not an answer code');
      await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
    },
  };
}

export interface AnswerResult<Input> {
  /** The code to hand back to the player who started the match. */
  code: string;
  transport: RtcTransport<Input>;
}

/** Join a match: take the offer code, produce an answer code. */
export async function createAnswer<Input>(
  offerCode: string,
  options: RtcOptions = {},
): Promise<AnswerResult<Input>> {
  const signal = await decodeSignal(offerCode);
  if (signal.type !== 'offer') throw new Error('that is an answer code, not an offer code');

  const pc = newConnection(options);
  const incoming = new Promise<RTCDataChannel>((resolve) => {
    pc.addEventListener('datachannel', (event: RTCDataChannelEvent) => {
      void channelOpen(event.channel).then(resolve);
    });
  });
  const transport = transportFor<Input>(pc, incoming);

  await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  await gatheringComplete(pc, options.gatherTimeoutMs ?? 3000);
  const local = pc.localDescription;
  if (!local) throw new Error('the browser produced no answer');

  return { code: await encodeSignal({ type: 'answer', sdp: local.sdp }), transport };
}

/**
 * Which side plays which participant.
 *
 * Fixed by the handshake rather than negotiated, because unlike the BroadcastChannel transport there is no symmetry to
 * break: exactly one peer produces the offer. That transport needed an id comparison precisely because both tabs were
 * identical and first-come left both as p2.
 */
export function participantFor(side: RtcSide): 'p1' | 'p2' {
  return side === 'offerer' ? 'p1' : 'p2';
}
