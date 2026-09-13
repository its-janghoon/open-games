import Phaser from 'phaser';
import { PALETTE } from '../config/GameConfig';

/**
 * UiText - crisp-text strategy for the UI/HUD/menu layer.
 *
 * The canvas backbuffer is sized to DEVICE pixels (see resolveViewportPlan in
 * main.ts) and each camera is zoomed by the same factor, so the 960x540 logical
 * layout is drawn at display resolution rather than upscaled from a low-res
 * buffer. On top of that the renderer scales SMOOTHLY - main.ts deliberately
 * does not set `pixelArt: true` - so rasterizing glyphs above their drawn size
 * acts as supersampling and reads as sharp text. Pixel art is kept crisp
 * per-texture instead (PreloadScene.applyPixelArtFiltering).
 */

/**
 * Text resolution multiplier: Text is rasterized to its own glyph texture at
 * `resolution` times the logical size.
 *
 * DO NOT pair this with `pixelArt: true`. Phaser Text is NOT exempt from the
 * global filter - TextureSource derives its default scaleMode straight from
 * `game.config.antialias`, which `pixelArt` forces to false - so under pixelArt
 * an oversized glyph texture is NEAREST-*minified* down to its drawn size,
 * point-sampling away whole texel rows. Latin survives losing a row; Hangul
 * does not, because jongseong stack 2-3 horizontal strokes into a few pixels
 * and merge into blobs. With the smooth default in main.ts the same oversized
 * texture is instead a supersampled downscale, which is why the floor is >=3x.
 */
export const TEXT_RESOLUTION = Math.min(
  4,
  Math.max(3, Math.ceil((typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1) * 2),
);

/**
 * Font stack for all UI text. A bare `'monospace'` resolves to whatever the
 * platform picks (often a blurry, hinting-heavy default); naming concrete,
 * widely-shipped monospace faces first gives a consistent, sharp glyph grid
 * across platforms and only falls back to the generic keyword last.
 */
export const UI_FONT_FAMILY =
  '"DejaVu Sans Mono", "Consolas", "Liberation Mono", "Menlo", "Courier New", monospace';

/**
 * Build a monospace text style with the crisp text resolution baked in, using
 * the shared palette. Callers pass a font size (in logical px, already sized
 * for the 960x540 canvas) plus optional overrides.
 *
 * Beyond the high-DPI `resolution`, every label gets:
 *  - a legible cross-platform monospace font stack ({@link UI_FONT_FAMILY}),
 *  - a small `padding` so the high-DPI glyph texture never clips ascenders /
 *    descenders (a common cause of "fuzzy" edges on scaled text), and
 *  - a subtle 1px dark shadow for contrast against the busy arena, which reads
 *    as a crisp edge rather than a blur because it is rasterized at `resolution`.
 * Overrides win, so callers can still tweak colour/align/weight per label.
 */
export function textStyle(
  fontSize: number,
  overrides: Phaser.Types.GameObjects.Text.TextStyle = {},
): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontFamily: UI_FONT_FAMILY,
    fontSize: `${fontSize}px`,
    color: PALETTE.TEXT_CSS,
    resolution: TEXT_RESOLUTION,
    padding: { x: 2, y: 2 },
    shadow: {
      offsetX: 0,
      offsetY: 1,
      color: '#000000',
      blur: 0,
      fill: true,
      stroke: false,
    },
    ...overrides,
  };
}
