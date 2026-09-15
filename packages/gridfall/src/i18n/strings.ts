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
  /**
   * Says explicitly that the second key set is for sharing ONE keyboard.
   *
   * Over the network both players use the P1 keys, because each is alone at their own device and there are no hands
   * to keep apart. Without this line the screen advertises I J K L to a networked guest whose I J K L do nothing —
   * which is exactly what driving two real browser windows turned up.
   */
  'title.networkNote': {
    en: 'Over the network both players use the P1 keys.',
    ko: '네트워크 플레이에서는 두 사람 모두 P1 키를 씁니다.',
  },
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

  /**
   * Connect-panel copy.
   *
   * Says "same network" and nothing more, because that is exactly what host-only ICE reaches. The catalogue used to
   * promise this before it existed; the copy here is written to the transport's real limit rather than to an ambition.
   */
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
  'title.network': { en: 'Press N to play over your network', ko: 'N 키로 네트워크 플레이' },
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

/**
 * The connect panel's copy, gathered for the shared panel.
 *
 * The panel lives in @open-games/shared because both games need it, so it carries no locale of its own and is handed
 * a plain record instead. This function is the seam: the strings stay in this game's table, where the locale tests
 * already check that both languages exist and that placeholders match.
 */
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
