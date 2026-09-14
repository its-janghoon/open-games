/**
 * Vertical stacking for HUD rows, derived from MEASURED content heights.
 *
 * The town HUD used hand-written y coordinates and they were wrong in a way no
 * per-system test could see. Measured on the running game: the resource amount
 * (18px bold, ~24px tall) sat at y=10 with its rate line at y=28 - an 18px step
 * for 24px of text - and below the bar three more rows sat at 52, 60 and 70, three
 * rows inside 18px of space. Eight visible text pairs overlapped, the worst by 67%
 * of the smaller one's area.
 *
 * The cause is not four bad numbers. It is that a row's position was chosen
 * independently of how tall the row above it actually renders, which is exactly
 * the mistake that made every tightly-spaced panel overlap once Menu.button
 * enforced a 44px minimum height. So positions are computed from heights instead,
 * once, here - and because this is a pure function over numbers it can be tested
 * without a browser, which the coordinates never could be.
 */

/** A row's vertical band: where it starts, how tall, and its centre. */
export interface Row {
  /** Top edge. */
  top: number;
  /** Measured height of the row's content. */
  height: number;
  /** Centre, for objects with origin y = 0.5. */
  centre: number;
  /** Bottom edge, exclusive. */
  bottom: number;
}

export interface StackOptions {
  /** Where the first row starts. */
  top: number;
  /** Space between rows. Must be >= 0. */
  gap: number;
  /**
   * Floor applied to every row's height. A row whose text has not been laid out
   * yet measures 0 and would otherwise collapse onto its neighbour.
   */
  minHeight?: number;
}

/**
 * Stack rows top to bottom. Returns one Row per height, in order.
 *
 * The invariant this exists to guarantee: for any two rows i < j, row i's bottom is
 * at or above row j's top. A test pins that rather than pinning coordinates, so the
 * HUD can be restyled without rewriting the test.
 */
export function stackRows(heights: readonly number[], options: StackOptions): Row[] {
  const { top, gap } = options;
  const minHeight = options.minHeight ?? 12;
  const rows: Row[] = [];
  let y = top;
  for (const raw of heights) {
    const height = Math.max(minHeight, Math.ceil(raw));
    rows.push({ top: y, height, centre: y + height / 2, bottom: y + height });
    y += height + gap;
  }
  return rows;
}

/** Total height a stack occupies, including the gaps between its rows. */
export function stackHeight(heights: readonly number[], options: StackOptions): number {
  const rows = stackRows(heights, options);
  if (rows.length === 0) return 0;
  return rows[rows.length - 1].bottom - options.top;
}

/** True when no row in the stack overlaps another. The property, not a number. */
export function rowsDoNotOverlap(rows: readonly Row[]): boolean {
  for (let i = 0; i < rows.length - 1; i += 1) {
    if (rows[i].bottom > rows[i + 1].top) return false;
  }
  return true;
}
