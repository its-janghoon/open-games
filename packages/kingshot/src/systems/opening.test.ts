import { describe, it, expect } from 'vitest';

import { BuildingSystem } from './BuildingSystem';
import { ResourceStore } from './ResourceStore';
import { WarmthSystem } from './WarmthSystem';
import { BUILDING_ORDER } from '../config/BuildingConfig';
import { ECONOMY, WARMTH } from '../config/GameConfig';
import type { Resources } from '../types';

/**
 * The first ten minutes have to be completable.
 *
 * The sibling of whiteout's opening test, and written for the same reason: a
 * deadlock built out of two individually-correct systems is invisible to every
 * per-system test and only shows up when the economy is actually PLAYED. In
 * whiteout that simulation contradicted a fix I had already reasoned through
 * arithmetically and believed was done.
 *
 * Kingdom Rise is NOT the same trap, and it is worth recording why rather than
 * assuming symmetry. Its fuel is a single resource (firewood), and the building
 * that produces firewood costs food and stone rather than firewood, so there is
 * no circular dependency of the kind that stranded Frosthold - where coal was
 * mandatory from the first second, unmakeable until an upgrade, and that upgrade
 * cost coal. What the two DO share is an all-or-nothing fuel spend, so the
 * question this answers is whether the hold can be pushed into a state it has no
 * way out of.
 */
describe('kingshot opening is completable', () => {
  const STEP_MS = 1000;
  const MINUTES = 10;

  const play = (seconds: number, start: Partial<Resources> = ECONOMY.START) => {
    const store = new ResourceStore(start);
    const buildings = new BuildingSystem([{ kind: 'town_center', level: 1, upgradeEndsAt: null }]);
    const warmth = new WarmthSystem(WARMTH.MAX_WARMTH);
    const built: string[] = [];
    let starvedTicks = 0;
    let now = 0;

    for (let t = 0; t < seconds; t += 1) {
      now += STEP_MS;
      const level = buildings.level('town_center');
      warmth.tick(STEP_MS, level, store);
      store.applyProduction(buildings.productionRates(), STEP_MS, warmth.productionMultiplier(level));
      for (const done of buildings.update(now)) built.push(`${done}:${buildings.level(done)}@${t}s`);

      let acted = false;
      // kingshot's BuildingSystem exposes isUpgrading(kind) rather than a
      // whole-yard query, so ask across the order.
      const busy = BUILDING_ORDER.some((k) => buildings.isUpgrading(k));
      if (!busy) {
        for (const kind of BUILDING_ORDER) {
          if (buildings.startUpgrade(kind, store, now).ok) {
            acted = true;
            break;
          }
        }
      } else {
        acted = true;
      }

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
    const { starvedTicks, built } = play(60 * MINUTES);
    expect(starvedTicks, `stalled; sequence was ${built.slice(0, 12).join(', ')}`).toBe(0);
  });

  it('stands up a firewood producer and out-paces the Town Center burn', () => {
    const { built, buildings, warmth } = play(60 * MINUTES);
    expect(
      built.find((b) => b.startsWith('lumber_mill:1@')),
      `no lumber mill; sequence was ${built.slice(0, 12).join(', ')}`,
    ).toBeDefined();
    const burn = warmth.fuelPerSecond(buildings.level('town_center'));
    expect(buildings.productionRates().wood).toBeGreaterThan(burn.wood);
  });

  it('recovers from an empty stockpile rather than stalling forever', () => {
    // The dead-end probe: nothing but a Town Center and nothing in the store. If
    // the hold cannot climb out of this, a real run that overspends is finished.
    const { starvedTicks, built } = play(60 * MINUTES, { food: 0, wood: 0, stone: 0, gold: 0 });
    expect(
      starvedTicks,
      `stranded from empty; sequence was ${built.slice(0, 8).join(', ') || '(nothing built)'}`,
    ).toBe(0);
  });
});
