import { describe, it, expect } from 'vitest';

import {
  ATTACKS,
  attackPhase,
  bodyBox,
  boxesOverlap,
  cloneFightState,
  createFightState,
  hitBox,
  NEUTRAL_INPUT,
  RING,
  type FightInput,
  type FightState,
} from './fightState';
import { stepFight } from './stepFight';

const press = (over: Partial<FightInput> = {}): FightInput => ({ ...NEUTRAL_INPUT, ...over });

function run(
  state: FightState,
  ticks: number,
  inputAt: (tick: number) => Map<string, FightInput>,
): FightState {
  let current = state;
  for (let i = 0; i < ticks; i += 1) {
    current = stepFight(current, inputAt(current.tick), current.tick + 1);
  }
  return current;
}

const fresh = () => createFightState(['p1', 'p2']);
const idle = () => new Map<string, FightInput>();

describe('fight state contract', () => {
  it('clones so that mutating the copy cannot touch the original', () => {
    const original = fresh();
    const copy = cloneFightState(original);
    copy.fighters[0].hp = 1;
    copy.fighters[0].x = -999;
    copy.tick = 500;
    copy.outcome = { kind: 'draw' };
    expect(original.fighters[0].hp).toBe(RING.maxHp);
    expect(original.fighters[0].x).toBe(-140);
    expect(original.tick).toBe(0);
    expect(original.outcome).toEqual({ kind: 'ongoing' });
  });

  it('round-trips through repeated cloning without drifting', () => {
    let current = fresh();
    for (let i = 0; i < 50; i += 1) current = cloneFightState(current);
    expect(current).toEqual(fresh());
  });

  it('does not mutate the state it was given', () => {
    // The contract the rollback core depends on. A step that mutates makes every snapshot a lie.
    const before = fresh();
    const untouched = cloneFightState(before);
    stepFight(before, new Map([['p1', press({ right: true, jab: true })]]), 1);
    expect(before).toEqual(untouched);
  });

  it('is deterministic: the same inputs from the same state give the same state', () => {
    const script = (tick: number) =>
      new Map([
        ['p1', press({ right: tick % 3 !== 0, jab: tick % 7 === 0 })],
        ['p2', press({ left: tick % 2 === 0, kick: tick % 11 === 0 })],
      ]);
    const first = run(fresh(), 120, script);
    const second = run(fresh(), 120, script);
    expect(first).toEqual(second);
  });
});

describe('facing', () => {
  it('is decided by position, not by input, so forward means the same to both players', () => {
    const state = fresh();
    expect(state.fighters[0].facing).toBe(1);
    // Teleport p1 past p2 and step: facing must flip from geometry alone.
    state.fighters[0].x = 300;
    const next = stepFight(state, idle(), 1);
    expect(next.fighters[0].facing).toBe(-1);
    expect(next.fighters[1].facing).toBe(1);
  });
});

describe('attack timing', () => {
  it('walks through startup, active and recovery in the tick counts the data declares', () => {
    // Derived from the deadline rather than counted down, so this also pins that the derivation
    // matches the frame data a designer reads.
    let state = fresh();
    state = stepFight(state, new Map([['p1', press({ jab: true })]]), 1);
    const spec = ATTACKS.jab;
    const phases: string[] = [];
    for (let i = 0; i < spec.startup + spec.active + spec.recovery + 1; i += 1) {
      phases.push(attackPhase(state.fighters[0], state.tick));
      state = stepFight(state, idle(), state.tick + 1);
    }
    expect(phases.slice(0, spec.startup).every((p) => p === 'startup')).toBe(true);
    expect(
      phases.slice(spec.startup, spec.startup + spec.active).every((p) => p === 'active'),
    ).toBe(true);
    expect(phases[phases.length - 1]).toBe('none');
  });

  it('has no hitbox during startup, which is what makes a slow attack punishable', () => {
    let state = fresh();
    state = stepFight(state, new Map([['p1', press({ slam: true })]]), 1);
    expect(hitBox(state.fighters[0], state.tick)).toBeNull();
    // Step into the active window and it appears.
    for (let i = 0; i < ATTACKS.slam.startup; i += 1) {
      state = stepFight(state, idle(), state.tick + 1);
    }
    expect(hitBox(state.fighters[0], state.tick)).not.toBeNull();
  });

  it('cannot be cancelled by pressing another button mid-attack', () => {
    let state = fresh();
    state = stepFight(state, new Map([['p1', press({ slam: true })]]), 1);
    state = stepFight(state, new Map([['p1', press({ jab: true })]]), 2);
    expect(state.fighters[0].attack, 'the committed attack stands').toBe('slam');
  });

  it('gives the heavier attack when several buttons are pressed on one tick', () => {
    // Deterministic by damage order rather than by field order in the input object, which would make
    // the outcome depend on how the object happened to be written.
    const state = stepFight(
      fresh(),
      new Map([['p1', press({ jab: true, kick: true, slam: true })]]),
      1,
    );
    expect(state.fighters[0].attack).toBe('slam');
  });
});

describe('hits', () => {
  it('connects once per swing, not once per active tick', () => {
    let state = fresh();
    state.fighters[0].x = -20;
    state.fighters[1].x = 0;
    state = stepFight(state, new Map([['p1', press({ jab: true })]]), 1);
    for (let i = 0; i < ATTACKS.jab.startup + ATTACKS.jab.active + 2; i += 1) {
      state = stepFight(state, idle(), state.tick + 1);
    }
    const dealt = RING.maxHp - state.fighters[1].hp;
    expect(dealt, 'exactly one jab of damage').toBeCloseTo(ATTACKS.jab.damage, 5);
  });

  it('resolves a trade simultaneously, so array order cannot decide who wins', () => {
    // Both fighters throw the same attack from the same distance on the same tick. The state is
    // symmetric, so both must take damage — a sequential resolution would let the first-checked
    // fighter put the other in hitstun and escape untouched.
    let state = fresh();
    state.fighters[0].x = -20;
    state.fighters[1].x = 20;
    state = stepFight(
      state,
      new Map([
        ['p1', press({ jab: true })],
        ['p2', press({ jab: true })],
      ]),
      1,
    );
    for (let i = 0; i < ATTACKS.jab.startup + ATTACKS.jab.active + 1; i += 1) {
      state = stepFight(state, idle(), state.tick + 1);
    }
    expect(state.fighters[0].hp).toBeLessThan(RING.maxHp);
    expect(state.fighters[1].hp).toBeLessThan(RING.maxHp);
    expect(state.fighters[0].hp).toBeCloseTo(state.fighters[1].hp, 5);
  });

  it('absorbs most of the damage when the victim holds back', () => {
    const hit = (block: boolean): number => {
      let state = fresh();
      state.fighters[0].x = -20;
      state.fighters[1].x = 20;
      // p2 faces left, so holding right is holding back.
      const victimInput = press(block ? { right: true } : {});
      state = stepFight(
        state,
        new Map([
          ['p1', press({ kick: true })],
          ['p2', victimInput],
        ]),
        1,
      );
      for (let i = 0; i < ATTACKS.kick.startup + ATTACKS.kick.active + 1; i += 1) {
        state = stepFight(state, new Map([['p2', victimInput]]), state.tick + 1);
      }
      return RING.maxHp - state.fighters[1].hp;
    };
    const open = hit(false);
    const blocked = hit(true);
    expect(blocked).toBeGreaterThan(0);
    expect(blocked).toBeLessThan(open);
  });

  it('cannot hit a crouching fighter with a high attack', () => {
    // The reason hitboxes carry a height at all: crouching must beat something, or there is no
    // reason ever to do it.
    let state = fresh();
    state.fighters[0].x = -20;
    state.fighters[1].x = 14;
    state.fighters[1].stance = 'crouch';
    const high = { ...ATTACKS.jab, height: 70 };
    const attacker = { ...state.fighters[0], attack: 'jab' as const, stance: 'attack' as const };
    const box = {
      x: attacker.x + high.reach * attacker.facing,
      y: attacker.y + high.height,
      halfWidth: high.halfWidth,
      halfHeight: high.halfHeight,
    };
    expect(boxesOverlap(box, bodyBox(state.fighters[1]))).toBe(false);
  });
});

describe('endings', () => {
  it('calls a ring-out for the fighter still inside', () => {
    const state = fresh();
    state.fighters[0].x = RING.halfWidth + 1;
    const next = stepFight(state, idle(), 1);
    expect(next.outcome).toEqual({ kind: 'ringout', winner: 'p2' });
  });

  it('calls a draw when both leave the ring on the same tick', () => {
    // Checked for both before either is declared, so the array order cannot award a win.
    const state = fresh();
    state.fighters[0].x = -(RING.halfWidth + 1);
    state.fighters[1].x = RING.halfWidth + 1;
    expect(stepFight(state, idle(), 1).outcome).toEqual({ kind: 'draw' });
  });

  it('calls a draw on a double knockout', () => {
    const state = fresh();
    state.fighters[0].hp = 0;
    state.fighters[1].hp = 0;
    expect(stepFight(state, idle(), 1).outcome).toEqual({ kind: 'draw' });
  });

  it('freezes once decided, so a finished fight cannot be played on', () => {
    let state = fresh();
    state.fighters[1].hp = 0;
    state = stepFight(state, idle(), 1);
    expect(state.outcome.kind).toBe('ko');
    const frozen = stepFight(state, new Map([['p1', press({ right: true })]]), 2);
    expect(frozen.fighters[0].x).toBe(state.fighters[0].x);
  });
});
