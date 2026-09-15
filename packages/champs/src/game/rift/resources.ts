/**
 * Ability resource — mana, and the regeneration that refills it.
 *
 * The last piece of the CASTING decision that was not in the snapshot, and it is behavioural rather than cosmetic:
 * resource gates whether an ability can be cast at all, so two peers holding different amounts make different decisions
 * from the same inputs. A rollback restored positions, cooldowns and health while each side's mana continued from
 * whatever the scene happened to be holding.
 *
 * The bot AI itself is already deterministic — `decideAction` and `decideScoredAction` in ai.ts are pure functions of a
 * snapshot, with no randomness, no clock and no hidden mutable state. Measured rather than assumed: the only Math.random
 * calls anywhere near champs' simulation are four VFX sites (a damage-popup jitter, two spark offsets and a tween
 * duration) and a champion-select helper that runs before a match exists. So the AI was never the determinism problem —
 * the state it READS was.
 */

/** Baseline regeneration in resource per second, before any buff. */
export const RESOURCE_REGEN_PER_SECOND = 6;

export interface ResourceState {
  current: number;
  max: number;
}

export function initialResource(max: number): ResourceState {
  return { current: max, max };
}

export function cloneResources(
  resources: Record<string, ResourceState>,
): Record<string, ResourceState> {
  const next: Record<string, ResourceState> = {};
  for (const [id, resource] of Object.entries(resources)) next[id] = { ...resource };
  return next;
}

/**
 * Regenerate one participant's resource.
 *
 * Pure, and clamped at `max` rather than allowed to overshoot and be corrected later: an overshoot that a later step
 * clamps would make the value depend on whether that step ran, which is exactly the kind of order dependence a replay
 * exposes.
 */
export function regenerateResource(
  resource: ResourceState,
  dt: number,
  bonusPerSecond = 0,
): ResourceState {
  if (dt <= 0) return { ...resource };
  const rate = RESOURCE_REGEN_PER_SECOND + bonusPerSecond;
  return { current: Math.min(resource.max, resource.current + rate * dt), max: resource.max };
}

/** Regenerate every participant. `bonusFor` lets a caller apply a per-participant buff without this module knowing about buffs. */
export function advanceResources(
  resources: Record<string, ResourceState>,
  dt: number,
  bonusFor: (id: string) => number = () => 0,
): Record<string, ResourceState> {
  const next: Record<string, ResourceState> = {};
  for (const [id, resource] of Object.entries(resources)) {
    next[id] = regenerateResource(resource, dt, bonusFor(id));
  }
  return next;
}

/**
 * Spend resource on a cast, or refuse.
 *
 * Returns whether it was affordable ALONGSIDE the new state, so a caller cannot accidentally spend without checking or
 * check without spending — the two-call version of this is where an ability gets cast for free under a race.
 */
export function spendResource(
  resource: ResourceState,
  cost: number,
): { paid: boolean; resource: ResourceState } {
  if (cost <= 0) return { paid: true, resource: { ...resource } };
  if (resource.current < cost) return { paid: false, resource: { ...resource } };
  return { paid: true, resource: { current: resource.current - cost, max: resource.max } };
}

/** Whether a cost is affordable, for a decision that has not committed to spending yet. */
export function canAfford(resource: ResourceState | undefined, cost: number): boolean {
  if (cost <= 0) return true;
  return (resource?.current ?? 0) >= cost;
}
