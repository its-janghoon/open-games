import { laneWaypoints } from './map';
import { advanceMinion, minionStats, spawnMinion, type Minion } from './minions';
import type { PendingWaveSpawn, WaveSchedule } from './waveSchedule';

/**
 * A minion as snapshot state: its body, its health, and an identity two peers agree on.
 *
 * `Minion` was already plain data and `advanceMinion` was already pure and documented as such — the movement half of
 * this never needed extracting. What was missing was the LIST: minions existed only as scene entities, so a rollback
 * restored champions into a world whose minion population was whatever the scene happened to be holding.
 */
export interface MinionState extends Minion {
  /**
   * Identity, derived from the wave schedule's insertion order.
   *
   * This is the part that makes a dynamic set rewindable at all. A minion created during a replayed tick must be the
   * SAME minion as the one created the first time, or the two peers disagree about which body took which hit — and an
   * id from a counter that resets, or from array position, or from anything the renderer touches, cannot promise that.
   * The wave schedule already stamps every queued member with a unique monotonic insertionOrder, precisely so equal
   * deadlines can be ordered; reusing it here means identity costs nothing new and is already covered by that
   * counter's own tests.
   */
  id: string;
  hp: number;
  maxHp: number;
  dead: boolean;
  /** True once the minion has walked its whole lane path. */
  atEnd: boolean;
  /** Seconds until this minion may swing again. Absolute-free: it only ever counts down by dt within a tick. */
  attackCdRemaining: number;
}

/** The id a queued spawn will become. Deterministic, so a replay reproduces it exactly. */
export function minionIdFor(spawn: PendingWaveSpawn): string {
  return `m${spawn.insertionOrder}-${spawn.team}-${spawn.lane}`;
}

/** Turn a due queue entry into a live minion. */
export function minionFromSpawn(spawn: PendingWaveSpawn): MinionState {
  const body = spawnMinion(spawn.type, spawn.team, spawn.lane);
  const stats = minionStats(spawn.type);
  return {
    ...body,
    id: minionIdFor(spawn),
    hp: stats.hp,
    maxHp: stats.hp,
    dead: false,
    atEnd: false,
    attackCdRemaining: 0,
  };
}

/** A fully independent copy — positions are objects, so a shallow copy would share them. */
export function cloneMinions(minions: readonly MinionState[]): MinionState[] {
  return minions.map((minion) => ({ ...minion, pos: { x: minion.pos.x, y: minion.pos.y } }));
}

export interface AdmitResult {
  minions: MinionState[];
  waves: WaveSchedule;
}

/**
 * Admit every queued spawn whose time has come, up to the per-lane population cap.
 *
 * Pure, and the cap is the interesting part: a scheduled wave member is authoritative, so one that cannot be admitted
 * is DEFERRED rather than dropped. Dropping it would mean the two peers' populations depend on the order they happened
 * to process the queue; deferring keeps the member in the queue with a later deadline, which is a decision both peers
 * reach identically from the same state.
 */
export function admitDueMinions(
  minions: readonly MinionState[],
  waves: WaveSchedule,
  nowSeconds: number,
  capPerLane: number,
  retrySeconds: number,
): AdmitResult {
  const live = new Map<string, number>();
  for (const minion of minions) {
    if (minion.dead) continue;
    const key = `${minion.team}:${minion.lane}`;
    live.set(key, (live.get(key) ?? 0) + 1);
  }

  const admitted = cloneMinions(minions);
  const stillPending: PendingWaveSpawn[] = [];

  // Due entries in deadline order, then insertion order — the same tiebreak the impact queue uses, and for the same
  // reason: two entries sharing a deadline must not be ordered by array position.
  const due = waves.pending
    .filter((spawn) => spawn.dueAt <= nowSeconds)
    .sort((a, b) => a.dueAt - b.dueAt || a.insertionOrder - b.insertionOrder);
  for (const spawn of waves.pending) {
    if (spawn.dueAt > nowSeconds) stillPending.push({ ...spawn });
  }

  for (const spawn of due) {
    const key = `${spawn.team}:${spawn.lane}`;
    const count = live.get(key) ?? 0;
    if (count >= capPerLane) {
      stillPending.push({ ...spawn, dueAt: nowSeconds + retrySeconds });
      continue;
    }
    admitted.push(minionFromSpawn(spawn));
    live.set(key, count + 1);
  }

  return {
    minions: admitted,
    waves: { spawnedWaves: waves.spawnedWaves, nextOrder: waves.nextOrder, pending: stillPending },
  };
}

/**
 * Walk every living minion one tick along its lane.
 *
 * Delegates to the existing pure advanceMinion rather than reimplementing the walk — that function already computes
 * position, waypoint and cumulative distance from the path, and is already tested. This is the list-level step it
 * never had, which is the same relationship scheduleDueWaves has to nextWaveNumberAt.
 */
export function advanceMinions(minions: readonly MinionState[], dt: number): MinionState[] {
  return minions.map((minion) => {
    if (minion.dead) return { ...minion, pos: { x: minion.pos.x, y: minion.pos.y } };
    const result = advanceMinion(minion, laneWaypoints(minion.lane, minion.team), dt);
    return {
      ...minion,
      pos: { x: result.pos.x, y: result.pos.y },
      waypointIndex: result.waypointIndex,
      distanceTravelled: result.distanceTravelled,
      atEnd: result.atEnd,
    };
  });
}

/**
 * Drop minions that are dead AND have been dealt with, keeping the list from growing without bound.
 *
 * Deliberately conservative: a dead minion is kept for now because something else may still need to read it this tick
 * (a bounty, a kill credit). Removing it in the same step that killed it is how a kill loses its reward.
 */
export function reapMinions(minions: readonly MinionState[]): MinionState[] {
  return cloneMinions(minions.filter((minion) => !minion.dead));
}
