/**
 * GameConfig - centralized, config-driven tuning for Kingdom Rise.
 *
 * Kingdom Rise is an ORIGINAL-world medieval strategy / idle game. The player
 * grows a small settlement: resource buildings passively generate food, wood,
 * stone, and gold; a central Town Center gates the level cap of every other
 * building; troops are trained in time-based queues; and the player manually
 * starts each of the 20 deterministic defense battles when ready. All
 * naming, lore, art, and audio are original and role-based; nothing is drawn
 * from any existing IP.
 *
 * Keep balance numbers here so the whole game can be tuned in one place. Later
 * features (economy, buildings, training, combat, save/load) extend the config
 * modules under src/config/ rather than scattering magic numbers.
 */

/**
 * Logical (design) resolution. The canvas scales to fit while preserving this.
 * 960x540 integer-scales nicely to common 1080p/1440p displays and gives the
 * town/battle HUD enough room for panels and resource readouts.
 */
export const CANVAS = {
  WIDTH: 960,
  HEIGHT: 540,
} as const;

/**
 * Physics tuning (arcade). This is a top-down / management view, so there is no
 * gravity; any in-battle movement is planar and driven directly by velocity.
 */
export const PHYSICS = {
  GRAVITY_Y: 0,
} as const;

/**
 * Cohesive medieval pixel-art palette. Values are 0xRRGGBB integers for Phaser
 * tinting and graphics, plus CSS strings where the DOM / text needs them.
 * Warm parchment + stone + timber tones with metallic resource accents.
 */
export const PALETTE = {
  // Backgrounds / terrain.
  BG_SKY: 0x2a3b52,
  BG_SKY_CSS: '#2a3b52',
  BG_DUSK: 0x54415a,
  GRASS: 0x4f7a3a,
  GRASS_DARK: 0x386028,
  DIRT: 0x6b4f30,
  DIRT_DARK: 0x4a3620,
  STONE: 0x8a8378,
  STONE_DARK: 0x5c564d,
  STONE_LIGHT: 0xb4ac9c,
  WOOD: 0x8a5a34,
  WOOD_DARK: 0x5f3d22,

  // Resource accents.
  FOOD: 0xe0b04a,
  FOOD_CSS: '#e0b04a',
  WOOD_RES: 0x9c6b3c,
  WOOD_RES_CSS: '#9c6b3c',
  STONE_RES: 0xb0b0b8,
  STONE_RES_CSS: '#b0b0b8',
  GOLD: 0xf4cf4a,
  GOLD_CSS: '#f4cf4a',

  // UI / text.
  PANEL: 0x2a2418,
  PANEL_CSS: '#2a2418',
  ACCENT: 0xe0b04a,
  ACCENT_CSS: '#e0b04a',
  TEXT: 0xf4ecd8,
  TEXT_CSS: '#f4ecd8',
  MUTED_CSS: '#b9ad93',
  DANGER: 0xc6503c,
  DANGER_CSS: '#c6503c',
  SUCCESS: 0x6fae4f,
  SUCCESS_CSS: '#6fae4f',

  // Combat.
  BANNER_FRIENDLY: 0x5c86c6,
  BANNER_ENEMY: 0xc6503c,
} as const;

/**
 * Idle economy tuning. Resources accrue continuously from building output; the
 * loop ticks on a fixed cadence and offline gains are reconciled on load
 * (implemented in the economy / save features). Values here are the shared
 * baseline the later systems read.
 */
export const ECONOMY = {
  /** Simulation tick length, milliseconds. Output is scaled per tick. */
  TICK_MS: 1000,
  /** Maximum offline time credited on load, seconds (8 hours). */
  MAX_OFFLINE_SECONDS: 8 * 60 * 60,
  /** Fraction of full production rate granted for offline time (idle games cap this). */
  OFFLINE_EFFICIENCY: 0.5,
  /**
   * Starting stockpile for a fresh save. Sized so a new player can reach the
   * early "Town Center Lv.2 -> Barracks -> train first troops" loop within a
   * couple of minutes without hitting a silent resource wall.
   */
  START: { food: 300, wood: 400, stone: 250, gold: 50 },
  /**
   * Base per-resource soft storage cap. Passive production (live and offline)
   * cannot push a stockpile past this cap, so it is a real ceiling the player
   * feels. Research "storage" techs raise it via a multiplier (see
   * ResearchSystem.storageMultiplier), making that branch a genuine, wired
   * effect rather than a dead multiplier. Set generously so early play is never
   * gated, but low enough that late idle production benefits from raising it.
   * Rewards/spending are NOT capped (only passive production is), so battle
   * payouts can still exceed the cap.
   */
  STORAGE_CAP: 5000,
} as const;

/**
 * Building progression tuning. Every building's upgrade cost scales
 * geometrically with its level, and non-Town-Center buildings may not exceed
 * the current Town Center level (the core gating mechanic). Per-building base
 * costs / outputs live in BuildingConfig.ts (added by the buildings feature);
 * these are the shared curve parameters.
 */
export const BUILDINGS = {
  /** Geometric cost growth per level (cost = base * GROWTH^(level-1)). */
  COST_GROWTH: 1.6,
  /** Output growth per level for producers. */
  OUTPUT_GROWTH: 1.35,
  /** Base seconds an upgrade takes at level 1 (scales with level). */
  BASE_BUILD_SECONDS: 4,
  /** Highest level any building can reach. */
  MAX_LEVEL: 20,
} as const;

/**
 * Troop training tuning. Troops are queued at the Barracks and complete after a
 * per-type training time; per-troop stats/costs live in TroopConfig.ts. These
 * are the shared queue parameters.
 */
export const TRAINING = {
  /** Maximum number of batches that can be queued at once. */
  MAX_QUEUE: 6,
  /** Maximum troops in a single batch. */
  MAX_BATCH: 20,
} as const;

/**
 * Wave / combat tuning. Raider waves grow in size and difficulty via
 * composition (never by mutating per-unit stats). Per-wave composition lives in
 * WaveConfig.ts (added by the combat feature).
 */
export const COMBAT = {
  /** Lane length in world px that attackers traverse toward the gate. */
  LANE_LENGTH: 820,
} as const;

/**
 * HEARTH / KEEP WARMTH - a self-contained survival layer ported from the
 * "Frosthold: Last Ember" prototype and re-themed for Kingdom Rise's medieval
 * world. The keep's great Hearth (화롯불) must be kept burning: every tick it
 * consumes firewood to sustain Warmth (온기). While there is wood to burn,
 * warmth climbs toward its ceiling; when the woodpile runs dry the hearth goes
 * cold and warmth decays, throttling idle production toward a floor (a chilled,
 * demoralized town works slower) rather than stopping it outright.
 *
 * RE-THEME NOTE: the Frosthold original burned wood + coal. Kingdom Rise has no
 * coal (its resources are food/wood/stone/gold), so the hearth burns WOOD ONLY
 * - a single, intuitive firewood sink drawn from the same lumber economy. The
 * warmth CEILING and fuel EFFICIENCY are tied to the existing central building,
 * the TOWN CENTER (its level plays the role Frosthold's Furnace did), so no new
 * building is required: raising the Town Center both warms a larger keep and
 * makes every log burn longer.
 *
 * Numbers are balanced against the early economy (ECONOMY.START.wood = 400 and
 * a lumber mill producing a few wood/sec): a base burn of 0.5 wood/sec is a
 * meaningful but non-punishing sink - a town with any lumber income stays warm
 * and at full output, while neglecting wood visibly (but not fatally) bites,
 * sinking production toward WARMTH_PRODUCTION_FLOOR rather than to zero.
 */
export const WARMTH = {
  /** Baseline maximum warmth at Town Center level 1. */
  MAX_WARMTH: 100,
  /** Extra maximum warmth granted per Town Center level above 1. */
  MAX_WARMTH_PER_LEVEL: 20,
  /**
   * Base firewood burned per second at Town Center level 1 to sustain warmth.
   * Wood-only (medieval hearth): the sole fuel is timber from the lumber
   * economy. Higher Town Center levels burn LESS via FUEL_EFFICIENCY_PER_LEVEL
   * (a grander keep gets more heat from every log).
   */
  FUEL_PER_SECOND: { wood: 0.5 },
  /**
   * Rations and stone the townsfolk gather per second while NO producer of that
   * resource stands. An anti-softlock floor, not an economy knob.
   *
   * Note which resources are NOT here: firewood, the fuel. That omission is the
   * whole design. A floor on the fuel itself has to exceed the hearth's burn to
   * let an emptied town accumulate anything - and a floor above the burn means
   * the hearth can never run cold, which deletes the game's central tension. A
   * first attempt did exactly that: gathering timber at 0.8/s against a 0.5/s
   * burn left warmth pinned at maximum and three tests that assert the cold bites
   * started failing.
   *
   * Rescuing through a NON-fuel resource resolves it, because the Lumber Mill -
   * the building that restores firewood income - costs rations and stone and no
   * firewood at all. So a broke town can always earn its way back to a fuel
   * supply while the hearth still goes cold in the meantime, which is exactly the
   * pressure the game wants.
   *
   * Both stop the moment a real producer stands: the Farm makes 2.0/s and the
   * Quarry 1.0/s, so this never shapes a working economy.
   */
  BASELINE_GATHER_PER_SEC: { food: 0.6, stone: 0.4 },
  /**
   * Fractional reduction in fuel burn per Town Center level above 1 (e.g. 0.05
   * = 5% cheaper per level). Clamped so burn never drops below FUEL_MIN_FACTOR
   * of the base, keeping firewood always meaningful.
   */
  FUEL_EFFICIENCY_PER_LEVEL: 0.05,
  /** Lower bound on the fuel-burn multiplier from efficiency (40% of base). */
  FUEL_MIN_FACTOR: 0.4,
  /** Warmth points gained per second while the hearth is fueled. */
  WARMTH_GAIN_PER_SEC: 8,
  /** Warmth points lost per second while the hearth is cold / unfueled. */
  WARMTH_DECAY_PER_SEC: 5,
  /**
   * Production-penalty curve: at full warmth (ratio 1) production runs at 1.0x;
   * at zero warmth it is throttled to WARMTH_PRODUCTION_FLOOR. In between the
   * multiplier scales LINEARLY between the floor and 1.0 with the warmth ratio.
   */
  WARMTH_PRODUCTION_FLOOR: 0.25,
} as const;

/**
 * Pure helper: the idle-production multiplier for a given warmth ratio
 * (current warmth / max warmth, expected in [0,1] but clamped defensively).
 * Linearly interpolates from WARMTH.WARMTH_PRODUCTION_FLOOR at ratio 0 to 1.0
 * at ratio 1, so callers (WarmthSystem, tests, UI) share one curve definition.
 */
export function warmthProductionMultiplier(warmthRatio: number): number {
  const ratio = Math.min(1, Math.max(0, warmthRatio));
  return WARMTH.WARMTH_PRODUCTION_FLOOR + (1 - WARMTH.WARMTH_PRODUCTION_FLOOR) * ratio;
}

/**
 * The four resource kinds, as an ordered tuple so UI and iteration share one
 * canonical order. The ResourceKind union type is derived in src/types.
 */
export const RESOURCE_ORDER = ['food', 'wood', 'stone', 'gold'] as const;

/** Scene keys used across the game. Centralized to avoid magic strings. */
export const SceneKeys = {
  Boot: 'BootScene',
  Preload: 'PreloadScene',
  Title: 'TitleScene',
  Town: 'TownScene',
  Battle: 'BattleScene',
  Settings: 'SettingsScene',
  Pause: 'PauseScene',
  GameOver: 'GameOverScene',
} as const;

export type SceneKey = (typeof SceneKeys)[keyof typeof SceneKeys];
