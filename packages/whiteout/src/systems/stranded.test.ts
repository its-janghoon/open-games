import { describe, it, expect } from 'vitest';

import {
  currentObjective,
  cannotMakeFuel,
  LOW_WARMTH_ADVISORY_RATIO,
  STRANDED_ADVISORY,
  WARMTH_ADVISORY,
  type ObjectiveView,
} from './ObjectiveSystem';
import { tr } from '../i18n/i18n';
import { buildingDef, outputPerSec } from '../config/BuildingConfig';
import { WARMTH } from '../config/GameConfig';

/**
 * A cold hold with no timber producer was told to "keep timber and coal stocked and
 * upgrade the Furnace". Every part of that needs timber, which is precisely what it
 * does not have, so a player reading it concludes the game is broken - and the only
 * reason they are wrong is a rescue mechanism the text never mentions.
 *
 * These tests pin that the guidance names an action the player can actually take.
 */
const view = (over: Partial<ObjectiveView> = {}): ObjectiveView => ({
  furnaceLevel: 1,
  levels: {},
  warmthRatio: 1,
  armySize: 0,
  battleFought: false,
  ...over,
});

describe('stranded guidance', () => {
  it('names the Sawmill when the hold is cold and cannot make timber', () => {
    const objective = currentObjective(view({ warmthRatio: 0, levels: {} }));
    expect(objective?.id).toBe('stranded');
    expect(objective?.target).toBe('sawmill');
  });

  it('does NOT give the impossible advice in that state', () => {
    const objective = currentObjective(view({ warmthRatio: 0, levels: {} }));
    // The old text is the defect. It must not be what a stranded hold is shown.
    expect(objective?.instruction).not.toBe(WARMTH_ADVISORY.instruction);
  });

  it('still gives ordinary warmth advice once a producer stands', () => {
    const objective = currentObjective(view({ warmthRatio: 0, levels: { sawmill: 1 } }));
    expect(objective?.id).toBe('warmth');
  });

  it('treats a trickle of timber with no producer as stranded, not as stocked', () => {
    // A hold with a few timber left and no Sawmill is in the same trap, a few
    // seconds earlier, so the condition is on PRODUCTION rather than stock.
    expect(cannotMakeFuel(view({ levels: {} }))).toBe(true);
    expect(cannotMakeFuel(view({ levels: { sawmill: 1 } }))).toBe(false);
    expect(cannotMakeFuel(view({ levels: { hunters_hut: 1 } }))).toBe(true);
  });

  it('clears itself once the Sawmill is built', () => {
    expect(STRANDED_ADVISORY.isComplete(view({ levels: {} }))).toBe(false);
    expect(STRANDED_ADVISORY.isComplete(view({ levels: { sawmill: 1 } }))).toBe(true);
  });

  it('does not fire while the hold is warm', () => {
    const objective = currentObjective(view({ warmthRatio: 1, levels: {} }));
    expect(objective?.id).not.toBe('stranded');
    const edge = currentObjective(view({ warmthRatio: LOW_WARMTH_ADVISORY_RATIO, levels: {} }));
    expect(edge?.id).toBe('stranded');
  });

  it('has real text in both locales, not a fallback of the key', () => {
    for (const key of [STRANDED_ADVISORY.label, STRANDED_ADVISORY.instruction]) {
      const text = tr(key);
      // The failure this catches is a missing entry, where tr() returns the key
      // itself. Length is only a sanity floor - the Korean label '목재가 없습니다'
      // is 8 characters, so anything stricter fails on a correct translation.
      expect(text).not.toBe(key);
      expect(text.trim().length).toBeGreaterThan(3);
      expect(text).not.toContain('objective.');
    }
  });

  it('points at a building the stranded hold can actually afford', () => {
    // The advice is only honest if the Sawmill costs nothing the Furnace burns.
    const cost = buildingDef('sawmill').baseCost;
    const fuels = Object.keys(WARMTH.FUEL_PER_SECOND);
    for (const fuel of fuels) {
      expect(
        (cost as Record<string, number | undefined>)[fuel] ?? 0,
        `the Sawmill costs ${fuel}, which the Furnace burns - the advice would be impossible again`,
      ).toBe(0);
    }
    // And it has to actually produce the fuel, or building it changes nothing.
    expect(outputPerSec('sawmill', 1)).toBeGreaterThan(0);
  });
});
