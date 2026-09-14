import type { Difficulty, MatchKind } from '../game/tutorial/config';

/** Structurally compatible with the arena modes without importing battle state. */
export type ProfileGameMode = 'conquest' | 'midline';

export interface ChampionMastery {
  xp: number;
  matches: number;
  wins: number;
}

export interface LastMatchSetup {
  mode: ProfileGameMode;
  matchKind: MatchKind;
  difficulty: Difficulty;
  playerChampionId: string;
  enemyChampionId: string;
}

/** Persisted profile schema. Changes require a version migration. */
export interface ChampsProfile {
  version: number;
  /** Next installation-local monotonic match counter (never decremented). */
  nextMatchCounter: number;
  accountXp: number;
  currency: number;
  unlockedChampionIds: string[];
  mastery: Record<string, ChampionMastery>;
  tutorialCompleted: boolean;
  practiceCompleted: boolean;
  lastSetup?: LastMatchSetup;
  seenFlags: Record<string, true>;
  appliedMatchIds: string[];
  /**
   * The player's own learned ghost, as a shareable code, or undefined before enough
   * has been observed to learn one. Stored as a CODE rather than a decoded policy so
   * that what is persisted is exactly what can be shared - one representation, so a
   * profile can never hold a ghost that will not survive being sent to a friend.
   */
  myGhostCode?: string;
  /**
   * Ghost codes the player has imported, newest first. Opponents are opt-in: a stored
   * ghost changes nothing until a match explicitly asks for one.
   */
  ghostCodes: string[];
}

/** Minimal storage contract, compatible with window.localStorage and test fakes. */
export interface ProfileStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type ProfileMatchResult = 'win' | 'loss' | 'draw' | 'abandoned';

/** Self-contained facts needed to apply a result to progression. */
export interface ProfileMatchOutcomeFacts extends LastMatchSetup {
  matchId: string;
  result: ProfileMatchResult;
  /** True only when every mandatory Learning action was performed. */
  learningRequirementsCompleted?: boolean;
}


/** Concise aliases for consumers that do not need the profile namespace. */
export type Profile = ChampsProfile;
export type GameMode = ProfileGameMode;
export type MatchOutcomeFacts = ProfileMatchOutcomeFacts;
