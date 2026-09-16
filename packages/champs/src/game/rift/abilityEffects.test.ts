import { describe, expect, it } from 'vitest';

import { planCast, type CastActor, type CastRequest } from './abilityEffects';
import type { AbilityEffect } from '../combat';
import type { Ability } from '../../data/champions';

function actor(over: Partial<CastActor> = {}): CastActor {
  return {
    id: 'caster',
    team: 'ally',
    pos: { x: 0, y: 0 },
    hp: 500,
    maxHp: 1000,
    abilityPower: 100,
    present: true,
    ...over,
  };
}

function ability(over: Partial<Ability> = {}): Ability {
  return { name: 'X', description: '', range: 500, damage: 100, cooldown: 8, ...over } as Ability;
}

function effect(over: Partial<AbilityEffect> = {}): AbilityEffect {
  return {
    behavior: 'skillshot',
    damage: 0,
    heal: 0,
    stunDuration: 0,
    buffDuration: 0,
    dashes: false,
    area: false,
    radius: 0,
    ...over,
  } as AbilityEffect;
}

function request(over: Partial<CastRequest> = {}): CastRequest {
  return {
    championId: 'ashborne',
    slot: 'Q',
    ability: ability(),
    effect: effect(),
    caster: actor(),
    everyone: [actor()],
    origin: { x: 0, y: 0 },
    endpoint: { x: 200, y: 0 },
    aimedAllyId: null,
    executeTargetId: null,
    now: 10,
    hasChronoCore: false,
    ...over,
  };
}

const kinds = (ops: ReturnType<typeof planCast>['ops']) => ops.map((o) => o.kind);

describe('planCast', () => {
  it('queues damage for a plain damaging ability', () => {
    const plan = planCast(request({ effect: effect({ damage: 200 }) }));
    expect(kinds(plan.ops)).toContain('damage');
    const dmg = plan.ops.find((o) => o.kind === 'damage')!;
    expect(dmg.kind === 'damage' && dmg.rawDamage).toBeGreaterThan(200);
  });

  it('dashes BEFORE ally targeting, because the dash moves who is in range', () => {
    /**
     * Ordering is the property, not an implementation detail. The ally search measures distance from the caster, so
     * resolving it before the dash silently heals a different set of people. The original code had the dash first and
     * nothing said why.
     */
    const near = actor({ id: 'near', pos: { x: 250, y: 0 }, hp: 100 });
    const plan = planCast(
      request({
        championId: 'dawnsong',
        slot: 'R',
        effect: effect({ dashes: true, heal: 0 }),
        ability: ability({ range: 100 }),
        caster: actor({ id: 'caster', pos: { x: 0, y: 0 } }),
        everyone: [actor({ id: 'caster' }), near],
        endpoint: { x: 200, y: 0 },
      }),
    );
    expect(kinds(plan.ops)[0]).toBe('dash');
    expect(
      plan.ops.some((o) => o.kind === 'heal' && o.targetId === 'near'),
      'the ally is only within 100 units of where the dash LANDED',
    ).toBe(true);
  });

  it('opens the dash window only for nightveil', () => {
    const asNightveil = planCast(
      request({ championId: 'nightveil', effect: effect({ dashes: true }) }),
    );
    expect(kinds(asNightveil.ops)).toContain('openDashWindow');
    const other = planCast(request({ championId: 'ashborne', effect: effect({ dashes: true }) }));
    expect(kinds(other.ops)).not.toContain('openDashWindow');
  });

  it('REFUSES an ally-targeted ability with nobody aimed', () => {
    // A refusal must be distinguishable from doing nothing, because the caller must not spend a cooldown or play a cue.
    for (const [championId, slot] of [
      ['dawnsong', 'W'],
      ['wardlight', 'W'],
      ['dawnsong', 'E'],
    ] as const) {
      const plan = planCast(request({ championId, slot, aimedAllyId: null }));
      expect(plan.refused, `${championId} ${slot}`).toBe(true);
      expect(plan.ops).toHaveLength(0);
    }
  });

  it('heals the aimed ally and suppresses the generic self-heal', () => {
    const ally = actor({ id: 'ally', hp: 200 });
    const plan = planCast(
      request({
        championId: 'dawnsong',
        slot: 'W',
        effect: effect({ heal: 999 }),
        everyone: [actor(), ally],
        aimedAllyId: 'ally',
      }),
    );
    expect(plan.ops.filter((o) => o.kind === 'heal')).toHaveLength(1);
    expect(plan.ops.find((o) => o.kind === 'heal')).toMatchObject({ targetId: 'ally' });
  });

  it('dawnsong R heals and armours every ally in range, lowest health first', () => {
    const hurt = actor({ id: 'hurt', hp: 100, pos: { x: 10, y: 0 } });
    const healthy = actor({ id: 'healthy', hp: 900, pos: { x: 20, y: 0 } });
    const plan = planCast(
      request({
        championId: 'dawnsong',
        slot: 'R',
        everyone: [actor({ id: 'caster', hp: 500 }), healthy, hurt],
      }),
    );
    const healed = plan.ops.filter((o) => o.kind === 'heal').map((o) => (o.kind === 'heal' ? o.targetId : ''));
    expect(healed[0], 'the most hurt ally is served first').toBe('hurt');
    expect(healed).toContain('healthy');
    expect(plan.ops.filter((o) => o.kind === 'armor')).toHaveLength(3);
  });

  it('orders equally-hurt allies by id, not array order', () => {
    const a = actor({ id: 'aaa', hp: 300, pos: { x: 5, y: 0 } });
    const b = actor({ id: 'bbb', hp: 300, pos: { x: 6, y: 0 } });
    const forward = planCast(request({ championId: 'dawnsong', slot: 'R', everyone: [b, a] }));
    const reverse = planCast(request({ championId: 'dawnsong', slot: 'R', everyone: [a, b] }));
    expect(kinds(forward.ops)).toEqual(kinds(reverse.ops));
    expect(forward.ops).toEqual(reverse.ops);
  });

  it('excludes an absent ally from a team-wide effect', () => {
    // `present` is the life phase, not `!dead`: a respawning champion is not a valid heal target.
    const respawning = actor({ id: 'ghost', hp: 0, present: false, pos: { x: 10, y: 0 } });
    const plan = planCast(
      request({ championId: 'wardlight', slot: 'R', everyone: [actor(), respawning] }),
    );
    expect(plan.ops.some((o) => o.kind === 'shield' && o.targetId === 'ghost')).toBe(false);
  });

  it('excludes an enemy from a team-wide effect', () => {
    const foe = actor({ id: 'foe', team: 'enemy', hp: 10, pos: { x: 10, y: 0 } });
    const plan = planCast(
      request({ championId: 'wardlight', slot: 'R', everyone: [actor(), foe] }),
    );
    expect(plan.ops.some((o) => o.kind === 'shield' && o.targetId === 'foe')).toBe(false);
  });

  it('thornwarden W armours itself and cleanses its own slows', () => {
    const plan = planCast(request({ championId: 'thornwarden', slot: 'W' }));
    expect(kinds(plan.ops)).toEqual(expect.arrayContaining(['armor', 'cleanseSlows']));
    expect(plan.ops.every((o) => !('targetId' in o) || o.targetId === 'caster')).toBe(true);
  });

  it('ironhold W shields for a fraction of MAX health, not current', () => {
    const plan = planCast(
      request({
        championId: 'ironhold',
        slot: 'W',
        caster: actor({ hp: 10, maxHp: 2000 }),
        effect: effect({ buffDuration: 3 }),
      }),
    );
    const shield = plan.ops.find((o) => o.kind === 'shield');
    expect(shield?.kind === 'shield' && shield.amount).toBeCloseTo(2000 * 0.12, 6);
  });

  it('nightveil W opens a smoke window only when the buff branch is reached', () => {
    const buffOnly = planCast(
      request({ championId: 'nightveil', slot: 'W', effect: effect({ buffDuration: 3 }) }),
    );
    expect(kinds(buffOnly.ops)).toContain('smokeWindow');

    // The original gates that branch on damage AND heal being zero, so an ability that also damages does not smoke.
    const alsoDamages = planCast(
      request({ championId: 'nightveil', slot: 'W', effect: effect({ buffDuration: 3, damage: 50 }) }),
    );
    expect(kinds(alsoDamages.ops)).not.toContain('smokeWindow');
  });

  it('duskarrow W arms a trap and queues NO damage of its own', () => {
    // The original returns early here. A trap ability that also queued damage would hit twice.
    const plan = planCast(
      request({ championId: 'duskarrow', slot: 'W', effect: effect({ damage: 300 }) }),
    );
    expect(kinds(plan.ops)).toContain('trap');
    expect(kinds(plan.ops)).not.toContain('damage');
  });

  it('marks an R as ultimate and anything else as not', () => {
    const ult = planCast(request({ slot: 'R', effect: effect({ damage: 100 }) }));
    const basic = planCast(request({ slot: 'Q', effect: effect({ damage: 100 }) }));
    expect(ult.ops.find((o) => o.kind === 'damage')).toMatchObject({ ultimate: true });
    expect(basic.ops.find((o) => o.kind === 'damage')).toMatchObject({ ultimate: false });
  });

  it('is deterministic and does not mutate its request', () => {
    const req = request({ championId: 'dawnsong', slot: 'R', effect: effect({ damage: 100 }) });
    const before = JSON.stringify(req);
    const a = planCast(req);
    const b = planCast(req);
    expect(JSON.stringify(req)).toBe(before);
    expect(a).toEqual(b);
  });

  it('copies the points it returns, so a caller cannot write back into the request', () => {
    const req = request({ effect: effect({ damage: 100 }) });
    const plan = planCast(req);
    const dmg = plan.ops.find((o) => o.kind === 'damage')!;
    if (dmg.kind === 'damage') dmg.endpoint.x = -999;
    expect(req.endpoint.x).toBe(200);
  });
});
