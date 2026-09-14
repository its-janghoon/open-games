import { CHAMPIONS } from '../data/champions';
import type { ChampsProfile, LastMatchSetup } from '../profile/types';

/** A complete, immutable match request issued before Phaser starts. */
export interface MatchRequest extends LastMatchSetup {
  matchId: string;
  matchSeed: string;
  /**
   * A ghost code the player asked to fight, or undefined for the ordinary AI.
   *
   * Carried on the REQUEST so the opponent choice travels with the match it belongs to.
   * PhaserGame spreads the request straight into the scene data, so this is the whole
   * hop - the scene never reads the profile to decide who it is fighting, which is what
   * keeps an in-progress match from changing when the profile does.
   */
  ghostCode?: string;
}

export interface IssuedMatchRequest {
  request: MatchRequest;
  profile: ChampsProfile;
}

/** Stable non-cryptographic hash used only to derive local simulation seeds. */
export function hashSeed(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

/**
 * Issue the next installation-local request. Identity is derived exclusively
 * from a persisted monotonic counter and a deterministic seed; wall time and
 * ambient randomness never enter authoritative state.
 */
export function issueMatchRequest(
  profile: ChampsProfile,
  setup: LastMatchSetup,
): IssuedMatchRequest {
  const counter = Math.max(1, Math.floor(profile.nextMatchCounter));
  const pickMaterial = setup.mode === 'midline'
    ? ['random-roster-v1']
    : [setup.playerChampionId, setup.enemyChampionId];
  const matchSeed = hashSeed([
    'match-v1',
    counter,
    setup.mode,
    setup.matchKind,
    setup.difficulty,
    ...pickMaterial,
  ].join(':'));
  const resolved = resolveRosterPicks(setup, matchSeed);
  return {
    request: {
      ...setup,
      ...resolved,
      matchSeed,
      matchId: `local-${counter.toString(36)}-${matchSeed}`,
    },
    profile: { ...profile, nextMatchCounter: counter + 1 },
  };
}

/** Midline honestly resolves both facing picks from the full roster and seed. */
export function resolveRosterPicks(
  setup: LastMatchSetup,
  matchSeed: string,
): Pick<LastMatchSetup, 'playerChampionId' | 'enemyChampionId'> {
  if (setup.mode !== 'midline') {
    return {
      playerChampionId: setup.playerChampionId,
      enemyChampionId: setup.enemyChampionId,
    };
  }

  const first = seedIndex(`${matchSeed}:player`, CHAMPIONS.length);
  const secondOffset = seedIndex(`${matchSeed}:enemy`, CHAMPIONS.length - 1) + 1;
  const second = (first + secondOffset) % CHAMPIONS.length;
  return {
    playerChampionId: CHAMPIONS[first].id,
    enemyChampionId: CHAMPIONS[second].id,
  };
}

function seedIndex(seed: string, length: number): number {
  if (length <= 1) return 0;
  return Number.parseInt(hashSeed(seed), 36) % length;
}
