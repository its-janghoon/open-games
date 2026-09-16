import type { Simulation } from '@open-games/shared';

import { effectiveDamage, type Unit } from './combat';
import { createChampionLifeState } from './championLifeState';
import { createEffectState } from './effects';
import { initialGold } from './rift/economy';
import { initialStructure, isInhibitorAlive, reviveStructures } from './rift/structures';
import { initialWaveSchedule, scheduleDueWaves } from './rift/waveSchedule';
import { admitDueMinions, advanceMinions } from './rift/minionBodies';
import { pruneTargets, resolveMinionCombat } from './rift/minionCombat';
import { basicAttackBonus, createPassiveState, prunePassives } from './rift/passives';
import { resolveAutoAttacks } from './rift/autoAttack';
import { advanceResources, initialResource } from './rift/resources';
import { advanceBaron, advanceBuffs, advanceWardenCharges } from './rift/fieldState';
import { advanceCamps, campMemberIdFor, dueCamps } from './rift/campCombat';
import { resolveTraps } from './rift/traps';
import { noBaronBuff } from './rift/objectives';
import {
  advanceRecalls,
  createTeamFacts,
  isDecided,
  ongoing,
} from './rift/matchFlow';

/**
 * Population cap per side and lane, and how long a deferred spawn waits.
 *
 * Taken from BattleScene's own constants rather than invented: the cap protects frame time, and a scheduled member that
 * cannot be admitted is deferred rather than dropped, because dropping it would make the population depend on
 * processing order.
 */
/**
 * Projectile speed for auto-attackers, in this simulation's own units per second.
 *
 * NOT the scene's constant, and the reason is worth recording because I got here by two wrong turns. My first version
 * invented 700, which is the mistake the previous commit warned about — a constant that changes while moving is a silent
 * re-balance. So I went to copy the scene's `1650 * SCALE`, and that turned out to be worse: SCALE is computed from the
 * VIEWPORT (`min(VIEW_W, VIEW_H) / WORLD_SIZE`), so the scene's speed is screen-space and depends on the window size.
 * A pure simulation that imported it would make its own physics depend on how big the browser window is, which is the
 * opposite of deterministic.
 *
 * So this is the simulation's own world-space value, declared as such rather than dressed up as the scene's. Matching
 * the two is a separate job that belongs with converting the scene to world coordinates, and claiming they already match
 * would be a false equivalence.
 */
const BASIC_PROJECTILE_SPEED = 700;

const MAX_LIVE_PER_LANE = 12;
const RETRY_SECONDS = 1;
import { LANES } from './rift/map';
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
export /** Seeding stats for a headless camp monster. The scene uses CAMP_PACKS; these are not claimed to match it. */
const CAMP_MEMBER_HP = 1200;
const CAMP_MEMBER_AD = 24;
const CAMP_MEMBER_ATTACK_RANGE = 160;

const SHOT_FLIGHT_SECONDS = 0.2;

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
      waves: initialWaveSchedule(),
      minions: [],
      targets: {},
      passives: createPassiveState(),
      recalls: Object.fromEntries(participants.map((id) => [id, null])),
      teamFacts: createTeamFacts(),
      outcome: ongoing(),
      // One turret per side, so the step is genuinely exercised without needing the scene's full structure graph.
      resources: Object.fromEntries(participants.map((id) => [id, initialResource(300)])),
      buffs: Object.fromEntries(participants.map((id) => [id, { buffs: [] }])),
      baron: { ally: noBaronBuff(), enemy: noBaronBuff() },
      objectives: [],
      wardenCharges: { ally: null, enemy: null },
      traps: [],
      camps: [],
      campMembers: [],
      autoAttackers: [
        { id: 'allyTurret', team: 'ally', pos: { x: 160, y: 300 }, ad: 90, attackRange: 200, attackSpeed: 0.8, attackCdRemaining: 0, stunned: 0, dead: false },
        { id: 'enemyTurret', team: 'enemy', pos: { x: 440, y: 300 }, ad: 90, attackRange: 200, attackSpeed: 0.8, attackCdRemaining: 0, stunned: 0, dead: false },
      ],
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
      /**
       * A decided match is frozen, checked FIRST so nothing else in the tick can run.
       *
       * Same rule as Gridfall's: without it a queued impact still lands after the winning blow and timers keep firing,
       * so the state two peers must agree on carries on changing past the end of the match.
       */
      if (isDecided(next.outcome)) return next;

      for (const [id, input] of inputs) {
        if (input.moveTo) next.moveGoals[id] = { ...input.moveTo };
        // A null order does NOT clear the goal: a champion ordered to a point keeps walking
        // there while its player holds still, which is what makes repeat-last-input a
        // reasonable prediction rather than a stutter.
        if (input.cast) {
          const shooter = next.units.find((u) => u.id === id);
          const target = next.units.find((u) => u.id !== id);
          if (shooter && target && !shooter.dead) {
            const resolved = basicAttackBonus(
              {
                championId: null,
                attackerId: shooter.id,
                targetId: target.id,
                now: next.simTime,
                items: [],
                hasRedBuff: false,
              },
              next.passives,
            );
            const passiveBonus = resolved.bonusAd;
            next.passives = resolved.state;
            queueImpact(next, {
              dueAt: next.simTime + SHOT_FLIGHT_SECONDS,
              source: { ...shooter, pos: { ...shooter.pos } },
              targetId: target.id,
              radius: 0,
              // Passives are resolved HERE rather than at impact, because the queue copies the shooter as it was at
              // cast time — a bonus computed on landing would be a different champion's bonus.
              rawDamage: shooter.ad + passiveBonus,
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
      next.resources = advanceResources(next.resources, TICK_SECONDS);

      /**
       * Buffs, the tyrant buff and warden charges expire against the CLOCK, before anything reads them.
       *
       * Order matters here in a way it does not for most of these steps: blue buff feeds resource regeneration, so
       * expiring after the regen would grant one extra tick of a buff that had already lapsed -- and on a replayed tick
       * that extra grant lands or does not depending on where the boundary falls, which is a divergence.
       */
      next.buffs = advanceBuffs(next.buffs, next.simTime);
      next.baron = advanceBaron(next.baron, next.simTime);
      next.wardenCharges = advanceWardenCharges(next.wardenCharges, next.simTime);

      // Jungle camps: repopulate a cleared camp whose deadline has passed, then advance whoever is standing.
      for (const campId of dueCamps(next.camps, next.campMembers, next.simTime)) {
        const camp = next.camps.find((c) => c.campId === campId);
        if (!camp) continue;
        next.campMembers = [
          ...next.campMembers.filter((m) => m.campId !== campId),
          {
            id: campMemberIdFor(campId, 'a'),
            campId,
            pos: { ...camp.center },
            home: { ...camp.center },
            hp: CAMP_MEMBER_HP,
            maxHp: CAMP_MEMBER_HP,
            attackRange: CAMP_MEMBER_ATTACK_RANGE,
            stunned: 0,
            dead: false,
          },
        ];
      }
      const jungle = advanceCamps(
        next.campMembers,
        next.camps,
        next.units
          .filter((u) => !u.dead)
          .map((u) => ({ id: u.id, pos: u.pos, attackable: u.team !== 'neutral' })),
        TICK_SECONDS,
      );
      next.campMembers = jungle.members;
      for (const action of jungle.actions) {
        if (action.kind !== 'attack') continue;
        const member = next.campMembers.find((m) => m.id === action.memberId);
        const victim = next.units.find((u) => u.id === action.targetId);
        if (!member || !victim) continue;
        queueImpact(next, {
          dueAt: next.simTime,
          source: {
            ...victim,
            id: member.id,
            team: 'neutral',
            pos: { ...member.pos },
            ad: CAMP_MEMBER_AD,
          },
          targetId: victim.id,
          radius: 0,
          rawDamage: CAMP_MEMBER_AD,
          color: 0x9eb7c9,
          stunDuration: 0,
          ability: false,
          ultimate: false,
          singleTarget: true,
          chronoProc: false,
        });
      }

      /**
       * Traps resolve AFTER movement has been applied for the tick, which is why this sits below the movement section
       * rather than beside the other expiries: a trap catches whoever is standing on it now, not whoever was standing
       * there before they moved. Damage goes through the impact queue like every other hit so ordering stays in one place.
       */
      const sprung = resolveTraps(
        next.traps,
        next.units
          .filter((u) => !u.dead)
          .map((u) => ({ id: u.id, pos: u.pos, damageable: true })),
        next.simTime,
      );
      next.traps = sprung.traps;
      for (const trigger of sprung.triggers) {
        const owner = next.units.find((u) => u.id === trigger.sourceId);
        const victim = next.units.find((u) => u.id === trigger.targetId);
        if (!owner || !victim) continue;
        queueImpact(next, {
          dueAt: next.simTime,
          source: { ...owner, pos: { ...owner.pos } },
          targetId: victim.id,
          radius: 0,
          rawDamage: trigger.rawDamage,
          color: 0x7a5cc4,
          stunDuration: 0,
          slowPercent: trigger.slowPercent,
          slowDuration: trigger.slowDuration,
          // A trap is an ability, so it must be flagged as one: shields and reductions that only apply to ability damage
          // would otherwise treat it as a basic attack.
          ability: true,
          ultimate: false,
          singleTarget: true,
          chronoProc: false,
        });
      }
      // Revive runs against the clock AFTER it has advanced, so a structure whose respawn time falls on this tick is
      // back before anything reads it. The deadline is absolute, so a replayed tick reaches the same verdict.
      next.structures = reviveStructures(next.structures, next.simTime);
      // Scheduling runs after the revive, because a lane's wave composition depends on whether the enemy inhibitor
      // is standing THIS tick — schedule first and a wave could be upgraded to super minions by a structure that
      // came back on the very same tick.
      // Admit, then walk. Admission first so a minion scheduled for THIS tick starts moving on it rather than idling a
      // tick — and both are pure, so a replay reaches the same population and the same positions.
      next.waves = scheduleDueWaves(
        next.waves,
        next.simTime,
        LANES,
        { killedAt: Object.fromEntries(Object.entries(next.structures).map(([id, s]) => [id, s.killedAt])) },
        (now, killedAt) => isInhibitorAlive(now, killedAt),
      );
      const admitted = admitDueMinions(next.minions, next.waves, next.simTime, MAX_LIVE_PER_LANE, RETRY_SECONDS);
      next.minions = advanceMinions(admitted.minions, TICK_SECONDS);
      next.waves = admitted.waves;

      // Combat AFTER movement, so a minion that walked into range this tick may swing on it rather than waiting one.
      const combat = resolveMinionCombat(next.minions, next.units, next.targets, TICK_SECONDS);
      next.minions = combat.minions;
      next.targets = combat.targets;
      for (const hit of combat.damage) {
        const victim = next.units.find((unit) => unit.id === hit.targetId);
        if (!victim || victim.dead) continue;
        victim.hp = Math.max(0, victim.hp - hit.amount);
        if (victim.hp === 0) victim.dead = true;
      }
      // Prune AFTER the hits land, or a target that died this tick would lose its damage.
      // Recalls resolve against the clock AFTER it has advanced, so a channel that completes on this tick completes
      // before anything reads a position.
      const recalled = advanceRecalls(next.recalls, next.simTime);
      next.recalls = recalled.recalls;
      for (const id of recalled.completed) {
        const unit = next.units.find((candidate) => candidate.id === id);
        // Base position by team, which is the whole point of a recall.
        if (unit) unit.pos = unit.team === 'ally' ? { x: 60, y: 300 } : { x: 540, y: 300 };
      }
      // Turrets and monsters fire AFTER champions and minions have moved, so a unit that walked into range is shot at
      // on the tick it arrived rather than the next one.
      const auto = resolveAutoAttacks(
        next.autoAttackers,
        next.units,
        next.targets,
        TICK_SECONDS,
        BASIC_PROJECTILE_SPEED,
      );
      next.autoAttackers = auto.attackers;
      next.targets = auto.targets;
      for (const shot of auto.shots) {
        const source = next.autoAttackers.find((a) => a.id === shot.sourceId);
        const victim = next.units.find((unit) => unit.id === shot.targetId);
        if (!source || !victim) continue;
        // Through the EXISTING impact queue, so the flight is already rewindable and the counter stays monotonic in one
        // place. dueAt is absolute, computed from the sim clock rather than carried as a remaining duration.
        queueImpact(next, {
          dueAt: next.simTime + shot.flightSeconds,
          source: { ...victim, id: source.id, team: source.team, pos: { ...source.pos }, ad: source.ad },
          targetId: shot.targetId,
          radius: 0,
          rawDamage: shot.rawDamage,
          color: 0xffcc55,
          stunDuration: 0,
          ability: false,
          ultimate: false,
          singleTarget: true,
          chronoProc: false,
        });
      }
      next.passives = prunePassives(next.passives, next.simTime);
      next.targets = pruneTargets(
        next.targets,
        new Set([...next.units.map((unit) => unit.id), ...next.minions.map((minion) => minion.id)]),
      );

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
