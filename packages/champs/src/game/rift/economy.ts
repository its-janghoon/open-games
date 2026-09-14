/**
 * Gold, experience, and leveling economy for the three-lane conquest game.
 *
 * This module deliberately contains NO Phaser (or any DOM) imports so it can be
 * exhaustively unit tested in a plain jsdom/node environment. Every reward and
 * rate is a named, documented constant so balance is auditable in one place.
 */

/** The maximum champion level in this game's progression curve. */
export const MAX_LEVEL = 18;

/**
 * XP required to advance FROM the given level TO the next one. Level 1 -> 2
 * costs {@link BASE_XP_PER_LEVEL}, and each subsequent level costs
 * {@link XP_STEP_PER_LEVEL} more, producing a strictly increasing curve.
 *
 * Returns 0 for levels at or beyond {@link MAX_LEVEL} (no further growth).
 */
export const BASE_XP_PER_LEVEL = 280;
export const XP_STEP_PER_LEVEL = 100;

/** XP required to go from `level` to `level + 1`. */
export function xpToNextLevel(currentLevel: number): number {
  if (currentLevel < 1) return BASE_XP_PER_LEVEL;
  if (currentLevel >= MAX_LEVEL) return 0;
  return BASE_XP_PER_LEVEL + (currentLevel - 1) * XP_STEP_PER_LEVEL;
}

/**
 * Total cumulative XP required to reach `level` from level 1 (level 1 requires
 * 0 total XP). Strictly increasing for levels 1..MAX_LEVEL.
 */
export function xpForLevel(level: number): number {
  const capped = Math.min(Math.max(level, 1), MAX_LEVEL);
  let total = 0;
  for (let l = 1; l < capped; l++) {
    total += xpToNextLevel(l);
  }
  return total;
}

/** Mutable per-entity progression: current level, banked XP, and gold. */
export interface ProgressState {
  level: number;
  xp: number;
  gold: number;
}

/** A fresh level-1 progression state with the given starting gold. */
export function createProgress(startingGold = STARTING_GOLD): ProgressState {
  return { level: 1, xp: 0, gold: startingGold };
}

/** Starting gold at the beginning of a game. */
export const STARTING_GOLD = 500;

/** Result of granting XP: whether a level-up occurred and the resulting level. */
export interface XpResult {
  leveled: boolean;
  newLevel: number;
}

/**
 * Grant `amount` XP to a progression state, promoting through as many level
 * thresholds as the total XP allows, capping at {@link MAX_LEVEL}. Mutates the
 * state in place and returns whether any level-up happened and the new level.
 */
export function addXp(state: ProgressState, amount: number): XpResult {
  const startLevel = state.level;
  if (amount > 0) {
    state.xp += amount;
  }
  // Consume XP for each level threshold reached, up to the cap.
  while (state.level < MAX_LEVEL) {
    const need = xpToNextLevel(state.level);
    if (need <= 0 || state.xp < need) break;
    state.xp -= need;
    state.level += 1;
  }
  // At max level there is nothing more to bank.
  if (state.level >= MAX_LEVEL) {
    state.xp = 0;
  }
  return { leveled: state.level > startLevel, newLevel: state.level };
}

/** Add `amount` gold to a progression state (ignores non-positive amounts). */
export function addGold(state: ProgressState, amount: number): number {
  if (amount > 0) {
    state.gold += amount;
  }
  return state.gold;
}

// ---------------------------------------------------------------------------
// Passive income
// ---------------------------------------------------------------------------

/** Passive gold trickle in gold-per-second. */
export const PASSIVE_GOLD_PER_SECOND = 2.04;

/** Gold accrued from the passive trickle over `seconds`. */
export function passiveGold(seconds: number): number {
  return seconds > 0 ? PASSIVE_GOLD_PER_SECOND * seconds : 0;
}

/**
 * One participant's passive gold, as snapshot state.
 *
 * `accrual` is the reason this type exists. The trickle is 2.04 gold per second against a 1/30 s tick, so a tick
 * earns 0.068 gold and whole gold only lands every fifteenth one; the remainder has to be carried. That carry is
 * the most rollback-fragile shape there is — restore `gold` but not `accrual` and every rollback loses or repeats a
 * fraction, so two peers' gold drifts by up to 1 per rollback and keeps drifting, silently, until their builds
 * differ and the same purchase is affordable on one side only.
 */
export interface GoldState {
  gold: number;
  /** Fractional gold carried between ticks, always in [0, 1). */
  accrual: number;
  /** Gold earned over the match, for the result screen. Snapshot state so a replay cannot double-count it. */
  totalEarned: number;
}

/** A participant's starting gold state. */
export function initialGold(gold: number): GoldState {
  return { gold, accrual: 0, totalEarned: 0 };
}

/**
 * Advance one participant's passive gold by `seconds`.
 *
 * Pure, and deliberately the whole of the arithmetic: accumulate, take only whole gold, carry the remainder. It was
 * previously written inline in the battle scene TWICE — once for the player and once per bot — which is both a
 * duplication and the reason none of it was in the snapshot.
 */
export function advanceGold(state: GoldState, seconds: number): GoldState {
  const accrual = state.accrual + passiveGold(seconds);
  if (accrual < 1) return { gold: state.gold, accrual, totalEarned: state.totalEarned };
  const whole = Math.floor(accrual);
  return {
    gold: state.gold + whole,
    accrual: accrual - whole,
    totalEarned: state.totalEarned + whole,
  };
}

// ---------------------------------------------------------------------------
// Bounty tables
// ---------------------------------------------------------------------------

/** Gold + XP granted for a single kill/objective. */
export interface Bounty {
  gold: number;
  xp: number;
}

/** The four original minion archetypes. */
export type MinionType = 'melee' | 'caster' | 'siege' | 'super';

/**
 * Gold + XP for killing each minion type. Values are distinct per type and rise
 * from melee -> caster -> siege -> super for a clear reward hierarchy.
 */
export const MINION_BOUNTY: Record<MinionType, Bounty> = {
  melee: { gold: 21, xp: 60 },
  caster: { gold: 14, xp: 30 },
  siege: { gold: 60, xp: 93 },
  super: { gold: 85, xp: 97 },
};

/** Bounty for killing a minion of the given type. */
export function minionBounty(type: MinionType): Bounty {
  return MINION_BOUNTY[type];
}

/** Base gold for a champion takedown (shutdowns/streaks scale on top). */
export const CHAMPION_TAKEDOWN_GOLD = 300;

/** XP granted to the killer's vicinity for a champion takedown. */
export const CHAMPION_TAKEDOWN_XP = 220;

/** Bounty for a plain champion takedown. */
export const CHAMPION_TAKEDOWN_BOUNTY: Bounty = {
  gold: CHAMPION_TAKEDOWN_GOLD,
  xp: CHAMPION_TAKEDOWN_XP,
};

/** Structure rewards by combat-facing category. */
export type StructureBountyKind = 'turret' | 'inhibitor' | 'nexus';

export const STRUCTURE_BOUNTY: Readonly<Record<StructureBountyKind, Bounty>> = {
  turret: { gold: 160, xp: 120 },
  inhibitor: { gold: 220, xp: 180 },
  nexus: { gold: 0, xp: 0 },
};

/** Gold and experience granted to the champion landing a structure kill. */
export function structureBounty(kind: StructureBountyKind): Bounty {
  return STRUCTURE_BOUNTY[kind];
}

/** Jungle camp rewards, keyed by the camp id family used in map.ts. */
export type JungleCampKind =
  | 'blue'
  | 'red'
  | 'gromp'
  | 'wolves'
  | 'raptors'
  | 'krugs';

/**
 * Gold + XP for clearing each jungle camp. Every value is positive and roughly
 * scaled by each camp's intended risk and clear time.
 */
export const JUNGLE_CAMP_BOUNTY: Record<JungleCampKind, Bounty> = {
  blue: { gold: 90, xp: 115 },
  red: { gold: 90, xp: 115 },
  gromp: { gold: 80, xp: 130 },
  wolves: { gold: 85, xp: 115 },
  raptors: { gold: 88, xp: 120 },
  krugs: { gold: 96, xp: 145 },
};

/** Bounty for clearing the given jungle camp kind. */
export function jungleCampBounty(kind: JungleCampKind): Bounty {
  return JUNGLE_CAMP_BOUNTY[kind];
}

/** The epic monsters that grant map-wide/objective rewards. */
export type EpicMonster = 'dragon' | 'herald' | 'baron';

/**
 * Gold + XP for slaying each epic monster. Baron gives the most, dragon a solid
 * mid reward, herald a smaller one (herald is consumed rather than a buff).
 */
export const EPIC_MONSTER_BOUNTY: Record<EpicMonster, Bounty> = {
  dragon: { gold: 25, xp: 200 },
  herald: { gold: 100, xp: 306 },
  baron: { gold: 300, xp: 800 },
};

/** Bounty for slaying the given epic monster. */
export function epicMonsterBounty(monster: EpicMonster): Bounty {
  return EPIC_MONSTER_BOUNTY[monster];
}

// ---------------------------------------------------------------------------
// Per-level stat scaling
// ---------------------------------------------------------------------------

/**
 * Scale a champion base stat by level. At level 1 the value equals `base`; each
 * level beyond 1 adds `perLevel`, so growth is linear in `level`.
 *
 * @param base     the stat's value at level 1
 * @param perLevel the flat amount added per level after the first
 * @param level    the current champion level (clamped to 1..MAX_LEVEL)
 */
export function statsForLevel(base: number, perLevel: number, level: number): number {
  const capped = Math.min(Math.max(level, 1), MAX_LEVEL);
  return base + perLevel * (capped - 1);
}
