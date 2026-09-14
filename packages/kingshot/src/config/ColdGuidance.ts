import { WARMTH } from './GameConfig';
import { buildingDef, outputPerSec } from './BuildingConfig';
import type { BuildingKind } from '../types';

/**
 * Which warning a cold keep should be shown.
 *
 * Split out of TownScene as a pure function because the choice is logic, not
 * drawing, and because the bug it fixes was invisible to every test: a keep with no
 * firewood and no Lumber Mill was told '화롯불 꺼져감! 목재 확보' - secure firewood -
 * which is exactly what it cannot do. A player reading that concludes the game is
 * broken, and the only reason they are wrong is a rescue mechanism the text never
 * mentions.
 *
 * The keep is not stuck: the phase-0 rescue put a gather floor on RATIONS and STONE,
 * neither of which the hearth burns, precisely so there is always a way back. That
 * way is the Lumber Mill, which costs rations and stone and no firewood. So when the
 * keep cannot make firewood, the warning names the Lumber Mill instead.
 */

/** The building that restores the hearth's fuel supply. */
export const FUEL_PRODUCER: BuildingKind = 'lumber_mill';

/**
 * True when the keep can no longer produce the resource the hearth burns.
 *
 * A check on PRODUCTION, not on the stockpile: a keep with 3 firewood left and no
 * Lumber Mill is in the same trap a few seconds earlier, and 'secure firewood' is
 * equally useless advice to it.
 */
export function cannotMakeFuel(levels: Partial<Record<BuildingKind, number>>): boolean {
  return (levels[FUEL_PRODUCER] ?? 0) < 1;
}

/** The warning key for a cold keep, given which buildings stand. */
export function coldWarningKey(
  levels: Partial<Record<BuildingKind, number>>,
): 'town.warmthLow' | 'town.warmthStranded' {
  return cannotMakeFuel(levels) ? 'town.warmthStranded' : 'town.warmthLow';
}

/** The spoken hint that accompanies the warning. */
export function coldHintKey(
  levels: Partial<Record<BuildingKind, number>>,
): 'town.warmthLowHint' | 'town.warmthStrandedHint' {
  return cannotMakeFuel(levels) ? 'town.warmthStrandedHint' : 'town.warmthLowHint';
}

/**
 * Whether the advice is honest: the building it names must cost nothing the hearth
 * burns, and must actually produce that fuel. Exported so a test pins the
 * relationship rather than the wording - if someone later prices the Lumber Mill in
 * firewood, the advice silently becomes impossible again.
 */
export function fuelAdviceIsActionable(): boolean {
  const cost = buildingDef(FUEL_PRODUCER).baseCost as Record<string, number | undefined>;
  for (const fuel of Object.keys(WARMTH.FUEL_PER_SECOND)) {
    if ((cost[fuel] ?? 0) > 0) return false;
  }
  return outputPerSec(FUEL_PRODUCER, 1) > 0;
}
