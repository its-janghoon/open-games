/**
 * BuildingConfig - the per-building tuning table for Kingdom Rise.
 *
 * GameConfig.ts holds the shared *curve* parameters (geometric cost/output
 * growth, base build seconds, max level, Town-Center gating). This module holds
 * the per-building *base* numbers those curves are applied to: what a building
 * costs at level 1, how much a producer outputs at level 1, and how the Town
 * Center gates the rest of the roster.
 *
 * All formulas are pure functions of `(kind, level)` so the economy, building,
 * and save systems can compute costs / outputs / timings deterministically and
 * unit-test them without Phaser.
 */

import { BUILDINGS } from './GameConfig';
import type {
  BuildingKind,
  DefenseKind,
  ProducerKind,
  ResourceCost,
  ResourceKind,
} from '../types';

/** Static definition for a single building kind. */
export interface BuildingDef {
  kind: BuildingKind;
  /** Resource cost to build the FIRST level (level 1). Scales by COST_GROWTH. */
  baseCost: ResourceCost;
  /** For producers: base output-per-second at level 1. 0 for non-producers. */
  baseOutputPerSec: number;
  /** For producers: which resource this building generates (undefined otherwise). */
  produces?: ResourceKind;
  /**
   * Minimum Town Center level required to build/own this building AT ALL. The
   * Town Center itself is always buildable (0). This is the hard prerequisite;
   * separately, a non-Town-Center building may never exceed the current Town
   * Center level (enforced in BuildingSystem).
   */
  requiresTownCenterLevel: number;
  /** Highest level this building can reach (defaults to the global MAX_LEVEL). */
  maxLevel: number;
  /**
   * For DEFENSIVE buildings (wall / watchtower): the town-defense points this
   * building contributes AT LEVEL 1. Each further level adds this base again
   * (linear growth; see {@link defenseValue}). 0 / undefined for every
   * non-defensive building, so they never contribute to town defense.
   */
  baseDefense?: number;
}

/**
 * The building roster. Producer outputs are balanced so early food/wood flow
 * faster than the scarcer stone/gold. The Barracks produces nothing but unlocks
 * troop training; the Town Center produces nothing but raises the level cap.
 */
export const BUILDING_DEFS: Record<BuildingKind, BuildingDef> = {
  town_center: {
    kind: 'town_center',
    baseCost: { wood: 100, stone: 60 },
    baseOutputPerSec: 0,
    requiresTownCenterLevel: 0,
    maxLevel: BUILDINGS.MAX_LEVEL,
  },
  farm: {
    kind: 'farm',
    baseCost: { wood: 40, food: 20 },
    baseOutputPerSec: 2.0,
    produces: 'food',
    requiresTownCenterLevel: 1,
    maxLevel: BUILDINGS.MAX_LEVEL,
  },
  lumber_mill: {
    kind: 'lumber_mill',
    baseCost: { food: 40, stone: 20 },
    baseOutputPerSec: 1.6,
    produces: 'wood',
    requiresTownCenterLevel: 1,
    maxLevel: BUILDINGS.MAX_LEVEL,
  },
  quarry: {
    // Town Center level 1, not 2. Stone is REQUIRED to raise the Town Center
    // (1->2 costs stone 96), so gating its only producer behind level 2 makes
    // stone unobtainable to any hold that has spent its starting 250 - the
    // same circular dependency that stranded Frosthold on coal, hidden here
    // only because the starting grant happens to cover the first two upgrades.
    kind: 'quarry',
    baseCost: { wood: 80, food: 40 },
    baseOutputPerSec: 1.0,
    produces: 'stone',
    requiresTownCenterLevel: 1,
    maxLevel: BUILDINGS.MAX_LEVEL,
  },
  mine: {
    kind: 'mine',
    baseCost: { wood: 120, stone: 80 },
    baseOutputPerSec: 0.5,
    produces: 'gold',
    requiresTownCenterLevel: 3,
    maxLevel: BUILDINGS.MAX_LEVEL,
  },
  barracks: {
    kind: 'barracks',
    // Cheaper than the top-tier producers so the early "Town Center Lv.2 ->
    // Barracks -> train" loop is reachable in a couple of minutes from a fresh
    // start (see ECONOMY.START). Still gated behind Town Center level 2 so it
    // is a deliberate second step, not free on turn one.
    baseCost: { wood: 120, stone: 80 },
    baseOutputPerSec: 0,
    requiresTownCenterLevel: 2,
    maxLevel: BUILDINGS.MAX_LEVEL,
  },
  research: {
    kind: 'research',
    // The Scholars' Hall (연구소): produces nothing, but its level gates which
    // tiers of the tech tree can be researched. Gated behind Town Center level
    // 3 so it is a mid-game pillar built after the core economy is standing.
    baseCost: { wood: 160, stone: 120, gold: 60 },
    baseOutputPerSec: 0,
    requiresTownCenterLevel: 3,
    maxLevel: BUILDINGS.MAX_LEVEL,
  },
  wall: {
    kind: 'wall',
    // The Ramparts (성벽): a stone curtain wall. Produces nothing; each level
    // adds a solid block of town defense. Cheap and reachable early (Town
    // Center level 2) so a fresh kingdom can start hardening against raids
    // before the mid-game. Stone-heavy to fit its theme.
    baseCost: { wood: 90, stone: 140 },
    baseOutputPerSec: 0,
    requiresTownCenterLevel: 2,
    maxLevel: BUILDINGS.MAX_LEVEL,
    baseDefense: 40,
  },
  watchtower: {
    kind: 'watchtower',
    // The Watchtower (감시탑): archers' towers that pick off attackers. A
    // smaller per-level defense bump than the wall, but a second, stacking
    // defensive source. Gated behind Town Center level 3 so it is the second
    // defensive step after the wall.
    baseCost: { wood: 120, stone: 100, gold: 30 },
    baseOutputPerSec: 0,
    requiresTownCenterLevel: 3,
    maxLevel: BUILDINGS.MAX_LEVEL,
    baseDefense: 25,
  },
};

/** All building kinds, in a stable display/iteration order. */
export const BUILDING_ORDER: readonly BuildingKind[] = [
  'town_center',
  'farm',
  'lumber_mill',
  'quarry',
  'mine',
  'barracks',
  'research',
  'wall',
  'watchtower',
] as const;

/**
 * The defensive building kinds, in a stable iteration order. Used by
 * {@link BuildingSystem.townDefense} to aggregate the town's total defense
 * across exactly these buildings (and no others).
 */
export const DEFENSE_ORDER: readonly DefenseKind[] = ['wall', 'watchtower'] as const;

/** Lookup a building definition (never undefined for a valid kind). */
export function buildingDef(kind: BuildingKind): BuildingDef {
  return BUILDING_DEFS[kind];
}

/** True when the building is a resource producer (has a `produces` resource). */
export function isProducer(kind: BuildingKind): kind is ProducerKind {
  return BUILDING_DEFS[kind].produces !== undefined;
}

/** True when the building contributes to town defense (a wall / watchtower). */
export function isDefense(kind: BuildingKind): kind is DefenseKind {
  return (BUILDING_DEFS[kind].baseDefense ?? 0) > 0;
}

/**
 * Town-defense points a DEFENSIVE building contributes at a given `level`. Non-
 * defensive buildings and level 0 (not built) contribute nothing. Defense grows
 * LINEARLY: `baseDefense * level`, so a level-3 wall is worth three times a
 * level-1 wall. Pure function of `(kind, level)` so combat and the UI can
 * compute the town's defense deterministically and unit-test it without Phaser.
 */
export function defenseValue(kind: BuildingKind, level: number): number {
  const base = BUILDING_DEFS[kind].baseDefense ?? 0;
  if (base <= 0 || level <= 0) return 0;
  return base * Math.floor(level);
}

/**
 * Resource cost to take a building from `level` to `level + 1`.
 *
 * Level 0 -> 1 (initial build) costs the base cost; each further level
 * multiplies every base component by COST_GROWTH^level and rounds up. `level`
 * is the CURRENT level (0 = not yet built).
 */
export function upgradeCost(kind: BuildingKind, level: number): ResourceCost {
  const def = BUILDING_DEFS[kind];
  const factor = Math.pow(BUILDINGS.COST_GROWTH, Math.max(0, level));
  const out: ResourceCost = {};
  for (const [res, amount] of Object.entries(def.baseCost) as [ResourceKind, number][]) {
    out[res] = Math.ceil(amount * factor);
  }
  return out;
}

/**
 * Time in milliseconds to build/upgrade a building from `level` to `level + 1`.
 * Grows linearly with the target level from BASE_BUILD_SECONDS so higher tiers
 * feel weightier without exploding.
 */
export function upgradeTimeMs(_kind: BuildingKind, level: number): number {
  const targetLevel = Math.max(1, level + 1);
  return BUILDINGS.BASE_BUILD_SECONDS * 1000 * targetLevel;
}

/**
 * Output-per-second of a producer building at a given level. Non-producers and
 * level 0 (not built) produce nothing. Output grows geometrically by
 * OUTPUT_GROWTH per level above 1.
 */
export function outputPerSec(kind: BuildingKind, level: number): number {
  const def = BUILDING_DEFS[kind];
  if (def.baseOutputPerSec <= 0 || level <= 0) return 0;
  return def.baseOutputPerSec * Math.pow(BUILDINGS.OUTPUT_GROWTH, level - 1);
}
