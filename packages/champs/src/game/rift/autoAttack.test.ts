import { describe, expect, it } from 'vitest';

import type { Unit } from '../combat';
import {
  attackIntervalFor,
  cloneAutoAttackers,
  flightTime,
  resolveAutoAttacks,
  type AutoAttacker,
} from './autoAttack';

const SPEED = 700;

function turret(over: Partial<AutoAttacker> = {}): AutoAttacker {
  return {
    id: 't1',
    team: 'ally',
    pos: { x: 0, y: 0 },
    ad: 90,
    attackRange: 200,
    attackCdRemaining: 0,
    attackSpeed: 1,
    stunned: 0,
    dead: false,
    ...over,
  };
}

function foe(id: string, x: number, over: Partial<Unit> = {}): Unit {
  return {
    id,
    kind: 'champion',
    team: 'enemy',
    pos: { x, y: 0 },
    hp: 600,
    maxHp: 600,
    ad: 60,
    armor: 0,
    attackRange: 150,
    attackSpeed: 0.8,
    moveSpeed: 340,
    attackCdRemaining: 0,
    dead: false,
    ...over,
  };
}

describe('auto-attackers', () => {
  it('shoots a hostile in range and goes on cooldown', () => {
    const result = resolveAutoAttacks([turret()], [foe('e1', 100)], {}, 1 / 60, SPEED);
    expect(result.shots).toHaveLength(1);
    expect(result.shots[0]).toMatchObject({ sourceId: 't1', targetId: 'e1', rawDamage: 90 });
    expect(result.attackers[0].attackCdRemaining).toBeGreaterThan(0);
  });

  it('gives the shot a flight time proportional to the gap', () => {
    // The caller turns this into an absolute dueAt, so a wrong flight time would land damage at the wrong moment rather
    // than not at all — the kind of error a range check would never catch.
    const near = resolveAutoAttacks([turret()], [foe('e1', 70)], {}, 1 / 60, SPEED);
    const far = resolveAutoAttacks([turret()], [foe('e1', 140)], {}, 1 / 60, SPEED);
    expect(far.shots[0].flightSeconds).toBeCloseTo(near.shots[0].flightSeconds * 2, 6);
  });

  it('does not shoot out of range, and holds no lock', () => {
    const result = resolveAutoAttacks([turret()], [foe('e1', 999)], {}, 1 / 60, SPEED);
    expect(result.shots).toHaveLength(0);
    expect(result.targets.t1).toBeNull();
  });

  it('never shoots its own team', () => {
    const result = resolveAutoAttacks([turret()], [foe('f1', 50, { team: 'ally' })], {}, 1 / 60, SPEED);
    expect(result.shots).toHaveLength(0);
  });

  it('does nothing while stunned, and drops its lock', () => {
    /**
     * Dropping the lock matters: a stunned turret that kept its target would resume firing at an enemy that had walked
     * away, and no peer could predict that from the geometry.
     */
    const result = resolveAutoAttacks(
      [turret({ stunned: 1 })],
      [foe('e1', 50)],
      { t1: 'e1' },
      1 / 60,
      SPEED,
    );
    expect(result.shots).toHaveLength(0);
    expect(result.targets.t1).toBeNull();
    expect(result.attackers[0].stunned).toBeLessThan(1);
  });

  it('does nothing when dead', () => {
    const result = resolveAutoAttacks([turret({ dead: true })], [foe('e1', 50)], {}, 1 / 60, SPEED);
    expect(result.shots).toHaveLength(0);
  });

  it('holds its lock while the target stays in range', () => {
    const result = resolveAutoAttacks(
      [turret()],
      [foe('far', 190), foe('near', 10)],
      { t1: 'far' },
      1 / 60,
      SPEED,
    );
    expect(result.targets.t1, 'a nearer arrival must not steal the lock').toBe('far');
  });

  it('breaks a distance tie by id, not array order', () => {
    const a = foe('aaa', 100);
    const b = foe('bbb', 100);
    const forward = resolveAutoAttacks([turret()], [b, a], {}, 1 / 60, SPEED);
    const reversed = resolveAutoAttacks([turret()], [a, b], {}, 1 / 60, SPEED);
    expect(forward.targets.t1).toBe('aaa');
    expect(reversed.targets.t1).toBe(forward.targets.t1);
  });

  it('fires on an interval rather than every tick', () => {
    let attackers = [turret()];
    const enemies = [foe('e1', 100)];
    let shots = 0;
    for (let i = 0; i < 120; i += 1) {
      const result = resolveAutoAttacks(attackers, enemies, {}, 1 / 60, SPEED);
      attackers = result.attackers;
      shots += result.shots.length;
    }
    // Two seconds at a 1s interval: two or three shots, never 120.
    expect(shots).toBeGreaterThan(1);
    expect(shots).toBeLessThan(5);
  });

  it('takes its interval from attack speed, exactly as combat.ts does', () => {
    /**
     * This replaces a test that asserted a RANGE-based interval I had invented. It passed, which proved only that the
     * invention was self-consistent — the scene has always used `1 / attackSpeed` via resetAttackCooldown, so the
     * "shared" rule was not the rule being shared. Pinning it against the real formula is the point.
     */
    expect(attackIntervalFor({ attackSpeed: 0.8 })).toBeCloseTo(1 / 0.8, 9);
    expect(attackIntervalFor({ attackSpeed: 2 })).toBeCloseTo(0.5, 9);
    expect(attackIntervalFor({ attackSpeed: 0 }), 'no attack speed means never').toBe(Infinity);
  });

  it('respects the attacker attack speed when it fires', () => {
    const fast = resolveAutoAttacks([turret({ attackSpeed: 2 })], [foe('e1', 100)], {}, 1 / 60, SPEED);
    const slow = resolveAutoAttacks([turret({ attackSpeed: 0.5 })], [foe('e1', 100)], {}, 1 / 60, SPEED);
    expect(slow.attackers[0].attackCdRemaining).toBeGreaterThan(fast.attackers[0].attackCdRemaining);
  });

  it('is deterministic and does not mutate its inputs', () => {
    const attackers = [turret()];
    const enemies = [foe('e1', 100)];
    const before = JSON.stringify(attackers);
    const a = resolveAutoAttacks(attackers, enemies, {}, 1 / 60, SPEED);
    const b = resolveAutoAttacks(attackers, enemies, {}, 1 / 60, SPEED);
    expect(JSON.stringify(attackers)).toBe(before);
    expect(a).toEqual(b);
  });
});

describe('flightTime', () => {
  it('returns zero for a zero speed rather than dividing by it', () => {
    // A misconfigured speed should make a shot land instantly, not produce Infinity and a dueAt that never arrives.
    expect(flightTime(100, 0)).toBe(0);
    expect(Number.isFinite(flightTime(100, SPEED))).toBe(true);
  });
});

describe('cloneAutoAttackers', () => {
  it('copies the position object, not just the attacker', () => {
    const original = [turret()];
    const copy = cloneAutoAttackers(original);
    copy[0].pos.x = -1;
    expect(original[0].pos.x).toBe(0);
  });
});
