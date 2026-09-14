import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NetSession, type NetMessage } from '@open-games/shared';

import { createGridSimulation, hashGridWorld } from '../game/gridSimulation';
import { NEUTRAL_FPS_INPUT, type FpsInput, type GridWorld } from '../game/gridWorld';
import { openTabTransport, tabTransportAvailable } from './tabTransport';

/**
 * A stand-in for BroadcastChannel, because the two-tab browser check CANNOT be driven from this project's probe
 * harness and that is stated rather than papered over.
 *
 * What was attempted: two real Chrome tabs over the DevTools protocol, both navigated to the built game. Only one
 * tab can be visible, and a hidden tab throttles requestAnimationFrame — so Phaser's loop never runs there, the
 * scene never reaches create(), and the probe found no debug handle at all. Forcing Page.setWebLifecycleState to
 * 'active' did not help, because lifecycle and visibility are different things. Both tabs reported role p1 and
 * networked false.
 *
 * That attempt was not wasted: it found a real bug. The original handshake was first-come, and two tabs opened
 * together both claimed p1, each answered the other, and each stepped down to p2 — neither was p1, so neither
 * ever saw the other's inputs and the match silently never connected. This stub is what tests the id-comparison
 * handshake that replaced it.
 *
 * The stub is faithful to the one property that matters here: a message posted by one channel reaches every OTHER
 * channel on the same name and never the sender. Delivery is asynchronous, as the real one is, so a handshake
 * that only works when messages arrive synchronously would fail.
 */
class FakeBroadcastChannel {
  static registry = new Map<string, FakeBroadcastChannel[]>();
  onmessage: ((event: { data: unknown }) => void) | null = null;
  private closed = false;

  constructor(public readonly name: string) {
    const peers = FakeBroadcastChannel.registry.get(name) ?? [];
    peers.push(this);
    FakeBroadcastChannel.registry.set(name, peers);
  }

  postMessage(data: unknown): void {
    if (this.closed) return;
    const peers = FakeBroadcastChannel.registry.get(this.name) ?? [];
    for (const peer of peers) {
      if (peer === this || peer.closed) continue;
      // Asynchronous, like the real thing. A handshake that depends on synchronous delivery would pass here and
      // fail in a browser.
      setTimeout(() => peer.onmessage?.({ data: structuredClone(data) }), 0);
    }
  }

  close(): void {
    this.closed = true;
    const peers = (FakeBroadcastChannel.registry.get(this.name) ?? []).filter((p) => p !== this);
    FakeBroadcastChannel.registry.set(this.name, peers);
  }

  /**
   * Close every channel, whoever opened it.
   *
   * Needed because clearing the registry is not enough: a transport left open by a failing test keeps its
   * handler, and that handler POSTS a reply, whose postMessage looks the registry up fresh — so it injects a
   * handshake into the next test's channels. That produced a genuine false failure here, where a test asserting a
   * lone tab stays p1 got p2 from a ghost.
   */
  static closeAll(): void {
    for (const peers of FakeBroadcastChannel.registry.values()) {
      for (const peer of [...peers]) peer.close();
    }
    FakeBroadcastChannel.registry.clear();
  }
}

const original = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;

beforeEach(() => {
  FakeBroadcastChannel.registry.clear();
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = FakeBroadcastChannel;
});

afterEach(() => {
  FakeBroadcastChannel.closeAll();
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = original;
});

const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the tab transport', () => {
  it('reports availability from the platform rather than assuming it', () => {
    expect(tabTransportAvailable()).toBe(true);
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
    expect(tabTransportAvailable()).toBe(false);
  });

  it('gives two tabs DISTINCT roles', async () => {
    /**
     * The regression. First-come assignment gave both tabs p2 — measured with two real Chrome tabs, which each
     * reported role p1 / networked false because neither ended up being the peer the other was waiting for.
     * Comparing ids is total, so both tabs compute the same winner from the same pair with no round in which
     * they disagree.
     */
    const a = openTabTransport(500);
    const b = openTabTransport(500);
    const roles = await Promise.all([a.role, b.role]);
    expect(new Set(roles).size, `both tabs took ${roles.join(' and ')}`).toBe(2);
    expect(roles).toContain('p1');
    expect(roles).toContain('p2');
    a.close();
    b.close();
  });

  it('gives the same answer whichever tab opens first', async () => {
    // Order-independent by construction, since the decision is a comparison of two ids rather than a race.
    const first = openTabTransport(500);
    await settle(5);
    const second = openTabTransport(500);
    const roles = await Promise.all([first.role, second.role]);
    expect(new Set(roles).size).toBe(2);
    first.close();
    second.close();
  });

  it('leaves a lone tab as p1 and never reports a peer', async () => {
    // The single-tab case must not hang waiting for someone who will never arrive: a lone player wants the
    // shared-keyboard game immediately.
    const alone = openTabTransport(40);
    let peers = 0;
    alone.onPeer(() => {
      peers += 1;
    });
    expect(await alone.role).toBe('p1');
    await settle(60);
    expect(peers, 'a lone tab must not think it has a peer').toBe(0);
    alone.close();
  });

  it('signals a peer to BOTH tabs, including the one that resolves on a timeout', async () => {
    // p1's role resolves on a timeout, which is also what happens when it is alone — so without a separate peer
    // signal a lone tab would start a networked match against nobody.
    const a = openTabTransport(500);
    const b = openTabTransport(500);
    const seen: string[] = [];
    a.onPeer(() => seen.push('a'));
    b.onPeer(() => seen.push('b'));
    await Promise.all([a.role, b.role]);
    await settle(20);
    expect(seen.sort()).toEqual(['a', 'b']);
    a.close();
    b.close();
  });

  it('carries netcode messages between the tabs and not back to the sender', async () => {
    const a = openTabTransport(500);
    const b = openTabTransport(500);
    await Promise.all([a.role, b.role]);

    const atA: NetMessage<FpsInput>[] = [];
    const atB: NetMessage<FpsInput>[] = [];
    a.link.onMessage((m) => atA.push(m));
    b.link.onMessage((m) => atB.push(m));

    a.link.send({ type: 'input', tick: 3, participantId: 'p1', input: NEUTRAL_FPS_INPUT });
    await settle(20);
    expect(atB, 'the peer must receive it').toHaveLength(1);
    expect(atA, 'the sender must not').toHaveLength(0);
    a.close();
    b.close();
  });

  it('drives two real NetSessions to the same world over the channel', async () => {
    /**
     * The end-to-end claim, verified over an asynchronous channel with two independently-simulating sessions —
     * separate predictions, real rollbacks, checksum comparison. The only part this does not exercise is the
     * wire itself, and that is the honest limit of what could be tested here.
     */
    const a = openTabTransport(500);
    const b = openTabTransport(500);
    const [roleA, roleB] = await Promise.all([a.role, b.role]);

    const desyncs: number[] = [];
    const make = (role: string, link: typeof a.link) =>
      new NetSession<GridWorld, FpsInput>({
        sim: createGridSimulation(['p1', 'p2']),
        participants: ['p1', 'p2'],
        localParticipant: role,
        link,
        hashState: hashGridWorld,
        checksumInterval: 20,
        maxRollbackTicks: 300,
        onDesync: (report) => desyncs.push(report.tick),
      });
    const sessionA = make(roleA, a.link);
    const sessionB = make(roleB, b.link);

    const forward: FpsInput = { ...NEUTRAL_FPS_INPUT, forward: true };
    const turning: FpsInput = { ...NEUTRAL_FPS_INPUT, turnRight: true, forward: true };
    for (let tick = 0; tick < 90; tick += 1) {
      sessionA.advance(tick % 5 === 0 ? turning : forward);
      sessionB.advance(tick % 7 === 0 ? turning : forward);
      // Let the channel drain periodically rather than every tick, so most remote inputs land against ticks that
      // were already simulated from a prediction — the condition rollback exists for.
      if (tick % 6 === 5) await settle(5);
    }
    await settle(60);

    expect(hashGridWorld(sessionA.peek())).toBe(hashGridWorld(sessionB.peek()));
    expect(desyncs, 'agreeing sessions must not report a fault').toEqual([]);
    a.close();
    b.close();
  });

  it('stops answering once closed, so a stale tab cannot negotiate against a ghost', async () => {
    const gone = openTabTransport(500);
    gone.close();
    const fresh = openTabTransport(40);
    let peers = 0;
    fresh.onPeer(() => {
      peers += 1;
    });
    expect(await fresh.role).toBe('p1');
    await settle(60);
    expect(peers).toBe(0);
    fresh.close();
  });
});
