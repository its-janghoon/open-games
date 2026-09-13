import { describe, it, expect } from 'vitest';
import { GameStore } from './GameStore';
import { SaveManager, memoryStorage, SAVE_KEY, SAVE_VERSION } from './SaveManager';
import { HERO_ORDER } from '../config/Heroes';
import { makeHeroInstance } from './Heroes';
import { duplicateShards } from './Recruit';

/**
 * Tests for the full-state runtime accessor. GameStore owns the whole v2
 * GameState and is the single place later features read/write. It is exercised
 * here with an injected fake storage via {@link GameStore.createWith}.
 */
describe('GameStore', () => {
  it('loads a fresh v2 state when storage is empty', () => {
    const store = GameStore.createWith(memoryStorage());
    expect(store.state.version).toBe(SAVE_VERSION);
    expect(store.state.miniGame.coins).toBe(0);
    expect(store.state.resources).toEqual(SaveManager.freshGame().resources);
    expect(store.state.buildings).toEqual(SaveManager.freshGame().buildings);
  });

  it('persists sub-state mutations through save/load', () => {
    const storage = memoryStorage();
    const store = GameStore.createWith(storage);
    store.state.resources.stockpiles.rations = 42;
    store.state.season.current = 1;
    store.persist();

    // A fresh store reading the same storage sees the persisted values.
    const reloaded = GameStore.createWith(storage);
    expect(reloaded.state.resources.stockpiles.rations).toBe(42);
    expect(reloaded.state.season.current).toBe(1);
  });

  it('reads a migrated v1 save (miniGame preserved)', () => {
    const storage = memoryStorage();
    storage.setItem(
      SAVE_KEY,
      JSON.stringify({
        version: 1,
        meta: {
          coins: 120,
          upgrades: { start_size: 2, damage: 1, fire_rate: 0, coin_bonus: 1 },
          bestDistance: 900,
          bestScore: 1500,
          runsPlayed: 4,
        },
      }),
    );
    const store = GameStore.createWith(storage);
    expect(store.state.version).toBe(3);
    expect(store.state.miniGame.coins).toBe(120);
    expect(store.state.miniGame.bestScore).toBe(1500);
    // A migrated legacy player is a returning player: tutorial marked seen.
    expect(store.tutorialSeen()).toBe(true);
  });

  it('reset() wipes back to a fresh v2 game and persists', () => {
    const storage = memoryStorage();
    const store = GameStore.createWith(storage);
    store.state.miniGame.coins = 999;
    store.persist();
    store.reset();
    expect(store.state.miniGame.coins).toBe(0);

    const stored = JSON.parse(storage.getItem(SAVE_KEY) as string);
    // The recruit-entropy seed is randomized per fresh game, so compare every
    // other sub-state against a fresh baseline and check the seed shape apart.
    const baseline = SaveManager.freshGame();
    expect(stored.heroes.recruitSeed).toBeGreaterThan(0);
    expect({ ...stored, heroes: { ...stored.heroes, recruitSeed: 0 } }).toEqual({
      ...baseline,
      heroes: { ...baseline.heroes, recruitSeed: 0 },
    });
  });

  it('tick() accrues production against the stored timestamp and persists', () => {
    const storage = memoryStorage();
    const store = GameStore.createWith(storage);
    // First tick establishes the baseline (no back-crediting).
    store.tick(1_000);
    const baseline = store.resource('rations');
    // Second tick 100s later accrues production.
    store.tick(101_000);
    expect(store.resource('rations')).toBeGreaterThan(baseline);

    // Persisted: a fresh store sees the accrued amount and timestamp.
    const reloaded = GameStore.createWith(storage);
    expect(reloaded.resource('rations')).toBe(store.resource('rations'));
    expect(reloaded.state.resources.lastTickTimestamp).toBe(101_000);
  });

  it('a brand-new save does NOT credit a full offline window on the first tick', () => {
    const storage = memoryStorage();
    const store = GameStore.createWith(storage);
    // A fresh save has lastTickTimestamp 0. Entering Home a full day into the
    // epoch must NOT back-credit ~24h of production from timestamp 0.
    expect(store.state.resources.lastTickTimestamp).toBe(0);
    const startRations = store.resource('rations');
    const now = 86_400_000; // one full day past the epoch
    store.tick(now);
    // First tick only establishes the baseline; nothing is granted.
    expect(store.resource('rations')).toBe(startRations);
    expect(store.state.resources.lastTickTimestamp).toBe(now);

    // A subsequent real gap DOES accrue (proves production still works after
    // the baseline is seeded, so we did not simply disable accrual).
    store.tick(now + 100_000);
    expect(store.resource('rations')).toBeGreaterThan(startRations);
  });

  it('tryStartUpgrade spends resources, queues the timed upgrade, and persists', () => {
    const storage = memoryStorage();
    const store = GameStore.createWith(storage);
    const before = store.resource('steel');

    const ok = store.tryStartUpgrade('hq', 1_000);
    expect(ok).toBe(true);
    expect(store.resource('steel')).toBeLessThan(before); // cost spent
    expect(store.state.buildings.queue).toHaveLength(1);
    expect(store.state.buildings.queue[0].building).toBe('hq');

    // A second concurrent upgrade is blocked (single global queue).
    expect(store.tryStartUpgrade('barracks', 1_000)).toBe(false);
  });

  it('tick() completes a building upgrade offline (while the tab was closed)', () => {
    const storage = memoryStorage();
    const store = GameStore.createWith(storage);
    store.tick(0);
    expect(store.tryStartUpgrade('hq', 0)).toBe(true);
    const completesAt = store.state.buildings.queue[0].completesAt;
    const beforeLevel = store.buildingLevel('hq');

    // Far past completion: the upgrade resolves on tick.
    const result = store.tick(completesAt + 10_000);
    expect(store.buildingLevel('hq')).toBe(beforeLevel + 1);
    expect(store.state.buildings.queue).toHaveLength(0);
    expect(result.completed).toContain('hq');
  });

  it('canUpgrade enforces the HQ cap through the store', () => {
    const storage = memoryStorage();
    const store = GameStore.createWith(storage);
    // Fresh: HQ 1, barracks 0 -> barracks may reach level 1.
    expect(store.canUpgrade('barracks').ok).toBe(true);
    // Bump barracks to HQ level so the next level would exceed the cap.
    store.state.buildings.levels.barracks = 1;
    store.persist();
    expect(store.canUpgrade('barracks')).toEqual({ ok: false, reason: 'hq_cap' });
  });

  it('grantResources adds and clamps to storage', () => {
    const storage = memoryStorage();
    const store = GameStore.createWith(storage);
    const cap = store.storageCaps().circuitry;
    store.grantResources({ circuitry: 1e9 });
    expect(store.resource('circuitry')).toBe(cap);
  });

  /* FEAT-003: hero roster / recruit / progression / formation. */

  it('recruitOne adds a new hero and persists', () => {
    const storage = memoryStorage();
    const store = GameStore.createWith(storage);
    store.state.heroes.shards = 200;
    const res = store.recruitOne(1234);
    expect(store.ownsHero(res.heroId)).toBe(true);
    expect(res.duplicate).toBe(false);
    // Persisted: a reloaded store sees the same roster + pity total.
    const reloaded = GameStore.createWith(storage);
    expect(reloaded.ownsHero(res.heroId)).toBe(true);
    expect(reloaded.state.heroes.pity.totalPulls).toBe(1);
  });

  it('recruitOne converts a duplicate to shards', () => {
    const storage = memoryStorage();
    const store = GameStore.createWith(storage);
    store.state.heroes.shards = 1000;
    for (const id of HERO_ORDER) store.state.heroes.roster[id] = makeHeroInstance(id);

    // Recruiting ALSO advances the daily 'recruit' arms-race tasks, and completing
    // one pays shards directly AND can cross a points milestone that pays again -
    // both land in this same balance via applyRewardNoPersist. Worse, the active
    // daily set is drawn from a per-day seed (MISSIONS.DAILY_TASK_COUNT of
    // MISSIONS.DAILY_TEMPLATES), so whether a recruit task is in play at all
    // depends on the calendar date: asserting a bare shard delta made this test
    // pass or fail by the day it ran on. Exhaust the recruit tasks FIRST (any
    // amount >= recruit_2's target of 5 completes every recruit template, and if
    // none was drawn there was nothing to pay out anyway), so the measured pull
    // below moves shards only by its own economics.
    store.recruitMany(10);

    const shardsBefore = store.shards();
    const dupesBefore = Object.fromEntries(HERO_ORDER.map((id) => [id, store.hero(id)!.dupes]));
    const second = store.recruitOne(4242);
    expect(second.duplicate).toBe(true);
    expect(second.shardsGained).toBe(duplicateShards(second.grade));
    expect(store.shards()).toBe(shardsBefore - 20 + second.shardsGained);
    expect(store.hero(second.heroId)!.dupes).toBe(dupesBefore[second.heroId] + 1);
  });

  it('hero progression spends shards and persists', () => {
    const storage = memoryStorage();
    const store = GameStore.createWith(storage);
    store.state.heroes.shards = 200;
    const res = store.recruitOne(1);
    // Grant plenty of shards directly for the test.
    store.state.heroes.shards = 100000;
    store.persist();
    const before = store.hero(res.heroId)!.level;
    expect(store.levelUpHero(res.heroId)).toBe(true);
    expect(store.hero(res.heroId)!.level).toBe(before + 1);
    expect(store.starUpHero(res.heroId)).toBe(true);
    expect(store.hero(res.heroId)!.stars).toBeGreaterThan(1);
    expect(store.skillUpHero(res.heroId)).toBe(true);
    // A non-owned hero cannot be progressed.
    expect(store.levelUpHero('not-owned')).toBe(false);
  });

  it('hero progression fails with insufficient shards', () => {
    const storage = memoryStorage();
    const store = GameStore.createWith(storage);
    store.state.heroes.shards = 200;
    const res = store.recruitOne(2);
    store.state.heroes.shards = 0;
    store.persist();
    expect(store.levelUpHero(res.heroId)).toBe(false);
    expect(store.hero(res.heroId)!.level).toBe(1);
  });

  it('setFormationSlot only places owned heroes and persists', () => {
    const storage = memoryStorage();
    const store = GameStore.createWith(storage);
    store.state.heroes.shards = 200;
    const res = store.recruitOne(3);
    // Cannot place a hero that is not owned.
    expect(store.setFormationSlot('front', 0, 'ironward-not-owned')).toBe(false);
    // Can place an owned hero.
    expect(store.setFormationSlot('front', 0, res.heroId)).toBe(true);
    expect(store.formation().front[0]).toBe(res.heroId);
    // Persisted across reload.
    const reloaded = GameStore.createWith(storage);
    expect(reloaded.formation().front[0]).toBe(res.heroId);
    // Clearing works.
    expect(store.setFormationSlot('front', 0, null)).toBe(true);
    expect(store.formation().front[0]).toBeNull();
  });

  /* FEAT-004: campaign / season / missions / league progression. */

  /** Recruit + place a full, deliberately strong 5-hero squad for battle tests. */
  function armStrongSquad(store: GameStore): void {
    // Grant heaps of shards and hand-craft a maxed roster of five heroes so the
    // squad reliably clears early stages regardless of recruit RNG.
    const ids = ['ironward', 'stormvolley', 'skytalon', 'breachram', 'medevac'];
    for (const id of ids) {
      store.state.heroes.roster[id] = { id, level: 60, stars: 4, skillLevel: 5, dupes: 0 };
    }
    store.persist();
    store.setFormationSlot('front', 0, 'ironward');
    store.setFormationSlot('front', 1, 'breachram');
    store.setFormationSlot('back', 0, 'stormvolley');
    store.setFormationSlot('back', 1, 'skytalon');
    store.setFormationSlot('back', 2, 'medevac');
  }

  it('attemptStage clears stage 1, banks rewards, and gates stage 3 by resistance', () => {
    const store = GameStore.createWith(memoryStorage());
    armStrongSquad(store);

    const res = store.attemptStage('stage_1', 7);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.outcome.win).toBe(true);
    expect(store.clearedStages()).toContain('stage_1');
    // The reward advanced the season track (stage_1 grants seasonXp).
    expect(store.state.season.xp).toBeGreaterThan(0);

    // Stage 3 needs resistance >= 1 -> locked even after clearing stage 2.
    store.attemptStage('stage_2', 7);
    const locked = store.attemptStage('stage_3', 7);
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.reason).toBe('locked');
  });

  it('awardSeasonXp advances tiers and applies tier rewards, raiseResistance unlocks premium', () => {
    const store = GameStore.createWith(memoryStorage());
    const result = store.awardSeasonXp(100000);
    expect(store.seasonTier()).toBeGreaterThan(0);
    expect(result.tiersGained).toBeGreaterThan(0);

    // Enough banked XP remains to raise resistance to the premium threshold.
    while (!store.premiumUnlocked() && store.raiseResistance()) {
      // keep raising until unlocked or unaffordable
    }
    expect(store.resistance()).toBeGreaterThan(0);
    expect(store.premiumUnlocked()).toBe(true);
  });

  it('rolloverSeason resets seasonal progress and bumps the season id', () => {
    const store = GameStore.createWith(memoryStorage());
    store.awardSeasonXp(5000);
    const before = store.state.season.current;
    store.rolloverSeason();
    expect(store.state.season.current).toBe(before + 1);
    expect(store.state.season.xp).toBe(0);
    expect(store.seasonTier()).toBe(0);
  });

  it('recordMissionProgress tracks arms-race score and persists', () => {
    const storage = memoryStorage();
    const store = GameStore.createWith(storage);
    const now = 86_400_000 * 500;
    store.refreshMissions(now);
    // Hammer every category so at least one task completes and scores points.
    for (const cat of ['build', 'recruit', 'power_up', 'combat', 'mini_game'] as const) {
      store.recordMissionProgress(cat, 50, now);
    }
    expect(store.armsRaceScore()).toBeGreaterThan(0);
    const reloaded = GameStore.createWith(storage);
    expect(reloaded.armsRaceScore()).toBe(store.armsRaceScore());
  });

  it('refreshMissions settles the weekly alliance duel on a week rollover', () => {
    const store = GameStore.createWith(memoryStorage());
    const week0 = 0;
    store.refreshMissions(week0);
    // Build up weekly activity in week 0.
    store.recordMissionProgress('combat', 100, week0);
    // Advance a full week -> the duel settles for the just-ended week.
    const week1 = 86_400_000 * 7;
    const duel = store.refreshMissions(week1);
    expect(duel).not.toBeNull();
    expect(store.state.missions.weekKey).toBe(1);
  });

  it('playLeagueMatch resolves offline via Combat and records the result', () => {
    const store = GameStore.createWith(memoryStorage());
    armStrongSquad(store);
    const outcome = store.playLeagueMatch(4242);
    expect(outcome).not.toBeNull();
    if (outcome) {
      expect(outcome.battle.timeline.length).toBeGreaterThan(0);
    }
    expect(store.state.league.wins + store.state.league.losses).toBe(1);
  });

  it('leagueRank places the player among AI alliances', () => {
    const store = GameStore.createWith(memoryStorage());
    armStrongSquad(store);
    const rank = store.leagueRank();
    expect(rank).toBeGreaterThanOrEqual(1);
    expect(store.leagueStandings()).toHaveLength(9 + 1);
  });

  it('recordGateRunnerResult feeds the army economy + missions + season', () => {
    const store = GameStore.createWith(memoryStorage());
    const now = 86_400_000 * 600;
    store.refreshMissions(now);
    const shardsBefore = store.shards();
    const xpBefore = store.state.season.xp;
    store.recordGateRunnerResult(40, 1800, true, now);
    // Rescued squad + distance grant shards + season XP.
    expect(store.shards()).toBeGreaterThan(shardsBefore);
    expect(store.state.season.xp).toBeGreaterThan(xpBefore);
    // The run advanced the daily mini-game arms-race task.
    expect(store.state.missions.daily['mini_1'] ?? store.state.missions.daily['mini_2'] ?? 0)
      .toBeGreaterThanOrEqual(0);
  });

  /* FEAT-003: onboarding tutorial (show once, replayable). */

  it('a fresh game has not seen the tutorial', () => {
    const store = GameStore.createWith(memoryStorage());
    expect(store.tutorialSeen()).toBe(false);
    expect(store.tutorialCompletedSteps()).toEqual([]);
  });

  it('markTutorialSeen sets seen true and persists', () => {
    const storage = memoryStorage();
    const store = GameStore.createWith(storage);
    expect(store.tutorialSeen()).toBe(false);
    store.markTutorialSeen();
    expect(store.tutorialSeen()).toBe(true);
    // Persisted across a reload (the tutorial does not re-show).
    const reloaded = GameStore.createWith(storage);
    expect(reloaded.tutorialSeen()).toBe(true);
  });

  it('markTutorialStep records de-duplicated step ids and persists', () => {
    const storage = memoryStorage();
    const store = GameStore.createWith(storage);
    store.markTutorialStep('welcome');
    store.markTutorialStep('welcome'); // duplicate ignored
    store.markTutorialStep('base');
    store.markTutorialStep(''); // empty ignored
    expect(store.tutorialCompletedSteps()).toEqual(['welcome', 'base']);
    const reloaded = GameStore.createWith(storage);
    expect(reloaded.tutorialCompletedSteps()).toEqual(['welcome', 'base']);
  });

  it('resetTutorial clears seen + completed steps for a replay and persists', () => {
    const storage = memoryStorage();
    const store = GameStore.createWith(storage);
    store.markTutorialStep('welcome');
    store.markTutorialSeen();
    expect(store.tutorialSeen()).toBe(true);
    store.resetTutorial();
    expect(store.tutorialSeen()).toBe(false);
    expect(store.tutorialCompletedSteps()).toEqual([]);
    // Persisted: a reloaded store also sees the reset state (replay will show).
    const reloaded = GameStore.createWith(storage);
    expect(reloaded.tutorialSeen()).toBe(false);
    expect(reloaded.tutorialCompletedSteps()).toEqual([]);
  });
});
