import { describe, it, expect } from 'vitest';
import { WarmthSystem } from './WarmthSystem';
import { ResourceStore } from './ResourceStore';
import { WARMTH, warmthProductionMultiplier } from '../config/GameConfig';
import { BUILDING_DEFS } from '../config/BuildingConfig';

/**
 * Unit tests for the WarmthSystem - the signature frozen-survival mechanic.
 * These exercise the REAL fuel-burn / decay / clamp / production-curve code
 * paths (they would fail if the logic were reverted to a stub), not just
 * static config constants.
 */
describe('WarmthSystem', () => {
  /** A store with effectively unlimited fuel. */
  function richStore(): ResourceStore {
    return new ResourceStore({ food: 1e9, wood: 1e9, coal: 1e9, iron: 1e9 });
  }

  it('defaults to full warmth for a fresh hold', () => {
    const w = new WarmthSystem();
    expect(w.warmth).toBe(WARMTH.MAX_WARMTH);
  });

  it('maxWarmth scales up with Furnace level', () => {
    const w = new WarmthSystem();
    expect(w.maxWarmth(1)).toBe(WARMTH.MAX_WARMTH);
    expect(w.maxWarmth(2)).toBe(WARMTH.MAX_WARMTH + WARMTH.MAX_WARMTH_PER_LEVEL);
    expect(w.maxWarmth(5)).toBe(WARMTH.MAX_WARMTH + WARMTH.MAX_WARMTH_PER_LEVEL * 4);
    // Level 0 / below 1 never goes under the baseline.
    expect(w.maxWarmth(0)).toBe(WARMTH.MAX_WARMTH);
  });

  it('burns the expected fuel and raises warmth when fuel is ample', () => {
    const store = richStore();
    const woodBefore = store.get('wood');
    const coalBefore = store.get('coal');
    // Start below max so a fueled tick can actually rise.
    const w = new WarmthSystem(50);

    const res = w.tick(1000, 1, store); // 1 second at Furnace level 1
    expect(res.fueled).toBe(true);
    expect(res.fuelSpent.wood).toBeCloseTo(WARMTH.FUEL_PER_SECOND.wood, 6);
    // A level-1 Furnace burns timber ONLY: coal does not enter the mix until
    // WARMTH.COAL_FROM_FURNACE_LEVEL, the level that unlocks the Coal Pit.
    expect(res.fuelSpent.coal).toBe(0);
    // Store was actually debited by the burned fuel.
    expect(store.get('wood')).toBeCloseTo(woodBefore - WARMTH.FUEL_PER_SECOND.wood, 6);
    expect(store.get('coal')).toBe(coalBefore);
    // Warmth rose by the per-second gain.
    expect(w.warmth).toBeCloseTo(50 + WARMTH.WARMTH_GAIN_PER_SEC, 6);
  });

  it('demands no coal below COAL_FROM_FURNACE_LEVEL, and coal at or above it', () => {
    const w = new WarmthSystem(50);
    for (let level = 1; level < WARMTH.COAL_FROM_FURNACE_LEVEL; level += 1) {
      expect(w.fuelPerSecond(level).coal).toBe(0);
      expect(w.fuelPerSecond(level).wood).toBeGreaterThan(0);
    }
    expect(w.fuelPerSecond(WARMTH.COAL_FROM_FURNACE_LEVEL).coal).toBeGreaterThan(0);
  });

  it('never demands a resource before the hold can produce it', () => {
    // The deadlock this guards: a Furnace that burns coal from second one while
    // the only coal producer is gated behind a Furnace upgrade paid for in coal.
    // Every fuel resource must be producible at the level it is first demanded.
    const w = new WarmthSystem(50);
    const producerLevel: Record<string, number> = {
      wood: BUILDING_DEFS.sawmill.requiresFurnaceLevel,
      coal: BUILDING_DEFS.coal_pit.requiresFurnaceLevel,
    };
    for (let level = 1; level <= 10; level += 1) {
      const demand = w.fuelPerSecond(level);
      for (const res of ['wood', 'coal'] as const) {
        if (demand[res] > 0) {
          expect(producerLevel[res]).toBeLessThanOrEqual(level);
        }
      }
    }
  });

  it('burns a partial share and moves warmth partially when fuel is short', () => {
    // Half a second of wood in the store at level 1 -> half the demand paid,
    // so warmth lands between full gain and full decay instead of cliffing.
    const perSec = new WarmthSystem(50).fuelPerSecond(1);
    const store = new ResourceStore({ food: 0, wood: perSec.wood * 0.5, coal: 0, iron: 0 });
    const w = new WarmthSystem(50);

    const res = w.tick(1000, 1, store);
    expect(res.fueled).toBe(false);
    expect(res.fuelSpent.wood).toBeCloseTo(perSec.wood * 0.5, 6);
    expect(store.get('wood')).toBeCloseTo(0, 6);
    const expected = 50 + 0.5 * WARMTH.WARMTH_GAIN_PER_SEC - 0.5 * WARMTH.WARMTH_DECAY_PER_SEC;
    expect(w.warmth).toBeCloseTo(expected, 6);
    // Strictly better than the old all-or-nothing outcome (pure decay).
    expect(w.warmth).toBeGreaterThan(50 - WARMTH.WARMTH_DECAY_PER_SEC);
  });

  it('recovers warmth from timber alone when coal is exhausted', () => {
    // The state a stranded save is actually in: Furnace past the coal gate,
    // coal at zero, timber available. Weighting the burn share by demand means
    // the wood still counts, so warmth climbs back instead of being pinned at
    // zero by the missing coal - which is what a per-resource minimum would do.
    const level = WARMTH.COAL_FROM_FURNACE_LEVEL;
    const perSec = new WarmthSystem().fuelPerSecond(level);
    const store = new ResourceStore({ food: 0, wood: 1000, coal: 0, iron: 0 });
    const w = new WarmthSystem(0);

    const res = w.tick(1000, level, store);
    expect(res.fueled).toBe(false);
    expect(res.fuelSpent.wood).toBeCloseTo(perSec.wood, 6);
    expect(res.fuelSpent.coal).toBe(0);

    // Share is wood's slice of total demand, so warmth moves by that fraction
    // of the gain minus the remainder of the decay - and here that is upward.
    const woodShare = perSec.wood / (perSec.wood + perSec.coal);
    const expected =
      woodShare * WARMTH.WARMTH_GAIN_PER_SEC - (1 - woodShare) * WARMTH.WARMTH_DECAY_PER_SEC;
    expect(w.warmth).toBeCloseTo(Math.max(0, expected), 6);
    expect(w.warmth).toBeGreaterThan(0);
  });

  it('higher Furnace level burns less fuel (efficiency)', () => {
    const l1 = new WarmthSystem(50).fuelPerSecond(1);
    const l5 = new WarmthSystem(50).fuelPerSecond(5);
    expect(l5.wood).toBeLessThan(l1.wood);
    // Coal is compared from the level it starts being demanded, since below
    // COAL_FROM_FURNACE_LEVEL the demand is zero rather than merely smaller.
    const lCoal = new WarmthSystem(50).fuelPerSecond(WARMTH.COAL_FROM_FURNACE_LEVEL);
    expect(l5.coal).toBeLessThan(lCoal.coal);
    // Never below the configured floor factor of the base.
    const floorWood = WARMTH.FUEL_PER_SECOND.wood * WARMTH.FUEL_MIN_FACTOR;
    expect(new WarmthSystem().fuelPerSecond(999).wood).toBeCloseTo(floorWood, 6);
  });

  it('decays toward 0 and does not spend fuel when the store is empty', () => {
    const empty = new ResourceStore({ food: 0, wood: 0, coal: 0, iron: 0 });
    const w = new WarmthSystem(WARMTH.MAX_WARMTH);

    const res = w.tick(1000, 1, empty);
    expect(res.fueled).toBe(false);
    expect(res.fuelSpent).toEqual({ wood: 0, coal: 0 });
    expect(w.warmth).toBeCloseTo(WARMTH.MAX_WARMTH - WARMTH.WARMTH_DECAY_PER_SEC, 6);
    // Store untouched.
    expect(empty.get('wood')).toBe(0);
    expect(empty.get('coal')).toBe(0);
  });

  it('production multiplier drops toward the floor as warmth falls', () => {
    const empty = new ResourceStore({ food: 0, wood: 0, coal: 0, iron: 0 });
    const w = new WarmthSystem(WARMTH.MAX_WARMTH);
    expect(w.productionMultiplier(1)).toBeCloseTo(1, 6);

    // Drain warmth to zero over a long unfueled span.
    w.tick(1_000_000, 1, empty);
    expect(w.warmth).toBe(0);
    expect(w.productionMultiplier(1)).toBeCloseTo(WARMTH.WARMTH_PRODUCTION_FLOOR, 6);
  });

  it('production multiplier matches the shared curve at partial warmth', () => {
    const w = new WarmthSystem(WARMTH.MAX_WARMTH / 2); // ratio 0.5 at level 1
    expect(w.warmthRatio(1)).toBeCloseTo(0.5, 6);
    expect(w.productionMultiplier(1)).toBeCloseTo(warmthProductionMultiplier(0.5), 6);
  });

  it('clamps warmth at the max even with many fueled ticks', () => {
    const store = richStore();
    const w = new WarmthSystem(WARMTH.MAX_WARMTH - 1);
    // Far more gain than the headroom.
    w.tick(10_000, 1, store);
    expect(w.warmth).toBe(WARMTH.MAX_WARMTH);
    expect(w.warmthRatio(1)).toBeCloseTo(1, 6);
  });

  it('clamps warmth at 0 (never negative) when starved', () => {
    const empty = new ResourceStore({ food: 0, wood: 0, coal: 0, iron: 0 });
    const w = new WarmthSystem(3);
    w.tick(100_000, 1, empty);
    expect(w.warmth).toBe(0);
  });

  it('a no-op (non-positive) tick re-clamps but spends nothing', () => {
    const store = richStore();
    const w = new WarmthSystem(WARMTH.MAX_WARMTH);
    const res = w.tick(0, 1, store);
    expect(res.fuelSpent).toEqual({ wood: 0, coal: 0 });
    expect(store.get('wood')).toBe(1e9);
  });

  it('round-trips warmth through toJSON / fromJSON', () => {
    const w = new WarmthSystem(42.5);
    const json = w.toJSON();
    expect(json).toBe(42.5);
    const restored = WarmthSystem.fromJSON(json);
    expect(restored.warmth).toBe(42.5);
  });

  it('fromJSON with a missing / invalid value defaults to full warmth', () => {
    expect(WarmthSystem.fromJSON(undefined).warmth).toBe(WARMTH.MAX_WARMTH);
    expect(WarmthSystem.fromJSON(null).warmth).toBe(WARMTH.MAX_WARMTH);
    expect(WarmthSystem.fromJSON(Number.NaN).warmth).toBe(WARMTH.MAX_WARMTH);
  });
});
