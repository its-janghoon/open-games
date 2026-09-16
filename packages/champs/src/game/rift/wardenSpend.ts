import { distance, type Team } from '../combat';
import type { WardenCharge } from '../wardenPolicy';
import { BASE_POSITIONS, type MapSide, type Vec2 } from './map';
import { heraldReward } from './objectives';
import { isStructureTargetable, type StructureGraphScope } from './structures';

/**
 * Spending a held Stone Warden charge: which structure it hits, and for how much.
 *
 * The two rules around this were already pure — {@link import('./fieldState').advanceWardenCharges} for the lapse and
 * `shouldDeployHeldWarden` for the decision to deploy. What was still in the scene was the part between them: the ORDER
 * of legal targets, and what happens to the charge once it is spent. Target order is authority in the strictest sense —
 * two peers that rank the same three turrets differently destroy different buildings from identical input — so it cannot
 * stay a scene method.
 */

/** A standing structure, reduced to what target selection needs. */
export interface WardenTargetCandidate {
  id: string;
  /**
   * Which side OWNS it.
   *
   * `Team`, not `MapSide`, because that is what a unit actually carries — the third member is `neutral`. The filter below
   * is the scene's, unchanged: anything whose team is not the holder's counts as hostile, so a neutral structure would be
   * a legal target. None exist today (every entry in the scene's structure list is a turret, inhibitor or nexus owned by a
   * side), and inventing a narrower type here would have hidden that rather than recorded it.
   */
  team: Team;
  pos: Vec2;
  dead: boolean;
}

/**
 * Legal warden targets for `sourceSide`, nearest to that side's OWN base first, ties broken by id.
 *
 * Not {@link import('./structures').targetableOrder}, which looks similar and is a different rule: that one is the graph's
 * destruction order for one side (outer turret before inner before inhibitor), derived from the shield relationships. This
 * one is geometric — how close a legal target is to the base the warden marches out of — and the two disagree the moment
 * a lane is further along than its neighbour. Both are needed; neither can stand in for the other.
 *
 * The id tiebreak is not decoration. Two structures equidistant from a base is the normal case in a symmetric three-lane
 * map, and `Array.prototype.sort` is only required to be stable, not to agree across engines for a comparator that
 * returns 0. Without the tiebreak the same match on two machines can pick different buildings.
 */
export function wardenTargetOrder(
  candidates: readonly WardenTargetCandidate[],
  sourceSide: MapSide,
  scope: StructureGraphScope,
): string[] {
  const livingIds = new Set(candidates.filter((c) => !c.dead).map((c) => c.id));
  const base = BASE_POSITIONS[sourceSide];
  return candidates
    .filter((c) => c.team !== sourceSide && !c.dead && isStructureTargetable(c.id, livingIds, scope))
    .sort(
      (a, b) =>
        distance(a.pos, base) - distance(b.pos, base) || a.id.localeCompare(b.id),
    )
    .map((c) => c.id);
}

export type WardenSpendPlan =
  /** The charge ran out. The caller clears it and nothing is struck. */
  | { kind: 'lapsed' }
  /**
   * Nothing legal to hit, so the charge is KEPT.
   *
   * The asymmetry with `lapsed` is the scene's existing behaviour and is preserved deliberately: `useWardenCharge`
   * returned BEFORE nulling the charge when the target list was empty, so a warden held while every legal structure is
   * shielded survives to the next tick and is spent later. Only time takes a charge away.
   */
  | { kind: 'hold' }
  | { kind: 'strike'; targetId: string; rawDamage: number };

export interface WardenSpendRequest {
  charge: WardenCharge | null;
  now: number;
  /** Output of {@link wardenTargetOrder} — already filtered and ranked. */
  orderedTargetIds: readonly string[];
  /**
   * A target the caller would prefer, e.g. the one a bot policy sized up before deciding to deploy.
   *
   * A preference that is not in `orderedTargetIds` falls back to the FIRST legal target rather than missing. That is the
   * opposite of {@link import('./impactTargeting').resolveImpactHits}, where a named victim that became undamageable now
   * misses outright — and the difference is intended in both places. An in-flight projectile was aimed at one body and
   * should not re-home; a warden is a battering ram walking into a lane and hits whatever is standing in front of it.
   */
  preferredTargetId?: string | null;
}

/** Decide what a held charge does this tick. */
export function planWardenSpend(request: WardenSpendRequest): WardenSpendPlan {
  const { charge, now, orderedTargetIds, preferredTargetId } = request;
  if (!charge || charge.expiresAt <= now) return { kind: 'lapsed' };

  const targetId =
    preferredTargetId && orderedTargetIds.includes(preferredTargetId)
      ? preferredTargetId
      : orderedTargetIds[0];
  if (!targetId) return { kind: 'hold' };

  return { kind: 'strike', targetId, rawDamage: heraldReward().structureDamage };
}
