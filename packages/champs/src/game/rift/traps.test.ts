import { describe, expect, it } from 'vitest';

import { cloneTraps, resolveTraps, trapIdFor, type TrapCandidate, type TrapState } from './traps';

function trap(over: Partial<TrapState> = {}): TrapState {
  return {
    id: 'trap:a:1.000',
    sourceId: 'a',
    sourceTeam: 'ally',
    point: { x: 500, y: 500 },
    radius: 120,
    rawDamage: 60,
    expiresAt: 10,
    slowPercent: 0.3,
    slowDuration: 1,
    ...over,
  };
}

function candidate(id: string, x: number, y = 500): TrapCandidate {
  return { id, pos: { x, y } };
}

/** Everything is damageable unless a test says otherwise, which keeps each case about the trap rule. */
const anyone = () => true;
const noone = () => false;

describe('resolveTraps', () => {
  it('catches someone standing inside the radius and consumes the trap', () => {
    const result = resolveTraps([trap()], [candidate('e1', 520)], 5, anyone);
    expect(result.triggers).toHaveLength(1);
    expect(result.triggers[0]).toMatchObject({ trapId: 'trap:a:1.000', targetId: 'e1', rawDamage: 60 });
    expect(result.traps, 'a triggered trap is spent').toHaveLength(0);
  });

  it('survives untriggered when nobody is inside', () => {
    const result = resolveTraps([trap()], [candidate('e1', 900)], 5, anyone);
    expect(result.triggers).toHaveLength(0);
    expect(result.traps).toHaveLength(1);
  });

  it('drops an expired trap WITHOUT firing it, even with someone standing on it', () => {
    /**
     * The ordering is the property. Checking expiry first means a trap that should already be gone cannot hit whoever
     * happens to arrive on the tick it lapses — the alternative gives one peer a hit the other never saw.
     */
    const result = resolveTraps([trap({ expiresAt: 4 })], [candidate('e1', 500)], 5, anyone);
    expect(result.triggers).toHaveLength(0);
    expect(result.traps).toHaveLength(0);
  });

  it('treats the expiry instant itself as expired', () => {
    expect(resolveTraps([trap({ expiresAt: 5 })], [candidate('e1', 500)], 5, anyone).triggers).toHaveLength(0);
    expect(resolveTraps([trap({ expiresAt: 5.001 })], [candidate('e1', 500)], 5, anyone).triggers).toHaveLength(1);
  });

  it('ignores anyone the caller says is not damageable', () => {
    const result = resolveTraps([trap()], [candidate('friend', 500)], 5, noone);
    expect(result.triggers).toHaveLength(0);
    expect(result.traps, 'and does not spend itself on them').toHaveLength(1);
  });

  it('catches the nearest, breaking ties by id rather than array order', () => {
    const near = candidate('zz', 510);
    const far = candidate('aa', 560);
    expect(resolveTraps([trap()], [far, near], 5, anyone).triggers[0].targetId).toBe('zz');

    const tieA = candidate('aaa', 550);
    const tieB = candidate('bbb', 450);
    const forward = resolveTraps([trap()], [tieB, tieA], 5, anyone).triggers[0].targetId;
    const reverse = resolveTraps([trap()], [tieA, tieB], 5, anyone).triggers[0].targetId;
    expect(forward).toBe('aaa');
    expect(reverse).toBe(forward);
  });

  it('judges damageability PER TRAP, so two teams\' traps disagree about the same candidate', () => {
    /**
     * The property the signature exists for. `damageable` was once a flat boolean on the candidate, which cannot express
     * this at all: with an ally trap and an enemy trap both covering one champion, a single flag makes them agree, and one
     * of the two is then wrong. Adopting this step in BattleScene is what exposed it.
     */
    const allyTrap = trap({ id: 'trap:a:1.000', sourceId: 'a', sourceTeam: 'ally' });
    const enemyTrap = trap({ id: 'trap:b:1.000', sourceId: 'b', sourceTeam: 'enemy' });
    const victim = candidate('enemyChamp', 500);

    const result = resolveTraps([allyTrap, enemyTrap], [victim], 5, (t) => t.sourceTeam === 'ally');
    expect(result.triggers.map((x) => x.trapId), 'only the ally trap may hit an enemy').toEqual([
      'trap:a:1.000',
    ]);
    expect(result.traps.map((x) => x.id), 'the enemy trap stays armed').toEqual(['trap:b:1.000']);
  });

  it('processes traps in id order regardless of array order', () => {
    const a = trap({ id: 'trap:a:1.000' });
    const b = trap({ id: 'trap:b:1.000', point: { x: 2000, y: 2000 } });
    const forward = resolveTraps([b, a], [candidate('e1', 500)], 5, anyone);
    const reverse = resolveTraps([a, b], [candidate('e1', 500)], 5, anyone);
    expect(forward.triggers.map((t) => t.trapId)).toEqual(reverse.triggers.map((t) => t.trapId));
    expect(forward.traps.map((t) => t.id)).toEqual(reverse.traps.map((t) => t.id));
  });

  it('respects the radius boundary', () => {
    expect(resolveTraps([trap()], [candidate('e1', 620)], 5, anyone).triggers).toHaveLength(1);
    expect(resolveTraps([trap()], [candidate('e1', 621)], 5, anyone).triggers).toHaveLength(0);
  });

  it('carries the slow through to the trigger, so the caller need not re-read the trap', () => {
    const result = resolveTraps([trap({ slowPercent: 0.5, slowDuration: 2 })], [candidate('e1', 500)], 5, anyone);
    expect(result.triggers[0]).toMatchObject({ slowPercent: 0.5, slowDuration: 2 });
  });

  it('does not mutate its inputs and is deterministic', () => {
    const traps = [trap()];
    const candidates = [candidate('e1', 900)];
    const before = JSON.stringify(traps);
    const a = resolveTraps(traps, candidates, 5, anyone);
    const b = resolveTraps(traps, candidates, 5, anyone);
    expect(JSON.stringify(traps)).toBe(before);
    expect(a).toEqual(b);
  });

  it('returns a trap whose point cannot be mutated back into the original', () => {
    const traps = [trap()];
    const result = resolveTraps(traps, [candidate('e1', 900)], 5, anyone);
    result.traps[0].point.x = -1;
    expect(traps[0].point.x).toBe(500);
  });
});

describe('trapIdFor', () => {
  it('is stable for the same owner and arm time', () => {
    expect(trapIdFor('a', 1.5)).toBe(trapIdFor('a', 1.5));
  });

  it('differs by owner and by arm time', () => {
    expect(trapIdFor('a', 1.5)).not.toBe(trapIdFor('b', 1.5));
    expect(trapIdFor('a', 1.5)).not.toBe(trapIdFor('a', 1.6));
  });
});

describe('cloneTraps', () => {
  it('copies the point object', () => {
    const original = [trap()];
    const copy = cloneTraps(original);
    copy[0].point.x = -1;
    expect(original[0].point.x).toBe(500);
  });
});
