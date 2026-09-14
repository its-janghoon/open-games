/**
 * Gridfall's world, complete.
 *
 * Phase 7 asks for a local-network FPS, and the renderer choice was made before any of this was written,
 * on a rollback argument rather than an aesthetic one.
 *
 * RAYCAST, not flat-shaded polygons. A raycast world is a tile grid plus a position and an angle per
 * player plus some projectiles — all plain numbers that clone in a few lines. Flat-shaded polygons need a
 * 3D transform, a vertex list and a scene graph, and the moment the renderer owns objects the state wants
 * to reference them; champs took six commits to undo exactly that entanglement. The rollback core needs a
 * COMPLETE state, and a raycast world is the shape that stays complete. It also needs no textures at all,
 * which keeps the download at engine-only size the way Ringout's 357 KB is.
 *
 * Everything below is plain data: no class instance, no Map, no Set. Deadlines are ABSOLUTE tick numbers,
 * never counting-down timers, for the reason established twice already in this project — a countdown
 * decremented per frame cannot be rewound without also knowing how many frames were undone, while a
 * deadline compared against a restored clock is correct by construction.
 */

/**
 * The map. A constant, deliberately NOT part of the world state.
 *
 * Nothing in the game changes a tile, so cloning the grid on every snapshot would copy 1024 numbers per
 * tick to preserve something that cannot differ. If a door or a destructible wall is ever added, the grid
 * has to move INTO the state that day — a mutable map outside the snapshot is a desync that survives
 * every rollback.
 */
export const GRID_SIZE = 24;

/** 1 is solid, 0 is open. A ring of wall with a few interior blocks to break sightlines. */
export const GRID: readonly number[] = buildGrid();

function buildGrid(): number[] {
  const cells: number[] = new Array(GRID_SIZE * GRID_SIZE).fill(0);
  const set = (x: number, y: number) => {
    cells[y * GRID_SIZE + x] = 1;
  };
  for (let i = 0; i < GRID_SIZE; i += 1) {
    set(i, 0);
    set(i, GRID_SIZE - 1);
    set(0, i);
    set(GRID_SIZE - 1, i);
  }
  // Interior blocks. Placed by hand rather than generated, because a fixed map is one fewer thing two
  // peers can disagree about — a generated one would need its seed in the state and in the wire protocol.
  const blocks: [number, number, number, number][] = [
    [5, 5, 3, 3],
    [16, 5, 3, 3],
    [5, 16, 3, 3],
    [16, 16, 3, 3],
    [11, 10, 2, 4],
  ];
  for (const [bx, by, w, h] of blocks) {
    for (let y = by; y < by + h; y += 1) {
      for (let x = bx; x < bx + w; x += 1) set(x, y);
    }
  }
  return cells;
}

/** True when the tile containing this point is solid, or the point is outside the grid. */
export function isSolid(x: number, y: number): boolean {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= GRID_SIZE || ty >= GRID_SIZE) return true;
  return GRID[ty * GRID_SIZE + tx] === 1;
}

export interface Player {
  id: string;
  x: number;
  y: number;
  /** Facing, in radians. Wrapped to [0, 2π) so two peers cannot hold different representations of it. */
  angle: number;
  hp: number;
  /** Tick this player may fire again. Absolute. */
  fireReadyAt: number;
  /** Tick a dead player returns, or null when alive. Absolute. */
  respawnAt: number | null;
  kills: number;
  deaths: number;
}

/**
 * A shot in flight.
 *
 * Travelling, not hitscan, and that is a rollback decision as much as a feel one. Hitscan resolves inside
 * the tick that fired it, so it is trivially correct and teaches nothing; a projectile decides damage
 * several ticks after the input that launched it, which is exactly the state a snapshot must carry and the
 * case that made champs' pending-impact queue worth extracting.
 */
export interface Shot {
  /** Deterministic id: owner plus the tick it was fired on plus a per-tick sequence. Never random. */
  id: string;
  ownerId: string;
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  /** Tick the shot expires if it has hit nothing. Absolute. */
  expiresAt: number;
}

export interface GridWorld {
  tick: number;
  players: Player[];
  shots: Shot[];
  /**
   * Next per-tick sequence number for shot ids.
   *
   * In the state for the same reason champs' insertion counter is: restore the shots but not the counter
   * and a replayed tick mints an id some surviving shot already holds, so two distinct projectiles become
   * indistinguishable and any logic keyed on the id silently merges them.
   */
  nextShotSeq: number;
}

export const RULES = {
  moveSpeed: 0.075,
  strafeSpeed: 0.055,
  turnSpeed: 0.055,
  /** Player radius for wall collision, in tiles. */
  radius: 0.22,
  maxHp: 100,
  shotDamage: 34,
  shotSpeed: 0.42,
  shotRadius: 0.12,
  /** Ticks between shots. */
  fireCooldown: 18,
  /** Ticks a shot lives before expiring. */
  shotLifetime: 90,
  respawnTicks: 90,
  /**
   * Largest distance a moving thing may advance in one collision substep, in tiles.
   *
   * This is what makes "cannot pass through a wall at any speed" structural instead of hopeful. A single
   * step of the full distance can begin on one side of a wall and end on the other with both endpoints in
   * open space, so no endpoint test would ever see the wall. Substepping below the wall thickness makes
   * that impossible rather than unlikely.
   */
  maxSubstep: 0.2,
} as const;

export const SPAWNS: readonly { x: number; y: number; angle: number }[] = [
  { x: 2.5, y: 2.5, angle: Math.PI / 4 },
  { x: GRID_SIZE - 2.5, y: GRID_SIZE - 2.5, angle: (Math.PI * 5) / 4 },
];

export interface FpsInput {
  forward: boolean;
  back: boolean
  left: boolean;
  right: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  fire: boolean;
}

export const NEUTRAL_FPS_INPUT: FpsInput = {
  forward: false,
  back: false,
  left: false,
  right: false,
  turnLeft: false,
  turnRight: false,
  fire: false,
};

export function createPlayer(id: string, spawnIndex: number): Player {
  const spawn = SPAWNS[spawnIndex % SPAWNS.length];
  return {
    id,
    x: spawn.x,
    y: spawn.y,
    angle: spawn.angle,
    hp: RULES.maxHp,
    fireReadyAt: 0,
    respawnAt: null,
    kills: 0,
    deaths: 0,
  };
}

export function createGridWorld(ids: readonly [string, string]): GridWorld {
  return {
    tick: 0,
    players: [createPlayer(ids[0], 0), createPlayer(ids[1], 1)],
    shots: [],
    nextShotSeq: 0,
  };
}

/**
 * A fully independent copy.
 *
 * Written out rather than structuredClone or a JSON round trip, for the reason established in champs:
 * JSON drops undefined and flattens anything that is not a plain value, so it produces a snapshot that
 * looks right and restores wrong. The grid is absent on purpose — it is a constant, not state.
 */
export function cloneGridWorld(world: GridWorld): GridWorld {
  return {
    tick: world.tick,
    players: world.players.map((player) => ({ ...player })),
    shots: world.shots.map((shot) => ({ ...shot })),
    nextShotSeq: world.nextShotSeq,
  };
}

/** Wrap an angle into [0, 2π). Canonical, so two peers cannot hold different numbers for one facing. */
export function wrapAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  const wrapped = angle % twoPi;
  return wrapped < 0 ? wrapped + twoPi : wrapped;
}

export function isAlive(player: Player): boolean {
  return player.respawnAt === null;
}
