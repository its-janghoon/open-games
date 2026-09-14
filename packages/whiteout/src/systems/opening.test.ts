import { describe, it, expect } from 'vitest';

import { BuildingSystem } from './BuildingSystem';
import { ResourceStore } from './ResourceStore';
import { WarmthSystem } from './WarmthSystem';
import { BUILDING_ORDER } from '../config/BuildingConfig';
import { ECONOMY, WARMTH } from '../config/GameConfig';

/**
 * The first ten minutes have to be completable.
 *
 * This is the gate the coal deadlock got through. Every unit test passed while a
 * real run died about four minutes in: the Furnace burned coal from the first
 * second, coal's only producer was gated behind a Furnace upgrade that itself
 * cost coal, the fuel spend was all-or-nothing so warmth cliffed to zero the
 * moment coal ran out, and warmth throttles production - so the hold could never
 * afford its way out. No single-system test can see that. It only shows up when
 * the economy is actually PLAYED.
 *
 * So this plays it: a greedy strategy that buys whatever it can afford, ticking
 * the real WarmthSystem and BuildingSystem, and asserts the run keeps moving.
 * Not balance - reachability. A run that is merely slow passes; a run that can
 * never act again does not.
 */
describe('whiteout opening is completable', () => {
  const STEP_MS = 1000;
  const MINUTES = 10;

  /** Plays the real API, timers included: startUpgrade then update(now). */
  const play = (seconds: number) => {
    const store = new ResourceStore(ECONOMY.START);
    const buildings = new BuildingSystem([{ kind: 'furnace', level: 1, upgradeEndsAt: null }]);
    const warmth = new WarmthSystem(WARMTH.MAX_WARMTH);
    const built: string[] = [];
    let starvedTicks = 0;
    let now = 0;

    for (let t = 0; t < seconds; t += 1) {
      now += STEP_MS;
      const level = buildings.level('furnace');
      warmth.tick(STEP_MS, level, store);
      store.applyProduction(buildings.productionRates(), STEP_MS, warmth.productionMultiplier(level));
      for (const done of buildings.update(now)) built.push(`${done}:${buildings.level(done)}@${t}s`);

      // Greedy: start the first affordable upgrade when the yard is free.
      let acted = false;
      if (!buildings.firstUpgrading()) {
        for (const kind of BUILDING_ORDER) {
          if (buildings.startUpgrade(kind, store, now).ok) {
            acted = true;
            break;
          }
        }
      } else {
        acted = true;
      }

      // "Starved" means nothing affordable, nothing building, and nothing coming
      // in - the dead end the coal deadlock produced.
      if (!acted) {
        const rates = buildings.productionRates();
        const income = Object.values(rates).reduce((a, b) => a + b, 0);
        if (income <= 0) starvedTicks += 1;
        else starvedTicks = 0;
      }
    }
    return { store, buildings, warmth, built, starvedTicks };
  };

  it('never reaches a state with nothing affordable and no income', () => {
    const { starvedTicks } = play(60 * MINUTES);
    expect(starvedTicks).toBe(0);
  });

  it('gets a coal producer standing before the starting coal runs out', () => {
    // The exact shape of the original deadlock: coal is spent from second one and
    // has no source until the Coal Pit, so if the run cannot stand one up in
    // time it is over. With timber-only fuel at level 1 the starting 100 coal is
    // preserved for the Sawmill (20) and the Furnace upgrade (60).
    const { built, store } = play(60 * MINUTES);
    const coalPit = built.find((b) => b.startsWith('coal_pit:1@'));
    expect(coalPit, `coal pit never built; sequence was ${built.slice(0, 12).join(', ')}`).toBeDefined();
    expect(store.get('coal')).toBeGreaterThan(0);
  });

  it('ends the window warmer than freezing, with fuel still coming in', () => {
    const { warmth, buildings } = play(60 * MINUTES);
    const level = buildings.level('furnace');
    expect(warmth.warmth).toBeGreaterThan(0);
    // Production must out-pace the Furnace, or the run is only postponing death.
    const burn = warmth.fuelPerSecond(level);
    const rates = buildings.productionRates();
    expect(rates.wood).toBeGreaterThan(burn.wood);
    if (burn.coal > 0) expect(rates.coal).toBeGreaterThan(burn.coal);
  });
});
