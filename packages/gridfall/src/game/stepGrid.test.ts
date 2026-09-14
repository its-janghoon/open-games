import { describe, it, expect } from 'vitest';

import {
  cloneGridWorld,
  createGridWorld,
  GRID_SIZE,
  isSolid,
  NEUTRAL_FPS_INPUT,
  RULES,
  wrapAngle,
  type FpsInput,
  type GridWorld,
} from './gridWorld';
import { advanceShot, slide, spawnsAreClear, stepGrid } from './stepGrid';

const IDS = ['a', 'b'] as const;
const hold = (over: Partial<FpsInput> = {}): FpsInput => ({ ...NEUTRAL_FPS_INPUT, ...over });
const fresh = () => createGridWorld(IDS);
const idle = () => new Map<string, FpsInput>();

function run(
  world: GridWorld,
  ticks: number,
  inputAt: (tick: number) => Map<string, FpsInput>,
): GridWorld {
  let current = world;
  for (let i = 0; i < ticks; i += 1) current = stepGrid(current, inputAt(current.tick), current.tick + 1);
  return current;
}

describe('the map', () => {
  it('is enclosed, so nothing can leave the grid', () => {
    for (let i = 0; i < GRID_SIZE; i += 1) {
      expect(isSolid(i + 0.5, 0.5), `top ${i}`).toBe(true);
      expect(isSolid(i + 0.5, GRID_SIZE - 0.5), `bottom ${i}`).toBe(true);
      expect(isSolid(0.5, i + 0.5), `left ${i}`).toBe(true);
      expect(isSolid(GRID_SIZE - 0.5, i + 0.5), `right ${i}`).toBe(true);
    }
  });

  it('treats anything outside the grid as solid', () => {
    // Cheaper and safer than a bounds check at every call site: an out-of-range read that returned
    // undefined would compare as not-solid and let a player walk into nothing.
    expect(isSolid(-1, 5)).toBe(true);
    expect(isSolid(5, -1)).toBe(true);
    expect(isSolid(GRID_SIZE + 4, 5)).toBe(true);
  });

  it('puts both spawns in open space', () => {
    expect(spawnsAreClear()).toBe(true);
  });
});

describe('state contract', () => {
  it('clones so that mutating the copy cannot touch the original', () => {
    const original = fresh();
    original.shots.push({
      id: 'x',
      ownerId: 'a',
      x: 5,
      y: 5,
      dirX: 1,
      dirY: 0,
      expiresAt: 50,
    });
    const copy = cloneGridWorld(original);
    copy.players[0].x = -99;
    copy.players[0].kills = 7;
    copy.shots[0].x = -99;
    copy.shots.push({ id: 'y', ownerId: 'b', x: 0, y: 0, dirX: 0, dirY: 1, expiresAt: 9 });
    copy.nextShotSeq = 42;
    expect(original.players[0].x).not.toBe(-99);
    expect(original.players[0].kills).toBe(0);
    expect(original.shots[0].x).toBe(5);
    expect(original.shots).toHaveLength(1);
    expect(original.nextShotSeq).toBe(0);
  });

  it('does not mutate the world it was given', () => {
    const before = fresh();
    const untouched = cloneGridWorld(before);
    stepGrid(before, new Map([['a', hold({ forward: true, fire: true })]]), 1);
    expect(before).toEqual(untouched);
  });

  it('is deterministic: the same inputs from the same world give the same world', () => {
    const script = (tick: number) =>
      new Map([
        ['a', hold({ forward: tick % 3 !== 0, turnRight: tick % 5 === 0, fire: tick % 19 === 0 })],
        ['b', hold({ back: tick % 4 === 0, turnLeft: tick % 7 === 0, fire: tick % 23 === 0 })],
      ]);
    expect(run(fresh(), 200, script)).toEqual(run(fresh(), 200, script));
  });
});

describe('wall collision', () => {
  it('never lets a player end a tick inside a wall, from any angle', () => {
    // The property, swept over the whole circle rather than at a few convenient headings. A diagonal
    // approach is where axis-separated movement is most likely to be wrong.
    for (let step = 0; step < 64; step += 1) {
      const world = fresh();
      world.players[0] = { ...world.players[0], x: 2.5, y: 2.5, angle: (step / 64) * Math.PI * 2 };
      const after = run(world, 120, () => new Map([['a', hold({ forward: true })]]));
      const p = after.players[0];
      expect(isSolid(p.x, p.y), `angle step ${step} ended in a wall at ${p.x},${p.y}`).toBe(false);
    }
  });

  it('cannot cross a wall at any delta, however large', () => {
    /**
     * The reason movement is substepped, tested through a seam that can be driven and against the RIGHT
     * obstacle. Two earlier versions of this test failed to catch `steps = 1`:
     *
     *   - the first declared a list of speeds and ignored it, running every case at the normal 0.075
     *     tiles per tick, where a single step cannot cross a wall regardless;
     *   - the second drove a huge delta at the map BOUNDARY, where an unsubstepped step lands outside the
     *     grid, which `isSolid` reports as solid — so the naive version was blocked outright rather than
     *     tunnelling, and passed.
     *
     * An INTERIOR block is the case that actually distinguishes them: open space on both sides, solid in
     * between, so an unsubstepped step begins and ends legally while passing straight through a wall.
     */
    // The block at tiles x 5..7, y 5..7. Start above it, aim below it.
    const start = { x: 6.0, y: 3.5 };
    for (const delta of [0.5, 2, 5, 9, 40]) {
      const body = { ...start };
      slide(body, 0, delta);
      expect(
        isSolid(body.x, body.y),
        `delta ${delta} ended inside the block at ${body.x},${body.y}`,
      ).toBe(false);
      expect(
        body.y,
        `delta ${delta} tunnelled through the block (y ${body.y} is past it)`,
      ).toBeLessThan(5);
    }
  });

  it('still cannot leave the grid at any delta', () => {
    for (const delta of [0.5, 2, 40]) {
      for (const [dx, dy] of [
        [-delta, 0],
        [delta, 0],
        [0, -delta],
        [0, delta],
      ]) {
        const body = { x: 11.5, y: 3.5 };
        for (let i = 0; i < 12; i += 1) slide(body, dx, dy);
        expect(body.x).toBeGreaterThan(0);
        expect(body.x).toBeLessThan(GRID_SIZE);
        expect(body.y).toBeGreaterThan(0);
        expect(body.y).toBeLessThan(GRID_SIZE);
        expect(isSolid(body.x, body.y)).toBe(false);
      }
    }
  });

  it('does not let a fast shot skip over a player', () => {
    /**
     * Substepping shots is NOT load-bearing at the current tuning, and that is worth stating rather than
     * implying: at 0.42 tiles a tick against a 0.68-wide hit reach and one-tile walls, a single step
     * cannot skip anything, so injecting `steps = 1` into the shot path failed nothing. It is a guard
     * against a future speed increase — and guard code no test exercises is where a regression waits, the
     * same hole the IK reach clamp had in Ringout.
     *
     * So the speed is passed in and driven past the point where a single step would tunnel.
     */
    const victim = { ...createGridWorld(IDS).players[1], x: 12, y: 3.5, respawnAt: null };
    for (const speed of [0.42, 1.5, 6, 30]) {
      const shot = {
        id: 's',
        ownerId: 'a',
        x: 10,
        y: 3.5,
        dirX: 1,
        dirY: 0,
        expiresAt: 999,
      };
      let hit: string | null = null;
      for (let i = 0; i < 40 && hit === null; i += 1) {
        const outcome = advanceShot(shot, [victim], 1, speed);
        if (outcome.hit) hit = outcome.hit;
        if (outcome.gone) break;
      }
      expect(hit, `speed ${speed}: the shot passed through the player`).toBe(victim.id);
    }
  });

  it('slides along a wall instead of stopping dead against it', () => {
    // Axis-separated movement exists for this. Resolving both axes together turns every glancing contact
    // into a full stop, and a corridor becomes unusable.
    const world = fresh();
    // Just inside the top wall, facing right and slightly up.
    world.players[0] = { ...world.players[0], x: 5, y: 1.3, angle: -0.35 };
    const after = run(world, 40, () => new Map([['a', hold({ forward: true })]]));
    expect(after.players[0].x, 'should have travelled along the wall').toBeGreaterThan(6);
    expect(isSolid(after.players[0].x, after.players[0].y)).toBe(false);
  });

  it('keeps the body out of the wall, not just the centre point', () => {
    // Testing only the centre lets half a player sink into a wall before anything objects, which reads as
    // broken collision even though the rule is being obeyed.
    const world = fresh();
    // In the open corridor along y = 3.5, walking up into the top wall. Note (5,5) is INSIDE an
    // interior block — three earlier versions of these fixtures stood players in a wall and the
    // failures looked like collision bugs.
    world.players[0] = { ...world.players[0], x: 8, y: 3.5, angle: -Math.PI / 2 };
    const after = run(world, 200, () => new Map([['a', hold({ forward: true })]]));
    const p = after.players[0];
    for (const [ox, oy] of [
      [-RULES.radius, -RULES.radius],
      [RULES.radius, -RULES.radius],
      [-RULES.radius, RULES.radius],
      [RULES.radius, RULES.radius],
    ]) {
      expect(isSolid(p.x + ox, p.y + oy), 'a corner of the body is inside a wall').toBe(false);
    }
  });
});

describe('angles', () => {
  it('wraps into a single canonical range', () => {
    // Two peers holding 0 and 2π for one facing would agree about the fight and disagree about the state,
    // which a checksum reports as a desync. One representation removes the question.
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI * 2)).toBeCloseTo(0, 10);
    expect(wrapAngle(-Math.PI / 2)).toBeCloseTo((Math.PI * 3) / 2, 10);
    expect(wrapAngle(Math.PI * 7)).toBeLessThan(Math.PI * 2);
  });

  it('stays wrapped after many turns in one direction', () => {
    const after = run(fresh(), 400, () => new Map([['a', hold({ turnRight: true })]]));
    expect(after.players[0].angle).toBeGreaterThanOrEqual(0);
    expect(after.players[0].angle).toBeLessThan(Math.PI * 2);
  });
});

describe('shooting', () => {
  it('respects the fire cooldown rather than firing every tick', () => {
    const after = run(fresh(), RULES.fireCooldown * 3, () => new Map([['a', hold({ fire: true })]]));
    // Shots expire or hit walls, so count what was minted rather than what survives.
    expect(after.players[0].fireReadyAt).toBeGreaterThan(0);
    const world = fresh();
    const once = stepGrid(world, new Map([['a', hold({ fire: true })]]), 1);
    const twice = stepGrid(once, new Map([['a', hold({ fire: true })]]), 2);
    expect(twice.shots.length, 'the second tick must not add a shot').toBe(once.shots.length);
  });

  it('gives every shot a distinct deterministic id', () => {
    // Never random: a random id would differ between two peers simulating the same tick, and anything
    // keyed on it would diverge immediately.
    const world = fresh();
    const after = stepGrid(
      world,
      new Map([
        ['a', hold({ fire: true })],
        ['b', hold({ fire: true })],
      ]),
      1,
    );
    const ids = after.shots.map((shot) => shot.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.includes(':1:'))).toBe(true);
  });

  it('does not let a shot hit the player who fired it', () => {
    const world = fresh();
    const after = run(world, 6, (tick) =>
      new Map([['a', hold({ fire: tick === 0 })]]),
    );
    expect(after.players[0].hp).toBe(RULES.maxHp);
  });

  it('kills a player standing in front of the muzzle', () => {
    const world = fresh();
    world.players[0] = { ...world.players[0], x: 8, y: 3.5, angle: 0 };
    world.players[1] = { ...world.players[1], x: 9.2, y: 3.5 };
    let current = world;
    const hits = Math.ceil(RULES.maxHp / RULES.shotDamage);
    for (let shot = 0; shot < hits; shot += 1) {
      current = stepGrid(current, new Map([['a', hold({ fire: true })]]), current.tick + 1);
      for (let i = 0; i < RULES.fireCooldown; i += 1) {
        current = stepGrid(current, idle(), current.tick + 1);
        // Keep the victim in place; it is respawn behaviour under test elsewhere.
        if (current.players[1].respawnAt !== null) break;
      }
      if (current.players[1].respawnAt !== null) break;
    }
    expect(current.players[1].respawnAt, 'the victim should be dead').not.toBeNull();
    expect(current.players[0].kills).toBe(1);
    expect(current.players[1].deaths).toBe(1);
  });

  it('stops a shot at a wall instead of firing through it', () => {
    const world = fresh();
    // Facing the left wall with the other player beyond it.
    world.players[0] = { ...world.players[0], x: 2, y: 3.5, angle: Math.PI };
    world.players[1] = { ...world.players[1], x: 0.5, y: 3.5 };
    const after = run(world, 20, (tick) => new Map([['a', hold({ fire: tick === 0 })]]));
    expect(after.players[1].hp).toBe(RULES.maxHp);
    expect(after.shots).toHaveLength(0);
  });

  it('expires a shot that hits nothing, so the world does not fill up', () => {
    const world = fresh();
    world.players[0] = { ...world.players[0], x: 12, y: 12, angle: 0 };
    world.players[1] = { ...world.players[1], x: 2.5, y: 21.5 };
    const after = run(world, RULES.shotLifetime + 20, (tick) =>
      new Map([['a', hold({ fire: tick === 0 })]]),
    );
    expect(after.shots).toHaveLength(0);
  });
});

describe('death and respawn', () => {
  it('brings a player back at their spawn once the deadline passes, keeping the score', () => {
    const world = fresh();
    world.players[1] = { ...world.players[1], hp: 1, x: 9, y: 9, respawnAt: 5, deaths: 2, kills: 1 };
    const after = run(world, 12, () => idle());
    const p = after.players[1];
    expect(p.respawnAt).toBeNull();
    expect(p.hp).toBe(RULES.maxHp);
    expect(p.x, 'back at a spawn point, not where they fell').not.toBe(9);
    expect(p.deaths, 'the scoreline survives the body').toBe(2);
    expect(p.kills).toBe(1);
  });

  it('resolves two mutual kills on the same tick, not just the first', () => {
    // Simultaneity again: damage is collected then applied, so a shot cannot be spared by a death its own
    // tick caused. Sequential resolution would let whoever is checked first survive.
    const world = fresh();
    world.players[0] = { ...world.players[0], x: 8, y: 3.5, angle: 0, hp: 10 };
    world.players[1] = { ...world.players[1], x: 9.0, y: 3.5, angle: Math.PI, hp: 10 };
    world.shots = [
      { id: 's1', ownerId: 'a', x: 8.6, y: 3.5, dirX: 1, dirY: 0, expiresAt: 999 },
      { id: 's2', ownerId: 'b', x: 8.4, y: 3.5, dirX: -1, dirY: 0, expiresAt: 999 },
    ];
    const after = stepGrid(world, idle(), 1);
    expect(after.players[0].respawnAt, 'a should be dead').not.toBeNull();
    expect(after.players[1].respawnAt, 'b should be dead too').not.toBeNull();
  });

  it('does not let a dead player move or shoot', () => {
    const world = fresh();
    world.players[0] = { ...world.players[0], respawnAt: 500, x: 5, y: 5 };
    const after = run(world, 30, () =>
      new Map([['a', hold({ forward: true, fire: true, turnRight: true })]]),
    );
    expect(after.players[0].x).toBe(5);
    expect(after.shots).toHaveLength(0);
  });
});
