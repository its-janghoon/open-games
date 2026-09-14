/**
 * The dependency-free KO/EN string table for Ringout.
 *
 * Shaped after whiteout's i18n rather than invented: same `Language` union, same `{ en, ko }` entry,
 * same dotted keys grouped by screen, same `{name}` placeholder syntax. Matching an existing game
 * costs nothing and means anyone who has read one table can read this one.
 *
 * Korean-first, like the rest of the project — the audience this whole thing is aimed at includes
 * people for whom English is the second language, so Korean is the primary text and not a
 * translation bolted on afterwards.
 *
 * Pure data and types, so both the Phaser scenes and the tests can import it with no runtime
 * dependency. There is a test that every key carries both locales, because a missing Korean string
 * does not crash — it silently shows English to someone who cannot read it, which is the failure mode
 * a type cannot catch on its own.
 */

export type Language = 'ko' | 'en';

/** Korean first, matching the other games' selectors. */
export const LANGUAGES: Language[] = ['ko', 'en'];

export interface TrEntry {
  en: string;
  ko: string;
}

export const STRINGS = {
  // Brand. Routed through a key even though it is a proper noun, so no scene hardcodes the title.
  'brand.name': { en: 'RINGOUT', ko: '링아웃' },

  // Title screen.
  'title.tagline': {
    en: 'Two bodies, no sprites. Every pose is computed.',
    ko: '스프라이트 없는 두 몸. 모든 자세는 계산된다.',
  },
  'title.start': { en: 'Press any key to fight', ko: '아무 키나 눌러 대전 시작' },
  'title.controlsP1': { en: 'P1   W A S D  +  F G H', ko: 'P1   W A S D  +  F G H' },
  'title.controlsP2': { en: 'P2   Arrows  +  J K L', ko: 'P2   방향키  +  J K L' },
  'title.controlsHint': {
    en: 'Hold away from your opponent to block.',
    ko: '상대 반대쪽을 누르고 있으면 방어',
  },

  // Attacks, named so the control hints and any future move list agree.
  'move.jab': { en: 'Jab', ko: '잽' },
  'move.kick': { en: 'Kick', ko: '킥' },
  'move.slam': { en: 'Slam', ko: '슬램' },

  // Round result. Kept as three distinct keys rather than one with a reason parameter, because Korean
  // and English put the winner in different places and a single template would force one of them into
  // an unnatural order.
  'result.ko': { en: 'K.O.  —  {winner} wins', ko: 'K.O.  —  {winner} 승' },
  'result.ringout': { en: 'RING OUT  —  {winner} wins', ko: '링아웃  —  {winner} 승' },
  'result.draw': { en: 'DRAW', ko: '무승부' },
  'result.rematch': { en: 'Press any key for a rematch', ko: '아무 키나 눌러 재대결' },
  'result.tally': { en: '{left} — {right}', ko: '{left} — {right}' },

  // Player labels, so the banner never prints a bare participant id at a human.
  'player.p1': { en: 'Player 1', ko: '1P' },
  'player.p2': { en: 'Player 2', ko: '2P' },
} as const satisfies Record<string, TrEntry>;

export type TrKey = keyof typeof STRINGS;

/**
 * Look up a string and fill its placeholders.
 *
 * An unknown placeholder is left in place rather than replaced with 'undefined', so a mistake shows up
 * as a visible `{winner}` on screen instead of quietly reading as English prose.
 */
export function tr(
  key: TrKey,
  language: Language,
  params: Readonly<Record<string, string | number>> = {},
): string {
  const entry = STRINGS[key];
  const template = entry[language];
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}
