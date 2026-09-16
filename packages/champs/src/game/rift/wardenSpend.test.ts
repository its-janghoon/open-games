import { describe, it, expect } from 'vitest';
import {
  planWardenSpend,
  wardenTargetOrder,
  type WardenTargetCandidate,
} from './wardenSpend';
import { BASE_POSITIONS } from './map';
import { heraldReward } from './objectives';
import { structureId, targetableOrder } from './structures';

/** Every enemy structure, alive, positioned `gap` units further from the ally base per entry. */
function enemyStructures(): WardenTargetCandidate[] {
  return targetableOrder('enemy', 'conquest').map((id, index) => ({
    id,
    team: 'enemy' as const,
    pos: { x: BASE_POSITIONS.ally.x + (index + 1) * 100, y: BASE_POSITIONS.ally.y },
    dead: false,
  }));
}

describe('warden target order', () => {
  it('never offers the holder own structures', () => {
    const mixed: WardenTargetCandidate[] = [
      ...enemyStructures(),
      { id: structureId('ally', 'outerTurret', 'mid'), team: 'ally', pos: BASE_POSITIONS.enemy, dead: false },
    ];
    const order = wardenTargetOrder(mixed, 'ally', 'conquest');
    expect(order.some((id) => id.startsWith('ally-'))).toBe(false);
    expect(order.length).toBeGreaterThan(0);
  });

  it('skips dead structures', () => {
    const candidates = enemyStructures();
    const outer = structureId('enemy', 'outerTurret', 'top');
    const order = wardenTargetOrder(
      candidates.map((c) => (c.id === outer ? { ...c, dead: true } : c)),
      'ally',
      'conquest',
    );
    expect(order).not.toContain(outer);
  });

  it('skips a structure still shielded by a standing one', () => {
    const order = wardenTargetOrder(enemyStructures(), 'ally', 'conquest');
    // With everything alive only the three outer turrets are legal.
    expect(order).toEqual([
      structureId('enemy', 'outerTurret', 'bot'),
      structureId('enemy', 'outerTurret', 'mid'),
      structureId('enemy', 'outerTurret', 'top'),
    ].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    expect(order).toHaveLength(3);
    expect(order.every((id) => id.endsWith('outerTurret'))).toBe(true);
  });

  it('opens the inner turret once the outer one falls', () => {
    const outer = structureId('enemy', 'outerTurret', 'mid');
    const order = wardenTargetOrder(
      enemyStructures().map((c) => (c.id === outer ? { ...c, dead: true } : c)),
      'ally',
      'conquest',
    );
    expect(order).toContain(structureId('enemy', 'innerTurret', 'mid'));
    expect(order).not.toContain(outer);
  });

  it('ranks the closest legal target to the holder own base first', () => {
    const near = structureId('enemy', 'outerTurret', 'bot');
    const candidates = enemyStructures().map((c) =>
      c.id === near
        ? { ...c, pos: { x: BASE_POSITIONS.ally.x + 10, y: BASE_POSITIONS.ally.y } }
        : c,
    );
    expect(wardenTargetOrder(candidates, 'ally', 'conquest')[0]).toBe(near);
  });

  /**
   * Equidistant structures are the NORMAL case on a symmetric map, and `Array.prototype.sort` is only required to be
   * stable, not to order a zero-comparison the same way on two engines. Without the id tiebreak the same match on two
   * machines can batter different buildings from identical input.
   */
  it('breaks a distance tie by id, not by input order', () => {
    const stacked = enemyStructures().map((c) => ({ ...c, pos: { ...BASE_POSITIONS.enemy } }));
    const forward = wardenTargetOrder(stacked, 'ally', 'conquest');
    const reversed = wardenTargetOrder([...stacked].reverse(), 'ally', 'conquest');
    expect(forward).toEqual(reversed);
    expect(forward).toEqual([...forward].sort((a, b) => a.localeCompare(b)));
  });

  it('narrows to the active lane in midline, where the other lanes have no structures', () => {
    const midlineIds = targetableOrder('enemy', 'midline');
    const candidates = midlineIds.map((id, index) => ({
      id,
      team: 'enemy' as const,
      pos: { x: BASE_POSITIONS.ally.x + (index + 1) * 100, y: BASE_POSITIONS.ally.y },
      dead: false,
    }));
    const order = wardenTargetOrder(candidates, 'ally', 'midline');
    expect(order).toEqual([structureId('enemy', 'outerTurret', 'mid')]);
  });
});

describe('spending a held charge', () => {
  const legal = [structureId('enemy', 'outerTurret', 'mid'), structureId('enemy', 'outerTurret', 'top')];

  it('lapses when there is no charge at all', () => {
    expect(planWardenSpend({ charge: null, now: 100, orderedTargetIds: legal })).toEqual({ kind: 'lapsed' });
  });

  it('lapses exactly AT the expiry, matching the field-state rule that keeps a charge while now < expiresAt', () => {
    const charge = { acquiredAt: 10, expiresAt: 100 };
    expect(planWardenSpend({ charge, now: 100, orderedTargetIds: legal })).toEqual({ kind: 'lapsed' });
    expect(planWardenSpend({ charge, now: 99.9, orderedTargetIds: legal }).kind).toBe('strike');
  });

  /**
   * The asymmetry with `lapsed`, preserved from the scene: `useWardenCharge` returned before nulling the charge when the
   * target list was empty. A warden held while every legal structure happens to be shielded must survive to be spent
   * later — only time takes a charge away.
   */
  it('holds the charge when nothing is legal to hit', () => {
    const plan = planWardenSpend({ charge: { acquiredAt: 0, expiresAt: 100 }, now: 50, orderedTargetIds: [] });
    expect(plan).toEqual({ kind: 'hold' });
  });

  it('strikes the first legal target for the herald structure damage', () => {
    const plan = planWardenSpend({ charge: { acquiredAt: 0, expiresAt: 100 }, now: 50, orderedTargetIds: legal });
    expect(plan).toEqual({ kind: 'strike', targetId: legal[0], rawDamage: heraldReward().structureDamage });
  });

  it('honours a preferred target that is legal', () => {
    const plan = planWardenSpend({
      charge: { acquiredAt: 0, expiresAt: 100 },
      now: 50,
      orderedTargetIds: legal,
      preferredTargetId: legal[1],
    });
    expect(plan).toMatchObject({ kind: 'strike', targetId: legal[1] });
  });

  /** A ram walks into whatever is standing; unlike an in-flight projectile it does not miss because its pick went away. */
  it('falls back to the first legal target when the preference is not legal', () => {
    const plan = planWardenSpend({
      charge: { acquiredAt: 0, expiresAt: 100 },
      now: 50,
      orderedTargetIds: legal,
      preferredTargetId: structureId('enemy', 'nexus'),
    });
    expect(plan).toMatchObject({ kind: 'strike', targetId: legal[0] });
  });
});
