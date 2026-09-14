/**
 * The dependency-free KO/EN string table for Gridfall.
 *
 * Same shape as Ringout's, which is the same shape as Whiteout's: a `Language` union, `{ en, ko }` entries,
 * dotted keys grouped by screen, `{name}` placeholders. Three games agreeing costs nothing and means anyone
 * who has read one table can read the others.
 *
 * Korean-first, as everywhere in this project. The boot screen previously concatenated the two languages
 * inline — "아무 키나 눌러 시작 · press any key" — which reads as neither language properly and cannot be
 * checked for completeness. Same defect Ringout's commit called out, made in a new file two cycles later.
 */

export type Language = 'ko' | 'en';

export const LANGUAGES: Language[] = ['ko', 'en'];

export interface TrEntry {
  en: string;
  ko: string;
}

export const STRINGS = {
  'brand.name': { en: 'GRIDFALL', ko: '그리드폴' },

  'title.tagline': {
    en: 'A room cast from a grid, one column at a time.',
    ko: '격자에서 한 기둥씩 캐스팅한 방.',
  },
  'title.start': { en: 'Press any key to enter', ko: '아무 키나 눌러 입장' },
  'title.p1Controls': { en: 'P1   W A S D   ·   Q E turn   ·   Space fire', ko: 'P1   W A S D   ·   Q E 회전   ·   Space 발사' },
  'title.p2Controls': { en: 'P2   I J K L   ·   U O turn   ·   Enter fire', ko: 'P2   I J K L   ·   U O 회전   ·   Enter 발사' },
  'title.sharedNote': {
    en: 'Two players, one keyboard. Open a second tab to play over the network.',
    ko: '한 키보드로 두 명. 두 번째 탭을 열면 네트워크로 대전합니다.',
  },

  'net.waiting': { en: 'Waiting for the other tab…', ko: '다른 탭을 기다리는 중…' },
  'net.connected': { en: 'Connected — {role}', ko: '연결됨 — {role}' },
  'net.roleHost': { en: 'player 1', ko: '1P' },
  'net.roleGuest': { en: 'player 2', ko: '2P' },
  'net.desync': {
    en: 'Desync detected at tick {tick}. The two tabs no longer agree.',
    ko: '{tick} 틱에서 desync 감지. 두 탭이 더 이상 일치하지 않습니다.',
  },
  'net.local': { en: 'Local — shared keyboard', ko: '로컬 — 키보드 공유' },

  'hud.kills': { en: 'Kills {count}   /   {limit}', ko: '킬 {count}   /   {limit}' },

  // Match result. Three keys rather than one template with a reason parameter, because Korean and English put the
  // winner in different places and a single template would force one of them into an unnatural order.
  'result.win': { en: '{winner} wins', ko: '{winner} 승' },
  'result.lose': { en: '{winner} wins — you are down', ko: '{winner} 승 — 패배' },
  'result.draw': { en: 'DRAW', ko: '무승부' },
  'result.rematch': { en: 'Press any key for a rematch', ko: '아무 키나 눌러 재대결' },
  'hud.dead': { en: 'Down — back in {seconds}s', ko: '전사 — {seconds}초 후 복귀' },
} as const satisfies Record<string, TrEntry>;

export type TrKey = keyof typeof STRINGS;

/**
 * Look up a string and fill its placeholders.
 *
 * An unknown placeholder is left in place rather than replaced with 'undefined', so a mistake shows as a
 * visible `{tick}` on screen instead of quietly reading as prose.
 */
export function tr(
  key: TrKey,
  language: Language,
  params: Readonly<Record<string, string | number>> = {},
): string {
  const template = STRINGS[key][language];
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/**
 * Pick the UI language from the browser, defaulting to Korean.
 *
 * Nothing is persisted, for the reason recorded in Ringout: whiteout's normalizeSettings and champs'
 * migrateProfile are strict allowlists that silently drop unlisted fields, so storing a language would mean
 * either editing those or building a store for one value the browser already answers.
 */
export function resolveLanguage(tag?: string): Language {
  // The tag is a PARAMETER with a browser default, so the branch is testable. Reading navigator directly made
  // the only available test assert whatever the test runner's own locale happened to be — which under vitest is
  // en-US, so a test written to check the Korean default failed for a reason that had nothing to do with the
  // code.
  const resolved =
    tag ??
    (typeof navigator !== 'undefined' && typeof navigator.language === 'string'
      ? navigator.language
      : '');
  return resolved.toLowerCase().startsWith('en') ? 'en' : 'ko';
}
