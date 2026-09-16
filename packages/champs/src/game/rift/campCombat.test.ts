import { describe, expect, it } from 'vitest';

import {
  advanceCamps,
  CAMP_TUNING,
  campMemberIdFor,
  cloneCampMembers,
  cloneCampSpawns,
  dueCamps,
  type CampMemberState,
  type CampSpawnState,
  type CampTarget,
} from './campCombat';

const HOME = { x: 1000, y: 1000 };
const TICK = 1 / 60;

function member(over: Partial<CampMemberState> = {}): CampMemberState {
  return {
    id: 'camp-gromp-a',
    campId: 'gromp',
    pos: { ...HOME },
    home: { ...HOME },
    hp: 400,
    maxHp: 400,
    attackRange: 160,
    stunned: 0,
    dead: false,
    ...over,
  };
}

const camp: CampSpawnState = { campId: 'gromp', center: { ...HOME }, nextSpawnAt: 0 };

function target(id: string, x: number, y = 1000, attackable = true): CampTarget {
  return { id, pos: { x, y }, attackable };
}

describe('advanceCamps', () => {
  it('attacks a target already within its own attack range', () => {
    const result = advanceCamps([member()], [camp], [target('e1', 1100)], TICK);
    expect(result.actions).toEqual([{ kind: 'attack', memberId: 'camp-gromp-a', targetId: 'e1' }]);
  });

  it('chases a target inside aggro range but out of attack range', () => {
    const result = advanceCamps([member()], [camp], [target('e1', 1300)], TICK);
    expect(result.actions[0]).toMatchObject({ kind: 'chase', memberId: 'camp-gromp-a' });
  });

  it('ignores a target beyond aggro range', () => {
    const result = advanceCamps([member()], [camp], [target('e1', 1000 + CAMP_TUNING.aggroRange + 1)], TICK);
    expect(result.actions[0].kind).toBe('hold');
  });

  it('refuses a target that has left the CAMP leash even when it is close to the monster', () => {
    /**
     * The leash is measured from the camp, not the monster. Measured from the monster, each step of a chase would extend
     * its own leash and a retreating champion could walk a camp across the map.
     */
    const dragged = member({ pos: { x: 1000 + CAMP_TUNING.leashRange, y: 1000 } });
    const justOutside = target('e1', 1000 + CAMP_TUNING.leashRange + 50);
    expect(distanceFromCamp(justOutside)).toBeGreaterThan(CAMP_TUNING.leashRange);
    const result = advanceCamps([dragged], [camp], [justOutside], TICK);
    expect(result.actions[0].kind, 'must give up, not chase further').not.toBe('chase');
    expect(result.actions[0].kind).toBe('return');
  });

  it('walks home and heals at the return rate when it has no target', () => {
    const away = member({ pos: { x: 1300, y: 1000 }, hp: 100 });
    const result = advanceCamps([away], [camp], [], 1);
    expect(result.actions[0]).toMatchObject({ kind: 'return', toward: HOME });
    expect(result.members[0].hp).toBeCloseTo(100 + 400 * CAMP_TUNING.returnRegenPerSecond, 6);
  });

  it('holds and heals at the lower home rate once it has arrived', () => {
    const result = advanceCamps([member({ hp: 100 })], [camp], [], 1);
    expect(result.actions[0].kind).toBe('hold');
    expect(result.members[0].hp).toBeCloseTo(100 + 400 * CAMP_TUNING.homeRegenPerSecond, 6);
    expect(CAMP_TUNING.homeRegenPerSecond).toBeLessThan(CAMP_TUNING.returnRegenPerSecond);
  });

  it('never heals past max', () => {
    const result = advanceCamps([member({ hp: 399 })], [camp], [], 10);
    expect(result.members[0].hp).toBe(400);
  });

  it('does not heal while chasing', () => {
    const result = advanceCamps([member({ hp: 100 })], [camp], [target('e1', 1300)], 1);
    expect(result.members[0].hp, 'a chasing monster must not regenerate').toBe(100);
  });

  it('does nothing while stunned, and sheds the stun', () => {
    const result = advanceCamps([member({ stunned: 1, hp: 100 })], [camp], [target('e1', 1100)], TICK);
    expect(result.actions).toHaveLength(0);
    expect(result.members[0].stunned).toBeLessThan(1);
    expect(result.members[0].hp).toBe(100);
  });

  it('does nothing when dead', () => {
    const result = advanceCamps([member({ dead: true, hp: 0 })], [camp], [target('e1', 1100)], TICK);
    expect(result.actions).toHaveLength(0);
  });

  it('skips a target the caller marked unattackable', () => {
    const result = advanceCamps([member()], [camp], [target('friend', 1100, 1000, false)], TICK);
    expect(result.actions[0].kind).toBe('hold');
  });

  it('breaks distance ties by id, not array order', () => {
    const a = target('aaa', 1100);
    const b = target('bbb', 900);
    const forward = advanceCamps([member()], [camp], [b, a], TICK);
    const reverse = advanceCamps([member()], [camp], [a, b], TICK);
    expect(forward.actions[0]).toMatchObject({ targetId: 'aaa' });
    expect(reverse.actions[0]).toEqual(forward.actions[0]);
  });

  it('does not mutate its inputs and is deterministic', () => {
    const members = [member({ pos: { x: 1300, y: 1000 }, hp: 100 })];
    const before = JSON.stringify(members);
    const a = advanceCamps(members, [camp], [], TICK);
    const b = advanceCamps(members, [camp], [], TICK);
    expect(JSON.stringify(members)).toBe(before);
    expect(a).toEqual(b);
  });

  function distanceFromCamp(t: CampTarget): number {
    return Math.hypot(t.pos.x - camp.center.x, t.pos.y - camp.center.y);
  }
});

describe('dueCamps', () => {
  it('reports a camp whose deadline has passed and which has no living members', () => {
    expect(dueCamps([camp], [], 5)).toEqual(['gromp']);
  });

  it('does not report a camp that still has a living member', () => {
    expect(dueCamps([camp], [member()], 5)).toEqual([]);
  });

  it('does report one whose only members are dead', () => {
    expect(dueCamps([camp], [member({ dead: true })], 5)).toEqual(['gromp']);
  });

  it('does not report before the deadline', () => {
    expect(dueCamps([{ ...camp, nextSpawnAt: 90 }], [], 89.9)).toEqual([]);
    expect(dueCamps([{ ...camp, nextSpawnAt: 90 }], [], 90)).toEqual(['gromp']);
  });

  it('returns ids in a stable order', () => {
    const two = [
      { campId: 'wolves', center: { x: 0, y: 0 }, nextSpawnAt: 0 },
      { campId: 'gromp', center: { x: 0, y: 0 }, nextSpawnAt: 0 },
    ];
    expect(dueCamps(two, [], 5)).toEqual(['gromp', 'wolves']);
  });
});

describe('identity and cloning', () => {
  it('derives a member id from camp and slot, not a counter', () => {
    expect(campMemberIdFor('gromp', 'a')).toBe('camp-gromp-a');
    expect(campMemberIdFor('gromp', 'a')).toBe(campMemberIdFor('gromp', 'a'));
  });

  it('copies member pos and home independently', () => {
    const original = [member()];
    const copy = cloneCampMembers(original);
    copy[0].pos.x = -1;
    copy[0].home.y = -1;
    expect(original[0].pos.x).toBe(1000);
    expect(original[0].home.y).toBe(1000);
  });

  it('copies a camp centre independently', () => {
    const original = [camp];
    const copy = cloneCampSpawns(original);
    copy[0].center.x = -1;
    expect(original[0].center.x).toBe(1000);
  });
});
