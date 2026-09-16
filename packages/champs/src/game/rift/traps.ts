import { distance, type Unit, type Vec2 } from '../combat';

/**
 * Ground traps — duskarrow's W, and anything later that leaves a damaging area behind.
 *
 * A trap is the simplest kind of subsystem to put in a snapshot and was one of the last left out, which is worth saying
 * plainly: nothing about it was hard, it had just never been looked at. `expiresAt` was ALREADY an absolute match time
 * rather than a countdown, and the scene ALREADY sorted candidates by id and broke distance ties by id, so the rule was
 * deterministic before this change. What was missing was the LIST — `private traps: TrapRuntime[]` on the scene, which a
 * rollback could not restore because it never knew about it.
 *
 * The trap that armed before a rewind therefore survived the rewind on one peer and not the other.
 */

export interface TrapState {
  id: string;
  /** Who armed it. Damage is attributed to them and hostility is judged from their team. */
  sourceId: string;
  sourceTeam: Unit['team'];
  point: Vec2;
  radius: number;
  rawDamage: number;
  /** Absolute match time the trap stops existing. A deadline, not a countdown — nothing has to know how many ticks were undone. */
  expiresAt: number;
  slowPercent: number;
  slowDuration: number;
}

/** What a trap did this tick, for the caller to apply through its own damage path. */
export interface TrapTrigger {
  trapId: string;
  sourceId: string;
  targetId: string;
  rawDamage: number;
  slowPercent: number;
  slowDuration: number;
}

export interface TrapResult {
  traps: TrapState[];
  triggers: TrapTrigger[];
}

/** A candidate a trap could catch, reduced to what the decision needs. */
export interface TrapCandidate {
  id: string;
  pos: Vec2;
}

export function cloneTraps(traps: readonly TrapState[]): TrapState[] {
  return traps.map((trap) => ({ ...trap, point: { ...trap.point } }));
}

/**
 * Resolve every trap for one tick.
 *
 * A triggered trap is CONSUMED — it fires once and is gone, which is why the surviving list is returned rather than
 * mutated. An expired trap is dropped without firing even if something stands on it, because the expiry is checked first;
 * that ordering is deliberate and tested, since the alternative lets a trap that should already be gone still hit
 * whoever arrives on the exact tick it lapses.
 *
 * Traps are processed in id order and each picks its nearest candidate with an id tiebreak. Both orders matter for the
 * same reason: array position is not something two peers can be relied on to agree about.
 *
 * `canDamage` is a CALLBACK taking the trap AND the candidate. It began as a flat `damageable` boolean on each candidate,
 * and adopting this step in BattleScene is what exposed that as wrong: damageability depends on the trap's OWNER, so with
 * two traps from opposing teams a single flag per candidate cannot serve both — one team's trap would inherit the other's
 * judgement. Team and shield rules stay with the caller either way; only the shape changed.
 */
export function resolveTraps(
  traps: readonly TrapState[],
  candidates: readonly TrapCandidate[],
  now: number,
  canDamage: (trap: TrapState, candidate: TrapCandidate) => boolean,
): TrapResult {
  const survivors: TrapState[] = [];
  const triggers: TrapTrigger[] = [];

  for (const trap of [...traps].sort((a, b) => a.id.localeCompare(b.id))) {
    if (trap.expiresAt <= now) continue;

    const caught = candidates
      .filter(
        (candidate) =>
          canDamage(trap, candidate) && distance(candidate.pos, trap.point) <= trap.radius,
      )
      .sort(
        (a, b) =>
          distance(a.pos, trap.point) - distance(b.pos, trap.point) || a.id.localeCompare(b.id),
      )[0];

    if (!caught) {
      survivors.push({ ...trap, point: { ...trap.point } });
      continue;
    }

    triggers.push({
      trapId: trap.id,
      sourceId: trap.sourceId,
      targetId: caught.id,
      rawDamage: trap.rawDamage,
      slowPercent: trap.slowPercent,
      slowDuration: trap.slowDuration,
    });
  }

  return { traps: survivors, triggers };
}

/**
 * A trap id that is stable across a replay.
 *
 * Derived from the owner and the absolute arm time rather than a counter, because a counter that resets — or advances a
 * different number of times on a replayed tick — produces a different id for the same trap. Two traps from one champion
 * at the same instant would collide, which the game's own cooldowns make unreachable.
 */
export function trapIdFor(sourceId: string, armedAt: number): string {
  return `trap:${sourceId}:${armedAt.toFixed(3)}`;
}
