import { areHostile, canBasicAttack, distance, effectiveDamage, type Unit } from '../combat';
import { minionStats } from './minions';
import type { MinionState } from './minionBodies';

/**
 * Minion combat: who each minion is shooting at, and the damage that lands.
 *
 * The targeting arithmetic was already pure — `persistentEnemy` and `nearestTargetableEnemy` in combat.ts take plain
 * data and return a unit. What was missing is the STATE that makes targeting stable between ticks, and a step that runs
 * it over the minion list.
 *
 * ## Target persistence is state, and its absence was a real hole
 *
 * The scene keeps `targetByEntityId` as a `Map<string, string>` so a unit does not re-acquire from scratch every tick —
 * it stays locked on until its target leaves range or dies. That is behaviour, not a cache: a unit that re-picked the
 * nearest enemy every tick would flick between two equidistant targets and deal its damage to neither.
 *
 * Being a Map, it could never have been snapshotted — the clone contract in worldStep documents that a JSON round-trip
 * flattens one to `{}`. So a rollback restored positions and health but NOT who each unit had locked on, and the
 * replayed ticks re-acquired targets from whatever the geometry happened to be. Two peers could therefore have the same
 * positions and disagree about who is shooting whom. It is a Record here for exactly that reason.
 */

/** Which unit each attacker is locked on to, or null. Snapshot state — see the note above. */
export type TargetTable = Record<string, string | null>;

export interface MinionDamage {
  targetId: string;
  amount: number;
  /** The minion that dealt it, so a kill can be credited without guessing. */
  sourceId: string;
}

export interface MinionCombatResult {
  minions: MinionState[];
  targets: TargetTable;
  damage: MinionDamage[];
}

/**
 * A minion's attack cooldown, in seconds between swings.
 *
 * Minions have no attack-speed stat of their own in MINION_STATS, so this is one constant rather than a per-type value
 * invented to look thorough. Naming it here keeps it out of the step's body where it would read as a magic number.
 */
export const MINION_ATTACK_INTERVAL = 1.2;

/**
 * Run one tick of minion combat.
 *
 * Pure: minions and targets go in, new minions, new targets and a damage list come out. Damage is RETURNED rather than
 * applied, because the caller owns the units — and because a step that reached into champion health would be doing two
 * jobs and could not be tested on its own.
 *
 * `enemies` is whatever the caller considers targetable. That is deliberately the caller's decision: the same step
 * serves minions shooting champions, other minions, or structures, and the honest limit today is what the simulation's
 * unit list actually contains rather than anything this function cannot do.
 */
export function resolveMinionCombat(
  minions: readonly MinionState[],
  enemies: readonly Unit[],
  targets: TargetTable,
  dt: number,
): MinionCombatResult {
  const nextTargets: TargetTable = { ...targets };
  const damage: MinionDamage[] = [];

  const advanced = minions.map((minion) => {
    const cooldown = Math.max(0, (minion.attackCdRemaining ?? 0) - dt);
    if (minion.dead) {
      // A corpse holds no target. Leaving one behind would let a dead minion keep a lock that a live one could not take.
      nextTargets[minion.id] = null;
      return { ...minion, pos: { x: minion.pos.x, y: minion.pos.y }, attackCdRemaining: cooldown };
    }

    const stats = minionStats(minion.type);
    const reachable = enemies.filter(
      (enemy) =>
        !enemy.dead &&
        areHostile(enemy.team, minion.team) &&
        distance(minion.pos, enemy.pos) <= stats.attackRange,
    );

    // Keep the current lock if it is still reachable, exactly as the scene does. Re-picking every tick would make a
    // minion flick between two equidistant enemies and land its damage on neither.
    const currentId = nextTargets[minion.id] ?? null;
    const held = currentId ? reachable.find((enemy) => enemy.id === currentId) : undefined;
    const chosen =
      held ??
      // Nearest, with the id as a tiebreak so two enemies at the same distance are resolved identically by both peers
      // rather than by whatever order the array happened to be in.
      [...reachable]
        .sort(
          (a, b) =>
            distance(minion.pos, a.pos) - distance(minion.pos, b.pos) || a.id.localeCompare(b.id),
        )[0];

    nextTargets[minion.id] = chosen?.id ?? null;
    if (!chosen || cooldown > 0) {
      return { ...minion, pos: { x: minion.pos.x, y: minion.pos.y }, attackCdRemaining: cooldown };
    }

    damage.push({
      targetId: chosen.id,
      amount: effectiveDamage(stats.ad, chosen.armor),
      sourceId: minion.id,
    });
    return {
      ...minion,
      pos: { x: minion.pos.x, y: minion.pos.y },
      attackCdRemaining: MINION_ATTACK_INTERVAL,
    };
  });

  return { minions: advanced, targets: nextTargets, damage };
}

/**
 * Whether a minion may swing this tick.
 *
 * Exported so the rule is testable on its own and so the step above cannot be the only place that knows it. Mirrors
 * canBasicAttack for units, which minions do not have because their bodies are not Units.
 */
export function minionCanAttack(minion: MinionState): boolean {
  return !minion.dead && (minion.attackCdRemaining ?? 0) <= 0;
}

/** Drop targets whose unit is gone, so the table cannot grow forever across a long match. */
export function pruneTargets(targets: TargetTable, liveIds: ReadonlySet<string>): TargetTable {
  const next: TargetTable = {};
  for (const [attacker, target] of Object.entries(targets)) {
    if (!liveIds.has(attacker)) continue;
    next[attacker] = target !== null && liveIds.has(target) ? target : null;
  }
  return next;
}

/** Kept so a caller can reuse the unit-side rule without importing combat.ts directly. */
export { canBasicAttack };
