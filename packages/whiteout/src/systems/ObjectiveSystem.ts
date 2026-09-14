/**
 * ObjectiveSystem - the Phaser-free new-player guidance/tutorial state machine.
 *
 * The Town screen is not obvious to a first-time player: most buildings read
 * '잠김' (Locked) with no explanation and there is no visual "do this next".
 * This module computes the SINGLE next-step objective the player should act on,
 * from a plain, read-only view of the simulation - so the scene can drive a
 * banner + a building pointer/glow off one pure, deterministic function.
 *
 * It is intentionally pure: no Phaser, no Date.now, no Math.random. Given the
 * same {@link ObjectiveView} it always returns the same {@link Objective} (or
 * null when the guided flow is complete), so it is trivially unit-testable and
 * agrees between any callers.
 *
 * The core loop is modelled as an ORDERED list of objectives:
 *   1. Upgrade the Furnace (raise the level cap of everything else)
 *   2. Build the Hunters' Hut (rations / food)
 *   3. Build the Sawmill (timber / wood)
 *   4. Raise the Furnace again (unlock the War Camp tier)
 *   5. Build the War Camp (unlock troop training)
 *   6. Train troops
 *   7. March To Battle
 * The first objective whose {@link Objective.isComplete} predicate is false is
 * the current one; when all are complete the tutorial is done (returns null).
 *
 * A LOW-WARMTH advisory takes PRIORITY over the ordered list whenever the
 * warmth ratio is low: a freezing hold produces almost nothing, so the most
 * useful next step is to keep wood/coal stocked and raise the Furnace, not to
 * push the build order. The advisory also surfaces for returning players (whose
 * ordered tutorial is already complete) so the "what do I do about FREEZING?"
 * question always has an actionable answer.
 */

import type { BuildingKind } from '../types';
import type { TrKey } from '../i18n/strings';

/**
 * The warmth ratio at or below which the low-warmth advisory takes over. Set a
 * touch above the Town's FREEZING threshold (0.25) so the guidance appears
 * BEFORE the hold is critically cold, giving the player time to react.
 */
export const LOW_WARMTH_ADVISORY_RATIO = 0.35;

/**
 * A plain, read-only snapshot of everything the objective logic needs. Kept as
 * a flat data bag (not the live GameState) so the pure core has no dependency
 * on the systems layer and tests can construct any scenario by hand.
 */
export interface ObjectiveView {
  /** Current Furnace level (0 = somehow unbuilt; a fresh hold starts at 1). */
  furnaceLevel: number;
  /** Current level of each building kind (0 = not built / locked). */
  levels: Partial<Record<BuildingKind, number>>;
  /** Current warmth as a ratio of the max at the current Furnace level, [0,1]. */
  warmthRatio: number;
  /** Total standing army size (trained troops ready for battle). */
  armySize: number;
  /** Whether the player has fought at least one battle. */
  battleFought: boolean;
}

/** A stable objective id (also used as the localized-string discriminator). */
export type ObjectiveId =
  | 'furnace_1'
  | 'hunters_hut'
  | 'sawmill'
  | 'furnace_2'
  | 'war_camp'
  | 'train'
  | 'battle'
  | 'warmth'
  | 'stranded';

/**
 * A single guidance objective. `label` is a short tr() key (the title of the
 * step) and `instruction` is a slightly longer tr() key telling the player what
 * to do. `target` is the building the pointer/glow should highlight (or null
 * for an action that is not tied to a single building, e.g. the battle step,
 * which points at the War Camp as the muster point). `isComplete` is a pure
 * predicate over the view.
 */
export interface Objective {
  id: ObjectiveId;
  label: TrKey;
  instruction: TrKey;
  /** The building to highlight with the pointer/glow, or null. */
  target: BuildingKind | null;
  /** Pure predicate: has this objective been satisfied by the given view? */
  isComplete(view: ObjectiveView): boolean;
}

/** Read a building level from the view, defaulting a missing kind to 0. */
function levelOf(view: ObjectiveView, kind: BuildingKind): number {
  return view.levels[kind] ?? 0;
}

/**
 * The ordered core-loop objective list. Each predicate reads ONLY the view, so
 * the whole progression is a pure function of the current simulation snapshot.
 * The ids/keys are stable so persisted "highest reached" state stays valid.
 */
export const OBJECTIVES: readonly Objective[] = [
  {
    id: 'furnace_1',
    label: 'objective.furnace.label',
    instruction: 'objective.furnace.instruction',
    target: 'furnace',
    // Raising the Furnace to Lv.2 lifts the level cap so the raw producers can
    // be built - the true first step of the loop.
    isComplete: (v) => v.furnaceLevel >= 2,
  },
  {
    id: 'hunters_hut',
    label: 'objective.hunters.label',
    instruction: 'objective.hunters.instruction',
    target: 'hunters_hut',
    isComplete: (v) => levelOf(v, 'hunters_hut') >= 1,
  },
  {
    id: 'sawmill',
    label: 'objective.sawmill.label',
    instruction: 'objective.sawmill.instruction',
    target: 'sawmill',
    isComplete: (v) => levelOf(v, 'sawmill') >= 1,
  },
  {
    id: 'furnace_2',
    label: 'objective.furnace2.label',
    instruction: 'objective.furnace2.instruction',
    target: 'furnace',
    // The War Camp requires Furnace Lv.2 (already met at furnace_1), but pushing
    // to Lv.3 opens the wider city + higher tiers; keep the loop moving by
    // asking for one more Furnace level before the military step.
    isComplete: (v) => v.furnaceLevel >= 3,
  },
  {
    id: 'war_camp',
    label: 'objective.warcamp.label',
    instruction: 'objective.warcamp.instruction',
    target: 'war_camp',
    isComplete: (v) => levelOf(v, 'war_camp') >= 1,
  },
  {
    id: 'train',
    label: 'objective.train.label',
    instruction: 'objective.train.instruction',
    target: 'war_camp',
    isComplete: (v) => v.armySize > 0,
  },
  {
    id: 'battle',
    label: 'objective.battle.label',
    instruction: 'objective.battle.instruction',
    // The battle is launched from the bottom bar; point at the War Camp as the
    // muster point so the pointer still lands on a real building.
    target: 'war_camp',
    isComplete: (v) => v.battleFought,
  },
];

/**
 * The low-warmth advisory objective. It is NOT part of the ordered list; it is
 * injected with priority whenever warmth is low (see {@link currentObjective}).
 * It points at the Furnace (raise it / keep it fueled). Its `isComplete` is only
 * meaningful relative to the warmth ratio, which the caller checks; the
 * predicate is provided for completeness/testing.
 */
export const WARMTH_ADVISORY: Objective = {
  id: 'warmth',
  label: 'objective.warmth.label',
  instruction: 'objective.warmth.instruction',
  target: 'furnace',
  isComplete: (v) => v.warmthRatio > LOW_WARMTH_ADVISORY_RATIO,
};

/**
 * The advisory for a hold that has run out of fuel AND has no way to make more.
 *
 * This exists because the low-warmth advisory gives that player advice they
 * cannot follow. It says to keep timber and coal stocked and raise the Furnace -
 * every part of which needs timber, which is exactly what they do not have. A
 * player reading it concludes the game is broken, and they are not wrong to.
 *
 * The hold is not actually stuck: the phase-0 rescue fix put a forage floor on
 * RATIONS, a resource the Furnace never burns, precisely so there is always one
 * affordable way back. That way is the Sawmill, which costs rations alone. So this
 * advisory names it.
 *
 * It outranks the warmth advisory rather than replacing it, because the two
 * describe different situations: warmth is low and you have fuel to manage, versus
 * warmth is low and you have nothing, in which case there is exactly one move.
 */
export const STRANDED_ADVISORY: Objective = {
  id: 'stranded',
  label: 'objective.stranded.label',
  instruction: 'objective.stranded.instruction',
  target: 'sawmill',
  // Complete as soon as a timber producer stands - at that point the ordinary
  // warmth advice becomes followable again.
  isComplete: (v) => levelOf(v, 'sawmill') >= 1,
};

/**
 * Whether the hold can no longer produce the fuel it burns.
 *
 * Deliberately a check on PRODUCTION, not on the stockpile. A hold with 3 timber
 * left and no Sawmill is in the same trap as one with zero - it is just a few
 * seconds earlier - and telling it to "keep timber stocked" is equally useless.
 */
export function cannotMakeFuel(view: ObjectiveView): boolean {
  return levelOf(view, 'sawmill') < 1;
}

/**
 * The single objective the player should act on for the given view, or null
 * when the guided flow is complete (every ordered objective satisfied AND
 * warmth is fine).
 *
 * Priority: a low-warmth hold ALWAYS surfaces the warmth advisory first - a
 * freezing settlement produces almost nothing, so keeping the Ember burning is
 * the most useful next action regardless of build progress. Otherwise the first
 * incomplete ordered objective is returned; if none remain, null.
 *
 * Pure and deterministic: same view in, same objective out.
 */
export function currentObjective(view: ObjectiveView): Objective | null {
  if (view.warmthRatio <= LOW_WARMTH_ADVISORY_RATIO) {
    // A cold hold that cannot MAKE fuel gets the one piece of advice it can act
    // on, before the generic keep-it-stocked advice it cannot.
    if (cannotMakeFuel(view)) return STRANDED_ADVISORY;
    return WARMTH_ADVISORY;
  }
  for (const objective of OBJECTIVES) {
    if (!objective.isComplete(view)) return objective;
  }
  return null;
}

/**
 * Whether the ORDERED core-loop tutorial is fully complete for the given view
 * (ignoring the transient warmth advisory). Used to decide, together with the
 * persisted onboarding flag, whether a returning player should ever see the
 * banner/pointer again (they should not - except the warmth advisory).
 */
export function tutorialComplete(view: ObjectiveView): boolean {
  return OBJECTIVES.every((o) => o.isComplete(view));
}
