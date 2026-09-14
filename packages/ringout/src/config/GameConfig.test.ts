import { describe, expect, it } from 'vitest';

import { WAVE_SCALING, waveStrength } from './GameConfig';

describe('waveStrength', () => {
  it('leaves the first wave unscaled', () => {
    expect(waveStrength(1)).toBe(1);
  });

  it('compounds by the scaling factor each wave', () => {
    expect(waveStrength(3)).toBeCloseTo(WAVE_SCALING ** 2, 10);
  });

  it('rejects wave numbers below one', () => {
    expect(() => waveStrength(0)).toThrow(RangeError);
  });
});
