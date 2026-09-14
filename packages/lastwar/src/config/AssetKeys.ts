/**
 * AssetKeys - centralized, typed registry of every runtime asset for LAST SQUAD.
 *
 * The rest of the codebase references these keys (and their frame configs)
 * instead of raw strings, so a rename is a single edit here and TypeScript
 * catches typos. All art/audio is ORIGINAL to this project (see
 * assets/CREDITS.md); files live under public/assets/ and are produced by the
 * generators in tools/ (gen_sprites.py, gen_audio.py). Nothing is drawn from
 * any existing IP or trademark.
 *
 * NOTE on paths: files in public/ are served at the site root, which is
 * import.meta.env.BASE_URL ('/open-games/lastwar/' in production, '/' in dev). Always
 * build load URLs with assetPath() so they resolve under the base path.
 *
 * FRAME SIZES BELOW MUST MATCH tools/gen_sprites.py OUTPUT EXACTLY:
 *   soldier.png       32x20 sheet -> 2 frames of 16x20 (run cycle)
 *   enemy_walker.png  32x20 sheet -> 2 frames of 16x20
 *   enemy_runner.png  32x20 sheet -> 2 frames of 16x20
 *   boss.png          128x72 sheet -> 2 frames of 64x72
 *   gate.png          96x120 single image (scene tints + labels it)
 *   skyline.png       540x480 single image (distant static backdrop)
 *   road.png          540x270 single image (seamless vertical scroll tile)
 *   muzzle/hit/sparkle 64x16 sheet -> 4 frames of 16x16
 *   panel.png         24x24 (9-slice), button.png 24x16 (9-slice),
 *   bar_frame.png     64x12, icons.png 64x16 -> 4 frames of 16x16
 *
 * FEAT-005 base/meta + shell-nav art (frame sizes MUST match gen_sprites.py):
 *   buildings.png     144x24 sheet -> 6 frames of 24x24 (BUILDING_ORDER:
 *                     hq, tech_center, parade_ground, hospital, barracks,
 *                     drone_center)
 *   resources.png     64x16 sheet -> 4 frames of 16x16 (RESOURCE_ORDER:
 *                     rations, steel, fuel, circuitry)
 *   hero_portraits.png 288x32 sheet -> 9 frames of 32x32, row-major
 *                     HERO_TYPES x HERO_ROLES (tank/missile/aircraft x
 *                     dealer/tank/support): frame = typeIndex*3 + roleIndex
 *   grade_frames.png  96x32 sheet -> 3 frames of 32x32 (HERO_GRADES:
 *                     UR, SSR, SR) - transparent overlay for a portrait
 *   type_badges.png   48x16 sheet -> 3 frames of 16x16 (HERO_TYPES order)
 *   role_badges.png   48x16 sheet -> 3 frames of 16x16 (HERO_ROLES order)
 *   nav_icons.png     120x20 sheet -> 6 frames of 20x20 (NAV order:
 *                     base, heroes, campaign, missions, season, falcon)
 *   star.png          16x16 single image (hero star-tier pip)
 *   medal.png         16x16 single image (season/league medal)
 *   tab_bar.png       24x24 (9-slice) bottom-nav bar frame
 *   battle.png        540x720 single image (campaign/league battle backdrop)
 */

/** Prefix a public/ asset path with the Vite base URL. */
export function assetPath(rel: string): string {
  const base = import.meta.env.BASE_URL || '/';
  const trimmed = rel.replace(/^\/+/, '');
  return `${base}${base.endsWith('/') ? '' : '/'}${trimmed}`;
}

/** Spritesheet frame configuration (Phaser.Types.Loader.FileTypes.ImageFrameConfig). */
export interface FrameConfig {
  frameWidth: number;
  frameHeight: number;
}

/** Texture (image / spritesheet) keys. */
export const TextureKeys = {
  // Squad unit (player crowd). 2-frame run cycle.
  Soldier: 'u_soldier',

  // Enemy survivor/zombie units. 2-frame shamble cycles.
  EnemyWalker: 'e_walker',
  EnemyRunner: 'e_runner',

  // Boss (large armored brute). 2-frame idle/attack.
  Boss: 'e_boss',

  // Math gate panel (neutral frame the scene tints good/bad and labels).
  Gate: 'gate_panel',

  // Backgrounds.
  BgSkyline: 'bg_skyline',
  BgRoad: 'bg_road',

  // FX sheets (4 frames each).
  FxMuzzle: 'fx_muzzle',
  FxHit: 'fx_hit',
  FxSparkle: 'fx_sparkle',

  // UI kit.
  UiPanel: 'ui_panel',
  UiButton: 'ui_button',
  UiBarFrame: 'ui_bar_frame',
  UiIcons: 'ui_icons',

  // FEAT-005 base/meta + shell-nav art.
  Buildings: 'ui_buildings',
  Resources: 'ui_resources',
  HeroPortraits: 'hero_portraits',
  GradeFrames: 'ui_grade_frames',
  TypeBadges: 'ui_type_badges',
  RoleBadges: 'ui_role_badges',
  NavIcons: 'ui_nav_icons',
  UiStar: 'ui_star',
  UiMedal: 'ui_medal',
  UiTabBar: 'ui_tab_bar',
  BgBattle: 'bg_battle',
} as const;

export type TextureKey = (typeof TextureKeys)[keyof typeof TextureKeys];

/** Audio keys. */
export const AudioKeys = {
  UiClick: 'sfx_ui_click',
  GatePass: 'sfx_gate_pass',
  Shoot: 'sfx_shoot',
  Hit: 'sfx_hit',
  LevelUp: 'sfx_level_up',
  Victory: 'sfx_victory',
  Defeat: 'sfx_defeat',
  MusicLoop: 'music_loop',

  // FEAT-005 SFX (base/meta + battle + shell nav).
  Recruit: 'sfx_recruit',
  UpgradeComplete: 'sfx_upgrade_complete',
  BattleHit: 'sfx_battle_hit',
  BattleWin: 'sfx_battle_win',
  BattleLose: 'sfx_battle_lose',
  TabSwitch: 'sfx_tab_switch',
  Reward: 'sfx_reward',
} as const;

export type AudioKey = (typeof AudioKeys)[keyof typeof AudioKeys];

/** Single-image asset descriptor. */
export interface ImageAsset {
  key: TextureKey;
  url: string;
}

/** Spritesheet asset descriptor with frame config. */
export interface SheetAsset extends ImageAsset {
  frame: FrameConfig;
}

/** Audio asset descriptor (may list multiple formats for browser fallback). */
export interface AudioAsset {
  key: AudioKey;
  urls: string[];
}

/**
 * Spritesheets and their frame sizes. Frame sizes match the output of
 * tools/gen_sprites.py exactly.
 */
export const SHEETS: readonly SheetAsset[] = [
  { key: TextureKeys.Soldier, url: 'assets/sprites/soldier.png', frame: { frameWidth: 16, frameHeight: 20 } },
  { key: TextureKeys.EnemyWalker, url: 'assets/sprites/enemy_walker.png', frame: { frameWidth: 16, frameHeight: 20 } },
  { key: TextureKeys.EnemyRunner, url: 'assets/sprites/enemy_runner.png', frame: { frameWidth: 16, frameHeight: 20 } },
  { key: TextureKeys.Boss, url: 'assets/sprites/boss.png', frame: { frameWidth: 64, frameHeight: 72 } },
  { key: TextureKeys.FxMuzzle, url: 'assets/fx/muzzle.png', frame: { frameWidth: 16, frameHeight: 16 } },
  { key: TextureKeys.FxHit, url: 'assets/fx/hit.png', frame: { frameWidth: 16, frameHeight: 16 } },
  { key: TextureKeys.FxSparkle, url: 'assets/fx/sparkle.png', frame: { frameWidth: 16, frameHeight: 16 } },
  { key: TextureKeys.UiIcons, url: 'assets/ui/icons.png', frame: { frameWidth: 16, frameHeight: 16 } },
  // FEAT-005 sheets.
  { key: TextureKeys.Buildings, url: 'assets/ui/buildings.png', frame: { frameWidth: 24, frameHeight: 24 } },
  { key: TextureKeys.Resources, url: 'assets/ui/resources.png', frame: { frameWidth: 16, frameHeight: 16 } },
  { key: TextureKeys.HeroPortraits, url: 'assets/sprites/hero_portraits.png', frame: { frameWidth: 32, frameHeight: 32 } },
  { key: TextureKeys.GradeFrames, url: 'assets/ui/grade_frames.png', frame: { frameWidth: 32, frameHeight: 32 } },
  { key: TextureKeys.TypeBadges, url: 'assets/ui/type_badges.png', frame: { frameWidth: 16, frameHeight: 16 } },
  { key: TextureKeys.RoleBadges, url: 'assets/ui/role_badges.png', frame: { frameWidth: 16, frameHeight: 16 } },
  { key: TextureKeys.NavIcons, url: 'assets/ui/nav_icons.png', frame: { frameWidth: 20, frameHeight: 20 } },
] as const;

/** Plain single-frame images (gate panel, backgrounds, 9-slice UI). */
export const IMAGES: readonly ImageAsset[] = [
  { key: TextureKeys.Gate, url: 'assets/sprites/gate.png' },
  { key: TextureKeys.BgSkyline, url: 'assets/backgrounds/skyline.png' },
  { key: TextureKeys.BgRoad, url: 'assets/backgrounds/road.png' },
  { key: TextureKeys.UiPanel, url: 'assets/ui/panel.png' },
  { key: TextureKeys.UiButton, url: 'assets/ui/button.png' },
  { key: TextureKeys.UiBarFrame, url: 'assets/ui/bar_frame.png' },
  // FEAT-005 single images.
  { key: TextureKeys.UiStar, url: 'assets/ui/star.png' },
  { key: TextureKeys.UiMedal, url: 'assets/ui/medal.png' },
  { key: TextureKeys.UiTabBar, url: 'assets/ui/tab_bar.png' },
  { key: TextureKeys.BgBattle, url: 'assets/backgrounds/battle.png' },
] as const;

/** Audio assets (WAV plays natively in all evergreen browsers + Phaser WebAudio). */
export const AUDIO: readonly AudioAsset[] = [
/**
 * Audio ships as TWO formats per sound, and the loader picks one.
 *
 * Ogg/Opus is much the smaller - 4352 KB of WAV across the games became 775 KB of
 * Opus - but older iOS Safari cannot play it, and this project targets cheap phones.
 * AAC in m4a plays everywhere. Phaser's loader takes this url ARRAY and requests the
 * first format the browser reports it can play, so a player downloads exactly one;
 * only the repo and the deploy carry both.
 *
 * WAV was replaced because it is uncompressed PCM: gzip cannot shrink it, so the
 * transfer was the raw samples, and audio was measured as the largest single cost in
 * every game - larger than the Phaser engine itself.
 */
  { key: AudioKeys.UiClick, urls: ['assets/audio/ui_click.ogg', 'assets/audio/ui_click.m4a'] },
  { key: AudioKeys.GatePass, urls: ['assets/audio/gate_pass.ogg', 'assets/audio/gate_pass.m4a'] },
  { key: AudioKeys.Shoot, urls: ['assets/audio/shoot.ogg', 'assets/audio/shoot.m4a'] },
  { key: AudioKeys.Hit, urls: ['assets/audio/hit.ogg', 'assets/audio/hit.m4a'] },
  { key: AudioKeys.LevelUp, urls: ['assets/audio/level_up.ogg', 'assets/audio/level_up.m4a'] },
  { key: AudioKeys.Victory, urls: ['assets/audio/victory.ogg', 'assets/audio/victory.m4a'] },
  { key: AudioKeys.Defeat, urls: ['assets/audio/defeat.ogg', 'assets/audio/defeat.m4a'] },
  { key: AudioKeys.MusicLoop, urls: ['assets/audio/music_loop.ogg', 'assets/audio/music_loop.m4a'] },
  // FEAT-005 SFX.
  { key: AudioKeys.Recruit, urls: ['assets/audio/recruit.ogg', 'assets/audio/recruit.m4a'] },
  { key: AudioKeys.UpgradeComplete, urls: ['assets/audio/upgrade_complete.ogg', 'assets/audio/upgrade_complete.m4a'] },
  { key: AudioKeys.BattleHit, urls: ['assets/audio/battle_hit.ogg', 'assets/audio/battle_hit.m4a'] },
  { key: AudioKeys.BattleWin, urls: ['assets/audio/battle_win.ogg', 'assets/audio/battle_win.m4a'] },
  { key: AudioKeys.BattleLose, urls: ['assets/audio/battle_lose.ogg', 'assets/audio/battle_lose.m4a'] },
  { key: AudioKeys.TabSwitch, urls: ['assets/audio/tab_switch.ogg', 'assets/audio/tab_switch.m4a'] },
  { key: AudioKeys.Reward, urls: ['assets/audio/reward.ogg', 'assets/audio/reward.m4a'] },
] as const;

/**
 * Maps an enemy cluster kind to its spritesheet texture key. The run/scene
 * layer (FEAT-003) uses this to pick a unit sprite per cluster. 'walker' and
 * 'runner' are the two rank-and-file survivor kinds; 'boss' is the finale.
 */
export type EnemyKind = 'walker' | 'runner' | 'boss';

export const ENEMY_TEXTURE_BY_KIND: Record<EnemyKind, TextureKey> = {
  walker: TextureKeys.EnemyWalker,
  runner: TextureKeys.EnemyRunner,
  boss: TextureKeys.Boss,
};

/**
 * Frame indices into the packed 16x16 HUD icon sheet (icons.png), in the order
 * drawn by tools/gen_sprites.py: coin, distance, squad, boss.
 */
export const HUD_ICON_FRAME = {
  coin: 0,
  distance: 1,
  squad: 2,
  boss: 3,
} as const;

export type HudIconName = keyof typeof HUD_ICON_FRAME;

/**
 * Frame index into buildings.png (24x24) by building id, in BUILDING_ORDER as
 * emitted by tools/gen_sprites.py. The FEAT-006 Base scene uses this to pick a
 * building icon.
 */
export const BUILDING_ICON_FRAME = {
  hq: 0,
  tech_center: 1,
  parade_ground: 2,
  hospital: 3,
  barracks: 4,
  drone_center: 5,
} as const;

/**
 * Frame index into resources.png (16x16) by resource id, in RESOURCE_ORDER as
 * emitted by tools/gen_sprites.py.
 */
export const RESOURCE_ICON_FRAME = {
  rations: 0,
  steel: 1,
  fuel: 2,
  circuitry: 3,
} as const;

/**
 * Frame index into type_badges.png (16x16) by hero type, in HERO_TYPES order.
 */
export const TYPE_BADGE_FRAME = {
  tank: 0,
  missile: 1,
  aircraft: 2,
} as const;

/**
 * Frame index into role_badges.png (16x16) by hero role, in HERO_ROLES order.
 */
export const ROLE_BADGE_FRAME = {
  dealer: 0,
  tank: 1,
  support: 2,
} as const;

/**
 * Frame index into grade_frames.png (32x32) by hero grade, in HERO_GRADES order.
 */
export const GRADE_FRAME_FRAME = {
  UR: 0,
  SSR: 1,
  SR: 2,
} as const;

/**
 * Compute the hero_portraits.png (32x32) frame index for a type x role pair.
 * The sheet is row-major HERO_TYPES x HERO_ROLES (tank/missile/aircraft x
 * dealer/tank/support), so frame = typeIndex * 3 + roleIndex.
 */
export const HERO_PORTRAIT_TYPE_INDEX = {
  tank: 0,
  missile: 1,
  aircraft: 2,
} as const;

export const HERO_PORTRAIT_ROLE_INDEX = {
  dealer: 0,
  tank: 1,
  support: 2,
} as const;

/**
 * The bottom-nav tabs, in the frame order emitted into nav_icons.png. Each maps
 * to its 20x20 sheet frame index. 'falcon' is the gate-runner mini-game.
 */
export const NAV_ICON_FRAME = {
  base: 0,
  heroes: 1,
  campaign: 2,
  missions: 3,
  season: 4,
  falcon: 5,
} as const;

export type NavIconName = keyof typeof NAV_ICON_FRAME;
