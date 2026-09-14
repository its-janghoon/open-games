/**
 * Where to put a floating hint so it does not cover a label.
 *
 * The defect this exists for: the build hint under the Lumber Mill was placed at a fixed offset below the sprite,
 * chosen so it would clear the mill's OWN overhead level badge. It did. What it did not clear was every OTHER
 * building's badge, and one of them sits in the same band — measured at 41% overlap against
 * '잠김 (중앙 청사 Lv.3 필요)'. A fixed offset can only ever avoid the obstacle its author was thinking about.
 *
 * So this takes the obstacles as DATA and picks a position that clears them. Same shape as HudLayout.stackRows, which
 * replaced hardcoded row positions with a computation over measured heights, and for the same reason: the property
 * "does not overlap" is testable, where "y + 46" is only checkable by looking.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HintAnchor {
  /** Centre of the thing the hint belongs to. */
  x: number;
  y: number;
  /** Half-height of that thing, so a candidate can clear its sprite. */
  halfHeight: number;
}

export interface HintPlacementOptions {
  /** Gap between the anchor and the hint, and between the hint and a screen edge. */
  gap: number;
  bounds: { width: number; height: number };
}

/** Do two rectangles share any area? Touching edges do NOT count as overlapping. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/**
 * Candidate positions in preference order.
 *
 * Exported so a test can drive the fallback path exactly: to prove the least-overlap choice is made, a test has to
 * block EVERY candidate, and it can only do that if it knows where they are. My first attempt at that test blocked
 * two of them and asserted a fallback that never happened, because the other four were still clear.
 *
 * Below first, because that is where the hint has always been and where a reader expects a caption. Then above, then
 * either side. Every candidate is a TOP-LEFT position for a rect of the given size, already clamped inside the screen,
 * so a candidate that would hang off an edge is moved rather than discarded — a hint pushed slightly inward still
 * reads, where one placed off-screen does not.
 */
export function hintCandidates(
  anchor: HintAnchor,
  size: { width: number; height: number },
  options: HintPlacementOptions,
): Rect[] {
  const { gap, bounds } = options;
  const below = anchor.y + anchor.halfHeight + gap;
  const above = anchor.y - anchor.halfHeight - gap - size.height;
  const centred = anchor.x - size.width / 2;
  const leftOf = anchor.x - anchor.halfHeight - gap - size.width;
  const rightOf = anchor.x + anchor.halfHeight + gap;
  const middle = anchor.y - size.height / 2;

  const raw: Rect[] = [
    { x: centred, y: below, ...size },
    { x: centred, y: above, ...size },
    { x: centred, y: below + size.height + gap, ...size },
    { x: rightOf, y: middle, ...size },
    { x: leftOf, y: middle, ...size },
    { x: centred, y: above - size.height - gap, ...size },
  ];

  return raw.map((rect) => ({
    ...rect,
    x: Math.max(gap, Math.min(bounds.width - size.width - gap, rect.x)),
    y: Math.max(gap, Math.min(bounds.height - size.height - gap, rect.y)),
  }));
}

export interface HintPlacement {
  rect: Rect;
  /** True when the chosen rect clears every obstacle. False means the screen left nowhere clear. */
  clear: boolean;
  /** Which candidate was taken, for a test to assert preference order rather than coordinates. */
  candidateIndex: number;
}

/**
 * Choose a position for the hint.
 *
 * Returns the first candidate that overlaps no obstacle. When every candidate is blocked it returns the one with the
 * LEAST overlap and says `clear: false`, rather than pretending or throwing: a hint that overlaps a little is better
 * than a hint that vanishes, and a caller that wants to hide it instead can read the flag.
 */
export function placeHint(
  anchor: HintAnchor,
  size: { width: number; height: number },
  obstacles: readonly Rect[],
  options: HintPlacementOptions,
): HintPlacement {
  const list = hintCandidates(anchor, size, options);
  let best = { index: 0, area: Number.POSITIVE_INFINITY };

  for (let index = 0; index < list.length; index += 1) {
    const rect = list[index];
    let area = 0;
    for (const obstacle of obstacles) {
      if (!rectsOverlap(rect, obstacle)) continue;
      const w = Math.min(rect.x + rect.width, obstacle.x + obstacle.width) - Math.max(rect.x, obstacle.x);
      const h = Math.min(rect.y + rect.height, obstacle.y + obstacle.height) - Math.max(rect.y, obstacle.y);
      area += Math.max(0, w) * Math.max(0, h);
    }
    if (area === 0) return { rect, clear: true, candidateIndex: index };
    if (area < best.area) best = { index, area };
  }

  return { rect: list[best.index], clear: false, candidateIndex: best.index };
}
