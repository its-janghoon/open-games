import type { GameMode } from './battleStore';
import {
  advanceChampionLife,
  isChampionPresent,
  type ChampionLifeState,
} from './championLifeState';
import { expireEffects, type EffectState } from './effects';
import { advanceGold, type ChampionLevel, type GoldState } from './rift/economy';
import type { StructureState } from './rift/structures';
import { cloneWaveSchedule, initialWaveSchedule, type WaveSchedule } from './rift/waveSchedule';
import { cloneMinions, type MinionState } from './rift/minionBodies';
import type { TargetTable } from './rift/minionCombat';
import { clonePassiveState, createPassiveState, type PassiveState } from './rift/passives';
import { noBaronBuff } from './rift/objectives';
import { cloneAutoAttackers, type AutoAttacker } from './rift/autoAttack';
import { cloneResources, type ResourceState } from './rift/resources';
import { cloneTraps, type TrapState } from './rift/traps';
import {
  cloneCampMembers,
  cloneCampSpawns,
  type CampMemberState,
  type CampSpawnState,
} from './rift/campCombat';
import {
  cloneBaron,
  cloneBuffs,
  cloneObjectives,
  cloneWardenCharges,
  type ObjectiveState,
  type SideState,
} from './rift/fieldState';
import type { BuffState } from './rift/jungle';
import type { BaronBuffState } from './rift/objectives';
import type { WardenCharge } from './wardenPolicy';
import {
  cloneTeamFacts,
  createTeamFacts,
  ongoing,
  type MatchOutcome,
  type RecallTable,
  type TeamFactsTable,
} from './rift/matchFlow';
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

/**
 * Advance every participant's passive gold by one tick.
 *
 * Pure and returning a new record, unlike advanceTimers next door which mutates in place. The difference is not
 * inconsistency for its own sake: advanceGold is pure because its carry arithmetic is the thing most worth testing in
 * isolation, and a record step that wrapped it in mutation would hand the caller a half-pure seam that is easy to
 * misuse.
 */
export function advanceEconomy(
  economy: Record<string, GoldState>,
  dt: number,
): Record<string, GoldState> {
  const next: Record<string, GoldState> = {};
  for (const [id, gold] of Object.entries(economy)) next[id] = advanceGold(gold, dt);
  return next;
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
 * Still incomplete, but less so than this comment used to claim: effects, champion life, the impact queue, move
 * goals, gold, structures and the minion wave SCHEDULE are all in it. What remains scene-only is minion bodies —
 * their movement, combat and death. Declaring a full world
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
  /**
   * Passive gold per participant.
   *
   * The last of these to go in and the one whose absence was hardest to see, because gold does not move anything on
   * screen. It decides PURCHASES, so two peers who disagree about gold buy different items, get different stats and
   * from there diverge on every trade — a desync that surfaces minutes later as damage numbers that do not match,
   * with nothing about the moment it started to point at.
   *
   * The fractional `accrual` inside each entry is the fragile half: 2.04 gold per second against a 1/30 s tick means
   * whole gold lands only every fifteenth tick and the remainder is carried. Restore the gold but not the carry and
   * each rollback drifts a participant by up to 1.
   */
  economy: Record<string, GoldState>;
  /**
   * Structures, by id.
   *
   * A record rather than the Map the scene keeps, because a Map cannot be snapshotted — the clone contract below
   * documents that a JSON round-trip flattens one to {}. The scene's inhibitor kill times lived in exactly that
   * shape, which is the concrete reason structure state could never be rewound.
   *
   * Their health is what the match outcome is computed from, so a rollback that restores champions but not
   * structures lets the two peers disagree about whether the game is already over.
   */
  structures: Record<string, StructureState>;
  /**
   * The minion wave schedule.
   *
   * Decides WHICH minions exist and WHEN, so two peers that disagree about it disagree about the population of the
   * map. A rollback restoring champions while dropping queued spawns would delete minions already scheduled.
   *
   * Scheduling only: minion BODIES — movement, combat, death — are still advanced inside BattleScene, so a whole
   * match is not yet rollback-proven. Named here rather than left for a reader to discover.
   */
  waves: WaveSchedule;
  /**
   * Live minions.
   *
   * The schedule decided WHICH minions exist and WHEN; this is what they then do. Their bodies were already plain data
   * and advanceMinion was already pure, so what was missing was never the walk — it was the LIST. A rollback that
   * restored champions into a world holding whatever minions the scene happened to have is a rollback that disagrees
   * about the population of the map.
   *
   * Movement, admission AND combat. What is still scene-only is champion basic-attack passives, which live in three
   * further Maps (passiveCounters, internalCooldowns, sunfireHitAt) and are a separate slice.
   */
  minions: MinionState[];
  /**
   * Which unit each attacker is locked on to.
   *
   * A real hole, not a new feature. The scene keeps this as a Map so a unit stays locked on rather than re-acquiring
   * every tick — which is BEHAVIOUR: a unit that re-picked the nearest enemy each tick would flick between two
   * equidistant targets and land its damage on neither. Being a Map it could never be snapshotted, so a rollback
   * restored positions and health but not who was shooting whom, and two peers could share every position while
   * disagreeing about that.
   */
  targets: TargetTable;
  /**
   * Champion basic-attack passive state.
   *
   * The most deceptive gap of the set: it lived in three Maps and nothing about it is visible on screen — it only
   * changes how much damage a swing does. So losing it in a rollback gave two peers identical positions, identical
   * health bars and different damage numbers, which is the desync that surfaces minutes later with nothing left
   * pointing at where it began.
   *
   * The BASIC-ATTACK subset only, and the boundary is worth stating because the name would otherwise over-promise:
   * duskarrow's travel, nightveil's dash window, ashborne's stacks, sunfire's per-pair timer and the red buff. Two
   * Maps remain on the scene holding the passives that are NOT here — nightveil's smoke, aegis, ironhold, reflect and
   * an ability-side stack counter — because those are read by abilities and damage-taken paths rather than by a swing.
   */
  passives: PassiveState;
  /** Recall channels, keyed by participant. Absolute start times — see the RecallTable note. */
  recalls: RecallTable;
  /** What a result is scored from. Read by the resolution check, so two peers must agree on it. */
  teamFacts: TeamFactsTable;
  /**
   * Whether the match is decided.
   *
   * The step READS it to stop advancing, so it is snapshot state for the same reason Gridfall's outcome is. Ringout's
   * round tally is the opposite case and sits outside its state, because nothing in that simulation reads it.
   */
  outcome: MatchOutcome;
  /**
   * Turrets and objective monsters, as far as attacking is concerned.
   *
   * Their per-tick rule is one rule, not two — the scene's updateTurret and updateObjectiveMonsters differ only in range,
   * damage, colour and a stun check. Their cooldowns and stuns were scene-side, so a rollback restored a turret's
   * position and health while its next shot landed on whatever frame the scene happened to be on.
   */
  autoAttackers: AutoAttacker[];
  /**
   * Ability resource per participant.
   *
   * Behavioural, not cosmetic: resource gates whether an ability can be cast, so two peers holding different amounts make
   * different decisions from the same inputs. The bot AI was never the determinism problem — it is already a pure
   * function of a snapshot — but the state it READS was.
   */
  resources: Record<string, ResourceState>;
  /** Armed ground traps. Absolute expiry, so a rewind needs no knowledge of how many ticks were undone. */
  traps: TrapState[];
  /** Jungle camps and their living members. The members were Phaser Entities, so a snapshot could not hold them at all. */
  camps: CampSpawnState[];
  campMembers: CampMemberState[];
  /** Per-participant jungle buffs. Blue's resource regen is read from here, which is why it had to join the snapshot. */
  buffs: Record<string, BuffState>;
  /** Per-side tyrant buff. */
  baron: SideState<BaronBuffState>;
  /**
   * Champion level and banked XP, per participant.
   *
   * The THIRD field found missing from this state rather than merely unadopted, after `dragonStacks` and the epic-monster
   * count. It is not a summary: `statsForLevel` scales health, attack damage, armour and ability power off the level, so
   * two peers holding different levels field differently-statted champions from identical inputs. A rollback over a state
   * without it restores gold and cooldowns perfectly and drifts on every stat.
   *
   * Separate from `economy` because gold and progression are separate rules with separate storage in the pure layer --
   * `GoldState` carries accrual and lifetime earnings, `ChampionLevel` carries the level ladder -- and folding them would
   * put a fractional gold accumulator next to an XP threshold for no reason beyond both being "progress".
   */
  progression: Record<string, ChampionLevel>;
  /**
   * Dragon stacks per side.
   *
   * Added when the scene's adoption reached the objectives and found this had no home here at all — which is worth
   * recording, because it means the field list was INCOMPLETE rather than merely unadopted. It is unambiguous authority:
   * `dragonStackBonus` turns the count into attack damage, ability power, armour and health for the whole team, so two
   * peers holding different counts field differently-statted champions. A rollback over a state without it would restore
   * every position and hit point correctly and still drift, which is the hardest kind of divergence to attribute.
   *
   * The lesson generalises: "the Pick covers WorldState" is not the finish line for the adoption. "The scene holds no
   * simulation authority outside the container" is.
   */
  dragonStacks: SideState<number>;
  /** Epic-monster spawn slots, without the Phaser entity the scene pairs with each one. */
  objectives: ObjectiveState[];
  /** A held warden charge per side, or null. */
  wardenCharges: SideState<WardenCharge | null>;
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
    units: state.units.map((unit) => ({ ...unit, pos: { x: unit.pos.x, y: unit.pos.y } })),
    effects: Object.fromEntries(
      Object.entries(state.effects).map(([id, fx]) => [id, cloneEffectState(fx)]),
    ),
    structures: Object.fromEntries(
      Object.entries(state.structures).map(([id, structure]) => [id, { ...structure }]),
    ),
    minions: cloneMinions(state.minions),
    autoAttackers: cloneAutoAttackers(state.autoAttackers),
    traps: cloneTraps(state.traps),
    camps: cloneCampSpawns(state.camps),
    campMembers: cloneCampMembers(state.campMembers),
    objectives: cloneObjectives(state.objectives),
    moveGoals: Object.fromEntries(
      Object.entries(state.moveGoals).map(([id, goal]) => [id, goal ? { ...goal } : null]),
    ),
    // Last, so the adopted fields come from the one helper the scene also uses. See {@link AdoptedWorld}.
    ...cloneAdoptedWorld(state),
  };
}

/**
 * The fields of {@link WorldState} that BattleScene has adopted as its OWN storage.
 *
 * This type is a progress ledger the compiler enforces, and it exists because of a hazard in the obvious plan. Rollback
 * needs the scene to hold a WorldState; the scene holds twenty-odd private fields instead; so the tempting move is to
 * give it a `WorldState` up front and fill the fields in as they are migrated. Do that and the half-built object is
 * indistinguishable from a real one — every unmigrated field reads as an empty array or a zeroed record, and the first
 * thing to snapshot it would faithfully save a match with no minions in it and "restore" the game to that.
 *
 * So the scene holds a `Pick` instead. A field is added here only once the scene actually keeps it here, which means an
 * unmigrated field is a COMPILE error at every use rather than a silent empty value. When this list names every field in
 * WorldState the two types are the same type, `cloneWorldState(scene.world)` type-checks, and the adoption is done. Until
 * then the type says exactly how far it has got.
 *
 * Migrated so far: the match clock (`tick` / `simTime`), the impact insertion counter, the passive ledger and the held
 * warden charges. The two that were already exactly their WorldState shape went first; a slice that also has to change
 * shape (the target table is a `Map` in the scene and a `Record` here) hides a reshaping bug inside a move.
 *
 * ONE HAZARD is now live and must be respected by the next slices. The scene DERIVES `simTime` from the tick
 * (`tick * SIMULATION_TICK_SECONDS`, clamped at the match hard cap), while {@link advanceEffects} ACCUMULATES it
 * (`simTime += dt`). Both are correct alone and they agree at a fixed step, but they must not both run against the same
 * state or the clock advances twice per tick. The scene does not call advanceEffects today; adopting `effects` therefore
 * means giving the clock a single owner FIRST, not merely moving a field. Deriving from the tick is the one to keep —
 * accumulation drifts, and a rewind restores an exact tick.
 */
export type AdoptedWorld = Pick<
  WorldState,
  | 'tick'
  | 'simTime'
  | 'nextInsertionOrder'
  | 'targets'
  | 'passives'
  | 'wardenCharges'
  | 'baron'
  | 'dragonStacks'
  | 'pendingImpacts'
  | 'waves'
  | 'outcome'
  | 'recalls'
  | 'teamFacts'
  | 'cooldowns'
  | 'resources'
  | 'economy'
  | 'progression'
  | 'buffs'
  | 'lives'
>;

/** The adopted slice at match start. */
export function createAdoptedWorld(): AdoptedWorld {
  return {
    tick: 0,
    simTime: 0,
    nextInsertionOrder: 0,
    targets: {},
    passives: createPassiveState(),
    wardenCharges: { ally: null, enemy: null },
    baron: { ally: noBaronBuff(), enemy: noBaronBuff() },
    dragonStacks: { ally: 0, enemy: 0 },
    pendingImpacts: [],
    waves: initialWaveSchedule(),
    outcome: ongoing(),
    recalls: {},
    teamFacts: createTeamFacts(),
    cooldowns: {},
    resources: {},
    economy: {},
    progression: {},
    buffs: {},
    lives: {},
  };
}

/**
 * A fully independent copy of the adopted slice.
 *
 * {@link cloneWorldState} delegates to this rather than repeating the per-field calls, so a field cannot end up deep
 * copied in one path and shared in the other — which is the failure mode that would show up as a rollback that mostly
 * works.
 */
export function cloneAdoptedWorld(world: AdoptedWorld): AdoptedWorld {
  return {
    tick: world.tick,
    simTime: world.simTime,
    nextInsertionOrder: world.nextInsertionOrder,
    targets: { ...world.targets },
    passives: clonePassiveState(world.passives),
    wardenCharges: cloneWardenCharges(world.wardenCharges),
    baron: cloneBaron(world.baron),
    dragonStacks: { ...world.dragonStacks },
    pendingImpacts: world.pendingImpacts.map(cloneImpact),
    waves: cloneWaveSchedule(world.waves),
    // Spread rather than shared: the union's payload is strings today, and sharing would leak a rewritten winner back
    // into a snapshot the rollback still needs.
    outcome: { ...world.outcome },
    recalls: { ...world.recalls },
    teamFacts: cloneTeamFacts(world.teamFacts),
    cooldowns: Object.fromEntries(
      Object.entries(world.cooldowns).map(([id, cds]) => [id, { ...cds }]),
    ),
    resources: cloneResources(world.resources),
    economy: Object.fromEntries(
      Object.entries(world.economy).map(([id, gold]) => [id, { ...gold }]),
    ),
    progression: Object.fromEntries(
      Object.entries(world.progression).map(([id, level]) => [id, { ...level }]),
    ),
    buffs: cloneBuffs(world.buffs),
    /**
     * Copied, even though advanceChampionLife never mutates and returns the same object when nothing changed — so sharing
     * the reference would be safe today. It is copied anyway because this function's promise is a fully independent copy,
     * and honouring that promise must not depend on an immutability convention maintained in another file.
     */
    lives: Object.fromEntries(
      Object.entries(world.lives).map(([id, life]) => [id, { ...life }]),
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
