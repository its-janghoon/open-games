import { areHostile, distance, type Unit } from '../combat';
import type { TargetTable } from './minionCombat';

/**
 * Auto-attackers: turrets and objective monsters.
 *
 * One module for both because their per-tick rule turned out to be the SAME rule — find a hostile in range, and if the
 * attack is off cooldown, launch a projectile and reset. `updateTurret` and `updateObjectiveMonsters` in BattleScene are
 * 16 and 26 lines and differ only in range, damage, projectile colour and a stun check. Extracting them separately
 * would have produced two copies of one rule, which is how the gold accrual came to be written twice.
 *
 * Neither needed new arithmetic: `projectileImpactTime` was already pure, and the impact queue with its monotonic
 * counter is already snapshot state. What was missing was the attacker's own state and a step over the list.
 */

/**
 * A turret or monster, as far as attacking is concerned.
 *
 * Deliberately not `Unit`: a turret in the scene is an Entity wrapping a Unit wrapping Phaser objects, and only these
 * fields decide whether and what it shoots.
 */
export interface AutoAttacker {
  id: string;
  team: Unit['team'];
  pos: { x: number; y: number };
  ad: number;
  attackRange: number;
  /**
   * Seconds until the next swing.
   *
   * A countdown, and that is fine BECAUSE it is in the snapshot — a restored value needs no knowledge of how many ticks
   * were undone. The rule this codebase repeats, that a countdown cannot be rewound, is about one held OUTSIDE the state:
   * those have to become absolute deadlines because nothing restores them. Worth stating precisely, since the stronger
   * version of the rule would forbid this field for no reason.
   */
  attackCdRemaining: number;
  /** Seconds of stun left. Same reasoning as the cooldown. */
  stunned: number;
  dead: boolean;
}

/** What the caller should queue. Plain data, so the step never touches the queue itself. */
export interface QueuedShot {
  sourceId: string;
  targetId: string;
  rawDamage: number;
  /** Seconds of flight, for the caller to turn into an absolute dueAt against its own clock. */
  flightSeconds: number;
}

export interface AutoAttackResult {
  attackers: AutoAttacker[];
  targets: TargetTable;
  shots: QueuedShot[];
}

/** Flight time for a projectile covering `gap` units at `speed` units per second. */
export function flightTime(gap: number, speed: number): number {
  return speed > 0 ? gap / speed : 0;
}

/**
 * Run one tick for every auto-attacker.
 *
 * Pure, and shots are RETURNED rather than queued: the caller owns the impact queue and its insertion counter, and a
 * step that reached into both would be doing two jobs and could not be tested alone. It also keeps the counter's
 * monotonicity in exactly one place, which is the property that lets equal deadlines be ordered at all.
 */
export function resolveAutoAttacks(
  attackers: readonly AutoAttacker[],
  enemies: readonly Unit[],
  targets: TargetTable,
  dt: number,
  projectileSpeed: number,
): AutoAttackResult {
  const nextTargets: TargetTable = { ...targets };
  const shots: QueuedShot[] = [];

  const advanced = attackers.map((attacker) => {
    const cooldown = Math.max(0, attacker.attackCdRemaining - dt);
    const stunned = Math.max(0, attacker.stunned - dt);
    const base = { ...attacker, pos: { ...attacker.pos }, attackCdRemaining: cooldown, stunned };

    if (attacker.dead || stunned > 0) {
      // A dead or stunned attacker holds no lock. Leaving one would let it resume mid-fight on a target that has since
      // walked away, which no peer could predict.
      nextTargets[attacker.id] = null;
      return base;
    }

    const reachable = enemies.filter(
      (enemy) =>
        !enemy.dead &&
        areHostile(enemy.team, attacker.team) &&
        distance(attacker.pos, enemy.pos) <= attacker.attackRange,
    );

    // Hold the current lock while it is still reachable, as the scene does — otherwise a turret would re-pick every tick
    // and split its fire between two equidistant enemies instead of killing either.
    const currentId = nextTargets[attacker.id] ?? null;
    const held = currentId ? reachable.find((enemy) => enemy.id === currentId) : undefined;
    const chosen =
      held ??
      [...reachable].sort(
        (a, b) =>
          distance(attacker.pos, a.pos) - distance(attacker.pos, b.pos) || a.id.localeCompare(b.id),
      )[0];

    nextTargets[attacker.id] = chosen?.id ?? null;
    if (!chosen || cooldown > 0) return base;

    shots.push({
      sourceId: attacker.id,
      targetId: chosen.id,
      rawDamage: attacker.ad,
      flightSeconds: flightTime(distance(attacker.pos, chosen.pos), projectileSpeed),
    });
    // The interval is the caller's, taken from the attacker's own stats rather than a constant here, because a turret and
    // a monster do not fire at the same rate.
    return { ...base, attackCdRemaining: attackIntervalFor(attacker) };
  });

  return { attackers: advanced, targets: nextTargets, shots };
}

/**
 * Seconds between swings for an auto-attacker.
 *
 * One function rather than a field so the rule lives somewhere testable. Turrets and monsters both fire on a fixed
 * interval in the scene; deriving it here keeps the step free of a magic number.
 */
export function attackIntervalFor(attacker: Pick<AutoAttacker, 'attackRange'>): number {
  // Longer reach fires more slowly, which is what keeps a long-range turret from out-damaging everything near it.
  return attacker.attackRange > 300 ? 1.4 : 1;
}

/** A fully independent copy — pos is an object a shallow copy would share. */
export function cloneAutoAttackers(attackers: readonly AutoAttacker[]): AutoAttacker[] {
  return attackers.map((attacker) => ({ ...attacker, pos: { ...attacker.pos } }));
}
