import {
  advanceAttackCooldown,
  distance,
  tickCooldowns,
  type CooldownState,
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
  units: Unit[];
  /** Ability cooldowns per participant id. */
  cooldowns: Record<string, CooldownState>;
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
    units: state.units.map((unit) => ({ ...unit, pos: { x: unit.pos.x, y: unit.pos.y } })),
    cooldowns: Object.fromEntries(
      Object.entries(state.cooldowns).map(([id, cds]) => [id, { ...cds }]),
    ),
  };
}
