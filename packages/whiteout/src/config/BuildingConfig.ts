/**
 * BuildingConfig - the per-building tuning table for Frosthold: Last Ember.
 *
 * GameConfig.ts holds the shared *curve* parameters (geometric cost/output
 * growth, base build seconds, max level, Furnace gating). This module holds the
 * per-building *base* numbers those curves are applied to: what a building
 * costs at level 1, how much a producer outputs at level 1, and how the Furnace
 * (the settlement's Ember) gates the rest of the roster.
 *
 * All formulas are pure functions of `(kind, level)` so the economy, building,
 * and save systems can compute costs / outputs / timings deterministically and
 * unit-test them without Phaser.
 */

import { BUILDINGS, POPULATION, REFINERY, WAREHOUSE } from './GameConfig';
import type { BuildingKind, ProducerKind, ResourceCost, ResourceKind } from '../types';

/**
 * Special (non-idle-producer) roles a building can carry. A building may be a
 * plain producer (`produces` set), or carry one of these roles that the systems
 * layer treats specially: `housing` (Shelter Row raises the population cap),
 * `storage` (Frost Vault shelters resources), or `refinery` (Forge Hall
 * converts raw inputs into refined steel). Roles are additive to the base
 * cost/time curves; the capacity math lives in the pure helpers below.
 */
export type BuildingRole = 'housing' | 'storage' | 'refinery';

/** Static definition for a single building kind. */
export interface BuildingDef {
  kind: BuildingKind;
  /** Resource cost to build the FIRST level (level 1). Scales by COST_GROWTH. */
  baseCost: ResourceCost;
  /** For producers: base output-per-second at level 1. 0 for non-producers. */
  baseOutputPerSec: number;
  /** For producers: which resource this building generates (undefined otherwise). */
  produces?: ResourceKind;
  /** Special non-producer role, if any (housing / storage / refinery). */
  role?: BuildingRole;
  /**
   * Minimum Furnace level required to build/own this building AT ALL. The
   * Furnace itself is always buildable (0). This is the hard prerequisite;
   * separately, a non-Furnace building may never exceed the current Furnace
   * level (enforced in BuildingSystem).
   */
  requiresFurnaceLevel: number;
  /** Highest level this building can reach (defaults to the global MAX_LEVEL). */
  maxLevel: number;
}

/**
 * The building roster. Producer outputs are balanced so early food/wood flow
 * faster than the scarcer coal/iron. The War Camp produces nothing but unlocks
 * troop training; the Furnace produces nothing but keeps the Ember burning and
 * raises the level cap of everything else.
 */
export const BUILDING_DEFS: Record<BuildingKind, BuildingDef> = {
  furnace: {
    kind: 'furnace',
    baseCost: { wood: 100, coal: 60 },
    baseOutputPerSec: 0,
    requiresFurnaceLevel: 0,
    maxLevel: BUILDINGS.MAX_LEVEL,
  },
  hunters_hut: {
    kind: 'hunters_hut',
    baseCost: { wood: 40, food: 20 },
    baseOutputPerSec: 2.0,
    produces: 'food',
    requiresFurnaceLevel: 1,
    maxLevel: BUILDINGS.MAX_LEVEL,
  },
  sawmill: {
    // Rations only, no coal. The Sawmill is what ends a timber drought, so it
    // must not require a resource the Furnace burns - otherwise a hold that has
    // run dry can never build the thing that would refill it.
    kind: 'sawmill',
    baseCost: { food: 60 },
    baseOutputPerSec: 1.6,
    produces: 'wood',
    requiresFurnaceLevel: 1,
    maxLevel: BUILDINGS.MAX_LEVEL,
  },
  coal_pit: {
    kind: 'coal_pit',
    baseCost: { wood: 80, food: 40 },
    baseOutputPerSec: 1.0,
    produces: 'coal',
    requiresFurnaceLevel: 2,
    maxLevel: BUILDINGS.MAX_LEVEL,
  },
  iron_mine: {
    kind: 'iron_mine',
    baseCost: { wood: 120, coal: 80 },
    baseOutputPerSec: 0.5,
    produces: 'iron',
    requiresFurnaceLevel: 3,
    maxLevel: BUILDINGS.MAX_LEVEL,
  },
  war_camp: {
    kind: 'war_camp',
    baseCost: { wood: 150, coal: 100 },
    baseOutputPerSec: 0,
    requiresFurnaceLevel: 2,
    maxLevel: BUILDINGS.MAX_LEVEL,
  },

  // --- FEAT-002 expanded city (all original names / roles) ---

  // Shelter Row: survivor housing. Raises the population cap (see housingCapacity).
  shelter_row: {
    kind: 'shelter_row',
    baseCost: { wood: 120, food: 80 },
    baseOutputPerSec: 0,
    role: 'housing',
    requiresFurnaceLevel: 1,
    maxLevel: BUILDINGS.MAX_LEVEL,
  },
  // Frost Vault: shelters a fraction of every stockpile from raid loss.
  frost_vault: {
    kind: 'frost_vault',
    baseCost: { wood: 140, iron: 40 },
    baseOutputPerSec: 0,
    role: 'storage',
    requiresFurnaceLevel: 2,
    maxLevel: BUILDINGS.MAX_LEVEL,
  },
  // Forge Hall: steelworks refinery, converts iron + coal into refined steel.
  forge_hall: {
    kind: 'forge_hall',
    baseCost: { iron: 120, coal: 120 },
    baseOutputPerSec: 0,
    role: 'refinery',
    requiresFurnaceLevel: 3,
    maxLevel: BUILDINGS.MAX_LEVEL,
  },
  // Envoy Hall: diplomacy / help hub (support building, no idle output).
  envoy_hall: {
    kind: 'envoy_hall',
    baseCost: { wood: 160, food: 120 },
    baseOutputPerSec: 0,
    requiresFurnaceLevel: 2,
    maxLevel: BUILDINGS.MAX_LEVEL,
  },
  // Warming Ward: recovers wounded survivors (support building, no idle output).
  warming_ward: {
    kind: 'warming_ward',
    baseCost: { food: 160, coal: 80 },
    baseOutputPerSec: 0,
    requiresFurnaceLevel: 2,
    maxLevel: BUILDINGS.MAX_LEVEL,
  },
  // Ember Archive: research / academy building (support building, no idle output).
  ember_archive: {
    kind: 'ember_archive',
    baseCost: { wood: 200, iron: 80 },
    baseOutputPerSec: 0,
    requiresFurnaceLevel: 3,
    maxLevel: BUILDINGS.MAX_LEVEL,
  },
  // Class training yards (FEAT-004 will train troops from these).
  infantry_yard: {
    kind: 'infantry_yard',
    baseCost: { wood: 180, iron: 60 },
    baseOutputPerSec: 0,
    requiresFurnaceLevel: 2,
    maxLevel: BUILDINGS.MAX_LEVEL,
  },
  lancer_yard: {
    kind: 'lancer_yard',
    baseCost: { wood: 180, iron: 80 },
    baseOutputPerSec: 0,
    requiresFurnaceLevel: 3,
    maxLevel: BUILDINGS.MAX_LEVEL,
  },
  marksman_range: {
    kind: 'marksman_range',
    baseCost: { wood: 200, iron: 100 },
    baseOutputPerSec: 0,
    requiresFurnaceLevel: 4,
    maxLevel: BUILDINGS.MAX_LEVEL,
  },
};

/**
 * All building kinds, in a stable display/iteration order laid out by tier:
 * the Furnace, the raw producers, then the FEAT-002 support city (housing,
 * storage, refinery, diplomacy, infirmary, research) and finally the military
 * buildings (war camp + the three class yards).
 */
export const BUILDING_ORDER: readonly BuildingKind[] = [
  'furnace',
  'hunters_hut',
  'sawmill',
  'coal_pit',
  'iron_mine',
  'shelter_row',
  'frost_vault',
  'forge_hall',
  'envoy_hall',
  'warming_ward',
  'ember_archive',
  'war_camp',
  'infantry_yard',
  'lancer_yard',
  'marksman_range',
] as const;

/** Lookup a building definition (never undefined for a valid kind). */
export function buildingDef(kind: BuildingKind): BuildingDef {
  return BUILDING_DEFS[kind];
}

/**
 * Why a building is currently locked at a given Furnace level, if it is. This
 * is the pure, Phaser-free source of the human-facing "Furnace Lv.N required"
 * label the Town shows in place of a bare "Locked".
 *
 * - `locked` is false when the building could be built/upgraded now (the caller
 *   still checks affordability separately - this only reports the Furnace gate).
 * - `reason` is `'prereq'` (mirroring {@link BuildingSystem.canUpgrade}) when the
 *   Furnace gate is unmet, either because the hard `requiresFurnaceLevel` is not
 *   yet reached OR because a non-Furnace building may never exceed the current
 *   Furnace level (the "soft gate").
 * - `requiredFurnaceLevel` is the Furnace level the player must reach for the
 *   building to become buildable/upgradable at its CURRENT level: the max of the
 *   hard prerequisite and (currentLevel + 1) for the soft gate. It is the number
 *   the UI renders in `town.lockedRequires`.
 *
 * The Furnace itself is never gated (it is the gate), so it always returns
 * `{ locked: false }`.
 */
export interface UnlockRequirement {
  locked: boolean;
  reason?: 'prereq';
  /** Furnace level required to (build or) upgrade this building right now. */
  requiredFurnaceLevel: number;
}

export function unlockRequirement(
  kind: BuildingKind,
  currentLevel: number,
  furnaceLevel: number,
): UnlockRequirement {
  const def = BUILDING_DEFS[kind];
  if (kind === 'furnace') {
    // The Furnace is the gate; it is never gated by itself.
    return { locked: false, requiredFurnaceLevel: 0 };
  }
  // Hard prerequisite: enough Furnace level to own this at all. Soft gate: a
  // non-Furnace building's level may never exceed the Furnace's, so to advance
  // to (currentLevel + 1) the Furnace must be at least that high.
  const required = Math.max(def.requiresFurnaceLevel, currentLevel + 1);
  if (furnaceLevel < required) {
    return { locked: true, reason: 'prereq', requiredFurnaceLevel: required };
  }
  return { locked: false, requiredFurnaceLevel: required };
}

/** True when the building is a resource producer (has a `produces` resource). */
export function isProducer(kind: BuildingKind): kind is ProducerKind {
  return BUILDING_DEFS[kind].produces !== undefined;
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

/** True when the building carries the given special role at its definition. */
export function hasRole(kind: BuildingKind, role: BuildingRole): boolean {
  return BUILDING_DEFS[kind].role === role;
}

/**
 * Extra housing capacity contributed by a Shelter Row (`housing` role) at a
 * given level. Non-housing buildings and level 0 contribute nothing. Grows
 * linearly with level from POPULATION.HOUSING_PER_LEVEL so each new level houses
 * a predictable number of survivors.
 */
export function housingCapacity(kind: BuildingKind, level: number): number {
  if (!hasRole(kind, 'housing') || level <= 0) return 0;
  return POPULATION.HOUSING_PER_LEVEL * level;
}

/**
 * The protected fraction of a stockpile a Frost Vault (`storage` role) shelters
 * at a given level. Rises from WAREHOUSE.BASE_PROTECTED_FRACTION by
 * PROTECTED_FRACTION_PER_LEVEL per level, capped at MAX_PROTECTED_FRACTION. A
 * non-storage building or level 0 protects nothing.
 */
export function protectedFraction(kind: BuildingKind, level: number): number {
  if (!hasRole(kind, 'storage') || level <= 0) return 0;
  const frac =
    WAREHOUSE.BASE_PROTECTED_FRACTION + WAREHOUSE.PROTECTED_FRACTION_PER_LEVEL * (level - 1);
  return Math.min(WAREHOUSE.MAX_PROTECTED_FRACTION, frac);
}

/**
 * The absolute amount of a `balance` sheltered from loss given a storage
 * building's level (never more than the balance itself).
 */
export function protectedAmount(kind: BuildingKind, level: number, balance: number): number {
  return Math.max(0, balance) * protectedFraction(kind, level);
}

/**
 * Steel a Forge Hall (`refinery` role) can mint per second at a given level,
 * before input constraints. Grows geometrically by OUTPUT_GROWTH per level from
 * REFINERY.BASE_STEEL_PER_SEC. A non-refinery building or level 0 mints nothing.
 */
export function steelThroughputPerSec(kind: BuildingKind, level: number): number {
  if (!hasRole(kind, 'refinery') || level <= 0) return 0;
  return REFINERY.BASE_STEEL_PER_SEC * Math.pow(BUILDINGS.OUTPUT_GROWTH, level - 1);
}
