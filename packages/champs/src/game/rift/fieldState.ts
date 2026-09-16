import type { MapSide } from './map';
import { expireBuffs, type BuffState } from './jungle';
import { expireBaronBuff, type BaronBuffState } from './objectives';
import type { WardenCharge } from '../wardenPolicy';

/**
 * The last of the scene's per-tick state: buffs, the tyrant buff, epic-monster spawn slots, and a held warden charge.
 *
 * Every RULE these need was already pure and already extracted — `expireBuffs`, `expireBaronBuff`, `isHeraldWindowOpen`,
 * `shouldDeployHeldWarden`. That is the finding for all four, and it is why this file is plumbing rather than logic: the
 * only thing keeping them out of the snapshot was that the state lived on BattleScene as private fields.
 *
 * Every deadline here was already an ABSOLUTE match time, so none of it needed reshaping the way the inhibitor Map did.
 */

/** An epic monster's spawn slot, without the Phaser entity the scene pairs with it. */
export interface ObjectiveState {
  id: string;
  /** Whether the monster is currently on the map. The scene's `entity` is the same fact plus a sprite. */
  alive: boolean;
  /** Absolute match time it may next appear. */
  nextSpawnAt: number;
  /** Herald leaves for good once its window closes; this makes that terminal rather than re-derived each tick. */
  permanentlyGone: boolean;
}

export interface SideState<T> {
  ally: T;
  enemy: T;
}

export function cloneBuffState(state: BuffState): BuffState {
  return { buffs: state.buffs.map((buff) => ({ ...buff })) };
}

export function cloneBuffs(buffs: Record<string, BuffState>): Record<string, BuffState> {
  const next: Record<string, BuffState> = {};
  for (const [id, state] of Object.entries(buffs)) next[id] = cloneBuffState(state);
  return next;
}

export function cloneBaron(baron: SideState<BaronBuffState>): SideState<BaronBuffState> {
  return {
    ally: { ...baron.ally, modifiers: { ...baron.ally.modifiers } },
    enemy: { ...baron.enemy, modifiers: { ...baron.enemy.modifiers } },
  };
}

export function cloneObjectives(objectives: readonly ObjectiveState[]): ObjectiveState[] {
  return objectives.map((objective) => ({ ...objective }));
}

export function cloneWardenCharges(
  charges: SideState<WardenCharge | null>,
): SideState<WardenCharge | null> {
  return {
    ally: charges.ally ? { ...charges.ally } : null,
    enemy: charges.enemy ? { ...charges.enemy } : null,
  };
}

/** Expire every participant's buffs for this tick, through jungle.ts's now-pure rule. */
export function advanceBuffs(
  buffs: Record<string, BuffState>,
  now: number,
): Record<string, BuffState> {
  const next: Record<string, BuffState> = {};
  for (const [id, state] of Object.entries(buffs)) next[id] = expireBuffs(state, now);
  return next;
}

/** Expire both sides' tyrant buff, through objectives.ts's existing rule. */
export function advanceBaron(
  baron: SideState<BaronBuffState>,
  now: number,
): SideState<BaronBuffState> {
  return {
    ally: expireBaronBuff(baron.ally, now),
    enemy: expireBaronBuff(baron.enemy, now),
  };
}

/**
 * Drop a warden charge that has lapsed.
 *
 * Separate from deciding whether to SPEND one, which is `shouldDeployHeldWarden`'s job. Expiry has to happen even on a
 * tick where nothing wants to deploy, so folding the two together would tie a lapse to a decision that may not run.
 */
export function advanceWardenCharges(
  charges: SideState<WardenCharge | null>,
  now: number,
): SideState<WardenCharge | null> {
  const keep = (charge: WardenCharge | null) =>
    charge && now < charge.expiresAt ? { ...charge } : null;
  return { ally: keep(charges.ally), enemy: keep(charges.enemy) };
}

/**
 * Which objective slots may spawn now.
 *
 * Returns ids, because spawning builds Phaser objects. `windowOpen` is supplied by the caller rather than computed here:
 * only herald has a window, the rule for it already lives in objectives.ts, and re-deriving it here would be a second
 * copy of a rule that decides whether a monster exists.
 */
export function dueObjectives(
  objectives: readonly ObjectiveState[],
  now: number,
  windowOpen: (id: string) => boolean,
): string[] {
  return objectives
    .filter(
      (objective) =>
        !objective.permanentlyGone &&
        !objective.alive &&
        now >= objective.nextSpawnAt &&
        windowOpen(objective.id),
    )
    .map((objective) => objective.id)
    .sort();
}

/** Mark an objective gone for the rest of the match. */
export function retireObjective(
  objectives: readonly ObjectiveState[],
  id: string,
): ObjectiveState[] {
  return objectives.map((objective) =>
    objective.id === id ? { ...objective, alive: false, permanentlyGone: true } : { ...objective },
  );
}

/** Record that an objective is now on the map. */
export function markObjectiveAlive(
  objectives: readonly ObjectiveState[],
  id: string,
  alive: boolean,
): ObjectiveState[] {
  return objectives.map((objective) =>
    objective.id === id ? { ...objective, alive } : { ...objective },
  );
}

export type { MapSide };
