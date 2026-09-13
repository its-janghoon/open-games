import {
  BUILDING_DEFS,
  BUILDING_ORDER,
  buildingDef,
  hasRole,
  housingCapacity,
  isProducer,
  outputPerSec,
  protectedAmount,
  steelThroughputPerSec,
  upgradeCost,
  upgradeTimeMs,
} from '../config/BuildingConfig';
import { REFINERY, WARMTH } from '../config/GameConfig';
import type { BuildingKind, BuildingState, ResourceCost, Resources } from '../types';
import { ResourceStore, type ProductionRates } from './ResourceStore';

/** Outcome of attempting to start an upgrade. */
export interface UpgradeCheck {
  ok: boolean;
  /** Reason code when `ok` is false. */
  reason?: 'busy' | 'max_level' | 'prereq' | 'cost';
}

/**
 * BuildingSystem - owned buildings, their levels, and the upgrade lifecycle.
 *
 * Pure logic (no Phaser). It owns a set of {@link BuildingState}s keyed by kind,
 * enforces the Furnace level gate and per-building prerequisites, checks
 * affordability against a {@link ResourceStore}, runs time-based upgrades, and
 * exposes the aggregate per-second production rates the ResourceStore consumes.
 * Serializable to/from `BuildingState[]`.
 *
 * Level semantics: level 0 means "not built". Starting an upgrade from level 0
 * is the initial build; from level N it advances to N+1 after the configured
 * time. Cost/time/output all come from BuildingConfig so nothing is hardcoded.
 */
export class BuildingSystem {
  private readonly _buildings: Map<BuildingKind, BuildingState> = new Map();

  constructor(states?: BuildingState[]) {
    if (states && states.length > 0) {
      for (const s of states) {
        if (BUILDING_DEFS[s.kind]) {
          const level = Math.min(BUILDING_DEFS[s.kind].maxLevel, Math.max(0, Math.floor(Number.isFinite(s.level) ? s.level : 0)));
          const upgradeEndsAt = typeof s.upgradeEndsAt === 'number' && Number.isFinite(s.upgradeEndsAt) && s.upgradeEndsAt >= 0
            ? s.upgradeEndsAt
            : null;
          this._buildings.set(s.kind, { kind: s.kind, level, upgradeEndsAt });
        }
      }
      const furnace = this.furnaceLevel;
      for (const state of this._buildings.values()) {
        if (state.kind !== 'furnace') state.level = Math.min(state.level, furnace);
      }
    } else {
      // Fresh game: a level-1 Furnace is lit, everything else unbuilt.
      this._buildings.set('furnace', { kind: 'furnace', level: 1, upgradeEndsAt: null });
    }
  }

  /** Current level of a building (0 = not built). */
  level(kind: BuildingKind): number {
    return this._buildings.get(kind)?.level ?? 0;
  }

  /** The current Furnace level (0 if somehow absent). Gates every other building. */
  get furnaceLevel(): number {
    return this.level('furnace');
  }

  /** True while a building has an upgrade in progress. */
  isUpgrading(kind: BuildingKind): boolean {
    return (this._buildings.get(kind)?.upgradeEndsAt ?? null) !== null;
  }

  /** Epoch ms an in-progress upgrade finishes, or null. */
  upgradeEndsAt(kind: BuildingKind): number | null {
    return this._buildings.get(kind)?.upgradeEndsAt ?? null;
  }

  /** Cost to take `kind` from its current level to the next. */
  nextUpgradeCost(kind: BuildingKind): ResourceCost {
    return upgradeCost(kind, this.level(kind));
  }

  /** Time in ms the next upgrade of `kind` will take. */
  nextUpgradeTimeMs(kind: BuildingKind): number {
    return upgradeTimeMs(kind, this.level(kind));
  }

  /**
   * Whether an upgrade of `kind` may be STARTED right now against `store`.
   * Checks (in order): not already upgrading, below max level, Furnace gate
   * (both the hard `requiresFurnaceLevel` and the "may not exceed Furnace level"
   * rule for non-Furnace buildings), and affordability.
   */
  canUpgrade(kind: BuildingKind, store: ResourceStore): UpgradeCheck {
    const def = buildingDef(kind);
    const level = this.level(kind);

    if (this.isUpgrading(kind)) return { ok: false, reason: 'busy' };
    if (level >= def.maxLevel) return { ok: false, reason: 'max_level' };

    if (kind === 'furnace') {
      // The Furnace is only gated by its own max level (checked above).
    } else {
      const furnace = this.furnaceLevel;
      // Hard prerequisite: enough Furnace level to own this at all.
      if (furnace < def.requiresFurnaceLevel) return { ok: false, reason: 'prereq' };
      // Soft gate: a building's level may never exceed the Furnace's.
      if (level >= furnace) return { ok: false, reason: 'prereq' };
    }

    if (!store.canAfford(this.nextUpgradeCost(kind))) return { ok: false, reason: 'cost' };
    return { ok: true };
  }

  /**
   * Start an upgrade: spends the cost from `store` and schedules completion at
   * `now + upgradeTime`. Returns the check result; on failure nothing changes.
   */
  startUpgrade(kind: BuildingKind, store: ResourceStore, now: number, buildSpeed = 0): UpgradeCheck {
    const check = this.canUpgrade(kind, store);
    if (!check.ok) return check;

    const cost = this.nextUpgradeCost(kind);
    if (!store.spend(cost)) return { ok: false, reason: 'cost' };

    const existing = this._buildings.get(kind) ?? { kind, level: 0, upgradeEndsAt: null };
    existing.kind = kind;
    const baseDuration = this.nextUpgradeTimeMs(kind);
    const effectiveDuration = Math.max(1_000, Math.ceil(baseDuration / (1 + Math.max(0, buildSpeed))));
    existing.upgradeEndsAt = now + effectiveDuration;
    this._buildings.set(kind, existing);
    return { ok: true };
  }

  /**
   * Complete any upgrades whose timer has elapsed at `now`. Increments each
   * finished building's level and clears its timer. Returns the kinds that
   * completed (useful for SFX / notifications).
   */
  update(now: number): BuildingKind[] {
    const completed: BuildingKind[] = [];
    for (const state of this._buildings.values()) {
      if (state.upgradeEndsAt !== null && now >= state.upgradeEndsAt) {
        state.level += 1;
        state.upgradeEndsAt = null;
        completed.push(state.kind);
      }
    }
    return completed;
  }

  /**
   * Epoch-ms timestamps of every in-progress upgrade's completion, unsorted.
   * Used by the save layer to split an offline window at upgrade boundaries so
   * production is credited at the rates actually in effect during each segment.
   */
  pendingCompletions(): number[] {
    const out: number[] = [];
    for (const state of this._buildings.values()) {
      if (state.upgradeEndsAt !== null) out.push(state.upgradeEndsAt);
    }
    return out;
  }

  /** Whether the War Camp is built (level >= 1), gating troop training. */
  get hasWarCamp(): boolean {
    return this.level('war_camp') >= 1;
  }

  /**
   * Bring an in-progress upgrade's completion forward by `ms` (alliance help).
   * No-op when the building is idle. Returns the ms actually shaved off (capped
   * so the timer never lands before "now-ish" is the caller's concern; we clamp
   * the reduction to what remains so the timer can complete but not go
   * negative). The upgrade itself completes on the next {@link update}.
   */
  reduceUpgradeTimer(kind: BuildingKind, ms: number, now: number): number {
    const state = this._buildings.get(kind);
    if (!state || state.upgradeEndsAt === null || ms <= 0) return 0;
    const remaining = Math.max(0, state.upgradeEndsAt - now);
    const shaved = Math.min(ms, remaining);
    state.upgradeEndsAt -= shaved;
    return shaved;
  }

  /** Any building kind currently upgrading (stable BUILDING_ORDER), or null. */
  firstUpgrading(): BuildingKind | null {
    for (const kind of BUILDING_ORDER) {
      if (this.isUpgrading(kind)) return kind;
    }
    return null;
  }

  /**
   * Aggregate per-second production rates across all producer buildings at
   * their current levels. Fed to ResourceStore.applyProduction.
   */
  productionRates(): ProductionRates {
    const rates = ResourceStore.emptyBundle();
    for (const kind of BUILDING_ORDER) {
      if (!isProducer(kind)) continue;
      const def = buildingDef(kind);
      const level = this.level(kind);
      if (level <= 0 || !def.produces) continue;
      rates[def.produces] += outputPerSec(kind, level);
    }
    // Survivors forage a trickle of timber even with nothing built. This is the
    // anti-softlock floor described on WARMTH.BASELINE_FORAGE_WOOD_PER_SEC: both
    // starter producers cost a resource the Furnace burns, so without it a hold
    // could strand itself with no affordable action and no income at all.
    rates.wood += WARMTH.BASELINE_FORAGE_WOOD_PER_SEC;
    return rates;
  }

  /**
   * Total extra survivor housing across all Shelter Row (housing) buildings at
   * their current levels. Consumed by PopulationSystem to derive the cap.
   */
  totalHousing(): number {
    let total = 0;
    for (const kind of BUILDING_ORDER) {
      if (!hasRole(kind, 'housing')) continue;
      total += housingCapacity(kind, this.level(kind));
    }
    return total;
  }

  /**
   * The amount of `balance` of a single resource that the Frost Vault(s)
   * shelter from raid loss at their current level. Sums across every storage
   * building (there is normally one). Never exceeds the balance.
   */
  protectedStorage(balance: number): number {
    let protectedTotal = 0;
    for (const kind of BUILDING_ORDER) {
      if (!hasRole(kind, 'storage')) continue;
      protectedTotal += protectedAmount(kind, this.level(kind), balance);
    }
    return Math.min(Math.max(0, balance), protectedTotal);
  }

  /**
   * Total producer LEVELS across the base (sum of every producer building's
   * level). Multiplied by POPULATION.STAFF_PER_PRODUCER_LEVEL this is the number
   * of survivors the base wants to be fully staffed.
   */
  totalProducerLevels(): number {
    let sum = 0;
    for (const kind of BUILDING_ORDER) {
      if (!isProducer(kind)) continue;
      sum += this.level(kind);
    }
    return sum;
  }

  /** Aggregate steel-per-second throughput across all refinery (Forge Hall) buildings. */
  steelThroughput(): number {
    let total = 0;
    for (const kind of BUILDING_ORDER) {
      if (!hasRole(kind, 'refinery')) continue;
      total += steelThroughputPerSec(kind, this.level(kind));
    }
    return total;
  }

  /**
   * Run the refinery for an elapsed `dtMs`: the Forge Hall(s) try to mint their
   * combined steel throughput, each unit of steel consuming REFINERY inputs
   * (iron + coal) from `store`. Output is limited by whichever is scarcer -
   * throughput or affordable inputs - and further scaled by `efficiency`
   * (1 live, ECONOMY.OFFLINE_EFFICIENCY * warmth offline), matching how idle
   * production is credited. Returns the steel actually minted (already added to
   * the store). Pure aside from mutating the passed store.
   */
  refineryConversion(store: ResourceStore, dtMs: number, efficiency = 1): number {
    if (dtMs <= 0 || efficiency <= 0) return 0;
    const throughput = this.steelThroughput();
    if (throughput <= 0) return 0;

    const seconds = dtMs / 1000;
    // Steel the Forge Hall wants to mint this interval (before input limits).
    const desired = throughput * seconds * efficiency;
    if (desired <= 0) return 0;

    // How many units of steel the current iron/coal stock can actually pay for.
    const ironPer = REFINERY.INPUT_PER_STEEL.iron;
    const coalPer = REFINERY.INPUT_PER_STEEL.coal;
    const ironLimited = ironPer > 0 ? store.get('iron') / ironPer : Infinity;
    const coalLimited = coalPer > 0 ? store.get('coal') / coalPer : Infinity;
    const minted = Math.max(0, Math.min(desired, ironLimited, coalLimited));
    if (minted <= 0) return 0;

    // Clamp spend to the live balance so floating-point rounding can never
    // leave the atomic `spend` short (which would mint steel without paying).
    const ironCost = Math.min(minted * ironPer, store.get('iron'));
    const coalCost = Math.min(minted * coalPer, store.get('coal'));
    store.add({ iron: -ironCost, coal: -coalCost, steel: minted });
    return minted;
  }

  /** Serialize the owned buildings to a plain array. */
  toJSON(): BuildingState[] {
    return [...this._buildings.values()].map((s) => ({ ...s }));
  }

  /** Restore from a plain array produced by {@link toJSON}. */
  static fromJSON(states: BuildingState[] | undefined): BuildingSystem {
    return new BuildingSystem(states);
  }

  /** The current owned-building snapshot (defensive copies). */
  get states(): BuildingState[] {
    return this.toJSON();
  }

  /** Read-only helper: total production of a single resource, for HUD. */
  outputOf(res: keyof Resources): number {
    return this.productionRates()[res];
  }
}
