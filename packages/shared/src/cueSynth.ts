/**
 * Synthesised sound effects — no audio files, no bytes.
 *
 * Both Ringout and Gridfall shipped silent: zero audio files and no audio code, measured across all seven packages
 * while four games ship 346-484 KB of encoded audio each. That was fine while both were `wip`; they are listed as
 * playable now, beside five games that make sound.
 *
 * Files were the wrong answer for these two. They have the smallest payloads of the seven at 357 KB cold, and the
 * project exists to be reachable on metered data — so adding a few hundred KB of samples to the two leanest games
 * would be the wrong trade. champs is the precedent worth copying instead: it ships no audio files at all and
 * synthesises through WebAudio, which costs bytes only in source.
 *
 * champs' own audio module is 476 lines with mix buses, persisted settings and diagnostics. That is not copied here:
 * these two games need a handful of cues, and neither persists settings at all — deliberately, because both games'
 * sibling persistence layers use a strict allowlist that silently drops any field not listed.
 *
 * Every cue is an oscillator plus a gain envelope, created and discarded per play. That is the cheap, standard shape
 * for short effects and it needs no buffer management: a node that has finished is garbage, not a resource to pool.
 */

/** The cues these two games need. Named by what happened, not by how it sounds. */
export type CueName =
  | 'shoot'
  | 'hit'
  | 'death'
  | 'respawn'
  | 'swing'
  | 'land'
  | 'ringout'
  | 'roundWin'
  | 'matchWin'
  | 'uiSelect';

interface CueShape {
  /** Starting frequency in Hz. */
  from: number;
  /** Frequency at the end of the sweep; equal to `from` for a flat tone. */
  to: number;
  /** Seconds. Kept short — these play during action, not between it. */
  duration: number;
  type: OscillatorType;
  /** Peak gain before the decay. Well under 1 so several cues at once cannot clip. */
  peak: number;
}

/**
 * The cue table.
 *
 * Deliberately data rather than a function per cue: a table can be read at a glance to check that no two cues collide
 * and that nothing is loud enough to clip when several fire on the same frame.
 */
const CUES: Record<CueName, CueShape> = {
  // Short, dry, falling — a shot should not ring, or sustained fire becomes a drone.
  shoot: { from: 660, to: 220, duration: 0.07, type: 'square', peak: 0.16 },
  // Higher and shorter than the shot, so a hit is distinguishable from firing at nothing.
  hit: { from: 900, to: 500, duration: 0.05, type: 'triangle', peak: 0.2 },
  death: { from: 300, to: 60, duration: 0.34, type: 'sawtooth', peak: 0.22 },
  respawn: { from: 220, to: 620, duration: 0.22, type: 'sine', peak: 0.18 },
  // A swing that misses: airy and rising, clearly not a hit.
  swing: { from: 380, to: 620, duration: 0.09, type: 'sine', peak: 0.12 },
  land: { from: 520, to: 180, duration: 0.11, type: 'square', peak: 0.22 },
  ringout: { from: 700, to: 90, duration: 0.45, type: 'sawtooth', peak: 0.24 },
  roundWin: { from: 520, to: 780, duration: 0.3, type: 'triangle', peak: 0.2 },
  matchWin: { from: 400, to: 960, duration: 0.55, type: 'triangle', peak: 0.22 },
  uiSelect: { from: 480, to: 480, duration: 0.05, type: 'sine', peak: 0.12 },
};

function audioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const candidate = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return candidate.AudioContext ?? candidate.webkitAudioContext ?? null;
}

/**
 * Whether the player has asked for less motion, which this treats as asking for less noise too.
 *
 * Same signal the games already respect for animation. A player who reduces motion is not necessarily asking for
 * silence, but defaulting to quiet for them is the kinder mistake of the two.
 */
function prefersQuiet(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * A tiny synthesised sound player.
 *
 * Every method is safe to call when there is no audio at all — no WebAudio, a context the browser refuses to start,
 * or a headless test environment. That is not defensiveness for its own sake: these games are driven in Node by their
 * own test suites and in a headless browser by the capture tooling, and a sound call that threw would take the frame
 * with it.
 */
export class CueSynth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private failed = false;
  private muted: boolean;

  constructor(options: { muted?: boolean } = {}) {
    this.muted = options.muted ?? prefersQuiet();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  toggleMuted(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  /**
   * Create the context lazily, on the first cue rather than at construction.
   *
   * A browser refuses to start an AudioContext before a user gesture, so building one in the constructor produces a
   * permanently suspended context and silence for the whole session. The first cue always follows a keypress.
   */
  private ensure(): AudioContext | null {
    if (this.failed) return null;
    if (this.ctx) return this.ctx;
    const Ctor = audioContextCtor();
    if (!Ctor) {
      this.failed = true;
      return null;
    }
    try {
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = 0.7;
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      return ctx;
    } catch {
      this.failed = true;
      return null;
    }
  }

  /** Play one cue. A no-op when muted or when audio is unavailable. */
  play(name: CueName): void {
    if (this.muted) return;
    const shape = CUES[name];
    if (!shape) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    try {
      // A context suspended by autoplay policy resumes on the first gesture-driven cue.
      if (ctx.state === 'suspended') void ctx.resume();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = shape.type;
      osc.frequency.setValueAtTime(shape.from, now);
      if (shape.to !== shape.from) {
        // Exponential rather than linear: pitch is perceived logarithmically, so a linear sweep sounds like it
        // spends most of its time at the top.
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, shape.to), now + shape.duration);
      }
      // Attack is a ramp rather than a jump, because a gain that starts at full value clicks.
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(shape.peak, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + shape.duration);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(now);
      osc.stop(now + shape.duration + 0.02);
      // Release the nodes when the tone ends; a finished node is garbage, not a resource to reuse.
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    } catch {
      // A single failed cue must never take the frame with it.
    }
  }
}

/** The cue table, exported so a test can assert its properties without reaching into the class. */
export const CUE_TABLE: Readonly<Record<CueName, CueShape>> = CUES;
