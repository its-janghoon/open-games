import { CANVAS } from './GameConfig';
import type { BuildingKind } from '../types';

/**
 * Where the town map may draw, and where each building stands.
 *
 * The HUD is drawn in screen space over the map, so the map does NOT get the
 * whole 960x540 band. Measured against the real scene, the chrome reserves:
 *
 *   top     0..44   the resource bar (a full-width 44px panel at the origin)
 *          44..70   the warmth gauge row
 *          73..119  the hint panel (a 460x46 card centred at y=96)
 *         128..172  the objective banner strip
 *   bottom 488..532 the navigation row (buttons centred at CANVAS.HEIGHT-30,
 *                   whose height floor is 44)
 *
 * so the map's usable band is SAFE_TOP..SAFE_BOTTOM. This mattered because the
 * building layout did not respect it: the lowest sprites reached y=518 while the
 * nav row starts at 488, which is why the bottom of the town looked cut off.
 * Nothing was off-screen - the lowest edge was 518 of 540, comfortably inside
 * the canvas - it was COVERED. Panning the map, the obvious reading of "the
 * bottom is not visible", would have hidden that defect instead of fixing it.
 */
export const SAFE_AREA = {
  /** Lowest y the top HUD occupies; the map starts below this. */
  TOP: 172,
  /** Highest y the map may reach before the bottom navigation row. */
  BOTTOM: 488,
  /** Breathing room kept between the lowest sprite edge and BOTTOM. */
  MARGIN: 8,
} as const;

/**
 * Vertical space a building's level badge needs ABOVE its sprite's top edge.
 *
 * This exists because the safe area guaranteed the wrong thing. It kept every
 * SPRITE below TOP, and the badge is deliberately placed above its sprite so a
 * tall chimney cannot occlude it - so the badge was never covered by the promise.
 * Measured on the running game, 'Level 1' sat at y=165 with SAFE_AREA.TOP at 172
 * and collided with the objective banner, which had grown to two lines when its
 * wrap was fixed.
 *
 * The value is the scene's own badge geometry: a 12px gap above the sprite, plus
 * half the badge's rendered height. Korean at 12px measures about 20px tall - the
 * kingshot HUD fix established that this face runs taller than a Latin one at the
 * same size, 30px at 18px bold - so 12 is the safe half-height, not 8.
 */
export const LABEL_RESERVE = 12 + 12;

/** Usable vertical band for world content, derived from the reserved bands. */
export const SAFE_HEIGHT = SAFE_AREA.BOTTOM - SAFE_AREA.TOP;

/**
 * Fixed layout position for each building sprite on the town map.
 *
 * Lives here rather than inside TownScene so the safe-area invariant can be
 * asserted in a unit test without pulling Phaser into node.
 *
 * The lower half was lifted to fit SAFE_AREA: the 400 row to 388, the War Camp
 * from 420 to 404, and the bottom row from 470/480 to 428/438. Rows overlapping
 * each other slightly is intended - it is a town seen from above - but a sprite
 * disappearing under the navigation bar is not.
 */
export const BUILDING_LAYOUT: Record<BuildingKind, { x: number; y: number; scale: number }> = {
  // Lowered from 250 to 262. The sprite always cleared SAFE_AREA.TOP; its level
  // badge did not, because the badge is drawn 12px above the sprite and nothing
  // asserted that. At 250 the badge's top edge landed at 162 against a TOP of 172
  // and met the objective banner, which grew to two lines when its wrap was fixed.
  furnace: { x: 480, y: 262, scale: 2.0 },
  hunters_hut: { x: 250, y: 300, scale: 1.8 },
  sawmill: { x: 700, y: 300, scale: 1.8 },
  coal_pit: { x: 170, y: 388, scale: 1.8 },
  iron_mine: { x: 790, y: 388, scale: 1.8 },
  war_camp: { x: 480, y: 404, scale: 1.9 },
  // FEAT-002 expanded city. Positions are laid out for when the art feature
  // adds their sprites; until a texture exists they are not rendered (the
  // buildBuildings loop skips any kind without a registered texture).
  shelter_row: { x: 330, y: 388, scale: 1.7 },
  frost_vault: { x: 620, y: 388, scale: 1.7 },
  forge_hall: { x: 380, y: 250, scale: 1.7 },
  envoy_hall: { x: 580, y: 250, scale: 1.7 },
  warming_ward: { x: 250, y: 428, scale: 1.6 },
  ember_archive: { x: 710, y: 428, scale: 1.6 },
  infantry_yard: { x: 400, y: 428, scale: 1.6 },
  lancer_yard: { x: 480, y: 438, scale: 1.6 },
  marksman_range: { x: 560, y: 428, scale: 1.6 },
};

/** Sanity: the reserved bands must leave a usable map band inside the canvas. */
export const SAFE_AREA_IS_SANE =
  SAFE_AREA.TOP > 0 && SAFE_AREA.BOTTOM > SAFE_AREA.TOP && SAFE_AREA.BOTTOM <= CANVAS.HEIGHT;
