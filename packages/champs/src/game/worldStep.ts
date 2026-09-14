import type { GameMode } from './battleStore';
import {
  advanceChampionLife,
  isChampionPresent,
  type ChampionLifeState,
} from './championLifeState';
import { expireEffects, type EffectState } from './effects';
import {
  advanceAttackCooldown,
  distance,
  partitionImpacts,
  tickCooldowns,
  type CooldownState,
  type PendingImpact,
  type Unit,
  type Vec2,
} from './combat';

/**
 * The pure world-advance arithmetic, extracted from BattleScene.
 *
 * Rollback needs a step it can call headlessly against a snapshotted state, and champs
 * did not have one: the world advanced inside BattleScene.update, mixed in with Phaser
 * containers and cameras. This file is the first slice of separating the two.
 *
 * It is extracted rather than REIMPLEMENTED, and that distinction is the whole point.
 * A second implementation "under test against the scene" would have to be kept in step
 * with it by hand, and the first divergence would be a desync that only appears in a
 * networked match - the hardest possible place to find it. So the scene calls this, and
 * there is exactly one copy of the arithmetic.
 *
 * What made a naive extraction wrong: the scene's movement is not a simple step toward
 * a goal. It consults per-champion special cases (a smoke bonus for one champion, a
 * hunting bonus near a wounded enemy for another), buff and slow state with timestamps,
 * a pull effect that pins a unit in place, and clamps the result to the map. A step
 * built on the generic stepToward() helper diverges on the first tick. So the modifiers
 * arrive as DATA: the scene still decides what they are, and this decides what they do.
 */

/** Everything outside the unit that changes how far it moves this tick. */
export interface MoveModifiers {
  /** Multiplies base move speed, e.g. a champion-specific bonus. Default 1. */
  speedMultiplier?: number;
  /** Added to move speed before slows apply, in world units per second. */
  flatBonus?: number;
  /** Fraction of speed removed, 0..1. */
  slowFactor?: number;
  /** Sum of active movement buffs as a fraction, e.g. 0.2 for +20%. */
  buffFraction?: number;
  /** When true the unit cannot move at all this tick. */
  pinned?: boolean;
}

/** Map bounds the result is clamped into. */
export interface WorldBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

/**
 * Move a unit toward a goal for one step, returning how far it actually travelled.
 *
 * The distance is returned rather than discarded because callers need it: the scene
 * uses it to decide whether a champion counts as having moved this frame, which drives
 * a passive and a tutorial trigger. Recomputing it outside would be a second place for
 * the same arithmetic to drift.
 *
 * A goal closer than one unit is treated as reached - the scene's own threshold, kept
 * so extraction changes nothing.
 */
export function moveUnitToward(
  unit: Unit,
  goal: Vec2,
  dt: number,
  modifiers: MoveModifiers = {},
  bounds?: WorldBounds,
): number {
  const d = distance(unit.pos, goal);
  if (d < 1) return 0;
  if (modifiers.pinned) return 0;

  const speed =
    (unit.moveSpeed * (modifiers.speedMultiplier ?? 1) * (1 + (modifiers.buffFraction ?? 0)) +
      (modifiers.flatBonus ?? 0)) *
    (1 - (modifiers.slowFactor ?? 0));
  const travel = Math.min(d, speed * dt);
  if (travel <= 0) return 0;

  const nextX = unit.pos.x + ((goal.x - unit.pos.x) / d) * travel;
  const nextY = unit.pos.y + ((goal.y - unit.pos.y) / d) * travel;
  unit.pos.x = bounds ? clamp(nextX, bounds.minX, bounds.maxX) : nextX;
  unit.pos.y = bounds ? clamp(nextY, bounds.minY, bounds.maxY) : nextY;
  return travel;
}

/* -------------------------------------------------------------------------- */
/* Timers                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Advance one side's per-tick timers.
 *
 * Worth stating what this does NOT do: it does not reimplement anything. Measured
 * before writing it, combat.ts already owns the only implementation of both halves -
 * advanceAttackCooldown and tickCooldowns - and BattleScene already calls those. So
 * extracting them again would have produced a second copy of arithmetic that has one,
 * which is the exact mistake the movement slice avoided.
 *
 * What this adds is a single per-side entry point a headless step can call, in one
 * place, in a fixed order. The scene keeps its own two call sites where they are: they
 * sit ~440 lines apart in its frame, and although the fields are disjoint (verified: no
 * read of attackCdRemaining, canBasicAttack or any cds field occurs between them),
 * moving one would be a behaviour change made for tidiness rather than for a reason.
 */
export function advanceTimers(
  units: readonly Unit[],
  cooldowns: readonly CooldownState[],
  dt: number,
): void {
  for (const unit of units) advanceAttackCooldown(unit, dt);
  for (const cds of cooldowns) tickCooldowns(cds, dt);
}

/* -------------------------------------------------------------------------- */
/* Snapshots                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The state a rollback has to snapshot and restore.
 *
 * Plain data, and that is the requirement rather than a style preference: rewinding
 * means restoring an earlier state exactly, so anything holding a reference to a render
 * object, a timer, or a scene cannot be rewound. Unit is already a plain type, which is
 * what made this slice possible at all.
 *
 * Deliberately incomplete. It covers what the extracted step advances - positions and
 * timers - and NOT effects, projectiles, structures or gold. Declaring a full world
 * state now would be a promise the step cannot keep, and a rollback over a state that
 * misses a field does not fail: it silently desyncs on that field.
 */
export interface WorldState {
  tick: number;
  /**
   * The simulation clock, in seconds — the scene's `elapsed`.
   *
   * Part of the snapshot because every effect expiry is a comparison against it. Restore
   * positions and timers but not the clock, and a replayed tick resolves buffs against
   * the wrong `now`: effects that had ended come back, or live ones vanish. The clock is
   * state, not ambient context.
   */
  simTime: number;
  units: Unit[];
  /** Ability cooldowns per participant id. */
  cooldowns: Record<string, CooldownState>;
  /** Active effects per unit id. */
  effects: Record<string, EffectState>;
  /**
   * Champion death / respawn state per unit id.
   *
   * In the snapshot because a rollback that restores a position but not whether the unit
   * was DEAD resurrects it: the replayed tick finds a live champion standing where a
   * corpse was, and from there the two peers disagree about who is on the map.
   */
  lives: Record<string, ChampionLifeState>;
  /**
   * Hits committed but not yet landed, in queue order.
   *
   * A snapshot without these loses damage that was already paid for: a cast several ticks ago
   * decides a kill on a tick the rollback is about to replay, and if the queue is empty the
   * kill simply never happens.
   */
  pendingImpacts: PendingImpact[];
  /**
   * The next value to stamp on a queued impact.
   *
   * This is the half that is easy to leave out, and leaving it out reintroduces the ordering
   * bug that partitionImpacts was just fixed for. Restore the queue but not the counter, and a
   * cast replayed after the restore is stamped with a number that some entry still in the
   * queue already holds - so two impacts sharing a deadline become genuinely indistinguishable
   * and the tiebreak has nothing left to break on. The counter is state, not a scratch
   * variable.
   */
  nextInsertionOrder: number;
  /**
   * Where each unit has been ordered to walk, or null.
   *
   * In the state rather than in the simulation's closure, and the reason is worth recording
   * because I got it wrong first. I expected a closure-held goal map to DESYNC a replay: order
   * A at tick 0, order B at tick 10, then force a rewind to a snapshot before 10, and the
   * closure would still hold B while the replayed ticks should use A. Measured, it does not -
   * the rollback core supplies a full input map on every replayed tick, predicting
   * repeat-last-input, so the goal is re-derived from the input ring instead of persisting.
   *
   * It is here anyway, because Simulation.step is documented as pure with respect to its
   * arguments and reading a closure breaks that whatever the current behaviour happens to be.
   * A contract that holds by accident is a contract that breaks during the next change.
   */
  moveGoals: Record<string, Vec2 | null>;
}

/**
 * A fully independent copy.
 *
 * Written explicitly rather than with structuredClone or a JSON round-trip because both
 * hide bugs this contract exists to prevent: JSON silently drops undefined and turns a
 * Map into {}, and either would produce a snapshot that looks fine and restores wrong.
 * The test that matters is that mutating the copy cannot touch the original - the
 * contract RollbackSession depends on, and the one my own reference simulation failed to
 * exercise last cycle because it never mutated its state.
 */
export function cloneWorldState(state: WorldState): WorldState {
  return {
    tick: state.tick,
    simTime: state.simTime,
    units: state.units.map((unit) => ({ ...unit, pos: { x: unit.pos.x, y: unit.pos.y } })),
    cooldowns: Object.fromEntries(
      Object.entries(state.cooldowns).map(([id, cds]) => [id, { ...cds }]),
    ),
    effects: Object.fromEntries(
      Object.entries(state.effects).map(([id, fx]) => [id, cloneEffectState(fx)]),
    ),
    /**
     * Copied, even though advanceChampionLife never mutates and returns the same object
     * when nothing changed - so sharing the reference would be safe today. It is copied
     * anyway because this function's promise is a fully independent copy, and honouring
     * that promise must not depend on an immutability convention maintained in another
     * file. Four scalar fields is not a cost worth trading a silent hazard for.
     */
    lives: Object.fromEntries(
      Object.entries(state.lives).map(([id, life]) => [id, { ...life }]),
    ),
    pendingImpacts: state.pendingImpacts.map(cloneImpact),
    nextInsertionOrder: state.nextInsertionOrder,
    moveGoals: Object.fromEntries(
      Object.entries(state.moveGoals).map(([id, goal]) => [id, goal ? { ...goal } : null]),
    ),
  };
}

/**
 * A pending impact, copied deeply enough that nothing in it is shared.
 *
 * Three levels, and each is a real hazard rather than defensive habit. The array itself,
 * because a replayed tick queues new casts. The impact object, because a resolution can adjust
 * it. And `source.pos` and the `line` box, because those are the geometry the hit is judged
 * against - share them and a champion moving after the shot was fired retroactively changes
 * where that shot was aimed, which is precisely the mid-flight independence the copy-at-cast
 * design was built to guarantee.
 */
function cloneImpact(impact: PendingImpact): PendingImpact {
  return {
    ...impact,
    source: { ...impact.source, pos: { ...impact.source.pos } },
    ...(impact.point ? { point: { ...impact.point } } : {}),
    ...(impact.line
      ? {
          line: {
            ...impact.line,
            origin: { ...impact.line.origin },
            endpoint: { ...impact.line.endpoint },
          },
        }
      : {}),
  };
}

/**
 * Each of the six arrays is rebuilt and each effect object copied.
 *
 * Spreading EffectState alone would be the exact bug the clone tests catch: the six
 * fields would be the SAME arrays, so pushing a slow onto the copy would slow the
 * original too. The per-effect spread matters for the same reason one level down - a
 * shield's `amount` is decremented as it absorbs damage, and a pull's destination is a
 * Vec2 that gets rewritten, so a shared effect object leaks mutations backwards through
 * the snapshot.
 */
export function cloneEffectState(state: EffectState): EffectState {
  return {
    shields: state.shields.map((e) => ({ ...e })),
    slows: state.slows.map((e) => ({ ...e })),
    armor: state.armor.map((e) => ({ ...e })),
    movement: state.movement.map((e) => ({ ...e })),
    pulls: state.pulls.map((e) => ({ ...e, destination: { ...e.destination } })),
    burns: state.burns.map((e) => ({ ...e })),
  };
}

/**
 * Advance the clock and run the tick's SINGLE effect expiry.
 *
 * One sweep per tick, deliberately, because that is what the scene does and because
 * expiry is the one effect operation that must not be driven by reads. See effects.ts:
 * strongestSlow and friends expire as they answer, which makes the world depend on the
 * pattern of queries instead of only on the inputs, and rollback replays a tick with a
 * different pattern.
 *
 * Expiry is applied AFTER the clock moves, so an effect whose expiry falls inside the
 * step is gone by the time anything reads it — matching the scene, where the sweep sits
 * at the top of the frame using the already-updated elapsed time.
 */
export function advanceEffects(state: WorldState, dt: number): void {
  state.simTime += dt;
  for (const fx of Object.values(state.effects)) {
    expireEffects(fx, state.simTime);
  }
}

/**
 * Advance every champion's life phase against the current clock.
 *
 * Nothing here is extracted arithmetic, and that is the finding rather than an omission:
 * championLifeState.ts already holds the only implementation, advanceChampionLife is
 * already pure, and its deadlines are already ABSOLUTE match times rather than
 * countdowns - which is the shape rollback needs, because a countdown decremented per
 * frame cannot be rewound without also knowing how many frames were undone. So this is a
 * per-side entry point, like advanceTimers, not a second copy.
 *
 * It does not move the clock. advanceEffects owns that, so a tick advances time once
 * however many subsystems read it - two subsystems each adding dt is a desync where the
 * order of calls decides the result.
 *
 * `unit.dead` is kept in step here because it is DERIVED from the life phase, and a
 * snapshot that restored a live phase beside a dead flag would describe a champion that
 * is both.
 */
/**
 * Queue a hit, stamping it with the next insertion order.
 *
 * The stamp is taken from the state rather than from a module-level counter, which is the
 * whole reason this function exists: a counter living outside the state would not be restored
 * by a rollback, so after a rewind the replayed casts would re-use numbers the restored queue
 * still holds.
 */
export function queueImpact(
  state: WorldState,
  impact: Omit<PendingImpact, 'insertionOrder'>,
): PendingImpact {
  const queued = { ...impact, insertionOrder: state.nextInsertionOrder } as PendingImpact;
  state.nextInsertionOrder += 1;
  state.pendingImpacts.push(queued);
  return queued;
}

/**
 * Take the hits that have come due, leaving the rest queued.
 *
 * Ordering comes from partitionImpacts, which breaks equal deadlines on insertionOrder — see
 * combat.ts for why array position could not do that job even in live play. The remainder is
 * written back so the queue never holds an entry twice.
 */
export function drainDueImpacts(state: WorldState): PendingImpact[] {
  const { due, pending } = partitionImpacts(state.pendingImpacts, state.simTime);
  state.pendingImpacts = pending;
  return due;
}

export function advanceLives(state: WorldState, mode: GameMode = 'conquest'): void {
  for (const [id, life] of Object.entries(state.lives)) {
    const next = advanceChampionLife(life, state.simTime, mode);
    state.lives[id] = next;
    const unit = state.units.find((candidate) => candidate.id === id);
    if (unit) unit.dead = !isChampionPresent(next);
  }
}
