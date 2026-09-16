import { distance, type Vec2 } from '../combat';
import { targetsIntersectingLine } from '../abilitySemantics';

/**
 * WHO a landed impact hits, and with what damage multiplier.
 *
 * processPendingImpacts was 83 lines in which two things were tangled: deciding which bodies an impact strikes, and
 * applying the damage plus its rendering. Only the first has to agree between peers — a floating number and a colour do
 * not — so the selection moved here and the application stayed.
 *
 * The three impact SHAPES were already distinct in the data and are kept distinct here rather than unified: a targeted
 * impact names one id, a line impact sweeps a box, and a point impact takes a radius. Collapsing them into one
 * "area with optional target" is tempting and wrong — the line form carries a falloff multiplier per body in strike order,
 * which neither of the others has.
 */

/** A body an impact could hit, reduced to what selection needs. */
export interface ImpactCandidate {
  id: string;
  pos: Vec2;
}

/** The impact's geometry, as the queue already stores it. */
export interface ImpactShape {
  targetId?: string;
  point?: Vec2;
  line?: {
    origin: Vec2;
    endpoint: Vec2;
    halfWidth: number;
    /** Applied to every body after the first, in strike order. */
    subsequentDamageMultiplier: number;
  };
  radius: number;
  /** When true, a point impact hits only the nearest body. */
  singleTarget: boolean;
}

/** One body struck, with the multiplier its position in the strike order earned. */
export interface ImpactHit {
  targetId: string;
  /** 1 for the first body of a line, `subsequentDamageMultiplier` after that, 1 everywhere else. */
  damageMultiplier: number;
}

/**
 * Select the bodies a landed impact strikes.
 *
 * `canDamage` is a callback because team, shield and structure-targeting rules belong to the caller — the same shape
 * rift/traps.ts uses, and for the same reason: this module measures geometry and nothing else.
 *
 * Point impacts sort by distance with an id tiebreak. That tiebreak is load-bearing for a single-target point impact,
 * where it decides which of two equidistant bodies takes the hit at all — array order would let two peers disagree.
 */
export function resolveImpactHits(
  shape: ImpactShape,
  candidates: readonly ImpactCandidate[],
  canDamage: (candidate: ImpactCandidate) => boolean,
): ImpactHit[] {
  if (shape.targetId) {
    const named = candidates.find((c) => c.id === shape.targetId);
    // A named target that has stopped being damageable is simply missed — the impact does not fall through to an area.
    return named && canDamage(named) ? [{ targetId: named.id, damageMultiplier: 1 }] : [];
  }

  if (shape.line) {
    const line = shape.line;
    const struck = targetsIntersectingLine(
      line.origin,
      line.endpoint,
      line.halfWidth,
      candidates.filter(canDamage).map((c) => ({ id: c.id, pos: c.pos })),
    );
    return struck.map((hit, index) => ({
      targetId: hit.id,
      damageMultiplier: index === 0 ? 1 : line.subsequentDamageMultiplier,
    }));
  }

  if (!shape.point) return [];
  const point = shape.point;
  const within = candidates
    .filter((c) => canDamage(c) && distance(c.pos, point) <= shape.radius)
    .sort((a, b) => distance(a.pos, point) - distance(b.pos, point) || a.id.localeCompare(b.id));
  const struck = shape.singleTarget ? within.slice(0, 1) : within;
  return struck.map((c) => ({ targetId: c.id, damageMultiplier: 1 }));
}

/**
 * Whether an impact should refund cooldown time to its caster.
 *
 * A one-line rule with its own name because it was written twice in processPendingImpacts — once on the line branch and
 * once on the point branch — and a rule written twice is a rule that can differ in one place.
 */
export function shouldProcChrono(chronoProc: boolean, hits: readonly ImpactHit[]): boolean {
  return chronoProc && hits.length > 0;
}

/** Seconds of cooldown a chrono proc refunds. */
export const CHRONO_PROC_SECONDS = 0.5;
