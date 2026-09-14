import { describe, it, expect } from 'vitest';
import { SaveManager, memoryStorage, SAVE_VERSION, type GameSnapshot } from './SaveManager';
import { ResourceStore } from './ResourceStore';
import { BuildingSystem } from './BuildingSystem';
import { TrainingQueue } from './TrainingQueue';
import { ResearchSystem } from './ResearchSystem';
import { HeroSystem } from './HeroSystem';
import { QuestSystem } from './QuestSystem';
import { WarmthSystem } from './WarmthSystem';
import { ECONOMY, WARMTH } from '../config/GameConfig';
import { outputPerSec } from '../config/BuildingConfig';
import { troopDef } from '../config/TroopConfig';

/**
 * Unit tests for the versioned save layer with an INJECTED fake storage (no
 * window dependency): round-trip fidelity and offline idle-gain reconciliation.
 */
describe('SaveManager', () => {
  function snapshot(): GameSnapshot {
    const resources = new ResourceStore({ food: 100, wood: 200, stone: 300, gold: 40 });
    const buildings = new BuildingSystem([
      { kind: 'town_center', level: 3, upgradeEndsAt: null },
      { kind: 'farm', level: 2, upgradeEndsAt: null },
      { kind: 'barracks', level: 1, upgradeEndsAt: null },
    ]);
    const training = new TrainingQueue(undefined, { spearman: 4, archer: 1, knight: 0 });
    const research = new ResearchSystem();
    const heroes = new HeroSystem();
    const quests = new QuestSystem();
    const warmth = new WarmthSystem();
    return {
      resources,
      buildings,
      training,
      research,
      heroes,
      quests,
      warmth,
      waveCleared: 5,
      troopsTrained: 0,
      battlesWon: 0,
      onboardingSeen: false,
      tutorialDone: false,
    };
  }

  /** A full army bundle over every troop kind (new kinds default to zero). */
  function fullArmy(a: Partial<Record<string, number>>): Record<string, number> {
    return { spearman: 0, archer: 0, knight: 0, cavalry: 0, siege: 0, ...a };
  }

  it('loads a fresh game when storage is empty', () => {
    const mgr = new SaveManager(memoryStorage());
    const result = mgr.load(0);
    expect(result.loaded).toBe(false);
    expect(result.snapshot.buildings.townCenterLevel).toBe(1);
    expect(result.snapshot.resources.get('food')).toBe(ECONOMY.START.food);
  });

  it('produces a versioned plain JSON object on serialize', () => {
    const state = SaveManager.serialize(snapshot(), 123456);
    expect(state.version).toBe(SAVE_VERSION);
    expect(state.lastSeenAt).toBe(123456);
    expect(state.army).toEqual(fullArmy({ spearman: 4, archer: 1 }));
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
    expect(loaded.snapshot.resources.balances).toEqual({ food: 100, wood: 200, stone: 300, gold: 40 });
    expect(loaded.snapshot.buildings.townCenterLevel).toBe(3);
    expect(loaded.snapshot.buildings.level('farm')).toBe(2);
    expect(loaded.snapshot.training.army).toEqual(fullArmy({ spearman: 4, archer: 1 }));
    expect(loaded.snapshot.waveCleared).toBe(5);
  });

  it('loads an OLD save whose army lacks the new troop kinds without crashing', () => {
    // Simulate a save written before cavalry/siege existed: the army object has
    // only the three original kinds. deserialize/normalizeArmy must backfill
    // the new kinds to 0 rather than crash or leave them undefined.
    const storage = memoryStorage();
    const oldState = {
      version: 1, // a genuine v1 save (predates research)
      resources: { food: 10, wood: 10, stone: 10, gold: 10 },
      buildings: [{ kind: 'town_center', level: 1, upgradeEndsAt: null }],
      army: { spearman: 3, archer: 2, knight: 1 }, // no cavalry / siege
      trainingQueue: [],
      waveCleared: 2,
      lastSeenAt: 0,
    };
    storage.setItem('kingdom-rise:save', JSON.stringify(oldState));
    const mgr = new SaveManager(storage);

    const loaded = mgr.load(0);
    expect(loaded.loaded).toBe(true);
    expect(loaded.snapshot.training.army).toEqual(
      fullArmy({ spearman: 3, archer: 2, knight: 1 }),
    );
  });

  it('migrates a v1 save (no research field) into a fresh valid research state', () => {
    // A version-1 save predates the Scholars' Hall and has no `research` field.
    // It must load without crashing and yield an empty-but-valid ResearchSystem
    // (nothing unlocked, no active research, all multipliers neutral).
    const storage = memoryStorage();
    const v1 = {
      version: 1,
      resources: { food: 50, wood: 50, stone: 50, gold: 50 },
      buildings: [{ kind: 'town_center', level: 2, upgradeEndsAt: null }],
      army: { spearman: 1, archer: 0, knight: 0 },
      trainingQueue: [],
      waveCleared: 1,
      lastSeenAt: 0,
      // no `research` key
    };
    storage.setItem('kingdom-rise:save', JSON.stringify(v1));
    const mgr = new SaveManager(storage);

    const loaded = mgr.load(0);
    expect(loaded.loaded).toBe(true);
    const research = loaded.snapshot.research;
    expect(research.unlocked).toEqual([]);
    expect(research.isBusy).toBe(false);
    // Every aggregate multiplier is neutral on a fresh state.
    expect(research.productionMultiplier()).toBe(1);
    expect(research.trainSpeedMultiplier()).toBe(1);
    expect(research.combatAttackMultiplier()).toBe(1);
    expect(research.storageMultiplier()).toBe(1);
    expect(research.offlineEfficiencyMultiplier()).toBe(1);
  });

  it('round-trips research state (unlocked techs + active slot) through save -> load', () => {
    const storage = memoryStorage();
    const mgr = new SaveManager(storage);
    const now = 2_000_000;

    const snap = snapshot();
    // Unlock one tech and start another (single slot busy).
    const rich = new ResourceStore({ food: 99999, wood: 99999, stone: 99999, gold: 99999 });
    snap.research.startResearch('crop_rotation', rich, 0, 1);
    snap.research.update(snap.research.remainingMs(0)); // complete it at its own end
    snap.research.startResearch('sharpened_blades', rich, now, 1);
    expect(snap.research.isUnlocked('crop_rotation')).toBe(true);
    expect(snap.research.activeTech).toBe('sharpened_blades');

    mgr.save(snap, now);
    // Load at the same instant so the active research is NOT yet complete.
    const loaded = mgr.load(now);
    expect(loaded.snapshot.research.isUnlocked('crop_rotation')).toBe(true);
    expect(loaded.snapshot.research.activeTech).toBe('sharpened_blades');
    expect(loaded.snapshot.research.productionMultiplier()).toBeCloseTo(1.1, 6);
  });

  it('migrates a v2 save (no heroes field) into a fresh valid empty roster', () => {
    // A version-2 save predates the heroes feature and has no `heroes` field.
    // It must load without crashing and yield an empty-but-valid HeroSystem
    // (no heroes recruited, none active, both multipliers neutral).
    const storage = memoryStorage();
    const v2 = {
      version: 2,
      resources: { food: 50, wood: 50, stone: 50, gold: 50 },
      buildings: [{ kind: 'town_center', level: 2, upgradeEndsAt: null }],
      army: { spearman: 1, archer: 0, knight: 0 },
      trainingQueue: [],
      waveCleared: 1,
      research: { unlocked: [], active: null },
      lastSeenAt: 0,
      // no `heroes` key
    };
    storage.setItem('kingdom-rise:save', JSON.stringify(v2));
    const mgr = new SaveManager(storage);

    const loaded = mgr.load(0);
    expect(loaded.loaded).toBe(true);
    const heroes = loaded.snapshot.heroes;
    expect(heroes.recruited).toEqual([]);
    expect(heroes.activeHero).toBeNull();
    expect(heroes.combatMultiplier()).toBe(1);
    expect(heroes.economyMultiplier()).toBe(1);
  });

  it('round-trips hero state (recruited progress + active hero) through save -> load', () => {
    const storage = memoryStorage();
    const mgr = new SaveManager(storage);
    const now = 3_000_000;

    const snap = snapshot();
    const rich = new ResourceStore({ food: 99999, wood: 99999, stone: 99999, gold: 99999 });
    snap.heroes.recruit('ser_alden', rich); // war hero, auto-active
    snap.heroes.levelUp('ser_alden', rich);
    snap.heroes.addShards('ser_alden', 25);
    snap.heroes.starUp('ser_alden');
    expect(snap.heroes.activeHero).toBe('ser_alden');

    mgr.save(snap, now);
    const loaded = mgr.load(now);
    const heroes = loaded.snapshot.heroes;
    expect(heroes.recruited).toEqual(['ser_alden']);
    expect(heroes.activeHero).toBe('ser_alden');
    const p = heroes.progress('ser_alden')!;
    expect(p.level).toBe(2);
    expect(p.stars).toBe(1);
    expect(p.shards).toBe(15); // 25 accrued - 10 spent on the star
    // A war hero's bonus round-trips into the combat multiplier (economy stays 1).
    expect(heroes.combatMultiplier()).toBeGreaterThan(1);
    expect(heroes.economyMultiplier()).toBe(1);
  });

  it('migrates a v3 save (no quests/counters) into a fresh valid quest log', () => {
    // A version-3 save predates the quests feature and has no `quests`,
    // `troopsTrained`, or `battlesWon` fields. It must load without crashing
    // and yield an empty-but-valid QuestSystem with zeroed counters.
    const storage = memoryStorage();
    const v3 = {
      version: 3,
      resources: { food: 50, wood: 50, stone: 50, gold: 50 },
      buildings: [{ kind: 'town_center', level: 2, upgradeEndsAt: null }],
      army: { spearman: 1, archer: 0, knight: 0 },
      trainingQueue: [],
      waveCleared: 1,
      research: { unlocked: [], active: null },
      heroes: { recruited: {}, active: null },
      lastSeenAt: 0,
      // no `quests` / `troopsTrained` / `battlesWon` keys
    };
    storage.setItem('kingdom-rise:save', JSON.stringify(v3));
    const mgr = new SaveManager(storage);

    const loaded = mgr.load(0);
    expect(loaded.loaded).toBe(true);
    expect(loaded.snapshot.quests.claimed).toEqual([]);
    expect(loaded.snapshot.quests.status('secure_the_timber')).not.toBe('claimed');
    expect(loaded.snapshot.troopsTrained).toBe(0);
    expect(loaded.snapshot.battlesWon).toBe(0);
  });

  it('round-trips quest claim status + lifetime counters through save -> load', () => {
    const storage = memoryStorage();
    const mgr = new SaveManager(storage);
    const now = 4_000_000;

    const snap = snapshot();
    // Refresh with a progress that satisfies the first quest, then claim it.
    snap.quests.refresh({
      buildingLevels: { lumber_mill: 1 },
      townCenterLevel: 1,
      troopsTrained: 0,
      battlesWon: 0,
      techsUnlocked: 0,
      unlockedTechIds: [],
    });
    snap.quests.claim('secure_the_timber'); // mark the first quest claimed
    snap.troopsTrained = 17;
    snap.battlesWon = 3;
    expect(snap.quests.isClaimed('secure_the_timber')).toBe(true);

    mgr.save(snap, now);
    const loaded = mgr.load(now);
    expect(loaded.snapshot.quests.claimed).toEqual(['secure_the_timber']);
    expect(loaded.snapshot.quests.isClaimed('secure_the_timber')).toBe(true);
    expect(loaded.snapshot.troopsTrained).toBe(17);
    expect(loaded.snapshot.battlesWon).toBe(3);
  });

  it('loads an old save without defensive buildings as zero town defense', () => {
    // Saves written before the defenses feature simply have no wall/watchtower
    // building states. They must load with those buildings at level 0, so the
    // town's aggregate defense is 0 (no crash, no undefined).
    const storage = memoryStorage();
    const old = {
      version: 3,
      resources: { food: 50, wood: 50, stone: 50, gold: 50 },
      buildings: [
        { kind: 'town_center', level: 3, upgradeEndsAt: null },
        { kind: 'farm', level: 2, upgradeEndsAt: null },
      ],
      army: { spearman: 1, archer: 0, knight: 0, cavalry: 0, siege: 0 },
      trainingQueue: [],
      waveCleared: 1,
      research: { unlocked: [], active: null },
      heroes: { recruited: {}, active: null },
      lastSeenAt: 0,
      // no wall / watchtower building states
    };
    storage.setItem('kingdom-rise:save', JSON.stringify(old));
    const mgr = new SaveManager(storage);

    const loaded = mgr.load(0);
    expect(loaded.loaded).toBe(true);
    expect(loaded.snapshot.buildings.level('wall')).toBe(0);
    expect(loaded.snapshot.buildings.level('watchtower')).toBe(0);
    expect(loaded.snapshot.buildings.townDefense()).toBe(0);
  });

  it('round-trips defensive building levels (town defense) through save -> load', () => {
    const storage = memoryStorage();
    const mgr = new SaveManager(storage);
    const now = 4_000_000;

    const snap = snapshot();
    // Add a wall and a watchtower to the snapshot's buildings via a fresh set.
    const buildings = new BuildingSystem([
      { kind: 'town_center', level: 4, upgradeEndsAt: null },
      { kind: 'wall', level: 3, upgradeEndsAt: null },
      { kind: 'watchtower', level: 2, upgradeEndsAt: null },
    ]);
    const expected = buildings.townDefense();
    expect(expected).toBeGreaterThan(0);
    mgr.save({ ...snap, buildings }, now);

    const loaded = mgr.load(now);
    expect(loaded.snapshot.buildings.level('wall')).toBe(3);
    expect(loaded.snapshot.buildings.level('watchtower')).toBe(2);
    expect(loaded.snapshot.buildings.townDefense()).toBe(expected);
  });

  it('applies offline idle gains capped and scaled by efficiency', () => {
    const storage = memoryStorage();
    const mgr = new SaveManager(storage);
    const saveTime = 0;
    // Stock enough firewood that the Hearth stays fully warm for the whole
    // window (burn is 0.5 wood/s -> 1800 wood over 3600s), so the warmth
    // production multiplier is exactly 1.0 and does not throttle these gains.
    // This isolates the offline production math from the (separately tested)
    // warmth throttle.
    const snap = snapshot();
    snap.resources.add({ wood: 5000 });
    const woodBefore = snap.resources.get('wood');
    // Start already AT the warmth ceiling for this TC level (L3 -> 140) so the
    // keep is fully warm from the first step and the multiplier is exactly 1.0.
    snap.warmth = new WarmthSystem(snap.warmth.maxWarmth(3));
    mgr.save(snap, saveTime);

    const elapsedSec = 3600; // 1 hour, under the 8h cap
    const loaded = mgr.load(saveTime + elapsedSec * 1000);
    expect(loaded.offlineSeconds).toBe(elapsedSec);

    // Only the level-2 farm produces (food). Warmth stayed full (mult 1.0), so
    // expected = rate * seconds * efficiency, unchanged by the Hearth.
    const expectedFood = outputPerSec('farm', 2) * elapsedSec * ECONOMY.OFFLINE_EFFICIENCY;
    expect(loaded.offlineGains.food).toBeCloseTo(expectedFood, 4);
    expect(loaded.snapshot.resources.get('food')).toBeCloseTo(100 + expectedFood, 4);
    // Stone has no producer here, so it accrues the rescue floor rather than
    // staying put (see WARMTH.BASELINE_GATHER_PER_SEC - it exists so a town that
    // has spent everything can still earn its way back to a Lumber Mill).
    expect(loaded.snapshot.resources.get('stone')).toBeGreaterThan(300);
    // The keep stayed fully warm and the woodpile was only drawn down by the
    // hearth's firewood burn over the window (no wood producer here). At TC L3
    // the burn is reduced by the fuel-efficiency factor.
    const burned = new WarmthSystem().fuelPerSecond(3).wood * elapsedSec;
    expect(loaded.snapshot.resources.get('wood')).toBeCloseTo(woodBefore - burned, 3);
    expect(loaded.snapshot.warmth.warmth).toBe(loaded.snapshot.warmth.maxWarmth(3));
  });

  it('throttles offline production toward the floor when the woodpile runs dry', () => {
    // Mirror of the above but WITHOUT enough firewood: the Hearth burns through
    // the wood on hand, goes cold, warmth decays, and offline production is
    // throttled below the full-warmth amount (but never to zero - it sinks
    // toward the WARMTH_PRODUCTION_FLOOR). This proves the warmth throttle is
    // wired into offline reconciliation, not just the live tick.
    const storage = memoryStorage();
    const mgr = new SaveManager(storage);
    const snap = snapshot(); // farm L2 (food only), TC L3, modest wood
    mgr.save(snap, 0);

    const elapsedSec = 3600;
    const loaded = mgr.load(elapsedSec * 1000);

    const fullWarmthFood = outputPerSec('farm', 2) * elapsedSec * ECONOMY.OFFLINE_EFFICIENCY;
    const floorFood = fullWarmthFood * WARMTH.WARMTH_PRODUCTION_FLOOR;
    // Strictly less than full-warmth output (throttled) ...
    expect(loaded.offlineGains.food).toBeLessThan(fullWarmthFood);
    // ... but strictly above the hard floor (warmth started full, decayed over
    // time), and comfortably positive.
    expect(loaded.offlineGains.food).toBeGreaterThan(floorFood);
    // The hearth ran cold: warmth ended at 0 after a long unfueled span.
    expect(loaded.snapshot.warmth.warmth).toBe(0);
  });

  it('splits the offline window at an upgrade boundary rather than over-crediting', () => {
    const storage = memoryStorage();
    const mgr = new SaveManager(storage);

    // A farm at L2 with an in-progress upgrade to L3 that finishes 600s into a
    // 1000s offline window. Production must be credited at L2 for the first
    // 600s and L3 only for the final 400s - NOT L3 for the whole window.
    const t0 = 1_000_000;
    const windowSec = 1000;
    const boundaryOffset = 600; // seconds into the window the upgrade completes
    // Ample firewood so the Hearth stays fully warm (mult 1.0) across the whole
    // window - this test isolates the upgrade-boundary split from the warmth
    // throttle (covered by its own tests).
    const resources = new ResourceStore({ food: 0, wood: 5000, stone: 0, gold: 0 });
    const buildings = new BuildingSystem([
      { kind: 'town_center', level: 3, upgradeEndsAt: null },
      { kind: 'farm', level: 2, upgradeEndsAt: t0 + boundaryOffset * 1000 },
    ]);
    const training = new TrainingQueue(undefined, { spearman: 0, archer: 0, knight: 0 });
    mgr.save(
      {
        resources,
        buildings,
        training,
        research: new ResearchSystem(),
        heroes: new HeroSystem(),
        quests: new QuestSystem(),
        // Start at the warmth ceiling for TC L3 (140) so the keep is fully warm
        // (mult 1.0) throughout - this test isolates the upgrade-boundary split.
        warmth: new WarmthSystem(new WarmthSystem().maxWarmth(3)),
        waveCleared: 0,
        troopsTrained: 0,
        battlesWon: 0,
        onboardingSeen: false,
        tutorialDone: false,
      },
      t0,
    );

    const loaded = mgr.load(t0 + windowSec * 1000);
    expect(loaded.offlineSeconds).toBe(windowSec);
    // Farm ended at L3.
    expect(loaded.snapshot.buildings.level('farm')).toBe(3);

    const eff = ECONOMY.OFFLINE_EFFICIENCY;
    // The completion batch is applied first at the authoritative 600s tick,
    // then that tick's production uses L3 (SPEC timer→production ordering).
    const expectedSplit =
      outputPerSec('farm', 2) * (boundaryOffset - 1) * eff +
      outputPerSec('farm', 3) * (windowSec - boundaryOffset + 1) * eff;
    const naiveWhole = outputPerSec('farm', 3) * windowSec * eff;

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
    const t = troopDef('spearman').trainTimeMs;

    const snap = snapshot();
    // Queue 2 spearmen at t=0 (Barracks present); they complete at 2*t.
    const rich = new ResourceStore({ food: 99999, wood: 99999, stone: 99999, gold: 99999 });
    snap.training.enqueue('spearman', 2, rich, 0, true);
    mgr.save(snap, 0);

    const loaded = mgr.load(2 * t + 1);
    // Army had 4 spearmen; +2 completed offline = 6.
    expect(loaded.snapshot.training.army.spearman).toBe(6);
    expect(loaded.snapshot.training.length).toBe(0);
  });

  it('starts fresh on a version mismatch instead of crashing', () => {
    const storage = memoryStorage();
    storage.setItem('kingdom-rise:save', JSON.stringify({ version: 999, resources: {} }));
    const mgr = new SaveManager(storage);
    const loaded = mgr.load(0);
    expect(loaded.loaded).toBe(false);
    expect(loaded.snapshot.buildings.townCenterLevel).toBe(1);
  });

  it('starts fresh on corrupt / unparseable JSON instead of crashing', () => {
    const storage = memoryStorage();
    storage.setItem('kingdom-rise:save', '{not valid json at all');
    const mgr = new SaveManager(storage);
    const loaded = mgr.load(0);
    expect(loaded.loaded).toBe(false);
    expect(loaded.snapshot.buildings.townCenterLevel).toBe(1);
    expect(loaded.snapshot.resources.get('food')).toBe(ECONOMY.START.food);
    expect(loaded.offlineSeconds).toBe(0);
  });

  it('starts fresh when the stored JSON is not an object (e.g. a bare value)', () => {
    const storage = memoryStorage();
    storage.setItem('kingdom-rise:save', '42');
    const mgr = new SaveManager(storage);
    const loaded = mgr.load(0);
    expect(loaded.loaded).toBe(false);
    expect(loaded.snapshot.buildings.townCenterLevel).toBe(1);
  });

  it('clear() removes the save slot', () => {
    const storage = memoryStorage();
    const mgr = new SaveManager(storage);
    mgr.save(snapshot(), 0);
    mgr.clear();
    expect(mgr.load(0).loaded).toBe(false);
  });

  it('current SAVE_VERSION is 7 (tutorialDone field)', () => {
    expect(SAVE_VERSION).toBe(7);
  });

  it('a fresh game starts with onboardingSeen=false so the welcome shows once', () => {
    const mgr = new SaveManager(memoryStorage());
    const fresh = mgr.load(0);
    expect(fresh.loaded).toBe(false);
    expect(fresh.snapshot.onboardingSeen).toBe(false);
  });

  it('serialize round-trips the onboardingSeen flag', () => {
    const snap = snapshot();
    snap.onboardingSeen = true;
    const state = SaveManager.serialize(snap, 0);
    expect(state.onboardingSeen).toBe(true);
    expect(state.version).toBe(7);
  });

  it('migrates an old save (no onboardingSeen) to onboardingSeen=true (returning player is never re-shown the welcome)', () => {
    // A save that predates the flag belongs to a returning player who has
    // already seen the game, so a missing flag must migrate to `true`.
    const storage = memoryStorage();
    const v5 = {
      version: 5,
      resources: { food: 50, wood: 50, stone: 50, gold: 50 },
      buildings: [{ kind: 'town_center', level: 2, upgradeEndsAt: null }],
      army: { spearman: 1, archer: 0, knight: 0 },
      trainingQueue: [],
      waveCleared: 1,
      lastSeenAt: 0,
      // no `onboardingSeen` key
    };
    storage.setItem('kingdom-rise:save', JSON.stringify(v5));
    const loaded = new SaveManager(storage).load(0);
    expect(loaded.loaded).toBe(true);
    expect(loaded.snapshot.onboardingSeen).toBe(true);
  });

  it('preserves an explicit onboardingSeen=false on a versioned save', () => {
    const storage = memoryStorage();
    const state = SaveManager.serialize(snapshot(), 0); // onboardingSeen=false
    storage.setItem('kingdom-rise:save', JSON.stringify(state));
    const loaded = new SaveManager(storage).load(0);
    expect(loaded.snapshot.onboardingSeen).toBe(false);
  });

  it('a fresh game starts with tutorialDone=false so the tutorial runs once', () => {
    const mgr = new SaveManager(memoryStorage());
    const fresh = mgr.load(0);
    expect(fresh.loaded).toBe(false);
    expect(fresh.snapshot.tutorialDone).toBe(false);
  });

  it('serialize round-trips the tutorialDone flag', () => {
    const snap = snapshot();
    snap.tutorialDone = true;
    const state = SaveManager.serialize(snap, 0);
    expect(state.tutorialDone).toBe(true);
    expect(state.version).toBe(7);
    // Full round-trip through storage.
    const storage = memoryStorage();
    storage.setItem('kingdom-rise:save', JSON.stringify(state));
    expect(new SaveManager(storage).load(0).snapshot.tutorialDone).toBe(true);
  });

  it('migrates an old save (no tutorialDone) to tutorialDone=true (returning player is never shown the tutorial)', () => {
    // A save that predates the flag belongs to a returning player who has
    // already played, so a missing flag must migrate to `true`.
    const storage = memoryStorage();
    const v6 = {
      version: 6,
      resources: { food: 50, wood: 50, stone: 50, gold: 50 },
      buildings: [{ kind: 'town_center', level: 2, upgradeEndsAt: null }],
      army: { spearman: 1, archer: 0, knight: 0 },
      trainingQueue: [],
      waveCleared: 1,
      onboardingSeen: true,
      lastSeenAt: 0,
      // no `tutorialDone` key
    };
    storage.setItem('kingdom-rise:save', JSON.stringify(v6));
    const loaded = new SaveManager(storage).load(0);
    expect(loaded.loaded).toBe(true);
    expect(loaded.snapshot.tutorialDone).toBe(true);
  });

  it('preserves an explicit tutorialDone=false on a versioned save', () => {
    const storage = memoryStorage();
    const state = SaveManager.serialize(snapshot(), 0); // tutorialDone=false
    storage.setItem('kingdom-rise:save', JSON.stringify(state));
    const loaded = new SaveManager(storage).load(0);
    expect(loaded.snapshot.tutorialDone).toBe(false);
  });
});
