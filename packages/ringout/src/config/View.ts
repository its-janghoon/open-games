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

export interface CameraFrame {
  centerX: number;
  zoom: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Project a world point to the screen, through a camera frame.
 *
 * The frame is applied HERE rather than by moving Phaser's camera, and that is the second attempt.
 * Zooming the real camera was measured and rejected: at zoom 3.2 the camera's visible band is only
 * 540 / 3.2 = 169 screen pixels tall, so centring it anywhere sensible put the floor line — fixed at
 * y 452 — outside the view, and the fighters were drawn cut off at the bottom with their feet gone. The
 * HUD went with it, because a scroll-factor-zero object is still scaled by zoom.
 *
 * Projecting instead keeps ONE coordinate system and one place where framing happens. The floor stays
 * anchored at a fixed screen line whatever the zoom, so fighters grow upward from the ground rather
 * than drifting, and the HUD is drawn in plain screen coordinates that nothing transforms.
 */
export function project(x: number, y: number, frame: CameraFrame): ScreenPoint {
  return {
    x: GAME_WIDTH / 2 + (x - frame.centerX) * frame.zoom,
    y: FLOOR_SCREEN_Y - y * frame.zoom,
  };
}

/** The identity frame: no pan, no zoom. Used by the base-transform tests and by the ring furniture. */
export const IDENTITY_FRAME: CameraFrame = { centerX: 0, zoom: 1 };

export function worldToScreen(x: number, y: number): ScreenPoint {
  return project(x, y, IDENTITY_FRAME);
}

/**
 * The ring's edges in screen space.
 *
 * Drawn, not implied. A fighter loses by leaving the ring, so the boundary that decides the match has
 * to be visible — a player who cannot see the edge cannot avoid it, and losing to an invisible rule
 * reads as the game cheating.
 */
export function ringEdges(frame: CameraFrame = IDENTITY_FRAME): { left: number; right: number } {
  return {
    left: project(-RING.halfWidth, 0, frame).x,
    right: project(RING.halfWidth, 0, frame).x,
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

/**
 * Camera framing.
 *
 * The renderer's first version drew at a 1:1 world scale and the fighters came out at roughly 14% of
 * frame height — a screenshot made that obvious in a way no assertion had. The tempting fix is to
 * shrink the world, and it is wrong: the balance numbers are written in world units, so a ring small
 * enough to fill the frame would be crossed at walk speed in about 0.6 seconds. The world is the
 * right size; the CAMERA was wrong.
 *
 * So the framing follows the fight. Zoom comes from the fighters' separation, which is what a
 * fighting-game camera does and for a concrete reason: at close range the interesting information is
 * limbs and spacing, and at long range it is where the two bodies are relative to the edges.
 */
export const CAMERA = {
  /** Closest allowed framing. Beyond this a fighter fills the screen and spacing becomes unreadable. */
  maxZoom: 3.2,
  /** World units of clearance kept outside the pair, so neither sits against the frame edge. */
  padding: 50,
} as const;

/**
 * Widest allowed framing, DERIVED from the ring rather than picked.
 *
 * "Both fighters are always on screen" is a hard requirement in a fighting game — a player cannot react
 * to someone they cannot see — so it must not depend on two constants happening to agree. Computing the
 * floor from the ring's own width makes it structural: widen the ring and the camera widens with it,
 * and the invariant cannot be broken by editing one number.
 */
export const MIN_ZOOM = GAME_WIDTH / (RING.halfWidth * 2 + CAMERA.padding * 2);

/**
 * Centre between the fighters and zoom to fit them, clamped.
 *
 * Clamped at BOTH ends deliberately. Without an upper bound two fighters standing on the same spot
 * would zoom to infinity; without the derived lower bound a pair at opposite edges would zoom out past
 * the point where anything is legible, which is the state this function exists to eliminate.
 */
export function cameraFor(positions: readonly number[]): CameraFrame {
  if (positions.length === 0) return { centerX: 0, zoom: MIN_ZOOM };
  const min = Math.min(...positions);
  const max = Math.max(...positions);
  const centerX = (min + max) / 2;
  const needed = max - min + CAMERA.padding * 2;
  const zoom = GAME_WIDTH / Math.max(1, needed);
  return {
    centerX,
    zoom: Math.min(CAMERA.maxZoom, Math.max(MIN_ZOOM, zoom)),
  };
}

/**
 * The world-x range the camera can actually see at a given frame.
 *
 * Exists so a test can assert that both fighters are on screen without duplicating the projection
 * arithmetic — the two would drift apart and the test would stop meaning anything.
 */
export function visibleWorldRange(frame: CameraFrame): { left: number; right: number } {
  const halfWidth = GAME_WIDTH / 2 / frame.zoom;
  return { left: frame.centerX - halfWidth, right: frame.centerX + halfWidth };
}

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
