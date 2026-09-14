import type { Lane, MapSide } from './map';
import { laneWaveComposition, nextWaveNumberAt, type MinionType } from './minions';
import type { GameMode } from '../battleStore';
import { rulesForMode } from '../../config/matchRules';

/**
 * One scheduled minion, not yet spawned.
 *
 * Moved out of BattleScene because it held nothing from Phaser — the same move `PendingImpact` needed. `dueAt` is
 * ABSOLUTE sim time, never a countdown, for the reason every deadline in this codebase is: a countdown cannot be
 * rewound without knowing how many ticks were undone.
 */
export interface PendingWaveSpawn {
  dueAt: number;
  insertionOrder: number;
  type: MinionType;
  team: MapSide;
  lane: Lane;
}

/**
 * The wave schedule: which waves have been scheduled, and what is queued to appear.
 *
 * This is the deterministic backbone of a match's minions — it decides WHICH minions exist and WHEN. It is snapshot
 * state and the queue's shape is exactly why: two peers who disagree about the queue disagree about the population of
 * the map, and a rollback that restored champions while dropping queued spawns would delete minions that were already
 * scheduled and paid for. That is the same failure the impact queue had, so this follows the impact queue's design
 * rather than inventing one.
 *
 * `nextOrder` is the half that is easy to leave out, and it is state for the same reason nextInsertionOrder is:
 * restore the queue but not the counter and a spawn scheduled after the restore is stamped with a number an entry
 * still in the queue already holds, so two spawns sharing a deadline become indistinguishable and the tiebreak has
 * nothing left to break on.
 *
 * Deliberately NOT the whole minion story: this covers scheduling only. Minion bodies — movement, combat, death —
 * are still advanced inside BattleScene, so a whole champs match is still not rollback-proven. That gap is named
 * rather than papered over.
 */
export interface WaveSchedule {
  /** How many waves have been scheduled so far. */
  spawnedWaves: number;
  pending: PendingWaveSpawn[];
  nextOrder: number;
}

export function initialWaveSchedule(): WaveSchedule {
  return { spawnedWaves: 0, pending: [], nextOrder: 0 };
}

/** A fully independent copy — the queue entries are copied, not shared. */
export function cloneWaveSchedule(schedule: WaveSchedule): WaveSchedule {
  return {
    spawnedWaves: schedule.spawnedWaves,
    pending: schedule.pending.map((spawn) => ({ ...spawn })),
    nextOrder: schedule.nextOrder,
  };
}

/**
 * Whether the enemy inhibitor guarding a lane is down, which is what upgrades a wave to super minions.
 *
 * Takes the structure kill time rather than reading a scene Map, so scheduling depends only on snapshot state.
 */
export interface LaneInhibitorState {
  /** Keyed `${side}-${lane}-inhibitor`, holding the absolute kill time or null while it stands. */
  killedAt: Record<string, number | null>;
}

/**
 * Schedule every wave that is due, appending its members to the queue.
 *
 * Pure: the schedule goes in and a new schedule comes out. The catch-up loop is taken from the scene — `wanted` is a
 * pure function of elapsed time, so a replayed tick reaches the same wave number, and the loop exists so a frame that
 * swallowed several wave intervals still schedules each of them exactly once.
 */
export function scheduleDueWaves(
  schedule: WaveSchedule,
  elapsedSeconds: number,
  lanes: readonly Lane[],
  inhibitors: LaneInhibitorState,
  isInhibitorAlive: (now: number, killedAt: number | null) => boolean,
  mode: GameMode = 'conquest',
): WaveSchedule {
  const wanted = nextWaveNumberAt(elapsedSeconds, mode);
  if (wanted <= schedule.spawnedWaves) return cloneWaveSchedule(schedule);

  const next = cloneWaveSchedule(schedule);
  const stagger = rulesForMode(mode).waves.unitStaggerMilliseconds / 1000;
  while (next.spawnedWaves < wanted) {
    next.spawnedWaves += 1;
    const waveNumber = next.spawnedWaves;
    for (const team of ['ally', 'enemy'] as MapSide[]) {
      for (const lane of lanes) {
        const enemySide: MapSide = team === 'ally' ? 'enemy' : 'ally';
        const killedAt = inhibitors.killedAt[`${enemySide}-${lane}-inhibitor`] ?? null;
        const inhibitorsDown = isInhibitorAlive(elapsedSeconds, killedAt) ? 0 : 1;
        laneWaveComposition(waveNumber, inhibitorsDown).forEach((type, index) => {
          next.pending.push({
            dueAt: elapsedSeconds + index * stagger,
            insertionOrder: next.nextOrder,
            type,
            team,
            lane,
          });
          next.nextOrder += 1;
        });
      }
    }
  }
  return next;
}
