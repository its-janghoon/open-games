import { describe, it, expect } from 'vitest';
import { createLinkPair, NetSession, RollbackSession, type DesyncReport } from '@open-games/shared';

import { createFightSimulation, hashFightState } from './fightSimulation';
import { NEUTRAL_INPUT, type FightInput, type FightState } from './fightState';

const IDS = ['p1', 'p2'] as const;
const press = (over: Partial<FightInput> = {}): FightInput => ({ ...NEUTRAL_INPUT, ...over });

/** A deliberately busy script: movement, jumps, blocks and all three attacks. */
const scriptFor = (id: string) => (tick: number): FightInput =>
  id === 'p1'
    ? press({
        right: tick % 5 < 3,
        left: tick % 11 === 0,
        up: tick % 23 === 0,
        jab: tick % 7 === 0,
        kick: tick % 17 === 0,
      })
    : press({
        left: tick % 4 < 2,
        down: tick % 9 === 0,
        jab: tick % 13 === 0,
        slam: tick % 29 === 0,
      });

function runStraightThrough(ticks: number): FightState {
  const sim = createFightSimulation(IDS);
  let state = sim.initial();
  for (let tick = 0; tick < ticks; tick += 1) {
    // The tick passed is the PRE-increment one, matching what RollbackSession.advance() hands the
    // simulation. Passing tick + 1 here instead is off by one, and comparing the whole state is what
    // exposed it — champs' equality test checked selected fields and never saw the discrepancy.
    state = sim.step(
      state,
      new Map([
        ['p1', scriptFor('p1')(tick)],
        ['p2', scriptFor('p2')(tick)],
      ]),
      tick,
    );
  }
  return state;
}

describe('fighter under rollback', () => {
  it('a forced resimulation reproduces the ENTIRE state, not a chosen subset', () => {
    // The point of phase 6. champs could only compare selected fields, because its world was partly
    // still in the scene; here the state IS the world, so this compares the whole object — and a
    // field added later is covered without anyone remembering to add it here.
    const TICKS = 90;
    const LATE = 12;
    const expected = runStraightThrough(TICKS);

    const session = new RollbackSession(createFightSimulation(IDS), {
      participants: IDS,
      maxRollbackTicks: 200,
    });
    for (let tick = 0; tick < TICKS; tick += 1) {
      session.setLocalInput('p1', scriptFor('p1')(tick));
      if (tick !== LATE) session.applyRemoteInput('p2', tick, scriptFor('p2')(tick));
      session.advanceTo(tick + 1);
    }
    const late = session.applyRemoteInput('p2', LATE, scriptFor('p2')(LATE));
    expect(late.accepted, late.rejection ?? 'should accept').toBe(true);
    expect(late.resimulated, 'the withheld input must actually force a replay').toBeGreaterThan(0);

    expect(session.peek()).toEqual(expected);
  });

  it('the withheld tick is genuinely mispredicted, or the test proves nothing', () => {
    // Guard on the guard. If repeat-last happened to predict the withheld input correctly the core
    // would correctly do no work, and the equality above would pass without a rollback ever
    // happening — which is how an earlier phase's test fooled me.
    const predicted = scriptFor('p2')(11);
    const actual = scriptFor('p2')(12);
    expect(JSON.stringify(predicted)).not.toBe(JSON.stringify(actual));
  });

  it('the hash covers every simulation field', () => {
    // Rather than trusting that the hash was kept in step with the state by hand: mutate each field
    // in turn and require the hash to move. A field the hash ignores is a divergence the netcode
    // cannot see.
    const base = runStraightThrough(30);
    const fields: (keyof FightState['fighters'][number])[] = [
      'x',
      'y',
      'vx',
      'vy',
      'facing',
      'hp',
      'stance',
      'stanceUntil',
      'attack',
      'attackConnected',
      'combo',
    ];
    for (const field of fields) {
      const mutated: FightState = {
        ...base,
        fighters: base.fighters.map((f, index) =>
          index === 0 ? { ...f, [field]: perturb(f[field]) } : { ...f },
        ),
      };
      expect(hashFightState(mutated), `hash ignores ${String(field)}`).not.toBe(
        hashFightState(base),
      );
    }
  });

  it('the hash ignores a float difference too small to observe', () => {
    // Two machines can disagree in the last bit of a float without having diverged in any way a
    // player could see. A check that fires on that is a check nobody will keep listening to.
    const base = runStraightThrough(20);
    const jittered: FightState = {
      ...base,
      fighters: base.fighters.map((f) => ({ ...f, x: f.x + 1e-9 })),
    };
    expect(hashFightState(jittered)).toBe(hashFightState(base));
  });
});

function perturb(value: unknown): unknown {
  if (typeof value === 'number') return value + 7;
  if (typeof value === 'boolean') return !value;
  if (value === null) return 'jab';
  if (typeof value === 'string') return value === 'idle' ? 'crouch' : 'idle';
  return value;
}

describe('fighter over the network', () => {
  it('two peers exchanging only inputs reach the same fight', () => {
    // The phase 5 transport against the phase 6 world. Nobody sends a position, an hp value or a
    // hitbox; both peers reconstruct the whole fight from button presses.
    const link = createLinkPair<FightInput>();
    const desyncs: DesyncReport[] = [];
    const common = {
      participants: IDS,
      hashState: hashFightState,
      checksumInterval: 15,
      maxRollbackTicks: 200,
    };
    const a = new NetSession<FightState, FightInput>({
      ...common,
      sim: createFightSimulation(IDS),
      localParticipant: 'p1',
      link: link.a,
      onDesync: (report) => desyncs.push(report),
    });
    const b = new NetSession<FightState, FightInput>({
      ...common,
      sim: createFightSimulation(IDS),
      localParticipant: 'p2',
      link: link.b,
      onDesync: (report) => desyncs.push(report),
    });

    for (let tick = 0; tick < 90; tick += 1) {
      a.advance(scriptFor('p1')(tick));
      b.advance(scriptFor('p2')(tick));
      // Deliver only every third tick, so most remote inputs arrive against ticks that were already
      // simulated from a prediction — the condition rollback exists for.
      if (tick % 3 === 2) link.deliver();
    }
    link.deliver();
    link.deliver();

    expect(hashFightState(a.peek())).toBe(hashFightState(b.peek()));
    expect(desyncs, 'agreeing peers must not report a fault').toEqual([]);
  });

  it('reports a desync if one peer simulates the fight differently', () => {
    // A peer with different frame data is the realistic version of this: a stale build. The check
    // must notice rather than let two players finish a match they disagree about.
    const link = createLinkPair<FightInput>();
    const desyncs: DesyncReport[] = [];
    const honest = createFightSimulation(IDS);
    const drifted = createFightSimulation(IDS);
    const drift: typeof drifted = {
      ...drifted,
      step: (state, inputs, tick) => {
        const next = drifted.step(state, inputs, tick);
        return { ...next, fighters: next.fighters.map((f) => ({ ...f, x: f.x + 0.05 })) };
      },
    };
    const common = {
      participants: IDS,
      hashState: hashFightState,
      checksumInterval: 10,
      maxRollbackTicks: 200,
    };
    const a = new NetSession<FightState, FightInput>({
      ...common,
      sim: honest,
      localParticipant: 'p1',
      link: link.a,
      onDesync: (report) => desyncs.push(report),
    });
    const b = new NetSession<FightState, FightInput>({
      ...common,
      sim: drift,
      localParticipant: 'p2',
      link: link.b,
      onDesync: (report) => desyncs.push(report),
    });

    for (let tick = 0; tick < 40; tick += 1) {
      a.advance(scriptFor('p1')(tick));
      b.advance(scriptFor('p2')(tick));
      link.deliver();
    }
    link.deliver();

    expect(desyncs.length, 'a stale build must be reported, not played through').toBeGreaterThan(0);
  });
});
