import { describe, it, expect } from 'vitest';

import { GameStore } from './GameStore';
import type { ResourceBag } from '../types';
import type { KeyValueStorage } from './SaveManager';
import {
  TUTORIAL_STEPS,
  firstStep,
  isLastStep,
  nextStep,
  totalSteps,
} from './Tutorial';
import { BUILDING_ORDER } from '../config/GameConfig';

/**
 * The first ten minutes have to be completable.
 *
 * Third in the series after Frosthold and Kingdom Rise, where the same
 * simulation found real deadlocks that every per-system test had passed: a
 * resource that was mandatory from the first second but unmakeable until an
 * upgrade that itself cost it, and an emptied base with no affordable action and
 * no income. Neither is visible until the economy is PLAYED.
 *
 * A correction is recorded here too, because it shaped what this file asserts.
 * Earlier in this work I reported that LAST SQUAD traps the player: HomeScene
 * started and the scene list came back as [TitleScene, TutorialScene], so the hub
 * looked gone. It is not. TutorialScene is launched with scene.launch ON TOP of
 * the hub, which is PAUSED underneath - and a paused scene does not appear in
 * getScenes(true), so the reading was an artefact of how I measured. The overlay
 * carries a skip button and its finish() resumes the hub before stopping itself.
 * So the assertion below is about the tutorial TERMINATING, not about escaping a
 * trap that does not exist.
 */
describe('lastwar opening is completable', () => {
  const STEP_MS = 1000;
  const MINUTES = 10;

  /** GameStore's constructor is private; tests build it with injected storage. */
  const memoryStorage = (): KeyValueStorage => {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
  };

  /** Sum a ResourceBag without letting its values widen to unknown. */
  const total = (bag: ResourceBag): number =>
    Object.values(bag).reduce<number>((sum, v) => sum + (typeof v === 'number' ? v : 0), 0);

  const play = (seconds: number) => {
    const store = GameStore.createWith(memoryStorage());
    const built: string[] = [];
    let starvedTicks = 0;
    let now = 0;

    for (let t = 0; t < seconds; t += 1) {
      now += STEP_MS;
      store.tick(now);

      let acted = false;
      for (const id of BUILDING_ORDER) {
        if (store.tryStartUpgrade(id, now)) {
          built.push(`${id}:${store.buildingLevel(id) + 1}@${t}s`);
          acted = true;
          break;
        }
      }

      if (!acted) {
        const income = total(store.productionRates());
        if (income <= 0) starvedTicks += 1;
        else starvedTicks = 0;
      }
    }
    return { store, built, starvedTicks };
  };

  it('never reaches a state with nothing affordable and no income', () => {
    const { starvedTicks, built } = play(60 * MINUTES);
    expect(starvedTicks, `stalled; sequence was ${built.slice(0, 12).join(', ')}`).toBe(0);
  });

  it('earns something over the window rather than standing still', () => {
    const before = GameStore.createWith(memoryStorage()).resources();
    const { store } = play(60 * MINUTES);
    const after = store.resources();
    const grew = Object.keys(after).some(
      (k) => (after[k as keyof typeof after] ?? 0) > (before[k as keyof typeof before] ?? 0),
    );
    expect(grew, `nothing grew in ${MINUTES} minutes: ${JSON.stringify(after)}`).toBe(true);
  });

  it('has a tutorial that terminates, so the hub is always reachable', () => {
    // Walking the steps must reach a last one. An overlay that could not finish
    // WOULD be the trap I mistakenly reported, so this pins the property.
    expect(totalSteps()).toBeGreaterThan(0);
    expect(TUTORIAL_STEPS.length).toBe(totalSteps());

    let step = firstStep();
    let walked = 1;
    while (!isLastStep(step.id) && walked <= TUTORIAL_STEPS.length + 1) {
      const next = nextStep(step.id);
      expect(next, `step ${step.id} has no successor but is not the last`).not.toBeNull();
      step = next!;
      walked += 1;
    }
    expect(isLastStep(step.id)).toBe(true);
    expect(walked).toBe(TUTORIAL_STEPS.length);
  });
});
