import { describe, it, expect } from 'vitest';
import type { NetMessage, PeerLink } from '@open-games/shared';
import { runRosterHandshake } from './rosterHandshake';
import { CHAMPIONS } from '../data/champions';
import { composeTeams } from '../game/rift/teams';
import { LANES } from '../game/rift/map';

/**
 * A pair of links joined back to back, with a delivery policy.
 *
 * Not a mock of the RTC transport: it is the same contract `PeerLink` states — send may drop, delay, duplicate or
 * reorder — expressed as something a test can drive. The real data channel is verified in a browser, since
 * RTCPeerConnection does not exist in Node.
 */
function joinedLinks(policy: { duplicate?: boolean; drop?: boolean; corrupt?: boolean } = {}) {
  const handlers: Record<'a' | 'b', ((m: NetMessage<never>) => void)[]> = { a: [], b: [] };
  const deliver = (to: 'a' | 'b', message: NetMessage<never>) => {
    if (policy.drop) return;
    const payload =
      policy.corrupt && message.type === 'lobby' ? { ...message, payload: 'not json at all' } : message;
    for (const handler of handlers[to]) handler(payload as NetMessage<never>);
    if (policy.duplicate) for (const handler of handlers[to]) handler(payload as NetMessage<never>);
  };
  const link = (self: 'a' | 'b', peer: 'a' | 'b'): PeerLink<never> => ({
    send: (message) => deliver(peer, message),
    onMessage: (handler) => handlers[self].push(handler),
  });
  return { a: link('a', 'b'), b: link('b', 'a') };
}

const rosterOf = (championId: string) => ({
  championId,
  mode: 'conquest' as const,
  roster: CHAMPIONS,
  // Small enough that the re-announce lands well inside the window; the announce race is the reason it must.
  announceIntervalMs: 20,
  timeoutMs: 400,
});

describe('roster handshake', () => {
  it('agrees across a link with both peers running the same code', async () => {
    const links = joinedLinks();
    const [fromA, fromB] = await Promise.all([
      runRosterHandshake({ link: links.a, participantId: 'peer-a', seedContribution: 'aaaa', ...rosterOf(CHAMPIONS[0].id) }),
      runRosterHandshake({ link: links.b, participantId: 'peer-b', seedContribution: 'bbbb', ...rosterOf(CHAMPIONS[1].id) }),
    ]);

    if (fromA.kind !== 'agreed' || fromB.kind !== 'agreed') throw new Error('expected both to agree');
    expect(fromA.agreement).toEqual(fromB.agreement);
    expect(fromA.agreement.seed).toBe('aaaa:bbbb');
  });

  /** The point of the whole exercise: after a real exchange, both peers build the same ten champions. */
  it('leaves both peers composing an identical match', async () => {
    const links = joinedLinks();
    const [fromA, fromB] = await Promise.all([
      runRosterHandshake({ link: links.a, participantId: 'peer-a', seedContribution: 'aaaa', ...rosterOf(CHAMPIONS[2].id) }),
      runRosterHandshake({ link: links.b, participantId: 'peer-b', seedContribution: 'bbbb', ...rosterOf(CHAMPIONS[3].id) }),
    ]);
    if (fromA.kind !== 'agreed' || fromB.kind !== 'agreed') throw new Error('expected both to agree');

    const compose = (a: typeof fromA.agreement) =>
      composeTeams(CHAMPIONS, a.allyPickId, a.enemyPickId, LANES, a.seed);
    expect(compose(fromA.agreement)).toEqual(compose(fromB.agreement));
  });

  it('survives a link that duplicates every message', async () => {
    const links = joinedLinks({ duplicate: true });
    const [fromA, fromB] = await Promise.all([
      runRosterHandshake({ link: links.a, participantId: 'peer-a', seedContribution: 'aaaa', ...rosterOf(CHAMPIONS[0].id) }),
      runRosterHandshake({ link: links.b, participantId: 'peer-b', seedContribution: 'bbbb', ...rosterOf(CHAMPIONS[1].id) }),
    ]);
    expect(fromA.kind).toBe('agreed');
    expect(fromB.kind).toBe('agreed');
  });

  it('times out rather than hanging when the peer never answers', async () => {
    const links = joinedLinks({ drop: true });
    const result = await runRosterHandshake({
      link: links.a,
      participantId: 'peer-a',
      seedContribution: 'aaaa',
      ...rosterOf(CHAMPIONS[0].id),
    });
    expect(result).toEqual({ kind: 'timeout' });
  });

  it('reports an unreadable proposal instead of agreeing to a half-parsed one', async () => {
    const links = joinedLinks({ corrupt: true });
    const [fromA] = await Promise.all([
      runRosterHandshake({ link: links.a, participantId: 'peer-a', seedContribution: 'aaaa', ...rosterOf(CHAMPIONS[0].id) }),
      runRosterHandshake({ link: links.b, participantId: 'peer-b', seedContribution: 'bbbb', ...rosterOf(CHAMPIONS[1].id) }),
    ]);
    expect(fromA).toEqual({ kind: 'unreadable' });
  });

  it('passes a refusal through with its reason rather than reporting success', async () => {
    const links = joinedLinks();
    const [fromA] = await Promise.all([
      runRosterHandshake({ link: links.a, participantId: 'peer-a', seedContribution: 'aaaa', ...rosterOf(CHAMPIONS[0].id) }),
      runRosterHandshake({
        link: links.b,
        participantId: 'peer-b',
        seedContribution: 'bbbb',
        championId: CHAMPIONS[1].id,
        // A different mode: both peers must be starting the same match.
        mode: 'midline',
        roster: CHAMPIONS,
        announceIntervalMs: 20,
        timeoutMs: 400,
      }),
    ]);
    expect(fromA).toEqual({ kind: 'refused', reason: 'mode-mismatch' });
  });

  it('ignores its own announcement echoed back by a reflecting transport', async () => {
    const handlers: ((m: NetMessage<never>) => void)[] = [];
    const reflecting: PeerLink<never> = {
      send: (message) => handlers.forEach((handler) => handler(message)),
      onMessage: (handler) => handlers.push(handler),
    };
    const result = await runRosterHandshake({
      link: reflecting,
      participantId: 'peer-a',
      seedContribution: 'aaaa',
      ...rosterOf(CHAMPIONS[0].id),
    });
    // Its own proposal must not be mistaken for the peer's, which would agree a match against itself.
    expect(result).toEqual({ kind: 'timeout' });
  });

  it('ignores input and checksum traffic on the same channel', async () => {
    const links = joinedLinks();
    const pending = runRosterHandshake({
      link: links.a,
      participantId: 'peer-a',
      seedContribution: 'aaaa',
      ...rosterOf(CHAMPIONS[0].id),
    });
    links.b.send({ type: 'checksum', tick: 3, hash: 'abc' });
    links.b.send({ type: 'input', tick: 4, participantId: 'peer-b', input: undefined as never });
    expect(await pending).toEqual({ kind: 'timeout' });
  });
});
