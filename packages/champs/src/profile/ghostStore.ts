import { MAX_GHOST_CODES } from './profile';
import { decodeGhost, encodeGhost, learnGhost, type GhostObservation, type GhostPolicy } from '../game/ghost';
import { MIN_OBSERVATIONS } from '../game/ghost';
import type { ChampsProfile } from './types';

/**
 * Storing and choosing ghosts.
 *
 * Kept out of the battle scene and out of the profile's migration so the decisions
 * here - when a ghost is good enough to keep, what happens to a pasted code, which
 * ghost an opponent uses - are testable without a browser.
 *
 * Two rules run through all of it. Codes are the only representation that is stored,
 * so a profile can never hold a ghost that would not survive being shared. And a
 * stored ghost changes nothing on its own: opponents are opt-in, because silently
 * replacing the AI with a friend's ghost would make the game's difficulty
 * unexplainable to the player.
 */

export interface GhostStoreResult {
  profile: ChampsProfile;
  /** What happened, so a caller can tell the player rather than guessing. */
  outcome: 'saved' | 'too-few-observations' | 'duplicate' | 'rejected';
}

/**
 * Learn from a match's observations and store the result as the player's own ghost.
 *
 * Refuses below MIN_OBSERVATIONS rather than saving a neutral ghost under the
 * player's name: a code learned from a handful of decisions describes nobody, and
 * sharing it would misrepresent them to whoever fights it.
 */
export function saveLearnedGhost(
  profile: ChampsProfile,
  observations: readonly GhostObservation[],
): GhostStoreResult {
  if (observations.length < MIN_OBSERVATIONS) {
    return { profile, outcome: 'too-few-observations' };
  }
  const code = encodeGhost(learnGhost(observations));
  if (code === profile.myGhostCode) return { profile, outcome: 'duplicate' };
  return { profile: { ...profile, myGhostCode: code }, outcome: 'saved' };
}

/**
 * Import a pasted ghost code.
 *
 * Validates before storing, so a bad paste is refused at the moment the player can
 * still see what they pasted - not later, in a match, where it would look like the
 * feature is broken. Newest first, capped, and duplicates are reported rather than
 * silently collapsing the list.
 */
export function importGhostCode(profile: ChampsProfile, code: string): GhostStoreResult {
  const decoded = decodeGhost(code);
  if (!decoded.ok) return { profile, outcome: 'rejected' };

  // Store the canonical encoding, not the string as typed: two codes differing only
  // in case, grouping or lookalike characters are the same ghost, and keeping both
  // would fill the list with duplicates that do not look like duplicates.
  const canonical = encodeGhost(decoded.ghost);
  if (profile.ghostCodes.includes(canonical)) return { profile, outcome: 'duplicate' };

  const ghostCodes = [canonical, ...profile.ghostCodes].slice(0, MAX_GHOST_CODES);
  return { profile: { ...profile, ghostCodes }, outcome: 'saved' };
}

/** Remove an imported code. Silent when absent - deleting twice is not an error. */
export function forgetGhostCode(profile: ChampsProfile, code: string): ChampsProfile {
  const decoded = decodeGhost(code);
  const canonical = decoded.ok ? encodeGhost(decoded.ghost) : code;
  return { ...profile, ghostCodes: profile.ghostCodes.filter((c) => c !== canonical) };
}

/**
 * The ghost an opponent should use, or null for the ordinary AI.
 *
 * Explicitly opt-in via `requested`. Returning null for anything unrecognised - a
 * code that has since been removed, a corrupted store, no request at all - is what
 * keeps a broken ghost from turning into a broken match: the opponent falls back to
 * the AI that has always worked.
 */
export function ghostForOpponent(
  profile: ChampsProfile,
  requested: string | null | undefined,
): GhostPolicy | null {
  if (!requested) return null;
  const decoded = decodeGhost(requested);
  if (!decoded.ok) return null;
  const canonical = encodeGhost(decoded.ghost);
  const known = profile.ghostCodes.includes(canonical) || profile.myGhostCode === canonical;
  return known ? decoded.ghost : null;
}
