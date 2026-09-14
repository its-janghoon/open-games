import type { Simulation } from '@open-games/shared';

import {
  cloneGridWorld,
  createGridWorld,
  NEUTRAL_FPS_INPUT,
  type FpsInput,
  type GridWorld,
} from './gridWorld';
import { stepGrid } from './stepGrid';

/**
 * The grid world as a rollback simulation.
 *
 * Written and tested BEFORE the renderer, deliberately. Doing it the other way round in champs meant the
 * world advanced inside a Phaser scene and pulling it back out took six commits; doing it in this order
 * for the fighter meant the renderer had nothing to argue with. So the state proves it can be rolled back
 * first, and only then does anything draw it.
 *
 * `predict` repeats the last input, which is right for a shooter for a concrete reason: movement keys are
 * held. A player walking forward is still holding forward next tick, so repeating is usually correct, and
 * when it is wrong it is wrong for only the few ticks until the truth arrives.
 */
export function createGridSimulation(
  ids: readonly [string, string],
): Simulation<GridWorld, FpsInput> {
  return {
    initial: () => createGridWorld(ids),
    step: (world, inputs, tick) => stepGrid(world, inputs, tick),
    clone: cloneGridWorld,
    predict: (_participantId, lastKnown) => (lastKnown ? { ...lastKnown } : NEUTRAL_FPS_INPUT),
  };
}

/**
 * Rounding applied before hashing.
 *
 * Two machines can differ in the last bit of a float without having diverged in any way a player could
 * observe, and a divergence check that fires on that is a check people learn to ignore. Four decimals is
 * far finer than anything visible at this scale — a tile is one unit — and far coarser than float noise.
 */
const HASH_DECIMALS = 4;

/**
 * A comparable string covering EVERY simulation field.
 *
 * Every field, and nothing else. A hash that omits a field cannot see a divergence in it; a hash that
 * includes a render value reports a desync between two peers who agree about the game. Since the state is
 * complete — the map is a constant, and nothing else lives outside it — "every field" is a short list
 * rather than a judgement call, which is exactly why the raycast shape was chosen.
 *
 * There is a test that mutates each field in turn and requires this to move, because keeping a hash in step
 * with a growing state by hand is precisely the thing that silently stops being true.
 */
export function hashGridWorld(world: GridWorld): string {
  const round = (value: number) => value.toFixed(HASH_DECIMALS);
  const players = world.players
    .map((p) =>
      [
        p.id,
        round(p.x),
        round(p.y),
        round(p.angle),
        round(p.hp),
        p.fireReadyAt,
        p.respawnAt ?? '-',
        p.kills,
        p.deaths,
      ].join(','),
    )
    .join(';');
  // Shot order is part of the state — kill credit reads the first shot that landed — so the list is hashed
  // in order rather than sorted. Sorting would hide a reordering that the simulation can actually observe.
  const shots = world.shots
    .map((s) =>
      [s.id, s.ownerId, round(s.x), round(s.y), round(s.dirX), round(s.dirY), s.expiresAt].join(','),
    )
    .join(';');
  return `${world.tick}|${players}|${shots}`;
}
