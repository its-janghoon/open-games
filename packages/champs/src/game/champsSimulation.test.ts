import { describe, it, expect } from 'vitest';
import { RollbackSession } from '@open-games/shared';

import {
  createChampsSimulation,
  IDLE_INPUT,
  TICK_SECONDS,
  type ChampsInput,
} from './champsSimulation';
import {
  advanceEffects,
  cloneWorldState,
  drainDueImpacts,
  queueImpact,
  type WorldState,
} from './worldStep';
import { createEffectState } from './effects';
import { createChampionLifeState } from './championLifeState';
import { nextWaveNumberAt } from './rift/minions';

const PARTICIPANTS = ['p1', 'p2'] as const;

/**
 * Run the inputs straight through, with no prediction and no rewinding. This is the reference:
 * what the match WOULD have been had every input arrived on time.
 *
 * A rollback is correct exactly when it ends up here. Comparing a rollback against itself
 * proves nothing, which is the mistake an earlier commit's reference simulation made.
 */
function runStraightThrough(
  schedule: ReadonlyMap<number, ReadonlyMap<string, ChampsInput>>,
  ticks: number,
): WorldState {
  const sim = createChampsSimulation(PARTICIPANTS);
  let state = sim.initial();
  const last = new Map<string, ChampsInput>(PARTICIPANTS.map((id) => [id, IDLE_INPUT]));
  for (let tick = 0; tick < ticks; tick += 1) {
    const arriving = schedule.get(tick);
    if (arriving) for (const [id, input] of arriving) last.set(id, input);
    state = sim.step(state, new Map(last), tick);
  }
  return state;
}

  /**
   * Reference runs pass `tick`, not `tick + 1`.
   *
   * RollbackSession calls step(state, inputs, currentTick) and increments AFTER, so step always receives the tick it
   * is computing, numbered from 0. A reference that passed tick + 1 labelled every state one ahead of the session's,
   * and this suite did not notice for as long as its equality assertions enumerated fields instead of comparing whole
   * states — the mismatch lived entirely in the one field nobody listed. Ringout hit the same off-by-one from the
   * opposite direction.
   */
describe('champs world under rollback', () => {
  /**
   * What this suite can and cannot prove, stated because I established the boundary the hard way
   * by injecting bugs and watching them walk through.
   *
   * It validates the ROLLBACK MACHINERY over this state: that a rewind restores enough, that a
   * replay reaches the same place as a clean run of the same inputs, that the insertion counter
   * and the impact queue survive. Those are real and each is injection-checked.
   *
   * It CANNOT validate the step's own correctness. The reference run and the session call the
   * same `step`, so an error inside it — a reordered subsystem, wrong arithmetic — changes both
   * sides identically and every assertion still passes. Measured: moving the impact drain to
   * before the clock advance fails nothing here. That job belongs to the differential in
   * scripts/diff-world-step.mjs, which compares the step against the live scene instead of
   * against itself.
   */
  it('step does not mutate the state it was given', () => {
    // Direct, because the equality test cannot see this either: if step mutates and returns the
    // same object, the reference loop reassigns that object and stays numerically right, so both
    // sides agree. Only the snapshot contract is broken, and this is what notices.
    const sim = createChampsSimulation(PARTICIPANTS);
    const before = sim.initial();
    const untouched = cloneWorldState(before);

    sim.step(before, new Map([['p1', { moveTo: { x: 900, y: 900 }, cast: true }]]), 1);

    expect(before).toEqual(untouched);
  });

  it('a resimulation after a late MOVEMENT input matches the straight-through run', () => {
    // The half that holds today. Movement, the clock, life phases and the insertion counter all
    // survive a rewind and replay; this is the regression guard for that, kept separate from
    // the firing case above so a future fix to combat cannot quietly break this.
    const lateTick = 5;
    const p1Order: ChampsInput = { moveTo: { x: 50, y: 100 } };
    const p2Order: ChampsInput = { moveTo: { x: 500, y: 500 } };

    const schedule = new Map<number, Map<string, ChampsInput>>([
      [0, new Map([['p1', p1Order]])],
      [lateTick, new Map([['p2', p2Order]])],
    ]);
    const expected = runStraightThrough(schedule, 30);

    const sim = createChampsSimulation(PARTICIPANTS);
    const session = new RollbackSession(sim, { participants: PARTICIPANTS });
    session.setLocalInput('p1', p1Order);
    session.advanceTo(20);

    const result = session.applyRemoteInput('p2', lateTick, p2Order);
    expect(result.accepted, result.rejection ?? 'should accept').toBe(true);
    expect(result.resimulated, 'a late input that changes a prediction must force a replay')
      .toBeGreaterThan(0);

    session.advanceTo(30);
    const actual = session.peek();

    expect(actual.units.map((u) => ({ id: u.id, x: u.pos.x, y: u.pos.y }))).toEqual(
      expected.units.map((u) => ({ id: u.id, x: u.pos.x, y: u.pos.y })),
    );
    expect(actual.simTime).toBeCloseTo(expected.simTime, 9);
    expect(actual.lives).toEqual(expected.lives);
    expect(actual.moveGoals).toEqual(expected.moveGoals);
  });

  /**
   * The combat equality test — and a correction of what the previous commit claimed.
   *
   * That commit recorded a combat DESYNC here as `it.fails`, honestly noting I did not know
   * whether the fault was the adapter, WorldState, or the harness. It was the harness, and more
   * precisely the harness's PREMISE. There is no desync.
   *
   * What was wrong: the session got p2's input for tick 5 and nothing after it, then was compared
   * at tick 30 against a reference that persisted that input forward for 25 further ticks. Those
   * are two different input streams. The core replays an unconfirmed tick with the prediction it
   * originally used (`real ?? previouslyUsed`), which for p2 was idle — so of course fewer shots
   * were fired. I was comparing a prediction against the truth and calling the gap a bug.
   *
   * A session's state is only comparable to a straight-through run up to the last CONFIRMED tick,
   * the last tick where every participant's real input is known. So this test confirms every tick
   * and withholds exactly one, which is what forces a genuine rollback.
   *
   * It also explains what I could not account for at the time: why the movement-only version
   * passed while the firing version failed. A move goal is STICKY state, held in moveGoals, so an
   * idle prediction still walks the champion to the same place. A cast is per-tick, so an idle
   * prediction fires nothing. The movement test was passing for a reason unrelated to rollback
   * being correct.
   */
  it('a forced resimulation with both champions firing matches the straight-through run', () => {
    const LATE = 5;
    const TICKS = 30;
    const p1Order: ChampsInput = { moveTo: { x: 50, y: 100 }, cast: true };
    const p2Order: ChampsInput = { moveTo: { x: 500, y: 500 }, cast: true };
    // Deliberately different on the late tick so repeat-last MISPREDICTS it. Without that the
    // prediction is accidentally right and the core correctly does no work — a real property,
    // pinned separately, but not a rollback.
    const p2Late: ChampsInput = { moveTo: { x: 120, y: 40 }, cast: false };
    const p2At = (tick: number) => (tick === LATE ? p2Late : p2Order);

    const sim = createChampsSimulation(PARTICIPANTS);
    let expected = sim.initial();
    for (let tick = 0; tick < TICKS; tick += 1) {
      expected = sim.step(
        expected,
        new Map([
          ['p1', p1Order],
          ['p2', p2At(tick)],
        ]),
        tick,
      );
    }

    const session = new RollbackSession(createChampsSimulation(PARTICIPANTS), {
      participants: PARTICIPANTS,
      maxRollbackTicks: 120,
    });
    for (let tick = 0; tick < TICKS; tick += 1) {
      session.setLocalInput('p1', p1Order);
      if (tick !== LATE) session.applyRemoteInput('p2', tick, p2At(tick));
      session.advanceTo(tick + 1);
    }

    const late = session.applyRemoteInput('p2', LATE, p2Late);
    expect(late.accepted, late.rejection ?? 'should accept').toBe(true);
    expect(late.resimulated, 'a mispredicted input must force a real replay').toBeGreaterThan(0);

    const actual = session.peek();
    /**
     * Compare the WHOLE state, not a list of fields.
     *
     * This assertion used to enumerate units, impacts, the insertion counter and lives — which is exactly how a new
     * piece of state gets added and silently goes unchecked. Adding `economy` to WorldState did not fail a single
     * assertion here until this became a whole-object comparison, and that is the same hole gridfall's shot list and
     * its match outcome each had. An enumerated assertion only tests what somebody remembered to list.
     */
    expect(actual).toEqual(expected);
    expect(
      expected.nextInsertionOrder,
      'the scenario must actually fire, or it proves nothing about the queue',
    ).toBeGreaterThan(0);
    expect(
      expected.economy.p1.totalEarned,
      'the scenario must run long enough for whole gold to land, or the carry proves nothing',
    ).toBeGreaterThan(0);
  });

  it('leaves an unconfirmed tail on the predictions it already used, which is not a desync', () => {
    // Pinned so the previous commit's mistake cannot be re-made — and the ORDER here is the
    // mechanism, which my first attempt at this test got wrong. Delivering p2's input before
    // those ticks are simulated makes the prediction repeat-last, so p2 fires every tick and
    // nothing diverges. The idle reuse only happens when the ticks were ALREADY simulated while
    // p2 had no last-known input at all: those idle predictions are recorded as used, and the
    // replay reuses them rather than re-deriving better ones.
    /**
     * A world with NO turrets, because this test is about champion input prediction and turrets are noise for it.
     *
     * It counted `nextInsertionOrder` as a proxy for "how many casts happened", which works because that counter is
     * cumulative — a landed impact leaves the queue, so counting pending impacts would undercount. Turrets firing on
     * their own broke the proxy rather than the property, and scoping the impacts to champions did not fix it: by tick 20
     * the champion's own impact has already landed. Removing the turrets keeps the counter meaning exactly what it meant.
     */
    const withoutTurrets = () => {
      const sim = createChampsSimulation(PARTICIPANTS);
      const base = sim.initial;
      sim.initial = () => ({ ...base(), autoAttackers: [] });
      return sim;
    };
    const session = new RollbackSession(withoutTurrets(), {
      participants: PARTICIPANTS,
      maxRollbackTicks: 120,
    });
    const firing: ChampsInput = { moveTo: { x: 500, y: 500 }, cast: true };

    // Simulate 20 ticks knowing nothing about p2 — every tick predicts idle.
    session.advanceTo(20);
    expect(session.peek().nextInsertionOrder, 'nobody has fired yet').toBe(0);

    // Now p2's tick-5 input arrives. Only tick 5 becomes real; 6..19 reuse the idle predictions.
    const late = session.applyRemoteInput('p2', 5, firing);
    expect(late.accepted).toBe(true);
    const withReusedPredictions = session.peek().nextInsertionOrder;

    const sim = withoutTurrets();
    let persisted = sim.initial();
    for (let tick = 0; tick < 20; tick += 1) {
      persisted = sim.step(persisted, new Map(tick >= 5 ? [['p2', firing]] : []), tick);
    }

    expect(withReusedPredictions, 'exactly the one confirmed tick fired').toBe(1);
    expect(
      persisted.nextInsertionOrder,
      'input persistence fires every tick from 5; reused idle predictions fire once',
    ).toBeGreaterThan(withReusedPredictions);
  });

  it('an input that matches the prediction needs no replay', () => {
    // The cheap case, and worth pinning: if repeat-last-input was right, arriving late costs
    // nothing. A session that resimulated here would be doing work for no reason.
    const sim = createChampsSimulation(PARTICIPANTS);
    const session = new RollbackSession(sim, { participants: PARTICIPANTS });
    const order: ChampsInput = { moveTo: { x: 400, y: 300 } };

    session.applyRemoteInput('p2', 0, order);
    session.advanceTo(10);
    const again = session.applyRemoteInput('p2', 3, order);
    expect(again.accepted).toBe(true);
    expect(again.resimulated, 'prediction held, so nothing to redo').toBe(0);
  });

  it('lands in the same place whether a hit is drained before or after the effect sweep', () => {
    // The one place the adapter's order differs from the scene's: advanceEffects moves the
    // clock and sweeps together, so the sweep runs before the impact drain rather than after.
    // This is only safe because effect reads were made pure - a read filters by deadline
    // instead of depending on the sweep having run. Asserted rather than claimed.
    const build = (): WorldState => {
      const state: WorldState = {
        tick: 0,
        simTime: 0,
        units: [],
        cooldowns: {},
        effects: { p1: { ...createEffectState(), slows: [{ source: 's', percent: 0.5, expiresAt: 0.008 }] } },
        lives: { p1: createChampionLifeState() },
        pendingImpacts: [],
        nextInsertionOrder: 0,
        passives: { counters: {}, deadlines: {} },
        recalls: {},
        teamFacts: { ally: { championKills: 0, objectivePoints: 0 }, enemy: { championKills: 0, objectivePoints: 0 } },
        outcome: { kind: 'ongoing' },
        resources: {},
        traps: [],
        camps: [],
        campMembers: [],
        autoAttackers: [],
        targets: {},
        minions: [],
        waves: { spawnedWaves: 0, pending: [], nextOrder: 0 },
        structures: {},
        economy: {},
        moveGoals: { p1: null },
      };
      queueImpact(state, {
        dueAt: 0.008,
        source: {
          id: 'p1',
          kind: 'champion',
          team: 'ally',
          pos: { x: 0, y: 0 },
          hp: 1,
          maxHp: 1,
          ad: 1,
          armor: 0,
          attackRange: 1,
          attackSpeed: 1,
          moveSpeed: 1,
          attackCdRemaining: 0,
          dead: false,
        },
        radius: 1,
        rawDamage: 10,
        color: 0,
        stunDuration: 0,
        ability: false,
        ultimate: false,
        singleTarget: true,
        chronoProc: false,
      });
      return state;
    };

    const sweepFirst = build();
    advanceEffects(sweepFirst, TICK_SECONDS);
    const drainedAfterSweep = drainDueImpacts(sweepFirst);

    const drainFirst = build();
    drainFirst.simTime += TICK_SECONDS;
    const drainedBeforeSweep = drainDueImpacts(drainFirst);
    advanceEffects(drainFirst, 0);

    expect(drainedAfterSweep).toEqual(drainedBeforeSweep);
    expect(sweepFirst.effects.p1.slows).toEqual(drainFirst.effects.p1.slows);
    expect(sweepFirst.pendingImpacts).toEqual(drainFirst.pendingImpacts);
  });

  it('carries the gold remainder across a rollback', () => {
    /**
     * The property the whole extraction exists for.
     *
     * The trickle is 2.04 gold per second against a 1/60 s tick, so a tick earns 0.034 and whole gold lands only
     * every thirtieth one. If `accrual` is not in the snapshot, a rollback restores the gold but throws away the
     * fraction, and the two peers drift apart by up to 1 gold per rollback — permanently, because nothing ever
     * reconciles it. Gold decides purchases, so the drift eventually buys one side an item the other cannot afford
     * and every trade after that disagrees.
     *
     * Driven long enough that whole gold lands several times, and asserted against a straight-through reference so
     * the claim is equality with a run that never rewound, not merely a plausible number.
     */
    const TICKS = 200;
    const LATE = 40;
    const p1: ChampsInput = { moveTo: { x: 60, y: 120 }, cast: false };
    const p2Usual: ChampsInput = { moveTo: { x: 480, y: 460 }, cast: false };
    const p2Late: ChampsInput = { moveTo: { x: 90, y: 30 }, cast: false };
    const p2At = (tick: number) => (tick === LATE ? p2Late : p2Usual);

    const reference = createChampsSimulation(PARTICIPANTS);
    let expected = reference.initial();
    for (let tick = 0; tick < TICKS; tick += 1) {
      expected = reference.step(
        expected,
        new Map([
          ['p1', p1],
          ['p2', p2At(tick)],
        ]),
        tick,
      );
    }

    const session = new RollbackSession(createChampsSimulation(PARTICIPANTS), {
      participants: PARTICIPANTS,
      maxRollbackTicks: 300,
    });
    for (let tick = 0; tick < TICKS; tick += 1) {
      session.setLocalInput('p1', p1);
      if (tick !== LATE) session.applyRemoteInput('p2', tick, p2At(tick));
      session.advanceTo(tick + 1);
    }
    const late = session.applyRemoteInput('p2', LATE, p2Late);
    expect(late.accepted, late.rejection ?? 'should accept').toBe(true);
    expect(late.resimulated, 'a mispredicted input must force a real replay').toBeGreaterThan(0);

    expect(session.peek().economy).toEqual(expected.economy);
    // The scenario has to actually cross whole-gold boundaries, or a dropped carry would be invisible.
    expect(expected.economy.p1.totalEarned).toBeGreaterThan(3);
    expect(
      expected.economy.p1.accrual,
      'and it must end mid-fraction, which is the state a rollback can lose',
    ).toBeGreaterThan(0);
  });

  it('revives a downed structure at the same tick whether or not the run was rewound', () => {
    /**
     * Structure health is what the match outcome is computed from, so a rollback that restores champions but not
     * structures lets two peers disagree about whether the game is already over.
     *
     * The deadline is absolute — the tick a structure went down, not a countdown — which is what makes it rewindable
     * at all: a countdown would need to know how many ticks were undone, information the state does not carry. This
     * drives a rollback across the respawn moment and asserts the structure's state matches a run that never rewound.
     */
    const TICKS = 120;
    const LATE = 30;
    const p1: ChampsInput = { moveTo: { x: 70, y: 130 }, cast: false };
    const p2Usual: ChampsInput = { moveTo: { x: 470, y: 450 }, cast: false };
    const p2Late: ChampsInput = { moveTo: { x: 110, y: 20 }, cast: false };
    const p2At = (tick: number) => (tick === LATE ? p2Late : p2Usual);

    /**
     * The clock is seeded mid-match rather than the window being made long enough.
     *
     * A conquest inhibitor respawns 150 seconds after it falls, which is 9000 ticks — far too many to drive in a
     * test. So this starts at 149.5 s of sim time with an inhibitor destroyed at t=0: the deadline then lands half a
     * second in, 30 ticks from the start, well inside the replayed window. Nothing artificial about the state — a
     * match really is 149.5 seconds long at that point — and it avoids the alternative of a negative kill stamp,
     * which would mean a structure destroyed before the match began. The 150-second duration itself is already
     * covered by the existing structures tests; what is under test here is the deadline surviving a rewind.
     */
    const downAt = 0;
    const seed = (state: WorldState): WorldState => ({
      ...state,
      simTime: 149.5,
      structures: {
        ...state.structures,
        allyInhibitor: { hp: 0, maxHp: 2000, dead: true, killedAt: downAt },
      },
    });

    const reference = createChampsSimulation(PARTICIPANTS);
    let expected = seed(reference.initial());
    for (let tick = 0; tick < TICKS; tick += 1) {
      expected = reference.step(
        expected,
        new Map([
          ['p1', p1],
          ['p2', p2At(tick)],
        ]),
        tick,
      );
    }

    const sim = createChampsSimulation(PARTICIPANTS);
    const base = sim.initial;
    sim.initial = () => seed(base());
    const session = new RollbackSession(sim, {
      participants: PARTICIPANTS,
      maxRollbackTicks: 300,
    });
    for (let tick = 0; tick < TICKS; tick += 1) {
      session.setLocalInput('p1', p1);
      if (tick !== LATE) session.applyRemoteInput('p2', tick, p2At(tick));
      session.advanceTo(tick + 1);
    }
    const late = session.applyRemoteInput('p2', LATE, p2Late);
    expect(late.accepted, late.rejection ?? 'should accept').toBe(true);
    expect(late.resimulated, 'a mispredicted input must force a real replay').toBeGreaterThan(0);

    expect(session.peek().structures).toEqual(expected.structures);
    // The scenario has to actually cross the respawn deadline, or a broken revive would be invisible.
    expect(
      expected.structures.allyInhibitor.dead,
      'the window must be long enough for the inhibitor to come back',
    ).toBe(false);
    expect(expected.structures.allyInhibitor.killedAt).toBeNull();
    expect(expected.structures.allyInhibitor.hp).toBe(2000);
  });

  it('leaves a structure down while its respawn time has not arrived', () => {
    // The other half of the deadline: a revive step that simply revived everything would pass the test above.
    const sim = createChampsSimulation(PARTICIPANTS);
    let state: WorldState = {
      ...sim.initial(),
      structures: {
        allyInhibitor: { hp: 0, maxHp: 2000, dead: true, killedAt: 1_000_000 },
      },
    };
    for (let tick = 0; tick < 30; tick += 1) {
      state = sim.step(state, new Map([['p1', { moveTo: null }]]), tick);
    }
    expect(state.structures.allyInhibitor.dead).toBe(true);
    expect(state.structures.allyInhibitor.hp).toBe(0);
  });

  it('schedules the same waves whether or not the run was rewound', () => {
    /**
     * The wave schedule decides WHICH minions exist and WHEN, so two peers who disagree about it disagree about the
     * population of the map. A rollback that restored champions while dropping queued spawns would delete minions
     * that were already scheduled.
     *
     * The clock is seeded just before the first wave so the spawn lands inside the replayed window — the same trick
     * the inhibitor test uses, and for the same reason: waiting out the real interval would be thousands of ticks.
     */
    const TICKS = 120;
    const LATE = 25;
    const p1: ChampsInput = { moveTo: { x: 80, y: 140 }, cast: false };
    const p2Usual: ChampsInput = { moveTo: { x: 460, y: 440 }, cast: false };
    const p2Late: ChampsInput = { moveTo: { x: 130, y: 25 }, cast: false };
    const p2At = (tick: number) => (tick === LATE ? p2Late : p2Usual);

    const base = createChampsSimulation(PARTICIPANTS).initial();
    // Find the first wave time from the rules, then start half a second short of it.
    let firstWave = 0;
    for (let t = 0; t < 600; t += 0.5) {
      if (nextWaveNumberAt(t) >= 1) {
        firstWave = t;
        break;
      }
    }
    expect(firstWave, 'a wave must become due at some point').toBeGreaterThan(0);
    const seed = (state: WorldState): WorldState => ({ ...state, simTime: firstWave - 0.5 });

    const reference = createChampsSimulation(PARTICIPANTS);
    let expected = seed(base);
    for (let tick = 0; tick < TICKS; tick += 1) {
      expected = reference.step(
        expected,
        new Map([
          ['p1', p1],
          ['p2', p2At(tick)],
        ]),
        tick,
      );
    }

    const sim = createChampsSimulation(PARTICIPANTS);
    const original = sim.initial;
    sim.initial = () => seed(original());
    const session = new RollbackSession(sim, { participants: PARTICIPANTS, maxRollbackTicks: 300 });
    for (let tick = 0; tick < TICKS; tick += 1) {
      session.setLocalInput('p1', p1);
      if (tick !== LATE) session.applyRemoteInput('p2', tick, p2At(tick));
      session.advanceTo(tick + 1);
    }
    const late = session.applyRemoteInput('p2', LATE, p2Late);
    expect(late.accepted, late.rejection ?? 'should accept').toBe(true);
    expect(late.resimulated, 'a mispredicted input must force a real replay').toBeGreaterThan(0);

    expect(session.peek().waves).toEqual(expected.waves);
    /**
     * The window must actually cross a spawn, or a dropped schedule would be invisible.
     *
     * This used to assert `pending.length > 0`, which was right until minions started being ADMITTED from the queue:
     * now a due entry becomes a body and leaves the queue, so a full queue is no longer evidence that anything
     * happened. What is evidence is that the wave was scheduled and that it turned into minions.
     */
    expect(expected.waves.spawnedWaves, 'the window must cross the first wave').toBeGreaterThan(0);
    expect(expected.minions.length, 'and the scheduled wave must become bodies').toBeGreaterThan(0);
    expect(session.peek().minions).toEqual(expected.minions);
  });

  it('freezes a decided match, so nothing advances past the end', () => {
    /**
     * Same rule as Gridfall's. Without it a queued impact still lands after the winning blow and timers keep firing, so
     * the state two peers must agree on carries on changing past the end of the match — and a peer that resumed from a
     * later snapshot would see a different post-match world.
     */
    const sim = createChampsSimulation(PARTICIPANTS);
    const decided: WorldState = {
      ...sim.initial(),
      outcome: { kind: 'decided', winner: 'ally', reason: 'nexus-destroyed' },
    };
    const before = JSON.parse(JSON.stringify(decided)) as WorldState;
    const after = sim.step(decided, new Map([['p1', { moveTo: { x: 400, y: 400 }, cast: true }]]), 1);
    expect(after.units).toEqual(before.units);
    expect(after.simTime).toBe(before.simTime);
    expect(after.pendingImpacts).toEqual(before.pendingImpacts);
    expect(after.economy).toEqual(before.economy);
    // Only the tick label moves, so a caller's clock still advances.
    expect(after.tick).toBe(1);
  });

  it('refuses an input older than the rollback window instead of applying it to the wrong base', () => {
    const sim = createChampsSimulation(PARTICIPANTS);
    const session = new RollbackSession(sim, {
      participants: PARTICIPANTS,
      maxRollbackTicks: 10,
    });
    session.advanceTo(50);
    const stale = session.applyRemoteInput('p2', 1, { moveTo: { x: 9, y: 9 } });
    expect(stale.accepted).toBe(false);
    expect(stale.rejection).toBe('too-old');
  });
});
