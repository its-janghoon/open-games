import { GRID, GRID_SIZE, type Player } from './gridWorld';

/**
 * The ray march, as pure arithmetic with no renderer in it.
 *
 * Kept out of the scene for the reason ringout's View module was: a number decided inside a Phaser
 * `create()` cannot be checked by anything. Here that matters more than usual, because a DDA divides by a
 * direction component, and a ray fired exactly along an axis makes one of those components zero. That is
 * the classic way a raycaster produces a NaN distance, and a NaN draws as nothing while comparing as
 * neither greater nor less than any threshold — so it is invisible in the picture AND invisible to a naive
 * assertion. The sweep test exists for exactly that.
 */

export interface Hit {
  /** Distance along the ray to the wall face, in tiles. Never negative, never NaN. */
  distance: number;
  /**
   * Which face was struck: 'x' for a vertical face (a wall on the east or west of a tile), 'y' for a
   * horizontal one.
   *
   * Carried so the renderer can shade the two differently. Without it every wall in the scene is the same
   * flat colour and a corner becomes invisible — the geometry is correct and the picture is unreadable,
   * which is the failure mode of an untextured raycaster.
   */
  side: 'x' | 'y';
  /** True when the ray ran out of grid before hitting anything. */
  missed: boolean;
}

/** Longest a ray will travel before giving up, in tiles. The grid diagonal, so it cannot fall short. */
export const MAX_DISTANCE = GRID_SIZE * 2;

/**
 * March one ray through the grid and report the first wall it meets.
 *
 * Digital differential analysis: step tile to tile, always crossing whichever axis boundary is nearer,
 * which visits every tile the ray passes through and no others. Cheaper and exact where sampling along the
 * ray at fixed intervals is both slower and able to step over a thin wall.
 */
export function castColumn(originX: number, originY: number, dirX: number, dirY: number): Hit {
  let tileX = Math.floor(originX);
  let tileY = Math.floor(originY);

  /**
   * Distance the ray covers per unit of x (and y).
   *
   * The zero-direction branches are EXPLICITNESS, not a NaN fix, and the comment here originally claimed
   * otherwise. Removing all four of them failed every test, including a sweep of integer-boundary origins
   * and tiny-magnitude directions written specifically to catch it, so the claim was checked and withdrawn.
   *
   * Why the NaN cannot arise: 1/0 is Infinity in JavaScript, so the delta is Infinity rather than an error,
   * and a NaN would need 0 * Infinity. The offset that multiplies it is `originX - tileX` only on the
   * `dirX < 0` branch — and that branch excludes dirX === 0, which is the only way the delta is Infinity.
   * On the other branch the offset is `tileX + 1 - originX`, which cannot be zero because tileX is
   * floor(originX). The two conditions are mutually exclusive.
   *
   * They stay because `Infinity` written out says "this ray never crosses an x boundary" more plainly than
   * relying on IEEE division semantics, and because the sweep test proves finiteness with or without them.
   * What is NOT claimed any more is that they are load-bearing.
   */
  const deltaX = dirX === 0 ? Infinity : Math.abs(1 / dirX);
  const deltaY = dirY === 0 ? Infinity : Math.abs(1 / dirY);

  const stepX = dirX < 0 ? -1 : 1;
  const stepY = dirY < 0 ? -1 : 1;

  let sideDistX =
    dirX === 0
      ? Infinity
      : (dirX < 0 ? originX - tileX : tileX + 1 - originX) * deltaX;
  let sideDistY =
    dirY === 0
      ? Infinity
      : (dirY < 0 ? originY - tileY : tileY + 1 - originY) * deltaY;

  let side: 'x' | 'y' = 'x';
  let distance = 0;

  // Bounded by the grid diagonal rather than `while (true)`. A ray that somehow escapes the grid must
  // terminate as a miss, not spin the frame.
  for (let guard = 0; guard < GRID_SIZE * 4; guard += 1) {
    if (sideDistX < sideDistY) {
      distance = sideDistX;
      sideDistX += deltaX;
      tileX += stepX;
      side = 'x';
    } else {
      distance = sideDistY;
      sideDistY += deltaY;
      tileY += stepY;
      side = 'y';
    }

    if (tileX < 0 || tileY < 0 || tileX >= GRID_SIZE || tileY >= GRID_SIZE) {
      return { distance: MAX_DISTANCE, side, missed: true };
    }
    if (GRID[tileY * GRID_SIZE + tileX] === 1) {
      return { distance, side, missed: false };
    }
    if (distance > MAX_DISTANCE) break;
  }
  return { distance: MAX_DISTANCE, side, missed: true };
}

export interface Column {
  distance: number;
  side: 'x' | 'y';
  missed: boolean;
}

export const DEFAULT_FOV = Math.PI / 3;

/**
 * Cast one ray per screen column.
 *
 * Rays are spread across the CAMERA PLANE, not by rotating through equal angles. Equal angles is the
 * intuitive version and it is wrong: it makes a flat wall bulge, because a column at the edge of the view
 * is further from the eye than one at the centre by the secant of its angle. Spreading along a straight
 * plane in front of the player produces the perpendicular distance directly, so a flat wall reads flat with
 * no correction step afterwards. There is a test that a flat wall returns a constant distance across
 * columns, which is the property this buys.
 */
export function castView(
  player: Pick<Player, 'x' | 'y' | 'angle'>,
  columnCount: number,
  fov: number = DEFAULT_FOV,
): Column[] {
  const dirX = Math.cos(player.angle);
  const dirY = Math.sin(player.angle);
  // The camera plane is perpendicular to the facing, scaled so its half-width subtends fov/2.
  const planeScale = Math.tan(fov / 2);
  const planeX = -dirY * planeScale;
  const planeY = dirX * planeScale;

  const columns: Column[] = [];
  for (let i = 0; i < columnCount; i += 1) {
    // -1 at the left edge, +1 at the right. Using the column CENTRE avoids a half-column bias that makes
    // the view sit slightly off-axis from where the player is actually pointing.
    const offset = columnCount === 1 ? 0 : ((i + 0.5) / columnCount) * 2 - 1;
    const rayX = dirX + planeX * offset;
    const rayY = dirY + planeY * offset;
    const hit = castColumn(player.x, player.y, rayX, rayY);
    /**
     * The DDA distance is measured in units of the ray vector, and the ray vector is longer than one for an
     * off-centre column — that is precisely what makes the plane spread work. Dividing by nothing here and
     * multiplying by the ray length would reintroduce the fisheye; leaving it as-is IS the perpendicular
     * distance.
     */
    columns.push({ distance: hit.distance, side: hit.side, missed: hit.missed });
  }
  return columns;
}

/**
 * Wall height on screen for a perpendicular distance, in pixels.
 *
 * Clamped at a minimum distance so a player pressed against a wall does not divide by zero and produce an
 * Infinity-tall column, which draws as a full-screen block of colour and looks like the renderer crashed.
 */
export function wallHeight(distance: number, viewportHeight: number): number {
  const safe = Math.max(0.0001, distance);
  return viewportHeight / safe;
}

/**
 * Shade for a wall column: darker with distance, and darker again for a y-face.
 *
 * The two-tone face shading is not decoration. With one flat colour an untextured raycast scene is a single
 * mass with no readable corners, so a player cannot tell a doorway from a dead end — the geometry is right
 * and the picture is useless.
 */
export function shade(distance: number, side: 'x' | 'y'): number {
  const fog = Math.max(0.18, Math.min(1, 1 - distance / (GRID_SIZE * 0.9)));
  const faceFactor = side === 'y' ? 0.68 : 1;
  return fog * faceFactor;
}
