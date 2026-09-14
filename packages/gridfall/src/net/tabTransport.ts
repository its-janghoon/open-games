import type { NetMessage, PeerLink } from '@open-games/shared';

import type { FpsInput } from '../game/gridWorld';

/**
 * The local-network transport: a BroadcastChannel between browser tabs.
 *
 * This is what makes phase 7's "local network" claim real rather than asserted, and it is deliberately the
 * smallest thing that can be. BroadcastChannel needs no server, no signalling, no permission prompt and no
 * third-party request — which matters because a zero-third-party-request gate is one of this project's build
 * gates, and a WebRTC data channel would normally reach a STUN server to establish itself.
 *
 * It covers two tabs on ONE machine rather than two machines on one LAN. That is a real limit and is stated
 * rather than glossed: it exercises the whole input-only netcode path — separate simulations, separate
 * predictions, real rollbacks, checksum comparison — over a genuine asynchronous channel, and the only part it
 * does not exercise is the wire itself. Swapping in WebRTC later is a change to this file alone, because
 * PeerLink is the seam and nothing concrete leaks into packages/shared.
 *
 * Role assignment is decided by comparing per-tab ids, not by who spoke first. First-come was the original
 * design and it is broken in the ordinary case: two tabs opened together both claim p1, each hears the other's
 * claim while still holding p1, each answers "I already hold p1", and each then steps down to p2. Neither is p1,
 * so neither ever receives the other's inputs and the match silently never connects — measured with two real
 * tabs, which reported role p1 / networked false on both sides.
 *
 * Comparing ids is total and needs no rounds: the lower id is p1, both tabs compute the same answer from the
 * same pair, and there is no window in which they disagree. The id is random, so a collision is possible in
 * principle and costs a failed handshake rather than a corrupt match.
 */

export type Role = 'p1' | 'p2';

/** Messages the transport itself exchanges, distinct from the netcode's own. */
type HandshakeMessage = { type: 'hello'; id: string };

type Envelope = { kind: 'net'; body: NetMessage<FpsInput> } | { kind: 'handshake'; body: HandshakeMessage };

export interface TabTransport {
  link: PeerLink<FpsInput>;
  /** Resolves with the role this tab should play once the handshake settles. */
  role: Promise<Role>;
  /**
   * Fires once a peer is CONFIRMED to exist, which is not the same as the role settling.
   *
   * p2's role resolves because it heard from p1, so a peer is certain. p1's resolves on a TIMEOUT, which is
   * exactly what also happens when it is alone — so p1 cannot tell the two apart at that moment. Without this
   * signal a single tab would start a networked session against a peer that never arrives and predict its
   * inputs as idle forever, quietly losing the shared-keyboard game that a lone player actually wants.
   */
  onPeer(callback: () => void): void;
  close(): void;
}

/** True when this browser can do the tab-to-tab transport at all. */
export function tabTransportAvailable(): boolean {
  return typeof BroadcastChannel === 'function';
}

export const CHANNEL_NAME = 'gridfall:match';

/**
 * Open the channel and negotiate a role.
 *
 * The handshake is one round: announce a claim on p1, and if another tab answers that it already holds p1,
 * become p2. A tab that hears nothing within the timeout keeps p1 and plays on — which is the case where a
 * player opened one tab and simply wants the local two-player game, so it must not hang waiting for a peer
 * that will never arrive.
 */
export function openTabTransport(timeoutMs = 400): TabTransport {
  const channel = new BroadcastChannel(CHANNEL_NAME);
  let handler: ((message: NetMessage<FpsInput>) => void) | undefined;
  let settled = false;
  let peerSeen = false;
  let onPeer: (() => void) | undefined;
  // Random per tab, and the whole tie-break rests on it. Both tabs see the same pair of ids and pick the same
  // winner, so there is no round in which they disagree about who is p1.
  const myId = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

  const notePeer = () => {
    if (peerSeen) return;
    peerSeen = true;
    onPeer?.();
  };

  const rolePromise = new Promise<Role>((resolve) => {
    const settle = (value: Role) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    channel.onmessage = (event: MessageEvent<Envelope>) => {
      const envelope = event.data;
      if (!envelope || typeof envelope !== 'object') return;
      if (envelope.kind === 'handshake') {
        const theirId = envelope.body.id;
        if (theirId === myId) return;
        notePeer();
        // Answer so a tab that opened first also learns about this one. Guarded by the id check above, so this
        // cannot bounce forever between two tabs.
        channel.postMessage({ kind: 'handshake', body: { type: 'hello', id: myId } } satisfies Envelope);
        settle(myId < theirId ? 'p1' : 'p2');
        return;
      }
      handler?.(envelope.body);
    };

    channel.postMessage({ kind: 'handshake', body: { type: 'hello', id: myId } } satisfies Envelope);
    // Nothing answered, so this tab is alone and plays p1 with a shared keyboard.
    setTimeout(() => settle('p1'), timeoutMs);
  });

  const link: PeerLink<FpsInput> = {
    send(message) {
      channel.postMessage({ kind: 'net', body: message } satisfies Envelope);
    },
    onMessage(next) {
      handler = next;
    },
  };

  return {
    link,
    role: rolePromise,
    onPeer(callback) {
      onPeer = callback;
      // Fire immediately if the peer was already seen, so a late subscriber is not left waiting for an event
      // that has already happened.
      if (peerSeen) callback();
    },
    close: () => channel.close(),
  };
}
