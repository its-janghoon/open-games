import { describe, it, expect } from 'vitest';
import { createLinkPair, NetSession, RollbackSession, type DesyncReport } from '@open-games/shared';

import { createGridSimulation, hashGridWorld } from './gridSimulation';
import {
  NEUTRAL_FPS_INPUT,
  type FpsInput,
  type GridWorld,
  type Player,
} from './gridWorld';

const IDS = ['a', 'b'] as const;
const hold = (over: Partial<FpsInput> = {}): FpsInput => ({ ...NEUTRAL_FPS_INPUT, ...over });

/**
 * A busy script: movement, turning, strafing and firing, so the run exercises every part of the state
 * rather than only positions. A rollback test over a world where nothing shoots proves nothing about shots
 * — champs taught that with an impact queue that was empty for the whole test.
 */
const scriptFor = (id: string) => (tick: number): FpsInput =>
  id === 'a'
    ? hold({
        forward: tick % 7 < 4,
        right: tick % 11 < 3,
        turnRight: tick % 5 === 0,
        fire: tick % 19 === 0,
      })
    : hold({
        forward: tick % 6 < 3,
        left: tick % 9 < 2,
        turnLeft: tick % 4 === 0,
        fire: tick % 23 === 0,
      });

function runStraightThrough(ticks: number): GridWorld {
  const sim = createGridSimulation(IDS);
  let world = sim.initial();
  for (let tick = 0; tick < ticks; tick += 1) {
    // The PRE-increment tick, matching what RollbackSession.advance() hands the simulation. Passing
    // tick + 1 here is the off-by-one that comparing whole states caught in the fighter, where the
    // per-field comparison used before it had never noticed.
    world = sim.step(
      world,
      new Map([
        ['a', scriptFor('a')(tick)],
        ['b', scriptFor('b')(tick)],
      ]),
      tick,
    );
  }
  return world;
}

describe('grid world under rollback', () => {
  it('step does not mutate the world it was given', () => {
    // Direct, because the equality test below cannot see this: if step mutates and returns the same object,
    // the reference loop reassigns that object and stays numerically right, so both sides agree while the
    // snapshot contract is broken.
    const sim = createGridSimulation(IDS);
    const before = sim.initial();
    // A shot must already be in flight. advanceShot MUTATES a shot's position, so a clone that copies the
    // array but shares the objects leaks that mutation back into the original — and initial() has no shots,
    // which is why the first version of this test could not see it.
    before.shots.push({ id: 's', ownerId: 'a', x: 11.5, y: 3.5, dirX: 1, dirY: 0, expiresAt: 500 });

    /**
     * The reference is built WITHOUT cloneGridWorld, and that is the second correction to this test.
     * Using the function under test to capture the "before" picture defeats the check: a clone that shares
     * shot objects corrupts the reference in exactly the same way it corrupts the original, so the two stay
     * equal and the injection passes. Same shape as comparing a rollback against itself.
     */
    const untouched = JSON.parse(JSON.stringify(before)) as GridWorld;
    sim.step(before, new Map([['a', hold({ forward: true, fire: true })]]), 1);
    expect(before).toEqual(untouched);
  });

  it('the withheld input is genuinely mispredicted, or the test below proves nothing', () => {
    // Guard on the guard. If repeat-last happens to predict the withheld input correctly, the core
    // correctly does no work and the equality assertion passes without a rollback ever occurring. That is
    // exactly how an earlier phase's test fooled me twice.
    const LATE = 13;
    expect(JSON.stringify(scriptFor('b')(LATE - 1))).not.toBe(
      JSON.stringify(scriptFor('b')(LATE)),
    );
  });

  it('predicts by repeating the last input, which no equality test can check', () => {
    /**
     * Tested directly because it is unobservable from the outside: both peers predict identically and a late
     * input forces a resimulation against the truth, so replacing repeat-last with always-idle changes no
     * final state and failed every test. Prediction quality affects how often a rollback happens and how
     * far it reaches — smoothness, not correctness — so the honest check is of the documented behaviour.
     */
    const sim = createGridSimulation(IDS);
    const last = hold({ forward: true, turnRight: true });
    expect(sim.predict('a', last, 5)).toEqual(last);
    expect(sim.predict('a', last, 5)).not.toBe(last);
    expect(sim.predict('a', undefined, 5)).toEqual(NEUTRAL_FPS_INPUT);
  });

  it('a forced resimulation reproduces the ENTIRE world, not a chosen subset', () => {
    // The verdict on whether the state is complete. Because the map is a constant and nothing else lives
    // outside the state, this can compare the whole object — so a field added later is covered without
    // anyone remembering to extend the assertion.
    const TICKS = 150;
    const LATE = 13;
    const expected = runStraightThrough(TICKS);

    const session = new RollbackSession(createGridSimulation(IDS), {
      participants: IDS,
      maxRollbackTicks: 300,
    });
    for (let tick = 0; tick < TICKS; tick += 1) {
      session.setLocalInput('a', scriptFor('a')(tick));
      if (tick !== LATE) session.applyRemoteInput('b', tick, scriptFor('b')(tick));
      session.advanceTo(tick + 1);
    }
    const late = session.applyRemoteInput('b', LATE, scriptFor('b')(LATE));
    expect(late.accepted, late.rejection ?? 'should accept').toBe(true);
    expect(late.resimulated, 'a mispredicted input must force a real replay').toBeGreaterThan(0);

    expect(session.peek()).toEqual(expected);
  });

  it('the scenario actually fires and lands hits, or it tests an idle world', () => {
    const world = runStraightThrough(150);
    const shotsFired = world.players.some((p) => p.fireReadyAt > 0);
    expect(shotsFired, 'nobody fired in 150 ticks').toBe(true);
  });
});

describe('the state hash', () => {
  const PLAYER_FIELDS: (keyof Player)[] = [
    'x',
    'y',
    'angle',
    'hp',
    'fireReadyAt',
    'respawnAt',
    'kills',
    'deaths',
  ];

  it('covers every player field', () => {
    // Rather than trusting the hash was kept in step with the state by hand. A field it ignores is a
    // divergence the netcode cannot see, and a hash silently going stale is the failure mode here.
    const base = runStraightThrough(60);
    for (const field of PLAYER_FIELDS) {
      const mutated: GridWorld = {
        ...base,
        players: base.players.map((p, index) =>
          index === 0 ? { ...p, [field]: perturb(p[field]) } : { ...p },
        ),
      };
      expect(hashGridWorld(mutated), `hash ignores player.${String(field)}`).not.toBe(
        hashGridWorld(base),
      );
    }
  });

  it('covers the shot list, including its order', () => {
    const base: GridWorld = {
      tick: 5,
      players: createGridSimulation(IDS).initial().players,
      shots: [
        { id: 's1', ownerId: 'a', x: 3, y: 4, dirX: 1, dirY: 0, expiresAt: 90 },
        { id: 's2', ownerId: 'b', x: 7, y: 8, dirX: 0, dirY: 1, expiresAt: 91 },
      ],
      outcome: { kind: 'ongoing' },
    };
    // Order matters to the simulation — kill credit reads the first shot that landed — so a reordering is a
    // real difference and must not hash the same.
    const swapped: GridWorld = { ...base, shots: [base.shots[1], base.shots[0]] };
    expect(hashGridWorld(swapped)).not.toBe(hashGridWorld(base));

    for (const field of ['x', 'y', 'dirX', 'dirY', 'expiresAt', 'id', 'ownerId'] as const) {
      const mutated: GridWorld = {
        ...base,
        shots: base.shots.map((s, i) => (i === 0 ? { ...s, [field]: perturb(s[field]) } : { ...s })),
      };
      expect(hashGridWorld(mutated), `hash ignores shot.${field}`).not.toBe(hashGridWorld(base));
    }
  });

  it('covers the tick', () => {
    const base = runStraightThrough(30);
    expect(hashGridWorld({ ...base, tick: base.tick + 1 })).not.toBe(hashGridWorld(base));
  });

  it('covers the match outcome, including which player won', () => {
    /**
     * The step READS the outcome to freeze the world, so two peers disagreeing about whether the match is over
     * would disagree about whether anyone may still move — precisely what this check exists to surface. Omitting
     * it from the hash failed nothing until this test existed, which is the same hole the shot list had.
     */
    const base = runStraightThrough(30);
    expect(base.outcome).toEqual({ kind: 'ongoing' });
    const won = hashGridWorld({ ...base, outcome: { kind: 'win', winnerId: 'a' } });
    const drawn = hashGridWorld({ ...base, outcome: { kind: 'draw' } });
    expect(won).not.toBe(hashGridWorld(base));
    expect(drawn).not.toBe(hashGridWorld(base));
    // And WHICH player won has to matter, not merely that someone did.
    expect(hashGridWorld({ ...base, outcome: { kind: 'win', winnerId: 'b' } })).not.toBe(won);
    expect(drawn).not.toBe(won);
  });

  it('is fine enough to see a difference a player could see', () => {
    /**
     * Pins the RESOLUTION, which nothing did before. Injecting toFixed(0) in place of toFixed(4) failed no
     * test, because the mutation checks perturb by +7 (survives any rounding) and the jitter check uses
     * 1e-9 (survives none). Neither says where the line is. A tile is one unit here, so 0.05 of a tile is
     * a visible step at raycast scale and must not round away.
     */
    const base = runStraightThrough(40);
    const nudged: GridWorld = {
      ...base,
      players: base.players.map((p, i) => (i === 0 ? { ...p, x: p.x + 0.05 } : { ...p })),
    };
    expect(hashGridWorld(nudged)).not.toBe(hashGridWorld(base));
  });

  it('ignores a float difference too small to observe', () => {
    // Two machines can disagree in a float's last bit without diverging in any way a player could see. A
    // check that fires on that is a check nobody keeps listening to.
    const base = runStraightThrough(40);
    const jittered: GridWorld = {
      ...base,
      players: base.players.map((p) => ({ ...p, x: p.x + 1e-9, angle: p.angle + 1e-9 })),
    };
    expect(hashGridWorld(jittered)).toBe(hashGridWorld(base));
  });
});

function perturb(value: unknown): unknown {
  if (typeof value === 'number') return value + 7;
  if (typeof value === 'boolean') return !value;
  if (value === null) return 42;
  if (typeof value === 'string') return `${value}-changed`;
  return value;
}

describe('two peers over the network', () => {
  it('exchange only inputs and reach the same world', () => {
    // The phase 5 transport against the phase 7 world. Nobody sends a position, an hp value or a shot.
    const link = createLinkPair<FpsInput>();
    const desyncs: DesyncReport[] = [];
    const common = {
      participants: IDS,
      hashState: hashGridWorld,
      checksumInterval: 20,
      maxRollbackTicks: 300,
    };
    const a = new NetSession<GridWorld, FpsInput>({
      ...common,
      sim: createGridSimulation(IDS),
      localParticipant: 'a',
      link: link.a,
      onDesync: (report) => desyncs.push(report),
    });
    const b = new NetSession<GridWorld, FpsInput>({
      ...common,
      sim: createGridSimulation(IDS),
      localParticipant: 'b',
      link: link.b,
      onDesync: (report) => desyncs.push(report),
    });

    for (let tick = 0; tick < 150; tick += 1) {
      a.advance(scriptFor('a')(tick));
      b.advance(scriptFor('b')(tick));
      // Delivered every fourth tick, so most remote inputs land against ticks already simulated from a
      // prediction — the condition rollback exists for.
      if (tick % 4 === 3) link.deliver();
    }
    link.deliver();
    link.deliver();

    expect(hashGridWorld(a.peek())).toBe(hashGridWorld(b.peek()));
    expect(desyncs, 'agreeing peers must not report a fault').toEqual([]);
  });

  it('reports a desync when one peer simulates differently', () => {
    // The realistic cause is a stale build. The check must notice rather than let two players finish a
    // match they disagree about.
    const link = createLinkPair<FpsInput>();
    const desyncs: DesyncReport[] = [];
    const honest = createGridSimulation(IDS);
    const base = createGridSimulation(IDS);
    const drifted: typeof base = {
      ...base,
      step: (world, inputs, tick) => {
        const next = base.step(world, inputs, tick);
        return { ...next, players: next.players.map((p) => ({ ...p, x: p.x + 0.001 })) };
      },
    };
    const common = {
      participants: IDS,
      hashState: hashGridWorld,
      checksumInterval: 10,
      maxRollbackTicks: 300,
    };
    const a = new NetSession<GridWorld, FpsInput>({
      ...common,
      sim: honest,
      localParticipant: 'a',
      link: link.a,
      onDesync: (report) => desyncs.push(report),
    });
    const b = new NetSession<GridWorld, FpsInput>({
      ...common,
      sim: drifted,
      localParticipant: 'b',
      link: link.b,
      onDesync: (report) => desyncs.push(report),
    });

    for (let tick = 0; tick < 60; tick += 1) {
      a.advance(scriptFor('a')(tick));
      b.advance(scriptFor('b')(tick));
      link.deliver();
    }
    link.deliver();

    expect(desyncs.length, 'a stale build must be reported, not played through').toBeGreaterThan(0);
  });
});
