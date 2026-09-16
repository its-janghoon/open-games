import { describe, it, expect } from 'vitest';
import {
  planBasicAttack,
  RANGED_ATTACK_THRESHOLD,
  type AttackingChampion,
  type AttackTarget,
} from './basicAttack';
import { createPassiveState, passiveKeys, PASSIVE_TUNING } from './passives';

function attacker(overrides: Partial<AttackingChampion> = {}): AttackingChampion {
  return {
    id: 'champ-1',
    championId: null,
    pos: { x: 0, y: 0 },
    ad: 60,
    attackRange: 150,
    attackCdRemaining: 0,
    attackSpeed: 2,
    items: [],
    hasRedBuff: false,
    ...overrides,
  };
}

function target(overrides: Partial<AttackTarget> = {}): AttackTarget {
  return { id: 'victim', pos: { x: 100, y: 0 }, dead: false, damageable: true, ...overrides };
}

describe('basic attack gates', () => {
  it('blocks while the attack is on cooldown', () => {
    const plan = planBasicAttack(attacker({ attackCdRemaining: 0.2 }), target(), 10, createPassiveState());
    expect(plan).toMatchObject({ kind: 'blocked', reason: 'onCooldown' });
  });

  it('blocks on a dead target', () => {
    const plan = planBasicAttack(attacker(), target({ dead: true }), 10, createPassiveState());
    expect(plan).toMatchObject({ kind: 'blocked', reason: 'targetDead' });
  });

  it('blocks beyond attack range', () => {
    const plan = planBasicAttack(attacker(), target({ pos: { x: 151, y: 0 } }), 10, createPassiveState());
    expect(plan).toMatchObject({ kind: 'blocked', reason: 'outOfRange' });
  });

  it('strikes exactly at the edge of range', () => {
    const plan = planBasicAttack(attacker(), target({ pos: { x: 150, y: 0 } }), 10, createPassiveState());
    expect(plan.kind).toBe('strike');
  });

  it('blocks an invulnerable target, and says so rather than reporting out of range', () => {
    const plan = planBasicAttack(attacker(), target({ damageable: false }), 10, createPassiveState());
    expect(plan).toMatchObject({ kind: 'blocked', reason: 'targetInvulnerable' });
  });

  it('reports the FIRST failing gate, so the reason is stable', () => {
    // On cooldown AND out of range AND invulnerable: the scene checked cooldown first.
    const plan = planBasicAttack(
      attacker({ attackCdRemaining: 1 }),
      target({ pos: { x: 9999, y: 0 }, damageable: false }),
      10,
      createPassiveState(),
    );
    expect(plan).toMatchObject({ kind: 'blocked', reason: 'onCooldown' });
  });
});

describe('delivery', () => {
  it('lands melee at the threshold and flies beyond it', () => {
    const near = planBasicAttack(
      attacker({ attackRange: RANGED_ATTACK_THRESHOLD }),
      target({ pos: { x: 10, y: 0 } }),
      0,
      createPassiveState(),
    );
    const far = planBasicAttack(
      attacker({ attackRange: RANGED_ATTACK_THRESHOLD + 1 }),
      target({ pos: { x: 10, y: 0 } }),
      0,
      createPassiveState(),
    );
    expect(near).toMatchObject({ kind: 'strike', delivery: 'melee' });
    expect(far).toMatchObject({ kind: 'strike', delivery: 'projectile' });
  });
});

describe('damage and cooldown', () => {
  it('adds the passive bonus to base AD without touching the stat', () => {
    const swinging = attacker({ hasRedBuff: true, ad: 60 });
    const plan = planBasicAttack(swinging, target(), 0, createPassiveState());
    if (plan.kind !== 'strike') throw new Error('expected a strike');
    expect(plan.bonusAd).toBeGreaterThan(0);
    expect(plan.rawDamage).toBe(60 + plan.bonusAd);
    expect(swinging.ad).toBe(60);
    expect(plan.fired).toContain('red');
  });

  it('sets one attack interval at the attacker own speed', () => {
    const plan = planBasicAttack(attacker({ attackSpeed: 4 }), target(), 0, createPassiveState());
    expect(plan).toMatchObject({ kind: 'strike', attackCdRemaining: 0.25 });
  });

  it('disables further attacks when attack speed is zero rather than dividing by it', () => {
    const plan = planBasicAttack(attacker({ attackSpeed: 0 }), target(), 0, createPassiveState());
    expect(plan).toMatchObject({ kind: 'strike', attackCdRemaining: Infinity });
  });
});

describe('passive state advances only on a real swing', () => {
  const ashborne = attacker({ championId: 'ashborne' });

  it('banks a stack per strike and fires on the third', () => {
    let state = createPassiveState();
    const fired: string[][] = [];
    for (let i = 0; i < 3; i += 1) {
      const plan = planBasicAttack(ashborne, target(), i * 0.5, state);
      if (plan.kind !== 'strike') throw new Error('expected a strike');
      state = plan.passives;
      fired.push([...plan.fired]);
    }
    expect(fired[0]).not.toContain('ashborne');
    expect(fired[1]).not.toContain('ashborne');
    expect(fired[2]).toContain('ashborne');
  });

  /**
   * The property the extraction exists for.
   *
   * In the scene the passive resolve ran AFTER every gate, so a swing that never happened banked nothing. If the
   * resolve were hoisted above the gates — the obvious-looking simplification — a champion could stack a passive by
   * spamming attacks at an out-of-range target, and two peers whose range checks disagreed by a pixel would diverge in
   * damage several seconds later. Asserting the state identity is what makes that reordering impossible to land quietly.
   */
  it('banks nothing when the swing is blocked, so a whiffed attack cannot advance a stack', () => {
    let state = createPassiveState();
    const first = planBasicAttack(ashborne, target(), 0, state);
    if (first.kind !== 'strike') throw new Error('expected a strike');
    state = first.passives;

    const stackKey = passiveKeys.ashborneStacks(ashborne.id, 'victim');
    expect(state.counters[stackKey]).toBe(1);

    for (const blocked of [
      planBasicAttack(ashborne, target({ pos: { x: 9999, y: 0 } }), 0.5, state),
      planBasicAttack(ashborne, target({ dead: true }), 0.6, state),
      planBasicAttack(ashborne, target({ damageable: false }), 0.7, state),
      planBasicAttack({ ...ashborne, attackCdRemaining: 0.3 }, target(), 0.8, state),
    ]) {
      expect(blocked.kind).toBe('blocked');
      // Not merely equal — the SAME state, so no caller can accidentally persist a mutated copy.
      expect(blocked.passives).toBe(state);
    }

    const second = planBasicAttack(ashborne, target(), 1, state);
    if (second.kind !== 'strike') throw new Error('expected a strike');
    expect(second.fired).not.toContain('ashborne');
    expect(second.passives.counters[stackKey]).toBe(2);
  });

  it('lets the ashborne window lapse, so stacks are not immortal', () => {
    let state = createPassiveState();
    const first = planBasicAttack(ashborne, target(), 0, state);
    if (first.kind !== 'strike') throw new Error('expected a strike');
    state = first.passives;

    const afterWindow = PASSIVE_TUNING.ashborneWindowSeconds + 1;
    const second = planBasicAttack(ashborne, target(), afterWindow, state);
    if (second.kind !== 'strike') throw new Error('expected a strike');
    expect(second.passives.counters[passiveKeys.ashborneStacks(ashborne.id, 'victim')]).toBe(1);
  });
});
