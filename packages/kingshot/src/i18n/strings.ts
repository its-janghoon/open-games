/**
 * strings.ts - the dependency-free string table for Kingdom Rise's KO/EN i18n.
 *
 * Every user-facing UI string lives here keyed by a compact string-literal
 * union ({@link TrKey}). Each entry carries both an English (`en`) and a
 * natural Korean (`ko`) rendering. The game is KOREAN-FIRST: the runtime
 * defaults to 'ko' (see i18n.ts), so the Korean strings are the primary text.
 * Placeholders use `{name}` syntax and are filled in by {@link tr} from a
 * params record at call time.
 *
 * This module is intentionally pure data + types so it can be imported by both
 * the Phaser scenes and the vitest unit tests with no runtime dependency.
 */

/** Supported UI languages. */
export type Language = 'ko' | 'en';

/** Ordered list of languages the selector cycles through (Korean-first). */
export const LANGUAGES: Language[] = ['ko', 'en'];

/** A single translatable entry: an English and a Korean rendering. */
export interface TrEntry {
  en: string;
  ko: string;
}

/**
 * The full string table. Keys are dotted, grouped by screen/component. The
 * brand name is routed through a key too (proper noun; identical in both
 * languages) so no scene hardcodes even the title.
 */
export const STRINGS = {
  // Brand (proper noun; identical in both languages).
  'brand.name': { en: 'KINGDOM RISE', ko: '킹덤 라이즈' },

  // Title scene.
  'title.tagline': { en: 'Build. Grow. Defend.', ko: '건설하고, 성장하고, 방어하라' },
  'title.play': { en: 'Enter Kingdom', ko: '왕국 입장' },
  'title.continue': { en: 'Continue', ko: '이어하기' },
  'title.newGame': { en: 'New Kingdom', ko: '새 왕국' },
  'title.settings': { en: 'Settings', ko: '설정' },
  'title.hint': { en: 'SPACE Play    S Settings', ko: 'SPACE 시작    S 설정' },

  // Common actions.
  'common.back': { en: 'Back', ko: '뒤로' },
  'common.close': { en: 'Close', ko: '닫기' },
  'common.confirm': { en: 'Confirm', ko: '확인' },
  'common.cancel': { en: 'Cancel', ko: '취소' },

  // Resource labels.
  'resource.food': { en: 'Food', ko: '식량' },
  'resource.wood': { en: 'Wood', ko: '목재' },
  'resource.stone': { en: 'Stone', ko: '석재' },
  'resource.gold': { en: 'Gold', ko: '금화' },
  'resource.perSecond': { en: '{amount}/s', ko: '{amount}/초' },
  'resource.rateGrossNet': { en: '+{gross}/s net {net}/s', ko: '+{gross}/초 순 {net}/초' },
  'a11y.resourceState': {
    en: '{resource} {amount} of {cap}; gross {gross} per second, net {net} per second.',
    ko: '{resource} {amount}/{cap}; 초당 총 {gross}, 순 {net}.',
  },

  // Town scene / HUD.
  'town.title': { en: 'YOUR KINGDOM', ko: '나의 왕국' },
  'town.battle': { en: 'To Battle', ko: '전투로' },
  'town.training': { en: 'Barracks', ko: '병영' },
  'town.settings': { en: 'Settings', ko: '설정' },
  'town.hint': { en: 'Tap a building to upgrade   R Research   H Heroes   Q Quests   B Battle   S Settings', ko: '건물을 눌러 업그레이드   R 연구   H 영웅   Q 임무   B 전투   S 설정' },
  'town.locked': { en: 'Locked', ko: '잠김' },
  'town.buildable': { en: 'Buildable', ko: '건설 가능' },
  'town.lockedReason': {
    en: 'Locked (needs Town Center Lv.{level})',
    ko: '잠김 (중앙 청사 Lv.{level} 필요)',
  },
  'town.woodHint': {
    en: 'Build the Lumber Mill to start producing wood.',
    ko: '제재소를 지어 목재 생산을 시작하세요.',
  },
  'town.defense': { en: 'Town Defense: {value}', ko: '마을 방어력: {value}' },
  // Hearth / Warmth (온기) survival layer.
  'town.warmth': { en: 'Warmth: {pct}%', ko: '온기: {pct}%' },
  'town.warmthDetails': {
    en: 'Warmth {current}/{max} ({pct}%) ×{mult} · wood {fuel}/s · {seconds}s left',
    ko: '온기 {current}/{max} ({pct}%) ×{mult} · 목재 {fuel}/초 · {seconds}초',
  },
  'town.defenseWave': { en: 'Defense {value} · Wave {wave}/{total}', ko: '방어 {value} · 웨이브 {wave}/{total}' },
  'town.warmthLow': { en: 'Hearth dying! Stock wood', ko: '화롯불 꺼져감! 목재 확보' },
  // For a keep with no Lumber Mill, the line above is impossible: it has no way to
  // secure firewood. Townsfolk always gather rations and stone, which the hearth
  // never burns, so the Lumber Mill is always eventually affordable - name it.
  'town.warmthStranded': { en: 'No wood! Build the Lumber Mill', ko: '목재 없음! 제재소를 지으세요' },
  'town.warmthStrandedHint': {
    en: 'The hearth is out of firewood and nothing is making more. Townsfolk still gather rations and stone, so build the Lumber Mill — it costs no firewood — and the supply returns.',
    ko: '화롯불에 땔 목재가 없고 만들 곳도 없습니다. 주민들은 여전히 식량과 석재를 모으니, 목재가 들지 않는 제재소를 지으면 공급이 돌아옵니다.',
  },
  'town.warmthLowHint': {
    en: 'The keep is going cold — production is slowing. Keep enough wood to feed the hearth.',
    ko: '성이 식어 가고 있습니다 — 생산이 느려집니다. 화롯불을 지필 목재를 충분히 확보하세요.',
  },
  'town.saved': { en: 'Saved', ko: '저장됨' },
  'town.onboarding': {
    en: 'Welcome! Your buildings gather resources over time. Tap the Town Center to upgrade it, raise a Farm for food, then train troops at the Barracks and march To Battle.',
    ko: '환영합니다! 건물은 시간이 지날수록 자원을 모읍니다. 중앙 청사를 눌러 업그레이드하고, 농장을 올려 식량을 얻은 뒤, 병영에서 병력을 훈련해 전투로 나아가세요.',
  },
  'town.onboardingDismiss': { en: 'Got it', ko: '알겠어요' },

  // First-run interactive tutorial (coach-mark overlay).
  'tutorial.skip': { en: 'Skip', ko: '건너뛰기' },
  'tutorial.next': { en: 'Next', ko: '다음' },
  'tutorial.welcome': {
    en: 'Welcome, my liege! Grow your kingdom: gather resources, upgrade buildings, train troops, and win battles. This quick tour shows you how.',
    ko: '환영합니다, 폐하! 왕국을 키워 보세요: 자원을 모으고, 건물을 올리고, 병력을 훈련해 전투에서 승리하는 것이 목표입니다. 이 짧은 안내가 방법을 알려 드립니다.',
  },
  'tutorial.selectTownCenter': {
    en: 'This is the Town Center — the heart of your kingdom. Tap it to open its panel.',
    ko: '여기가 중앙 청사입니다 — 왕국의 심장부죠. 눌러서 건물 창을 열어 보세요.',
  },
  'tutorial.upgradeTownCenter': {
    en: 'Press Upgrade to raise the Town Center to Lv.2. Its level caps how far every other building can grow.',
    ko: '업그레이드를 눌러 중앙 청사를 Lv.2로 올리세요. 청사의 레벨이 다른 모든 건물의 성장 한계를 결정합니다.',
  },
  'tutorial.resourcesWarmth': {
    en: 'Nicely done! Buildings gather resources over time — watch the top bar climb. Keep an eye on Warmth (온기): let the hearth die and production slows.',
    ko: '잘하셨어요! 건물은 시간이 지날수록 자원을 모읍니다 — 상단 막대가 오르는 걸 보세요. 온기도 살피세요: 화롯불이 꺼지면 생산이 느려집니다.',
  },
  'tutorial.buildLumberMill': {
    en: 'Build the Lumber Mill for a steady wood income — almost every upgrade needs wood. Tap it on the map, then press Build.',
    ko: '제재소를 지어 목재를 확보하세요. 대부분의 업그레이드에 목재가 필요합니다. 지도에서 제재소를 누른 뒤 짓기를 누르세요.',
  },
  'tutorial.buildAndTrain': {
    en: 'With the Town Center at Lv.2, tap the Barracks on the map to build it. Then open Barracks below and train a troop to raise your army.',
    ko: '중앙 청사가 Lv.2가 되면 지도에서 병영을 눌러 건설하세요. 그 다음 아래의 병영을 열어 병력을 훈련해 군대를 키우세요.',
  },
  'tutorial.battleQuests': {
    en: 'Your army is ready — march To Battle for the payoff! Check Quests (임무) too for goals and rewards. Good luck!',
    ko: '군대가 준비됐습니다 — 전투로 나아가 성과를 거두세요! 임무도 확인해 목표와 보상을 챙기세요. 행운을 빕니다!',
  },
  'settings.replayTutorial': { en: 'Replay Tutorial', ko: '튜토리얼 다시 보기' },

  // Building names.
  'building.town_center': { en: 'Town Center', ko: '중앙 청사' },
  'building.farm': { en: 'Farm', ko: '농장' },
  'building.lumber_mill': { en: 'Lumber Mill', ko: '제재소' },
  'building.quarry': { en: 'Quarry', ko: '채석장' },
  'building.mine': { en: 'Mine', ko: '광산' },
  'building.barracks': { en: 'Barracks', ko: '병영' },
  'building.research': { en: "Scholars' Hall", ko: '연구소' },
  'building.wall': { en: 'Ramparts', ko: '성벽' },
  'building.watchtower': { en: 'Watchtower', ko: '감시탑' },

  // Building descriptions.
  'building.town_center.desc': {
    en: 'The heart of your kingdom. Its level caps how far every other building can be upgraded.',
    ko: '왕국의 심장부. 다른 모든 건물의 업그레이드 한계 레벨을 결정한다.',
  },
  'building.farm.desc': { en: 'Produces food to feed your growing population and army.', ko: '늘어나는 인구와 군대를 먹일 식량을 생산한다.' },
  'building.lumber_mill.desc': { en: 'Fells timber into a steady supply of wood.', ko: '목재를 꾸준히 공급하도록 나무를 벌목한다.' },
  'building.quarry.desc': { en: 'Cuts stone for sturdier structures.', ko: '더 튼튼한 건물을 위한 석재를 캔다.' },
  'building.mine.desc': { en: 'Digs up gold to fund upgrades and troops.', ko: '업그레이드와 병력 자금을 위한 금화를 채굴한다.' },
  'building.barracks.desc': { en: 'Trains troops to defend the kingdom in battle.', ko: '전투에서 왕국을 지킬 병력을 훈련한다.' },
  'building.research.desc': {
    en: 'Houses your scholars. Its level unlocks higher tiers of the tech tree, empowering your economy and army.',
    ko: '학자들이 머무는 곳. 레벨이 오를수록 기술 트리의 상위 단계를 개방해 경제와 군대를 강화한다.',
  },
  'building.wall.desc': {
    en: 'A stone curtain wall. Each level adds a large block of town defense, helping you hold raids and softening any loss.',
    ko: '돌로 쌓은 성벽. 레벨마다 마을 방어력을 크게 더해, 침략을 막아 내고 패배의 피해도 줄여 준다.',
  },
  'building.watchtower.desc': {
    en: "Archers' towers that pick off attackers. A second, stacking source of town defense.",
    ko: '공격자를 저격하는 궁수의 탑. 마을 방어력을 더해 주는 두 번째 방어 수단.',
  },

  // Building panel UI.
  'building.level': { en: 'Level {level}', ko: '레벨 {level}' },
  'building.maxLevel': { en: 'MAX LEVEL', ko: '최대 레벨' },
  'building.upgrade': { en: 'Upgrade', ko: '업그레이드' },
  'building.build': { en: 'Build', ko: '짓기' },
  'building.upgradeTo': { en: 'Upgrade to Lv.{level}', ko: 'Lv.{level} 업그레이드' },
  'building.upgrading': { en: 'Upgrading… {seconds}s', ko: '업그레이드 중… {seconds}초' },
  'building.output': { en: 'Output: {amount}/s', ko: '생산량: {amount}/초' },
  'building.lockedByTownCenter': {
    en: 'Raise the Town Center to Lv.{level} first',
    ko: '먼저 중앙 청사를 Lv.{level}(으)로 올리세요',
  },
  'building.insufficient': { en: 'Not enough resources', ko: '자원이 부족합니다' },

  // Troop names.
  'troop.spearman': { en: 'Spearman', ko: '창병' },
  'troop.archer': { en: 'Archer', ko: '궁병' },
  'troop.knight': { en: 'Knight', ko: '기사' },
  'troop.cavalry': { en: 'Cavalry', ko: '기병' },
  'troop.siege': { en: 'Siege Engine', ko: '공성 병기' },

  // Troop descriptions.
  'troop.spearman.desc': { en: 'Cheap, sturdy front-line infantry.', ko: '저렴하고 튼튼한 최전선 보병.' },
  'troop.archer.desc': { en: 'Ranged damage from behind the line.', ko: '전열 뒤에서 원거리 피해를 준다.' },
  'troop.knight.desc': { en: 'Elite heavy cavalry with high health.', ko: '높은 체력을 지닌 정예 중기병.' },
  'troop.cavalry.desc': { en: 'Fast flanker that runs down archers and siege.', ko: '궁병과 공성 병기를 덮치는 빠른 측면 기동병.' },
  'troop.siege.desc': { en: 'Slow anti-armour engine that crushes heavy units.', ko: '중장갑 유닛을 짓밟는 느린 대장갑 공성 병기.' },

  // Training UI.
  'training.title': { en: 'TRAINING', ko: '병력 훈련' },
  'training.queue': { en: 'Queue', ko: '대기열' },
  'training.train': { en: 'Train', ko: '훈련' },
  'training.trainCount': { en: 'Train {count}', ko: '{count}명 훈련' },
  'training.inProgress': { en: 'Training {count} {troop}… {seconds}s', ko: '{troop} {count}명 훈련 중… {seconds}초' },
  'training.queueFull': { en: 'Training queue is full', ko: '훈련 대기열이 가득 찼습니다' },
  'training.army': { en: 'Army: {count}', ko: '병력: {count}' },
  'training.standing': { en: 'Standing Army', ko: '보유 병력' },
  'training.queueEmpty': { en: 'No troops in training', ko: '훈련 중인 병력 없음' },
  'training.queueItem': { en: '{count} {troop} — {seconds}s', ko: '{troop} {count}명 — {seconds}초' },
  'training.noBarracks': { en: 'Build a Barracks to train troops', ko: '병력 훈련하려면 병영을 지으세요' },
  'training.noBarracksHint': {
    en: 'Build a Barracks first (requires Town Center Lv.2)',
    ko: '먼저 병영을 지으세요 (타운 센터 Lv.2 필요)',
  },
  'training.notEnough': { en: 'Not enough resources', ko: '자원 부족' },
  'training.cost': { en: 'Cost {cost}', ko: '비용 {cost}' },
  'training.time': { en: '{seconds}s each', ko: '개당 {seconds}초' },

  // Research / tech-tree UI.
  'research.title': { en: 'RESEARCH', ko: '연구' },
  'town.research': { en: 'Research', ko: '연구' },
  'research.branch.military': { en: 'Military', ko: '군사' },
  'research.branch.economic': { en: 'Economy', ko: '경제' },
  'research.unlock': { en: 'Research', ko: '연구' },
  'research.unlocked': { en: 'Unlocked', ko: '연구 완료' },
  'research.researching': { en: 'Researching… {seconds}s', ko: '연구 중… {seconds}초' },
  'research.tier': { en: 'Tier {tier}', ko: '{tier}단계' },
  'research.cost': { en: 'Cost {cost}', ko: '비용 {cost}' },
  'research.time': { en: 'Time {seconds}s', ko: '시간 {seconds}초' },
  'research.active': { en: 'Researching {name} — {seconds}s', ko: '{name} 연구 중 — {seconds}초' },
  'research.idle': { en: 'No research in progress', ko: '진행 중인 연구 없음' },
  'research.noBuildingHint': {
    en: "Build a Scholars' Hall first (requires Town Center Lv.3)",
    ko: '먼저 연구소를 지으세요 (중앙 청사 Lv.3 필요)',
  },
  // Distinct locked-reason messages.
  'research.locked.building': { en: "Requires Scholars' Hall Lv.{level}", ko: '연구소 레벨 {level} 필요' },
  'research.locked.prereq': { en: 'Requires prior research', ko: '선행 연구 필요' },
  'research.locked.cost': { en: 'Not enough resources', ko: '자원 부족' },
  'research.locked.busy': { en: 'Research in progress', ko: '연구 진행 중' },
  'research.locked.already': { en: 'Already unlocked', ko: '이미 연구됨' },

  // Tech names.
  'tech.sharpened_blades': { en: 'Sharpened Blades', ko: '날 세우기' },
  'tech.forged_weapons': { en: 'Forged Weapons', ko: '단조 무기' },
  'tech.masterwork_arms': { en: 'Masterwork Arms', ko: '명장의 무구' },
  'tech.hardened_armor': { en: 'Hardened Armor', ko: '강화 갑옷' },
  'tech.tempered_plate': { en: 'Tempered Plate', ko: '담금질 판금' },
  'tech.drill_grounds': { en: 'Drill Grounds', ko: '훈련장' },
  'tech.veteran_cadre': { en: 'Veteran Cadre', ko: '정예 교관단' },
  'tech.crop_rotation': { en: 'Crop Rotation', ko: '윤작법' },
  'tech.guild_charters': { en: 'Guild Charters', ko: '길드 인가장' },
  'tech.grand_markets': { en: 'Grand Markets', ko: '대시장' },
  'tech.reinforced_stores': { en: 'Reinforced Stores', ko: '보강 창고' },
  'tech.great_granaries': { en: 'Great Granaries', ko: '대곡창' },
  'tech.scaffolding': { en: 'Scaffolding', ko: '비계 공법' },
  'tech.master_masons': { en: 'Master Masons', ko: '석공 장인' },
  'tech.ledger_keeping': { en: 'Ledger Keeping', ko: '장부 관리' },

  // Tech descriptions.
  'tech.sharpened_blades.desc': { en: '+10% troop attack in battle.', ko: '전투 시 병력 공격력 +10%.' },
  'tech.forged_weapons.desc': { en: '+15% troop attack in battle.', ko: '전투 시 병력 공격력 +15%.' },
  'tech.masterwork_arms.desc': { en: '+20% troop attack in battle.', ko: '전투 시 병력 공격력 +20%.' },
  'tech.hardened_armor.desc': { en: 'Take ~10% fewer casualties on a win.', ko: '승리 시 전사자 약 10% 감소.' },
  'tech.tempered_plate.desc': { en: 'Take ~15% fewer casualties on a win.', ko: '승리 시 전사자 약 15% 감소.' },
  'tech.drill_grounds.desc': { en: 'Train troops 10% faster.', ko: '병력 훈련 속도 10% 향상.' },
  'tech.veteran_cadre.desc': { en: 'Train troops 15% faster.', ko: '병력 훈련 속도 15% 향상.' },
  'tech.crop_rotation.desc': { en: '+10% resource production.', ko: '자원 생산량 +10%.' },
  'tech.guild_charters.desc': { en: '+15% resource production.', ko: '자원 생산량 +15%.' },
  'tech.grand_markets.desc': { en: '+20% resource production.', ko: '자원 생산량 +20%.' },
  'tech.reinforced_stores.desc': { en: '+50% storage capacity.', ko: '저장 한계 +50%.' },
  'tech.great_granaries.desc': { en: 'Double storage capacity.', ko: '저장 한계 2배.' },
  'tech.scaffolding.desc': { en: 'Building upgrades 10% faster.', ko: '건물 업그레이드 속도 10% 향상.' },
  'tech.master_masons.desc': { en: 'Building upgrades 15% faster.', ko: '건물 업그레이드 속도 15% 향상.' },
  'tech.ledger_keeping.desc': { en: '+25% offline production efficiency.', ko: '오프라인 생산 효율 +25%.' },

  // Heroes UI.
  'town.heroes': { en: 'Heroes', ko: '영웅' },
  'hero.title': { en: 'HEROES', ko: '영웅' },
  'hero.role.war': { en: 'War', ko: '전쟁' },
  'hero.role.economy': { en: 'Economy', ko: '경제' },
  'hero.recruit': { en: 'Recruit', ko: '영입' },
  'hero.recruited': { en: 'Recruited', ko: '영입 완료' },
  'hero.recruitCost': { en: 'Recruit {cost}', ko: '영입 {cost}' },
  'hero.levelUp': { en: 'Level Up', ko: '레벨 업' },
  'hero.levelUpCost': { en: 'Lv Up {cost}', ko: '레벨 업 {cost}' },
  'hero.starUp': { en: 'Star Up', ko: '승급' },
  'hero.starUpCost': { en: 'Star ({shards} shards)', ko: '승급 (조각 {shards})' },
  'hero.setActive': { en: 'Set Active', ko: '출전 지정' },
  'hero.active': { en: 'Active', ko: '출전 중' },
  'hero.maxLevel': { en: 'Max Level', ko: '최대 레벨' },
  'hero.maxStars': { en: 'Max Stars', ko: '최대 성급' },
  'hero.levelStars': { en: 'Lv.{level}/{max}  {stars}', ko: 'Lv.{level}/{max}  {stars}' },
  'hero.shards': { en: 'Shards: {shards} (need {per})', ko: '조각: {shards} (승급 {per} 필요)' },
  'hero.walletShortfall': { en: 'Shards {shards} · next star short {shortfall}', ko: '조각 {shards} · 다음 승급 부족 {shortfall}' },
  'hero.patronage': { en: 'Royal Patronage', ko: '왕실 후원' },
  'hero.patronageCost': { en: '+1 shard {cost}', ko: '조각 +1 {cost}' },
  'hero.patronageResource': {
    en: '{resource} {have}/{need} (short {shortfall})',
    ko: '{resource} {have}/{need} (부족 {shortfall})',
  },
  'hero.noneActive': { en: 'No hero active — recruit and set one to gain a bonus', ko: '출전 영웅 없음 — 영입 후 지정하면 보너스를 얻습니다' },
  'hero.activeBonus': { en: 'Active: {name} — {domain} +{pct}%', ko: '출전: {name} — {domain} +{pct}%' },
  'hero.bonus.combat': { en: 'Army Power', ko: '병력 전투력' },
  'hero.bonus.economy': { en: 'Production', ko: '생산량' },
  // Distinct locked-reason messages.
  'hero.locked.already': { en: 'Already recruited', ko: '이미 보유' },
  'hero.locked.cost': { en: 'Not enough resources', ko: '자원 부족' },
  'hero.locked.shards': { en: 'Not enough shards', ko: '조각 부족' },
  'hero.locked.maxLevel': { en: 'Already maxed', ko: '이미 최대치' },
  'hero.locked.notRecruited': { en: 'Recruit this hero first', ko: '먼저 영웅을 영입하세요' },

  // Hero names.
  'hero.ser_alden': { en: 'Ser Alden', ko: '알덴 경' },
  'hero.kara_stormblade': { en: 'Kara Stormblade', ko: '카라 스톰블레이드' },
  'hero.mira_goldhand': { en: 'Mira Goldhand', ko: '미라 골드핸드' },
  'hero.old_bram': { en: 'Old Bram', ko: '노인 브램' },

  // Hero descriptions.
  'hero.ser_alden.desc': {
    en: 'A steadfast knight-commander whose discipline steels the whole army.',
    ko: '규율로 전군을 단련시키는 굳건한 기사단장.',
  },
  'hero.kara_stormblade.desc': {
    en: 'A ferocious cavalry captain who turns any charge into a rout.',
    ko: '어떤 돌격도 궤멸로 바꾸는 사나운 기병 대장.',
  },
  'hero.mira_goldhand.desc': {
    en: 'A shrewd guildmistress whose ledgers squeeze more from every mine and field.',
    ko: '광산과 밭에서 더 많은 것을 짜내는 영리한 길드장.',
  },
  'hero.old_bram.desc': {
    en: 'A patient master farmer whose methods swell every harvest.',
    ko: '모든 수확을 불려 주는 노련한 농사 장인.',
  },

  // Quests UI.
  'town.quests': { en: 'Quests', ko: '임무' },
  'quest.title': { en: 'QUESTS', ko: '임무' },
  'quest.progress': { en: 'Progress: {have} / {need}', ko: '진행도: {have} / {need}' },
  'quest.reward': { en: 'Reward: {reward}', ko: '보상: {reward}' },
  'quest.rewardShards': { en: '{shards} {hero} shards', ko: '{hero} 조각 {shards}개' },
  'quest.claim': { en: 'Claim', ko: '수령' },
  'quest.claimed': { en: 'Claimed', ko: '수령 완료' },
  'quest.locked': { en: 'Locked', ko: '잠김' },
  'quest.lockedHint': { en: 'Complete the previous quest first', ko: '이전 임무를 먼저 완료하세요' },
  'quest.inProgress': { en: 'In progress', ko: '진행 중' },
  'quest.allDone': { en: 'All quests complete — well played!', ko: '모든 임무 완료 — 훌륭합니다!' },
  'quest.summary': { en: 'Claimed {claimed} / {total}', ko: '수령 {claimed} / {total}' },

  // Quest descriptions.
  'quest.secure_the_timber': { en: 'Secure the Timber', ko: '목재 확보' },
  'quest.secure_the_timber.desc': {
    en: 'Build the Lumber Mill to start a wood income — most upgrades need wood.',
    ko: '제재소를 지어 목재 수입을 시작하세요 — 대부분의 업그레이드에 목재가 필요합니다.',
  },
  'quest.raise_a_farm': { en: 'Raise a Farm', ko: '농장 짓기' },
  'quest.raise_a_farm.desc': { en: 'Build a Farm to feed your kingdom.', ko: '왕국을 먹일 농장을 지으세요.' },
  'quest.grow_the_center': { en: 'Grow the Capital', ko: '수도 성장' },
  'quest.grow_the_center.desc': { en: 'Raise the Town Center to Level 3.', ko: '중앙 청사를 레벨 3까지 올리세요.' },
  'quest.first_recruits': { en: 'First Recruits', ko: '첫 신병' },
  'quest.first_recruits.desc': { en: 'Train 10 troops at the Barracks.', ko: '병영에서 병력 10명을 훈련하세요.' },
  'quest.found_the_hall': { en: "Found the Scholars' Hall", ko: '연구소 설립' },
  'quest.found_the_hall.desc': { en: "Build the Scholars' Hall to begin research.", ko: '연구를 시작하려면 연구소를 지으세요.' },
  'quest.first_research': { en: 'First Discovery', ko: '첫 연구' },
  'quest.first_research.desc': { en: 'Unlock your first technology.', ko: '첫 번째 기술을 연구하세요.' },
  'quest.muster_an_army': { en: 'Muster an Army', ko: '군대 소집' },
  'quest.muster_an_army.desc': { en: 'Train 30 troops in total.', ko: '누적 병력 30명을 훈련하세요.' },
  'quest.repel_the_raiders': { en: 'Repel the Raiders', ko: '침략자 격퇴' },
  'quest.repel_the_raiders.desc': { en: 'Win 5 battles.', ko: '전투에서 5번 승리하세요.' },
  'quest.hold_the_line': { en: 'Hold the Line', ko: '전선 사수' },
  'quest.hold_the_line.desc': { en: 'Unlock 3 technologies.', ko: '기술 3가지를 연구하세요.' },

  // Combat / battle UI.
  'battle.title': { en: 'BATTLE', ko: '전투' },
  'battle.prepare': { en: 'Prepare! Wave in {seconds}s', ko: '준비! {seconds}초 후 웨이브' },
  'battle.wave': { en: 'WAVE {wave} / {total}', ko: '웨이브 {wave} / {total}' },
  'battle.deploy': { en: 'Deploy Troops', ko: '병력 배치' },
  'battle.start': { en: 'Start Battle', ko: '전투 시작' },
  'battle.retreat': { en: 'Retreat', ko: '후퇴' },
  'battle.gateHp': { en: 'Gate {hp}/{max}', ko: '성문 {hp}/{max}' },
  'battle.incoming': { en: '{count} raiders incoming', ko: '침략자 {count}명 접근 중' },
  'battle.noTroops': { en: 'Train troops before battle', ko: '전투 전에 병력을 훈련하세요' },
  'battle.comingSoon': { en: 'The battlefield awaits…', ko: '전장이 당신을 기다립니다…' },
  'battle.skip': { en: 'Skip', ko: '건너뛰기' },
  'battle.speed': { en: 'Speed x{mult}', ko: '속도 x{mult}' },
  'battle.armyRemaining': { en: 'Army', ko: '병력' },
  'battle.enemyRemaining': { en: 'Raiders', ko: '침략자' },
  'battle.clash': { en: 'The armies clash!', ko: '양군이 충돌합니다!' },
  'battle.preflightTitle': { en: 'BATTLE PREFLIGHT', ko: '출정 전 확인' },
  'battle.preflightWave': { en: 'Target: Wave {wave}/{total}', ko: '목표: 웨이브 {wave}/{total}' },
  'battle.preflightArmy': { en: 'Army: {count} · effective power E={power}', ko: '아군: {count}명 · 유효 전투력 E={power}' },
  'battle.preflightEnemy': { en: 'Enemy W={power}: {composition}', ko: '적 전투력 W={power}: {composition}' },
  'battle.preflightDefense': { en: 'Town defense contribution D={defense}', ko: '마을 방어 기여 D={defense}' },
  'battle.matchupWarning': { en: '⚠ Current matchup is projected to lose.', ko: '⚠ 현재 상성으로는 패배가 예상됩니다.' },
  'battle.ready': { en: '✓ The army is projected to hold.', ko: '✓ 현재 병력으로 방어가 예상됩니다.' },
  'battle.replayNotice': { en: 'REPLAY · no rewards · state preserved', ko: '리플레이 · 보상 없음 · 상태 보존' },
  'battle.confirmDeploy': { en: 'Commit & Deploy', ko: '결과 저장 후 출정' },
  'battle.noTroopsWithShortcut': { en: 'Train troops first. Close and open Barracks.', ko: '병력을 먼저 훈련하세요. 닫고 병영을 여세요.' },
  'battle.saveFailed': { en: 'Save failed. Battle rolled back; retry when storage is available.', ko: '저장 실패. 전투가 롤백되었습니다. 저장소 확인 후 재시도하세요.' },
  'battle.cannotStart': { en: 'Battle cannot start from the current state.', ko: '현재 상태에서는 전투를 시작할 수 없습니다.' },

  // Enemy names.
  'enemy.raider': { en: 'Raider', ko: '침략자' },
  'enemy.brute': { en: 'Brute', ko: '광전사' },
  'enemy.ram': { en: 'Battering Ram', ko: '공성 망치' },
  'enemy.rider': { en: 'Rider', ko: '기습병' },

  // Settings scene.
  'settings.title': { en: 'SETTINGS', ko: '설정' },
  'settings.master': { en: 'Master', ko: '전체' },
  'settings.sfx': { en: 'SFX', ko: '효과음' },
  'settings.music': { en: 'Music', ko: '음악' },
  'settings.language': { en: 'Language', ko: '언어' },
  'settings.reset': { en: 'Reset Progress', ko: '진행 초기화' },
  'settings.resetConfirm': { en: 'Erase all progress?', ko: '모든 진행을 지울까요?' },
  'settings.back': { en: 'Back', ko: '뒤로' },

  // Language values (each shown in its own language).
  'language.en': { en: 'English', ko: 'English' },
  'language.ko': { en: '한국어', ko: '한국어' },

  // Pause scene.
  'pause.title': { en: 'PAUSED', ko: '일시정지' },
  'pause.resume': { en: 'Resume', ko: '계속하기' },
  'pause.settings': { en: 'Settings', ko: '설정' },
  'pause.quit': { en: 'Quit to Town', ko: '마을로 나가기' },
  'pause.hint': { en: 'P / ESC to resume', ko: 'P / ESC 로 계속' },

  // Save / load feedback.
  'save.saved': { en: 'Saved', ko: '저장됨' },
  'save.loaded': { en: 'Progress loaded', ko: '진행 불러옴' },
  'save.offlineGains': {
    en: 'While away you gathered {food} food, {wood} wood, {stone} stone, {gold} gold.',
    ko: '자리를 비운 동안 식량 {food}, 목재 {wood}, 석재 {stone}, 금화 {gold}를 모았습니다.',
  },
  'save.offlineSummary': {
    en: 'Away {seconds}s · +{food} food, +{wood} wood, +{stone} stone, +{gold} gold · warmth {warmth} · buildings {buildings}, research {research}, troops {trained}',
    ko: '부재 {seconds}초 · 식량 +{food}, 목재 +{wood}, 석재 +{stone}, 금화 +{gold} · 온기 {warmth} · 건설 {buildings}, 연구 {research}, 훈련 {trained}',
  },
  'save.failed': { en: 'Save failed', ko: '저장 실패' },
  'save.failedRetry': { en: 'Save failed · tap to retry', ko: '저장 실패 · 눌러 재시도' },
  'save.dirty': { en: 'Saving…', ko: '저장 중…' },
  'save.recoveryNeeded': { en: 'The saved kingdom is damaged or from a newer version. Export it before starting fresh.', ko: '저장된 왕국이 손상되었거나 더 새 버전입니다. 새로 시작하기 전에 백업을 내보내세요.' },
  'save.exportBackup': { en: 'Export Backup', ko: '백업 내보내기' },
  'save.startFresh': { en: 'Start New Kingdom', ko: '새 왕국 시작' },
  'save.reset': { en: 'Progress reset', ko: '진행이 초기화되었습니다' },
  'status.completions': {
    en: 'Completed: {buildings} buildings, {research} research, {trained} troops.',
    ko: '완료: 건설 {buildings}, 연구 {research}, 훈련 {trained}.',
  },

  // Game over / result scene.
  'result.victory': { en: 'VICTORY', ko: '승리' },
  'result.defeat': { en: 'DEFEAT', ko: '패배' },
  'result.fullVictory': { en: 'KINGDOM TRIUMPHANT', ko: '왕국의 승리' },
  'result.fullVictoryDesc': {
    en: 'Every wave repelled. Your kingdom stands unbroken!',
    ko: '모든 웨이브를 물리쳤습니다. 왕국은 무너지지 않았습니다!',
  },
  'result.wavesCleared': { en: 'Waves cleared: {waves}', ko: '격파한 웨이브: {waves}' },
  'result.reward': { en: 'Reward: {gold} gold', ko: '보상: 금화 {gold}' },
  'result.rewardLine': { en: '+{food} food  +{wood} wood  +{stone} stone  +{gold} gold', ko: '+{food} 식량  +{wood} 목재  +{stone} 석재  +{gold} 금화' },
  'result.casualties': { en: 'Casualties: {count}', ko: '전사자: {count}' },
  'result.survivors': { en: 'Survivors: {count}', ko: '생존자: {count}' },
  'result.powerLine': { en: 'Effective power E={army} / enemy W={enemy}', ko: '유효 전투력 E={army} / 적 W={enemy}' },
  'result.multiplierLine': { en: 'Attack ×{attack} · casualty defense ×{defense} · town D={town}', ko: '공격 ×{attack} · 사상 방어 ×{defense} · 마을 D={town}' },
  'result.stackLine': { en: '{troop}: deployed {deployed}, lost {lost}, survived {survived}, matchup power {power}', ko: '{troop}: 투입 {deployed}, 전사 {lost}, 생존 {survived}, 상성 기여 {power}' },
  'result.penaltyLine': { en: 'Looted: -{food} food  -{wood} wood  -{stone} stone  -{gold} gold', ko: '약탈: 식량 -{food}  목재 -{wood}  석재 -{stone}  금화 -{gold}' },
  'result.replayNotice': { en: 'REPLAY · no reward or loot · all state preserved', ko: '리플레이 · 보상/약탈 없음 · 모든 상태 보존' },
  'result.replayAgain': { en: 'Replay Again', ko: '다시 리플레이' },
  'result.nextWave': { en: 'Next wave: {wave}', ko: '다음 웨이브: {wave}' },
  'result.defeatDesc': { en: 'Your army fell, but the town still stands. Regroup and try again.', ko: '병력은 쓰러졌지만 마을은 건재합니다. 전열을 재정비하세요.' },
  'result.retry': { en: 'Retry', ko: '재도전' },
  'result.train': { en: 'Train Troops', ko: '병력 훈련' },
  'result.toTown': { en: 'To Town', ko: '마을로' },
  'result.keyhint': { en: 'R Retry    SPACE Town', ko: 'R 재도전    SPACE 마을' },
  'result.keyhintNoRetry': { en: 'SPACE Town', ko: 'SPACE 마을' },

  // Tooltips.
  'tooltip.cost': { en: 'Cost: {cost}', ko: '비용: {cost}' },
  'tooltip.time': { en: 'Time: {seconds}s', ko: '시간: {seconds}초' },

  // Preload scene.
  'preload.loading': { en: 'Loading {pct}%', ko: '불러오는 중 {pct}%' },
} satisfies Record<string, TrEntry>;

/** The set of valid translation keys, derived from {@link STRINGS}. */
export type TrKey = keyof typeof STRINGS;
