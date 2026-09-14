import { describe, it, expect } from 'vitest';

import { stackRows, stackHeight, rowsDoNotOverlap } from './HudLayout';
import { HUD } from './GameConfig';

/**
 * The town HUD's rows used hand-written y coordinates and four of them collided:
 * measured on the running game, eight visible text pairs overlapped, the worst by
 * 67% of the smaller one's area. The amount line renders about 24px tall at 18px
 * bold but its rate line was placed 18px below it, and three further rows sat at
 * y 52, 60 and 70 - three rows inside 18px of space.
 *
 * These tests pin the PROPERTY that fixes it - a row never overlaps the row below -
 * rather than the coordinates, so the HUD can be restyled without rewriting them.
 * The coordinates were never testable at all; this is.
 */
describe('HudLayout', () => {
  it('never lets a row overlap the next one, for any heights', () => {
    const cases: number[][] = [
      [24, 15],
      [24, 15, 16, 14],
      [40, 12, 12],
      [0, 0, 0], // deferred text measures 0 and must not collapse onto its neighbour
      [13.4, 16.7, 11.2], // fractional heights, as a real font metric gives
      [100],
      [],
    ];
    for (const heights of cases) {
      for (const gap of [0, 1, 4, 12]) {
        const rows = stackRows(heights, { top: 3, gap });
        expect(
          rowsDoNotOverlap(rows),
          `heights ${JSON.stringify(heights)} at gap ${gap} produced an overlap`,
        ).toBe(true);
      }
    }
  });

  it('honours the minimum height so an unlaid-out row still occupies space', () => {
    const rows = stackRows([0, 0], { top: 0, gap: 0, minHeight: 12 });
    expect(rows[0].height).toBe(12);
    expect(rows[1].top).toBeGreaterThanOrEqual(rows[0].bottom);
  });

  it('rounds heights up, because a fraction of a pixel still draws', () => {
    const [row] = stackRows([20.2], { top: 0, gap: 0 });
    expect(row.height).toBe(21);
  });

  it('places centres inside their own band', () => {
    for (const row of stackRows([24, 15, 16], { top: 3, gap: 4 })) {
      expect(row.centre).toBeGreaterThan(row.top);
      expect(row.centre).toBeLessThan(row.bottom);
    }
  });

  it('reports the height a stack needs, gaps included', () => {
    const heights = [24, 15];
    const total = stackHeight(heights, { top: 3, gap: 4 });
    expect(total).toBe(24 + 4 + 15);
  });

  it('fits the resource bar rows inside the bar, or the bar has to grow', () => {
    // The real case: an 18px bold amount plus an 11px rate line. If this no longer
    // fits BAR_MIN_HEIGHT the scene grows the bar - this test documents which of
    // those two is happening rather than letting the rows silently overflow.
    const amountH = 24;
    const rateH = 13;
    const rows = stackRows([amountH, rateH], { top: HUD.BAR_PAD, gap: HUD.ROW_GAP_TIGHT });
    expect(rowsDoNotOverlap(rows)).toBe(true);
    const needed = rows[1].bottom + HUD.BAR_PAD;
    expect(needed).toBeLessThanOrEqual(HUD.BAR_MIN_HEIGHT);
  });

  it('keeps the rows below the bar clear of the bar itself', () => {
    const barBottom = HUD.BAR_MIN_HEIGHT;
    const below = stackRows([16, 16, 14], { top: barBottom + HUD.ROW_GAP, gap: HUD.ROW_GAP });
    expect(below[0].top).toBeGreaterThan(barBottom);
    expect(rowsDoNotOverlap(below)).toBe(true);
  });
});
