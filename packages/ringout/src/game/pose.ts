import { ATTACKS, attackPhase, RING, type AttackId, type Fighter } from './fightState';

/**
 * Procedural animation: the fighter's pose is COMPUTED from the fight state, never stored.
 *
 * No sprite sheets, no animation frames, no keyframe tracks. That is phase 6's point, and it is not
 * only aesthetic — it keeps the pose out of the rollback. A stored animation clock would be state:
 * rewind eight ticks and the arm would still be wherever the clock had reached, so the clock would
 * have to enter the snapshot and be restored with everything else. Derived from (fighter, tick), the
 * pose cannot desync, cannot be restored wrongly, costs nothing in the snapshot, and can be computed
 * for any tick at all — including one a rollback has just replayed.
 *
 * The skeleton is driven by TARGETS and solved with two-bone inverse kinematics, which is the second
 * version of this file. The first drove joints from hand-tuned angles and failed its own tests in two
 * ways that were not tuning mistakes but consequences of the approach:
 *
 *   - The striking hand only reached full extension at the END of the active window, while the
 *     hitbox is live for all of it. So for two of three active frames the drawn limb was short of the
 *     box that damages you. Chasing that with angle values is endless, because every change to an
 *     attack's reach re-breaks it.
 *   - Resting legs are 38 long against a 34 pelvis height, so a straight-legged rest put the feet
 *     3.2 units UNDER the floor.
 *
 * With IK both become structural. A limb is given the point it should reach; the solver returns a
 * mid-joint that satisfies the segment lengths exactly, and clamps to full extension when the target
 * is out of range. So the hand is inside its own hitbox because it is AIMED at the hitbox's centre,
 * and the feet are on the floor because the floor is what they are aimed at. Constant limb length
 * comes free: the solver never scales a bone, it only rotates it.
 */

export interface Joint {
  x: number;
  y: number;
}

export interface Pose {
  pelvis: Joint;
  chest: Joint;
  head: Joint;
  headRadius: number;
  shoulderFront: Joint;
  elbowFront: Joint;
  handFront: Joint;
  shoulderBack: Joint;
  elbowBack: Joint;
  handBack: Joint;
  hipFront: Joint;
  kneeFront: Joint;
  footFront: Joint;
  hipBack: Joint;
  kneeBack: Joint;
  footBack: Joint;
  striking: 'none' | 'armFront' | 'legFront';
}

/**
 * Segment lengths — constants, and the only guarantee that matters: no code path scales them.
 * Total leg is 38 against a 34 pelvis height, so a resting leg is always slightly bent, which is
 * both anatomically right and what stops the foot punching through the floor.
 */
export const SKELETON = {
  pelvisY: 34,
  spine: 22,
  neck: 10,
  headRadius: 8,
  shoulderDrop: 2,
  shoulderSpread: 6,
  upperArm: 17,
  forearm: 17,
  hipSpread: 6,
  thigh: 19,
  shin: 19,
} as const;

const STRIKING_LIMB: Record<AttackId, 'armFront' | 'legFront'> = {
  jab: 'armFront',
  kick: 'legFront',
  slam: 'armFront',
};

export interface AttackProgress {
  phase: 'none' | 'startup' | 'active' | 'recovery';
  /** How far through the CURRENT phase, in [0, 1]. */
  t: number;
}

export function attackProgress(fighter: Fighter, tick: number): AttackProgress {
  const phase = attackPhase(fighter, tick);
  if (phase === 'none' || !fighter.attack) return { phase: 'none', t: 0 };
  const spec = ATTACKS[fighter.attack];
  const total = spec.startup + spec.active + spec.recovery;
  const elapsed = total - (fighter.stanceUntil - tick);
  if (phase === 'startup') return { phase, t: clamp01(elapsed / spec.startup) };
  if (phase === 'active') return { phase, t: clamp01((elapsed - spec.startup) / spec.active) };
  return { phase, t: clamp01((elapsed - spec.startup - spec.active) / spec.recovery) };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function ease(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpPoint(a: Joint, b: Joint, t: number): Joint {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

/**
 * Two-bone IK. Returns the mid joint and the reached end point.
 *
 * `bend` picks which of the two mirror solutions to take — a knee bends one way and an elbow the
 * other, and without it the solver would flip between them and produce a joint that snaps sideways
 * between adjacent frames.
 *
 * An unreachable target is CLAMPED to full extension rather than refused, so a limb aimed too far
 * simply points at the target fully extended. Refusing would mean the pose has no answer for a
 * perfectly ordinary situation, and stretching would break the one invariant this file exists to
 * hold.
 */
export function solveLimb(
  root: Joint,
  target: Joint,
  upper: number,
  lower: number,
  bend: 1 | -1,
): { mid: Joint; end: Joint } {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const reach = upper + lower;
  const minimum = Math.abs(upper - lower) + 1e-4;
  let distance = Math.hypot(dx, dy);
  let ux: number;
  let uy: number;
  if (distance < 1e-6) {
    // Degenerate: a target on top of the root has no direction. Pick a fixed one rather than
    // producing NaN, since a NaN joint would silently poison every downstream comparison.
    ux = 0;
    uy = -1;
    distance = minimum;
  } else {
    ux = dx / distance;
    uy = dy / distance;
  }
  const clamped = Math.min(reach - 1e-4, Math.max(minimum, distance));
  const a = (upper * upper - lower * lower + clamped * clamped) / (2 * clamped);
  const hSquared = upper * upper - a * a;
  const h = Math.sqrt(Math.max(0, hSquared));
  const mid: Joint = {
    x: root.x + ux * a + -uy * h * bend,
    y: root.y + uy * a + ux * h * bend,
  };
  const end: Joint = {
    x: root.x + ux * clamped,
    y: root.y + uy * clamped,
  };
  return { mid, end };
}

/** Where a limb should reach, in world coordinates, plus how the joint bends. */
interface Targets {
  pelvisY: number;
  lean: number;
  handFront: Joint;
  handBack: Joint;
  footFront: Joint;
  footBack: Joint;
}

/**
 * The strike target for an attack: the CENTRE of its own hitbox.
 *
 * This is what makes "what is drawn is what hits" structural instead of tuned. Change an attack's
 * reach or height in the frame data and the limb follows automatically, because the limb is aimed at
 * the box rather than at a number that happened to agree with the box.
 */
function strikeTarget(fighter: Fighter, id: AttackId): Joint {
  const spec = ATTACKS[id];
  return {
    x: fighter.x + spec.reach * fighter.facing,
    y: fighter.y + spec.height,
  };
}

function restTargets(fighter: Fighter): Targets {
  const dir = fighter.facing;
  return {
    pelvisY: fighter.y + SKELETON.pelvisY,
    lean: 0.04,
    handFront: { x: fighter.x + 11 * dir, y: fighter.y + 40 },
    handBack: { x: fighter.x + 4 * dir, y: fighter.y + 44 },
    footFront: { x: fighter.x + 11 * dir, y: fighter.y + RING.floorY },
    footBack: { x: fighter.x - 12 * dir, y: fighter.y + RING.floorY },
  };
}

function targetsFor(fighter: Fighter, tick: number): Targets {
  const dir = fighter.facing;
  const rest = restTargets(fighter);

  switch (fighter.stance) {
    case 'walk': {
      // Derived from the tick, which is already state, so the gait needs no clock of its own and two
      // peers on the same tick draw the same step.
      const swing = Math.sin(tick * 0.28);
      return {
        ...rest,
        footFront: { x: rest.footFront.x + swing * 9 * dir, y: fighter.y + Math.max(0, swing * 5) },
        footBack: { x: rest.footBack.x - swing * 9 * dir, y: fighter.y + Math.max(0, -swing * 5) },
        handFront: { x: rest.handFront.x - swing * 5 * dir, y: rest.handFront.y },
        handBack: { x: rest.handBack.x + swing * 5 * dir, y: rest.handBack.y },
      };
    }
    case 'crouch':
      return {
        ...rest,
        pelvisY: fighter.y + 22,
        lean: 0.22,
        handFront: { x: fighter.x + 12 * dir, y: fighter.y + 26 },
        handBack: { x: fighter.x + 3 * dir, y: fighter.y + 28 },
        footFront: { x: fighter.x + 13 * dir, y: fighter.y + RING.floorY },
        footBack: { x: fighter.x - 13 * dir, y: fighter.y + RING.floorY },
      };
    case 'jump':
      // Feet tucked, which is why the floor invariant is not asserted for this stance.
      return {
        ...rest,
        lean: 0.1,
        footFront: { x: fighter.x + 9 * dir, y: fighter.y + 14 },
        footBack: { x: fighter.x - 9 * dir, y: fighter.y + 18 },
        handFront: { x: fighter.x + 6 * dir, y: fighter.y + 52 },
        handBack: { x: fighter.x - 2 * dir, y: fighter.y + 54 },
      };
    case 'block':
      // Forearms up and in. A block has to LOOK like a block: it is the only cue the opponent gets.
      return {
        ...rest,
        lean: -0.2,
        handFront: { x: fighter.x + 9 * dir, y: fighter.y + 56 },
        handBack: { x: fighter.x + 5 * dir, y: fighter.y + 50 },
      };
    case 'hitstun':
      return {
        ...rest,
        lean: -0.34,
        pelvisY: fighter.y + 32,
        handFront: { x: fighter.x - 4 * dir, y: fighter.y + 42 },
        handBack: { x: fighter.x - 9 * dir, y: fighter.y + 40 },
      };
    case 'knockdown':
      return {
        ...rest,
        pelvisY: fighter.y + 12,
        lean: -1.15,
        handFront: { x: fighter.x - 16 * dir, y: fighter.y + 6 },
        handBack: { x: fighter.x - 22 * dir, y: fighter.y + 4 },
        footFront: { x: fighter.x + 20 * dir, y: fighter.y + RING.floorY },
        footBack: { x: fighter.x + 14 * dir, y: fighter.y + RING.floorY },
      };
    case 'attack': {
      const id = fighter.attack;
      const { phase, t } = attackProgress(fighter, tick);
      if (!id || phase === 'none') return rest;
      const limb = STRIKING_LIMB[id];
      const strikePoint = strikeTarget(fighter, id);
      const restPoint = limb === 'armFront' ? rest.handFront : rest.footFront;
      const spec = ATTACKS[id];
      // Wind-up pulls the limb BACK before it goes forward, which is what makes a startup readable.
      const windPoint: Joint = {
        x: restPoint.x - 14 * dir,
        y: restPoint.y + (limb === 'armFront' ? 4 : 6),
      };
      /**
       * A wind-up is only drawn when startup is long enough to SHOW one.
       *
       * Measured, not assumed: with a wind-up forced into the jab's 3-tick startup, the elbow moved
       * 17 units in a single tick — the pull-back and the extension both had to happen in about one
       * frame, which reads as a snap rather than as an anticipation. That is not a tuning problem, it
       * is what happens when two moves are packed into three frames. A fast poke having almost no
       * telegraph is also correct for the game: it is exactly why a jab is safe and a slam is not.
       */
      const windUp = spec.startup >= 5;

      /**
       * The limb reaches the strike point by the END of STARTUP and holds there for the whole active
       * window. That ordering is the fix for the first version's real defect: the hitbox is live for
       * every active frame, so the limb has to be extended for every active frame. Arriving during
       * active — the intuitive reading of "the attack happens now" — draws a short limb while a
       * full-length hitbox is already hurting people.
       */
      const reached: Joint =
        phase === 'startup'
          ? windUp
            ? t < 0.45
              ? lerpPoint(restPoint, windPoint, ease(t / 0.45))
              : lerpPoint(windPoint, strikePoint, ease((t - 0.45) / 0.55))
            : lerpPoint(restPoint, strikePoint, ease(t))
          : phase === 'active'
            ? strikePoint
            : lerpPoint(strikePoint, restPoint, ease(t));

      const leanTowards = phase === 'recovery' ? lerp(0.28, 0.04, ease(t)) : 0.04 + 0.24 * ease(t);
      const base: Targets = { ...rest, lean: limb === 'legFront' ? -leanTowards : leanTowards };
      return limb === 'armFront'
        ? { ...base, handFront: reached }
        : { ...base, footFront: reached, footBack: rest.footBack };
    }
    default:
      return rest;
  }
}

export function poseFor(fighter: Fighter, tick: number): Pose {
  const targets = targetsFor(fighter, tick);
  const dir = fighter.facing;
  const S = SKELETON;

  const pelvis: Joint = { x: fighter.x, y: targets.pelvisY };
  const chest: Joint = {
    x: pelvis.x + Math.sin(targets.lean) * S.spine * dir,
    y: pelvis.y + Math.cos(targets.lean) * S.spine,
  };
  const head: Joint = {
    x: chest.x + Math.sin(targets.lean) * S.neck * dir,
    y: chest.y + Math.cos(targets.lean) * S.neck,
  };

  const shoulderFront: Joint = {
    x: chest.x + S.shoulderSpread * 0.4 * dir,
    y: chest.y - S.shoulderDrop,
  };
  const shoulderBack: Joint = {
    x: chest.x - S.shoulderSpread * 0.6 * dir,
    y: chest.y - S.shoulderDrop,
  };
  const hipFront: Joint = { x: pelvis.x + S.hipSpread * 0.4 * dir, y: pelvis.y };
  const hipBack: Joint = { x: pelvis.x - S.hipSpread * 0.6 * dir, y: pelvis.y };

  // Bend directions are fixed per limb so the solver never flips between its two mirror solutions,
  // which would snap a joint sideways between adjacent frames.
  const armBend = (dir === 1 ? -1 : 1) as 1 | -1;
  const legBend = (dir === 1 ? 1 : -1) as 1 | -1;

  const front = solveLimb(shoulderFront, targets.handFront, S.upperArm, S.forearm, armBend);
  const back = solveLimb(shoulderBack, targets.handBack, S.upperArm, S.forearm, armBend);
  const legF = solveLimb(hipFront, targets.footFront, S.thigh, S.shin, legBend);
  const legB = solveLimb(hipBack, targets.footBack, S.thigh, S.shin, legBend);

  const striking =
    fighter.stance === 'attack' && fighter.attack && attackPhase(fighter, tick) !== 'none'
      ? STRIKING_LIMB[fighter.attack]
      : 'none';

  return {
    pelvis,
    chest,
    head,
    headRadius: S.headRadius,
    shoulderFront,
    elbowFront: front.mid,
    handFront: front.end,
    shoulderBack,
    elbowBack: back.mid,
    handBack: back.end,
    hipFront,
    kneeFront: legF.mid,
    footFront: legF.end,
    hipBack,
    kneeBack: legB.mid,
    footBack: legB.end,
    striking,
  };
}

export function strikingJoint(pose: Pose): Joint | null {
  if (pose.striking === 'armFront') return pose.handFront;
  if (pose.striking === 'legFront') return pose.footFront;
  return null;
}

/** Segment endpoints, so the renderer and the tests share one definition of what a limb is. */
export function segments(pose: Pose): [Joint, Joint][] {
  return [
    [pose.pelvis, pose.chest],
    [pose.chest, pose.head],
    [pose.shoulderFront, pose.elbowFront],
    [pose.elbowFront, pose.handFront],
    [pose.shoulderBack, pose.elbowBack],
    [pose.elbowBack, pose.handBack],
    [pose.hipFront, pose.kneeFront],
    [pose.kneeFront, pose.footFront],
    [pose.hipBack, pose.kneeBack],
    [pose.kneeBack, pose.footBack],
  ];
}

export const SEGMENT_LENGTHS = [
  SKELETON.spine,
  SKELETON.neck,
  SKELETON.upperArm,
  SKELETON.forearm,
  SKELETON.upperArm,
  SKELETON.forearm,
  SKELETON.thigh,
  SKELETON.shin,
  SKELETON.thigh,
  SKELETON.shin,
];
