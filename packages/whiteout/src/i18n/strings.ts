/**
 * strings.ts - the dependency-free string table for Frosthold: Last Ember's
 * KO/EN i18n.
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
  // Brand (proper noun; the full title where space allows).
  'brand.name': { en: 'FROSTHOLD', ko: '서리성채' },

  // Title scene.
  'title.tagline': { en: 'Keep the Ember burning.', ko: '불씨를 꺼뜨리지 마라' },
  'title.play': { en: 'Enter the Hold', ko: '성채 입장' },
  'title.continue': { en: 'Continue', ko: '이어하기' },
  'title.newGame': { en: 'New Hold', ko: '새 성채' },
  'title.settings': { en: 'Settings', ko: '설정' },
  'title.hint': { en: 'SPACE Play    S Settings', ko: 'SPACE 시작    S 설정' },

  // Common actions.
  'common.back': { en: 'Back', ko: '뒤로' },
  'common.close': { en: 'Close', ko: '닫기' },
  'common.confirm': { en: 'Confirm', ko: '확인' },
  'common.cancel': { en: 'Cancel', ko: '취소' },

  // Resource labels.
  'resource.food': { en: 'Rations', ko: '식량' },
  'resource.wood': { en: 'Timber', ko: '목재' },
  'resource.coal': { en: 'Coal', ko: '석탄' },
  'resource.iron': { en: 'Iron', ko: '철' },
  'resource.steel': { en: 'Steel', ko: '강철' },
  'resource.perSecond': { en: '{amount}/s', ko: '{amount}/초' },

  // Premium currency (Ember Sparks) + survivor population labels.
  'premium.emberSparks': { en: 'Ember Sparks', ko: '불씨 정수' },
  'population.label': { en: 'Survivors', ko: '생존자' },
  'population.value': { en: '{total}/{cap}', ko: '{total}/{cap}' },
  'population.assigned': { en: 'Working {assigned} · Idle {idle}', ko: '작업 {assigned} · 대기 {idle}' },
  'population.satisfaction': { en: 'Morale {pct}%', ko: '사기 {pct}%' },
  // Survivor workforce panel (assign / recruit / recall).
  'population.title': { en: 'SURVIVORS', ko: '생존자 관리' },
  'population.recruit': { en: 'Recruit', ko: '모집' },
  'population.recallAll': { en: 'Recall All', ko: '전원 해제' },
  'population.workforceOutput': { en: 'Workforce output {pct}%', ko: '노동 생산 {pct}%' },
  'nav.population': { en: 'Survivors', ko: '생존자' },

  // Town scene / HUD.
  'town.title': { en: 'YOUR HOLD', ko: '나의 성채' },
  'town.battle': { en: 'To Battle', ko: '전투로' },
  'town.training': { en: 'War Camp', ko: '전진 기지' },
  'town.settings': { en: 'Settings', ko: '설정' },
  'town.hint': { en: 'Tap a building to upgrade   B Battle   S Settings', ko: '건물을 눌러 업그레이드   B 전투   S 설정' },
  'town.locked': { en: 'Locked', ko: '잠김' },
  'town.saved': { en: 'Saved', ko: '저장됨' },
  'town.onboarding': {
    en: 'The long winter has come. Your buildings gather resources over time. Tap the Furnace to upgrade it and keep the Ember alive, raise a Hunters\u2019 Hut for rations, then train survivors at the War Camp and march To Battle.',
    ko: '기나긴 겨울이 찾아왔습니다. 건물은 시간이 지날수록 자원을 모읍니다. 용광로를 눌러 업그레이드하고 불씨를 지키세요. 사냥꾼 오두막을 올려 식량을 얻은 뒤, 전진 기지에서 생존자를 훈련해 전투로 나아가세요.',
  },
  'town.onboardingDismiss': { en: 'Got it', ko: '알겠어요' },
  // Locked building label that names the unlock requirement instead of a bare
  // 'Locked' (FEAT-003 guidance pass).
  'town.lockedRequires': { en: 'Furnace Lv.{level} required', ko: '용광로 Lv.{level} 필요' },
  // Short form for the overhead map badge, where the full sentence is wide
  // enough to collide with the badges of neighbouring buildings. The long form
  // above is still used in the upgrade panel, which has room for it.
  'town.lockedRequiresShort': { en: 'Needs Lv.{level}', ko: 'Lv.{level} 필요' },

  // --- FEAT-003: new-player objective / guidance flow ---
  // A SHORT first-run welcome that hands off to the guided objective flow
  // (pointer + banner) instead of a wall of text.
  'town.welcome': {
    en: 'Welcome, Warden. Follow the glowing marker to your next task.',
    ko: '어서 오세요, 파수꾼님. 빛나는 표시를 따라 다음 할 일을 진행하세요.',
  },
  'town.welcomeStart': { en: 'Begin', ko: '시작하기' },
  // The persistent next-step objective banner.
  'objective.title': { en: 'Next Objective', ko: '다음 목표' },
  'objective.skip': { en: 'Skip', ko: '건너뛰기' },
  'objective.furnace.label': { en: 'Raise the Furnace', ko: '용광로 올리기' },
  'objective.furnace.instruction': {
    en: 'Tap the Furnace and upgrade it to raise the level cap of every building.',
    ko: '용광로를 눌러 업그레이드하세요. 모든 건물의 한계 레벨이 올라갑니다.',
  },
  'objective.hunters.label': { en: 'Build the Hunters\u2019 Hut', ko: '사냥꾼 오두막 짓기' },
  'objective.hunters.instruction': {
    en: 'Tap the Hunters\u2019 Hut to build it and gather rations.',
    ko: '사냥꾼 오두막을 눌러 지어 식량을 모으세요.',
  },
  'objective.sawmill.label': { en: 'Build the Sawmill', ko: '벌목장 짓기' },
  'objective.sawmill.instruction': {
    en: 'Tap the Sawmill to build it and gather timber.',
    ko: '벌목장을 눌러 지어 목재를 모으세요.',
  },
  'objective.furnace2.label': { en: 'Raise the Furnace again', ko: '용광로 다시 올리기' },
  'objective.furnace2.instruction': {
    en: 'Upgrade the Furnace again to unlock the War Camp and more buildings.',
    ko: '용광로를 다시 올려 전진 기지와 더 많은 건물을 해금하세요.',
  },
  'objective.warcamp.label': { en: 'Build the War Camp', ko: '전진 기지 짓기' },
  'objective.warcamp.instruction': {
    en: 'Tap the War Camp to build it so you can train soldiers.',
    ko: '전진 기지를 눌러 지어 병력을 훈련할 수 있게 하세요.',
  },
  'objective.train.label': { en: 'Train soldiers', ko: '병력 훈련' },
  'objective.train.instruction': {
    en: 'Open the War Camp and train a batch of soldiers for battle.',
    ko: '전진 기지를 열어 전투에 나설 병력을 훈련하세요.',
  },
  'objective.battle.label': { en: 'March to battle', ko: '전투로 진군' },
  'objective.battle.instruction': {
    en: 'Press To Battle to lead your soldiers against the Frozen Horde.',
    ko: '전투로 버튼을 눌러 병력을 이끌고 서리 무리에 맞서세요.',
  },
  'objective.warmth.label': { en: 'Keep warm!', ko: '온기를 지키세요!' },
  'objective.warmth.instruction': {
    en: 'Warmth is low. Keep timber and coal stocked and upgrade the Furnace to burn fuel more efficiently.',
    ko: '온기가 낮습니다. 목재와 석탄을 채워 두고 용광로를 올려 연료를 더 효율적으로 태우세요.',
  },
  // For a hold with no timber producer, the advice above is impossible: every part
  // of it needs timber. Survivors always forage rations, which the Furnace never
  // burns, so the Sawmill is always eventually affordable - name it.
  'objective.stranded.label': { en: 'Out of timber', ko: '목재가 없습니다' },
  'objective.stranded.instruction': {
    en: 'No timber and nothing making it. Survivors still forage rations, so build the Sawmill — it costs rations only — and timber will start flowing again.',
    ko: '목재가 없고 만들 곳도 없습니다. 생존자들은 여전히 식량을 채집하니, 식량만 드는 제재소를 지으면 목재가 다시 들어옵니다.',
  },

  // Warmth (the signature frozen-survival mechanic).
  'warmth.label': { en: 'Warmth', ko: '온기' },
  'warmth.value': { en: '{warmth}/{max}', ko: '{warmth}/{max}' },
  'warmth.output': { en: 'Output {pct}%', ko: '생산 효율 {pct}%' },
  'warmth.freezing': { en: 'FREEZING!', ko: '혹한 경고!' },
  'warmth.fuelBurn': { en: 'Fuel: {wood} timber + {coal} coal /s', ko: '연료: 목재 {wood} + 석탄 {coal} /초' },
  'warmth.furnaceInfo': { en: 'Warmth {warmth}/{max}', ko: '온기 {warmth}/{max}' },

  // Building names.
  'building.furnace': { en: 'Furnace', ko: '용광로' },
  'building.hunters_hut': { en: 'Hunters\u2019 Hut', ko: '사냥꾼 오두막' },
  'building.sawmill': { en: 'Sawmill', ko: '벌목장' },
  'building.coal_pit': { en: 'Coal Pit', ko: '탄광' },
  'building.iron_mine': { en: 'Iron Mine', ko: '철광산' },
  'building.war_camp': { en: 'War Camp', ko: '전진 기지' },
  'building.shelter_row': { en: 'Shelter Row', ko: '피난 거처' },
  'building.frost_vault': { en: 'Frost Vault', ko: '서리 금고' },
  'building.forge_hall': { en: 'Forge Hall', ko: '제련장' },
  'building.envoy_hall': { en: 'Envoy Hall', ko: '사절관' },
  'building.warming_ward': { en: 'Warming Ward', ko: '온기 병동' },
  'building.ember_archive': { en: 'Ember Archive', ko: '불씨 서고' },
  'building.infantry_yard': { en: 'Infantry Yard', ko: '보병 연무장' },
  'building.lancer_yard': { en: 'Lancer Yard', ko: '창병 연무장' },
  'building.marksman_range': { en: 'Marksman Range', ko: '사격장' },

  // Building descriptions.
  'building.furnace.desc': {
    en: 'The heart of your hold, where the Ember must never die. Its level caps how far every other building can be upgraded.',
    ko: '성채의 심장부로, 불씨가 결코 꺼져서는 안 된다. 그 레벨이 다른 모든 건물의 업그레이드 한계 레벨을 결정한다.',
  },
  'building.hunters_hut.desc': { en: 'Sends out hunters to bring back rations for your survivors and soldiers.', ko: '사냥꾼을 내보내 생존자와 병사들을 먹일 식량을 구해 온다.' },
  'building.sawmill.desc': { en: 'Fells frozen timber into a steady supply of wood.', ko: '얼어붙은 나무를 벌목해 목재를 꾸준히 공급한다.' },
  'building.coal_pit.desc': { en: 'Digs coal to feed the Furnace and hold back the cold.', ko: '용광로에 넣어 추위를 막을 석탄을 캔다.' },
  'building.iron_mine.desc': { en: 'Mines iron to forge upgrades and arm your soldiers.', ko: '업그레이드와 병력 무장을 위한 철을 채굴한다.' },
  'building.war_camp.desc': { en: 'Trains survivors into soldiers to defend the hold in battle.', ko: '전투에서 성채를 지킬 병사로 생존자를 훈련한다.' },
  'building.shelter_row.desc': { en: 'Warm quarters that house more survivors and raise your population cap.', ko: '더 많은 생존자를 수용해 인구 한계를 올리는 따뜻한 거처.' },
  'building.frost_vault.desc': { en: 'A fortified store that shelters a portion of your resources from raids.', ko: '자원의 일부를 약탈로부터 지켜 주는 견고한 창고.' },
  'building.forge_hall.desc': { en: 'A steelworks that refines iron and coal into sturdy steel.', ko: '철과 석탄을 정련해 튼튼한 강철을 만드는 제련소.' },
  'building.envoy_hall.desc': { en: 'A diplomatic hub for envoys and requests for aid from other holds.', ko: '다른 성채에 사절과 원조 요청을 보내는 외교 거점.' },
  'building.warming_ward.desc': { en: 'A heated infirmary where wounded survivors recover.', ko: '부상당한 생존자가 회복하는 난방 병동.' },
  'building.ember_archive.desc': { en: 'A hall of study where survivors research new advances.', ko: '생존자들이 새로운 기술을 연구하는 학문의 전당.' },
  'building.infantry_yard.desc': { en: 'A drill yard that trains front-line infantry.', ko: '최전선 보병을 훈련하는 연무장.' },
  'building.lancer_yard.desc': { en: 'A drill yard that trains charging lancers.', ko: '돌격 창병을 훈련하는 연무장.' },
  'building.marksman_range.desc': { en: 'A shooting range that trains ranged marksmen.', ko: '원거리 사수를 훈련하는 사격장.' },

  // Building panel UI.
  'building.level': { en: 'Level {level}', ko: '레벨 {level}' },
  'building.maxLevel': { en: 'MAX LEVEL', ko: '최대 레벨' },
  'building.upgrade': { en: 'Upgrade', ko: '업그레이드' },
  'building.upgradeTo': { en: 'Upgrade to Lv.{level}', ko: 'Lv.{level} 업그레이드' },
  'building.upgrading': { en: 'Upgrading… {seconds}s', ko: '업그레이드 중… {seconds}초' },
  'building.output': { en: 'Output: {amount}/s', ko: '생산량: {amount}/초' },
  'building.lockedByFurnace': {
    en: 'Raise the Furnace to Lv.{level} first',
    ko: '먼저 용광로를 Lv.{level}(으)로 올리세요',
  },
  'building.insufficient': { en: 'Not enough resources', ko: '자원이 부족합니다' },

  // Troop names.
  'troop.trapper': { en: 'Trapper', ko: '덫사냥꾼' },
  'troop.marksman': { en: 'Marksman', ko: '사수' },
  'troop.vanguard': { en: 'Vanguard', ko: '선봉대' },

  // Troop descriptions.
  'troop.trapper.desc': { en: 'Cheap, sturdy front-line survivors who snare heavy foes.', ko: '무거운 적을 덫으로 묶는 저렴하고 튼튼한 최전선 생존자.' },
  'troop.marksman.desc': { en: 'Ranged damage from behind the line.', ko: '전열 뒤에서 원거리 피해를 준다.' },
  'troop.vanguard.desc': { en: 'Elite heavy shock troops with high health.', ko: '높은 체력을 지닌 정예 중장 돌격대.' },

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
  'training.noWarCamp': { en: 'Build a War Camp to train soldiers', ko: '병력 훈련하려면 전진 기지를 지으세요' },
  'training.cost': { en: 'Cost {cost}', ko: '비용 {cost}' },
  'training.time': { en: '{seconds}s each', ko: '개당 {seconds}초' },
  'training.tier': { en: 'Troop Tier T{tier} / T{max}', ko: '병력 등급 T{tier} / T{max}' },

  // Combat / battle UI.
  'battle.title': { en: 'BATTLE', ko: '전투' },
  'battle.prepare': { en: 'Prepare! Wave in {seconds}s', ko: '준비! {seconds}초 후 웨이브' },
  'battle.wave': { en: 'WAVE {wave} / {total}', ko: '웨이브 {wave} / {total}' },
  'battle.deploy': { en: 'Deploy Troops', ko: '병력 배치' },
  'battle.start': { en: 'Start Battle', ko: '전투 시작' },
  'battle.retreat': { en: 'Retreat', ko: '후퇴' },
  'battle.gateHp': { en: 'Gate {hp}/{max}', ko: '성문 {hp}/{max}' },
  'battle.incoming': { en: '{count} Horde incoming', ko: '서리 무리 {count}마리 접근 중' },
  'battle.noTroops': { en: 'Train soldiers before battle', ko: '전투 전에 병력을 훈련하세요' },
  'battle.comingSoon': { en: 'The frozen field awaits…', ko: '얼어붙은 전장이 당신을 기다립니다…' },
  'battle.skip': { en: 'Skip', ko: '건너뛰기' },
  'battle.speed': { en: 'Speed x{mult}', ko: '속도 x{mult}' },
  'battle.armyRemaining': { en: 'Army', ko: '병력' },
  'battle.enemyRemaining': { en: 'Horde', ko: '무리' },
  'battle.clash': { en: 'The Horde strikes!', ko: '서리 무리가 덮쳐옵니다!' },
  'battle.complete': { en: 'All 20 defense waves are complete.', ko: '방어전 20웨이브를 모두 완료했습니다.' },

  // Enemy names (the Frozen Horde).
  'enemy.frost_wolf': { en: 'Frost Wolf', ko: '서리늑대' },
  'enemy.ravager': { en: 'Ravager', ko: '약탈수' },
  'enemy.frost_titan': { en: 'Frost Titan', ko: '서리 거인' },

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
    en: 'Offline net change: {food} food, {wood} wood, {coal} coal, {iron} iron, {steel} steel. Fuel/refining may make values negative.',
    ko: '오프라인 순변화: 식량 {food}, 목재 {wood}, 석탄 {coal}, 철 {iron}, 강철 {steel}. 연료·정련으로 음수가 될 수 있습니다.',
  },
  'save.persistenceWarning': {
    en: 'Storage is unavailable. This session may not persist.',
    ko: '저장소를 사용할 수 없어 이번 세션이 유지되지 않을 수 있습니다.',
  },
  'save.recovered': {
    en: 'The primary save was damaged. Progress was restored from backup.',
    ko: '기본 저장이 손상되어 백업에서 진행을 복구했습니다.',
  },
  'save.blocked': {
    en: 'This save cannot be loaded. Export it before confirming a New Hold.',
    ko: '이 저장을 불러올 수 없습니다. 새 성채를 확인하기 전에 내보내세요.',
  },
  'save.export': { en: 'Export Save', ko: '저장 내보내기' },
  'save.exported': { en: 'Save exported', ko: '저장을 내보냈습니다' },
  'save.reset': { en: 'Progress reset', ko: '진행이 초기화되었습니다' },

  // Game over / result scene.
  'result.victory': { en: 'VICTORY', ko: '승리' },
  'result.defeat': { en: 'DEFEAT', ko: '패배' },
  'result.fullVictory': { en: 'THE HOLD ENDURES', ko: '성채는 버텨냈다' },
  'result.fullVictoryDesc': {
    en: 'Every wave of the Horde repelled. Your Ember still burns!',
    ko: '서리 무리의 모든 습격을 물리쳤습니다. 불씨는 여전히 타오릅니다!',
  },
  'result.wavesCleared': { en: 'Waves survived: {waves}', ko: '버텨낸 웨이브: {waves}' },
  'result.reward': { en: 'Reward: {iron} iron', ko: '보상: 철 {iron}' },
  'result.rewardLine': { en: '+{food} rations  +{wood} timber  +{coal} coal  +{iron} iron', ko: '+{food} 식량  +{wood} 목재  +{coal} 석탄  +{iron} 철' },
  'result.casualties': { en: 'Casualties: {count}', ko: '전사자: {count}' },
  'result.survivors': { en: 'Survivors: {count}', ko: '생존자: {count}' },
  'result.nextWave': { en: 'Next wave: {wave}', ko: '다음 웨이브: {wave}' },
  'result.defeatDesc': { en: 'Your soldiers fell, but the hold still stands. Regroup and try again.', ko: '병력은 쓰러졌지만 성채는 건재합니다. 전열을 재정비하세요.' },
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
  'preload.error': { en: '{count} assets failed to load. Retry to continue.', ko: '에셋 {count}개를 불러오지 못했습니다. 다시 시도하세요.' },
  'preload.retry': { en: 'Retry', ko: '다시 시도' },

  // --- FEAT-003: heroes, summon (gacha) and story campaign ---

  // Hero-system UI.
  'hero.title': { en: 'HEROES', ko: '영웅' },
  'hero.roster': { en: 'Roster', ko: '보유 영웅' },
  'hero.lead': { en: 'Lead Heroes', ko: '지휘 영웅' },
  'hero.level': { en: 'Lv.{level}', ko: 'Lv.{level}' },
  'hero.stars': { en: '{stars}★', ko: '{stars}★' },
  'hero.shards': { en: 'Shards {count}', ko: '조각 {count}' },
  'hero.power': { en: 'Power {power}', ko: '전투력 {power}' },
  'hero.levelUp': { en: 'Level Up', ko: '레벨 업' },
  'hero.starUp': { en: 'Star Up', ko: '승급' },
  'hero.starUpCost': { en: 'Star Up ({shards} shards)', ko: '승급 (조각 {shards})' },
  'hero.craft': { en: 'Recruit ({shards} shards)', ko: '영입 (조각 {shards})' },
  'hero.setLead': { en: 'Set as Lead', ko: '지휘 지정' },
  'hero.maxStars': { en: 'MAX STARS', ko: '최대 승급' },
  'hero.locked': { en: 'Not yet recruited', ko: '아직 영입하지 않음' },
  // Compact roster-grid caption (the full sentence above overflows a cell).
  'hero.lockedShort': { en: 'Locked', ko: '미영입' },
  'hero.notEnoughShards': { en: 'Not enough shards', ko: '조각이 부족합니다' },
  'hero.bonusArmy': { en: 'Army Power +{pct}%', ko: '전투력 +{pct}%' },
  'hero.bonusEconomy': { en: 'Production +{pct}%', ko: '생산 +{pct}%' },

  // Hero classes.
  'heroClass.infantry': { en: 'Infantry', ko: '보병' },
  'heroClass.lancer': { en: 'Lancer', ko: '창병' },
  'heroClass.marksman': { en: 'Marksman', ko: '사수' },

  // Hero rarities.
  'rarity.common': { en: 'Common', ko: '일반' },
  'rarity.rare': { en: 'Rare', ko: '고급' },
  'rarity.epic': { en: 'Epic', ko: '영웅' },
  'rarity.legendary': { en: 'Legendary', ko: '전설' },

  // Hero names (ORIGINAL work).
  'hero.ember_warden.name': { en: 'Ember Warden', ko: '불씨 파수꾼' },
  'hero.snow_picket.name': { en: 'Snow Picket', ko: '설원 척후병' },
  'hero.drift_runner.name': { en: 'Drift Runner', ko: '눈보라 질주자' },
  'hero.iron_bulwark.name': { en: 'Iron Bulwark', ko: '강철 방벽' },
  'hero.glacier_lance.name': { en: 'Glacier Lance', ko: '빙하 창수' },
  'hero.frost_archer.name': { en: 'Frost Archer', ko: '서리 궁수' },
  'hero.aurora_sentinel.name': { en: 'Aurora Sentinel', ko: '오로라 파수병' },
  'hero.stormpike_rider.name': { en: 'Stormpike Rider', ko: '폭풍창 기수' },
  'hero.winters_eye.name': { en: "Winter's Eye", ko: '겨울의 눈' },
  'hero.the_kindled_queen.name': { en: 'The Kindled Queen', ko: '불붙은 여왕' },
  'hero.wyrmspear_valdis.name': { en: 'Valdis Wyrmspear', ko: '용창 발디스' },
  'hero.the_pale_marksman.name': { en: 'The Pale Marksman', ko: '창백한 사수' },

  // Hero descriptions (ORIGINAL lore).
  'hero.ember_warden.desc': { en: 'A steadfast guard who keeps the Ember lit through the longest nights.', ko: '가장 긴 밤에도 불씨를 지켜내는 굳건한 수호자.' },
  'hero.snow_picket.desc': { en: 'A sharp-eyed scout who maps supply routes across the drifts.', ko: '눈밭 너머의 보급로를 읽어내는 예리한 척후병.' },
  'hero.drift_runner.desc': { en: 'A tireless lancer who charges down foes across open snow.', ko: '탁 트인 설원에서 적을 돌파하는 지치지 않는 창병.' },
  'hero.iron_bulwark.desc': { en: 'An unbreakable shield-bearer who anchors the front line.', ko: '전열을 지탱하는 부서지지 않는 방패병.' },
  'hero.glacier_lance.desc': { en: 'A lancer whose frozen spear pierces the heaviest hide.', ko: '가장 두꺼운 가죽도 꿰뚫는 얼어붙은 창의 창병.' },
  'hero.frost_archer.desc': { en: 'A hunter-marksman who never returns to the hold empty-handed.', ko: '결코 빈손으로 돌아오지 않는 사냥꾼 사수.' },
  'hero.aurora_sentinel.desc': { en: 'A legendary guardian bathed in the light of the winter sky.', ko: '겨울 하늘의 빛을 두른 전설적 수호자.' },
  'hero.stormpike_rider.desc': { en: 'A storm-borne lancer who strikes like a thunderclap.', ko: '천둥처럼 내리치는 폭풍의 창병.' },
  'hero.winters_eye.desc': { en: 'A marksman whose gaze finds the mark through any blizzard.', ko: '어떤 눈보라 속에서도 표적을 찾아내는 사수.' },
  'hero.the_kindled_queen.desc': { en: 'The queen whose will rekindles a dying hold.', ko: '꺼져가는 성채를 다시 타오르게 하는 여왕.' },
  'hero.wyrmspear_valdis.desc': { en: 'A dragoon of legend whose spear shattered the great wyrms of the ice.', ko: '빙하의 거대 용을 꺾은 전설의 용창 기수.' },
  'hero.the_pale_marksman.desc': { en: 'A ghostly sharpshooter said to never miss a shot.', ko: '결코 빗나가지 않는다는 유령 같은 명사수.' },

  // Hero skills (ORIGINAL). One key per skill id.
  'hero.skill.ember_warden_guard': { en: 'Ember Guard', ko: '불씨 수호' },
  'hero.skill.snow_picket_scout': { en: 'Trail Scout', ko: '길 정찰' },
  'hero.skill.drift_runner_charge': { en: 'Drift Charge', ko: '설원 돌격' },
  'hero.skill.iron_bulwark_wall': { en: 'Shield Wall', ko: '방패벽' },
  'hero.skill.iron_bulwark_rally': { en: 'Rally Cry', ko: '집결 함성' },
  'hero.skill.glacier_lance_pierce': { en: 'Glacier Pierce', ko: '빙하 관통' },
  'hero.skill.glacier_lance_momentum': { en: 'Momentum', ko: '가속' },
  'hero.skill.frost_archer_volley': { en: 'Frost Volley', ko: '서리 일제사격' },
  'hero.skill.frost_archer_forage': { en: 'Forager', ko: '채집술' },
  'hero.skill.aurora_sentinel_aegis': { en: 'Aurora Aegis', ko: '오로라 방벽' },
  'hero.skill.aurora_sentinel_beacon': { en: 'Guiding Beacon', ko: '인도의 봉화' },
  'hero.skill.aurora_sentinel_resolve': { en: 'Undying Resolve', ko: '불굴의 의지' },
  'hero.skill.stormpike_rider_lightning': { en: 'Lightning Lance', ko: '번개 창격' },
  'hero.skill.stormpike_rider_gallop': { en: 'Storm Gallop', ko: '폭풍 질주' },
  'hero.skill.stormpike_rider_thunder': { en: 'Thunderous Charge', ko: '천둥 돌격' },
  'hero.skill.winters_eye_mark': { en: "Winter's Mark", ko: '겨울의 표식' },
  'hero.skill.winters_eye_harvest': { en: 'Cold Harvest', ko: '한겨울 수확' },
  'hero.skill.winters_eye_stockpile': { en: 'Stockpile', ko: '비축' },
  'hero.skill.the_kindled_queen_crown': { en: 'Ember Crown', ko: '불씨 왕관' },
  'hero.skill.the_kindled_queen_edict': { en: 'Royal Edict', ko: '왕의 칙령' },
  'hero.skill.the_kindled_queen_ember': { en: 'Rekindling', ko: '재점화' },
  'hero.skill.wyrmspear_valdis_impale': { en: 'Wyrm Impale', ko: '용창 꿰뚫기' },
  'hero.skill.wyrmspear_valdis_dragoon': { en: 'Dragoon Drill', ko: '용기병 단련' },
  'hero.skill.wyrmspear_valdis_onslaught': { en: 'Onslaught', ko: '맹공' },
  'hero.skill.the_pale_marksman_deadeye': { en: 'Deadeye', ko: '필중' },
  'hero.skill.the_pale_marksman_bounty': { en: 'Hunter\u2019s Bounty', ko: '사냥의 결실' },
  'hero.skill.the_pale_marksman_reserve': { en: 'Deep Reserve', ko: '깊은 비축' },

  // Summon (gacha) UI.
  'summon.title': { en: 'SUMMON', ko: '소환' },
  'summon.pull': { en: 'Summon ({cost} Sparks)', ko: '소환 (정수 {cost})' },
  'summon.pity': { en: 'Guarantee in {count}', ko: '확정까지 {count}회' },
  'summon.pityReady': { en: 'Next summon guaranteed Epic+', ko: '다음 소환 영웅 등급 이상 확정' },
  'summon.notEnough': { en: 'Not enough Ember Sparks', ko: '불씨 정수가 부족합니다' },
  'summon.gotHero': { en: 'Recruited {name}!', ko: '{name} 영입!' },
  'summon.gotShards': { en: '{name} duplicate — +{shards} shards', ko: '{name} 중복 — 조각 +{shards}' },
  'summon.totalPulls': { en: 'Total summons: {count}', ko: '총 소환: {count}회' },

  // Campaign / exploration UI.
  'campaign.title': { en: 'EXPEDITION', ko: '원정' },
  'campaign.chapter': { en: 'Chapter {chapter}', ko: '{chapter}장' },
  'campaign.stage': { en: 'Stage {stage}', ko: '{stage} 관문' },
  'campaign.recommendedPower': { en: 'Recommended Power {power}', ko: '권장 전투력 {power}' },
  'campaign.attempt': { en: 'March Out', ko: '출정' },
  'campaign.locked': { en: 'Clear the previous stage first', ko: '이전 관문을 먼저 돌파하세요' },
  'campaign.cleared': { en: 'Cleared', ko: '돌파 완료' },
  'campaign.victory': { en: 'Stage cleared!', ko: '관문 돌파!' },
  'campaign.defeat': { en: 'Your force was too weak. Grow stronger and return.', ko: '병력이 부족했습니다. 더 강해진 뒤 돌아오세요.' },
  'campaign.rewardClaimed': { en: 'First-clear reward earned!', ko: '첫 돌파 보상 획득!' },
  'campaign.complete': { en: 'The frontier is yours. The Expedition is complete.', ko: '변경은 이제 당신의 것입니다. 원정을 완수했습니다.' },

  // Chapter / stage names + narrative (ORIGINAL).
  'campaign.chapter.1.name': { en: 'The First Thaw', ko: '첫 해빙' },
  'campaign.chapter.2.name': { en: 'Into the White Waste', ko: '백색 황야로' },
  'campaign.c1s1.name': { en: 'Broken Palisade', ko: '무너진 방책' },
  'campaign.c1s1.blurb': { en: 'Wolves circle the ruined palisade at the edge of the hold. Drive them back.', ko: '성채 외곽의 부서진 방책을 늑대들이 맴돈다. 그들을 몰아내라.' },
  'campaign.c1s2.name': { en: 'Frozen Creekbed', ko: '얼어붙은 개울' },
  'campaign.c1s2.blurb': { en: 'A larger pack has denned in the frozen creek. Clear the path to the timberline.', ko: '더 큰 무리가 얼어붙은 개울에 자리 잡았다. 숲 경계까지 길을 열어라.' },
  'campaign.c1s3.name': { en: 'The Old Watchtower', ko: '오래된 감시탑' },
  'campaign.c1s3.blurb': { en: 'A ravager has claimed the abandoned watchtower. Retake it for the hold.', ko: '약탈수가 버려진 감시탑을 차지했다. 성채를 위해 되찾아라.' },
  'campaign.c2s1.name': { en: 'Windswept Pass', ko: '바람 몰아치는 고개' },
  'campaign.c2s1.blurb': { en: 'Beyond the pass the Horde grows bolder. Hold the line against the pack.', ko: '고개 너머 무리는 더욱 대담해진다. 전열을 지켜 무리를 막아라.' },
  'campaign.c2s2.name': { en: 'The Titan\u2019s Ridge', ko: '거인의 능선' },
  'campaign.c2s2.blurb': { en: 'A frost titan lumbers down the ridge. Break its advance before it reaches the hold.', ko: '서리 거인이 능선을 내려온다. 성채에 닿기 전에 그 진격을 꺾어라.' },
  'campaign.c2s3.name': { en: 'Heart of the Waste', ko: '황야의 심장' },
  'campaign.c2s3.blurb': { en: 'At the heart of the white waste the Horde makes its stand. End it here.', ko: '백색 황야의 심장부에서 무리가 최후의 저항을 벌인다. 여기서 끝내라.' },

  // --- FEAT-004: research tech tree, chief gear + charms, troop tiers ---

  // Research UI.
  'research.title': { en: 'RESEARCH', ko: '연구' },
  'research.branch.economy': { en: 'Economy', ko: '경제' },
  'research.branch.battle': { en: 'Battle', ko: '전투' },
  'research.branch.survival': { en: 'Survival', ko: '생존' },
  'research.branch.development': { en: 'Development', ko: '발전' },
  'research.start': { en: 'Research', ko: '연구 시작' },
  'research.researching': { en: 'Researching… {seconds}s', ko: '연구 중… {seconds}초' },
  'research.completed': { en: 'Researched', ko: '연구 완료' },
  'research.busy': { en: 'The Ember Archive is already researching', ko: '불씨 서고가 이미 연구 중입니다' },
  'research.locked': { en: 'Complete the prerequisite research first', ko: '선행 연구를 먼저 완료하세요' },
  'research.needsLab': { en: 'Raise the Ember Archive to Lv.{level} first', ko: '먼저 불씨 서고를 Lv.{level}(으)로 올리세요' },
  'research.insufficient': { en: 'Not enough resources', ko: '자원이 부족합니다' },

  // Research node names (ORIGINAL).
  'research.eco_foraging.name': { en: 'Deep Foraging', ko: '심층 채집' },
  'research.eco_logistics.name': { en: 'Winter Logistics', ko: '겨울 병참' },
  'research.eco_metallurgy.name': { en: 'Cold Metallurgy', ko: '한랭 야금술' },
  'research.eco_efficient_works.name': { en: 'Efficient Works', ko: '효율 공정' },
  'research.bat_drill.name': { en: 'Combat Drills', ko: '전투 훈련' },
  'research.bat_armor.name': { en: 'Layered Armor', ko: '겹겹 장갑' },
  'research.bat_infantry_doctrine.name': { en: 'Infantry Doctrine', ko: '보병 교리' },
  'research.bat_lancer_doctrine.name': { en: 'Lancer Doctrine', ko: '창병 교리' },
  'research.bat_marksman_doctrine.name': { en: 'Marksman Doctrine', ko: '사수 교리' },
  'research.sur_insulation.name': { en: 'Insulation', ko: '단열 공법' },
  'research.sur_provisioning.name': { en: 'Provisioning', ko: '보급 관리' },
  'research.sur_hardened_frame.name': { en: 'Hardened Frame', ko: '강화 골격' },
  'research.dev_ironworking.name': { en: 'Ironworking', ko: '철공술' },
  'research.dev_steel_tactics.name': { en: 'Steel Tactics', ko: '강철 전술' },
  'research.dev_master_forge.name': { en: 'Master Forge', ko: '명장의 제련' },
  'research.dev_wide_streets.name': { en: 'Wide Streets', ko: '넓은 가로' },

  // Research node descriptions (ORIGINAL).
  'research.eco_foraging.desc': { en: 'Teach hunters to work the deep drifts, raising rations gathered.', ko: '사냥꾼이 깊은 눈밭을 다루게 하여 식량 수급을 늘린다.' },
  'research.eco_logistics.desc': { en: 'Streamline supply runs so every producer yields more.', ko: '보급 동선을 정비해 모든 생산 건물의 산출을 늘린다.' },
  'research.eco_metallurgy.desc': { en: 'Refine ore-working to boost iron and steel output.', ko: '광석 가공을 개량해 철과 강철 산출을 높인다.' },
  'research.eco_efficient_works.desc': { en: 'Better tools and crews shorten every construction.', ko: '더 나은 도구와 인력으로 모든 공사 시간을 줄인다.' },
  'research.bat_drill.desc': { en: 'Disciplined drills sharpen every soldier\u2019s attack.', ko: '엄격한 훈련으로 모든 병사의 공격력을 높인다.' },
  'research.bat_armor.desc': { en: 'Layered plating raises troop health and defense.', ko: '겹겹 장갑으로 병력의 체력과 방어력을 높인다.' },
  'research.bat_infantry_doctrine.desc': { en: 'A doctrine that hardens the infantry line.', ko: '보병 전열을 단단하게 하는 교리.' },
  'research.bat_lancer_doctrine.desc': { en: 'A doctrine that sharpens the lancer charge.', ko: '창병의 돌격을 예리하게 하는 교리.' },
  'research.bat_marksman_doctrine.desc': { en: 'A doctrine that steadies the marksman\u2019s aim.', ko: '사수의 조준을 안정시키는 교리.' },
  'research.sur_insulation.desc': { en: 'Seal the pits against the cold, raising coal output.', ko: '탄광을 추위로부터 밀폐해 석탄 산출을 높인다.' },
  'research.sur_provisioning.desc': { en: 'Careful rationing lifts food output and overall yield.', ko: '치밀한 배급으로 식량과 전체 산출을 끌어올린다.' },
  'research.sur_hardened_frame.desc': { en: 'Toughen survivors against the elements, raising troop health.', ko: '생존자를 혹한에 단련시켜 병력 체력을 높인다.' },
  'research.dev_ironworking.desc': { en: 'Master ironworking to train Tier 2 troops.', ko: '철공술을 익혀 2등급 병력을 훈련한다.' },
  'research.dev_steel_tactics.desc': { en: 'Steel-forged arms unlock Tier 3 troops.', ko: '강철 무장으로 3등급 병력을 해금한다.' },
  'research.dev_master_forge.desc': { en: 'The master forge unlocks the mightiest Tier 4 troops.', ko: '명장의 제련으로 최강의 4등급 병력을 해금한다.' },
  'research.dev_wide_streets.desc': { en: 'Widen the hold\u2019s streets so construction moves faster.', ko: '성채의 가로를 넓혀 공사 속도를 높인다.' },

  // Chief-gear UI.
  'gear.title': { en: 'CHIEF GEAR', ko: '지휘관 장비' },
  'gear.forge': { en: 'Forge', ko: '제작' },
  'gear.upgrade': { en: 'Upgrade', ko: '강화' },
  'gear.level': { en: 'Lv.{level}', ko: 'Lv.{level}' },
  'gear.maxLevel': { en: 'MAX LEVEL', ko: '최대 레벨' },
  'gear.socket': { en: 'Socket Charm', ko: '문양 장착' },
  'gear.upgradeCharm': { en: 'Upgrade Charm', ko: '문양 강화' },
  'gear.emptySocket': { en: 'Empty Socket', ko: '빈 소켓' },
  'gear.noCharm': { en: 'Forge the gear before socketing a charm', ko: '문양을 장착하려면 먼저 장비를 제작하세요' },
  'gear.insufficient': { en: 'Not enough materials', ko: '재료가 부족합니다' },

  // Gear slot names (ORIGINAL).
  'gear.slot.coat': { en: 'Frostplate Coat', ko: '서리판금 외투' },
  'gear.slot.gloves': { en: 'Warden\u2019s Gloves', ko: '파수꾼의 장갑' },
  'gear.slot.boots': { en: 'Trailbreaker Boots', ko: '설원 답파 장화' },
  'gear.slot.belt': { en: 'Ember Belt', ko: '불씨 허리띠' },
  'gear.slot.helm': { en: 'Sentinel Helm', ko: '파수병 투구' },
  'gear.slot.emblem': { en: 'Hold Emblem', ko: '성채 문장' },

  // Charm names (ORIGINAL).
  'gear.charm.warfare': { en: 'Warfare Charm', ko: '전쟁 문양' },
  'gear.charm.bulwark': { en: 'Bulwark Charm', ko: '방벽 문양' },
  'gear.charm.harvest': { en: 'Harvest Charm', ko: '수확 문양' },

  // Troop class + tier labels.
  'troopClass.infantry': { en: 'Infantry', ko: '보병' },
  'troopClass.lancer': { en: 'Lancer', ko: '창병' },
  'troopClass.marksman': { en: 'Marksman', ko: '사수' },
  'troop.tier': { en: 'Tier {tier}', ko: '{tier}등급' },
  'troop.tierShort': { en: 'T{tier}', ko: 'T{tier}' },
  'troop.maxTier': { en: 'Max Tier {tier}', ko: '최대 {tier}등급' },
  'troop.tierLocked': { en: 'Research to unlock higher tiers', ko: '더 높은 등급은 연구로 해금하세요' },

  // --- FEAT-005: world-boss rallies (ORIGINAL Frostbeast names) ---
  'rally.title': { en: 'FROSTBEAST RALLY', ko: '서리괴수 총공격' },
  'rally.attack': { en: 'Rally the Hold', ko: '총공격' },
  'rally.remaining': { en: 'HP {remaining}/{pool}', ko: '체력 {remaining}/{pool}' },
  'rally.attempts': { en: 'Attempts {count}', ko: '시도 {count}회' },
  'rally.allianceShare': { en: 'Alliance dealt {amount}', ko: '연맹 피해 {amount}' },
  'rally.defeated': { en: 'Frostbeast slain!', ko: '서리괴수 처치!' },
  'rally.recommended': { en: 'Recommended Power {power}', ko: '권장 전투력 {power}' },
  // Boss names + flavour (original).
  'enemy.rime_alpha': { en: 'Rimefang Alpha', ko: '서릿이빨 우두머리' },
  'enemy.glacier_behemoth': { en: 'Glacier Behemoth', ko: '빙하 거수' },
  'enemy.hoarfrost_wyrm': { en: 'Hoarfrost Wyrm', ko: '성에 비룡' },
  'rally.rime_alpha.desc': {
    en: 'The pack-alpha of the frost wolves, swollen by the endless winter.',
    ko: '끝없는 겨울에 몸집이 불어난 서리늑대 무리의 우두머리.',
  },
  'rally.glacier_behemoth.desc': {
    en: 'A mountain of living ice that shrugs off all but the heaviest blows.',
    ko: '가장 무거운 일격이 아니면 끄떡없는 살아 움직이는 얼음 산.',
  },
  'rally.hoarfrost_wyrm.desc': {
    en: 'An apex predator of the deep blizzard; its breath freezes the air itself.',
    ko: '깊은 눈보라의 정점에 선 포식자. 그 숨결은 공기마저 얼린다.',
  },

  // --- FEAT-005: arena (simulated PvP ladder) ---
  'arena.title': { en: 'FROST ARENA', ko: '서리 투기장' },
  'arena.fight': { en: 'Challenge', ko: '도전' },
  'arena.rank': { en: 'Rank {rank}', ko: '{rank}위' },
  'arena.record': { en: 'Wins {wins} · Losses {losses}', ko: '승 {wins} · 패 {losses}' },
  'arena.opponentPower': { en: 'Opponent Power {power}', ko: '상대 전투력 {power}' },
  'arena.win': { en: 'Victory! Rank up to {rank}', ko: '승리! {rank}위로 상승' },
  'arena.loss': { en: 'Defeated. Slipped to rank {rank}', ko: '패배. {rank}위로 하락' },
  'arena.reward': { en: '+{sparks} Ember Sparks', ko: '불씨 정수 +{sparks}' },

  // --- FEAT-005: alliance (simulated NPC alliance) ---
  'alliance.title': { en: 'FROSTHOLD PACT', ko: '서리성채 협정' },
  'meta.localDisclosure': {
    en: 'Local single-player NPC simulation · no purchases or online players',
    ko: '로컬 싱글플레이 NPC 시뮬레이션 · 결제 및 온라인 플레이어 없음',
  },
  'alliance.members': { en: '{count} Sworn Members', ko: '맹약 구성원 {count}명' },
  'alliance.help': { en: 'Request Help', ko: '지원 요청' },
  'alliance.helpsAvailable': { en: 'Help charges {count}', ko: '지원 횟수 {count}' },
  'alliance.helpApplied': { en: 'Help shaved {seconds}s off the timer', ko: '지원으로 {seconds}초 단축' },
  'alliance.noTimer': { en: 'No active timer to help with', ko: '지원할 진행 중인 작업이 없습니다' },
  'alliance.requiresEnvoy': { en: 'Build Envoy Hall to unlock Pact actions and Rally.', ko: '협정 행동과 집결을 해금하려면 사절 회관을 건설하세요.' },
  'alliance.tech': { en: 'Pact Research', ko: '협정 연구' },
  'alliance.techLevel': { en: 'Pact Level {level}', ko: '협정 {level}단계' },
  'alliance.contribute': { en: 'Contribute', ko: '기여' },
  'alliance.techPoints': { en: 'Contribution {points}', ko: '기여도 {points}' },

  // --- FEAT-005: quests, growth missions, events ---
  'quest.title': { en: 'DAILY DUTIES', ko: '일일 임무' },
  'quest.growthTitle': { en: 'GROWTH TRIALS', ko: '성장 과업' },
  'quest.progress': { en: '{progress}/{target}', ko: '{progress}/{target}' },
  'quest.claim': { en: 'Claim', ko: '수령' },
  'quest.claimed': { en: 'Claimed', ko: '수령 완료' },
  'quest.complete': { en: 'Complete', ko: '완료' },
  'quest.resetsDaily': { en: 'Resets daily', ko: '매일 갱신' },
  // Daily quest names (original).
  'quest.daily_upgrade': { en: 'Raise Two Buildings', ko: '건물 2채 강화' },
  'quest.daily_battle': { en: 'Repel Three Waves', ko: '세 차례 격퇴' },
  'quest.daily_train': { en: 'Train a Batch', ko: '병력 훈련' },
  'quest.daily_summon': { en: 'Summon a Hero', ko: '영웅 소환' },
  // Growth milestone names (original).
  'quest.growth_first_wave': { en: 'First Stand', ko: '첫 방어전' },
  'quest.growth_builder': { en: 'Founder of the Hold', ko: '성채의 창건자' },
  'quest.growth_scholar': { en: 'Keeper of Lore', ko: '지식의 수호자' },
  'quest.growth_champion': { en: 'Champion of the Ember', ko: '불씨의 용사' },
  'quest.growth_hunter': { en: 'Frostbeast Hunter', ko: '서리괴수 사냥꾼' },
  // Events (original, time-boxed).
  'event.title': { en: 'LIMITED EVENT', ko: '한정 이벤트' },
  'event.active': { en: 'Active · {bonus}x output', ko: '진행 중 · 생산 {bonus}배' },
  'event.endsIn': { en: 'Ends in {time}', ko: '종료까지 {time}' },
  'event.ember_rush': { en: 'Ember Rush', ko: '불씨 축제' },
  'event.frostfall_hunt': { en: 'Frostfall Hunt', ko: '설강 사냥제' },
  'event.rally': { en: 'Rally the Hold', ko: '결집 호령' },

  // --- FEAT-005: VIP progression ---
  'vip.title': { en: 'PATRON STANDING', ko: '후원자 지위' },
  'vip.level': { en: 'VIP {level}', ko: 'VIP {level}' },
  'vip.points': { en: '{points} Patron Points', ko: '후원 점수 {points}' },
  'vip.toNext': { en: '{points} to next level', ko: '다음 단계까지 {points}' },
  'vip.maxed': { en: 'Highest standing reached', ko: '최고 지위 달성' },
  'vip.perk': { en: 'Perks: +{eco}% output, +{build}% build speed', ko: '혜택: 생산 +{eco}%, 건설 속도 +{build}%' },

  // --- FEAT-006: Town hub navigation to the system screens ---
  'nav.menu': { en: 'Command', ko: '지휘' },
  'nav.hero': { en: 'Heroes', ko: '영웅' },
  'nav.summon': { en: 'Summon', ko: '소환' },
  'nav.campaign': { en: 'Expedition', ko: '원정' },
  'nav.research': { en: 'Research', ko: '연구' },
  'nav.gear': { en: 'Chief Gear', ko: '지휘관 장비' },
  'nav.alliance': { en: 'Pact & Rally', ko: '협정과 총공격' },
  'nav.arena': { en: 'Arena', ko: '투기장' },
  'nav.quests': { en: 'Duties', ko: '임무' },
  'nav.close': { en: 'Close Menu', ko: '메뉴 닫기' },
} satisfies Record<string, TrEntry>;

/** The set of valid translation keys, derived from {@link STRINGS}. */
export type TrKey = keyof typeof STRINGS;
