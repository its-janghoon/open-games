import {
  ATTACKS,
  attackPhase,
  bodyBox,
  boxesOverlap,
  cloneFightState,
  hitBox,
  RING,
  type AttackId,
  type Fighter,
  type FightInput,
  type FightState,
} from './fightState';

/**
 * One tick of the fight.
 *
 * Ordering is fixed and written down because it decides outcomes rather than merely tidiness:
 *
 *   1. resolve stance expiry, so a fighter whose recovery ended can act on THIS tick
 *   2. read inputs into intents, for both fighters, before either moves
 *   3. integrate movement and gravity
 *   4. resolve hits, both directions, simultaneously
 *   5. apply ring bounds and check for an ending
 *
 * Step 4 being simultaneous is the load-bearing part. Resolving one fighter's hitbox before the
 * other's would make whoever is checked first win every trade, and which one that is would come
 * down to array order — so two peers with the same inputs could disagree about a double KO. Both
 * hits are detected against the state as it was at the start of step 4, then both are applied.
 */
export function stepFight(
  state: FightState,
  inputs: ReadonlyMap<string, FightInput>,
  tick: number,
): FightState {
  const next = cloneFightState(state);
  next.tick = tick;
  if (next.outcome.kind !== 'ongoing') return next;

  const [a, b] = next.fighters;

  // 1. Stance expiry. A stance whose deadline has passed returns to idle before intents are read.
  for (const fighter of next.fighters) expireStance(fighter, tick);

  // Facing is decided by geometry, never by input: a fighter always faces the opponent, which is
  // what makes "forward" mean the same thing to both players.
  a.facing = a.x <= b.x ? 1 : -1;
  b.facing = -a.facing as 1 | -1;

  // 2. Intents, read for both before anything moves.
  for (const fighter of next.fighters) {
    const input = inputs.get(fighter.id);
    if (input) applyIntent(fighter, input, tick);
  }

  // 3. Movement.
  for (const fighter of next.fighters) integrate(fighter);

  // 4. Hits, simultaneous. Boxes are computed from the pre-resolution state for BOTH fighters
  // first, so neither can be modified before the other is judged.
  const aHit = hitBox(a, tick);
  const bHit = hitBox(b, tick);
  const aBody = bodyBox(a);
  const bBody = bodyBox(b);
  const aConnects = aHit !== null && !a.attackConnected && boxesOverlap(aHit, bBody);
  const bConnects = bHit !== null && !b.attackConnected && boxesOverlap(bHit, aBody);
  // The attack ids are captured BEFORE either hit is applied, and a test caught why: landing a hit
  // clears the victim's attack, so resolving a's hit first left b holding no attack and the second
  // resolution read frame data off null. Detecting simultaneously is not enough — the APPLICATION
  // has to be order-independent too, or the fighter who happens to be first in the array wins the
  // trade outright.
  const aAttack = a.attack;
  const bAttack = b.attack;
  if (aConnects && aAttack) land(a, b, aAttack, tick);
  if (bConnects && bAttack) land(b, a, bAttack, tick);

  // 5. Bounds and ending.
  for (const fighter of next.fighters) {
    if (fighter.y < RING.floorY) {
      fighter.y = RING.floorY;
      fighter.vy = 0;
      if (fighter.stance === 'jump') toStance(fighter, 'idle', tick, 0);
    }
  }
  next.outcome = judge(next, tick);
  return next;
}

function expireStance(fighter: Fighter, tick: number): void {
  if (fighter.stanceUntil > tick) return;
  if (fighter.stance === 'knockdown') {
    // Getting up grants a brief window where nothing can touch the fighter, expressed as hitstun
    // with no damage rather than as a separate flag — one stance field, one truth.
    fighter.combo = 0;
    toStance(fighter, 'idle', tick, RING.wakeupInvulnTicks);
    return;
  }
  if (fighter.stance === 'attack' || fighter.stance === 'hitstun' || fighter.stance === 'block') {
    fighter.attack = null;
    fighter.attackConnected = false;
    if (fighter.stance === 'hitstun') fighter.combo = 0;
    toStance(fighter, fighter.y > RING.floorY ? 'jump' : 'idle', tick, 0);
  }
}

function toStance(fighter: Fighter, stance: Fighter['stance'], tick: number, ticks: number): void {
  fighter.stance = stance;
  fighter.stanceUntil = tick + ticks;
}

/** Can this fighter start something new right now? */
function actionable(fighter: Fighter, tick: number): boolean {
  if (fighter.stance === 'hitstun' || fighter.stance === 'knockdown') return false;
  if (fighter.stance === 'attack') return attackPhase(fighter, tick) === 'none';
  return true;
}

function applyIntent(fighter: Fighter, input: FightInput, tick: number): void {
  const airborne = fighter.y > RING.floorY;
  if (!actionable(fighter, tick)) return;

  // Attack buttons are checked in damage order, so pressing two at once gives the heavier one
  // deterministically instead of depending on field order in the input object.
  const pressed: AttackId | null = input.slam
    ? 'slam'
    : input.kick
      ? 'kick'
      : input.jab
        ? 'jab'
        : null;

  if (pressed && !airborne) {
    const spec = ATTACKS[pressed];
    fighter.attack = pressed;
    fighter.attackConnected = false;
    fighter.vx = 0;
    toStance(fighter, 'attack', tick, spec.startup + spec.active + spec.recovery);
    return;
  }

  if (airborne) {
    fighter.stance = 'jump';
    return;
  }

  if (input.up) {
    fighter.vy = RING.jumpSpeed;
    toStance(fighter, 'jump', tick, 0);
    return;
  }

  // Holding back — away from the opponent — is the block, rather than a dedicated button. It costs
  // ground, which is the trade that keeps blocking from being free.
  const back = fighter.facing === 1 ? input.left : input.right;
  const forward = fighter.facing === 1 ? input.right : input.left;

  if (input.down) {
    toStance(fighter, 'crouch', tick, 0);
    fighter.vx = (forward ? 1 : back ? -1 : 0) * RING.walkSpeed * RING.crouchSpeedFactor * fighter.facing;
    return;
  }

  if (back) {
    toStance(fighter, 'block', tick, 1);
    fighter.vx = -RING.walkSpeed * 0.6 * fighter.facing;
    return;
  }

  if (forward) {
    toStance(fighter, 'walk', tick, 0);
    fighter.vx = RING.walkSpeed * fighter.facing;
    return;
  }

  toStance(fighter, 'idle', tick, 0);
  fighter.vx = 0;
}

function integrate(fighter: Fighter): void {
  fighter.x += fighter.vx;
  if (fighter.y > RING.floorY || fighter.vy !== 0) {
    fighter.y += fighter.vy;
    fighter.vy -= RING.gravity;
  }
}

function land(attacker: Fighter, victim: Fighter, attack: AttackId, tick: number): void {
  const spec = ATTACKS[attack];
  attacker.attackConnected = true;

  const blocking = victim.stance === 'block';
  const scaled = spec.damage * (1 + victim.combo * RING.comboScaling);
  const damage = blocking ? scaled * (1 - RING.blockAbsorb) : scaled;
  victim.hp = Math.max(0, victim.hp - damage);

  // Pushback is applied to POSITION, not to velocity. Velocity would keep pushing after the hit
  // ended and let a corner combo slide a fighter out of the ring on momentum they never earned.
  victim.x += spec.pushback * attacker.facing;

  if (blocking) {
    toStance(victim, 'block', tick, 3);
    return;
  }
  victim.combo += 1;
  const heavy = spec.damage >= ATTACKS.slam.damage || victim.hp === 0;
  if (heavy) {
    victim.attack = null;
    victim.attackConnected = false;
    toStance(victim, 'knockdown', tick, RING.knockdownTicks);
  } else {
    victim.attack = null;
    victim.attackConnected = false;
    toStance(victim, 'hitstun', tick, spec.hitstun);
  }
}

/**
 * Decide whether the fight has ended.
 *
 * Both endings are checked for BOTH fighters before either is declared, so a simultaneous knockout
 * or a double ring-out is a draw rather than a win for whoever is first in the array.
 */
function judge(state: FightState, _tick: number): FightState['outcome'] {
  const [a, b] = state.fighters;
  const aOut = Math.abs(a.x) > RING.halfWidth;
  const bOut = Math.abs(b.x) > RING.halfWidth;
  if (aOut && bOut) return { kind: 'draw' };
  if (aOut) return { kind: 'ringout', winner: b.id };
  if (bOut) return { kind: 'ringout', winner: a.id };

  const aDead = a.hp <= 0;
  const bDead = b.hp <= 0;
  if (aDead && bDead) return { kind: 'draw' };
  if (aDead) return { kind: 'ko', winner: b.id };
  if (bDead) return { kind: 'ko', winner: a.id };
  return { kind: 'ongoing' };
}
