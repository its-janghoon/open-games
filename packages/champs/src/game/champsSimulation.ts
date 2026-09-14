import type { Simulation } from '@open-games/shared';

import { effectiveDamage, type Unit } from './combat';
import { createChampionLifeState } from './championLifeState';
import { createEffectState } from './effects';
import { initialGold } from './rift/economy';
import { initialStructure, reviveStructures } from './rift/structures';
import {
  advanceEconomy,
  advanceEffects,
  advanceLives,
  advanceTimers,
  cloneWorldState,
  drainDueImpacts,
  moveUnitToward,
  queueImpact,
  type WorldState,
} from './worldStep';

/**
 * The fixed step, in seconds. Rollback needs a fixed step: a variable one makes the state
 * after N ticks depend on frame timing, so two peers replaying the same inputs land in
 * different places.
 */
export const TICK_SECONDS = 1 / 60;

/**
 * One participant's order for one tick.
 *
 * Deliberately tiny, and deliberately plain data. The rollback core compares inputs with
 * JSON.stringify to decide whether a prediction was right, so an Input holding a Map, a Set
 * or a class instance would compare as equal when it was not. `moveTo: null` means "no order
 * this tick", which is a real input rather than an absence - it is what the predictor repeats.
 */
export interface ChampsInput {
  moveTo: { x: number; y: number } | null;
  /**
   * Fire at the other champion this tick.
   *
   * Present so the simulation actually exercises the impact queue. Without it the queue is
   * always empty, and a rollback test over an empty queue silently proves nothing about the
   * queue - measured: with no cast in the scenario, deliberately draining impacts before the
   * clock moved did not fail a single assertion.
   */
  cast?: boolean;
}

export const IDLE_INPUT: ChampsInput = { moveTo: null };

/** Seconds a shot spends in the air. Fixed, so a replay reproduces the same deadline. */
export const SHOT_FLIGHT_SECONDS = 0.2;

/**
 * Champs' world as a rollback simulation.
 *
 * This is the JOIN between the extracted step and the rollback core, and its value is
 * diagnostic before it is functional: whatever a resimulation gets wrong here names the state
 * still missing from WorldState. Gold and structures are now in it; MINION WAVES are not, so this
 * simulation is a faithful model of a fight between champions plus their economy and their
 * buildings, and not yet of a whole match.
 *
 * BattleScene remains the authority for real matches. Nothing here is wired into it.
 */
export function createChampsSimulation(
  participants: readonly string[],
): Simulation<WorldState, ChampsInput> {
  return {
    initial(): WorldState {
      const units: Unit[] = participants.map((id, index) => ({
        id,
        kind: 'champion',
        team: index === 0 ? 'ally' : 'enemy',
        pos: { x: 100 + index * 200, y: 300 },
        hp: 600,
        maxHp: 600,
        ad: 60,
        armor: 30,
        attackRange: 150,
        attackSpeed: 0.8,
        moveSpeed: 340,
        attackCdRemaining: 0,
        dead: false,
      }));
      return {
        tick: 0,
        simTime: 0,
        units,
        cooldowns: Object.fromEntries(participants.map((id) => [id, { Q: 0, W: 0, E: 0, R: 0 }])),
        effects: Object.fromEntries(participants.map((id) => [id, createEffectState()])),
        lives: Object.fromEntries(participants.map((id) => [id, createChampionLifeState()])),
        pendingImpacts: [],
        nextInsertionOrder: 0,
        // Both participants start with the same gold so a divergence cannot hide behind an initial asymmetry.
        // One inhibitor per side, at full health. Enough to exercise the revive deadline under rollback without
      // needing structure combat in this harness, which BattleScene still owns.
      structures: {
        allyInhibitor: initialStructure(2000),
        enemyInhibitor: initialStructure(2000),
      },
        economy: Object.fromEntries(participants.map((id) => [id, initialGold(500)])),
        moveGoals: Object.fromEntries(participants.map((id) => [id, null])),
      };
    },

    /**
     * Subsystem order is taken from BattleScene.update, not invented. Reading it mattered: the
     * scene advances its clock, then lives, then drains impacts, then sweeps expired effects,
     * then moves champions. Order is not cosmetic - draining impacts before the clock moves
     * would hold every hit back a tick, and the movement modifier order already proved in an
     * earlier commit that a plausible-looking reordering is a silent balance change.
     *
     * The one place this differs from the scene is where the effect sweep sits: advanceEffects
     * moves the clock and sweeps together, so the sweep happens before the impact drain rather
     * than after it. That is unobservable, and only because effect reads were made pure - a
     * read filters by deadline instead of relying on the sweep having run, so the sweep's
     * position cannot change an answer. There is a test for exactly that, rather than a
     * comment asserting it.
     */
    step(state, inputs, tick): WorldState {
      const next = cloneWorldState(state);
      next.tick = tick;

      for (const [id, input] of inputs) {
        if (input.moveTo) next.moveGoals[id] = { ...input.moveTo };
        // A null order does NOT clear the goal: a champion ordered to a point keeps walking
        // there while its player holds still, which is what makes repeat-last-input a
        // reasonable prediction rather than a stutter.
        if (input.cast) {
          const shooter = next.units.find((u) => u.id === id);
          const target = next.units.find((u) => u.id !== id);
          if (shooter && target && !shooter.dead) {
            queueImpact(next, {
              dueAt: next.simTime + SHOT_FLIGHT_SECONDS,
              source: { ...shooter, pos: { ...shooter.pos } },
              targetId: target.id,
              radius: 0,
              rawDamage: shooter.ad,
              color: 0xffffff,
              stunDuration: 0,
              ability: false,
              ultimate: false,
              singleTarget: true,
              chronoProc: false,
            });
          }
        }
      }

      advanceEffects(next, TICK_SECONDS);
      advanceLives(next);
      // Gold advances every tick, whether or not whole gold lands. That is the point: the fractional carry is what a
      // rollback has to restore, so a step that only touched gold on the tick it crossed a whole number would leave
      // the carry outside the snapshot's reach again.
      next.economy = advanceEconomy(next.economy, TICK_SECONDS);
      // Revive runs against the clock AFTER it has advanced, so a structure whose respawn time falls on this tick is
      // back before anything reads it. The deadline is absolute, so a replayed tick reaches the same verdict.
      next.structures = reviveStructures(next.structures, next.simTime);

      // Resolve what has landed. Damage is computed from the SOURCE as it was at cast time,
      // which is why the queue copies the shooter rather than referencing it - a shooter that
      // has since been buffed must not retroactively strengthen a shot already in the air.
      for (const landed of drainDueImpacts(next)) {
        const victim = next.units.find((u) => u.id === landed.targetId);
        if (!victim || victim.dead) continue;
        victim.hp = Math.max(0, victim.hp - effectiveDamage(landed.rawDamage, victim.armor));
        if (victim.hp === 0) victim.dead = true;
      }

      advanceTimers(next.units, Object.values(next.cooldowns), TICK_SECONDS);

      for (const unit of next.units) {
        if (unit.dead) continue;
        const goal = next.moveGoals[unit.id];
        if (goal) moveUnitToward(unit, goal, TICK_SECONDS);
      }

      return next;
    },

    clone: cloneWorldState,

    /**
     * Repeat the last input. The standard prediction for this shape of game, and correct most
     * of the time for the reason above: a movement order persists, so a player who sent nothing
     * this tick is usually still doing what they were doing.
     */
    predict(_participantId: string, lastKnown: ChampsInput | undefined): ChampsInput {
      return lastKnown ? { ...lastKnown } : IDLE_INPUT;
    },
  };
}
