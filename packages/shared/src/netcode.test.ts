import { describe, it, expect } from 'vitest';

import { createLinkPair, NetSession, type DesyncReport, type NetMessage } from './netcode';
import type { Simulation } from './rollback';

/**
 * A deliberately tiny simulation: two counters that move by their input. Small enough that a
 * divergence has exactly one possible cause, which is what makes these tests about the NETCODE
 * rather than about a game.
 */
interface State {
  pos: Record<string, number>;
}
interface Input {
  dx: number;
}

const sim = (bias = 0): Simulation<State, Input> => ({
  initial: () => ({ pos: { a: 0, b: 0 } }),
  step: (state, inputs) => {
    const next: State = { pos: { ...state.pos } };
    for (const [id, input] of inputs) {
      // `bias` is how a second peer is made to simulate DIFFERENTLY, standing in for the real
      // causes - a different build, a float difference, an unordered iteration.
      next.pos[id] = (next.pos[id] ?? 0) + input.dx + bias;
    }
    return next;
  },
  clone: (state) => ({ pos: { ...state.pos } }),
  predict: (_id, lastKnown) => lastKnown ?? { dx: 0 },
});

const hashState = (state: State): string =>
  Object.keys(state.pos)
    .sort()
    .map((id) => `${id}:${state.pos[id]}`)
    .join('|');

function pair(options: { biasB?: number; checksumInterval?: number } = {}) {
  const link = createLinkPair<Input>();
  const desyncsA: DesyncReport[] = [];
  const desyncsB: DesyncReport[] = [];
  const common = {
    participants: ['a', 'b'] as const,
    hashState,
    checksumInterval: options.checksumInterval ?? 5,
    maxRollbackTicks: 120,
  };
  const a = new NetSession<State, Input>({
    ...common,
    sim: sim(0),
    localParticipant: 'a',
    link: link.a,
    onDesync: (report) => desyncsA.push(report),
  });
  const b = new NetSession<State, Input>({
    ...common,
    sim: sim(options.biasB ?? 0),
    localParticipant: 'b',
    link: link.b,
    onDesync: (report) => desyncsB.push(report),
  });
  return { link, a, b, desyncsA, desyncsB };
}

describe('input-only netcode', () => {
  it('two peers exchanging only inputs reach the same state', () => {
    // The claim the whole phase rests on. Nobody sends a position; both reconstruct it.
    const { link, a, b, desyncsA, desyncsB } = pair();
    for (let tick = 0; tick < 20; tick += 1) {
      a.advance({ dx: 1 });
      b.advance({ dx: 3 });
      link.deliver();
    }
    // A last delivery so the final tick's inputs and checksums land on both sides.
    link.deliver();

    expect(hashState(a.peek())).toBe(hashState(b.peek()));
    expect(a.peek().pos).toEqual({ a: 20, b: 60 });
    expect(desyncsA, 'agreeing peers must not report a fault').toEqual([]);
    expect(desyncsB).toEqual([]);
  });

  it('converges even when every message arrives several ticks late', () => {
    // The case rollback exists for. Nothing is delivered until both peers are 12 ticks in, so every
    // remote input arrives against a tick that has already been simulated from a prediction.
    const { link, a, b } = pair();
    for (let tick = 0; tick < 12; tick += 1) {
      a.advance({ dx: 1 });
      b.advance({ dx: 2 });
    }
    expect(link.pending(), 'nothing has been delivered yet').toBeGreaterThan(0);
    link.deliver();
    link.deliver();

    expect(hashState(a.peek())).toBe(hashState(b.peek()));
    expect(a.peek().pos).toEqual({ a: 12, b: 24 });
  });

  it('reports a desync when a peer simulates differently', () => {
    // The point of the checksum. peer b adds a bias, so both peers see a coherent match and disagree
    // about it - the failure this layer must turn from silent into visible.
    const { link, a, b, desyncsA, desyncsB } = pair({ biasB: 1 });
    for (let tick = 0; tick < 10; tick += 1) {
      a.advance({ dx: 1 });
      b.advance({ dx: 1 });
      link.deliver();
    }
    link.deliver();

    expect(desyncsA.length, 'the honest peer must notice too').toBeGreaterThan(0);
    expect(desyncsB.length).toBeGreaterThan(0);
    const first = desyncsA[0];
    expect(first.tick % 5).toBe(0);
    expect(first.localHash).not.toBe(first.remoteHash);
  });

  it('reports a given tick once, not on every later comparison', () => {
    // A desync is usually permanent: once two peers diverge they stay diverged, so a report per
    // tick per peer is information and a repeat is noise that would bury it.
    const { link, a, desyncsA } = pair({ biasB: 1, checksumInterval: 2 });
    for (let tick = 0; tick < 12; tick += 1) {
      a.advance({ dx: 1 });
      link.deliver();
    }
    link.deliver();
    const ticks = desyncsA.map((report) => report.tick);
    expect(new Set(ticks).size, 'no tick reported twice').toBe(ticks.length);
  });

  it('does not report a desync from a merely predicted tick', () => {
    // Checksums are taken at the local tick and compared only when BOTH sides have one for it. While
    // an input is still in flight the two peers legitimately hold different guesses; reporting that
    // would make the alarm fire during normal play and train everyone to ignore it.
    const { link, a, b, desyncsA, desyncsB } = pair({ checksumInterval: 5 });
    for (let tick = 0; tick < 10; tick += 1) {
      a.advance({ dx: 1 });
      b.advance({ dx: 7 });
      // Deliberately no delivery: each peer is predicting the other the whole way.
    }
    expect(desyncsA, 'nothing to compare yet, so nothing to report').toEqual([]);
    expect(desyncsB).toEqual([]);

    link.deliver();
    link.deliver();
    expect(hashState(a.peek())).toBe(hashState(b.peek()));
    expect(desyncsA, 'and once the inputs land the peers agree').toEqual([]);
    expect(desyncsB).toEqual([]);
  });

  it('ignores an echo of a peer\u2019s own input', () => {
    // A broadcast link delivers back to the sender. The echo carries a DIFFERENT value on purpose:
    // with an identical one this test passes even without the guard, because re-applying the same
    // input is a no-op and proves nothing. A conflicting echo is what shows the guard working.
    const link = createLinkPair<Input>();
    const session = new NetSession<State, Input>({
      sim: sim(),
      participants: ['a', 'b'],
      localParticipant: 'a',
      link: link.a,
      hashState,
    });
    session.advance({ dx: 5 });
    const corruptedEcho: NetMessage<Input> = {
      type: 'input',
      tick: 0,
      participantId: 'a',
      input: { dx: 99 },
    };
    link.b.send(corruptedEcho);
    link.deliver();
    expect(session.peek().pos.a, 'our own tick 0 input must not be overwritten').toBe(5);
  });

  it('advances the confirmed horizon contiguously, not to the highest tick seen', () => {
    // confirmedThrough is what a caller uses to say "waiting for peer" honestly. Contiguity is the
    // whole point: receiving ticks 0 and 2 does NOT settle tick 1, and a highest-seen cursor would
    // claim it had.
    const link = createLinkPair<Input>();
    const session = new NetSession<State, Input>({
      sim: sim(),
      participants: ['a', 'b'],
      localParticipant: 'a',
      link: link.a,
      hashState,
      checksumInterval: 1000,
    });
    for (let tick = 0; tick < 5; tick += 1) session.advance({ dx: 1 });

    link.b.send({ type: 'input', tick: 0, participantId: 'b', input: { dx: 1 } });
    link.b.send({ type: 'input', tick: 2, participantId: 'b', input: { dx: 1 } });
    link.deliver();
    expect(session.confirmedThrough, 'tick 1 is still missing').toBe(1);

    link.b.send({ type: 'input', tick: 1, participantId: 'b', input: { dx: 1 } });
    link.deliver();
    expect(session.confirmedThrough, 'the gap closed, so 0..2 are all settled').toBe(3);
  });

  it('sends the local input every tick, even when it has not changed', () => {
    // Change-only would be half the traffic and would cost the peer the ability to tell "still
    // holding the same key" from "packet lost", which is what keeps a wrong prediction alive.
    const sent: NetMessage<Input>[] = [];
    const link: ReturnType<typeof createLinkPair<Input>>['a'] = {
      send: (message) => sent.push(message),
      onMessage: () => {},
    };
    const session = new NetSession<State, Input>({
      sim: sim(),
      participants: ['a', 'b'],
      localParticipant: 'a',
      link,
      hashState,
      checksumInterval: 1000,
    });
    for (let tick = 0; tick < 6; tick += 1) session.advance({ dx: 1 });
    expect(sent.filter((m) => m.type === 'input')).toHaveLength(6);
  });
});
