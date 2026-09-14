/**
 * AssetKeys - centralized, typed registry of every runtime asset.
 *
 * The rest of the codebase references these keys (and their frame configs)
 * instead of raw strings, so a rename is a single edit here and TypeScript
 * catches typos. All art/audio is ORIGINAL to this project (see
 * assets/CREDITS.md); files live under public/assets/ and are served under the
 * Vite base path.
 *
 * NOTE on paths: files in public/ are served at the site root, which is
 * import.meta.env.BASE_URL ('/open-games/kingshot/' in production, '/' in dev). Always
 * build load URLs with assetPath() so they resolve under the base path.
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
  // Buildings (each is a 2-tier sheet: worn -> upgraded look).
  TownCenter: 'b_town_center',
  Farm: 'b_farm',
  LumberMill: 'b_lumber_mill',
  Quarry: 'b_quarry',
  Mine: 'b_mine',
  Barracks: 'b_barracks',
  Research: 'b_research',
  Wall: 'b_wall',
  Watchtower: 'b_watchtower',

  // Troop unit sprites (player-side).
  TroopSpearman: 'u_spearman',
  TroopArcher: 'u_archer',
  TroopKnight: 'u_knight',
  TroopCavalry: 'u_cavalry',
  TroopSiege: 'u_siege',

  // Hero portraits (roster / recruitment UI).
  HeroSerAlden: 'h_ser_alden',
  HeroKaraStormblade: 'h_kara_stormblade',
  HeroMiraGoldhand: 'h_mira_goldhand',
  HeroOldBram: 'h_old_bram',

  // Enemy raider sprites (battle).
  EnemyRaider: 'e_raider',
  EnemyBrute: 'e_brute',
  EnemyRam: 'e_ram',
  EnemyRider: 'e_rider',

  // Resource icons (packed 16x16 sheet: food, wood, stone, gold).
  ResourceIcons: 'ui_resource_icons',

  // Backgrounds.
  BgSky: 'bg_sky',
  BgTown: 'bg_town',
  BgBattle: 'bg_battle',

  // FX sheets.
  FxSpark: 'fx_spark',
  FxDust: 'fx_dust',

  // UI kit (9-slice + icon sheet).
  UiPanel: 'ui_panel',
  UiButton: 'ui_button',
  UiBarFrame: 'ui_bar_frame',
  UiIcons: 'ui_icons',
} as const;

export type TextureKey = (typeof TextureKeys)[keyof typeof TextureKeys];

/** Audio keys. */
export const AudioKeys = {
  UiClick: 'sfx_ui_click',
  BuildComplete: 'sfx_build_complete',
  TrainComplete: 'sfx_train_complete',
  BattleHit: 'sfx_battle_hit',
  Victory: 'sfx_victory',
  Defeat: 'sfx_defeat',
  MusicLoop: 'music_loop',
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
 * tools/gen_sprites.py exactly. Each building sheet has 2 frames (tier 0/1).
 */
export const SHEETS: readonly SheetAsset[] = [
  { key: TextureKeys.TownCenter, url: 'assets/sprites/town_center.png', frame: { frameWidth: 64, frameHeight: 64 } },
  { key: TextureKeys.Farm, url: 'assets/sprites/farm.png', frame: { frameWidth: 48, frameHeight: 48 } },
  { key: TextureKeys.LumberMill, url: 'assets/sprites/lumber_mill.png', frame: { frameWidth: 48, frameHeight: 48 } },
  { key: TextureKeys.Quarry, url: 'assets/sprites/quarry.png', frame: { frameWidth: 48, frameHeight: 48 } },
  { key: TextureKeys.Mine, url: 'assets/sprites/mine.png', frame: { frameWidth: 48, frameHeight: 48 } },
  { key: TextureKeys.Barracks, url: 'assets/sprites/barracks.png', frame: { frameWidth: 48, frameHeight: 48 } },
  { key: TextureKeys.Research, url: 'assets/sprites/research.png', frame: { frameWidth: 48, frameHeight: 48 } },
  { key: TextureKeys.Wall, url: 'assets/sprites/wall.png', frame: { frameWidth: 48, frameHeight: 48 } },
  { key: TextureKeys.Watchtower, url: 'assets/sprites/watchtower.png', frame: { frameWidth: 48, frameHeight: 48 } },
  { key: TextureKeys.TroopSpearman, url: 'assets/sprites/troop_spearman.png', frame: { frameWidth: 24, frameHeight: 28 } },
  { key: TextureKeys.TroopArcher, url: 'assets/sprites/troop_archer.png', frame: { frameWidth: 24, frameHeight: 28 } },
  { key: TextureKeys.TroopKnight, url: 'assets/sprites/troop_knight.png', frame: { frameWidth: 24, frameHeight: 28 } },
  { key: TextureKeys.TroopCavalry, url: 'assets/sprites/troop_cavalry.png', frame: { frameWidth: 32, frameHeight: 32 } },
  { key: TextureKeys.TroopSiege, url: 'assets/sprites/troop_siege.png', frame: { frameWidth: 40, frameHeight: 32 } },
  { key: TextureKeys.EnemyRaider, url: 'assets/sprites/enemy_raider.png', frame: { frameWidth: 24, frameHeight: 28 } },
  { key: TextureKeys.EnemyBrute, url: 'assets/sprites/enemy_brute.png', frame: { frameWidth: 32, frameHeight: 36 } },
  { key: TextureKeys.EnemyRam, url: 'assets/sprites/enemy_ram.png', frame: { frameWidth: 40, frameHeight: 32 } },
  { key: TextureKeys.EnemyRider, url: 'assets/sprites/enemy_rider.png', frame: { frameWidth: 32, frameHeight: 32 } },
  { key: TextureKeys.ResourceIcons, url: 'assets/ui/resource_icons.png', frame: { frameWidth: 16, frameHeight: 16 } },
  { key: TextureKeys.FxSpark, url: 'assets/fx/spark.png', frame: { frameWidth: 16, frameHeight: 16 } },
  { key: TextureKeys.FxDust, url: 'assets/fx/dust.png', frame: { frameWidth: 16, frameHeight: 16 } },
  { key: TextureKeys.UiIcons, url: 'assets/ui/icons.png', frame: { frameWidth: 16, frameHeight: 16 } },
] as const;

/** Plain single-frame images (backgrounds, 9-slice UI). */
export const IMAGES: readonly ImageAsset[] = [
  { key: TextureKeys.BgSky, url: 'assets/backgrounds/sky.png' },
  { key: TextureKeys.BgTown, url: 'assets/backgrounds/town.png' },
  { key: TextureKeys.BgBattle, url: 'assets/backgrounds/battle.png' },
  { key: TextureKeys.UiPanel, url: 'assets/ui/panel.png' },
  { key: TextureKeys.UiButton, url: 'assets/ui/button.png' },
  { key: TextureKeys.UiBarFrame, url: 'assets/ui/bar_frame.png' },
  // Hero portraits (single 40x40 frame each).
  { key: TextureKeys.HeroSerAlden, url: 'assets/sprites/hero_ser_alden.png' },
  { key: TextureKeys.HeroKaraStormblade, url: 'assets/sprites/hero_kara_stormblade.png' },
  { key: TextureKeys.HeroMiraGoldhand, url: 'assets/sprites/hero_mira_goldhand.png' },
  { key: TextureKeys.HeroOldBram, url: 'assets/sprites/hero_old_bram.png' },
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
  { key: AudioKeys.BuildComplete, urls: ['assets/audio/build_complete.ogg', 'assets/audio/build_complete.m4a'] },
  { key: AudioKeys.TrainComplete, urls: ['assets/audio/train_complete.ogg', 'assets/audio/train_complete.m4a'] },
  { key: AudioKeys.BattleHit, urls: ['assets/audio/battle_hit.ogg', 'assets/audio/battle_hit.m4a'] },
  { key: AudioKeys.Victory, urls: ['assets/audio/victory.ogg', 'assets/audio/victory.m4a'] },
  { key: AudioKeys.Defeat, urls: ['assets/audio/defeat.ogg', 'assets/audio/defeat.m4a'] },
  { key: AudioKeys.MusicLoop, urls: ['assets/audio/music_loop.ogg', 'assets/audio/music_loop.m4a'] },
] as const;

/**
 * Maps a BuildingKind value to its spritesheet texture key. The buildings
 * feature consumes this so the roster stays in sync with the config.
 */
export const BUILDING_TEXTURE_BY_KIND: Record<string, TextureKey> = {
  town_center: TextureKeys.TownCenter,
  farm: TextureKeys.Farm,
  lumber_mill: TextureKeys.LumberMill,
  quarry: TextureKeys.Quarry,
  mine: TextureKeys.Mine,
  barracks: TextureKeys.Barracks,
  research: TextureKeys.Research,
  wall: TextureKeys.Wall,
  watchtower: TextureKeys.Watchtower,
};

/**
 * Maps a HeroId value to its portrait texture key. The heroes feature consumes
 * this so the roster stays in sync with HeroConfig.
 */
export const HERO_TEXTURE_BY_ID: Record<string, TextureKey> = {
  ser_alden: TextureKeys.HeroSerAlden,
  kara_stormblade: TextureKeys.HeroKaraStormblade,
  mira_goldhand: TextureKeys.HeroMiraGoldhand,
  old_bram: TextureKeys.HeroOldBram,
};

/** Maps a TroopKind value to its spritesheet texture key. */
export const TROOP_TEXTURE_BY_KIND: Record<string, TextureKey> = {
  spearman: TextureKeys.TroopSpearman,
  archer: TextureKeys.TroopArcher,
  knight: TextureKeys.TroopKnight,
  cavalry: TextureKeys.TroopCavalry,
  siege: TextureKeys.TroopSiege,
};

/** Maps a resource kind to its frame index in the packed resource-icon sheet. */
export const RESOURCE_ICON_FRAME: Record<string, number> = {
  food: 0,
  wood: 1,
  stone: 2,
  gold: 3,
};
