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
  'title.network': { en: 'Press N to play over your network', ko: 'N 키로 네트워크 플레이' },
  'net.connectTitle': { en: 'Play over your network', ko: '네트워크로 플레이' },
  'net.connectBlurb': {
    en: 'No server and no account. One of you hosts, the other joins, and you pass two codes between you however you already talk. Both players must be on the SAME network.',
    ko: '서버도 계정도 없습니다. 한 사람이 방을 열고 다른 사람이 참가해, 두 개의 코드를 서로 전달하면 됩니다. 두 사람이 반드시 같은 네트워크에 있어야 합니다.',
  },
  'net.hostButton': { en: 'Host a match', ko: '방 열기' },
  'net.joinButton': { en: 'Join a match', ko: '참가하기' },
  'net.closeButton': { en: 'Close', ko: '닫기' },
  'net.yourCode': { en: 'Your code — send this to the other player', ko: '내 코드 — 상대에게 보내세요' },
  'net.theirCode': { en: "The other player's code", ko: '상대의 코드' },
  'net.submitCode': { en: 'Use this code', ko: '이 코드 사용' },
  'net.gathering': { en: 'Preparing your code…', ko: '코드를 준비하는 중…' },
  'net.shareYourCode': { en: 'Send your code, then paste the reply below.', ko: '내 코드를 보내고, 답장 코드를 아래에 붙여넣으세요.' },
  'net.pasteOffer': { en: "Paste the host's code here.", ko: '방장의 코드를 여기에 붙여넣으세요.' },
  'net.pasteAnswer': { en: "Paste the other player's reply here.", ko: '상대의 답장 코드를 여기에 붙여넣으세요.' },
  'net.sendBackYourCode': { en: 'Send your code back to the host.', ko: '내 코드를 방장에게 보내세요.' },
  'net.finishing': { en: 'Connecting…', ko: '연결하는 중…' },
  'net.needCode': { en: 'Paste a code first.', ko: '먼저 코드를 붙여넣으세요.' },
  'net.unavailable': {
    en: 'This browser cannot make a direct connection. You can still play two players on one keyboard.',
    ko: '이 브라우저는 직접 연결을 만들 수 없습니다. 한 키보드로 두 명이 플레이하는 것은 그대로 됩니다.',
  },
  /**
   * A desync is shown, never repaired.
   *
   * Repair would mean shipping world state and handing one side authority over the other, which abandons input-only
   * netcode entirely. Naming the tick turns a silent disagreement into something a player can see and act on.
   */
  'net.desync': {
    en: 'The two fights disagreed at tick {tick} — restart to resync.',
    ko: '틱 {tick}에서 두 시뮬레이션이 어긋났습니다 — 재시작하면 맞춰집니다.',
  },
  'net.roleHost': { en: 'player 1', ko: '1P' },
  'net.roleGuest': { en: 'player 2', ko: '2P' },
  'net.connected': { en: 'Connected — {role}', ko: '연결됨 — {role}' },
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

export function connectPanelText(language: Language) {
  return {
    title: tr('net.connectTitle', language),
    blurb: tr('net.connectBlurb', language),
    host: tr('net.hostButton', language),
    join: tr('net.joinButton', language),
    close: tr('net.closeButton', language),
    yourCode: tr('net.yourCode', language),
    theirCode: tr('net.theirCode', language),
    submit: tr('net.submitCode', language),
    gathering: tr('net.gathering', language),
    shareYourCode: tr('net.shareYourCode', language),
    pasteOffer: tr('net.pasteOffer', language),
    pasteAnswer: tr('net.pasteAnswer', language),
    sendBackYourCode: tr('net.sendBackYourCode', language),
    finishing: tr('net.finishing', language),
    needCode: tr('net.needCode', language),
    unavailable: tr('net.unavailable', language),
    connected: tr('net.connected', language, { role: '{role}' }),
    roleHost: tr('net.roleHost', language),
    roleGuest: tr('net.roleGuest', language),
  };
}
