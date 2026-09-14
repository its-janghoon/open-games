import { describe, it, expect } from 'vitest';
import { BuildingSystem } from './BuildingSystem';
import { ResourceStore } from './ResourceStore';
import { WARMTH, warmthFloorIsAFloor } from '../config/GameConfig';
import {
  BUILDING_ORDER,
  buildingDef,
  housingCapacity,
  outputPerSec,
  protectedFraction,
  steelThroughputPerSec,
  upgradeTimeMs,
} from '../config/BuildingConfig';
import { REFINERY } from '../config/GameConfig';

/**
 * Unit tests for the building/upgrade tree: prerequisite + Furnace gating,
 * affordability, timed completion, and aggregate production. Each test fails if
 * the corresponding rule were reverted.
 */
describe('BuildingSystem', () => {
  const richStore = () => new ResourceStore({ food: 99999, wood: 99999, coal: 99999, iron: 99999 });

  it('a fresh game has a level-1 Furnace and nothing else', () => {
    const bs = new BuildingSystem();
    expect(bs.furnaceLevel).toBe(1);
    expect(bs.level('hunters_hut')).toBe(0);
    expect(bs.hasWarCamp).toBe(false);
  });

  it('canUpgrade refuses when the Furnace prerequisite is unmet', () => {
    const bs = new BuildingSystem();
    // Iron Mine requires Furnace level 3; Furnace is level 1 -> blocked by prereq.
    const check = bs.canUpgrade('iron_mine', richStore());
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('prereq');
  });

  it('canUpgrade refuses when resources are insufficient', () => {
    const bs = new BuildingSystem();
    const brokeStore = new ResourceStore({ food: 0, wood: 0, coal: 0, iron: 0 });
    // Hunters' Hut prereq (Furnace level 1) is met, but there is no wood/food.
    const check = bs.canUpgrade('hunters_hut', brokeStore);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('cost');
  });

  it("a building's level may not exceed the Furnace level", () => {
    const bs = new BuildingSystem([
      { kind: 'furnace', level: 1, upgradeEndsAt: null },
      { kind: 'hunters_hut', level: 1, upgradeEndsAt: null },
    ]);
    // Hunters' Hut is already at Furnace level (1) -> cannot upgrade further until Furnace grows.
    const check = bs.canUpgrade('hunters_hut', richStore());
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('prereq');
  });

  it('spends resources, then completes the upgrade after the configured time', () => {
    const bs = new BuildingSystem();
    const store = richStore();
    const before = store.get('wood');

    // Build the first Hunters' Hut (level 0 -> 1). Prereq Furnace level 1 is met.
    const check = bs.startUpgrade('hunters_hut', store, 1000);
    expect(check.ok).toBe(true);
    expect(store.get('wood')).toBeLessThan(before); // cost was charged
    expect(bs.isUpgrading('hunters_hut')).toBe(true);
    expect(bs.level('hunters_hut')).toBe(0); // not done yet

    const dur = upgradeTimeMs('hunters_hut', 0);
    // Just before completion: still building.
    bs.update(1000 + dur - 1);
    expect(bs.level('hunters_hut')).toBe(0);
    // At/after completion: level increments and timer clears.
    const done = bs.update(1000 + dur);
    expect(done).toContain('hunters_hut');
    expect(bs.level('hunters_hut')).toBe(1);
    expect(bs.isUpgrading('hunters_hut')).toBe(false);
  });

  it('cannot start a second upgrade while one is in progress (busy)', () => {
    const bs = new BuildingSystem();
    const store = richStore();
    bs.startUpgrade('hunters_hut', store, 0);
    const check = bs.canUpgrade('hunters_hut', store);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('busy');
  });

  it('aggregates producer output at current levels', () => {
    const bs = new BuildingSystem([
      { kind: 'furnace', level: 3, upgradeEndsAt: null },
      { kind: 'hunters_hut', level: 2, upgradeEndsAt: null },
      { kind: 'sawmill', level: 1, upgradeEndsAt: null },
    ]);
    const rates = bs.productionRates();
    expect(rates.food).toBeCloseTo(outputPerSec('hunters_hut', 2), 5);
    // A Sawmill is standing, so the forage floor is NOT credited: it exists only
    // to rescue a hold with no timber producer at all.
    expect(rates.wood).toBeCloseTo(outputPerSec('sawmill', 1), 5);
    expect(rates.coal).toBe(0);
    // Higher hunters' hut level produces strictly more food.
    expect(outputPerSec('hunters_hut', 2)).toBeGreaterThan(outputPerSec('hunters_hut', 1));
  });

  it('round-trips through toJSON / fromJSON', () => {
    const bs = new BuildingSystem([
      { kind: 'furnace', level: 2, upgradeEndsAt: null },
      { kind: 'war_camp', level: 1, upgradeEndsAt: 5000 },
    ]);
    const restored = BuildingSystem.fromJSON(bs.toJSON());
    expect(restored.furnaceLevel).toBe(2);
    expect(restored.hasWarCamp).toBe(true);
    expect(restored.upgradeEndsAt('war_camp')).toBe(5000);
  });

  // --- FEAT-002: expanded city (housing / storage / refinery) ---

  it('lists at least six NEW original-named buildings in BUILDING_ORDER, all Furnace-gated', () => {
    const originals: string[] = ['furnace', 'hunters_hut', 'sawmill', 'coal_pit', 'iron_mine', 'war_camp'];
    const added = BUILDING_ORDER.filter((k) => !originals.includes(k));
    expect(added.length).toBeGreaterThanOrEqual(6);
    // The six founding buildings are still present.
    for (const k of originals) expect(BUILDING_ORDER).toContain(k);
    // Every new building has a hard Furnace prerequisite of at least 1.
    for (const k of added) expect(buildingDef(k).requiresFurnaceLevel).toBeGreaterThanOrEqual(1);
  });

  it('forages faster than the Furnace burns, or it is not a floor', () => {
    // A floor smaller than the burn is eaten as it arrives. The first attempt
    // used 0.2/s against a 0.6/s burn and a simulated opening ended with timber
    // pinned at 0.1 and the 40-timber Hunter's Hut permanently unaffordable.
    expect(warmthFloorIsAFloor()).toBe(true);
    expect(WARMTH.BASELINE_FORAGE_WOOD_PER_SEC).toBeGreaterThan(WARMTH.FUEL_PER_SECOND.wood);
  });

  it('a hold with nothing built still earns its way to a producer', () => {
    // The dead-save case: only a Furnace, no producers, and both starter
    // producers cost something the Furnace burns. Without a floor there is no
    // affordable action and no income, and nothing in the game can recover it.
    const bs = new BuildingSystem([{ kind: 'furnace', level: 1, upgradeEndsAt: null }]);
    const rates = bs.productionRates();
    expect(rates.wood).toBeGreaterThan(0);

    // The cheapest producer must become affordable in finite time from empty.
    const hutWood = buildingDef('hunters_hut').baseCost.wood ?? 0;
    expect(hutWood).toBeGreaterThan(0);
    const secondsToAfford = hutWood / rates.wood;
    expect(Number.isFinite(secondsToAfford)).toBe(true);
    expect(secondsToAfford).toBeLessThan(60 * 10);
  });

  it('the new support buildings are NOT resource producers', () => {
    const bs = new BuildingSystem([
      { kind: 'furnace', level: 5, upgradeEndsAt: null },
      { kind: 'shelter_row', level: 3, upgradeEndsAt: null },
      { kind: 'frost_vault', level: 3, upgradeEndsAt: null },
      { kind: 'forge_hall', level: 3, upgradeEndsAt: null },
      { kind: 'envoy_hall', level: 3, upgradeEndsAt: null },
    ]);
    // None of them contribute to the idle production rates. Timber still shows
    // the baseline forage floor, which is not a building's output - so this is
    // asserted as EXACTLY the floor, and would still fail if any of these
    // buildings started producing timber.
    const rates = bs.productionRates();
    expect(rates.food).toBe(0);
    expect(rates.wood).toBeCloseTo(WARMTH.BASELINE_FORAGE_WOOD_PER_SEC, 6);
    expect(rates.coal).toBe(0);
    expect(rates.iron).toBe(0);
  });

  it('Shelter Row raises the housing capacity with its level', () => {
    const bs = new BuildingSystem([
      { kind: 'furnace', level: 5, upgradeEndsAt: null },
      { kind: 'shelter_row', level: 3, upgradeEndsAt: null },
    ]);
    expect(bs.totalHousing()).toBe(housingCapacity('shelter_row', 3));
    expect(housingCapacity('shelter_row', 3)).toBeGreaterThan(housingCapacity('shelter_row', 2));
    // A non-housing building contributes nothing.
    expect(housingCapacity('hunters_hut', 5)).toBe(0);
  });

  it('Frost Vault shelters a configured, level-scaled fraction of a stockpile', () => {
    const bs = new BuildingSystem([
      { kind: 'furnace', level: 5, upgradeEndsAt: null },
      { kind: 'frost_vault', level: 2, upgradeEndsAt: null },
    ]);
    const balance = 1000;
    const expected = balance * protectedFraction('frost_vault', 2);
    expect(bs.protectedStorage(balance)).toBeCloseTo(expected, 6);
    // Protection never exceeds the balance and rises with level.
    expect(protectedFraction('frost_vault', 3)).toBeGreaterThan(protectedFraction('frost_vault', 1));
    expect(bs.protectedStorage(balance)).toBeLessThan(balance);
    // With no vault, nothing is protected.
    const noVault = new BuildingSystem([{ kind: 'furnace', level: 2, upgradeEndsAt: null }]);
    expect(noVault.protectedStorage(balance)).toBe(0);
  });

  it('Forge Hall refines iron + coal into steel, limited by throughput and inputs', () => {
    const bs = new BuildingSystem([
      { kind: 'furnace', level: 5, upgradeEndsAt: null },
      { kind: 'forge_hall', level: 1, upgradeEndsAt: null },
    ]);
    const store = new ResourceStore({ food: 0, wood: 0, coal: 1000, iron: 1000, steel: 0 });

    // 10 seconds at level-1 throughput, inputs abundant: throughput-limited.
    const minted = bs.refineryConversion(store, 10_000, 1);
    expect(minted).toBeCloseTo(steelThroughputPerSec('forge_hall', 1) * 10, 6);
    expect(store.get('steel')).toBeCloseTo(minted, 6);
    // Inputs were consumed at the configured ratio.
    expect(store.get('iron')).toBeCloseTo(1000 - minted * REFINERY.INPUT_PER_STEEL.iron, 6);
    expect(store.get('coal')).toBeCloseTo(1000 - minted * REFINERY.INPUT_PER_STEEL.coal, 6);
  });

  it('refinery output is INPUT-limited when raw stock is scarce', () => {
    const bs = new BuildingSystem([
      { kind: 'furnace', level: 5, upgradeEndsAt: null },
      { kind: 'forge_hall', level: 5, upgradeEndsAt: null },
    ]);
    // Only enough iron for 3 units of steel; coal is plentiful.
    const iron = 3 * REFINERY.INPUT_PER_STEEL.iron;
    const store = new ResourceStore({ food: 0, wood: 0, coal: 1e6, iron, steel: 0 });
    const minted = bs.refineryConversion(store, 1_000_000, 1); // huge window
    expect(minted).toBeCloseTo(3, 6);
    expect(store.get('iron')).toBeCloseTo(0, 6);
    expect(store.get('steel')).toBeCloseTo(3, 6);
  });

  it('a base with no Forge Hall mints no steel', () => {
    const bs = new BuildingSystem([
      { kind: 'furnace', level: 5, upgradeEndsAt: null },
      { kind: 'iron_mine', level: 3, upgradeEndsAt: null },
    ]);
    const store = new ResourceStore({ food: 0, wood: 0, coal: 1000, iron: 1000, steel: 0 });
    expect(bs.refineryConversion(store, 10_000, 1)).toBe(0);
    expect(store.get('steel')).toBe(0);
  });

  it('totalProducerLevels sums only producer building levels', () => {
    const bs = new BuildingSystem([
      { kind: 'furnace', level: 5, upgradeEndsAt: null }, // not a producer
      { kind: 'hunters_hut', level: 2, upgradeEndsAt: null },
      { kind: 'iron_mine', level: 3, upgradeEndsAt: null },
      { kind: 'forge_hall', level: 4, upgradeEndsAt: null }, // refinery, not a producer
    ]);
    expect(bs.totalProducerLevels()).toBe(5);
  });
});
