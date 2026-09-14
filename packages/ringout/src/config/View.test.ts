import { describe, it, expect } from 'vitest';

import { RING } from '../game/fightState';
import { GAME_WIDTH } from './GameConfig';
import {
  CAMERA,
  cameraFor,
  MIN_ZOOM,
  project,
  FLOOR_SCREEN_Y,
  hpBarRect,
  hpFillRect,
  ringEdges,
  visibleWorldRange,
  worldToScreen,
} from './View';

/**
 * The transform and the HUD layout are tested here rather than inside the scene, because a number
 * decided inside a Phaser `create()` cannot be checked by anything. Keeping the arithmetic in a pure
 * module is what makes these assertions possible at all.
 */
describe('worldToScreen', () => {
  it('puts the ring centre at the middle of the canvas', () => {
    expect(worldToScreen(0, 0).x).toBe(GAME_WIDTH / 2);
  });

  it('flips the vertical axis, since the fight counts up and the screen counts down', () => {
    const floor = worldToScreen(0, 0);
    const head = worldToScreen(0, 70);
    expect(floor.y).toBe(FLOOR_SCREEN_Y);
    expect(head.y, 'higher in the world means smaller on screen').toBeLessThan(floor.y);
  });

  it('is monotonic in x, so left in the world is left on screen', () => {
    expect(worldToScreen(-100, 0).x).toBeLessThan(worldToScreen(0, 0).x);
    expect(worldToScreen(100, 0).x).toBeGreaterThan(worldToScreen(0, 0).x);
  });
});

describe('ring edges', () => {
  it('sits exactly where the rule says a fighter is out', () => {
    // The drawn boundary and the boundary that decides the match must be the same line. If they can
    // drift apart, a player loses to a rule they were shown in the wrong place.
    const edges = ringEdges();
    expect(edges.left).toBe(worldToScreen(-RING.halfWidth, 0).x);
    expect(edges.right).toBe(worldToScreen(RING.halfWidth, 0).x);
  });

  it('fits inside the canvas, or the losing line would be off screen', () => {
    const edges = ringEdges();
    expect(edges.left).toBeGreaterThanOrEqual(0);
    expect(edges.right).toBeLessThanOrEqual(GAME_WIDTH);
  });
});

describe('projection through a frame', () => {
  it('keeps the floor on a fixed screen line at every zoom', () => {
    // The defect that made zooming Phaser's camera unusable: at zoom 3.2 the camera's visible band is
    // 169 px tall, so the floor at y 452 fell outside it and fighters were drawn with their feet cut
    // off. Projecting keeps the ground anchored, so a fighter grows upward instead of drifting.
    for (const zoom of [1, MIN_ZOOM, 2.4, CAMERA.maxZoom]) {
      expect(project(0, 0, { centerX: 0, zoom }).y).toBe(FLOOR_SCREEN_Y);
    }
  });

  it('scales height with zoom, so a closer camera means a bigger fighter', () => {
    const near = project(0, 70, { centerX: 0, zoom: 3 });
    const far = project(0, 70, { centerX: 0, zoom: 1.5 });
    expect(FLOOR_SCREEN_Y - near.y).toBeCloseTo((FLOOR_SCREEN_Y - far.y) * 2, 6);
  });

  it('puts the frame centre at the middle of the canvas', () => {
    expect(project(140, 0, { centerX: 140, zoom: 2.5 }).x).toBe(GAME_WIDTH / 2);
  });

  it('keeps a fighter well inside the frame vertically at the closest zoom', () => {
    // A 70-tall fighter at maxZoom must still fit above the floor line with the hp bars clear of it.
    const head = project(0, 70, { centerX: 0, zoom: CAMERA.maxZoom });
    const bar = hpBarRect('left');
    expect(head.y).toBeGreaterThan(bar.y + bar.height);
    expect(head.y).toBeLessThan(FLOOR_SCREEN_Y);
  });

  it('draws the ring edge where the frame is actually looking', () => {
    // Projected through the same frame as the fighters. An edge drawn at an unframed position would
    // put the losing line somewhere the camera is not.
    const frame = cameraFor([120, 160]);
    expect(ringEdges(frame).right).toBe(project(RING.halfWidth, 0, frame).x);
  });
});

describe('camera framing', () => {
  /**
   * The look is judged from a screenshot; these test the arithmetic, which is the half that can
   * silently regress. The defect this fixes was found by LOOKING — fighters at 14% of frame height —
   * so the tests below encode what "framed" means numerically, and the screenshot stays the check on
   * whether that definition is any good.
   */
  const separations = [0, 20, 60, 120, 200, 300, RING.halfWidth * 2];

  it('keeps both fighters inside the visible range at every separation', () => {
    for (const gap of separations) {
      const positions = [-gap / 2, gap / 2];
      const frame = cameraFor(positions);
      const view = visibleWorldRange(frame);
      expect(positions[0], `gap ${gap} left fighter`).toBeGreaterThan(view.left);
      expect(positions[1], `gap ${gap} right fighter`).toBeLessThan(view.right);
    }
  });

  it('centres between the fighters wherever they are, not on the ring', () => {
    // Following the fight rather than the stage is the point: two fighters cornered on the left should
    // fill the frame, not sit in a corner of a view centred on an empty ring.
    expect(cameraFor([-160, -100]).centerX).toBeCloseTo(-130, 6);
    expect(cameraFor([40, 150]).centerX).toBeCloseTo(95, 6);
  });

  it('zooms out monotonically as the fighters separate', () => {
    const zooms = separations.map((gap) => cameraFor([-gap / 2, gap / 2]).zoom);
    for (let i = 1; i < zooms.length; i += 1) {
      expect(zooms[i], `separation ${separations[i]} must not zoom IN`).toBeLessThanOrEqual(
        zooms[i - 1],
      );
    }
  });

  it('clamps at both ends', () => {
    // Without the upper clamp, two fighters on the same spot divide by nearly zero and the zoom runs
    // away; without the lower one, a pair at opposite edges zooms out past legibility — which is
    // exactly the state this function was written to remove.
    expect(cameraFor([0, 0]).zoom).toBe(CAMERA.maxZoom);
    expect(cameraFor([-RING.halfWidth, RING.halfWidth]).zoom).toBe(MIN_ZOOM);
  });

  it('makes a fighter a reasonable share of the frame at fighting range', () => {
    // The numeric statement of the defect. A fighter is about 70 world units tall; at close range it
    // should occupy a substantial part of a 540-tall frame rather than a seventh of it.
    const FIGHTER_HEIGHT = 70;
    const closeQuarters = cameraFor([-30, 30]).zoom;
    const share = (FIGHTER_HEIGHT * closeQuarters) / 540;
    expect(share, 'too small — the defect this fixes').toBeGreaterThan(0.3);
    expect(share, 'too large — a fighter should not fill the frame').toBeLessThan(0.7);
  });

  it('never zooms so far in that the ring edge is invisible to a cornered fighter', () => {
    // A player must be able to see the line they lose to. A fighter pinned against the edge whose
    // camera cannot show that edge is being asked to avoid something off screen.
    const cornered = cameraFor([RING.halfWidth - 20, RING.halfWidth - 90]);
    const view = visibleWorldRange(cornered);
    expect(view.right, 'the edge must be within view').toBeGreaterThanOrEqual(RING.halfWidth);
  });

  it('handles a single position and an empty list without producing nonsense', () => {
    expect(cameraFor([50])).toEqual({ centerX: 50, zoom: CAMERA.maxZoom });
    const empty = cameraFor([]);
    expect(Number.isFinite(empty.centerX)).toBe(true);
    expect(Number.isFinite(empty.zoom)).toBe(true);
  });
});

describe('hp bars', () => {
  it('places the two bars symmetrically', () => {
    const left = hpBarRect('left');
    const right = hpBarRect('right');
    expect(left.x).toBe(GAME_WIDTH - right.x - right.width);
    expect(left.y).toBe(right.y);
  });

  it('drains both bars towards the screen edges', () => {
    // The right-hand bar empties rightward so both players read damage as "my bar shrinks towards my
    // own side". Draining left-to-right on both sides makes the right player read it backwards.
    const full = hpFillRect('right', RING.maxHp);
    const half = hpFillRect('right', RING.maxHp / 2);
    expect(half.width).toBeCloseTo(full.width / 2, 6);
    expect(half.x, 'the right bar keeps its right edge fixed').toBeGreaterThan(full.x);

    const leftFull = hpFillRect('left', RING.maxHp);
    const leftHalf = hpFillRect('left', RING.maxHp / 2);
    expect(leftHalf.x, 'the left bar keeps its left edge fixed').toBe(leftFull.x);
  });

  it('clamps rather than drawing a negative or overlong bar', () => {
    expect(hpFillRect('left', -50).width).toBe(0);
    expect(hpFillRect('left', RING.maxHp * 3).width).toBe(hpBarRect('left').width);
  });

  it('switches colour only when the fighter is nearly out', () => {
    // A warning that fires early is a warning nobody reads.
    expect(hpFillRect('left', RING.maxHp).color).toBe(hpFillRect('left', RING.maxHp * 0.5).color);
    expect(hpFillRect('left', RING.maxHp * 0.2).color).not.toBe(
      hpFillRect('left', RING.maxHp).color,
    );
  });

  it('leaves the fighters room below the bars', () => {
    // A fighter's head reaches roughly 66 above the floor; the bars must not sit in that band.
    const bar = hpBarRect('left');
    const headTop = worldToScreen(0, 70).y;
    expect(bar.y + bar.height).toBeLessThan(headTop);
  });
});
