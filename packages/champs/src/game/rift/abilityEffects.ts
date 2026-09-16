import { abilityDamage, type AbilityEffect, type Vec2 } from '../combat';
import type { Ability } from '../../data/champions';

/**
 * What an ability DOES, as a plan the caller performs.
 *
 * BattleScene.castAbility was 155 lines in which three different concerns were interleaved: which champion-specific
 * effects apply, how those effects are drawn, and how the resulting damage is queued. Only the first has to agree between
 * peers — a pose, a flare and a colour do not — so that is what moves here, and the scene keeps its drawing.
 *
 * It is a TABLE rather than one rule, and deliberately so. Nine `champion.id ===` checks across seven (champion, slot)
 * pairs is not a rule with variations, it is a dispatch, and pretending otherwise is how a "shared" implementation ends up
 * with a special case for everything. Writing it as data makes the whole set readable at once and lets a test enumerate it.
 */

/** One thing to do. The caller applies it through the existing pure helpers, so nothing here touches effect state. */
export type AbilityOp =
  | { kind: 'heal'; targetId: string; amount: number }
  | { kind: 'shield'; targetId: string; key: string; amount: number; expiresAt: number }
  | { kind: 'armor'; targetId: string; key: string; amount: number; expiresAt: number }
  | { kind: 'movementBuff'; targetId: string; key: string; percent: number; expiresAt: number }
  | { kind: 'cleanseSlows'; targetId: string }
  | { kind: 'dash'; casterId: string; to: Vec2 }
  | { kind: 'openDashWindow'; casterId: string; until: number }
  | { kind: 'smokeWindow'; casterId: string; until: number }
  | {
      kind: 'trap';
      casterId: string;
      point: Vec2;
      radius: number;
      rawDamage: number;
      expiresAt: number;
      slowPercent: number;
      slowDuration: number;
    }
  | {
      kind: 'damage';
      casterId: string;
      origin: Vec2;
      endpoint: Vec2;
      radius: number;
      rawDamage: number;
      stunDuration: number;
      slowPercent?: number;
      slowDuration?: number;
      pullDuration?: number;
      area: boolean;
      dashes: boolean;
      ultimate: boolean;
      lineWidth?: number;
      piercingDamageMultiplier?: number;
      targetId?: string;
    };

/** A champion reduced to what an ability decision needs. */
export interface CastActor {
  id: string;
  team: string;
  pos: Vec2;
  hp: number;
  maxHp: number;
  abilityPower: number;
  /** Present so a heal or shield can be aimed at the lowest-health ally deterministically. */
  present: boolean;
}

export interface CastRequest {
  championId: string;
  slot: 'Q' | 'W' | 'E' | 'R';
  ability: Ability;
  effect: AbilityEffect;
  caster: CastActor;
  /** Every champion on the map, caster included. Filtered here so the rule owns its own targeting. */
  everyone: readonly CastActor[];
  origin: Vec2;
  endpoint: Vec2;
  /** An explicitly aimed ally, for the abilities that need one and refuse without it. */
  aimedAllyId: string | null;
  /** An explicitly aimed enemy for a single-target execute. */
  executeTargetId: string | null;
  now: number;
  /** True when the caster owns chronoCore, which the impact carries. */
  hasChronoCore: boolean;
}

export interface CastPlan {
  ops: AbilityOp[];
  /**
   * True when the ability REFUSED to fire — an ally-targeted ability with no ally aimed.
   *
   * Returned rather than thrown, and separate from an empty op list, because the scene must know not to start a cooldown
   * or play a cue. The original code expressed this as a bare `return` in the middle of 155 lines, which is easy to miss.
   */
  refused: boolean;
}

function alliesInRange(request: CastRequest): CastActor[] {
  const { caster, ability } = request;
  return request.everyone
    .filter(
      (ally) =>
        ally.team === caster.team &&
        ally.present &&
        Math.hypot(ally.pos.x - caster.pos.x, ally.pos.y - caster.pos.y) <= ability.range,
    )
    // Lowest health first, ties by id — array order is not something two peers can agree on, and this list decides who
    // gets healed.
    .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.id.localeCompare(b.id));
}

function healAmount(request: CastRequest): number {
  const { ability, caster } = request;
  return (
    (ability.mechanics?.healing ?? 180) + caster.abilityPower * (ability.mechanics?.apRatio ?? 0.4)
  );
}

function duration(request: CastRequest, fallback: number): number {
  return request.now + (request.ability.mechanics?.duration ?? fallback);
}

/**
 * Decide everything an ability does.
 *
 * Ordering within the returned list matters and mirrors the original: the dash lands BEFORE ally targeting, because a dash
 * moves the caster and the ally search is by distance from the caster. Reversing them silently changes who gets healed.
 */
export function planCast(request: CastRequest): CastPlan {
  const { championId, slot, ability, caster, origin, endpoint, now } = request;
  const ops: AbilityOp[] = [];
  let effect = request.effect;

  if (effect.dashes) {
    ops.push({ kind: 'dash', casterId: caster.id, to: { ...endpoint } });
    if (championId === 'nightveil') {
      ops.push({ kind: 'openDashWindow', casterId: caster.id, until: now + 3 });
    }
  }

  // The dash has already moved the caster in the plan, so ally distances are measured from where it landed.
  const casterAfterDash: CastActor = effect.dashes ? { ...caster, pos: { ...endpoint } } : caster;
  const allies = alliesInRange({ ...request, caster: casterAfterDash });

  const aimed = request.aimedAllyId
    ? request.everyone.find((a) => a.id === request.aimedAllyId)
    : undefined;

  if ((championId === 'dawnsong' || championId === 'wardlight') && slot === 'W') {
    if (!aimed) return { ops: [], refused: true };
    ops.push({ kind: 'heal', targetId: aimed.id, amount: healAmount(request) });
    effect = { ...effect, heal: 0 };
  } else if (championId === 'dawnsong' && slot === 'R') {
    for (const ally of allies) {
      ops.push({ kind: 'heal', targetId: ally.id, amount: healAmount(request) });
      ops.push({
        kind: 'armor',
        targetId: ally.id,
        key: `dawnsong-R:${caster.id}`,
        amount: ability.mechanics?.armor ?? 20,
        expiresAt: duration(request, 4),
      });
    }
    effect = { ...effect, heal: 0 };
  }

  if (championId === 'dawnsong' && slot === 'E') {
    if (!aimed) return { ops: [], refused: true };
    ops.push({
      kind: 'shield',
      targetId: aimed.id,
      key: `dawnsong-E:${caster.id}`,
      amount: ability.mechanics?.shield ?? 140,
      expiresAt: duration(request, 3),
    });
  } else if (championId === 'wardlight' && slot === 'R') {
    for (const ally of allies) {
      ops.push({
        kind: 'shield',
        targetId: ally.id,
        key: `wardlight-R:${caster.id}`,
        amount: ability.mechanics?.shield ?? 160,
        expiresAt: duration(request, 4),
      });
      ops.push({
        kind: 'movementBuff',
        targetId: ally.id,
        key: `wardlight-R:${caster.id}`,
        percent: ability.mechanics?.movementPercent ?? 0.15,
        expiresAt: duration(request, 4),
      });
    }
  } else if (championId === 'thornwarden' && slot === 'W') {
    ops.push({
      kind: 'armor',
      targetId: caster.id,
      key: `thornwarden-W:${caster.id}`,
      amount: ability.mechanics?.armor ?? 30,
      expiresAt: duration(request, 3),
    });
    ops.push({ kind: 'cleanseSlows', targetId: caster.id });
  }

  if (effect.heal > 0) {
    ops.push({ kind: 'heal', targetId: caster.id, amount: effect.heal });
  }

  if (effect.buffDuration > 0 && effect.damage === 0 && effect.heal === 0) {
    if (championId === 'nightveil' && slot === 'W') {
      ops.push({ kind: 'smokeWindow', casterId: caster.id, until: now + 3 });
    }
    if (championId === 'ironhold' && slot === 'W') {
      ops.push({
        kind: 'shield',
        targetId: caster.id,
        key: 'ironhold-W',
        amount: caster.maxHp * 0.12,
        expiresAt: now + 3,
      });
    }
  }

  if (championId === 'duskarrow' && slot === 'W') {
    ops.push({
      kind: 'trap',
      casterId: caster.id,
      point: { ...endpoint },
      radius: ability.mechanics?.radius ?? 90,
      rawDamage: abilityDamage(ability.damage, caster.abilityPower),
      expiresAt: now + (ability.mechanics?.trapDuration ?? 4),
      slowPercent: ability.mechanics?.slowPercent ?? 0.3,
      slowDuration: ability.mechanics?.duration ?? 2,
    });
    // The original returns here, so a trap ability queues no damage of its own even if its effect has some.
    return { ops, refused: false };
  }

  if (effect.damage > 0) {
    ops.push({
      kind: 'damage',
      casterId: caster.id,
      origin: { ...origin },
      endpoint: { ...endpoint },
      radius: effect.area ? (ability.mechanics?.radius ?? effect.radius) : effect.dashes ? 40 : 34,
      rawDamage: abilityDamage(effect.damage, caster.abilityPower),
      stunDuration: effect.stunDuration,
      slowPercent: ability.mechanics?.slowPercent,
      slowDuration: ability.mechanics?.duration,
      pullDuration: ability.mechanics?.pullDuration,
      area: Boolean(effect.area),
      dashes: Boolean(effect.dashes),
      ultimate: slot === 'R',
      lineWidth: ability.mechanics?.lineWidth,
      piercingDamageMultiplier: ability.mechanics?.piercingDamageMultiplier,
      targetId: request.executeTargetId ?? undefined,
    });
  }

  return { ops, refused: false };
}
