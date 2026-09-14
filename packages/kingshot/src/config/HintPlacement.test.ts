import { describe, expect, it } from 'vitest';

import { hintCandidates, placeHint, rectsOverlap, type Rect } from './HintPlacement';

const BOUNDS = { width: 960, height: 540 };
const OPTIONS = { gap: 8, bounds: BOUNDS };
const SIZE = { width: 150, height: 34 };
const ANCHOR = { x: 480, y: 240, halfHeight: 30 };

describe('rectsOverlap', () => {
  it('does not count touching edges as overlap', () => {
    // A hint placed exactly against a label is legible; treating that as a collision would push it away for nothing.
    const a: Rect = { x: 0, y: 0, width: 10, height: 10 };
    expect(rectsOverlap(a, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);
    expect(rectsOverlap(a, { x: 9.9, y: 0, width: 10, height: 10 })).toBe(true);
  });

  it('is symmetric', () => {
    const a: Rect = { x: 0, y: 0, width: 10, height: 10 };
    const b: Rect = { x: 5, y: 5, width: 10, height: 10 };
    expect(rectsOverlap(a, b)).toBe(rectsOverlap(b, a));
  });
});

describe('placeHint', () => {
  it('prefers directly below when nothing is in the way', () => {
    // Below is where a caption belongs and where this hint has always been; the fix must not move it for no reason.
    const placed = placeHint(ANCHOR, SIZE, [], OPTIONS);
    expect(placed.clear).toBe(true);
    expect(placed.candidateIndex).toBe(0);
    expect(placed.rect.y).toBeGreaterThan(ANCHOR.y);
  });

  it('moves off a label that sits below, which is the actual defect', () => {
    /**
     * The measured case: the hint was fixed at a offset below the sprite, and another building's lock label occupies
     * that band. A fixed offset can only avoid the obstacle its author had in mind.
     */
    const below = placeHint(ANCHOR, SIZE, [], OPTIONS).rect;
    const blocker: Rect = { ...below, x: below.x + 20 };
    const placed = placeHint(ANCHOR, SIZE, [blocker], OPTIONS);
    expect(placed.clear).toBe(true);
    expect(rectsOverlap(placed.rect, blocker)).toBe(false);
  });

  it('clears EVERY obstacle it is given, not just the first', () => {
    // The property that matters. Blocking below and above forces it sideways.
    const belowRect = placeHint(ANCHOR, SIZE, [], OPTIONS).rect;
    const aboveRect = { ...belowRect, y: ANCHOR.y - ANCHOR.halfHeight - 8 - SIZE.height };
    const obstacles = [belowRect, aboveRect];
    const placed = placeHint(ANCHOR, SIZE, obstacles, OPTIONS);
    for (const obstacle of obstacles) {
      expect(rectsOverlap(placed.rect, obstacle), `overlaps ${JSON.stringify(obstacle)}`).toBe(false);
    }
  });

  it('stays inside the screen, whatever the anchor', () => {
    // A hint pushed off-screen is worse than one slightly misplaced, so candidates are clamped rather than discarded.
    for (const anchor of [
      { x: 0, y: 0, halfHeight: 30 },
      { x: BOUNDS.width, y: BOUNDS.height, halfHeight: 30 },
      { x: 5, y: BOUNDS.height - 5, halfHeight: 60 },
    ]) {
      const placed = placeHint(anchor, SIZE, [], OPTIONS);
      expect(placed.rect.x).toBeGreaterThanOrEqual(0);
      expect(placed.rect.y).toBeGreaterThanOrEqual(0);
      expect(placed.rect.x + placed.rect.width).toBeLessThanOrEqual(BOUNDS.width);
      expect(placed.rect.y + placed.rect.height).toBeLessThanOrEqual(BOUNDS.height);
    }
  });

  it('reports honestly when the screen leaves nowhere clear, and picks the least bad', () => {
    /**
     * A blanket obstacle covering everything cannot be avoided. Returning a position anyway with clear: false is more
     * useful than throwing — the caller can hide the hint or accept a small overlap — and it means the flag, not the
     * absence of an exception, is what a caller checks.
     */
    const everything: Rect = { x: 0, y: 0, width: BOUNDS.width, height: BOUNDS.height };
    const placed = placeHint(ANCHOR, SIZE, [everything], OPTIONS);
    expect(placed.clear).toBe(false);
    expect(placed.rect.width).toBe(SIZE.width);
  });

  it('picks the candidate with the least overlap when EVERY candidate is blocked', () => {
    /**
     * Drives the fallback path precisely, which needs the candidate list — my first version of this test blocked two
     * candidates and asserted a fallback that never happened, because the other four were still clear. A test that
     * cannot reach the branch it names proves nothing about it.
     *
     * Every candidate is covered fully except one, which is covered by a 4x4 sliver. That one must win.
     */
    const list = hintCandidates(ANCHOR, SIZE, OPTIONS);
    const lightIndex = 3;
    const obstacles: Rect[] = list.map((rect, index) =>
      index === lightIndex ? { x: rect.x, y: rect.y, width: 4, height: 4 } : { ...rect },
    );
    const placed = placeHint(ANCHOR, SIZE, obstacles, OPTIONS);
    expect(placed.clear).toBe(false);
    expect(placed.candidateIndex).toBe(lightIndex);
  });

  it('is deterministic', () => {
    const obstacles = [{ x: 400, y: 280, width: 200, height: 40 }];
    const a = placeHint(ANCHOR, SIZE, obstacles, OPTIONS);
    const b = placeHint(ANCHOR, SIZE, obstacles, OPTIONS);
    expect(a).toEqual(b);
  });
});
