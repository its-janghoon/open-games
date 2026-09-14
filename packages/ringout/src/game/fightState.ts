/**
 * The fighter's world, complete.
 *
 * This is the phase's actual claim. champs' WorldState is deliberately PARTIAL — its structures,
 * minion waves and gold still live in the scene, so a rollback there is proven for champion combat
 * and nothing else. A fighter has no such tail: the entire world is two bodies, their timers, and
 * the hitboxes currently out. So everything that decides the match fits in one plain object, and a
 * replay can be exactly right rather than right about the part that was extracted.
 *
 * Every field here is plain data with no class instance, Map or Set anywhere, because the rollback
 * core compares inputs with JSON.stringify and clones states by hand. Deadlines are ABSOLUTE tick
 * numbers rather than counting-down timers, for the same reason champs' life state was already
 * correct: a countdown decremented per frame cannot be rewound without also knowing how many frames
 * were undone, while a deadline compared against a restored clock is right by construction.
 */

/** Which side of the ring a fighter starts on. */
export type Side = 'left' | 'right';

/**
 * A fighter's mutually exclusive action state.
 *
 * Exclusive on purpose: a fighter that is both attacking and blocking is the ambiguity that makes
 * two peers disagree about whether a hit landed. One field, one truth.
 */
export type Stance =
  | 'idle'
  | 'walk'
  | 'crouch'
  | 'jump'
  | 'attack'
  | 'block'
  | 'hitstun'
  | 'knockdown';

export interface Fighter {
  id: string;
  side: Side;
  /** Ring position. y is height above the floor; 0 is standing. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Which way the fighter faces: +1 right, -1 left. Decided by the opponent, not by input. */
  facing: 1 | -1;
  hp: number;
  stance: Stance;
  /** Tick the current stance ends on. Absolute, never a countdown. */
  stanceUntil: number;
  /** Which attack is out, or null. Indexes ATTACKS. */
  attack: AttackId | null;
  /**
   * Set once an attack has connected, so one swing cannot hit twice.
   *
   * In the state rather than in a closure because a rollback must be able to un-consume it: replay a
   * tick where the hit had not landed yet and the flag has to be false again.
   */
  attackConnected: boolean;
  /** Consecutive hits taken without recovering, for scaling. */
  combo: number;
}

export type AttackId = 'jab' | 'kick' | 'slam';

export interface AttackSpec {
  /** Ticks before the hitbox appears. */
  startup: number;
  /** Ticks the hitbox is live. */
  active: number;
  /** Ticks after the hitbox vanishes during which the attacker cannot act. */
  recovery: number;
  damage: number;
  /** Hitbox offset from the fighter's origin, in facing-relative units. */
  reach: number;
  height: number;
  halfWidth: number;
  halfHeight: number;
  /** Ticks of hitstun inflicted. */
  hitstun: number;
  pushback: number;
}

/**
 * Frame data. Kept as data rather than code because it is balance, and balance should be readable
 * and diffable by someone who is not reading the simulation.
 *
 * startup/active/recovery are the standard fighting-game decomposition, and they are in TICKS at the
 * fixed step below — not milliseconds. A duration in milliseconds would make the game's feel depend
 * on frame timing, which is exactly what a rollback cannot tolerate.
 */
export const ATTACKS: Record<AttackId, AttackSpec> = {
  jab: {
    startup: 3,
    active: 3,
    recovery: 6,
    damage: 4,
    reach: 26,
    height: 30,
    halfWidth: 14,
    halfHeight: 8,
    hitstun: 9,
    pushback: 3,
  },
  kick: {
    startup: 7,
    active: 4,
    recovery: 12,
    damage: 9,
    reach: 34,
    height: 18,
    halfWidth: 18,
    halfHeight: 10,
    hitstun: 14,
    pushback: 7,
  },
  slam: {
    startup: 13,
    active: 5,
    recovery: 22,
    damage: 16,
    reach: 30,
    height: 40,
    halfWidth: 20,
    halfHeight: 16,
    hitstun: 22,
    pushback: 14,
  },
};

export interface RingRules {
  /** Half-width of the ring; a fighter pushed past this is out. */
  halfWidth: number;
  floorY: number;
  gravity: number;
  jumpSpeed: number;
  walkSpeed: number;
  crouchSpeedFactor: number;
  maxHp: number;
  /** Fraction of damage a block absorbs. */
  blockAbsorb: number;
  /** Extra damage per combo hit, as a fraction. */
  comboScaling: number;
  knockdownTicks: number;
  /** Ticks a fighter is untouchable after getting up. */
  wakeupInvulnTicks: number;
}

export const RING: RingRules = {
  halfWidth: 420,
  floorY: 0,
  gravity: 1.4,
  jumpSpeed: 15,
  walkSpeed: 4.2,
  crouchSpeedFactor: 0.35,
  maxHp: 100,
  blockAbsorb: 0.75,
  comboScaling: 0.12,
  knockdownTicks: 40,
  wakeupInvulnTicks: 12,
};

/** Fixed step. 60 ticks per second, the rate the frame data above is written against. */
export const TICK_SECONDS = 1 / 60;

export type Outcome = { kind: 'ongoing' } | { kind: 'ko'; winner: string } | { kind: 'ringout'; winner: string } | { kind: 'draw' };

export interface FightState {
  tick: number;
  fighters: Fighter[];
  outcome: Outcome;
}

/** One fighter's buttons for one tick. Plain booleans so JSON comparison is exact. */
export interface FightInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  jab: boolean;
  kick: boolean;
  slam: boolean;
}

export const NEUTRAL_INPUT: FightInput = {
  left: false,
  right: false,
  up: false,
  down: false,
  jab: false,
  kick: false,
  slam: false,
};

export function createFighter(id: string, side: Side): Fighter {
  return {
    id,
    side,
    x: side === 'left' ? -140 : 140,
    y: RING.floorY,
    vx: 0,
    vy: 0,
    facing: side === 'left' ? 1 : -1,
    hp: RING.maxHp,
    stance: 'idle',
    stanceUntil: 0,
    attack: null,
    attackConnected: false,
    combo: 0,
  };
}

export function createFightState(ids: readonly [string, string]): FightState {
  return {
    tick: 0,
    fighters: [createFighter(ids[0], 'left'), createFighter(ids[1], 'right')],
    outcome: { kind: 'ongoing' },
  };
}

/**
 * A fully independent copy.
 *
 * Written out rather than structuredClone or a JSON round trip, for the reason champs' clone
 * documents: JSON drops undefined and flattens anything that is not a plain value, producing a
 * snapshot that looks right and restores wrong. Here the whole state is two objects and a tagged
 * union, so the explicit version is also the short one.
 */
export function cloneFightState(state: FightState): FightState {
  return {
    tick: state.tick,
    fighters: state.fighters.map((fighter) => ({ ...fighter })),
    outcome: { ...state.outcome } as Outcome,
  };
}

/** The phase of an attack at a given tick, derived from its start rather than counted down. */
export function attackPhase(
  fighter: Fighter,
  tick: number,
): 'none' | 'startup' | 'active' | 'recovery' {
  if (!fighter.attack || fighter.stance !== 'attack') return 'none';
  const spec = ATTACKS[fighter.attack];
  const total = spec.startup + spec.active + spec.recovery;
  const elapsed = total - (fighter.stanceUntil - tick);
  if (elapsed < spec.startup) return 'startup';
  if (elapsed < spec.startup + spec.active) return 'active';
  return 'recovery';
}

export interface Box {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
}

/** The fighter's own body box — what an opponent's attack can hit. */
export function bodyBox(fighter: Fighter): Box {
  const crouched = fighter.stance === 'crouch';
  const down = fighter.stance === 'knockdown';
  const halfHeight = down ? 12 : crouched ? 22 : 38;
  return {
    x: fighter.x,
    y: fighter.y + halfHeight,
    halfWidth: 16,
    halfHeight,
  };
}

/** The live hitbox of an attack, or null when nothing is out. */
export function hitBox(fighter: Fighter, tick: number): Box | null {
  if (attackPhase(fighter, tick) !== 'active' || !fighter.attack) return null;
  const spec = ATTACKS[fighter.attack];
  return {
    x: fighter.x + spec.reach * fighter.facing,
    y: fighter.y + spec.height,
    halfWidth: spec.halfWidth,
    halfHeight: spec.halfHeight,
  };
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return (
    Math.abs(a.x - b.x) <= a.halfWidth + b.halfWidth &&
    Math.abs(a.y - b.y) <= a.halfHeight + b.halfHeight
  );
}
