import { describe, it, expect } from 'vitest';

import { BUILDING_LAYOUT, LABEL_RESERVE, SAFE_AREA, SAFE_AREA_IS_SANE, SAFE_HEIGHT } from './TownLayout';
import { BUILDING_TEXTURE_BY_KIND, SHEETS } from './AssetKeys';
import { CANVAS } from './GameConfig';
import { BUILDING_ORDER } from './BuildingConfig';

/**
 * The town map is drawn UNDER a screen-space HUD, so fitting the canvas is not
 * enough - a sprite has to fit the band the HUD leaves. The bug this guards
 * looked like the map being cut off at the bottom, but nothing was off-screen:
 * the lowest sprite edge was 518 of a 540 canvas and the navigation row simply
 * covered it from 488 down. A viewport or camera check would have passed.
 */
describe('town layout safe area', () => {
  /** Frame height of the sheet a building draws from, by kind. */
  const frameHeight = (kind: string): number => {
    const tex = BUILDING_TEXTURE_BY_KIND[kind];
    const sheet = SHEETS.find((s) => s.key === tex);
    return sheet?.frame?.frameHeight ?? 48;
  };

  const extent = (kind: keyof typeof BUILDING_LAYOUT) => {
    const l = BUILDING_LAYOUT[kind];
    const half = (frameHeight(kind) * l.scale) / 2;
    return { top: l.y - half, bottom: l.y + half };
  };

  it('reserves a usable band inside the canvas', () => {
    expect(SAFE_AREA_IS_SANE).toBe(true);
    expect(SAFE_AREA.BOTTOM).toBeLessThanOrEqual(CANVAS.HEIGHT);
    expect(SAFE_HEIGHT).toBeGreaterThan(200);
  });

  it('keeps every building sprite clear of the HUD bands', () => {
    const offenders: string[] = [];
    for (const kind of Object.keys(BUILDING_LAYOUT) as (keyof typeof BUILDING_LAYOUT)[]) {
      const { top, bottom } = extent(kind);
      if (top < SAFE_AREA.TOP) {
        offenders.push(`${kind}: top ${Math.round(top)} above SAFE_AREA.TOP ${SAFE_AREA.TOP}`);
      }
      if (bottom > SAFE_AREA.BOTTOM - SAFE_AREA.MARGIN) {
        offenders.push(
          `${kind}: bottom ${Math.round(bottom)} past SAFE_AREA.BOTTOM ${SAFE_AREA.BOTTOM}` +
            ` (margin ${SAFE_AREA.MARGIN}) - it would be covered by the navigation row`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps every building LABEL clear of the HUD too, not just the sprite', () => {
    // The gap that let a real defect through. The previous assertion covered only
    // the sprite, while the level badge is deliberately drawn ABOVE the sprite so a
    // tall chimney cannot occlude it - so nothing ever checked the badge, and
    // measured on the running game 'Level 1' sat at y=165 against SAFE_AREA.TOP of
    // 172, colliding with the objective banner once that banner grew to two lines.
    const offenders: string[] = [];
    for (const kind of Object.keys(BUILDING_LAYOUT) as (keyof typeof BUILDING_LAYOUT)[]) {
      const labelTop = extent(kind).top - LABEL_RESERVE;
      if (labelTop < SAFE_AREA.TOP) {
        offenders.push(
          `${kind}: label top ${Math.round(labelTop)} above SAFE_AREA.TOP ${SAFE_AREA.TOP}` +
            ` - its badge sits ${LABEL_RESERVE}px above the sprite and would meet the banner`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  it('positions every building the game can construct', () => {
    // A building with no layout entry would render at (0,0) under the resource
    // bar, so the table has to stay in step with BUILDING_ORDER.
    for (const kind of BUILDING_ORDER) {
      expect(BUILDING_LAYOUT[kind], `no layout entry for ${kind}`).toBeDefined();
    }
  });
});
