import { describe, it, expect } from 'vitest';

import {
  FUEL_PRODUCER,
  cannotMakeFuel,
  coldHintKey,
  coldWarningKey,
  fuelAdviceIsActionable,
} from './ColdGuidance';
import { WARMTH } from './GameConfig';
import { buildingDef } from './BuildingConfig';
import { tr } from '../i18n/i18n';

/**
 * A cold keep with no Lumber Mill was told to secure firewood, which is precisely
 * what it has no way to do. These tests pin that the warning names an action the
 * player can actually take, and that the action stays possible.
 */
describe('cold guidance', () => {
  it('names the Lumber Mill when the keep cannot make firewood', () => {
    expect(coldWarningKey({ town_center: 1 })).toBe('town.warmthStranded');
    expect(coldHintKey({ town_center: 1 })).toBe('town.warmthStranded' + 'Hint');
  });

  it('gives the ordinary stock-it warning once a Lumber Mill stands', () => {
    expect(coldWarningKey({ town_center: 1, lumber_mill: 1 })).toBe('town.warmthLow');
    expect(coldHintKey({ town_center: 1, lumber_mill: 1 })).toBe('town.warmthLowHint');
  });

  it('keys off production, not stock: a farm does not solve a firewood drought', () => {
    expect(cannotMakeFuel({ farm: 3, quarry: 2 })).toBe(true);
    expect(cannotMakeFuel({ lumber_mill: 1 })).toBe(false);
  });

  it('names a building the stranded keep can actually afford', () => {
    // The advice is only honest while the Lumber Mill costs nothing the hearth
    // burns. If someone prices it in firewood later, this fails rather than the
    // player silently getting impossible advice again.
    expect(fuelAdviceIsActionable()).toBe(true);
    const cost = buildingDef(FUEL_PRODUCER).baseCost as Record<string, number | undefined>;
    for (const fuel of Object.keys(WARMTH.FUEL_PER_SECOND)) {
      expect(cost[fuel] ?? 0, `${FUEL_PRODUCER} costs ${fuel}, which the hearth burns`).toBe(0);
    }
  });

  it('has real text in both locales rather than falling back to the key', () => {
    for (const key of ['town.warmthStranded', 'town.warmthStrandedHint'] as const) {
      const text = tr(key);
      expect(text).not.toBe(key);
      expect(text).not.toContain('town.');
      expect(text.trim().length).toBeGreaterThan(3);
    }
  });

  it('rescues through resources the hearth does not burn', () => {
    // The whole reason the advice can be honest: the gather floor is on non-fuel
    // resources, so a keep with nothing still accumulates what the Lumber Mill costs.
    const floors = Object.keys(WARMTH.BASELINE_GATHER_PER_SEC);
    const fuels = Object.keys(WARMTH.FUEL_PER_SECOND);
    for (const fuel of fuels) {
      expect(floors, 'a floor on the fuel makes the keep unfreezable').not.toContain(fuel);
    }
    const cost = buildingDef(FUEL_PRODUCER).baseCost as Record<string, number | undefined>;
    for (const res of Object.keys(cost)) {
      expect(floors, `${res} is needed for the Lumber Mill but is not gathered`).toContain(res);
    }
  });
});
