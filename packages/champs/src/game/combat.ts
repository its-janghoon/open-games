/**
 * Pure combat math for the arena battle. This module deliberately contains NO
 * Phaser (or any DOM) imports so it can be exhaustively unit tested in a plain
 * jsdom/node environment and reused by both the player and the enemy bot.
 *
 * The rendering layer (BattleScene) owns the Phaser sprites and simply feeds
 * plain data through these helpers, then applies the returned results.
 */

import type { Ability, AbilityBehavior } from '../data/champions';

/** A 2D point in world space (Phaser pixels). */
export interface Vec2 {
  x: number;
  y: number;
}

/** Which side a unit belongs to. Neutral units are hostile to both teams. */
export type Team = 'ally' | 'enemy' | 'neutral';

/** Coarse classification of a combat entity, used for AI + targeting rules. */
export type UnitKind = 'champion' | 'minion' | 'turret' | 'nexus' | 'monster';

/**
 * A combat entity. Positions are kept here (rather than only on the sprite) so
 * combat/AI logic is fully testable without a renderer. The rendering layer
 * mirrors `pos` onto the Phaser game object each frame.
 */
export interface Unit {
  id: string;
  kind: UnitKind;
  team: Team;
  pos: Vec2;
  hp: number;
  maxHp: number;
  /** Attack damage applied by basic attacks. */
  ad: number;
  /** Flat armor; reduces incoming physical damage via the standard MOBA curve. */
  armor: number;
  /** Basic-attack reach in world units. */
  attackRange: number;
  /** Basic attacks per second. */
  attackSpeed: number;
  /** Movement speed in world units per second. */
  moveSpeed: number;
  /** Remaining seconds until this unit may basic-attack again. */
  attackCdRemaining: number;
  /** True once hp has reached zero. */
  dead: boolean;
}

/** Euclidean distance between two points. */
export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** True when two units may deal hostile damage to one another. */
export function areHostile(a: Team, b: Team): boolean {
  if (a === b) return false;
  return a === 'neutral' || b === 'neutral' || a !== b;
}

/**
 * Resolve ability damage with a modest ability-power ratio. Keeping this pure
 * ensures item and team objective power changes the authoritative impact.
 */
export function abilityDamage(baseDamage: number, abilityPower: number): number {
  const base = Number.isFinite(baseDamage) ? Math.max(0, baseDamage) : 0;
  const power = Number.isFinite(abilityPower) ? Math.max(0, abilityPower) : 0;
  return base + power * 0.6;
}

/** Absolute simulation time at which a projectile reaches its snapshotted aim. */
export function projectileImpactTime(
  nowSeconds: number,
  from: Vec2,
  to: Vec2,
  speed: number,
): number {
  const now = Number.isFinite(nowSeconds) ? Math.max(0, nowSeconds) : 0;
  if (!Number.isFinite(speed) || speed <= 0) return now;
  return now + distance(from, to) / speed;
}

/** A value with an absolute impact deadline, suitable for a deterministic queue. */
export interface TimedImpact {
  dueAt: number;
  /**
   * Monotonic order in which this entry was queued.
   *
   * Optional so existing callers keep working, but supply it wherever two entries can share
   * a deadline: it is what makes the tiebreak survive being serialized and restored.
   */
  insertionOrder?: number;
}

/**
 * Partition an impact queue without mutating it. Entries with equal deadlines keep their
 * queued order; pending entries are sorted by deadline.
 *
 * The tiebreak reads `insertionOrder` when it is present, and falls back to array position
 * otherwise. That distinction is the point of this function, so it is worth stating why.
 *
 * This used to break ties on array position alone. I assumed that was correct-by-accident in
 * a running match - impacts are appended in increasing insertion order, the sort is stable,
 * so position and insertion order should agree inductively - and that the defect was dormant
 * until a rollback restored a queue in some other order. Measuring a real conquest match
 * says otherwise: across 29 samples holding two or more queued impacts, 21 were out of
 * insertion order, with queues like [142, 143, 144, 141, 139, 145].
 *
 * The reason is this function's own output. `pending` comes back sorted by DEADLINE and the
 * scene assigns it straight back as the live queue, so from the second tick onward array
 * position tracks deadlines rather than cast order - and abilities differ in travel time, so
 * a later cast routinely holds an earlier deadline. Array position was never a proxy for
 * insertion order.
 *
 * So this is a live ordering defect, not only a rollback hazard. It bites when two impacts
 * share a deadline exactly, which is not hypothetical: a dash effect sets its deadline to the
 * current time, so two dashes resolved in one frame tie precisely. Ordering decides which of
 * two lethal hits lands first, hence who gets the kill and whether the other one hits a
 * corpse.
 */
export function partitionImpacts<T extends TimedImpact>(
  impacts: readonly T[],
  nowSeconds: number,
): { due: T[]; pending: T[] } {
  const now = Number.isFinite(nowSeconds) ? Math.max(0, nowSeconds) : 0;
  const indexed = impacts.map((impact, index) => ({
    impact,
    order: impact.insertionOrder ?? index,
  }));
  indexed.sort((a, b) => a.impact.dueAt - b.impact.dueAt || a.order - b.order);
  const due: T[] = [];
  const pending: T[] = [];
  for (const entry of indexed) {
    (entry.impact.dueAt <= now ? due : pending).push(entry.impact);
  }
  return { due, pending };
}

/** True when `target` is within `range` world units of `source`. */
export function inRange(source: Vec2, target: Vec2, range: number): boolean {
  return distance(source, target) <= range;
}

/**
 * Standard MOBA armor mitigation. Positive armor scales incoming damage by
 * `100 / (100 + armor)`; negative armor amplifies it. The result is clamped so
 * that damage never goes below zero.
 *
 * @returns the post-mitigation damage, rounded to an integer.
 */
export function effectiveDamage(rawDamage: number, armor: number): number {
  if (rawDamage <= 0) return 0;
  const multiplier =
    armor >= 0 ? 100 / (100 + armor) : 2 - 100 / (100 - armor);
  return Math.max(0, Math.round(rawDamage * multiplier));
}

/**
 * Apply `rawDamage` (pre-mitigation) to a unit, mutating its hp and `dead`
 * flag. Returns the actual damage dealt after armor, plus whether this blow was
 * lethal. Safe to call on an already-dead unit (deals nothing).
 */
export interface DamageResult {
  dealt: number;
  lethal: boolean;
}

export function applyDamage(target: Unit, rawDamage: number): DamageResult {
  if (target.dead || target.hp <= 0) {
    return { dealt: 0, lethal: false };
  }
  const mitigated = effectiveDamage(rawDamage, target.armor);
  const hpBefore = target.hp;
  const dealt = Math.min(hpBefore, mitigated);
  target.hp = Math.max(0, target.hp - mitigated);
  const lethal = hpBefore > 0 && target.hp === 0;
  if (lethal) {
    target.dead = true;
  }
  return { dealt, lethal };
}

/**
 * Advance a unit's basic-attack cooldown by `dt` seconds, clamping at zero.
 * This must be called EXACTLY ONCE per frame per unit. Turrets previously
 * decremented this both here (via the per-entity loop) and inside their own
 * update, which doubled their effective attack speed; keeping the decrement in
 * one place is what fixes that.
 */
export function advanceAttackCooldown(unit: Unit, dt: number): void {
  if (unit.attackCdRemaining > 0) {
    unit.attackCdRemaining = Math.max(0, unit.attackCdRemaining - dt);
  }
}

/** True when `unit` may basic-attack again (its attack cooldown has elapsed). */
export function canBasicAttack(unit: Unit): boolean {
  return unit.attackCdRemaining <= 0;
}

/**
 * Put a unit's basic attack on cooldown for one attack interval, derived from
 * its attack speed (attacks per second). Attack speed <= 0 disables attacks.
 */
export function resetAttackCooldown(unit: Unit): void {
  unit.attackCdRemaining = unit.attackSpeed > 0 ? 1 / unit.attackSpeed : Infinity;
}

/**
 * Restore health to a unit without exceeding its maximum. Dead units cannot be
 * healed. Returns the amount actually restored.
 */
export function applyHeal(target: Unit, amount: number): number {
  if (target.dead || amount <= 0) return 0;
  const healed = Math.min(amount, target.maxHp - target.hp);
  target.hp += healed;
  return Math.max(0, healed);
}

/**
 * Cooldown bookkeeping for a champion's four abilities plus resource (mana).
 * Kept as a small, serializable record so it is trivial to test and to mirror
 * into the React HUD.
 */
export type CooldownKey = 'Q' | 'W' | 'E' | 'R';

export interface CooldownState {
  Q: number;
  W: number;
  E: number;
  R: number;
}

export function createCooldownState(): CooldownState {
  return { Q: 0, W: 0, E: 0, R: 0 };
}

/** True when the ability in `slot` is off cooldown (ready to cast). */
export function isReady(cds: CooldownState, slot: CooldownKey): boolean {
  return cds[slot] <= 0;
}

/** Put an ability on cooldown for `seconds`. */
export function startCooldown(
  cds: CooldownState,
  slot: CooldownKey,
  seconds: number,
): void {
  cds[slot] = seconds;
}

/**
 * Advance all cooldowns by `dt` seconds, clamping at zero. Returns the same
 * object for convenience.
 */
export function tickCooldowns(cds: CooldownState, dt: number): CooldownState {
  cds.Q = Math.max(0, cds.Q - dt);
  cds.W = Math.max(0, cds.W - dt);
  cds.E = Math.max(0, cds.E - dt);
  cds.R = Math.max(0, cds.R - dt);
  return cds;
}

/** Progress from 0 (just cast) to 1 (ready) for HUD radial fills. */
export function cooldownProgress(
  cds: CooldownState,
  slot: CooldownKey,
  totalCooldown: number,
): number {
  if (totalCooldown <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - cds[slot] / totalCooldown));
}

/**
 * The outcome of resolving an ability. `damage` is pre-mitigation (armor is
 * applied when it lands on each target). `heal` is applied directly. `dashTo`,
 * when present, tells the caster where to reposition. The rendering layer maps
 * these to VFX; the numbers are all decided here for testability.
 */
export interface AbilityEffect {
  behavior: AbilityBehavior;
  /** Pre-mitigation damage dealt to each affected enemy (0 if none). */
  damage: number;
  /** Health restored to the caster/ally (0 if none). */
  heal: number;
  /** Seconds of crowd control applied to hit enemies (0 if none). */
  stunDuration: number;
  /** Seconds of self-buff applied to the caster (0 if none). */
  buffDuration: number;
  /** True when the caster should dash toward the aim point. */
  dashes: boolean;
  /** True when the effect strikes an area rather than a single target. */
  area: boolean;
  /** Effective radius/length for area or skillshot effects (world units). */
  radius: number;
}

/**
 * Resolve an ability definition into a concrete, behavior-driven effect. This
 * is the single source of truth the player and the bot both use, so tests here
 * guarantee every behavior tag maps to the expected combat outcome.
 */
export function resolveAbility(ability: Ability): AbilityEffect {
  const base: AbilityEffect = {
    behavior: ability.behavior,
    damage: 0,
    heal: 0,
    stunDuration: 0,
    buffDuration: 0,
    dashes: false,
    area: false,
    radius: ability.range,
  };

  switch (ability.behavior) {
    case 'skillshot':
      return { ...base, damage: ability.damage };
    case 'aoe':
      return { ...base, damage: ability.damage, area: true, radius: 220 };
    case 'dash':
      // Dashes reposition and, when they carry damage, strike on arrival.
      return { ...base, damage: ability.damage, dashes: true };
    case 'stun':
      return { ...base, damage: ability.damage, stunDuration: 1.25 };
    case 'heal':
      // Heals restore a fixed pool; damaging heals (none currently) still work.
      return {
        ...base,
        heal: ability.damage > 0 ? ability.damage : 180,
        damage: 0,
      };
    case 'buff':
      return { ...base, buffDuration: 3, damage: ability.damage };
    default:
      return base;
  }
}

/**
 * Find the nearest living enemy unit to `from`, optionally within `maxRange`.
 *
 * Ties are resolved deterministically: a strictly-closer candidate wins, so
 * among equidistant units the FIRST one scanned is kept. This avoids target
 * flicker between overlapping units (e.g. stacked minions) frame to frame.
 */
export function nearestEnemy(
  from: Unit,
  units: readonly Unit[],
  maxRange = Infinity,
): Unit | undefined {
  let best: Unit | undefined;
  let bestDist = maxRange;
  for (const unit of units) {
    if (unit.dead || !areHostile(unit.team, from.team)) continue;
    const d = distance(from.pos, unit.pos);
    if (best === undefined ? d <= bestDist : d < bestDist) {
      bestDist = d;
      best = unit;
    }
  }
  return best;
}

/**
 * Keep an existing valid target until it leaves range or becomes invalid,
 * otherwise acquire the deterministic nearest hostile. This prevents stacked
 * combatants from changing targets every simulation frame.
 */
export function persistentEnemy(
  from: Unit,
  units: readonly Unit[],
  currentTargetId: string | null,
  maxRange = Infinity,
  eligible: (unit: Unit) => boolean = () => true,
): Unit | undefined {
  if (currentTargetId) {
    const current = units.find((unit) => unit.id === currentTargetId);
    if (
      current &&
      !current.dead &&
      eligible(current) &&
      areHostile(from.team, current.team) &&
      distance(from.pos, current.pos) <= maxRange
    ) {
      return current;
    }
  }
  return nearestEnemy(from, units.filter(eligible), maxRange);
}

/**
 * A team's protective structure line. A nexus cannot be damaged while its own
 * turret still stands, mirroring the MOBA rule that you must down the turret
 * before diving the base. `nexusId` is the structure the turret shields.
 */
export interface StructureLine {
  turretId: string;
  nexusId: string;
}

/**
 * True when `target` may currently be attacked by `attacker`, given the
 * structure-gating rules. Non-structure targets are always attackable. A nexus
 * is only attackable once the turret guarding it (same team) has fallen.
 *
 * `livingUnitIds` is the set of ids of units that are still alive; the guarding
 * turret shields the nexus while its id is present in that set.
 */
export function isTargetable(
  target: Unit,
  lines: readonly StructureLine[],
  livingUnitIds: ReadonlySet<string>,
): boolean {
  if (target.dead) return false;
  if (target.kind !== 'nexus') return true;
  const line = lines.find((l) => l.nexusId === target.id);
  if (!line) return true;
  // Nexus is shielded while its guarding turret is still alive.
  return !livingUnitIds.has(line.turretId);
}

/**
 * Find the nearest living, currently-targetable enemy unit to `from`.
 *
 * Layers structure-gating on top of `nearestEnemy`: a nexus behind a living
 * turret is skipped entirely so a push must clear the turret before the base
 * can be touched. When `preferStructures` is true, a reachable enemy structure
 * (turret, then an unshielded nexus) outranks softer targets so a unit standing
 * on the objective commits to it instead of chasing minions; when false, plain
 * deterministic-nearest is used among the targetable set.
 */
export function nearestTargetableEnemy(
  from: Unit,
  units: readonly Unit[],
  lines: readonly StructureLine[],
  livingUnitIds: ReadonlySet<string>,
  maxRange = Infinity,
  preferStructures = false,
): Unit | undefined {
  const eligible = units.filter(
    (u) =>
      !u.dead &&
      areHostile(u.team, from.team) &&
      distance(from.pos, u.pos) <= maxRange &&
      isTargetable(u, lines, livingUnitIds),
  );
  if (eligible.length === 0) return undefined;

  const nearestOfKinds = (kinds: readonly UnitKind[]): Unit | undefined => {
    let best: Unit | undefined;
    let bestDist = Infinity;
    for (const u of eligible) {
      if (!kinds.includes(u.kind)) continue;
      const d = distance(from.pos, u.pos);
      if (d < bestDist) {
        bestDist = d;
        best = u;
      }
    }
    return best;
  };

  if (preferStructures) {
    // Turret first, then an unshielded nexus, then living units.
    return (
      nearestOfKinds(['turret']) ??
      nearestOfKinds(['nexus']) ??
      nearestOfKinds(['champion', 'minion', 'monster'])
    );
  }

  return nearestOfKinds(['champion', 'minion', 'monster', 'turret', 'nexus']);
}

/** Move `unit` toward `target` by up to `unit.moveSpeed * dt`, mutating pos. */
export function stepToward(unit: Unit, target: Vec2, dt: number): void {
  const dx = target.x - unit.pos.x;
  const dy = target.y - unit.pos.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return;
  const travel = Math.min(dist, unit.moveSpeed * dt);
  unit.pos.x += (dx / dist) * travel;
  unit.pos.y += (dy / dist) * travel;
}
