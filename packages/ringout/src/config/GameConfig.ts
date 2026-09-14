/**
 * Tuning values and pure helpers for Ringout.
 *
 * Keep balance numbers here rather than inline in scenes so they stay easy to
 * find, easy to tweak, and easy to unit test without booting Phaser.
 */

/** Logical design resolution; the canvas is scaled to fit the viewport. */
export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;

export const BACKGROUND_COLOR = '#0b0f1c';

/** Difficulty curve: how strong wave `n` is relative to the first wave. */
export const WAVE_SCALING = 1.15;

/**
 * Strength multiplier for a given 1-based wave number.
 *
 * A pure function like this is the kind of logic worth covering with a unit
 * test; rendering and feel stay play-test verified.
 */
export function waveStrength(wave: number): number {
  if (!Number.isInteger(wave) || wave < 1) {
    throw new RangeError(`wave must be a positive integer, got ${wave}`);
  }
  return WAVE_SCALING ** (wave - 1);
}
