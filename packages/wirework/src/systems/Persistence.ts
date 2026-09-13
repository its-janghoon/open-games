import type { Language } from '../i18n/strings';

export type Difficulty = 'relaxed' | 'standard' | 'brutal';
export type ReducedMotion = 'system' | 'on' | 'off';
export type ColorMode = 'default' | 'deuteranopia' | 'protanopia' | 'tritanopia' | 'high-contrast';
export type InputAction =
  | 'moveLeft'
  | 'moveRight'
  | 'moveUp'
  | 'moveDown'
  | 'dash'
  | 'tether'
  | 'slash'
  | 'reelIn'
  | 'reelOut'
  | 'pause';
export type Bindings = Record<InputAction, string>;

export interface GameSettings {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  difficulty: Difficulty;
  language: Language;
  reducedMotion: ReducedMotion;
  colorMode: ColorMode;
  bindings: Bindings;
  gamepadDeadzone: number;
  /**
   * Whether the player has completed (or skipped) the tether onboarding. The
   * tether is hold-to-use and was undiscoverable, so a first run gates wave 1
   * behind one successful hold-attach-release. Persisted so it never interrupts
   * a returning player.
   */
  tetherTutorialDone: boolean;
}

export const SETTINGS_KEY = 'wirework:settings:v2';
const LEGACY_SETTINGS_KEY = 'wirework:settings:v1';
export const RECORDS_KEY = 'wirework:records:v1';

export const DEFAULT_BINDINGS: Bindings = {
  moveLeft: 'A',
  moveRight: 'D',
  moveUp: 'W',
  moveDown: 'S',
  dash: 'SHIFT',
  tether: 'MOUSE_LEFT',
  slash: 'MOUSE_RIGHT',
  reelIn: 'Q',
  reelOut: 'E',
  pause: 'P',
};

export const DEFAULT_SETTINGS: GameSettings = {
  masterVolume: 0.8,
  sfxVolume: 0.9,
  musicVolume: 0.6,
  difficulty: 'standard',
  language: 'ko',
  reducedMotion: 'system',
  colorMode: 'default',
  bindings: { ...DEFAULT_BINDINGS },
  gamepadDeadzone: 0.18,
  tetherTutorialDone: false,
};

let storageAvailable = true;
let memorySettings: GameSettings | null = null;

function recordRoot(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberIn(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && values.includes(value as T) ? (value as T) : fallback;
}

export function isBindingTokenValid(action: InputAction, tokenValue: string): boolean {
  const token = tokenValue.toUpperCase();
  const mouseAllowed = action === 'tether' || action === 'slash';
  const validMouse = mouseAllowed && (token === 'MOUSE_LEFT' || token === 'MOUSE_RIGHT');
  const validKeyboard = token.length > 0 && token.length <= 32 && /^[A-Z0-9_-]+$/.test(token) && !token.startsWith('MOUSE_');
  return validMouse || validKeyboard;
}

function validateBindings(value: unknown): Bindings {
  const root = recordRoot(value);
  const result = {} as Bindings;
  const used = new Set<string>();
  const actions = Object.keys(DEFAULT_BINDINGS) as InputAction[];
  for (const [index, action] of actions.entries()) {
    const raw = root?.[action];
    const candidate = typeof raw === 'string' ? raw.toUpperCase() : '';
    const reservedDefaults = new Set(actions.slice(index + 1).map((futureAction) => DEFAULT_BINDINGS[futureAction]));
    const candidateAvailable = isBindingTokenValid(action, candidate) &&
      !used.has(candidate) &&
      (!reservedDefaults.has(candidate) || candidate === DEFAULT_BINDINGS[action]);
    const token = candidateAvailable ? candidate : DEFAULT_BINDINGS[action];
    result[action] = token;
    used.add(token);
  }
  return result;
}

function normalizeSettings(value: unknown): GameSettings {
  const root = recordRoot(value) ?? {};
  return {
    masterVolume: numberIn(root.masterVolume, 0, 1, DEFAULT_SETTINGS.masterVolume),
    sfxVolume: numberIn(root.sfxVolume, 0, 1, DEFAULT_SETTINGS.sfxVolume),
    musicVolume: numberIn(root.musicVolume, 0, 1, DEFAULT_SETTINGS.musicVolume),
    difficulty: enumValue(root.difficulty, ['relaxed', 'standard', 'brutal'] as const, DEFAULT_SETTINGS.difficulty),
    language: enumValue(root.language, ['ko', 'en'] as const, DEFAULT_SETTINGS.language),
    reducedMotion: enumValue(root.reducedMotion, ['system', 'on', 'off'] as const, DEFAULT_SETTINGS.reducedMotion),
    colorMode: enumValue(
      root.colorMode,
      ['default', 'deuteranopia', 'protanopia', 'tritanopia', 'high-contrast'] as const,
      DEFAULT_SETTINGS.colorMode,
    ),
    bindings: validateBindings(root.bindings),
    gamepadDeadzone: numberIn(root.gamepadDeadzone, 0.1, 0.35, DEFAULT_SETTINGS.gamepadDeadzone),
    tetherTutorialDone: root.tetherTutorialDone === true,
  };
}

function writeStorage(key: string, value: unknown): boolean {
  try {
    if (typeof localStorage === 'undefined') return true;
    localStorage.setItem(key, JSON.stringify(value));
    storageAvailable = true;
    return true;
  } catch {
    storageAvailable = false;
    return false;
  }
}

export function loadSettings(): GameSettings {
  if (memorySettings) return { ...memorySettings, bindings: { ...memorySettings.bindings } };
  let parsed: unknown = null;
  try {
    if (typeof localStorage !== 'undefined') {
      const current = localStorage.getItem(SETTINGS_KEY);
      const legacy = current === null ? localStorage.getItem(LEGACY_SETTINGS_KEY) : null;
      parsed = JSON.parse(current ?? legacy ?? 'null') as unknown;
    }
  } catch {
    storageAvailable = false;
  }
  memorySettings = normalizeSettings(parsed);
  writeStorage(SETTINGS_KEY, { version: 2, ...memorySettings });
  return { ...memorySettings, bindings: { ...memorySettings.bindings } };
}

export function saveSettings(settings: GameSettings): boolean {
  memorySettings = normalizeSettings(settings);
  return writeStorage(SETTINGS_KEY, { version: 2, ...memorySettings });
}

export function isStorageAvailable(): boolean {
  return storageAvailable;
}

export interface RunRecord {
  score: number;
  wavesCompleted: number;
  citizensRemaining: number;
  activeMs: number;
  endedAt: string;
}

export type Records = Partial<Record<Difficulty, RunRecord>>;
let memoryRecords: Records | null = null;

function safeCount(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null;
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function normalizeRecord(value: unknown): RunRecord | null {
  const root = recordRoot(value);
  if (!root) return null;
  const score = safeCount(root.score);
  const wavesCompleted = safeCount(root.wavesCompleted);
  const citizensRemaining = safeCount(root.citizensRemaining);
  const activeMs = safeCount(root.activeMs);
  const endedAt = isCanonicalIsoTimestamp(root.endedAt) ? root.endedAt : null;
  if (score === null || wavesCompleted === null || citizensRemaining === null || activeMs === null || !endedAt) return null;
  return { score, wavesCompleted, citizensRemaining, activeMs, endedAt };
}

export function loadRecords(): Records {
  if (memoryRecords) return { ...memoryRecords };
  let root: Record<string, unknown> | null = null;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(RECORDS_KEY) : null;
    root = recordRoot(raw ? (JSON.parse(raw) as unknown) : null);
  } catch {
    storageAvailable = false;
  }
  const source = root?.version === 1
    ? recordRoot(root.records) ?? {}
    : root && !('version' in root) ? root : {};
  memoryRecords = {};
  for (const difficulty of ['relaxed', 'standard', 'brutal'] as const) {
    const record = normalizeRecord(source[difficulty]);
    if (record) memoryRecords[difficulty] = record;
  }
  writeStorage(RECORDS_KEY, { version: 1, records: memoryRecords });
  return { ...memoryRecords };
}

/** Positive means candidate outranks incumbent. */
export function compareRecords(candidate: RunRecord, incumbent: RunRecord): number {
  return (
    candidate.score - incumbent.score ||
    candidate.wavesCompleted - incumbent.wavesCompleted ||
    candidate.citizensRemaining - incumbent.citizensRemaining ||
    incumbent.activeMs - candidate.activeMs
  );
}

export function saveRunRecord(
  difficulty: Difficulty,
  candidate: RunRecord,
): { best: RunRecord; isNew: boolean; persisted: boolean } {
  const records = loadRecords();
  const incumbent = records[difficulty];
  const normalizedCandidate = normalizeRecord(candidate);
  if (!normalizedCandidate) {
    const fallback = incumbent ?? {
      score: 0,
      wavesCompleted: 0,
      citizensRemaining: 0,
      activeMs: 0,
      endedAt: new Date(0).toISOString(),
    };
    return { best: fallback, isNew: false, persisted: false };
  }
  const isNew = !incumbent || compareRecords(normalizedCandidate, incumbent) > 0;
  if (isNew) records[difficulty] = normalizedCandidate;
  memoryRecords = records;
  const persisted = writeStorage(RECORDS_KEY, { version: 1, records });
  return { best: records[difficulty] ?? normalizedCandidate, isNew, persisted };
}

export function prefersReducedMotion(settings: GameSettings): boolean {
  if (settings.reducedMotion === 'on') return true;
  if (settings.reducedMotion === 'off') return false;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function applyPresentationSettings(settings: GameSettings): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = settings.language;
  document.documentElement.dataset.colorMode = settings.colorMode;
  document.documentElement.dataset.reducedMotion = prefersReducedMotion(settings) ? 'on' : 'off';
}
