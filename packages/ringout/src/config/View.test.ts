import { describe, it, expect } from 'vitest';

import { RING } from '../game/fightState';
import { GAME_WIDTH } from './GameConfig';
import { FLOOR_SCREEN_Y, hpBarRect, hpFillRect, ringEdges, worldToScreen } from './View';

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
