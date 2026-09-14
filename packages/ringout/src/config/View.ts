import { RING } from '../game/fightState';
import { GAME_WIDTH } from './GameConfig';

/**
 * The world-to-screen transform, and the ring's on-screen furniture.
 *
 * Kept out of the scene and pure so it can be tested without booting Phaser. The scene should contain
 * as little arithmetic as possible: every number the renderer decides is a number that cannot be
 * checked in a unit test once it lives inside a `create()`.
 *
 * Fight coordinates have x = 0 at the centre of the ring and y counting UP from the floor, because
 * that is what the simulation finds natural. Screen coordinates have y counting DOWN from the top,
 * because that is what Phaser uses. The flip lives here, once.
 */

/** Where the floor line sits on screen. Leaves room above for the hp bars. */
export const FLOOR_SCREEN_Y = 452;

/** Fight units per screen pixel. 1 keeps the maths readable and the fighters a sensible size. */
export const WORLD_SCALE = 1;

export interface ScreenPoint {
  x: number;
  y: number;
}

export function worldToScreen(x: number, y: number): ScreenPoint {
  return {
    x: GAME_WIDTH / 2 + x * WORLD_SCALE,
    y: FLOOR_SCREEN_Y - y * WORLD_SCALE,
  };
}

/**
 * The ring's edges in screen space.
 *
 * Drawn, not implied. A fighter loses by leaving the ring, so the boundary that decides the match has
 * to be visible — a player who cannot see the edge cannot avoid it, and losing to an invisible rule
 * reads as the game cheating.
 */
export function ringEdges(): { left: number; right: number } {
  return {
    left: worldToScreen(-RING.halfWidth, 0).x,
    right: worldToScreen(RING.halfWidth, 0).x,
  };
}

/**
 * Colours. A flat palette, because the whole game is untextured geometry: with no art to carry
 * legibility, contrast between the two fighters and the background is the only thing that does.
 */
export const PALETTE = {
  background: 0x0b0f1c,
  floor: 0x1e2a4a,
  edge: 0xff5470,
  fighterLeft: 0x5ad1ff,
  fighterRight: 0xffc45a,
  strikingLimb: 0xffffff,
  hpTrack: 0x1a2340,
  hpFill: 0x69ffa8,
  hpLow: 0xff5470,
  hitbox: 0xff5470,
} as const;

export const LIMB_WIDTH = 7;
export const TORSO_WIDTH = 11;

/** hp bar geometry, kept here so the layout is testable rather than buried in a draw call. */
export const HP_BAR = {
  width: 340,
  height: 16,
  margin: 26,
  top: 24,
} as const;

export function hpBarRect(side: 'left' | 'right'): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: side === 'left' ? HP_BAR.margin : GAME_WIDTH - HP_BAR.margin - HP_BAR.width,
    y: HP_BAR.top,
    width: HP_BAR.width,
    height: HP_BAR.height,
  };
}

/**
 * How much of an hp bar to fill, and which colour.
 *
 * The fill drains from the CENTRE outwards for the right-hand fighter, so both bars empty towards
 * the screen edges. A bar that drains left-to-right on both sides makes the right player read their
 * own health backwards under pressure.
 */
export function hpFillRect(
  side: 'left' | 'right',
  hp: number,
): { x: number; y: number; width: number; height: number; color: number } {
  const track = hpBarRect(side);
  const fraction = Math.max(0, Math.min(1, hp / RING.maxHp));
  const width = track.width * fraction;
  return {
    x: side === 'left' ? track.x : track.x + (track.width - width),
    y: track.y,
    width,
    height: track.height,
    color: fraction <= 0.25 ? PALETTE.hpLow : PALETTE.hpFill,
  };
}
