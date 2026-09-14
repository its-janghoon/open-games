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
 * import.meta.env.BASE_URL ('/open-games/whiteout/' in production, '/' in dev). Always
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
  Furnace: 'b_furnace',
  HuntersHut: 'b_hunters_hut',
  Sawmill: 'b_sawmill',
  CoalPit: 'b_coal_pit',
  IronMine: 'b_iron_mine',
  WarCamp: 'b_war_camp',
  // FEAT-002 expanded city (art added in FEAT-006).
  ShelterRow: 'b_shelter_row',
  FrostVault: 'b_frost_vault',
  ForgeHall: 'b_forge_hall',
  EnvoyHall: 'b_envoy_hall',
  WarmingWard: 'b_warming_ward',
  EmberArchive: 'b_ember_archive',
  InfantryYard: 'b_infantry_yard',
  LancerYard: 'b_lancer_yard',
  MarksmanRange: 'b_marksman_range',

  // Troop unit sprites (player-side).
  TroopTrapper: 'u_trapper',
  TroopMarksman: 'u_marksman',
  TroopVanguard: 'u_vanguard',

  // Frozen Horde enemy sprites (battle).
  EnemyFrostWolf: 'e_frost_wolf',
  EnemyRavager: 'e_ravager',
  EnemyFrostTitan: 'e_frost_titan',
  // FEAT-005 Frostbeast / world-boss sprites (art added in FEAT-006).
  EnemyRimeAlpha: 'e_rime_alpha',
  EnemyGlacierBehemoth: 'e_glacier_behemoth',
  EnemyHoarfrostWyrm: 'e_hoarfrost_wyrm',

  // Hero portrait sheet (32x32 bust per roster hero, HERO_IDS order).
  HeroPortraits: 'ui_hero_portraits',

  // Resource icons (packed 16x16 sheet: food, wood, coal, iron, steel, spark).
  ResourceIcons: 'ui_resource_icons',
  // Hub menu icons (16x16: hero, summon, campaign, research, gear, alliance,
  // arena, quest).
  MenuIcons: 'ui_menu_icons',

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
  // FEAT-006 SFX for the expanded systems.
  Summon: 'sfx_summon',
  LevelUp: 'sfx_level_up',
  ResearchComplete: 'sfx_research_complete',
  BossHit: 'sfx_boss_hit',
  QuestClaim: 'sfx_quest_claim',
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
  { key: TextureKeys.Furnace, url: 'assets/sprites/furnace.png', frame: { frameWidth: 64, frameHeight: 64 } },
  { key: TextureKeys.HuntersHut, url: 'assets/sprites/hunters_hut.png', frame: { frameWidth: 48, frameHeight: 48 } },
  { key: TextureKeys.Sawmill, url: 'assets/sprites/sawmill.png', frame: { frameWidth: 48, frameHeight: 48 } },
  { key: TextureKeys.CoalPit, url: 'assets/sprites/coal_pit.png', frame: { frameWidth: 48, frameHeight: 48 } },
  { key: TextureKeys.IronMine, url: 'assets/sprites/iron_mine.png', frame: { frameWidth: 48, frameHeight: 48 } },
  { key: TextureKeys.WarCamp, url: 'assets/sprites/war_camp.png', frame: { frameWidth: 48, frameHeight: 48 } },
  // FEAT-002 expanded city (all 48x48 2-frame sheets).
  { key: TextureKeys.ShelterRow, url: 'assets/sprites/shelter_row.png', frame: { frameWidth: 48, frameHeight: 48 } },
  { key: TextureKeys.FrostVault, url: 'assets/sprites/frost_vault.png', frame: { frameWidth: 48, frameHeight: 48 } },
  { key: TextureKeys.ForgeHall, url: 'assets/sprites/forge_hall.png', frame: { frameWidth: 48, frameHeight: 48 } },
  { key: TextureKeys.EnvoyHall, url: 'assets/sprites/envoy_hall.png', frame: { frameWidth: 48, frameHeight: 48 } },
  { key: TextureKeys.WarmingWard, url: 'assets/sprites/warming_ward.png', frame: { frameWidth: 48, frameHeight: 48 } },
  { key: TextureKeys.EmberArchive, url: 'assets/sprites/ember_archive.png', frame: { frameWidth: 48, frameHeight: 48 } },
  { key: TextureKeys.InfantryYard, url: 'assets/sprites/infantry_yard.png', frame: { frameWidth: 48, frameHeight: 48 } },
  { key: TextureKeys.LancerYard, url: 'assets/sprites/lancer_yard.png', frame: { frameWidth: 48, frameHeight: 48 } },
  { key: TextureKeys.MarksmanRange, url: 'assets/sprites/marksman_range.png', frame: { frameWidth: 48, frameHeight: 48 } },
  { key: TextureKeys.TroopTrapper, url: 'assets/sprites/troop_trapper.png', frame: { frameWidth: 24, frameHeight: 28 } },
  { key: TextureKeys.TroopMarksman, url: 'assets/sprites/troop_marksman.png', frame: { frameWidth: 24, frameHeight: 28 } },
  { key: TextureKeys.TroopVanguard, url: 'assets/sprites/troop_vanguard.png', frame: { frameWidth: 24, frameHeight: 28 } },
  { key: TextureKeys.EnemyFrostWolf, url: 'assets/sprites/enemy_frost_wolf.png', frame: { frameWidth: 24, frameHeight: 28 } },
  { key: TextureKeys.EnemyRavager, url: 'assets/sprites/enemy_ravager.png', frame: { frameWidth: 32, frameHeight: 36 } },
  { key: TextureKeys.EnemyFrostTitan, url: 'assets/sprites/enemy_frost_titan.png', frame: { frameWidth: 40, frameHeight: 32 } },
  // FEAT-005 Frostbeast / world-boss sprites (larger frames).
  { key: TextureKeys.EnemyRimeAlpha, url: 'assets/sprites/enemy_rime_alpha.png', frame: { frameWidth: 40, frameHeight: 36 } },
  { key: TextureKeys.EnemyGlacierBehemoth, url: 'assets/sprites/enemy_glacier_behemoth.png', frame: { frameWidth: 56, frameHeight: 44 } },
  { key: TextureKeys.EnemyHoarfrostWyrm, url: 'assets/sprites/enemy_hoarfrost_wyrm.png', frame: { frameWidth: 56, frameHeight: 44 } },
  { key: TextureKeys.HeroPortraits, url: 'assets/sprites/hero_portraits.png', frame: { frameWidth: 32, frameHeight: 32 } },
  { key: TextureKeys.ResourceIcons, url: 'assets/ui/resource_icons.png', frame: { frameWidth: 16, frameHeight: 16 } },
  { key: TextureKeys.MenuIcons, url: 'assets/ui/menu_icons.png', frame: { frameWidth: 16, frameHeight: 16 } },
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
  { key: AudioKeys.Summon, urls: ['assets/audio/summon.ogg', 'assets/audio/summon.m4a'] },
  { key: AudioKeys.LevelUp, urls: ['assets/audio/level_up.ogg', 'assets/audio/level_up.m4a'] },
  { key: AudioKeys.ResearchComplete, urls: ['assets/audio/research_complete.ogg', 'assets/audio/research_complete.m4a'] },
  { key: AudioKeys.BossHit, urls: ['assets/audio/boss_hit.ogg', 'assets/audio/boss_hit.m4a'] },
  { key: AudioKeys.QuestClaim, urls: ['assets/audio/quest_claim.ogg', 'assets/audio/quest_claim.m4a'] },
] as const;

/**
 * Maps a BuildingKind value to its spritesheet texture key. The buildings
 * feature consumes this so the roster stays in sync with the config.
 */
export const BUILDING_TEXTURE_BY_KIND: Record<string, TextureKey> = {
  furnace: TextureKeys.Furnace,
  hunters_hut: TextureKeys.HuntersHut,
  sawmill: TextureKeys.Sawmill,
  coal_pit: TextureKeys.CoalPit,
  iron_mine: TextureKeys.IronMine,
  war_camp: TextureKeys.WarCamp,
  // FEAT-002 expanded city — dedicated art now registered (FEAT-006), so the
  // TownScene render-skip for these kinds is now a no-op.
  shelter_row: TextureKeys.ShelterRow,
  frost_vault: TextureKeys.FrostVault,
  forge_hall: TextureKeys.ForgeHall,
  envoy_hall: TextureKeys.EnvoyHall,
  warming_ward: TextureKeys.WarmingWard,
  ember_archive: TextureKeys.EmberArchive,
  infantry_yard: TextureKeys.InfantryYard,
  lancer_yard: TextureKeys.LancerYard,
  marksman_range: TextureKeys.MarksmanRange,
};

/** Maps a TroopKind value to its spritesheet texture key. */
export const TROOP_TEXTURE_BY_KIND: Record<string, TextureKey> = {
  trapper: TextureKeys.TroopTrapper,
  marksman: TextureKeys.TroopMarksman,
  vanguard: TextureKeys.TroopVanguard,
};

/** Maps an EnemyKind value to its spritesheet texture key (bosses included). */
export const ENEMY_TEXTURE_BY_KIND: Record<string, TextureKey> = {
  frost_wolf: TextureKeys.EnemyFrostWolf,
  ravager: TextureKeys.EnemyRavager,
  frost_titan: TextureKeys.EnemyFrostTitan,
  rime_alpha: TextureKeys.EnemyRimeAlpha,
  glacier_behemoth: TextureKeys.EnemyGlacierBehemoth,
  hoarfrost_wyrm: TextureKeys.EnemyHoarfrostWyrm,
};

/**
 * Maps a resource kind to its frame index in the packed resource-icon sheet.
 * Frames: food 0, wood 1, coal 2, iron 3, steel 4, plus the Ember Sparks
 * premium currency at frame 5 (see SPARK_ICON_FRAME).
 */
export const RESOURCE_ICON_FRAME: Record<string, number> = {
  food: 0,
  wood: 1,
  coal: 2,
  iron: 3,
  steel: 4,
};

/** Frame index of the Ember Sparks (premium currency) icon in the sheet. */
export const SPARK_ICON_FRAME = 5;

/** Hero-portrait frame index by hero id, in the packed HeroPortraits sheet. */
export const HERO_PORTRAIT_FRAME: Record<string, number> = {
  ember_warden: 0,
  snow_picket: 1,
  drift_runner: 2,
  iron_bulwark: 3,
  glacier_lance: 4,
  frost_archer: 5,
  aurora_sentinel: 6,
  stormpike_rider: 7,
  winters_eye: 8,
  the_kindled_queen: 9,
  wyrmspear_valdis: 10,
  the_pale_marksman: 11,
};

/** Frame indices in the hub MenuIcons sheet, one per new screen. */
export const MENU_ICON_FRAME = {
  hero: 0,
  summon: 1,
  campaign: 2,
  research: 3,
  gear: 4,
  alliance: 5,
  arena: 6,
  quest: 7,
} as const;
