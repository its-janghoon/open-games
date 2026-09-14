import {
  cloneGridWorld,
  createPlayer,
  isAlive,
  isSolid,
  RULES,
  SPAWNS,
  wrapAngle,
  type FpsInput,
  type GridWorld,
  type MatchOutcome,
  type Player,
  type Shot,
} from './gridWorld';

/**
 * One tick of the world.
 *
 * Order is fixed and stated because it decides outcomes:
 *
 *   1. respawn anyone whose deadline has passed, so they can act on THIS tick
 *   2. turn and move every player, before any shot is fired or advanced
 *   3. fire, from the post-movement position
 *   4. advance shots and resolve hits, both directions simultaneously
 *   5. apply deaths
 *
 * Step 4 is simultaneous for the same reason it is in the fighter: resolving one player's shots before the
 * other's would let whoever is checked first win every mutual kill, and which one that is would come down
 * to array order — so two peers could disagree about a double kill from the same inputs.
 */
export function stepGrid(
  world: GridWorld,
  inputs: ReadonlyMap<string, FpsInput>,
  tick: number,
): GridWorld {
  const next = cloneGridWorld(world);
  next.tick = tick;
  /**
   * A decided match is frozen, and the check is FIRST so nothing else in the tick can run.
   *
   * Freezing matters more than it looks: without it a shot already in flight lands after the winning kill, a
   * respawn timer keeps firing, and the score keeps moving after someone has won — so the state two peers must
   * agree on carries on changing past the moment the match ended. Returning early makes the outcome terminal in
   * the state rather than merely displayed by the scene.
   */
  if (next.outcome.kind !== 'ongoing') return next;
  // Per-tick sequence, a local rather than state: shot ids include the tick, so they stay unique.
  let shotSeq = 0;

  // 1. Respawn.
  next.players.forEach((player, index) => {
    if (player.respawnAt !== null && tick >= player.respawnAt) {
      const fresh = createPlayer(player.id, index);
      // Kills and deaths survive a respawn: they are the scoreline, not the body.
      next.players[index] = { ...fresh, kills: player.kills, deaths: player.deaths };
    }
  });

  // 2. Turn and move.
  for (const player of next.players) {
    if (!isAlive(player)) continue;
    const input = inputs.get(player.id);
    if (!input) continue;
    turn(player, input);
    move(player, input);
  }

  // 3. Fire, from where the player ended up. Firing before movement would let a player shoot from a
  // position they had already left, which reads as the shot coming out of nothing.
  for (const player of next.players) {
    if (!isAlive(player)) continue;
    const input = inputs.get(player.id);
    if (!input?.fire || tick < player.fireReadyAt) continue;
    player.fireReadyAt = tick + RULES.fireCooldown;
    next.shots.push(spawnShot(player, tick, shotSeq));
    shotSeq += 1;
  }

  // 4. Advance shots and resolve hits. Damage is collected first and applied afterwards, so a shot cannot
  // be spared by a death its own tick caused, and two mutual kills both land.
  const damage = new Map<string, number>();
  const credit = new Map<string, string[]>();
  const surviving: Shot[] = [];
  for (const shot of next.shots) {
    const outcome = advanceShot(shot, next.players, tick);
    if (outcome.hit) {
      damage.set(outcome.hit, (damage.get(outcome.hit) ?? 0) + RULES.shotDamage);
      const list = credit.get(outcome.hit) ?? [];
      list.push(shot.ownerId);
      credit.set(outcome.hit, list);
      continue;
    }
    if (!outcome.gone) surviving.push(shot);
  }
  next.shots = surviving;

  // 5. Apply.
  for (const player of next.players) {
    const taken = damage.get(player.id);
    if (taken === undefined || !isAlive(player)) continue;
    player.hp = Math.max(0, player.hp - taken);
    if (player.hp > 0) continue;
    player.respawnAt = tick + RULES.respawnTicks;
    player.deaths += 1;
    // Credit the first shot that landed this tick. Deterministic because the shot list is ordered and the
    // order is part of the state; "whoever did the most damage" would need a tiebreak of its own.
    const killerId = credit.get(player.id)?.[0];
    const killer = next.players.find((candidate) => candidate.id === killerId);
    if (killer && killer.id !== player.id) killer.kills += 1;
  }

  // 6. Judge. After every death this tick has been applied, so a double kill that takes both players to the limit
  // on the same tick is seen as the tie it is.
  next.outcome = judgeMatch(next.players);

  return next;
}

/**
 * Decide the match from the score.
 *
 * Both players are checked BEFORE either is declared the winner, so simultaneous kills that take both to the limit
 * are a draw rather than a win for whoever sits first in the array. That is the same rule the fighter uses for a
 * double knockout, and for the same reason: array order is not a game mechanic, and two peers iterating the same
 * array must not be the thing that decides who won.
 */
function judgeMatch(players: readonly Player[]): MatchOutcome {
  const reached = players.filter((player) => player.kills >= RULES.killLimit);
  if (reached.length === 0) return { kind: 'ongoing' };
  if (reached.length > 1) return { kind: 'draw' };
  return { kind: 'win', winnerId: reached[0].id };
}

function turn(player: Player, input: FpsInput): void {
  const delta = (input.turnRight ? 1 : 0) - (input.turnLeft ? 1 : 0);
  if (delta !== 0) player.angle = wrapAngle(player.angle + delta * RULES.turnSpeed);
}

/**
 * Move with wall collision, substepped.
 *
 * Axis-separated on purpose: sliding along a wall is what makes a corridor navigable, and resolving both
 * axes together turns every glancing contact into a dead stop.
 *
 * Substepping is what makes passing through a wall impossible rather than unlikely. A single step of the
 * full distance can start on one side of a thin wall and end on the other with both endpoints in open
 * space, so no endpoint test would ever see the wall it crossed. Each substep is capped below the wall
 * thickness, so there is no distance at which the check can be skipped over.
 */
function move(player: Player, input: FpsInput): void {
  const forward = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
  const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (forward === 0 && strafe === 0) return;

  const cos = Math.cos(player.angle);
  const sin = Math.sin(player.angle);
  const dx = cos * forward * RULES.moveSpeed - sin * strafe * RULES.strafeSpeed;
  const dy = sin * forward * RULES.moveSpeed + cos * strafe * RULES.strafeSpeed;
  slide(player, dx, dy);
}

/**
 * Apply a movement delta with substepped, axis-separated collision.
 *
 * Exported so a test can drive a delta the game itself never produces. That matters: the first version of
 * the substep test looped over a list of speeds and then ignored it, running every case at the normal
 * 0.075 tiles per tick — where a single step cannot cross a wall anyway. Injecting `steps = 1` failed
 * nothing, so the test for the property this function exists to guarantee was inert. Taking the delta as
 * an argument is what makes the guarantee checkable.
 */
export function slide(player: { x: number; y: number }, dx: number, dy: number): void {
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return;
  const steps = Math.max(1, Math.ceil(distance / RULES.maxSubstep));
  const stepX = dx / steps;
  const stepY = dy / steps;

  for (let i = 0; i < steps; i += 1) {
    if (!blocked(player.x + stepX, player.y, RULES.radius)) player.x += stepX;
    if (!blocked(player.x, player.y + stepY, RULES.radius)) player.y += stepY;
  }
}

/**
 * True when a circle of `radius` at this point overlaps a solid tile.
 *
 * Four corner samples rather than the centre alone. Testing only the centre lets a player's body sink half
 * way into a wall before anything objects, which looks like the collision is broken even though the rule
 * is being followed exactly.
 */
function blocked(x: number, y: number, radius: number): boolean {
  return (
    isSolid(x - radius, y - radius) ||
    isSolid(x + radius, y - radius) ||
    isSolid(x - radius, y + radius) ||
    isSolid(x + radius, y + radius)
  );
}

function spawnShot(player: Player, tick: number, seq: number): Shot {
  const cos = Math.cos(player.angle);
  const sin = Math.sin(player.angle);
  return {
    // Deterministic id from owner, tick and sequence. Never random: a random id would differ between two
    // peers simulating the same tick, and anything keyed on it would diverge immediately.
    id: `${player.id}:${tick}:${seq}`,
    ownerId: player.id,
    // Started clear of the shooter's own body, or the first substep resolves against the shooter.
    x: player.x + cos * (RULES.radius + RULES.shotRadius + 0.02),
    y: player.y + sin * (RULES.radius + RULES.shotRadius + 0.02),
    dirX: cos,
    dirY: sin,
    expiresAt: tick + RULES.shotLifetime,
  };
}

export interface ShotOutcome {
  /** Id of the player hit, or null. */
  hit: string | null;
  /** True when the shot should be removed without having hit anyone. */
  gone: boolean;
}

/**
 * Advance a shot, substepped, and report what it struck.
 *
 * Substepped for the same reason movement is: a shot moving 0.42 tiles a tick would otherwise step clean
 * over a wall or straight past a player standing between its endpoints. This is the version of "fast
 * bullets miss thin targets" that every hitscan-free shooter has to answer, and answering it with a
 * substep is cheaper and more obviously correct than a swept-capsule test.
 */
export function advanceShot(
  shot: Shot,
  players: readonly Player[],
  tick: number,
  speed: number = RULES.shotSpeed,
): ShotOutcome {
  if (tick >= shot.expiresAt) return { hit: null, gone: true };
  const steps = Math.max(1, Math.ceil(speed / RULES.maxSubstep));
  const stepX = (shot.dirX * speed) / steps;
  const stepY = (shot.dirY * speed) / steps;

  for (let i = 0; i < steps; i += 1) {
    shot.x += stepX;
    shot.y += stepY;
    if (isSolid(shot.x, shot.y)) return { hit: null, gone: true };
    for (const player of players) {
      if (!isAlive(player) || player.id === shot.ownerId) continue;
      const reach = RULES.radius + RULES.shotRadius;
      if (Math.abs(shot.x - player.x) <= reach && Math.abs(shot.y - player.y) <= reach) {
        return { hit: player.id, gone: true };
      }
    }
  }
  return { hit: null, gone: false };
}

/** Every spawn point must be open, or a player materialises inside a wall. Exported for the test. */
export function spawnsAreClear(): boolean {
  return SPAWNS.every((spawn) => !blocked(spawn.x, spawn.y, RULES.radius));
}
