import { distance } from '../combat';
import { attackIntervalFor } from './autoAttack';
import { basicAttackBonus, type PassiveState } from './passives';

/**
 * What a champion's basic attack DOES, as a plan the caller performs.
 *
 * `BattleScene.tryBasicAttackUnit` was the last per-tick combat authority still living in the scene. Its passive
 * arithmetic already came from {@link basicAttackBonus}; what stayed behind was the part that decides whether the swing
 * happens at all, how hard it lands, how it travels, and when the next one is allowed. All four have to agree between
 * peers, so all four move here. The pose, the flare and the projectile line do not have to agree, and stay in the scene.
 *
 * This is a PLAN and not a mutation for the same reason {@link import('./autoAttack').resolveAutoAttacks} returns shots:
 * the impact queue and its insertion counter belong to the caller, and a step that reached into them could not be tested
 * on its own.
 *
 * Deliberately NOT reusing `resolveAutoAttacks`. A turret and a champion look similar for one line — find a hostile in
 * range, fire, reset — and then diverge completely: a champion carries items, buffs and champion-specific passives, picks
 * no target of its own (the caller has already chosen one, by player order or by bot policy), and cancels a recall by
 * attacking. Folding the two together would mean a parameter for every difference, which is how one shared rule becomes
 * a special case for everything.
 */

/**
 * Reach beyond which a basic attack travels as a projectile rather than landing immediately.
 *
 * This was a bare `220` inline in the scene, sitting one screen away from an unrelated `220` used for fountain proximity
 * and two more used as tween durations. Naming it is most of the reason to extract this at all: the threshold decides
 * whether damage lands this tick or on a later one, which is a rollback-visible difference.
 */
export const RANGED_ATTACK_THRESHOLD = 220;

/** An attacking champion, reduced to what the decision needs. */
export interface AttackingChampion {
  id: string;
  /** Null for a champion with no champion data, which is how the simulation runs before a roster is agreed. */
  championId: string | null;
  pos: { x: number; y: number };
  /** Base attack damage BEFORE passives. The bonus is added here, never folded into the unit's own stat. */
  ad: number;
  attackRange: number;
  /** Seconds until the next swing is allowed. Snapshot state, so a restored value needs no replay of ticks. */
  attackCdRemaining: number;
  /** Attacks per second. */
  attackSpeed: number;
  items: readonly string[];
  hasRedBuff: boolean;
}

/** The chosen victim, reduced likewise. The caller has already decided this is who gets hit. */
export interface AttackTarget {
  id: string;
  pos: { x: number; y: number };
  dead: boolean;
  /**
   * Whether the target can currently take damage — respawn invulnerability, mostly.
   *
   * Passed in rather than derived, because damageability in the scene is a property of the ENTITY (its life state), not
   * of the unit, and inventing a second definition of it here is exactly how two implementations drift.
   */
  damageable: boolean;
}

export type BasicAttackBlockedReason =
  | 'onCooldown'
  | 'targetDead'
  | 'outOfRange'
  | 'targetInvulnerable';

/**
 * A blocked swing.
 *
 * `passives` is returned UNCHANGED, and that is the load-bearing part of this shape. In the scene the passive resolve
 * ran only after every gate passed, so a swing that never happened could not bank an ashborne stack or start a sunfire
 * interval. Returning the state on both arms of the union makes a caller that ignores the distinction impossible to
 * write, and a test can assert the identity rather than trusting the reading.
 */
export interface BasicAttackBlocked {
  kind: 'blocked';
  reason: BasicAttackBlockedReason;
  passives: PassiveState;
}

export interface BasicAttackStrike {
  kind: 'strike';
  /** Immediate application, or a projectile the caller queues for a later tick. */
  delivery: 'melee' | 'projectile';
  targetId: string;
  /** Base AD plus the passive bonus — what the caller should apply or queue. */
  rawDamage: number;
  /** The passive contribution alone, so a caller can show it without recomputing. */
  bonusAd: number;
  /** Which passives fired, for feedback the scene draws. Not authority. */
  fired: readonly string[];
  /** The cooldown to write back, one attack interval at the attacker's own speed. */
  attackCdRemaining: number;
  passives: PassiveState;
}

export type BasicAttackPlan = BasicAttackBlocked | BasicAttackStrike;

/**
 * Decide one champion basic attack.
 *
 * Gate order is the scene's, deliberately: cooldown, then the target's death, then range, then invulnerability. Order is
 * observable through `reason`, and a reordering would change which reason a caller sees even when the outcome is the same
 * block.
 */
export function planBasicAttack(
  attacker: AttackingChampion,
  target: AttackTarget,
  now: number,
  passives: PassiveState,
): BasicAttackPlan {
  if (attacker.attackCdRemaining > 0) return { kind: 'blocked', reason: 'onCooldown', passives };
  if (target.dead) return { kind: 'blocked', reason: 'targetDead', passives };
  if (distance(attacker.pos, target.pos) > attacker.attackRange) {
    return { kind: 'blocked', reason: 'outOfRange', passives };
  }
  if (!target.damageable) return { kind: 'blocked', reason: 'targetInvulnerable', passives };

  const resolved = basicAttackBonus(
    {
      championId: attacker.championId,
      attackerId: attacker.id,
      targetId: target.id,
      now,
      items: attacker.items,
      hasRedBuff: attacker.hasRedBuff,
    },
    passives,
  );

  return {
    kind: 'strike',
    delivery: attacker.attackRange > RANGED_ATTACK_THRESHOLD ? 'projectile' : 'melee',
    targetId: target.id,
    rawDamage: attacker.ad + resolved.bonusAd,
    bonusAd: resolved.bonusAd,
    fired: resolved.fired,
    attackCdRemaining: attackIntervalFor(attacker),
    passives: resolved.state,
  };
}
