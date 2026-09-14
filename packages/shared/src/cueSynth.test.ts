import { describe, expect, it } from 'vitest';

import { CUE_TABLE, CueSynth, type CueName } from './cueSynth';

const NAMES = Object.keys(CUE_TABLE) as CueName[];

describe('cue table', () => {
  it('gives every cue a short, finite duration', () => {
    // These play during action. Anything long enough to overlap the next one of the same kind turns sustained fire
    // into a drone, which is what makes a synthesised effect sound cheap.
    for (const name of NAMES) {
      const cue = CUE_TABLE[name];
      expect(cue.duration, name).toBeGreaterThan(0);
      expect(cue.duration, name).toBeLessThanOrEqual(0.6);
    }
  });

  it('keeps every peak well below clipping, so simultaneous cues cannot distort', () => {
    // Several cues genuinely do fire on one frame — two shots and a hit — so the sum matters, not just each peak.
    const total = NAMES.reduce((sum, name) => sum + CUE_TABLE[name].peak, 0);
    for (const name of NAMES) {
      expect(CUE_TABLE[name].peak, name).toBeGreaterThan(0);
      expect(CUE_TABLE[name].peak, name).toBeLessThan(0.3);
    }
    // The three loudest firing together must still leave headroom under the 0.7 master gain.
    const loudest = NAMES.map((n) => CUE_TABLE[n].peak).sort((a, b) => b - a).slice(0, 3);
    expect(loudest.reduce((a, b) => a + b, 0)).toBeLessThan(1);
    expect(total).toBeGreaterThan(0);
  });

  it('never sweeps to zero, which an exponential ramp cannot reach', () => {
    // exponentialRampToValueAtTime throws on a zero target, so a cue shaped that way would be a runtime error rather
    // than a quiet sound.
    for (const name of NAMES) {
      expect(CUE_TABLE[name].from, name).toBeGreaterThan(0);
      expect(CUE_TABLE[name].to, name).toBeGreaterThan(0);
    }
  });

  it('makes a hit distinguishable from a shot, and a miss from a hit', () => {
    // The property that matters for play rather than for taste: firing, connecting and whiffing must not sound alike.
    expect(CUE_TABLE.hit.from).not.toBe(CUE_TABLE.shoot.from);
    expect(CUE_TABLE.swing.from).not.toBe(CUE_TABLE.land.from);
    // A death should be the lowest thing in the table — it is the only cue that needs to read as bad news.
    const lowestEnd = Math.min(...NAMES.map((n) => CUE_TABLE[n].to));
    expect(CUE_TABLE.death.to).toBe(lowestEnd);
  });
});

describe('CueSynth without any audio', () => {
  it('constructs and plays every cue without throwing when WebAudio is absent', () => {
    /**
     * This is the case the tests run in, and the capture tooling too. A cue call that threw would take the frame with
     * it — so silence has to be a no-op rather than an error. Node has no window, so ensure() fails on the first call
     * and latches.
     */
    const synth = new CueSynth();
    for (const name of NAMES) {
      expect(() => synth.play(name)).not.toThrow();
    }
  });

  it('starts muted when construction says so, and toggles', () => {
    const synth = new CueSynth({ muted: true });
    expect(synth.isMuted).toBe(true);
    expect(synth.toggleMuted()).toBe(false);
    expect(synth.isMuted).toBe(false);
    synth.setMuted(true);
    expect(synth.isMuted).toBe(true);
  });

  it('ignores an unknown cue name instead of throwing', () => {
    const synth = new CueSynth();
    expect(() => synth.play('nope' as CueName)).not.toThrow();
  });
});
