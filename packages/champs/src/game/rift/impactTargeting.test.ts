import { describe, expect, it } from 'vitest';

import {
  CHRONO_PROC_SECONDS,
  resolveImpactHits,
  shouldProcChrono,
  type ImpactCandidate,
  type ImpactShape,
} from './impactTargeting';

const anyone = () => true;
const noone = () => false;

function body(id: string, x: number, y = 0): ImpactCandidate {
  return { id, pos: { x, y } };
}

function shape(over: Partial<ImpactShape> = {}): ImpactShape {
  return { radius: 100, singleTarget: false, ...over };
}

describe('targeted impacts', () => {
  it('hits exactly the named body at full damage', () => {
    const hits = resolveImpactHits(shape({ targetId: 'b' }), [body('a', 0), body('b', 9999)], anyone);
    expect(hits).toEqual([{ targetId: 'b', damageMultiplier: 1 }]);
  });

  it('ignores range entirely for a named target', () => {
    // A named target is a lock, not an area — the radius must not silently gate it.
    const hits = resolveImpactHits(shape({ targetId: 'b', radius: 1 }), [body('b', 100000)], anyone);
    expect(hits).toHaveLength(1);
  });

  it('MISSES rather than falling through to an area when the named target became undamageable', () => {
    /**
     * The fallthrough is the dangerous version: an impact aimed at one champion should not become an area hit on whoever
     * is standing nearby because its target gained immunity mid-flight.
     */
    // The bystander must be DAMAGEABLE, or the fallthrough hits the same wall and the test proves nothing — which is how the
    // first version of this test passed against an injected fallthrough.
    const hits = resolveImpactHits(
      shape({ targetId: 'b', point: { x: 0, y: 0 }, radius: 500 }),
      [body('b', 0), body('bystander', 5)],
      (candidate) => candidate.id !== 'b',
    );
    expect(hits, 'an immune target must not turn a single-target hit into an area hit').toEqual([]);
  });

  it('misses when the named target has left the candidate list', () => {
    expect(resolveImpactHits(shape({ targetId: 'gone' }), [body('a', 0)], anyone)).toEqual([]);
  });
});

describe('line impacts', () => {
  it('applies the falloff multiplier to every body after the first', () => {
    const hits = resolveImpactHits(
      shape({ line: { origin: { x: 0, y: 0 }, endpoint: { x: 500, y: 0 }, halfWidth: 40, subsequentDamageMultiplier: 0.5 } }),
      [body('near', 50), body('far', 300)],
      anyone,
    );
    expect(hits).toHaveLength(2);
    expect(hits[0].damageMultiplier, 'the first body takes full damage').toBe(1);
    expect(hits[1].damageMultiplier).toBe(0.5);
  });

  it('skips bodies outside the box', () => {
    const hits = resolveImpactHits(
      shape({ line: { origin: { x: 0, y: 0 }, endpoint: { x: 500, y: 0 }, halfWidth: 10, subsequentDamageMultiplier: 1 } }),
      [body('onLine', 100, 0), body('offLine', 100, 900)],
      anyone,
    );
    expect(hits.map((h) => h.targetId)).toEqual(['onLine']);
  });

  it('respects the caller damage rule', () => {
    const hits = resolveImpactHits(
      shape({ line: { origin: { x: 0, y: 0 }, endpoint: { x: 500, y: 0 }, halfWidth: 40, subsequentDamageMultiplier: 1 } }),
      [body('a', 50)],
      noone,
    );
    expect(hits).toEqual([]);
  });
});

describe('point impacts', () => {
  it('hits everything inside the radius', () => {
    const hits = resolveImpactHits(
      shape({ point: { x: 0, y: 0 }, radius: 100 }),
      [body('in1', 50), body('in2', 90), body('out', 200)],
      anyone,
    );
    expect(hits.map((h) => h.targetId)).toEqual(['in1', 'in2']);
  });

  it('respects the radius boundary', () => {
    expect(resolveImpactHits(shape({ point: { x: 0, y: 0 }, radius: 100 }), [body('a', 100)], anyone)).toHaveLength(1);
    expect(resolveImpactHits(shape({ point: { x: 0, y: 0 }, radius: 100 }), [body('a', 101)], anyone)).toHaveLength(0);
  });

  it('takes only the nearest when singleTarget, breaking ties by id', () => {
    /**
     * The tiebreak decides which of two equidistant bodies takes the hit AT ALL for a single-target point impact, so array
     * order here is a divergence rather than a cosmetic difference.
     */
    const nearer = resolveImpactHits(
      shape({ point: { x: 0, y: 0 }, radius: 500, singleTarget: true }),
      [body('far', 200), body('near', 10)],
      anyone,
    );
    expect(nearer.map((h) => h.targetId)).toEqual(['near']);

    const forward = resolveImpactHits(
      shape({ point: { x: 0, y: 0 }, radius: 500, singleTarget: true }),
      [body('bbb', 100), body('aaa', -100)],
      anyone,
    );
    const reverse = resolveImpactHits(
      shape({ point: { x: 0, y: 0 }, radius: 500, singleTarget: true }),
      [body('aaa', -100), body('bbb', 100)],
      anyone,
    );
    expect(forward.map((h) => h.targetId)).toEqual(['aaa']);
    expect(reverse).toEqual(forward);
  });

  it('returns nothing for an impact with no shape at all', () => {
    expect(resolveImpactHits(shape(), [body('a', 0)], anyone)).toEqual([]);
  });

  it('is deterministic and does not mutate its inputs', () => {
    const candidates = [body('a', 10), body('b', 20)];
    const before = JSON.stringify(candidates);
    const s = shape({ point: { x: 0, y: 0 }, radius: 500 });
    expect(resolveImpactHits(s, candidates, anyone)).toEqual(resolveImpactHits(s, candidates, anyone));
    expect(JSON.stringify(candidates)).toBe(before);
  });
});

describe('shouldProcChrono', () => {
  it('procs only when the flag is set AND something was hit', () => {
    // Written once here because it used to be written twice in processPendingImpacts, on two branches that could drift.
    expect(shouldProcChrono(true, [{ targetId: 'a', damageMultiplier: 1 }])).toBe(true);
    expect(shouldProcChrono(true, [])).toBe(false);
    expect(shouldProcChrono(false, [{ targetId: 'a', damageMultiplier: 1 }])).toBe(false);
  });

  it('refunds a positive amount of cooldown', () => {
    expect(CHRONO_PROC_SECONDS).toBeGreaterThan(0);
  });
});
