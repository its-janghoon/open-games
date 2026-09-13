/**
 * GameConfig - centralized, config-driven tuning for Frosthold: Last Ember.
 *
 * Frosthold: Last Ember (서리성채: 마지막 불씨) is an ORIGINAL frozen-survival
 * city-builder / idle game, merely INSPIRED BY the genre - no existing IP. The
 * world is locked in an endless winter and the settlement survives around a
 * central Furnace whose Ember must never go out: resource buildings passively
 * generate food, wood, coal, and iron; the Furnace gates the level cap of every
 * other building; troops are trained in time-based queues; and periodic waves
 * of the Frozen Horde must be repelled in a light tower-defense-flavored
 * battle. All naming, lore, art, and audio are original and role-based.
 *
 * Keep balance numbers here so the whole game can be tuned in one place. Later
 * features (economy, buildings, training, combat, save/load, warmth) extend the
 * config modules under src/config/ rather than scattering magic numbers.
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
 * Cohesive frozen-survival pixel-art palette. Values are 0xRRGGBB integers for
 * Phaser tinting and graphics, plus CSS strings where the DOM / text needs them.
 * Cold blues / whites / steel for the frozen terrain + UI, warmed by the EMBER
 * orange accent radiating from the Furnace. Palette KEY NAMES are kept stable
 * to minimize churn even though the theme is now icy; the extra ICE/FROST/EMBER
 * keys give the frozen scenes room without renaming existing consumers.
 */
export const PALETTE = {
  // Backgrounds / terrain (frozen dusk sky, snow, ice, steel).
  BG_SKY: 0x1d2b3f,
  BG_SKY_CSS: '#1d2b3f',
  BG_DUSK: 0x2f3d5c,
  GRASS: 0xbcd2e4, // snowfield tone (kept key name to avoid churn)
  GRASS_DARK: 0x8fa9c2, // shadowed snow
  DIRT: 0x4a5568, // frozen ground / slate
  DIRT_DARK: 0x333d4d,
  STONE: 0x7f8a99, // frost-worn stone / steel
  STONE_DARK: 0x4c5563,
  STONE_LIGHT: 0xc3ced9,
  WOOD: 0x6a5138, // weathered timber against the snow
  WOOD_DARK: 0x453320,

  // Resource accents (rations, timber, coal, iron).
  FOOD: 0x8fd0c4,
  FOOD_CSS: '#8fd0c4',
  WOOD_RES: 0x9c6b3c,
  WOOD_RES_CSS: '#9c6b3c',
  STONE_RES: 0x4a4f57, // coal: dark charcoal
  STONE_RES_CSS: '#4a4f57',
  GOLD: 0xb9c4cf, // iron: cold steel grey (kept key name to avoid churn)
  GOLD_CSS: '#b9c4cf',

  // Refined + premium accents (steel ingot, Ember Sparks).
  STEEL_RES: 0x8fa6c9, // refined steel: bright blued alloy
  STEEL_RES_CSS: '#8fa6c9',
  SPARK: 0xffd27a, // Ember Sparks premium currency (warm gold-amber)
  SPARK_CSS: '#ffd27a',

  // Signature frozen-survival tones.
  EMBER: 0xff7a3c,
  EMBER_CSS: '#ff7a3c',
  ICE: 0x9fd8ec,
  ICE_CSS: '#9fd8ec',
  FROST: 0xe6f2fb,
  FROST_CSS: '#e6f2fb',

  // UI / text.
  PANEL: 0x18202e,
  PANEL_CSS: '#18202e',
  ACCENT: 0xff7a3c, // warm ember glow against the cold UI
  ACCENT_CSS: '#ff7a3c',
  TEXT: 0xeef4fb,
  TEXT_CSS: '#eef4fb',
  MUTED_CSS: '#93a4b8',
  DANGER: 0x5fb6d6, // biting frost-blue danger
  DANGER_CSS: '#5fb6d6',
  SUCCESS: 0x7ad0a0,
  SUCCESS_CSS: '#7ad0a0',

  // Combat.
  BANNER_FRIENDLY: 0xff7a3c, // the settlement fights under the ember banner
  BANNER_ENEMY: 0x5fb6d6, // the Frozen Horde in cold blue
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
  /** Starting stockpile for a fresh save. `steel` (refined) starts empty. */
  START: { food: 200, wood: 200, coal: 100, iron: 50, steel: 0 },
} as const;

/**
 * REFINERY - the Forge Hall converts raw stock (iron + coal) into refined
 * `steel`, the mid-game material heavier upgrades and later tiers will demand.
 * Conversion is a continuous per-second process gated on having the inputs:
 * each second the Forge Hall consumes INPUT_PER_STEEL of each input per unit of
 * steel it can afford, up to its level-scaled throughput. Pure math lives in
 * BuildingConfig (steelThroughputPerSec) + BuildingSystem.refineryConversion.
 */
export const REFINERY = {
  /** Raw inputs consumed to mint ONE unit of steel. */
  INPUT_PER_STEEL: { iron: 2, coal: 1 } as const,
  /** Steel minted per second by a level-1 Forge Hall (scales by OUTPUT_GROWTH). */
  BASE_STEEL_PER_SEC: 0.15,
} as const;

/**
 * WAREHOUSE - the Frost Vault shelters a fraction of every stockpile from raid
 * loss. It does not cap production; it defines PROTECTED_FRACTION of the
 * current balance (scaled by vault level) that can never be taken. The pure
 * helper protectedAmount() lives in BuildingConfig so combat/raid features and
 * tests share one definition.
 */
export const WAREHOUSE = {
  /** Protected fraction of a stockpile at Frost Vault level 1. */
  BASE_PROTECTED_FRACTION: 0.15,
  /** Extra protected fraction per Frost Vault level above 1. */
  PROTECTED_FRACTION_PER_LEVEL: 0.05,
  /** Hard ceiling on the protected fraction regardless of level. */
  MAX_PROTECTED_FRACTION: 0.75,
} as const;

/**
 * POPULATION - the survivor workforce. Survivors are housed by Shelter Row and
 * assigned to producer buildings; a well-housed, warm population works harder
 * while overcrowding or a freezing hold saps output. This mirrors
 * WarmthSystem's shape so GameState.tick can multiply the two efficiencies.
 *
 *  - Housing capacity = BASE_HOUSING + HOUSING_PER_LEVEL * shelterLevels.
 *  - Survivors trickle in over time toward the housing cap at GROWTH_PER_SEC.
 *  - Satisfaction blends warmth ratio with the housing headroom (crowding);
 *    it drives an output multiplier via populationOutputMultiplier().
 *  - The workforce multiplier also scales with how fully producers are staffed
 *    (assigned survivors vs. desired staffing), floored so an unstaffed base
 *    still limps along rather than stopping.
 */
export const POPULATION = {
  /** Housing capacity with no Shelter Row built (the Furnace shelters a few). */
  BASE_HOUSING: 8,
  /** Extra housing capacity per Shelter Row level. */
  HOUSING_PER_LEVEL: 6,
  /** Survivors that arrive per second (toward the housing cap). */
  GROWTH_PER_SEC: 0.02,
  /** Survivors a fresh hold begins with. */
  START_SURVIVORS: 4,
  /** Survivors pulled in per Recruit action (capped by housing headroom). */
  RECRUIT_BATCH: 3,
  /** Desired survivors to fully staff ONE producer level. */
  STAFF_PER_PRODUCER_LEVEL: 1,
  /** Lowest workforce multiplier when producers are completely unstaffed. */
  STAFFING_FLOOR: 0.35,
  /**
   * Satisfaction curve weights: satisfaction = WARMTH_WEIGHT * warmthRatio +
   * HOUSING_WEIGHT * housingHeadroom, clamped to [0,1]. Housing headroom is
   * 1 when there is spare housing and falls toward 0 as the hold overcrowds.
   */
  SATISFACTION_WARMTH_WEIGHT: 0.6,
  SATISFACTION_HOUSING_WEIGHT: 0.4,
  /** Output multiplier at zero satisfaction (a miserable hold still produces). */
  SATISFACTION_OUTPUT_FLOOR: 0.5,
} as const;

/**
 * PREMIUM - the Ember Sparks soft-premium currency (an ORIGINAL stand-in for a
 * gacha/premium gem). It is NOT an idle resource: it lives in a separate wallet
 * and drips slowly from the lit Furnace (a later feature spends it on summons /
 * boosts). Kept out of RESOURCE_ORDER so it never mixes into production math.
 */
export const PREMIUM = {
  /** Ember Sparks a fresh hold begins with. */
  START_SPARKS: 0,
  /** Ember Sparks the Furnace drips per second while lit (level 1+). */
  SPARK_DRIP_PER_SEC: 0.005,
} as const;

/**
 * Building progression tuning. Every building's upgrade cost scales
 * geometrically with its level, and non-Furnace buildings may not exceed the
 * current Furnace level (the core gating mechanic). Per-building base
 * costs / outputs live in BuildingConfig.ts (added by the buildings feature);
 * these are the shared curve parameters.
 */
export const BUILDINGS = {
  /** Geometric cost growth per level (cost = base * GROWTH^(level-1)). */
  COST_GROWTH: 1.6,
  /** Output growth per level for producers. */
  OUTPUT_GROWTH: 1.35,
  /** Base seconds an upgrade takes at level 1 (scales with level). */
  BASE_BUILD_SECONDS: 5,
  /** Highest level any building can reach. */
  MAX_LEVEL: 20,
} as const;

/**
 * Troop training tuning. Troops are queued at the War Camp and complete after a
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
 * Wave / combat tuning. Frozen Horde waves grow in size and difficulty via
 * composition (never by mutating per-unit stats). Per-wave composition lives in
 * WaveConfig.ts (added by the combat feature).
 */
export const COMBAT = {
  /** Seconds of preparation before the first wave of a battle. */
  PREP_SECONDS: 8,
  /** Lane length in world px that attackers traverse toward the gate. */
  LANE_LENGTH: 820,
} as const;

/**
 * WARMTH - the signature frozen-survival mechanic. The Furnace burns fuel
 * (wood + coal) every tick to hold back a lethal cold, sustaining a Warmth
 * level. While fuel is available warmth climbs toward its max; when the
 * stockpile runs dry warmth decays and idle production is throttled toward a
 * floor. A higher Furnace level raises max warmth AND makes fuel burn more
 * efficiently, so investing in the Ember pays off twice.
 *
 * These are the shared tuning knobs; the pure WarmthSystem (src/systems) reads
 * them. Numbers are balanced so a base with steady wood/coal income stays warm
 * and at full output, while neglecting fuel visibly (but not fatally) bites:
 * production sinks toward WARMTH_PRODUCTION_FLOOR rather than stopping.
 */
export const WARMTH = {
  /** Baseline maximum warmth at Furnace level 1. */
  MAX_WARMTH: 100,
  /** Extra maximum warmth granted per Furnace level above 1. */
  MAX_WARMTH_PER_LEVEL: 20,
  /**
   * Base fuel burned per second at Furnace level 1 to sustain warmth, split
   * across wood and coal. Higher Furnace levels burn LESS via
   * FUEL_EFFICIENCY_PER_LEVEL (the Ember gets more out of every log).
   */
  FUEL_PER_SECOND: { wood: 0.6, coal: 0.4 },
  /**
   * The Furnace level from which COAL joins the fuel mix. Below it the Furnace
   * burns timber only.
   *
   * This exists to break a deadlock, and the number is not free: it must stay
   * <= the `requiresFurnaceLevel` of the building that PRODUCES coal (the Coal
   * Pit, currently 2). Before this gate the level-1 Furnace burned coal from the
   * first second while coal had no producer at all, and the upgrade that unlocks
   * the producer itself cost coal - so a run spent a finite 100 coal at 0.4/s
   * with no way to make more, and the fuel spend being all-or-nothing meant the
   * moment coal hit zero warmth fell to 0, production was throttled to
   * WARMTH_PRODUCTION_FLOOR, and the hold could never afford the pit. That is a
   * permanent soft-lock roughly four minutes into every run.
   */
  COAL_FROM_FURNACE_LEVEL: 2,
  /**
   * Survivors forage this much timber per second with no building at all.
   *
   * This is an ANTI-SOFTLOCK FLOOR, not an economy knob. Both starter producers
   * cost a resource the Furnace also burns - the Sawmill costs coal, the
   * Hunter's Hut costs timber - so a hold could reach a state with zero timber,
   * zero coal and no producer, where every affordable action was gone and income
   * was nil. Nothing in the game could recover that; it was a dead save.
   *
   * Kept deliberately tiny: the Sawmill produces 1.6/s, so once anything real is
   * standing this is rounding error, but it guarantees the cheapest producer is
   * always eventually affordable.
   */
  BASELINE_FORAGE_WOOD_PER_SEC: 0.2,
  /**
   * Fractional reduction in fuel burn per Furnace level above 1 (e.g. 0.05 =
   * 5% cheaper per level). Clamped so burn never drops below FUEL_MIN_FACTOR of
   * the base, keeping fuel always meaningful.
   */
  FUEL_EFFICIENCY_PER_LEVEL: 0.05,
  /** Lower bound on the fuel-burn multiplier from efficiency (40% of base). */
  FUEL_MIN_FACTOR: 0.4,
  /** Warmth points gained per second while the Furnace is fueled. */
  WARMTH_GAIN_PER_SEC: 8,
  /** Warmth points lost per second while unfueled / cold. */
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
export const RESOURCE_ORDER = ['food', 'wood', 'coal', 'iron', 'steel'] as const;

/**
 * Pure helper: the producer-output multiplier from the survivor workforce,
 * mirroring {@link warmthProductionMultiplier} in shape. It blends two effects
 * so callers (PopulationSystem, GameState.tick, tests, UI) share one curve:
 *
 *  - `satisfaction` in [0,1] scales output from SATISFACTION_OUTPUT_FLOOR (a
 *    miserable but not idle hold) up to 1.0 (fully content).
 *  - `staffingRatio` in [0,1] (assigned survivors / desired staffing) scales
 *    output from STAFFING_FLOOR (skeleton crew) up to 1.0 (fully staffed).
 *
 * The two factors multiply, so a warm, well-housed AND well-staffed hold reaches
 * 1.0x while neglect on either axis bites (but never stops) production.
 */
export function populationOutputMultiplier(satisfaction: number, staffingRatio: number): number {
  const sat = Math.min(1, Math.max(0, satisfaction));
  const staff = Math.min(1, Math.max(0, staffingRatio));
  const satFactor =
    POPULATION.SATISFACTION_OUTPUT_FLOOR + (1 - POPULATION.SATISFACTION_OUTPUT_FLOOR) * sat;
  const staffFactor = POPULATION.STAFFING_FLOOR + (1 - POPULATION.STAFFING_FLOOR) * staff;
  return satFactor * staffFactor;
}

/**
 * HEROES - the collectible-hero progression layer (FEAT-003). Heroes level up
 * with XP, star up by spending shards, and their aggregate bonuses (from the
 * LEAD picks) feed BOTH idle production and combat power so heroes MATTER. Pure
 * per-hero data + the base bonus tables live in HeroConfig.ts; these are the
 * shared curve knobs so nothing hardcodes a magic number in the systems.
 */
export const HEROES = {
  /** How many lead heroes contribute their bonuses to the whole hold at once. */
  MAX_LEAD: 3,
  /** Base XP to go from level 1 -> 2 (scales geometrically by LEVEL_XP_GROWTH). */
  BASE_LEVEL_XP: 100,
  /** Geometric growth of the level-up XP cost per level. */
  LEVEL_XP_GROWTH: 1.35,
  /** Hard level ceiling any hero can reach at max stars. */
  MAX_LEVEL: 60,
  /**
   * Level ceiling granted PER star. A 1-star hero caps at LEVEL_CAP_PER_STAR,
   * a 2-star at 2x, etc., clamped to MAX_LEVEL. Investing shards to star up
   * therefore unlocks more levels (mirrors the genre's star/level gate).
   */
  LEVEL_CAP_PER_STAR: 10,
  /** Multiplicative power gained per level above 1 (e.g. 0.06 = +6%/level). */
  POWER_PER_LEVEL: 0.06,
  /** Multiplicative power gained per star above 1 (e.g. 0.25 = +25%/star). */
  POWER_PER_STAR: 0.25,
  /**
   * Shards needed to raise a hero from star s -> s+1 = BASE_STAR_SHARDS *
   * STAR_SHARD_GROWTH^(s-1), scaled per rarity by HERO_RARITY_DEFS.shardScale.
   * The FIRST copy (owning the hero) also costs BASE_STAR_SHARDS * scale shards
   * when crafted from loose shards instead of pulled.
   */
  BASE_STAR_SHARDS: 10,
  STAR_SHARD_GROWTH: 1.8,
  /**
   * A hero's skill of index i unlocks at star (i+1): skill 0 from 1 star, skill
   * 1 from 2 stars, skill 2 from 3 stars. Skill level tracks the hero's star at
   * unlock time and rises with further star-ups, capped at the star rank.
   */
  /**
   * Ember Sparks a single hero-training action spends, and the XP that spend
   * grants. Training a hero at the Warming Ward converts premium sparks into
   * experience (an ORIGINAL take on the genre's XP tomes) so heroes can be
   * levelled from the Hero screen. GameState.trainHero uses these; the pure
   * spark->XP helper heroTrainXp() keeps the number out of the systems.
   */
  TRAIN_SPARK_COST: 20,
  TRAIN_XP_PER_SPARK: 15,
} as const;

/**
 * Pure helper: the hero XP granted for spending `sparks` Ember Sparks on
 * training (sparks * HEROES.TRAIN_XP_PER_SPARK, floored to whole XP). Shared by
 * GameState.trainHero and its test so the conversion lives in one place.
 */
export function heroTrainXp(sparks: number): number {
  return Math.max(0, Math.floor(sparks) * HEROES.TRAIN_XP_PER_SPARK);
}

/**
 * SUMMON - the deterministic gacha (FEAT-003). A pull costs Ember Sparks (the
 * PremiumWallet premium currency) or a summon ticket, rolls a rarity by weights,
 * and grants either a new hero (first copy) or shards (duplicate). A PITY
 * guarantee forces at least an epic after PITY_THRESHOLD misses so a dry streak
 * can't go forever. Deterministic under an injected seed (SummonSystem never
 * calls Math.random) so tests are stable.
 */
export const SUMMON = {
  /** Ember Sparks spent per single summon. */
  SPARK_COST: 100,
  /**
   * Draw weights per rarity (need not sum to 1; normalized at roll time). Tuned
   * so commons dominate and legendaries are rare, mirroring the genre.
   */
  RARITY_WEIGHTS: { common: 60, rare: 28, epic: 10, legendary: 2 } as const,
  /**
   * Consecutive non-(epic+) pulls after which the NEXT pull is guaranteed to be
   * at least epic. Resets to 0 whenever an epic+ is pulled (by luck or pity).
   */
  PITY_THRESHOLD: 20,
  /** Shards granted when a summon rolls a hero already owned (a duplicate). */
  DUPLICATE_SHARDS: { common: 4, rare: 6, epic: 10, legendary: 20 } as const,
} as const;

/**
 * CAMPAIGN - the staged story/exploration mode (FEAT-003). Stages are gated by
 * the highest cleared stage, validated by a deterministic power comparison
 * (reusing the CombatSystem power model where possible), and grant first-clear
 * rewards (resources / Ember Sparks / hero shards) exactly once. Per-stage data
 * lives in CampaignConfig.ts; this is the shared knob.
 */
export const CAMPAIGN = {
  /**
   * The army-power margin (as a fraction of the stage's required power) an
   * attempt must MEET or exceed to clear. 1.0 = must match the stage power;
   * <1 would let under-power attempts win. Kept at 1.0 so the recommended power
   * is honest.
   */
  CLEAR_POWER_MARGIN: 1.0,
} as const;

/**
 * RESEARCH - the multi-branch tech tree (FEAT-004). Nodes are researched ONE at
 * a time at the Ember Archive on a timer; a completed node's typed bonus is
 * permanent and folds into the shared StatModifiers bundle. Per-node data
 * (branch, prereqs, gate level, cost, duration, bonus) lives in
 * ResearchConfig.ts; these are the shared knobs so nothing hardcodes a magic
 * number in ResearchSystem.
 */
export const RESEARCH = {
  /** The building whose level gates research nodes (the academy). */
  LAB_BUILDING: 'ember_archive',
} as const;

/**
 * GEAR - the chief-gear + charm layer (FEAT-004). Six original gear slots are
 * forged/upgraded with materials; each level adds a typed bonus to the shared
 * StatModifiers bundle, and a socketed charm adds more. Per-slot/charm data
 * lives in GearConfig.ts; these are the shared curve knobs.
 */
export const GEAR = {
  /** Highest level any single gear slot can reach. */
  MAX_GEAR_LEVEL: 10,
  /** Highest level any charm can reach. */
  MAX_CHARM_LEVEL: 5,
  /** Geometric growth of a gear-slot upgrade cost per level. */
  GEAR_COST_GROWTH: 1.5,
  /** Geometric growth of a charm upgrade cost per level. */
  CHARM_COST_GROWTH: 1.6,
} as const;

/**
 * TROOP_TIERS - the shared troop-tier curve (FEAT-004). Each troop kind has T1
 * upward; per-tier stats/costs scale geometrically off the T1 baseline in
 * TroopConfig. The highest trainable tier is gated by completed research
 * (nodes that grant a `troopTier` bonus). These are the shared curve params.
 */
export const TROOP_TIERS = {
  /** Highest troop tier that can EVER be unlocked (research permitting). */
  MAX_TIER: 4,
  /** Per-tier multiplicative stat growth above T1 (attack/hp/etc). */
  STAT_GROWTH: 1.4,
  /** Per-tier multiplicative training-cost growth above T1. */
  COST_GROWTH: 1.5,
  /** Per-tier multiplicative train-time growth above T1. */
  TIME_GROWTH: 1.25,
} as const;

/**
 * RALLY - world-boss / Frostbeast rallies (FEAT-005). A boss carries a huge HP
 * pool depleted across MANY attempts; the player's per-attempt damage plus a
 * DETERMINISTIC simulated-alliance contribution chip it down, and tiered
 * rewards pay out by the fraction of the pool destroyed (and a kill bonus). All
 * single-player: the "alliance" is an AI contribution, no servers. Per-boss HP
 * / rewards live in RallyConfig.ts; these are the shared knobs.
 */
export const RALLY = {
  /**
   * Fraction of the player's own attempt damage that the simulated alliance
   * adds on top (0.5 = NPC members contribute half again as much as the player
   * did this attempt). Deterministic, so a rally's progress is reproducible.
   */
  ALLIANCE_DAMAGE_SHARE: 0.5,
  /**
   * Reward-tier thresholds as FRACTIONS of the boss HP pool the cumulative
   * damage must reach to unlock each successive tier. The final entry (1.0) is
   * the kill tier. Ascending; RallySystem grants each newly-reached tier once.
   */
  REWARD_TIER_THRESHOLDS: [0.25, 0.5, 0.75, 1.0] as const,
} as const;

/**
 * ARENA - the simulated PvP ladder (FEAT-005). Opponents are AI power profiles
 * generated deterministically from their ladder rank + a seed; a battle-power
 * comparison decides win/loss, the player climbs on a win and slips on a loss,
 * and rewards scale with rank. No networking. These are the shared knobs.
 */
export const ARENA = {
  /** The lowest (numerically largest) rank a fresh player starts at. */
  START_RANK: 50,
  /** The best rank attainable (1 = champion). */
  TOP_RANK: 1,
  /**
   * Base power an opponent at the WORST rank fields; the profile scales UP as
   * rank improves (toward rank 1) by RANK_POWER_GROWTH per rank climbed, so
   * higher ranks are genuinely harder.
   */
  BASE_OPPONENT_POWER: 400,
  /** Multiplicative opponent-power growth per rank climbed toward the top. */
  RANK_POWER_GROWTH: 1.08,
  /**
   * Deterministic +/- variance applied to an opponent's generated power from
   * the match seed (0.2 = up to +/-20%), so equal-rank rematches differ but
   * stay reproducible.
   */
  POWER_VARIANCE: 0.2,
  /** Ranks gained per win (capped at TOP_RANK). */
  RANK_GAIN_PER_WIN: 1,
  /** Ranks lost per loss (capped at START_RANK). */
  RANK_LOSS_PER_LOSS: 1,
  /** Ember Sparks awarded per arena win, scaled by how high the rank is. */
  WIN_SPARKS_BASE: 8,
} as const;

/**
 * ALLIANCE - the simulated NPC alliance (FEAT-005). A fixed roster of AI
 * members generates "help" charges over time that each shave a fixed slice off
 * the player's active build/research timers, and an alliance-tech contribution
 * track (points -> level) grants a shared StatModifiers bonus. No servers.
 */
export const ALLIANCE = {
  /** Number of fixed NPC members in the simulated alliance. */
  MEMBER_COUNT: 20,
  /** Milliseconds a single "help" shaves off an active timer. */
  HELP_REDUCTION_MS: 60_000,
  /** Maximum help charges that can be banked at once. */
  MAX_HELPS: 30,
  /** Real milliseconds of play the AI members take to generate ONE help charge. */
  HELP_GEN_INTERVAL_MS: 5 * 60_000,
  /** Exact cumulative thresholds for alliance tech levels 1..10. */
  TECH_THRESHOLDS: [100, 250, 475, 813, 1319, 2078, 3217, 4926, 7489, 11333] as const,
  /** Alliance-tech points awarded by one paid direct contribution. */
  DIRECT_CONTRIBUTION_POINTS: 10,
  /** Direct contributions are debounced for one second. */
  CONTRIBUTION_DEBOUNCE_MS: 1_000,
  /** Highest alliance-tech level attainable. */
  MAX_TECH_LEVEL: 10,
  /**
   * The shared StatModifiers bonus GRANTED PER alliance-tech level (additive
   * fractions): a small all-round economy + army lift, so contributing to the
   * alliance measurably helps the whole hold.
   */
  TECH_BONUS_PER_LEVEL: { economyOutput: 0.02, troopAttack: 0.015 } as const,
} as const;

/**
 * QUESTS - daily quests, growth/beginner milestones, and time-boxed events
 * (FEAT-005). Dailies reset on a day boundary derived from an injected clock;
 * milestones are one-time; an event runs for a fixed window granting a bonus
 * multiplier. Per-quest data lives in QuestConfig.ts; these are shared knobs.
 */
export const QUESTS = {
  /** Milliseconds in a day (the daily-reset boundary granularity). */
  DAY_MS: 24 * 60 * 60 * 1000,
  /** Default duration of a daily event window, milliseconds. */
  EVENT_DURATION_MS: 24 * 60 * 60 * 1000,
} as const;

/**
 * VIP - the VIP progression (FEAT-005). VIP points accumulate from spending /
 * activity and map to a VIP LEVEL; each level grants permanent QoL / stat
 * bonuses expressed as a shared StatModifiers bundle. These are shared knobs;
 * the per-level point thresholds + bonuses derive from them in VipConfig.ts.
 */
export const VIP = {
  /** Exact cumulative activity thresholds for VIP levels 1..12. */
  THRESHOLDS: [100, 260, 516, 926, 1581, 2630, 4307, 6992, 11287, 18159, 29154, 46746] as const,
  /** Highest VIP level attainable. */
  MAX_LEVEL: 12,
  /**
   * The shared StatModifiers bonus granted PER VIP level (additive fractions):
   * a QoL blend of faster builds + more idle output, so VIP is permanent and
   * always useful.
   */
  BONUS_PER_LEVEL: { economyOutput: 0.015, buildSpeed: 0.02 } as const,
} as const;

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
  // FEAT-006: player-facing screens for the expanded systems, reachable from
  // the Town hub and back.
  Hero: 'HeroScene',
  Summon: 'SummonScene',
  Campaign: 'CampaignScene',
  Research: 'ResearchScene',
  Gear: 'GearScene',
  Alliance: 'AllianceScene',
  Arena: 'ArenaScene',
  Quests: 'QuestsScene',
} as const;

export type SceneKey = (typeof SceneKeys)[keyof typeof SceneKeys];
