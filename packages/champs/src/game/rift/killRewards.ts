import { CHAMPION_TAKEDOWN_BOUNTY, minionBounty, structureBounty, type Bounty } from './economy';
import type { MinionType } from './minions';

/**
 * WHAT a kill is worth, and which team facts it moves.
 *
 * registerKill was 82 lines dispatching on the victim's kind and then reaching into progress records, team facts, match
 * stats, a passive counter, an inhibitor timer and two rendering calls. The bounty TABLES were already pure
 * (CHAMPION_TAKEDOWN_BOUNTY, minionBounty, structureBounty); what was not was the dispatch that chooses between them, and
 * that dispatch is the part two peers must agree on — a kill worth 300 on one machine and 25 on the other is a divergence
 * that compounds through every purchase after it.
 */

export type VictimKind = 'champion' | 'minion' | 'turret' | 'inhibitor' | 'nexus' | 'monster';

export interface KillRequest {
  victimKind: VictimKind;
  /** Only meaningful for a minion; ignored otherwise. */
  minionType?: MinionType;
  /** The killer's side, or null for a neutral or unattributable source. */
  killerSide: 'ally' | 'enemy' | null;
}

// Bounty comes from economy.ts rather than being restated here: two definitions of the same reward shape is how the two
// drift, and this module's whole purpose is to be the single place a payout is decided.
export type { Bounty };

export interface KillOutcome {
  /** What the killer earns. Zero-valued rather than null so a caller cannot forget to handle "no bounty". */
  bounty: Bounty;
  /** Increment for the killer side's champion-kill tally, 0 unless a champion died. */
  championKillDelta: number;
  /** True when this kill starts an inhibitor respawn timer. */
  startsInhibitorRespawn: boolean;
}

const NO_BOUNTY: Bounty = { gold: 0, xp: 0 };

/**
 * Decide what a kill pays.
 *
 * A kill with no attributable side still resolves the victim's own consequences — an inhibitor felled by a minion wave
 * must still start its respawn — but pays no bounty, because there is nobody to pay. Returning a zero bounty rather than
 * null is deliberate: the caller adds it unconditionally and cannot skip a case by forgetting a null check.
 */
export function resolveKill(request: KillRequest): KillOutcome {
  const { victimKind, killerSide } = request;
  const attributable = killerSide !== null;

  switch (victimKind) {
    case 'champion':
      return {
        bounty: attributable ? CHAMPION_TAKEDOWN_BOUNTY : NO_BOUNTY,
        championKillDelta: attributable ? 1 : 0,
        startsInhibitorRespawn: false,
      };
    case 'minion':
      return {
        bounty: attributable ? minionBounty(request.minionType ?? 'melee') : NO_BOUNTY,
        championKillDelta: 0,
        startsInhibitorRespawn: false,
      };
    case 'turret':
      return {
        bounty: attributable ? structureBounty('turret') : NO_BOUNTY,
        championKillDelta: 0,
        startsInhibitorRespawn: false,
      };
    case 'inhibitor':
      return {
        bounty: attributable ? structureBounty('inhibitor') : NO_BOUNTY,
        championKillDelta: 0,
        // Independent of attribution: the respawn timer is the inhibitor's own consequence, not a reward.
        startsInhibitorRespawn: true,
      };
    case 'nexus':
      return {
        bounty: attributable ? structureBounty('nexus') : NO_BOUNTY,
        championKillDelta: 0,
        startsInhibitorRespawn: false,
      };
    case 'monster':
      // Jungle monsters pay nothing here. Their reward is the buff they grant, which the caller applies.
      return { bounty: NO_BOUNTY, championKillDelta: 0, startsInhibitorRespawn: false };
  }
}

/**
 * Classify a victim from the fields the scene already has.
 *
 * Kept beside resolveKill because the two have to agree about what an inhibitor IS: `kind` says 'turret' for an inhibitor,
 * and only the map node distinguishes them. Splitting the classification from the payout is how an inhibitor comes to pay
 * a turret's bounty.
 */
export function classifyVictim(unitKind: string, nodeKind: string | undefined): VictimKind {
  if (unitKind === 'champion') return 'champion';
  if (unitKind === 'minion') return 'minion';
  if (unitKind === 'monster') return 'monster';
  if (unitKind === 'turret' || unitKind === 'nexus') {
    if (nodeKind === 'inhibitor') return 'inhibitor';
    if (nodeKind === 'nexus') return 'nexus';
    return 'turret';
  }
  return 'monster';
}
