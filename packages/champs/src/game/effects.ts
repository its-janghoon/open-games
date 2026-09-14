import { effectiveDamage, type DamageResult, type Unit, type Vec2 } from './combat';

export interface ShieldEffect { source: string; amount: number; expiresAt: number }
export interface SlowEffect { source: string; percent: number; expiresAt: number }
export interface ArmorEffect { source: string; amount: number; expiresAt: number }
export interface MovementEffect { source: string; percent: number; expiresAt: number }
export interface PullEffect {
  source: string;
  destination: Vec2;
  speed: number;
  expiresAt: number;
}
export interface BurnEffect {
  sourceId: string;
  rawDamagePerSecond: number;
  expiresAt: number;
  accumulator: number;
}
export interface EffectState {
  shields: ShieldEffect[];
  slows: SlowEffect[];
  armor: ArmorEffect[];
  movement: MovementEffect[];
  pulls: PullEffect[];
  burns: BurnEffect[];
}

export function createEffectState(): EffectState {
  return { shields: [], slows: [], armor: [], movement: [], pulls: [], burns: [] };
}

/**
 * PURE readers. These resolve an effect against a timestamp without touching the state.
 *
 * The existing strongestSlow / strongestMovementBuff / activePull each call
 * expireEffects first, so a QUERY mutates: asking what a unit's slow is deletes every
 * effect that has expired. That is harmless while one code path asks once per frame, and
 * it is a rollback hazard, because it makes state depend on the pattern of reads rather
 * than only on inputs. Replaying a tick with a different number of queries - or the same
 * queries in a different order relative to an expiry boundary - produces a different
 * state, and the two players silently disagree.
 *
 * So expiry becomes a STEP that happens once per tick, and reading becomes a read. The
 * mutating versions are kept for the paths that have not moved yet rather than changed
 * underneath them.
 */

/** The strongest active slow at `now`, as a fraction. Does not mutate. */
export function readSlow(state: EffectState, now: number): number {
  return state.slows.reduce((value, effect) => (effect.expiresAt > now ? Math.max(value, effect.percent) : value), 0);
}

/** The strongest active movement buff at `now`, as a fraction. Does not mutate. */
export function readMovementBuff(state: EffectState, now: number): number {
  return state.movement.reduce((value, effect) => (effect.expiresAt > now ? Math.max(value, effect.percent) : value), 0);
}

/**
 * The active pull at `now`, or undefined. Does not mutate.
 *
 * Ordering is the same as activePull's - soonest expiry first, then source id - and it is
 * not cosmetic: with two pulls active the chosen one decides where the unit is dragged,
 * so an unstable order would be a desync. The source-id tiebreak is what makes it total.
 */
export function readPull(state: EffectState, now: number): PullEffect | undefined {
  return state.pulls
    .filter((effect) => effect.expiresAt > now)
    .sort((a, b) => a.expiresAt - b.expiresAt || a.source.localeCompare(b.source))[0];
}

export function expireEffects(state: EffectState, now: number): EffectState {
  state.shields = state.shields.filter((effect) => effect.expiresAt > now && effect.amount > 0);
  state.slows = state.slows.filter((effect) => effect.expiresAt > now);
  state.armor = state.armor.filter((effect) => effect.expiresAt > now);
  state.movement = state.movement.filter((effect) => effect.expiresAt > now);
  state.pulls = state.pulls.filter((effect) => effect.expiresAt > now);
  state.burns = state.burns.filter((effect) => effect.expiresAt > now);
  return state;
}

/** Same-source shields refresh to the larger amount; distinct sources stack. */
export function applyShield(state: EffectState, source: string, amount: number, expiresAt: number): void {
  const existing = state.shields.find((effect) => effect.source === source);
  if (existing) {
    existing.amount = Math.max(existing.amount, Math.max(0, amount));
    existing.expiresAt = Math.max(existing.expiresAt, expiresAt);
  } else if (amount > 0) state.shields.push({ source, amount, expiresAt });
}

/** Strongest slow wins while equal strengths keep the longest duration. */
export function applySlow(state: EffectState, source: string, percent: number, expiresAt: number): void {
  const safe = Math.min(0.95, Math.max(0, percent));
  const strongest = state.slows.reduce((value, effect) => Math.max(value, effect.percent), 0);
  if (safe < strongest) return;
  if (safe > strongest) state.slows = [];
  const existing = state.slows.find((effect) => effect.source === source);
  if (existing) existing.expiresAt = Math.max(existing.expiresAt, expiresAt);
  else if (safe > 0) state.slows.push({ source, percent: safe, expiresAt });
}

export function cleanseSlows(state: EffectState): void {
  state.slows = [];
}

export function strongestSlow(state: EffectState, now: number): number {
  expireEffects(state, now);
  return state.slows.reduce((value, effect) => Math.max(value, effect.percent), 0);
}

export function applyArmor(
  state: EffectState,
  source: string,
  amount: number,
  expiresAt: number,
): void {
  const existing = state.armor.find((effect) => effect.source === source);
  if (existing) {
    existing.amount = Math.max(existing.amount, amount);
    existing.expiresAt = Math.max(existing.expiresAt, expiresAt);
  } else if (amount !== 0) state.armor.push({ source, amount, expiresAt });
}

export function bonusArmor(state: EffectState, now: number): number {
  expireEffects(state, now);
  return state.armor.reduce((total, effect) => total + effect.amount, 0);
}

export function applyMovementBuff(
  state: EffectState,
  source: string,
  percent: number,
  expiresAt: number,
): void {
  const safe = Math.max(0, percent);
  const existing = state.movement.find((effect) => effect.source === source);
  if (existing) {
    existing.percent = Math.max(existing.percent, safe);
    existing.expiresAt = Math.max(existing.expiresAt, expiresAt);
  } else if (safe > 0) state.movement.push({ source, percent: safe, expiresAt });
}

export function strongestMovementBuff(state: EffectState, now: number): number {
  expireEffects(state, now);
  return state.movement.reduce((value, effect) => Math.max(value, effect.percent), 0);
}

export function applyPull(
  state: EffectState,
  source: string,
  destination: Vec2,
  speed: number,
  expiresAt: number,
): void {
  state.pulls = state.pulls.filter((effect) => effect.source !== source);
  state.pulls.push({ source, destination: { ...destination }, speed: Math.max(0, speed), expiresAt });
}

export function activePull(state: EffectState, now: number): PullEffect | undefined {
  expireEffects(state, now);
  return [...state.pulls].sort((a, b) => a.expiresAt - b.expiresAt || a.source.localeCompare(b.source))[0];
}

/** Burns refresh by source instead of stacking. */
export function applyBurn(
  state: EffectState,
  sourceId: string,
  rawDamagePerSecond: number,
  expiresAt: number,
): void {
  const existing = state.burns.find((effect) => effect.sourceId === sourceId);
  if (existing) {
    existing.rawDamagePerSecond = Math.max(existing.rawDamagePerSecond, rawDamagePerSecond);
    existing.expiresAt = Math.max(existing.expiresAt, expiresAt);
    return;
  }
  state.burns.push({ sourceId, rawDamagePerSecond, expiresAt, accumulator: 0 });
}

/** Temporary armor is resolved before shields absorb the post-mitigation damage. */
export function applyDamageWithEffects(
  target: Unit,
  state: EffectState,
  rawDamage: number,
  now: number,
): DamageResult {
  if (target.dead || target.hp <= 0) return { dealt: 0, lethal: false };
  expireEffects(state, now);
  let pending = effectiveDamage(rawDamage, target.armor + bonusArmor(state, now));
  for (const shield of state.shields) {
    const absorbed = Math.min(shield.amount, pending);
    shield.amount -= absorbed;
    pending -= absorbed;
    if (pending <= 0) break;
  }
  const hpBefore = target.hp;
  const dealt = Math.min(hpBefore, pending);
  target.hp = Math.max(0, hpBefore - pending);
  const lethal = hpBefore > 0 && target.hp === 0;
  if (lethal) target.dead = true;
  return { dealt, lethal };
}
