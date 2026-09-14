import {
  BUILDING_DEFS,
  BUILDING_ORDER,
  DEFENSE_ORDER,
  buildingDef,
  defenseValue,
  isProducer,
  outputPerSec,
  upgradeCost,
  upgradeTimeMs,
} from '../config/BuildingConfig';
import type { BuildingKind, BuildingState, ResourceCost, Resources } from '../types';
import { WARMTH } from '../config/GameConfig';
import { ResourceStore, type ProductionRates } from './ResourceStore';

/** Outcome of attempting to start an upgrade. */
export interface UpgradeCheck {
  ok: boolean;
  /** Reason code when `ok` is false. */
  reason?: 'busy' | 'max_level' | 'prereq' | 'cost';
}

/**
 * The three visible states a building's overhead badge / build panel can be in,
 * used to tell the player at a glance whether a building is standing, ready to
 * build right now, or still gated behind a higher Town Center level:
 *  - 'built'     : level >= 1 (it is standing; show its level).
 *  - 'buildable' : level 0 AND the Town Center prerequisite is met, so the
 *                  player can start the build now (a lack of resources —
 *                  reason 'cost' — is NOT "locked": it is still buildable, just
 *                  not yet affordable).
 *  - 'locked'    : level 0 AND the Town Center prerequisite is unmet
 *                  (canUpgrade reason 'prereq'); the player must first raise the
 *                  Town Center to {@link BadgeState.requiredTownCenterLevel}.
 */
export interface BadgeState {
  state: 'built' | 'buildable' | 'locked';
  /**
   * The Town Center level this building requires to be built at all. Populated
   * for every state so a 'locked' badge can name the level the player needs.
   */
  requiredTownCenterLevel: number;
}

/**
 * BuildingSystem - owned buildings, their levels, and the upgrade lifecycle.
 *
 * Pure logic (no Phaser). It owns a set of {@link BuildingState}s keyed by kind,
 * enforces the Town-Center level gate and per-building prerequisites, checks
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
          this._buildings.set(s.kind, { kind: s.kind, level: s.level, upgradeEndsAt: s.upgradeEndsAt });
        }
      }
    } else {
      // Fresh game: a level-1 Town Center is standing, everything else unbuilt.
      this._buildings.set('town_center', { kind: 'town_center', level: 1, upgradeEndsAt: null });
    }
  }

  /** Current level of a building (0 = not built). */
  level(kind: BuildingKind): number {
    return this._buildings.get(kind)?.level ?? 0;
  }

  /** The current Town Center level (0 if somehow absent). */
  get townCenterLevel(): number {
    return this.level('town_center');
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
   * Checks (in order): not already upgrading, below max level, Town-Center gate
   * (both the hard `requiresTownCenterLevel` and the "may not exceed TC level"
   * rule for non-Town-Center buildings), and affordability.
   */
  canUpgrade(kind: BuildingKind, store: ResourceStore): UpgradeCheck {
    const def = buildingDef(kind);
    const level = this.level(kind);

    if (this.isUpgrading(kind)) return { ok: false, reason: 'busy' };
    if (level >= def.maxLevel) return { ok: false, reason: 'max_level' };

    if (kind === 'town_center') {
      // Town Center is only gated by its own max level (checked above).
    } else {
      const tc = this.townCenterLevel;
      // Hard prerequisite: enough Town Center level to own this at all.
      if (tc < def.requiresTownCenterLevel) return { ok: false, reason: 'prereq' };
      // Soft gate: a building's level may never exceed the Town Center's.
      if (level >= tc) return { ok: false, reason: 'prereq' };
    }

    if (!store.canAfford(this.nextUpgradeCost(kind))) return { ok: false, reason: 'cost' };
    return { ok: true };
  }

  /**
   * The visible {@link BadgeState} for `kind` right now, distinguishing a
   * standing building from one that is buildable-immediately versus one still
   * gated behind a higher Town Center. This is the single source of truth the
   * town badges and the build/upgrade panel share so the UI never contradicts
   * itself (e.g. never shows a "Locked" label next to an enabled Build button).
   *
   * It reuses {@link canUpgrade}'s reasons rather than re-deriving the gate:
   * only reason 'prereq' (Town Center level too low) counts as truly LOCKED;
   * 'cost' still means buildable (just not yet affordable). `store` is passed so
   * this stays a thin wrapper over the same check the button uses.
   */
  badgeState(kind: BuildingKind, store: ResourceStore): BadgeState {
    const requiredTownCenterLevel = buildingDef(kind).requiresTownCenterLevel;
    if (this.level(kind) >= 1) {
      return { state: 'built', requiredTownCenterLevel };
    }
    // Unbuilt: it is truly LOCKED only when the Town Center prerequisite is the
    // thing blocking it. Anything else (affordable-or-not, i.e. reason 'cost' or
    // ok) is presented as an inviting "buildable now" affordance.
    const check = this.canUpgrade(kind, store);
    if (!check.ok && check.reason === 'prereq') {
      return { state: 'locked', requiredTownCenterLevel };
    }
    return { state: 'buildable', requiredTownCenterLevel };
  }

  /**
   * Start an upgrade: spends the cost from `store` and schedules completion at
   * `now + upgradeTime`. Returns the check result; on failure nothing changes.
   *
   * `buildSpeedMult` scales the upgrade duration (a value < 1 finishes faster).
   * It defaults to 1 (neutral) so existing callers/tests are unaffected; the
   * research feature threads its {@link ResearchSystem.buildSpeedMultiplier}
   * through here so "build speed" techs shorten real upgrade timers.
   */
  startUpgrade(
    kind: BuildingKind,
    store: ResourceStore,
    now: number,
    buildSpeedMult = 1,
  ): UpgradeCheck {
    const check = this.canUpgrade(kind, store);
    if (!check.ok) return check;

    const cost = this.nextUpgradeCost(kind);
    if (!store.spend(cost)) return { ok: false, reason: 'cost' };

    const existing = this._buildings.get(kind) ?? { kind, level: 0, upgradeEndsAt: null };
    existing.kind = kind;
    existing.upgradeEndsAt = now + this.nextUpgradeTimeMs(kind) * Math.max(0, buildSpeedMult);
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
    // Canonical order is mandatory when multiple upgrades share a timestamp.
    for (const kind of BUILDING_ORDER) {
      const state = this._buildings.get(kind);
      if (state && state.upgradeEndsAt !== null && now >= state.upgradeEndsAt) {
        state.level = Math.min(buildingDef(kind).maxLevel, state.level + 1);
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

  /** Whether the Barracks is built (level >= 1), gating troop training. */
  get hasBarracks(): boolean {
    return this.level('barracks') >= 1;
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
    // Townsfolk gather a little of anything they have no producer for. This is
    // the anti-softlock floor on WARMTH.BASELINE_GATHER_PER_SEC: a town that has
    // spent everything must still be able to earn its way back to a producer,
    // and the cheapest one costs BOTH timber and rations.
    for (const res of Object.keys(WARMTH.BASELINE_GATHER_PER_SEC) as (keyof ProductionRates)[]) {
      const rate = WARMTH.BASELINE_GATHER_PER_SEC[res as 'food' | 'stone'];
      if (rates[res] <= 0) rates[res] += rate;
    }
    return rates;
  }

  /**
   * The town's aggregate DEFENSE value: the sum of every owned defensive
   * building's {@link defenseValue} at its current level. A fresh town with no
   * walls/watchtowers returns 0; each level of a wall or watchtower raises it.
   * Pure and monotonic in defensive-building levels. The combat resolver reads
   * this to let a well-fortified town survive raids a bare town would lose (and
   * to soften a loss it cannot yet win) - see {@link CombatSystem.resolve}.
   */
  townDefense(): number {
    let total = 0;
    for (const kind of DEFENSE_ORDER) {
      total += defenseValue(kind, this.level(kind));
    }
    return total;
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
