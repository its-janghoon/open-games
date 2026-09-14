import { describe, it, expect } from 'vitest';

import {
  ATTACKS,
  boxesOverlap,
  createFighter,
  hitBox,
  RING,
  type AttackId,
  type Fighter,
  type Stance,
} from './fightState';
import {
  attackProgress,
  poseFor,
  segments,
  SEGMENT_LENGTHS,
  solveLimb,
  strikingJoint,
  type Pose,
} from './pose';

const STANCES: Stance[] = [
  'idle',
  'walk',
  'crouch',
  'jump',
  'attack',
  'block',
  'hitstun',
  'knockdown',
];
const ATTACK_IDS: AttackId[] = ['jab', 'kick', 'slam'];

function at(stance: Stance, over: Partial<Fighter> = {}): Fighter {
  return { ...createFighter('p1', 'left'), stance, ...over };
}

/** Every tick of an attack from the first frame of startup to the last of recovery. */
function attackTimeline(id: AttackId, over: Partial<Fighter> = {}): { fighter: Fighter; tick: number }[] {
  const spec = ATTACKS[id];
  const total = spec.startup + spec.active + spec.recovery;
  const fighter = at('attack', { attack: id, stanceUntil: total, ...over });
  return Array.from({ length: total }, (_, tick) => ({ fighter, tick }));
}

function segmentLengths(pose: Pose): number[] {
  return segments(pose).map(([a, b]) => Math.hypot(a.x - b.x, a.y - b.y));
}

describe('pose purity', () => {
  it('is a pure function — same fighter and tick, same pose', () => {
    // The property that keeps the pose out of the rollback. If this ever needs a stored clock, the
    // clock becomes snapshot state and a rewind can draw the wrong frame.
    for (const stance of STANCES) {
      const fighter = at(stance, { attack: 'kick', stanceUntil: 30 });
      expect(poseFor(fighter, 17)).toEqual(poseFor(fighter, 17));
    }
  });

  it('can be computed for any tick, including one a rollback has replayed', () => {
    // Recomputed out of order, which is exactly what a replay does.
    const fighter = at('attack', { attack: 'slam', stanceUntil: 40 });
    const forwards = [5, 6, 7, 8].map((tick) => poseFor(fighter, tick));
    const backwards = [8, 7, 6, 5].map((tick) => poseFor(fighter, tick)).reverse();
    expect(backwards).toEqual(forwards);
  });
});

describe('limb lengths', () => {
  it('are identical in every stance', () => {
    // The failure mode this design exists to prevent. Interpolating joint POSITIONS shortens a limb
    // at the midpoint of any transition, so an arm visibly stretches; interpolating ANGLES over fixed
    // segments cannot, because the lengths are constants.
    for (const stance of STANCES) {
      const lengths = segmentLengths(poseFor(at(stance, { attack: 'jab', stanceUntil: 12 }), 3));
      lengths.forEach((length, index) => {
        expect(length, `${stance} segment ${index}`).toBeCloseTo(SEGMENT_LENGTHS[index], 6);
      });
    }
  });

  it('are identical on every tick of every attack, including mid-transition', () => {
    // Mid-transition is where a position-interpolated skeleton is most wrong, so every frame is
    // checked rather than the endpoints.
    for (const id of ATTACK_IDS) {
      for (const { fighter, tick } of attackTimeline(id)) {
        const lengths = segmentLengths(poseFor(fighter, tick));
        lengths.forEach((length, index) => {
          expect(length, `${id} tick ${tick} segment ${index}`).toBeCloseTo(
            SEGMENT_LENGTHS[index],
            6,
          );
        });
      }
    }
  });

  it('do not change when the fighter faces the other way', () => {
    const left = poseFor(at('attack', { attack: 'slam', stanceUntil: 40, facing: 1 }), 15);
    const right = poseFor(at('attack', { attack: 'slam', stanceUntil: 40, facing: -1 }), 15);
    const l = segmentLengths(left);
    segmentLengths(right).forEach((length, index) => expect(length).toBeCloseTo(l[index], 6));
  });
});

describe('what is drawn is what hits', () => {
  it('puts the striking joint inside the attack’s own hitbox for the whole active window', () => {
    // Without this the drawn limb and the box that damages you are two different claims about the
    // fighter's range, and the player learns whichever one hurts. The tuning is checked rather than
    // trusted: change a strike angle or a reach value and this fails.
    for (const id of ATTACK_IDS) {
      const spec = ATTACKS[id];
      const total = spec.startup + spec.active + spec.recovery;
      const fighter = at('attack', { attack: id, stanceUntil: total });
      for (let tick = spec.startup; tick < spec.startup + spec.active; tick += 1) {
        const box = hitBox(fighter, tick);
        expect(box, `${id} must have a live hitbox at tick ${tick}`).not.toBeNull();
        const pose = poseFor(fighter, tick);
        const joint = strikingJoint(pose);
        expect(joint, `${id} must name a striking limb`).not.toBeNull();
        const point = { x: joint!.x, y: joint!.y, halfWidth: 0, halfHeight: 0 };
        expect(boxesOverlap(point, box!), `${id} tick ${tick}: joint outside its own hitbox`).toBe(
          true,
        );
      }
    }
  });

  it('names no striking limb when nothing is out', () => {
    for (const stance of STANCES.filter((s) => s !== 'attack')) {
      expect(poseFor(at(stance), 5).striking).toBe('none');
    }
  });

  it('throws the kick with a leg and the punches with an arm', () => {
    // Not cosmetic: the reach test above only means something if the limb checked is the limb the
    // attack actually uses.
    const strikingAt = (id: AttackId) => {
      const spec = ATTACKS[id];
      const total = spec.startup + spec.active + spec.recovery;
      return poseFor(at('attack', { attack: id, stanceUntil: total }), spec.startup).striking;
    };
    expect(strikingAt('jab')).toBe('armFront');
    expect(strikingAt('slam')).toBe('armFront');
    expect(strikingAt('kick')).toBe('legFront');
  });
});

describe('continuity', () => {
  it('does not teleport between adjacent ticks of an attack', () => {
    /**
     * Stated as an OUTLIER test, not a speed cap, and the first version got that wrong: it capped
     * per-tick joint movement at 14 units and the kick's foot legitimately travels 14.07 in one tick.
     * A kick IS fast — capping speed measures the wrong thing. What a snap actually looks like is one
     * step far larger than its neighbours, so the largest step is compared against the second largest.
     * Smooth motion, however quick, has several comparable steps; a discontinuity has exactly one.
     */
    for (const id of ATTACK_IDS) {
      const frames = attackTimeline(id);
      const steps: number[] = [];
      for (let i = 1; i < frames.length; i += 1) {
        const previous = poseFor(frames[i - 1].fighter, frames[i - 1].tick);
        const current = poseFor(frames[i].fighter, frames[i].tick);
        let worst = 0;
        for (const key of Object.keys(current) as (keyof Pose)[]) {
          const a = previous[key];
          const b = current[key];
          if (typeof a !== 'object' || typeof b !== 'object') continue;
          worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y));
        }
        steps.push(worst);
      }
      const sorted = [...steps].sort((x, y) => y - x);
      const [largest, second] = sorted;
      expect(second, `${id} should move over several ticks, not one`).toBeGreaterThan(0.5);
      expect(largest / second, `${id} has one step ${largest.toFixed(1)} against ${second.toFixed(1)}`)
        .toBeLessThan(2.5);
    }
  });

  it('starts an attack from the resting pose, so committing does not snap', () => {
    const id: AttackId = 'slam';
    const spec = ATTACKS[id];
    const total = spec.startup + spec.active + spec.recovery;
    const resting = poseFor(at('idle'), 0);
    const firstFrame = poseFor(at('attack', { attack: id, stanceUntil: total }), 0);
    expect(Math.hypot(resting.handFront.x - firstFrame.handFront.x, resting.handFront.y - firstFrame.handFront.y))
      .toBeLessThan(1);
  });

  it('ends recovery back at the resting pose, so the next action starts from neutral', () => {
    const id: AttackId = 'jab';
    const spec = ATTACKS[id];
    const total = spec.startup + spec.active + spec.recovery;
    const last = poseFor(at('attack', { attack: id, stanceUntil: total }), total - 1);
    const resting = poseFor(at('idle'), 0);
    // Not zero — the last frame of recovery is one step short of neutral — but close.
    expect(Math.hypot(last.handFront.x - resting.handFront.x, last.handFront.y - resting.handFront.y))
      .toBeLessThan(4);
  });
});

describe('ground', () => {
  it('keeps both feet at or above the floor in every grounded stance', () => {
    // A foot below the floor line reads as the fighter sinking into the stage.
    for (const stance of STANCES.filter((s) => s !== 'jump')) {
      const pose = poseFor(at(stance, { attack: 'kick', stanceUntil: 23 }), 8);
      expect(pose.footFront.y, `${stance} front foot`).toBeGreaterThanOrEqual(RING.floorY - 0.001);
      expect(pose.footBack.y, `${stance} back foot`).toBeGreaterThanOrEqual(RING.floorY - 0.001);
    }
  });

  it('keeps the head above the pelvis except when knocked down', () => {
    for (const stance of STANCES.filter((s) => s !== 'knockdown')) {
      const pose = poseFor(at(stance), 4);
      expect(pose.head.y, stance).toBeGreaterThan(pose.pelvis.y);
    }
  });

  it('drops the head low when knocked down, since that is the whole read', () => {
    const down = poseFor(at('knockdown'), 4);
    const up = poseFor(at('idle'), 4);
    expect(down.head.y).toBeLessThan(up.head.y);
  });
});

describe('the IK solver itself', () => {
  /**
   * Tested directly because the pose tests cannot reach it. Injecting a bug into the reach CLAMP —
   * removing it entirely — failed nothing at all, for the plain reason that no stance currently aims
   * a limb beyond its own length, so the clamp never fires. Guard code that no test exercises is
   * exactly where a regression waits: add one attack with a longer reach and a stretching limb ships.
   */
  const root = { x: 0, y: 0 };
  const UPPER = 17;
  const LOWER = 17;
  const lengthsOf = (result: { mid: { x: number; y: number }; end: { x: number; y: number } }) => [
    Math.hypot(result.mid.x - root.x, result.mid.y - root.y),
    Math.hypot(result.end.x - result.mid.x, result.end.y - result.mid.y),
  ];

  it('reaches a target that is within range exactly', () => {
    const target = { x: 20, y: 8 };
    const result = solveLimb(root, target, UPPER, LOWER, 1);
    expect(result.end.x).toBeCloseTo(target.x, 6);
    expect(result.end.y).toBeCloseTo(target.y, 6);
  });

  it('keeps both segment lengths for a target beyond reach, pointing at it fully extended', () => {
    // The behaviour the clamp exists for. Stretching would satisfy the target and break the one
    // invariant this whole approach is built on.
    const target = { x: 500, y: 0 };
    const result = solveLimb(root, target, UPPER, LOWER, 1);
    const [upper, lower] = lengthsOf(result);
    expect(upper).toBeCloseTo(UPPER, 4);
    expect(lower).toBeCloseTo(LOWER, 4);
    expect(Math.hypot(result.end.x, result.end.y), 'fully extended, not stretched').toBeCloseTo(
      UPPER + LOWER,
      2,
    );
  });

  it('keeps both segment lengths for a target far too close', () => {
    const result = solveLimb(root, { x: 0.2, y: 0 }, UPPER, LOWER, 1);
    const [upper, lower] = lengthsOf(result);
    expect(upper).toBeCloseTo(UPPER, 4);
    expect(lower).toBeCloseTo(LOWER, 4);
  });

  it('returns numbers, not NaN, for a target exactly on the root', () => {
    // A degenerate target has no direction. NaN here would poison every downstream comparison
    // silently — every distance check would pass by being neither greater nor less.
    const result = solveLimb(root, { ...root }, UPPER, LOWER, 1);
    for (const value of [result.mid.x, result.mid.y, result.end.x, result.end.y]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('bends to opposite sides for opposite bend signs, and never flips on its own', () => {
    // The bend sign is why an elbow and a knee can share one solver. Without it the solver would pick
    // between its two mirror solutions arbitrarily and a joint would snap sideways mid-animation.
    const target = { x: 22, y: 0 };
    const positive = solveLimb(root, target, UPPER, LOWER, 1);
    const negative = solveLimb(root, target, UPPER, LOWER, -1);
    expect(Math.sign(positive.mid.y)).toBe(-Math.sign(negative.mid.y));
    expect(positive.mid.y).not.toBeCloseTo(0, 3);
  });

  it('holds segment lengths across a sweep of every reachable and unreachable target', () => {
    for (let angle = 0; angle < Math.PI * 2; angle += 0.2) {
      for (const distance of [0, 1, 10, 20, 33.9, 34, 40, 200]) {
        const target = { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
        const [upper, lower] = lengthsOf(solveLimb(root, target, UPPER, LOWER, 1));
        expect(upper, `angle ${angle.toFixed(1)} distance ${distance}`).toBeCloseTo(UPPER, 4);
        expect(lower, `angle ${angle.toFixed(1)} distance ${distance}`).toBeCloseTo(LOWER, 4);
      }
    }
  });
});

describe('attackProgress', () => {
  it('reports each phase with a fraction that runs from 0 towards 1', () => {
    const id: AttackId = 'kick';
    const spec = ATTACKS[id];
    const total = spec.startup + spec.active + spec.recovery;
    const fighter = at('attack', { attack: id, stanceUntil: total });
    const seen = new Map<string, number[]>();
    for (let tick = 0; tick < total; tick += 1) {
      const { phase, t } = attackProgress(fighter, tick);
      if (!seen.has(phase)) seen.set(phase, []);
      seen.get(phase)!.push(t);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(1.0001);
    }
    expect([...seen.keys()]).toEqual(['startup', 'active', 'recovery']);
    for (const [phase, values] of seen) {
      const sorted = [...values].sort((a, b) => a - b);
      expect(values, `${phase} must not run backwards`).toEqual(sorted);
    }
  });

  it('reports no phase when the fighter is not attacking', () => {
    expect(attackProgress(at('idle'), 3)).toEqual({ phase: 'none', t: 0 });
  });
});
