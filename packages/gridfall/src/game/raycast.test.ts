import { describe, it, expect } from 'vitest';

import { GRID_SIZE, isSolid } from './gridWorld';
import {
  castColumn,
  castView,
  DEFAULT_FOV,
  MAX_DISTANCE,
  projectionDistance,
  shade,
  shadeColor,
  wallHeight,
} from './raycast';

/** Points known to be in open space on this map, used as ray origins. */
const OPEN_POINTS: [number, number][] = [
  [2.5, 2.5],
  [11.5, 3.5],
  [3.5, 11.5],
  [12.5, 21.5],
  [21.5, 21.5],
  [9.5, 9.5],
];

describe('the ray march', () => {
  it('never returns NaN, negative or absurd distances, at any angle from any open point', () => {
    /**
     * The test this module exists for. A DDA divides by a direction component, and a ray fired exactly along
     * an axis makes one of them zero — the classic way a raycaster yields a NaN distance. NaN is doubly
     * dangerous here: it draws as nothing, and it compares as neither greater nor less than any threshold, so
     * a naive assertion passes straight over it. The sweep includes the four exact axis directions rather
     * than only sampling near them.
     */
    for (const [x, y] of OPEN_POINTS) {
      expect(isSolid(x, y), `origin ${x},${y} must be open`).toBe(false);
      for (let step = 0; step < 360; step += 1) {
        const angle = (step / 360) * Math.PI * 2;
        const hit = castColumn(x, y, Math.cos(angle), Math.sin(angle));
        expect(Number.isFinite(hit.distance), `NaN at ${x},${y} angle ${step}`).toBe(true);
        expect(hit.distance, `negative at ${x},${y} angle ${step}`).toBeGreaterThanOrEqual(0);
        expect(hit.distance).toBeLessThanOrEqual(MAX_DISTANCE);
      }
      // The exact axes, spelled out, because a 1-degree sweep can miss them by floating point.
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const hit = castColumn(x, y, dx, dy);
        expect(Number.isFinite(hit.distance), `axis ${dx},${dy} from ${x},${y}`).toBe(true);
        expect(hit.distance).toBeGreaterThan(0);
      }
    }
  });

  it('survives an origin sitting exactly on a tile boundary', () => {
    /**
     * Where the NaN actually lives, and the reason the sweep above did not find it. Removing the
     * zero-direction guards failed every test, because 1/0 is Infinity in JavaScript and Infinity times a
     * non-zero offset is still Infinity — which happens to behave. The product only becomes 0 * Infinity,
     * i.e. NaN, when the offset within the tile is exactly zero, meaning the origin is ON an integer
     * coordinate. Every origin above is a .5, so the case could not arise.
     *
     * A player standing exactly at x = 12.0 and looking almost straight up is not exotic; it is one frame of
     * ordinary movement. The tiny-magnitude directions are included because a direction of exactly 0 takes a
     * different branch than one of -1e-300, and only the second reaches the multiply.
     */
    const boundaryOrigins: [number, number][] = [
      [11, 3.5],
      [11.5, 3],
      [11, 3],
      [12, 4],
    ];
    const directions: [number, number][] = [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
      [-1e-300, 1],
      [1e-300, -1],
      [1, -1e-300],
      [-1, 1e-300],
      [-1e-300, -1e-300],
    ];
    for (const [x, y] of boundaryOrigins) {
      for (const [dx, dy] of directions) {
        const hit = castColumn(x, y, dx, dy);
        expect(
          Number.isFinite(hit.distance),
          `NaN or Infinity from boundary origin ${x},${y} along ${dx},${dy}`,
        ).toBe(true);
        expect(hit.distance).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('reports the true distance to a wall it is aimed straight at', () => {
    // The border wall occupies tile 0, so its inner face is at x = 1. From x = 5.5 facing left that is 4.5.
    const hit = castColumn(5.5, 3.5, -1, 0);
    expect(hit.missed).toBe(false);
    expect(hit.distance).toBeCloseTo(4.5, 6);
    expect(hit.side, 'a wall to the west is an x-face').toBe('x');
  });

  it('distinguishes an x-face from a y-face', () => {
    // Not cosmetic: without this the whole scene is one flat colour and a corner is invisible.
    expect(castColumn(11.5, 3.5, 0, -1).side, 'the wall above is a y-face').toBe('y');
    expect(castColumn(11.5, 3.5, -1, 0).side, 'the wall to the west is an x-face').toBe('x');
  });

  it('stops at the nearest wall, not a later one', () => {
    // Fired south from above the interior block at tiles y 5..7: the block's top face is nearer than the
    // map's bottom wall, so the distance must be the short one.
    const hit = castColumn(6.0, 3.5, 0, 1);
    expect(hit.missed).toBe(false);
    expect(hit.distance).toBeCloseTo(1.5, 6);
  });

  it('terminates as a miss rather than looping forever', () => {
    // Starting inside the border wall itself: a ray with nowhere legal to go must end, not spin the frame.
    const hit = castColumn(0.5, 0.5, 1, 0);
    expect(Number.isFinite(hit.distance)).toBe(true);
  });

  it('is symmetric: mirrored rays from a symmetric spot travel the same distance', () => {
    // The map's four interior blocks are placed symmetrically about the centre, so this is a real check on
    // the stepping arithmetic rather than a tautology.
    const centre = GRID_SIZE / 2;
    const left = castColumn(centre, 3.5, -1, 0).distance;
    const right = castColumn(centre, 3.5, 1, 0).distance;
    expect(left).toBeCloseTo(right, 6);
  });
});

describe('the view', () => {
  it('returns one column per requested column', () => {
    expect(castView({ x: 11.5, y: 3.5, angle: 0 }, 160)).toHaveLength(160);
    expect(castView({ x: 11.5, y: 3.5, angle: 0 }, 1)).toHaveLength(1);
  });

  it('reads a flat wall as a CONSTANT distance across columns, with no fisheye', () => {
    /**
     * The property that justifies spreading rays across a camera plane instead of rotating through equal
     * angles. Equal angles is the intuitive version and it bulges a flat wall, because an edge column is
     * further from the eye than a centre one by the secant of its angle. Spread along a plane, the DDA
     * distance IS the perpendicular distance, so a wall the player is square-on to must measure the same
     * everywhere.
     */
    // Standing in the open corridor along y = 3.5, facing north at the top wall.
    const columns = castView({ x: 11.5, y: 3.5, angle: -Math.PI / 2 }, 64);
    const hits = columns.filter((c) => !c.missed).map((c) => c.distance);
    expect(hits.length, 'the wall should fill the view').toBeGreaterThan(40);
    const min = Math.min(...hits);
    const max = Math.max(...hits);
    expect(max - min, `fisheye: distances spread from ${min} to ${max}`).toBeLessThan(0.02);
  });

  it('spreads columns across the field of view rather than all down one line', () => {
    // Guard against a plane scale of zero, which would make every ray identical and the scene a single
    // column stretched across the screen — geometrically "correct" and completely wrong.
    const columns = castView({ x: 9.5, y: 9.5, angle: 0.4 }, 32, DEFAULT_FOV);
    const distinct = new Set(columns.map((c) => c.distance.toFixed(4)));
    expect(distinct.size, 'every ray returned the same distance').toBeGreaterThan(3);
  });

  it('points the centre column where the player is facing', () => {
    /**
     * A half-column bias makes the view sit slightly off-axis from the crosshair, which a player feels as the
     * gun being misaligned without being able to say why.
     *
     * The facing here is deliberately NOT square-on to a wall. Facing a flat wall, the plane spread makes the
     * distance identical in every column — that is the whole point of it — so a biased centre column returns
     * the same number and the check cannot see the bias. It needs a view where distance varies across
     * columns, so an off-centre ray reads differently from the true facing.
     */
    const eye = { x: 9.5, y: 9.5, angle: 0.4 };
    const straight = castColumn(eye.x, eye.y, Math.cos(eye.angle), Math.sin(eye.angle));
    const columns = castView(eye, 65);
    const spread = Math.max(...columns.map((c) => c.distance)) -
      Math.min(...columns.map((c) => c.distance));
    expect(spread, 'the view must vary, or this test cannot detect a bias').toBeGreaterThan(0.5);
    expect(columns[32].distance).toBeCloseTo(straight.distance, 4);
  });

  it('never returns a NaN column for any facing', () => {
    for (let step = 0; step < 120; step += 1) {
      const angle = (step / 120) * Math.PI * 2;
      for (const column of castView({ x: 11.5, y: 3.5, angle }, 40)) {
        expect(Number.isFinite(column.distance), `facing ${step}`).toBe(true);
      }
    }
  });
});

describe('projection', () => {
  const WIDTH = 960;
  const HEIGHT = 540;
  const plane = projectionDistance(WIDTH);

  it('derives the plane distance from the field of view, not from the viewport height', () => {
    /**
     * The defect a screenshot caught. wallHeight originally used the viewport HEIGHT as its numerator, which
     * assumes the vertical field of view subtends exactly one world unit at one unit of distance. It does not:
     * the vertical field follows from the horizontal one and the aspect ratio. At 60 degrees and 960 wide the
     * correct value is 480 / tan(30°) ~= 831, so every wall was drawn at 65% of its true height and floated in
     * a band around the horizon instead of meeting the floor.
     */
    expect(plane).toBeCloseTo(831.4, 1);
    expect(plane, 'the viewport height is the wrong numerator').not.toBeCloseTo(HEIGHT, 0);
  });

  it('moves with the field of view rather than being a pasted constant', () => {
    expect(projectionDistance(WIDTH, Math.PI / 2)).toBeLessThan(plane);
    expect(projectionDistance(WIDTH, Math.PI / 6)).toBeGreaterThan(plane);
  });

  it('fills the view with a wall one unit away', () => {
    // A wall you are standing next to must overflow the frame, not occupy half of it.
    expect(wallHeight(1, plane)).toBeGreaterThan(HEIGHT);
  });

  it('gives a wall three tiles away roughly half the frame', () => {
    // The number the broken version got wrong: 180 px where the geometry says about 277.
    const height = wallHeight(3, plane);
    expect(height).toBeGreaterThan(HEIGHT * 0.44);
    expect(height).toBeLessThan(HEIGHT * 0.58);
  });

  it('makes nearer walls taller', () => {
    expect(wallHeight(1, plane)).toBeGreaterThan(wallHeight(4, plane));
  });

  it('leaves a distant wall visible rather than sub-pixel', () => {
    expect(wallHeight(MAX_DISTANCE, plane)).toBeGreaterThan(2);
  });

  it('does not produce an infinite column when pressed against a wall', () => {
    // Zero distance would divide by zero and draw a full-screen block, which reads as the renderer having
    // crashed rather than as standing very close to something.
    expect(Number.isFinite(wallHeight(0, plane))).toBe(true);
    expect(Number.isFinite(wallHeight(-1, plane))).toBe(true);
  });
});

describe('shading', () => {
  it('darkens with distance but never to invisibility', () => {
    const near = shade(1, 'x');
    const far = shade(GRID_SIZE, 'x');
    expect(near).toBeGreaterThan(far);
    expect(far, 'a distant wall must still be visible').toBeGreaterThan(0.1);
    expect(near).toBeLessThanOrEqual(1);
  });

  it('shades the two wall faces differently, or corners disappear', () => {
    expect(shade(3, 'y')).toBeLessThan(shade(3, 'x'));
  });

  it('darkens a colour by channel rather than by alpha', () => {
    /**
     * Found by looking at a frame, not by an assertion. Shading via alpha makes a wall TRANSLUCENT, so the
     * floor-and-ceiling boundary behind it shows through as a bright horizontal seam across every wall at the
     * horizon. A wall is opaque; only its brightness changes.
     */
    expect(shadeColor(0xffffff, 1)).toBe(0xffffff);
    expect(shadeColor(0xffffff, 0)).toBe(0x000000);
    expect(shadeColor(0x8040c0, 0.5)).toBe(0x402060);
    // Channels must not bleed into one another, which is what a naive multiply of the whole integer would do.
    expect(shadeColor(0x00ff00, 0.5)).toBe(0x008000);
    expect(shadeColor(0x0000ff, 0.5)).toBe(0x000080);
  });

  it('clamps a shade factor outside 0..1 instead of overflowing a channel', () => {
    expect(shadeColor(0x808080, 4)).toBe(0x808080);
    expect(shadeColor(0x808080, -2)).toBe(0x000000);
  });

  it('stays within a drawable range at every distance', () => {
    for (let d = 0; d <= MAX_DISTANCE; d += 0.5) {
      const value = shade(d, 'x');
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});
