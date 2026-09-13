export type Language = 'en' | 'ko';
export const LANGUAGES: Language[] = ['en', 'ko'];
export interface TrEntry { en: string; ko: string }

export const STRINGS = {
  'brand.name': { en: 'WIREWORK', ko: 'WIREWORK' },
  'title.tagline': { en: 'Arc Guardian Ring Defense', ko: '아크 수호자 방호환 방어전' },
  'title.deploy': { en: 'Deploy', ko: '출격' },
  'title.settings': { en: 'Settings', ko: '설정' },
  'title.hint': { en: 'SPACE Deploy    S Settings    L Language', ko: 'SPACE 출격    S 설정    L 언어' },

  'settings.title': { en: 'SETTINGS', ko: '설정' },
  'settings.master': { en: 'Master', ko: '전체' },
  'settings.sfx': { en: 'SFX', ko: '효과음' },
  'settings.music': { en: 'Music', ko: '음악' },
  'settings.difficulty': { en: 'Difficulty', ko: '난이도' },
  'settings.language': { en: 'Language', ko: '언어' },
  'settings.reducedMotion': { en: 'Reduced motion', ko: '동작 줄이기' },
  'settings.colorMode': { en: 'Color mode', ko: '색각 모드' },
  'settings.deadzone': { en: 'Stick deadzone', ko: '스틱 데드존' },
  'settings.bindings': { en: 'ACTION BINDINGS', ko: '동작 키 설정' },
  'settings.restoreBindings': { en: 'Restore defaults', ko: '기본값 복원' },
  'settings.pressKey': { en: 'PRESS KEY', ko: '키 입력' },
  'settings.bindingConflict': { en: '{action} already uses this key. Swap bindings?', ko: '{action} 동작이 이 키를 사용 중입니다. 서로 바꿀까요?' },
  'settings.bindingIncompatible': { en: 'A pointer binding cannot be moved to this keyboard-only action.', ko: '포인터 바인딩은 키보드 전용 동작으로 옮길 수 없습니다.' },
  'settings.back': { en: 'Back', ko: '뒤로' },
  'settings.decrease': { en: 'Decrease {setting}', ko: '{setting} 줄이기' },
  'settings.increase': { en: 'Increase {setting}', ko: '{setting} 늘리기' },

  'difficulty.relaxed': { en: 'RELAXED', ko: '여유' },
  'difficulty.standard': { en: 'STANDARD', ko: '표준' },
  'difficulty.brutal': { en: 'BRUTAL', ko: '가혹' },
  'language.en': { en: 'English', ko: 'English' },
  'language.ko': { en: '한국어', ko: '한국어' },
  'reduced.system': { en: 'SYSTEM', ko: '시스템' },
  'reduced.on': { en: 'ON', ko: '켜기' },
  'reduced.off': { en: 'OFF', ko: '끄기' },
  'color.default': { en: 'DEFAULT', ko: '기본' },
  'color.deuteranopia': { en: 'DEUTERANOPIA', ko: '녹색약' },
  'color.protanopia': { en: 'PROTANOPIA', ko: '적색약' },
  'color.tritanopia': { en: 'TRITANOPIA', ko: '청색약' },
  'color.high-contrast': { en: 'HIGH CONTRAST', ko: '고대비' },

  'action.moveLeft': { en: 'Move left', ko: '왼쪽 이동' },
  'action.moveRight': { en: 'Move right', ko: '오른쪽 이동' },
  'action.moveUp': { en: 'Move up', ko: '위 이동' },
  'action.moveDown': { en: 'Move down', ko: '아래 이동' },
  'action.dash': { en: 'Dash', ko: '대시' },
  'action.tether': { en: 'Tether', ko: '테더' },
  'action.slash': { en: 'Arc cutter', ko: '아크 절단기' },
  'action.reelIn': { en: 'Reel in', ko: '감기' },
  'action.reelOut': { en: 'Reel out', ko: '풀기' },
  'action.pause': { en: 'Pause', ko: '일시정지' },

  'pause.title': { en: 'PAUSED', ko: '일시정지' },
  'pause.resume': { en: 'Resume', ko: '계속하기' },
  'pause.settings': { en: 'Settings', ko: '설정' },
  'pause.quit': { en: 'Abandon run', ko: '작전 포기' },
  'pause.hint': { en: 'P / ESC to resume', ko: 'P / ESC 로 계속' },
  'abandon.title': { en: 'ABANDON THIS RUN?', ko: '작전을 포기할까요?' },
  'abandon.body': { en: 'Your score will be recorded before returning.', ko: '현재 점수를 기록한 뒤 종료합니다.' },
  'abandon.continue': { en: 'Continue defending', ko: '계속 방어' },
  'abandon.confirm': { en: 'Confirm abandon', ko: '포기 확인' },

  'gameover.victory': { en: 'CENTRAL DISTRICT HELD', ko: '중심구 사수' },
  'gameover.retry': { en: 'Retry', ko: '재도전' },
  'gameover.title': { en: 'Title', ko: '타이틀' },
  'gameover.newRecord': { en: 'NEW RECORD', ko: '새 최고 기록' },
  'gameover.stats': {
    en: 'DIFFICULTY   {difficulty}\nSCORE   {score}  /  BEST   {best}\nWAVES COMPLETED   {waves}\nCITIZENS REMAINING   {saved}\nACTIVE TIME   {time}s\nSEED   {seed}',
    ko: '난이도   {difficulty}\n점수   {score}  /  최고   {best}\n완료 웨이브   {waves}\n생존 시민   {saved}\n활성 시간   {time}초\n시드   {seed}',
  },
  'gameover.keyhint': { en: 'R Retry    SPACE Title', ko: 'R 재도전    SPACE 타이틀' },
  'gameover.reason.hero_dead': { en: 'THE ARC GUARDIAN FELL', ko: '아크 수호자가 쓰러졌다' },
  'gameover.reason.inner_breached': { en: 'INNER RING DESTROYED', ko: '내부 방호환 붕괴' },
  'gameover.reason.citizens_lost': { en: 'ALL RESIDENTS LOST', ko: '시민 전원 상실' },
  'gameover.reason.abandoned': { en: 'RUN ABANDONED', ko: '작전 포기' },
  'storage.unavailable': { en: 'Local storage unavailable — progress kept for this session.', ko: '로컬 저장 불가 — 이번 세션에서는 기록을 유지합니다.' },
  'audio.unavailable': { en: 'Audio is muted until the browser allows playback.', ko: '브라우저가 재생을 허용할 때까지 음소거됩니다.' },

  'hud.hp': { en: 'HP', ko: '체력' },
  'hud.charge': { en: 'CHARGE', ko: '전하' },
  'hud.outer': { en: 'OUTER RING', ko: '외부 방호환' },
  'hud.inner': { en: 'INNER RING', ko: '내부 방호환' },
  'hud.lowHp': { en: 'LOW HP', ko: '체력 위험' },
  'hud.emptyCharge': { en: 'CHARGE EMPTY', ko: '전하 없음' },
  'hud.breach': { en: 'RING BREACH', ko: '방호환 돌파' },
  // The tether is HOLD-to-use: GrappleSystem releases the moment `fireHeld`
  // goes false, so a quick CLICK fires the hook and cancels it on the same
  // frame - it never leaves the player. The old hint said only "L-Click
  // Tether", which read as click-to-fire and made the core mechanic look
  // broken. Say "hold" explicitly, and name the release as the payoff.
  'hud.hint': { en: 'WASD Move  Shift Dash  HOLD L-Click Tether, release to fling  R-Click Arc Cutter  Q/E Reel  P Pause', ko: 'WASD 이동  Shift 대시  좌클릭 길게 눌러 테더, 떼면 발사  우클릭 아크 절단  Q/E 감기  P 일시정지' },
  'hud.wave': { en: 'WAVE {wave} / {total}', ko: '웨이브 {wave} / {total}' },
  'hud.incoming': { en: '{count} MACHINES INBOUND', ko: '침입 기계 {count}기 접근' },
  'hud.status': { en: 'SCORE {score}\nWAVE {wave}/{total}\nCITIZENS {saved}/{citizensTotal}\nTIME {time}s  {input}', ko: '점수 {score}\n웨이브 {wave}/{total}\n시민 {saved}/{citizensTotal}\n시간 {time}초  {input}' },
  'hud.phase.countdown': { en: 'NEXT WAVE', ko: '다음 웨이브' },
  'hud.countdown': { en: 'NEXT WAVE {seconds}s', ko: '다음 웨이브 {seconds}초' },
  'hud.critical': { en: 'CRITICAL', ko: '치명타' },
  'hud.wire': { en: 'WIRE', ko: '테더' },
  // Tether onboarding. Deliberately phrased as two beats (hold, then release)
  // because that is exactly the pair a click misses.
  'tutorial.tetherHold': { en: 'HOLD to tether the ring', ko: '길게 눌러 방호환에 붙어라' },
  'tutorial.tetherRelease': { en: 'Now RELEASE to fling', ko: '이제 떼서 날아라' },
  'tutorial.tetherDone': { en: 'Good. Defend the ring.', ko: '좋다. 방호환을 지켜라.' },
  'tutorial.skip': { en: 'P to skip', ko: 'P 건너뛰기' },
  'hud.phase.spawning': { en: 'SPAWNING', ko: '침입 중' },
  'hud.phase.clearing': { en: 'CLEAR REMAINING MACHINES', ko: '잔존 기계 제거' },
  'hud.phase.done': { en: 'SECURED', ko: '방어 완료' },

  'preload.loading': { en: 'Loading {pct}%', ko: '불러오는 중 {pct}%' },
} satisfies Record<string, TrEntry>;

export type TrKey = keyof typeof STRINGS;
