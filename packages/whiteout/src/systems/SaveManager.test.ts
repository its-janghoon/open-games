import { describe, it, expect } from 'vitest';
import { SaveManager, memoryStorage, SAVE_VERSION, SAVE_KEY, freshOnboarding, normalizeOnboarding, type GameSnapshot } from './SaveManager';
import { ResourceStore } from './ResourceStore';
import { BuildingSystem } from './BuildingSystem';
import { TrainingQueue } from './TrainingQueue';
import { WarmthSystem } from './WarmthSystem';
import { PopulationSystem } from './PopulationSystem';
import { PremiumWallet } from './PremiumWallet';
import { HeroRoster } from './HeroRoster';
import { SummonSystem } from './SummonSystem';
import { CampaignSystem } from './CampaignSystem';
import { ResearchSystem } from './ResearchSystem';
import { GearSystem } from './GearSystem';
import { RallySystem } from './RallySystem';
import { ArenaSystem } from './ArenaSystem';
import { AllianceSystem } from './AllianceSystem';
import { QuestSystem } from './QuestSystem';
import { VipSystem } from './VipSystem';
import { ECONOMY, WARMTH, POPULATION } from '../config/GameConfig';
import { outputPerSec } from '../config/BuildingConfig';
import { troopDef } from '../config/TroopConfig';

/**
 * A fully-staffed, well-housed workforce used by the offline-reconciliation
 * tests: plenty of housing (so satisfaction headroom is high) and enough
 * survivors assigned to fully staff the base's producers. This lets those tests
 * isolate the capping / warmth / upgrade-split behaviour they target while the
 * population multiplier stays a single, computable factor.
 */
function fullWorkforce(assignments: Partial<Record<string, number>> = {}): PopulationSystem {
  return PopulationSystem.fromJSON({ total: 40, assignments: assignments as never });
}

/**
 * A workforce pinned AT the base's housing cap for the given buildings, with
 * the supplied per-building assignments. Being at the cap, growth is a no-op
 * over the offline window, so satisfaction (headroom) and staffing - and thus
 * the population output multiplier - stay CONSTANT, letting a test fold a single
 * multiplier into a closed-form expectation.
 */
function atCapWorkforce(
  buildings: BuildingSystem,
  assignments: Partial<Record<string, number>> = {},
): PopulationSystem {
  const cap = POPULATION.BASE_HOUSING + buildings.totalHousing();
  return PopulationSystem.fromJSON({ total: cap, assignments: assignments as never });
}

/**
 * The population output multiplier a given snapshot's workforce applies over an
 * offline segment, computed from the SAME systems the SaveManager uses so the
 * expectations track the real curve rather than a hardcoded number. Warmth ratio
 * is taken at full (1) for the ample-fuel offline tests.
 */
function popMult(buildings: BuildingSystem, population: PopulationSystem, warmthRatio = 1): number {
  return population.outputMultiplier(
    warmthRatio,
    buildings.totalHousing(),
    buildings.totalProducerLevels() * POPULATION.STAFF_PER_PRODUCER_LEVEL,
  );
}

function warmthIntegral(initial: number, max: number, seconds: number): number {
  const startFactor = 0.25 + 0.75 * Math.min(1, initial / max);
  const riseSeconds = Math.min(seconds, Math.max(0, (max - initial) / WARMTH.WARMTH_GAIN_PER_SEC));
  const endFactor = 0.25 + 0.75 * Math.min(1, (initial + riseSeconds * WARMTH.WARMTH_GAIN_PER_SEC) / max);
  return riseSeconds * (startFactor + endFactor) / 2 + (seconds - riseSeconds) * endFactor;
}

const DAY_ZERO_EVENT_MULTIPLIER = 1.5;

/**
 * Unit tests for the versioned save layer with an INJECTED fake storage (no
 * window dependency): round-trip fidelity and offline idle-gain reconciliation.
 */
describe('SaveManager', () => {
  function snapshot(): GameSnapshot {
    const resources = new ResourceStore({ food: 100, wood: 200, coal: 300, iron: 40 });
    const buildings = new BuildingSystem([
      { kind: 'furnace', level: 3, upgradeEndsAt: null },
      { kind: 'hunters_hut', level: 2, upgradeEndsAt: null },
      { kind: 'war_camp', level: 1, upgradeEndsAt: null },
    ]);
    const training = new TrainingQueue(undefined, { trapper: 4, marksman: 1, vanguard: 0 });
    return {
      resources,
      buildings,
      training,
      warmth: new WarmthSystem(),
      population: fullWorkforce(),
      premium: new PremiumWallet(),
      heroes: new HeroRoster(),
      summon: new SummonSystem(),
      campaign: new CampaignSystem(),
      research: new ResearchSystem(),
      gear: new GearSystem(),
      rally: new RallySystem(),
      arena: new ArenaSystem(),
      alliance: new AllianceSystem(),
      quests: new QuestSystem(),
      vip: new VipSystem(),
      waveCleared: 5,
      onboarding: { introDismissed: true, guidedComplete: true },
    };
  }

  it('loads a fresh game when storage is empty', () => {
    const mgr = new SaveManager(memoryStorage());
    const result = mgr.load(0);
    expect(result.loaded).toBe(false);
    expect(result.snapshot.buildings.furnaceLevel).toBe(1);
    expect(result.snapshot.resources.get('food')).toBe(ECONOMY.START.food);
  });

  it('uses the Frosthold save namespace', () => {
    expect(SAVE_KEY).toBe('frosthold:save');
    expect(SAVE_VERSION).toBe(8);
  });

  it('produces a versioned plain JSON object on serialize', () => {
    const state = SaveManager.serialize(snapshot(), 123456);
    expect(state.version).toBe(SAVE_VERSION);
    expect(state.lastSeenAt).toBe(123456);
    expect(state.army).toEqual({ trapper: 4, marksman: 1, vanguard: 0 });
    expect(state.waveCleared).toBe(5);
    // Must be plain-JSON serializable.
    expect(() => JSON.stringify(state)).not.toThrow();
  });

  it('round-trips full state through save -> load with no elapsed time', () => {
    const storage = memoryStorage();
    const mgr = new SaveManager(storage);
    const now = 1_000_000;
    mgr.save(snapshot(), now);

    const loaded = mgr.load(now); // same instant -> no offline gains
    expect(loaded.loaded).toBe(true);
    expect(loaded.offlineSeconds).toBe(0);
    expect(loaded.snapshot.resources.balances).toEqual({ food: 100, wood: 200, coal: 300, iron: 40, steel: 0 });
    expect(loaded.snapshot.buildings.furnaceLevel).toBe(3);
    expect(loaded.snapshot.buildings.level('hunters_hut')).toBe(2);
    expect(loaded.snapshot.training.army).toEqual({ trapper: 4, marksman: 1, vanguard: 0 });
    expect(loaded.snapshot.waveCleared).toBe(5);
  });

  it('applies offline idle gains capped and scaled by efficiency', () => {
    const storage = memoryStorage();
    const mgr = new SaveManager(storage);
    const saveTime = 0;
    // Ample fuel so warmth stays at max over the window and this test isolates
    // the capping / OFFLINE_EFFICIENCY scaling from the warmth penalty. Warmth
    // reconciliation is covered separately below.
    const resources = new ResourceStore({ food: 100, wood: 1e9, coal: 1e9, iron: 40 });
    const buildings = new BuildingSystem([
      { kind: 'furnace', level: 3, upgradeEndsAt: null },
      { kind: 'hunters_hut', level: 2, upgradeEndsAt: null },
      { kind: 'war_camp', level: 1, upgradeEndsAt: null },
    ]);
    const training = new TrainingQueue(undefined, { trapper: 4, marksman: 1, vanguard: 0 });
    // Workforce pinned AT the housing cap so it neither grows nor changes its
    // satisfaction/staffing over the window: the population multiplier is then a
    // single constant we can fold into the expectation. Fully staff the hut.
    const population = atCapWorkforce(buildings, { hunters_hut: 3 });
    const pm = popMult(buildings, population);
    mgr.save(
      { resources, buildings, training, warmth: new WarmthSystem(), population, premium: new PremiumWallet(), heroes: new HeroRoster(), summon: new SummonSystem(), campaign: new CampaignSystem(), research: new ResearchSystem(), gear: new GearSystem(), rally: new RallySystem(), arena: new ArenaSystem(), alliance: new AllianceSystem(), quests: new QuestSystem(), vip: new VipSystem(), waveCleared: 5, onboarding: freshOnboarding() },
      saveTime,
    );

    const elapsedSec = 3600; // 1 hour, under the 8h cap
    const loaded = mgr.load(saveTime + elapsedSec * 1000);
    expect(loaded.offlineSeconds).toBe(elapsedSec);

    // Only the level-2 hunters' hut produces (food). Warmth is pinned at max
    // (multiplier 1.0); expected = rate * seconds * efficiency * populationMult.
    const expectedFood =
      outputPerSec('hunters_hut', 2) *
      warmthIntegral(WARMTH.MAX_WARMTH, WARMTH.MAX_WARMTH + 2 * WARMTH.MAX_WARMTH_PER_LEVEL, elapsedSec) *
      ECONOMY.OFFLINE_EFFICIENCY * pm * DAY_ZERO_EVENT_MULTIPLIER;
    expect(loaded.offlineGains.food).toBeCloseTo(expectedFood, 4);
    expect(loaded.snapshot.resources.get('food')).toBeCloseTo(100 + expectedFood, 4);
    // Warmth held at its Furnace-L3 maximum throughout.
    expect(loaded.snapshot.warmth.warmth).toBe(loaded.snapshot.warmth.maxWarmth(3));
  });

  it('splits the offline window at an upgrade boundary rather than over-crediting', () => {
    const storage = memoryStorage();
    const mgr = new SaveManager(storage);

    // A hunters' hut at L2 with an in-progress upgrade to L3 that finishes 600s
    // into a 1000s offline window. Production must be credited at L2 for the
    // first 600s and L3 only for the final 400s - NOT L3 for the whole window.
    const t0 = 1_000_000;
    const windowSec = 1000;
    const boundaryOffset = 600; // seconds into the window the upgrade completes
    // Food starts at 0 (measures pure production); ample wood/coal keeps the
    // Furnace fueled so warmth stays pinned at max and this test isolates the
    // upgrade-boundary split with no warmth penalty over the window.
    const resources = new ResourceStore({ food: 0, wood: 1e9, coal: 1e9, iron: 0 });
    const buildings = new BuildingSystem([
      { kind: 'furnace', level: 3, upgradeEndsAt: null },
      { kind: 'hunters_hut', level: 2, upgradeEndsAt: t0 + boundaryOffset * 1000 },
    ]);
    const training = new TrainingQueue(undefined, { trapper: 0, marksman: 0, vanguard: 0 });
    // At-cap, fully-staffed workforce so growth is a no-op and satisfaction is
    // constant; only the STAFFING factor shifts when the hut hits L3 (its
    // desired staffing rises), so the multiplier differs per segment - we sample
    // each from a buildings snapshot at the matching level.
    const population = atCapWorkforce(buildings, { hunters_hut: 3 });
    mgr.save(
      { resources, buildings, training, warmth: new WarmthSystem(), population, premium: new PremiumWallet(), heroes: new HeroRoster(), summon: new SummonSystem(), campaign: new CampaignSystem(), research: new ResearchSystem(), gear: new GearSystem(), rally: new RallySystem(), arena: new ArenaSystem(), alliance: new AllianceSystem(), quests: new QuestSystem(), vip: new VipSystem(), waveCleared: 0, onboarding: freshOnboarding() },
      t0,
    );

    const loaded = mgr.load(t0 + windowSec * 1000);
    expect(loaded.offlineSeconds).toBe(windowSec);
    // Hunters' hut ended at L3.
    expect(loaded.snapshot.buildings.level('hunters_hut')).toBe(3);

    const eff = ECONOMY.OFFLINE_EFFICIENCY;
    // The load validator clamps the saved over-assignment (3 workers on an L2
    // hut) to L2's cap. The same two workers remain after the L3 completion, so
    // only that producer's staffing factor changes at the exact boundary.
    const normalizedPopulation = PopulationSystem.fromJSON({ total: population.total, assignments: { hunters_hut: 2 } });
    const satisfaction = normalizedPopulation.satisfactionProduction(buildings.totalHousing());
    const pmL2 = satisfaction * normalizedPopulation.staffingMultiplier('hunters_hut', 2);
    const pmL3 = satisfaction * normalizedPopulation.staffingMultiplier('hunters_hut', 3);
    const warmL2Seconds = warmthIntegral(WARMTH.MAX_WARMTH, WARMTH.MAX_WARMTH + 2 * WARMTH.MAX_WARMTH_PER_LEVEL, boundaryOffset);
    const expectedSplit = (
      outputPerSec('hunters_hut', 2) * warmL2Seconds * eff * pmL2 +
      outputPerSec('hunters_hut', 3) * (windowSec - boundaryOffset) * eff * pmL3
    ) * DAY_ZERO_EVENT_MULTIPLIER;
    const naiveWhole = outputPerSec('hunters_hut', 3) * windowSec * eff * pmL3 * DAY_ZERO_EVENT_MULTIPLIER;

    expect(loaded.offlineGains.food).toBeCloseTo(expectedSplit, 4);
    // The split credit is strictly less than the old over-credit (post-upgrade
    // rate applied to the whole window), proving the fix.
    expect(loaded.offlineGains.food).toBeLessThan(naiveWhole);
    expect(loaded.snapshot.resources.get('food')).toBeCloseTo(expectedSplit, 4);
  });

  it('caps offline time at ECONOMY.MAX_OFFLINE_SECONDS', () => {
    const storage = memoryStorage();
    const mgr = new SaveManager(storage);
    mgr.save(snapshot(), 0);

    const wayTooLong = (ECONOMY.MAX_OFFLINE_SECONDS + 100_000) * 1000;
    const loaded = mgr.load(wayTooLong);
    expect(loaded.offlineSeconds).toBe(ECONOMY.MAX_OFFLINE_SECONDS);
  });

  it('completes training that finished while offline on load', () => {
    const storage = memoryStorage();
    const mgr = new SaveManager(storage);
    const t = troopDef('trapper').trainTimeMs;

    const snap = snapshot();
    // Queue 2 trappers at t=0 (War Camp present); they complete at 2*t.
    const rich = new ResourceStore({ food: 99999, wood: 99999, coal: 99999, iron: 99999 });
    snap.training.enqueue('trapper', 2, rich, 0, true);
    mgr.save(snap, 0);

    const loaded = mgr.load(2 * t + 1);
    // Army had 4 trappers; +2 completed offline = 6.
    expect(loaded.snapshot.training.army.trapper).toBe(6);
    expect(loaded.snapshot.training.length).toBe(0);
  });

  it('starts fresh on a version mismatch instead of crashing', () => {
    const storage = memoryStorage();
    // A legacy version-1 (kingdom-rise) save at the Frosthold key must be
    // treated as a mismatch and fall back to a fresh frozen settlement.
    storage.setItem(SAVE_KEY, JSON.stringify({ version: 1, resources: {} }));
    const mgr = new SaveManager(storage);
    const loaded = mgr.load(0);
    expect(loaded.loaded).toBe(false);
    expect(loaded.snapshot.buildings.furnaceLevel).toBe(1);
  });

  it('starts fresh on corrupt / unparseable JSON instead of crashing', () => {
    const storage = memoryStorage();
    storage.setItem(SAVE_KEY, '{not valid json at all');
    const mgr = new SaveManager(storage);
    const loaded = mgr.load(0);
    expect(loaded.loaded).toBe(false);
    expect(loaded.snapshot.buildings.furnaceLevel).toBe(1);
    expect(loaded.snapshot.resources.get('food')).toBe(ECONOMY.START.food);
    expect(loaded.offlineSeconds).toBe(0);
  });

  it('starts fresh when the stored JSON is not an object (e.g. a bare value)', () => {
    const storage = memoryStorage();
    storage.setItem(SAVE_KEY, '42');
    const mgr = new SaveManager(storage);
    const loaded = mgr.load(0);
    expect(loaded.loaded).toBe(false);
    expect(loaded.snapshot.buildings.furnaceLevel).toBe(1);
  });

  it('clear() removes the save slot', () => {
    const storage = memoryStorage();
    const mgr = new SaveManager(storage);
    mgr.save(snapshot(), 0);
    mgr.clear();
    expect(mgr.load(0).loaded).toBe(false);
  });

  it('persists the warmth value across save -> load', () => {
    const storage = memoryStorage();
    const mgr = new SaveManager(storage);
    const snap = snapshot();
    // Re-open the snapshot with a partially-cold Furnace.
    const partial: GameSnapshot = { ...snap, warmth: new WarmthSystem(37) };
    const state = SaveManager.serialize(partial, 0);
    expect(state.warmth).toBe(37);

    mgr.save(partial, 0);
    const loaded = mgr.load(0); // no elapsed time -> warmth unchanged
    expect(loaded.snapshot.warmth.warmth).toBe(37);
  });

  it('reconciles warmth over an offline window: decays when fuel runs out', () => {
    const storage = memoryStorage();
    const mgr = new SaveManager(storage);
    // A hold with a producing hut but NO fuel producers and an empty fuel
    // stockpile: while away, the Furnace runs cold and warmth decays to 0.
    const resources = new ResourceStore({ food: 0, wood: 0, coal: 0, iron: 0 });
    const buildings = new BuildingSystem([
      { kind: 'furnace', level: 1, upgradeEndsAt: null },
      { kind: 'hunters_hut', level: 1, upgradeEndsAt: null },
    ]);
    const training = new TrainingQueue(undefined, { trapper: 0, marksman: 0, vanguard: 0 });
    mgr.save(
      { resources, buildings, training, warmth: new WarmthSystem(WARMTH.MAX_WARMTH), population: fullWorkforce(), premium: new PremiumWallet(), heroes: new HeroRoster(), summon: new SummonSystem(), campaign: new CampaignSystem(), research: new ResearchSystem(), gear: new GearSystem(), rally: new RallySystem(), arena: new ArenaSystem(), alliance: new AllianceSystem(), quests: new QuestSystem(), vip: new VipSystem(), waveCleared: 0, onboarding: freshOnboarding() },
      0,
    );

    const elapsedSec = WARMTH.MAX_WARMTH / WARMTH.WARMTH_DECAY_PER_SEC + 100; // long enough to fully freeze
    const loaded = mgr.load(elapsedSec * 1000);
    expect(loaded.snapshot.warmth.warmth).toBe(0);
    // Frozen production is throttled to the floor, so food gained is strictly
    // less than an unthrottled (full-warmth) credit would have been.
    const eff = ECONOMY.OFFLINE_EFFICIENCY;
    const unthrottled = outputPerSec('hunters_hut', 1) * elapsedSec * eff;
    expect(loaded.offlineGains.food).toBeGreaterThan(0);
    expect(loaded.offlineGains.food).toBeLessThan(unthrottled);
  });

  it('nets furnace fuel burn out of the reported offlineGains (wood/coal)', () => {
    const storage = memoryStorage();
    const mgr = new SaveManager(storage);
    // A hold that PRODUCES wood/coal (sawmill + coal pit) yet also burns fuel in
    // the Furnace while away. Fuel is plentiful enough to stay fully warm the
    // whole window (so production runs at full efficiency and warmth never
    // decays), letting us pin the expected net exactly: production - fuelSpent.
    const startWood = 100_000;
    const startCoal = 100_000;
    const resources = new ResourceStore({ food: 0, wood: startWood, coal: startCoal, iron: 0 });
    const buildings = new BuildingSystem([
      // Level 2: coal only enters the fuel mix from WARMTH.COAL_FROM_FURNACE_LEVEL,
      // so a level-1 Furnace would burn no coal and there would be no coal
      // netting left to prove here.
      { kind: 'furnace', level: WARMTH.COAL_FROM_FURNACE_LEVEL, upgradeEndsAt: null },
      { kind: 'sawmill', level: 1, upgradeEndsAt: null },
      { kind: 'coal_pit', level: 1, upgradeEndsAt: null },
    ]);
    const training = new TrainingQueue(undefined, { trapper: 0, marksman: 0, vanguard: 0 });
    // Start at the FULL warmth for this Furnace level, not WARMTH.MAX_WARMTH:
    // the ceiling rises with level, so seeding the level-1 value would leave
    // warmth climbing for part of the window and throttle production slightly,
    // breaking this test's premise that efficiency was 1.0 throughout.
    const fullWarmth = new WarmthSystem().maxWarmth(WARMTH.COAL_FROM_FURNACE_LEVEL);
    // At-cap, fully-staffed workforce -> constant population multiplier we fold
    // into the expected gross production below.
    const population = atCapWorkforce(buildings, { sawmill: 1, coal_pit: 1 });
    const pm = popMult(buildings, population);
    mgr.save(
      { resources, buildings, training, warmth: new WarmthSystem(fullWarmth), population, premium: new PremiumWallet(), heroes: new HeroRoster(), summon: new SummonSystem(), campaign: new CampaignSystem(), research: new ResearchSystem(), gear: new GearSystem(), rally: new RallySystem(), arena: new ArenaSystem(), alliance: new AllianceSystem(), quests: new QuestSystem(), vip: new VipSystem(), waveCleared: 0, onboarding: freshOnboarding() },
      0,
    );

    const elapsedSec = 3600; // 1 hour, under the cap
    const loaded = mgr.load(elapsedSec * 1000);
    expect(loaded.offlineSeconds).toBe(elapsedSec);
    // Stayed fully warm all window (ample fuel), so production ran unthrottled.
    expect(loaded.snapshot.warmth.warmth).toBe(
      loaded.snapshot.warmth.maxWarmth(WARMTH.COAL_FROM_FURNACE_LEVEL),
    );

    const eff = ECONOMY.OFFLINE_EFFICIENCY;
    // Gross production over the window (warmth 1.0, scaled by the population mult).
    const grossWood = outputPerSec('sawmill', 1) * elapsedSec * eff * pm * DAY_ZERO_EVENT_MULTIPLIER;
    const grossCoal = outputPerSec('coal_pit', 1) * elapsedSec * eff * pm * DAY_ZERO_EVENT_MULTIPLIER;
    // Fuel the L1 Furnace burned over the window (per-second demand * seconds).
    const perSec = new WarmthSystem().fuelPerSecond(WARMTH.COAL_FROM_FURNACE_LEVEL);
    const burnedWood = perSec.wood * elapsedSec;
    const burnedCoal = perSec.coal * elapsedSec;
    expect(burnedWood).toBeGreaterThan(0);
    expect(burnedCoal).toBeGreaterThan(0);

    // The reported summary is NET: production credited minus fuel burned.
    expect(loaded.offlineGains.wood).toBeCloseTo(grossWood - burnedWood, 4);
    expect(loaded.offlineGains.coal).toBeCloseTo(grossCoal - burnedCoal, 4);
    // ...and strictly less than the gross production (proves the netting runs).
    expect(loaded.offlineGains.wood).toBeLessThan(grossWood);
    expect(loaded.offlineGains.coal).toBeLessThan(grossCoal);

    // The store balance remains the authoritative correct value: it already had
    // the gross production added and the fuel spent debited, so it equals the
    // starting stockpile plus the same net delta the summary reports.
    expect(loaded.snapshot.resources.get('wood')).toBeCloseTo(startWood + (grossWood - burnedWood), 3);
    expect(loaded.snapshot.resources.get('coal')).toBeCloseTo(startCoal + (grossCoal - burnedCoal), 3);
    expect(loaded.snapshot.resources.get('wood')).toBeCloseTo(startWood + loaded.offlineGains.wood, 3);
    expect(loaded.snapshot.resources.get('coal')).toBeCloseTo(startCoal + loaded.offlineGains.coal, 3);
  });

  it('reports a NET LOSS in offlineGains when the furnace outburns production', () => {
    const storage = memoryStorage();
    const mgr = new SaveManager(storage);
    // A hold with NO wood/coal producers but a fueled Furnace: while away it
    // burns fuel with zero production, so the net wood/coal summary is NEGATIVE.
    const startWood = 100_000;
    const startCoal = 100_000;
    const resources = new ResourceStore({ food: 0, wood: startWood, coal: startCoal, iron: 0 });
    const buildings = new BuildingSystem([
      // Level 2 so the Furnace burns coal as well as timber (see above).
      { kind: 'furnace', level: WARMTH.COAL_FROM_FURNACE_LEVEL, upgradeEndsAt: null },
      { kind: 'hunters_hut', level: 1, upgradeEndsAt: null },
    ]);
    const training = new TrainingQueue(undefined, { trapper: 0, marksman: 0, vanguard: 0 });
    mgr.save(
      { resources, buildings, training, warmth: new WarmthSystem(WARMTH.MAX_WARMTH), population: fullWorkforce(), premium: new PremiumWallet(), heroes: new HeroRoster(), summon: new SummonSystem(), campaign: new CampaignSystem(), research: new ResearchSystem(), gear: new GearSystem(), rally: new RallySystem(), arena: new ArenaSystem(), alliance: new AllianceSystem(), quests: new QuestSystem(), vip: new VipSystem(), waveCleared: 0, onboarding: freshOnboarding() },
      0,
    );

    const elapsedSec = 3600;
    const loaded = mgr.load(elapsedSec * 1000);

    const perSec = new WarmthSystem().fuelPerSecond(WARMTH.COAL_FROM_FURNACE_LEVEL);
    expect(loaded.offlineGains.wood).toBeCloseTo(-perSec.wood * elapsedSec, 4);
    expect(loaded.offlineGains.coal).toBeCloseTo(-perSec.coal * elapsedSec, 4);
    expect(loaded.offlineGains.wood).toBeLessThan(0);
    expect(loaded.offlineGains.coal).toBeLessThan(0);
    // Store balance stays authoritative and matches the reported net.
    expect(loaded.snapshot.resources.get('wood')).toBeCloseTo(startWood + loaded.offlineGains.wood, 3);
    expect(loaded.snapshot.resources.get('coal')).toBeCloseTo(startCoal + loaded.offlineGains.coal, 3);
  });

  it('holds warmth at max over an offline window when fuel is ample', () => {
    const storage = memoryStorage();
    const mgr = new SaveManager(storage);
    const resources = new ResourceStore({ food: 0, wood: 1e9, coal: 1e9, iron: 0 });
    const buildings = new BuildingSystem([
      { kind: 'furnace', level: 2, upgradeEndsAt: null },
      { kind: 'hunters_hut', level: 1, upgradeEndsAt: null },
    ]);
    const training = new TrainingQueue(undefined, { trapper: 0, marksman: 0, vanguard: 0 });
    const population = atCapWorkforce(buildings, { hunters_hut: 3 });
    const pm = popMult(buildings, population);
    mgr.save(
      { resources, buildings, training, warmth: new WarmthSystem(WARMTH.MAX_WARMTH), population, premium: new PremiumWallet(), heroes: new HeroRoster(), summon: new SummonSystem(), campaign: new CampaignSystem(), research: new ResearchSystem(), gear: new GearSystem(), rally: new RallySystem(), arena: new ArenaSystem(), alliance: new AllianceSystem(), quests: new QuestSystem(), vip: new VipSystem(), waveCleared: 0, onboarding: freshOnboarding() },
      0,
    );

    const loaded = mgr.load(3600 * 1000);
    expect(loaded.snapshot.warmth.warmth).toBe(loaded.snapshot.warmth.maxWarmth(2));
    // Full warmth -> offline food credit scaled by the population multiplier.
    const expectedFood = outputPerSec('hunters_hut', 1)
      * warmthIntegral(WARMTH.MAX_WARMTH, WARMTH.MAX_WARMTH + WARMTH.MAX_WARMTH_PER_LEVEL, 3600)
      * ECONOMY.OFFLINE_EFFICIENCY * pm * DAY_ZERO_EVENT_MULTIPLIER;
    expect(loaded.offlineGains.food).toBeCloseTo(expectedFood, 3);
  });

  it('loads a warmth-less (legacy) save to FULL warmth without crashing', () => {
    const storage = memoryStorage();
    // A supported v7 payload with no warmth field migrates to full warmth.
    const legacy = {
      version: 7,
      resources: { food: 10, wood: 10, coal: 10, iron: 10 },
      buildings: [{ kind: 'furnace', level: 1, upgradeEndsAt: null }],
      army: { trapper: 0, marksman: 0, vanguard: 0 },
      trainingQueue: [],
      waveCleared: 0,
      lastSeenAt: 0,
    };
    storage.setItem(SAVE_KEY, JSON.stringify(legacy));
    const mgr = new SaveManager(storage);
    const loaded = mgr.load(0);
    expect(loaded.loaded).toBe(true);
    expect(loaded.snapshot.warmth.warmth).toBe(WARMTH.MAX_WARMTH);
  });

  it('freshGame starts fully warm', () => {
    const fresh = SaveManager.freshGame();
    expect(fresh.warmth.warmth).toBe(WARMTH.MAX_WARMTH);
  });

  // --- FEAT-002: steel resource, premium currency, population, migration ---

  it('bumps SAVE_VERSION to 8 for the onboarding/guidance layer', () => {
    expect(SAVE_VERSION).toBe(8);
  });

  // --- FEAT-003: onboarding / tutorial persistence ---

  it('round-trips the onboarding state through save -> load', () => {
    const storage = memoryStorage();
    const mgr = new SaveManager(storage);
    const snap: GameSnapshot = { ...snapshot(), onboarding: { introDismissed: true, guidedComplete: false } };
    mgr.save(snap, 0);
    const loaded = mgr.load(0);
    expect(loaded.snapshot.onboarding).toEqual({ introDismissed: true, guidedComplete: false });
  });

  it('serializes the onboarding field into the plain state object', () => {
    const state = SaveManager.serialize({ ...snapshot(), onboarding: freshOnboarding() }, 0);
    expect(state.onboarding).toEqual({ introDismissed: false, guidedComplete: false });
  });

  it('freshGame starts a brand-new player (nothing onboarded yet)', () => {
    const fresh = SaveManager.freshGame();
    expect(fresh.onboarding).toEqual({ introDismissed: false, guidedComplete: false });
  });

  it('treats an in-version save MISSING onboarding as a returning player (not re-onboarded)', () => {
    const storage = memoryStorage();
    const mgr = new SaveManager(storage);
    // Serialize a current-version save, then strip onboarding to mimic a payload
    // written before the field existed. It must load without crashing and be
    // treated as a returning player (both flags true) so the intro never re-runs.
    const serialized = SaveManager.serialize(snapshot(), 0);
    delete (serialized as { onboarding?: unknown }).onboarding;
    storage.setItem(SAVE_KEY, JSON.stringify(serialized));
    const loaded = mgr.load(0);
    expect(loaded.loaded).toBe(true);
    expect(loaded.snapshot.onboarding).toEqual({ introDismissed: true, guidedComplete: true });
  });

  it('normalizeOnboarding coerces partial/garbage records safely', () => {
    // Missing -> returning player.
    expect(normalizeOnboarding(undefined)).toEqual({ introDismissed: true, guidedComplete: true });
    // Partial -> only the present flag is honoured, the rest default false.
    expect(normalizeOnboarding({ introDismissed: true })).toEqual({ introDismissed: true, guidedComplete: false });
    // Non-boolean garbage -> coerced to false.
    expect(normalizeOnboarding({ introDismissed: 1 as unknown as boolean })).toEqual({ introDismissed: false, guidedComplete: false });
  });

  it('migrates a pre-onboarding version-7 save without losing progress', () => {
    const storage = memoryStorage();
    const v7 = {
      version: 7,
      resources: { food: 500, wood: 500, coal: 500, iron: 500, steel: 100 },
      premiumCurrency: 300,
      population: { total: 20, assignments: {} },
      heroes: { heroes: {}, lead: [] },
      summon: { totalPulls: 0, pityCounter: 0 },
      campaign: { highestCleared: 0, claimed: [] },
      research: { completed: [], active: null },
      gear: { slots: {} },
      rally: { bosses: {} },
      arena: { rank: 50, wins: 0, losses: 0, seed: 1 },
      alliance: { techPoints: 0, helpsAvailable: 0 },
      quests: { dailyDayIndex: 0, daily: {}, milestones: {}, activeEventId: null, eventEndsAt: 0 },
      vip: { points: 0 },
      warmth: 80,
      buildings: [{ kind: 'furnace', level: 4, upgradeEndsAt: null }],
      army: { trapper: 3, marksman: 2, vanguard: 1 },
      armyTiers: {},
      trainingQueue: [],
      waveCleared: 9,
      lastSeenAt: 0,
    };
    storage.setItem(SAVE_KEY, JSON.stringify(v7));
    const loaded = new SaveManager(storage).load(0);
    expect(loaded.loaded).toBe(true);
    expect(loaded.migratedFrom).toBe(7);
    expect(loaded.snapshot.buildings.furnaceLevel).toBe(4);
    expect(loaded.snapshot.waveCleared).toBe(9);
  });

  it('treats a pre-endgame version-5 save as a mismatch and starts fresh', () => {
    const storage = memoryStorage();
    // A well-formed v5 (pre-endgame) save must NOT be mis-loaded into the v6
    // shape; it falls back to a fresh settlement with empty rally/arena/
    // alliance/quest/VIP state.
    const v5 = {
      version: 5,
      resources: { food: 500, wood: 500, coal: 500, iron: 500, steel: 100 },
      premiumCurrency: 300,
      population: { total: 20, assignments: {} },
      heroes: { heroes: {}, lead: [] },
      summon: { totalPulls: 0, pityCounter: 0 },
      campaign: { highestCleared: 0, claimed: [] },
      research: { completed: ['eco_foraging'], active: null },
      gear: { slots: {} },
      warmth: 80,
      buildings: [{ kind: 'furnace', level: 4, upgradeEndsAt: null }],
      army: { trapper: 3, marksman: 2, vanguard: 1 },
      trainingQueue: [],
      waveCleared: 9,
      lastSeenAt: 0,
    };
    storage.setItem(SAVE_KEY, JSON.stringify(v5));
    const loaded = new SaveManager(storage).load(0);
    expect(loaded.loaded).toBe(false);
    expect(loaded.snapshot.buildings.furnaceLevel).toBe(1);
    // Fresh endgame systems are present and empty.
    expect(loaded.snapshot.rally.attempts('rime_alpha')).toBe(0);
    expect(loaded.snapshot.arena.wins).toBe(0);
    expect(loaded.snapshot.alliance.techPoints).toBe(0);
    expect(loaded.snapshot.vip.level).toBe(0);
    expect(loaded.snapshot.quests.dailyProgress('daily_battle')).toBe(0);
  });

  it('migrates a pre-tiered-army version-6 save into tier-1 units', () => {
    const storage = memoryStorage();
    // A well-formed v6 (pre-tiered-army) save must NOT be mis-loaded into the
    // v7 shape; it falls back to a fresh settlement.
    const v6 = {
      version: 6,
      resources: { food: 500, wood: 500, coal: 500, iron: 500, steel: 100 },
      premiumCurrency: 300,
      population: { total: 20, assignments: {} },
      heroes: { heroes: {}, lead: [] },
      summon: { totalPulls: 0, pityCounter: 0 },
      campaign: { highestCleared: 0, claimed: [] },
      research: { completed: [], active: null },
      gear: { slots: {} },
      rally: { bosses: {} },
      arena: { rank: 50, wins: 0, losses: 0, seed: 1 },
      alliance: { techPoints: 0, helpsAvailable: 0 },
      quests: { dailyDayIndex: 0, daily: {}, milestones: {}, activeEventId: null, eventEndsAt: 0 },
      vip: { points: 0 },
      warmth: 80,
      buildings: [{ kind: 'furnace', level: 4, upgradeEndsAt: null }],
      army: { trapper: 3, marksman: 2, vanguard: 1 },
      trainingQueue: [],
      waveCleared: 9,
      lastSeenAt: 0,
    };
    storage.setItem(SAVE_KEY, JSON.stringify(v6));
    const loaded = new SaveManager(storage).load(0);
    expect(loaded.loaded).toBe(true);
    expect(loaded.migratedFrom).toBe(6);
    expect(loaded.snapshot.buildings.furnaceLevel).toBe(4);
    expect(loaded.snapshot.training.armyTiers.vanguard).toEqual({ 1: 1 });
  });

  it('round-trips the tiered standing army through a save', () => {
    const storage = memoryStorage();
    const mgr = new SaveManager(storage);
    const store = new ResourceStore({ food: 1e6, wood: 1e6, coal: 1e6, iron: 1e6, steel: 1e6 });

    // Train a tier-2 batch (research would gate this in-game; the queue itself
    // trusts the tier passed) and finish it so it lands in the tiered army.
    const training = new TrainingQueue();
    training.enqueue('vanguard', 3, store, 0, true, 2);
    training.advance(1e12);
    expect(training.army.vanguard).toBe(3);
    expect(training.armyTiers.vanguard).toEqual({ 2: 3 });

    const snap = { ...snapshot(), training };
    mgr.save(snap, 0);
    const loaded = mgr.load(0);
    // Both the flat total and the per-tier breakdown survive the round trip.
    expect(loaded.snapshot.training.army.vanguard).toBe(3);
    expect(loaded.snapshot.training.armyTiers.vanguard).toEqual({ 2: 3 });
  });

  it('an older-shaped save (no armyTiers) lands the standing army at tier 1', () => {
    const storage = memoryStorage();
    const mgr = new SaveManager(storage);
    // Serialize, then strip armyTiers to mimic a supported v6 payload written before tiers.
    const serialized = SaveManager.serialize(snapshot(), 0);
    delete (serialized as { armyTiers?: unknown }).armyTiers;
    serialized.version = 6;
    storage.setItem(SAVE_KEY, JSON.stringify(serialized));
    const loaded = mgr.load(0);
    // The 4 trappers from the snapshot all default to tier 1.
    expect(loaded.snapshot.training.army.trapper).toBe(4);
    expect(loaded.snapshot.training.armyTiers.trapper).toEqual({ 1: 4 });
  });

  it('treats a pre-expansion version-2 save as a mismatch and starts fresh', () => {
    const storage = memoryStorage();
    // A well-formed version-2 (pre-expansion) save must NOT be mis-loaded into
    // the v3 shape; it falls back to a fresh frozen settlement.
    const v2 = {
      version: 2,
      resources: { food: 500, wood: 500, coal: 500, iron: 500 },
      warmth: 80,
      buildings: [{ kind: 'furnace', level: 4, upgradeEndsAt: null }],
      army: { trapper: 3, marksman: 2, vanguard: 1 },
      trainingQueue: [],
      waveCleared: 9,
      lastSeenAt: 0,
    };
    storage.setItem(SAVE_KEY, JSON.stringify(v2));
    const loaded = new SaveManager(storage).load(0);
    expect(loaded.loaded).toBe(false);
    expect(loaded.snapshot.buildings.furnaceLevel).toBe(1);
    expect(loaded.snapshot.resources.get('food')).toBe(ECONOMY.START.food);
    // Fresh expansion fields are present and sane.
    expect(loaded.snapshot.resources.get('steel')).toBe(0);
    expect(loaded.snapshot.premium.sparks).toBe(0);
    expect(loaded.snapshot.population.total).toBeGreaterThan(0);
  });

  it('treats a pre-research version-4 save as a mismatch and starts fresh', () => {
    const storage = memoryStorage();
    // A well-formed v4 (pre-research) save must NOT be mis-loaded into the v5
    // shape; it falls back to a fresh settlement with empty research + gear.
    const v4 = {
      version: 4,
      resources: { food: 500, wood: 500, coal: 500, iron: 500, steel: 100 },
      premiumCurrency: 300,
      population: { total: 20, assignments: {} },
      heroes: { heroes: {}, lead: [] },
      summon: { totalPulls: 0, pityCounter: 0 },
      campaign: { highestCleared: 0, claimed: [] },
      warmth: 80,
      buildings: [{ kind: 'furnace', level: 4, upgradeEndsAt: null }],
      army: { trapper: 3, marksman: 2, vanguard: 1 },
      trainingQueue: [],
      waveCleared: 9,
      lastSeenAt: 0,
    };
    storage.setItem(SAVE_KEY, JSON.stringify(v4));
    const loaded = new SaveManager(storage).load(0);
    expect(loaded.loaded).toBe(false);
    expect(loaded.snapshot.buildings.furnaceLevel).toBe(1);
    // Fresh research + gear are present and empty.
    expect(loaded.snapshot.research.completedIds()).toEqual([]);
    expect(loaded.snapshot.research.maxTroopTier()).toBe(1);
    expect(loaded.snapshot.gear.level('coat')).toBe(0);
  });

  it('round-trips research + chief-gear state through a save', () => {
    const storage = memoryStorage();
    const mgr = new SaveManager(storage);
    const store = new ResourceStore({ food: 1e6, wood: 1e6, coal: 1e6, iron: 1e6, steel: 1e6 });

    const research = new ResearchSystem();
    research.start('eco_foraging', store, 10, 0);
    research.advance(0 + 999_999_999); // complete it
    const gear = new GearSystem();
    gear.upgradeGear('gloves', store);
    gear.socketCharm('gloves', 'warfare', store);

    const snap: GameSnapshot = {
      resources: new ResourceStore({ food: 1, wood: 1, coal: 1, iron: 1, steel: 1 }),
      buildings: new BuildingSystem([{ kind: 'furnace', level: 2, upgradeEndsAt: null }]),
      training: new TrainingQueue(undefined, { trapper: 0, marksman: 0, vanguard: 0 }),
      warmth: new WarmthSystem(),
      population: new PopulationSystem(),
      premium: new PremiumWallet(0),
      heroes: new HeroRoster(),
      summon: new SummonSystem(),
      campaign: new CampaignSystem(),
      research,
      gear,
      rally: new RallySystem(),
      arena: new ArenaSystem(),
      alliance: new AllianceSystem(),
      quests: new QuestSystem(),
      vip: new VipSystem(),
      waveCleared: 0,
      onboarding: freshOnboarding(),
    };
    mgr.save(snap, 0);
    const loaded = mgr.load(0);
    expect(loaded.snapshot.research.isCompleted('eco_foraging')).toBe(true);
    expect(loaded.snapshot.gear.level('gloves')).toBe(1);
    expect(loaded.snapshot.gear.charm('gloves')).toEqual({ kind: 'warfare', level: 1 });
  });

  it('round-trips the new steel resource, Ember Sparks, and population', () => {
    const storage = memoryStorage();
    const mgr = new SaveManager(storage);
    const resources = new ResourceStore({ food: 1, wood: 2, coal: 3, iron: 4, steel: 55 });
    const buildings = new BuildingSystem([
      { kind: 'furnace', level: 3, upgradeEndsAt: null },
      { kind: 'shelter_row', level: 2, upgradeEndsAt: null },
      { kind: 'hunters_hut', level: 2, upgradeEndsAt: null },
    ]);
    const population = PopulationSystem.fromJSON({ total: 12, assignments: { hunters_hut: 5 } });
    const snap: GameSnapshot = {
      resources,
      buildings,
      training: new TrainingQueue(undefined, { trapper: 0, marksman: 0, vanguard: 0 }),
      warmth: new WarmthSystem(),
      population,
      premium: new PremiumWallet(42),
      heroes: new HeroRoster(),
      summon: new SummonSystem(),
      campaign: new CampaignSystem(),
      research: new ResearchSystem(),
      gear: new GearSystem(),
      rally: new RallySystem(),
      arena: new ArenaSystem(),
      alliance: new AllianceSystem(),
      quests: new QuestSystem(),
      vip: new VipSystem(),
      waveCleared: 0,
      onboarding: freshOnboarding(),
    };
    // Serialized JSON carries the new fields.
    const state = SaveManager.serialize(snap, 0);
    expect(state.resources.steel).toBe(55);
    expect(state.premiumCurrency).toBe(42);
    expect(state.population.total).toBe(12);
    expect(state.population.assignments.hunters_hut).toBe(5);

    mgr.save(snap, 0);
    const loaded = mgr.load(0); // no elapsed time
    expect(loaded.snapshot.resources.get('steel')).toBe(55);
    expect(loaded.snapshot.premium.sparks).toBe(42);
    expect(loaded.snapshot.population.total).toBe(12);
    // Invalid persisted over-assignment is clamped to the producer's L2 cap.
    expect(loaded.snapshot.population.assignedTo('hunters_hut')).toBe(2);
  });

  it('refines steel and drips Ember Sparks over an offline window', () => {
    const storage = memoryStorage();
    const mgr = new SaveManager(storage);
    // A Forge Hall (refinery) with ample iron + coal to keep it fed, and a lit
    // Furnace: while away it should mint steel and drip premium sparks.
    const resources = new ResourceStore({ food: 0, wood: 1e9, coal: 1e9, iron: 1e9, steel: 0 });
    const buildings = new BuildingSystem([
      { kind: 'furnace', level: 3, upgradeEndsAt: null },
      { kind: 'forge_hall', level: 1, upgradeEndsAt: null },
    ]);
    const snap: GameSnapshot = {
      resources,
      buildings,
      training: new TrainingQueue(undefined, { trapper: 0, marksman: 0, vanguard: 0 }),
      warmth: new WarmthSystem(WARMTH.MAX_WARMTH),
      population: atCapWorkforce(buildings),
      premium: new PremiumWallet(0),
      heroes: new HeroRoster(),
      summon: new SummonSystem(),
      campaign: new CampaignSystem(),
      research: new ResearchSystem(),
      gear: new GearSystem(),
      rally: new RallySystem(),
      arena: new ArenaSystem(),
      alliance: new AllianceSystem(),
      quests: new QuestSystem(),
      vip: new VipSystem(),
      waveCleared: 0,
      onboarding: freshOnboarding(),
    };
    mgr.save(snap, 0);

    const loaded = mgr.load(3600 * 1000);
    // Steel was minted from iron + coal during reconciliation...
    expect(loaded.snapshot.resources.get('steel')).toBeGreaterThan(0);
    expect(loaded.offlineGains.steel).toBeGreaterThan(0);
    // ...and premium Ember Sparks dripped from the lit Furnace.
    expect(loaded.snapshot.premium.sparks).toBeGreaterThan(0);
  });
});
