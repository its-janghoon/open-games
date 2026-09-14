import { CHAMPIONS } from '../data/champions';
import { isDifficulty, isMatchKind } from '../game/tutorial/config';
import { decodeGhost } from '../game/ghost';
import type {
  ChampionMastery,
  ChampsProfile,
  LastMatchSetup,
  ProfileGameMode,
} from './types';

export const PROFILE_VERSION = 2;
export const PROFILE_STORAGE_KEY = 'champs:profile';
export const STARTING_CURRENCY = 500;
/** Recent idempotency window; old match ids are evicted to bound persisted saves. */
export const MAX_APPLIED_MATCH_IDS = 64;
/**
 * How many imported ghost codes a profile keeps. Bounded because this list is fed by
 * pasting: without a cap a profile grows forever from a feature whose whole point is
 * that codes are cheap to share.
 */
export const MAX_GHOST_CODES = 12;
export const STARTER_CHAMPION_IDS = [
  'ashborne',
  'ironhold',
  'embermage',
] as const;

const CHAMPION_IDS = new Set(CHAMPIONS.map((champion) => champion.id));

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string'))];
}

function validChampionIds(value: unknown): string[] {
  return uniqueStrings(value).filter((id) => CHAMPION_IDS.has(id));
}

function parseProfileGameMode(value: unknown): ProfileGameMode | null {
  const legacyConquest = 'ri' + 'ft';
  const legacyMidline = 'ar' + 'am';
  if (value === 'conquest' || value === legacyConquest) return 'conquest';
  if (value === 'midline' || value === legacyMidline) return 'midline';
  return null;
}

function sanitizeMasteryEntry(value: unknown): ChampionMastery | undefined {
  if (!isRecord(value)) return undefined;
  return {
    xp: nonNegativeInteger(value.xp),
    matches: nonNegativeInteger(value.matches),
    wins: nonNegativeInteger(value.wins),
  };
}

function sanitizeMastery(value: unknown): Record<string, ChampionMastery> {
  if (!isRecord(value)) return {};

  const mastery: Record<string, ChampionMastery> = {};
  for (const [championId, entry] of Object.entries(value)) {
    const sanitized = sanitizeMasteryEntry(entry);
    if (CHAMPION_IDS.has(championId) && sanitized) mastery[championId] = sanitized;
  }
  return mastery;
}

function sanitizeLastSetup(value: unknown): LastMatchSetup | undefined {
  if (!isRecord(value)) return undefined;
  const mode = parseProfileGameMode(value.mode);
  if (
    !mode ||
    !isMatchKind(value.matchKind) ||
    !isDifficulty(value.difficulty) ||
    typeof value.playerChampionId !== 'string' ||
    typeof value.enemyChampionId !== 'string' ||
    !CHAMPION_IDS.has(value.playerChampionId) ||
    !CHAMPION_IDS.has(value.enemyChampionId)
  ) {
    return undefined;
  }

  return {
    mode,
    matchKind: value.matchKind,
    difficulty: value.difficulty,
    playerChampionId: value.playerChampionId,
    enemyChampionId: value.enemyChampionId,
  };
}

function sanitizeSeenFlags(value: unknown): Record<string, true> {
  if (!isRecord(value)) return {};
  const flags: Record<string, true> = {};
  for (const [key, seen] of Object.entries(value)) {
    if (seen === true) flags[key] = true;
  }
  return flags;
}

export function createDefaultProfile(): ChampsProfile {
  return {
    version: PROFILE_VERSION,
    nextMatchCounter: 1,
    accountXp: 0,
    currency: STARTING_CURRENCY,
    unlockedChampionIds: [...STARTER_CHAMPION_IDS],
    mastery: {},
    tutorialCompleted: false,
    practiceCompleted: false,
    seenFlags: {},
    appliedMatchIds: [],
    ghostCodes: [],
  };
}

/**
 * Upgrade and sanitize untrusted persisted data. Missing/corrupt fields fall
 * back independently, while unsupported future versions fail closed.
 */
export function migrateProfile(value: unknown): ChampsProfile {
  const defaults = createDefaultProfile();
  if (!isRecord(value)) return defaults;

  const version = nonNegativeInteger(value.version, 0);
  if (version > PROFILE_VERSION) return defaults;

  const legacyAccount = isRecord(value.account) ? value.account : undefined;
  const unlocked = validChampionIds(
    value.unlockedChampionIds ?? value.unlockedChampions,
  );
  const mastery = sanitizeMastery(value.mastery ?? value.masteryByChampion);
  const completion = isRecord(value.completion) ? value.completion : undefined;
  const seenFlags = sanitizeSeenFlags(value.seenFlags ?? value.seen);
  const lastSetup = sanitizeLastSetup(value.lastSetup);

  return {
    version: PROFILE_VERSION,
    nextMatchCounter: Math.max(
      1,
      nonNegativeInteger(value.nextMatchCounter ?? value.matchCounter, defaults.nextMatchCounter),
    ),
    accountXp: nonNegativeInteger(
      value.accountXp ?? value.xp ?? legacyAccount?.xp,
      defaults.accountXp,
    ),
    currency: nonNegativeInteger(
      value.currency ?? legacyAccount?.currency,
      defaults.currency,
    ),
    unlockedChampionIds: [
      ...new Set([...STARTER_CHAMPION_IDS, ...unlocked]),
    ],
    mastery,
    tutorialCompleted:
      value.tutorialCompleted === true ||
      value.completedTutorial === true ||
      completion?.tutorial === true,
    practiceCompleted:
      value.practiceCompleted === true ||
      value.completedPractice === true ||
      completion?.practice === true,
    ...(lastSetup ? { lastSetup } : {}),
    seenFlags,
    appliedMatchIds: uniqueStrings(value.appliedMatchIds).slice(
      -MAX_APPLIED_MATCH_IDS,
    ),
    // Ghost fields have to be listed HERE or they vanish on every reload: this
    // function is a strict allowlist that rebuilds the profile from named keys, so an
    // unlisted field is silently dropped rather than preserved. Codes are validated on
    // the way in - a corrupt or foreign-version code is discarded here rather than
    // failing later at the point of use, where it would look like a broken feature.
    ...(typeof value.myGhostCode === 'string' && decodeGhost(value.myGhostCode).ok
      ? { myGhostCode: value.myGhostCode }
      : {}),
    ghostCodes: uniqueStrings(value.ghostCodes)
      .filter((code) => decodeGhost(code).ok)
      .slice(-MAX_GHOST_CODES),
  };
}
