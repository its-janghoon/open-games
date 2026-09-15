import { BUFF_EFFECTS } from './jungle';

/**
 * Champion basic-attack passives, as snapshot state.
 *
 * The last unsnapshottable state in the basic-attack path, and the most deceptive kind. It lived in THREE `Map`s on the
 * scene — `passiveCounters`, `internalCooldowns` and `sunfireHitAt` — and a Map is exactly what a snapshot cannot carry,
 * as the clone contract in worldStep documents. Nothing about them is visible on screen: they only change how much
 * damage a swing does. So a rollback that lost them produced two peers with identical positions, identical health bars
 * and different damage numbers — the desync that surfaces minutes later with nothing left pointing at where it began.
 *
 * ## Deadlines are absolute; counters are not timers
 *
 * `deadlines` holds absolute sim times, never countdowns, for the reason every deadline in this codebase is absolute: a
 * countdown cannot be rewound without knowing how many ticks were undone. `counters` holds stack counts and distances,
 * which carry no time and so need no such care.
 *
 * ## Keys are derived, not allocated
 *
 * Every key is built from ids that already exist — the attacker's, the target's, the champion's. Nothing here mints an
 * identifier from a counter, so a replayed tick reconstructs exactly the same keys. That is what makes this table
 * rewindable at all, and it is the same requirement the minion ids had to meet.
 */

export interface PassiveState {
  /** Accumulators: stack counts and travelled distance. No time in here. */
  counters: Record<string, number>;
  /** ABSOLUTE sim-time deadlines. Never countdowns — see the note above. */
  deadlines: Record<string, number>;
}

export function createPassiveState(): PassiveState {
  return { counters: {}, deadlines: {} };
}

export function clonePassiveState(state: PassiveState): PassiveState {
  return { counters: { ...state.counters }, deadlines: { ...state.deadlines } };
}

/* -------------------------------------------------------------------------- */
/* Keys                                                                        */
/* -------------------------------------------------------------------------- */

export const passiveKeys = {
  duskarrowDistance: (attackerId: string) => `duskarrow-distance:${attackerId}`,
  nightveilDash: (attackerId: string) => `nightveil-dash:${attackerId}`,
  ashborneStacks: (attackerId: string, targetId: string) => `ashborne:${attackerId}:${targetId}`,
  ashborneExpiry: (attackerId: string, targetId: string) =>
    `ashborne:${attackerId}:${targetId}:expires`,
  sunfireHit: (attackerId: string, targetId: string) => `sunfire:${attackerId}:${targetId}`,
};

/**
 * Tuning, named rather than inlined.
 *
 * Lifted verbatim from BattleScene's basic-attack path so this is an extraction and not a re-balance. A number that
 * changed while moving would be a silent design change wearing a refactor's clothes.
 */
export const PASSIVE_TUNING = {
  /** Distance duskarrow must have travelled for its next hit to be empowered. */
  duskarrowDistance: 300,
  duskarrowBonus: 18,
  nightveilBonus: 40,
  /** Hits on the same target within the window before ashborne's bonus lands. */
  ashborneStacksNeeded: 3,
  ashborneWindowSeconds: 4,
  ashborneBonus: 15,
  sunfireBonus: 15,
  /** Seconds before sunfire may empower a hit on the SAME target again. */
  sunfireIntervalSeconds: 1,
} as const;

export interface BasicAttackContext {
  championId: string | null;
  attackerId: string;
  targetId: string;
  /** Sim time, for the absolute deadlines. */
  now: number;
  items: readonly string[];
  hasRedBuff: boolean;
}

export interface BasicAttackBonus {
  bonusAd: number;
  state: PassiveState;
  /** Which passives fired, so a test can assert the reason rather than only the total. */
  fired: string[];
}

/**
 * Compute the bonus damage a basic attack carries, and the passive state it leaves behind.
 *
 * Pure: state goes in, a new state comes out. The scene previously mutated three Maps in the middle of resolving an
 * attack, which is why none of it could be rewound and why the bonus depended on the order attacks happened to resolve.
 */
export function basicAttackBonus(context: BasicAttackContext, state: PassiveState): BasicAttackBonus {
  const counters = { ...state.counters };
  const deadlines = { ...state.deadlines };
  const fired: string[] = [];
  let bonusAd = 0;

  const { championId, attackerId, targetId, now, items, hasRedBuff } = context;

  if (championId === 'duskarrow') {
    const key = passiveKeys.duskarrowDistance(attackerId);
    if ((counters[key] ?? 0) >= PASSIVE_TUNING.duskarrowDistance) {
      bonusAd += PASSIVE_TUNING.duskarrowBonus;
      fired.push('duskarrow');
    }
    // Reset whether or not it fired, matching the scene: the distance is spent by swinging, not by landing a bonus.
    counters[key] = 0;
  }

  if (championId === 'nightveil') {
    const key = passiveKeys.nightveilDash(attackerId);
    if ((deadlines[key] ?? 0) > now) {
      bonusAd += PASSIVE_TUNING.nightveilBonus;
      fired.push('nightveil');
      // Consumed, so a single dash empowers one hit rather than every hit inside the window.
      deadlines[key] = 0;
    }
  }

  if (championId === 'ashborne') {
    const stackKey = passiveKeys.ashborneStacks(attackerId, targetId);
    const expiryKey = passiveKeys.ashborneExpiry(attackerId, targetId);
    // Stacks only carry forward while the window is still open; otherwise this hit is the first again.
    const prior = (deadlines[expiryKey] ?? 0) > now ? counters[stackKey] ?? 0 : 0;
    const count = prior + 1;
    deadlines[expiryKey] = now + PASSIVE_TUNING.ashborneWindowSeconds;
    if (count >= PASSIVE_TUNING.ashborneStacksNeeded) {
      bonusAd += PASSIVE_TUNING.ashborneBonus;
      fired.push('ashborne');
      counters[stackKey] = 0;
    } else {
      counters[stackKey] = count;
    }
  }

  if (items.includes('sunfireGreatblade')) {
    const key = passiveKeys.sunfireHit(attackerId, targetId);
    const last = deadlines[key];
    if (last === undefined || now - last >= PASSIVE_TUNING.sunfireIntervalSeconds) {
      bonusAd += PASSIVE_TUNING.sunfireBonus;
      fired.push('sunfire');
      deadlines[key] = now;
    }
  }

  if (hasRedBuff) {
    bonusAd += BUFF_EFFECTS.red.bonusDamage;
    fired.push('red');
  }

  return { bonusAd, state: { counters, deadlines }, fired };
}

/**
 * Add travelled distance to duskarrow's accumulator.
 *
 * Separate from the attack because it happens on MOVEMENT, and folding it into the attack would make the bonus depend
 * on how often a champion swung rather than how far it walked.
 */
export function addTravelled(state: PassiveState, attackerId: string, distance: number): PassiveState {
  if (distance <= 0) return clonePassiveState(state);
  const key = passiveKeys.duskarrowDistance(attackerId);
  return {
    counters: { ...state.counters, [key]: (state.counters[key] ?? 0) + distance },
    deadlines: { ...state.deadlines },
  };
}

/** Open nightveil's dash window, which its next basic attack consumes. */
export function openDashWindow(
  state: PassiveState,
  attackerId: string,
  until: number,
): PassiveState {
  return {
    counters: { ...state.counters },
    deadlines: { ...state.deadlines, [passiveKeys.nightveilDash(attackerId)]: until },
  };
}

/**
 * Drop deadlines that have long passed, so the table cannot grow for a whole match.
 *
 * Conservative on purpose: an entry is only dropped once it is well past, because a deadline that is merely expired may
 * still be read this tick to decide that stacks do NOT carry forward.
 */
export function prunePassives(state: PassiveState, now: number, graceSeconds = 30): PassiveState {
  const deadlines: Record<string, number> = {};
  for (const [key, when] of Object.entries(state.deadlines)) {
    if (when + graceSeconds >= now) deadlines[key] = when;
  }
  return { counters: { ...state.counters }, deadlines };
}
