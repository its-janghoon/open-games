import { distance, type Vec2 } from '../combat';
import { campRespawnAt, type Camp } from './jungle';

/**
 * Jungle camp BEHAVIOUR — the per-tick rule and the snapshot state for it.
 *
 * Separate from rift/jungle.ts, which already owned the camp DATA (`CAMPS`, `CAMP_PACKS`) and two pure helpers with
 * absolute deadlines (`campRespawnAt`, `isCampAlive`). This module deliberately reuses `campRespawnAt` rather than
 * restating it: I wrote a `respawnDeadline` doing exactly the same arithmetic before noticing, which is how a codebase
 * ends up with two respawn rules that drift.
 *
 * Kept separate from rift/autoAttack.ts too, and for a real reason rather than filing convenience: a turret cannot move,
 * and everything interesting here is movement — a LEASH around the camp, a walk home, and regeneration conditional on
 * having arrived. Merging them would give every turret leash and regen fields that can never apply.
 *
 * What was missing for a rollback was the LIST. `private camps: CampRuntime[]` held `members: Entity[]` — Phaser objects —
 * so there was nothing a snapshot could hold even in principle. These are the same monsters reduced to data.
 */

/** Ranges in WORLD units, unscaled, matching the scene now that gameplay is world-space. */
export const CAMP_TUNING = {
  /** How far a monster looks for something to hit. */
  aggroRange: 420,
  /** How far a target may be from the CAMP before the monster refuses to follow. */
  leashRange: 620,
  /** Fraction of max health regained per second while walking home. */
  returnRegenPerSecond: 0.12,
  /** Fraction regained per second once home — lower, so a monster is not best left alone mid-walk. */
  homeRegenPerSecond: 0.08,
  /** How close counts as home. */
  homeEpsilon: 4,
} as const;

export interface CampMemberState {
  id: string;
  campId: string;
  pos: Vec2;
  /** Idle position: this member's slot in the camp ring, not the camp centre. */
  home: Vec2;
  hp: number;
  maxHp: number;
  attackRange: number;
  stunned: number;
  dead: boolean;
}

export interface CampSpawnState {
  campId: string;
  /** Camp centre in world units. The leash is measured from here. */
  center: Vec2;
  /** Absolute match time the camp may repopulate, from {@link campRespawnAt}. */
  nextSpawnAt: number;
}

/** What a monster decided. The caller performs it, so this module never touches a Phaser object. */
export type CampAction =
  | { kind: 'attack'; memberId: string; targetId: string }
  | { kind: 'chase'; memberId: string; toward: Vec2 }
  | { kind: 'return'; memberId: string; toward: Vec2 }
  | { kind: 'hold'; memberId: string };

export interface CampResult {
  members: CampMemberState[];
  actions: CampAction[];
}

export interface CampTarget {
  id: string;
  pos: Vec2;
  /** The caller judges hostility and damageability; this module only measures distance. */
  attackable: boolean;
}

export function cloneCampMembers(members: readonly CampMemberState[]): CampMemberState[] {
  return members.map((m) => ({ ...m, pos: { ...m.pos }, home: { ...m.home } }));
}

export function cloneCampSpawns(camps: readonly CampSpawnState[]): CampSpawnState[] {
  return camps.map((c) => ({ ...c, center: { ...c.center } }));
}

/**
 * Advance every camp member for one tick.
 *
 * Regeneration is applied HERE rather than by the caller because it is conditional on the decision — a chasing monster
 * heals nothing, a returning one heals more than one already home. Splitting the decision from its healing would let the
 * two disagree about which case ran, which a replay would then reproduce differently.
 */
export function advanceCamps(
  members: readonly CampMemberState[],
  camps: readonly CampSpawnState[],
  targets: readonly CampTarget[],
  dt: number,
): CampResult {
  const centerById = new Map(camps.map((camp) => [camp.campId, camp.center]));
  const actions: CampAction[] = [];

  const advanced = members.map((member) => {
    const next: CampMemberState = { ...member, pos: { ...member.pos }, home: { ...member.home } };
    next.stunned = Math.max(0, member.stunned - dt);

    if (member.dead || next.stunned > 0) return next;

    const center = centerById.get(member.campId) ?? member.home;
    const reachable = targets
      .filter(
        (target) =>
          target.attackable &&
          distance(member.pos, target.pos) <= CAMP_TUNING.aggroRange &&
          // Leash measured from the CAMP, so a monster cannot be walked across the map by a target that keeps retreating.
          // Measuring from the monster instead would let each step extend its own leash.
          distance(target.pos, center) <= CAMP_TUNING.leashRange,
      )
      .sort(
        (a, b) =>
          distance(member.pos, a.pos) - distance(member.pos, b.pos) || a.id.localeCompare(b.id),
      );

    const target = reachable[0];
    if (target) {
      if (distance(member.pos, target.pos) <= member.attackRange) {
        actions.push({ kind: 'attack', memberId: member.id, targetId: target.id });
      } else {
        actions.push({ kind: 'chase', memberId: member.id, toward: { ...target.pos } });
      }
      return next;
    }

    if (distance(member.pos, member.home) > CAMP_TUNING.homeEpsilon) {
      actions.push({ kind: 'return', memberId: member.id, toward: { ...member.home } });
      next.hp = Math.min(
        member.maxHp,
        member.hp + member.maxHp * CAMP_TUNING.returnRegenPerSecond * dt,
      );
      return next;
    }

    actions.push({ kind: 'hold', memberId: member.id });
    next.hp = Math.min(member.maxHp, member.hp + member.maxHp * CAMP_TUNING.homeRegenPerSecond * dt);
    return next;
  });

  return { members: advanced, actions };
}

/**
 * Camps whose respawn deadline has passed and which have no living members.
 *
 * Returns ids rather than spawning, because spawning creates Phaser objects. Emptiness is judged from the member list the
 * caller passes, so a caller that has not yet cleared a corpse cannot double-spawn.
 */
export function dueCamps(
  camps: readonly CampSpawnState[],
  members: readonly CampMemberState[],
  now: number,
): string[] {
  const living = new Set(members.filter((m) => !m.dead).map((m) => m.campId));
  return camps
    .filter((camp) => !living.has(camp.campId) && now >= camp.nextSpawnAt)
    .map((camp) => camp.campId)
    .sort();
}

/** The camp's next spawn time after being cleared, through jungle.ts's existing rule. */
export function clearedAt(camp: Camp, now: number): number {
  return campRespawnAt(camp, now);
}

/** A member id stable across a replay: camp plus slot key, never an array index or a counter. */
export function campMemberIdFor(campId: string, memberKey: string): string {
  return `camp-${campId}-${memberKey}`;
}
