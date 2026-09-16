import Phaser from 'phaser';
import {
  CHAMPIONS,
  getChampionById,
  type Champion,
  type Ability,
} from '../../data/champions';
import {
  advanceAttackCooldown,
  applyHeal,
  areHostile,
  createCooldownState,
  distance,
  nearestTargetableEnemy,
  partitionImpacts,
  persistentEnemy,
  projectileImpactTime,
  resetAttackCooldown,
  resolveAbility,
  startCooldown,
  tickCooldowns,
  type CooldownKey,
  type CooldownState,
  type StructureLine,
  type Team,
  type Unit,
  type Vec2,
} from '../combat';
import { decideAction, type AiIntent, type AiSnapshot } from '../ai';
import { GhostRecorder, intentForAction, type PlayerAction } from '../ghostRecorder';
import { ghostDecide, type GhostPolicy } from '../ghost';
import {
  createAdoptedWorld,
  moveUnitToward as moveUnitTowardPure,
  type AdoptedWorld,
} from '../worldStep';
import type { GhostObservation } from '../ghost';
import { ghostForOpponent, saveLearnedGhost } from '../../profile/ghostStore';
import { loadProfile, saveProfile } from '../../profile';
import {
  lowestHpRatioHostile,
  resolveDashEndpoint,
} from '../abilitySemantics';
import { shouldDeployHeldWarden } from '../wardenPolicy';
import {
  battleStore,
  DEFAULT_DIFFICULTY,
  DEFAULT_MATCH_KIND,
  type AuthorityMatchRequest,
  type BattleCommand,
  type BattleOutcome,
  type GameMode,
  type QueuedBattleCommand,
} from '../battleStore';
import {
  activeLanesForMode,
  rulesForMode,
  type MatchModeRules,
} from '../../config/matchRules';
import {
  advanceChampionLife,
  championLifeTimerRemaining,
  createChampionLifeState,
  isChampionDamageable,
  isChampionPresent,
  killChampion,
  type ChampionLifeState,
} from '../championLifeState';
import {
  matchPhaseAt,
  resolveMatch,
  type MatchResolution,
} from '../matchResolution';
import { isDecided, RECALL_SECONDS, teamGold } from '../rift/matchFlow';
import {
  DIFFICULTY_CONFIG,
  type Difficulty,
  type MatchKind,
} from '../tutorial/config';
import { audio } from '../audio';
import {
  applyArmor,
  applyBurn,
  applyDamageWithEffects,
  applyMovementBuff,
  applyPull,
  applyShield,
  applySlow,
  cleanseSlows,
  createEffectState,
  expireEffects,
  readMovementBuff,
  readPull,
  readSlow,
  type EffectState,
} from '../effects';

// --- Rift pure modules (all Phaser-free, unit tested) --------------------
import {
  WORLD_SIZE,
  type Lane,
  type MapSide,
  LANES,
  STRUCTURES,
  BASE_POSITIONS,
  LANE_WAYPOINTS,
  laneWaypoints,
  RIVER_ANCHORS,
  EPIC_PITS,
} from '../rift/map';
import {
  worldToScreen,
  screenToWorld,
  depthFor,
  projectionScale,
  projectedWorldBounds,
  HEIGHT_SCALE,
  DEFAULT_PROJECTION,
} from '../rift/iso';
import {
  type ChampionPose,
  type SpriteSize,
} from '../render/sprites';
import {
  sheetManifest,
  championSheetKey,
  minionSheetKey,
  structureSheetKey,
  markerSheetKey,
  vfxSheetKey,
  resolveChampionSheetId,
  frameForPose,
  CHAMPION_FRAME,
  MINION_FRAME,
  STRUCTURE_FRAME,
  MARKER_FRAME,
  VFX_FRAME,
  CHAMPION_FOOT_FRAC,
  MINION_FOOT_FRAC,
  STRUCTURE_FOOT_FRAC,
  MARKER_FOOT_FRAC,
} from '../render/sheets';
import type { VfxKind } from '../render/svgArt';
import {
  classifyHit,
  shakeForHit,
  structureDestructionShake,
  sparkCountForHit,
  knockbackForHit,
  knockbackDir,
  popupStyleForHit,
  type HitImportance,
  type ShakeSpec,
} from '../render/juice';
import {
  buildStructureGraph,
  isStructureTargetable,
  isInhibitorAlive,
  type StructureNode,
} from '../rift/structures';
import {
  spawnMinion,
  advanceMinion,
  minionStats,
  type Minion as RiftMinion,
  type MinionType,
} from '../rift/minions';
import {
  type ChampionLevel,
  type GoldState,
  STARTING_GOLD,
  addXp,
  advanceGold,
} from '../rift/economy';
import { composeTeams, enemyFacingSlot } from '../rift/teams';
import { resolveAutoAttacks, type AutoAttacker } from '../rift/autoAttack';
import { planBasicAttack } from '../rift/basicAttack';
import { planWardenSpend, wardenTargetOrder } from '../rift/wardenSpend';
import { planCast, type CastActor } from '../rift/abilityEffects';
import { advanceBaron, advanceBuffs, advanceWardenCharges } from '../rift/fieldState';
import { resolveTraps, trapIdFor } from '../rift/traps';
import {
  CHRONO_PROC_SECONDS,
  resolveImpactHits,
  shouldProcChrono,
} from '../rift/impactTargeting';
import { classifyVictim, resolveKill } from '../rift/killRewards';
import {
  computeEffectiveStats,
  recommendBuild,
  recommendPurchase,
} from '../rift/loadout';
import { totalModifiers } from '../../data/items';
import {
  createBuffState,
  applyBuff,
  BUFF_EFFECTS,
  CAMPS,
  type Camp,
  type BuffState,
} from '../rift/jungle';
import {
  addModifiers,
  applyBaronBuff,
  dragonStackBonus,
  heraldReward,
  monsterStats,
  noBaronBuff,
  isHeraldWindowOpen,
  type TeamModifiers,
} from '../rift/objectives';
import type { EpicMonster } from '../rift/economy';
import { attemptPurchase } from '../inventory';
import { addTravelled, openDashWindow, passiveKeys } from '../rift/passives';
import { scheduleDueWaves } from '../rift/waveSchedule';
import {
  canAfford,
  initialResource,
  regenerateResource,
  spendResource,
  type ResourceState,
} from '../rift/resources';
import {
  createLearningState,
  currentLearningStep,
  learningRequirementsCompleted,
  recordLearningAction,
  skipCurrentLearningStep,
  LEARNING_STEPS,
  type LearningAction,
  type LearningState,
} from '../tutorial/flow';

/** Data passed into the scene from React via `scene.start(key, data)`. */
export interface BattleSceneData {
  playerChampionId: string;
  enemyChampionId: string;
  mode: GameMode;
  onGameEnd: (outcome: BattleOutcome) => void;
  /** Initial OS preference; PhaserGame forwards runtime changes via setReducedMotion. */
  reducedMotion?: boolean;
  /** Fires after create, bounded critical-texture settlement, and initial visual sync. */
  onSceneReady?: () => void;
  matchId: string;
  matchSeed: string;
  matchKind?: MatchKind;
  difficulty?: Difficulty;
  /**
   * A ghost code the player asked to fight, or undefined for the ordinary AI.
   *
   * Threaded through the scene DATA rather than read from storage inside the scene, so
   * the choice travels with the match it belongs to. A scene that reached into the
   * profile itself would silently change an in-progress match when the profile changed,
   * and would make "which opponent am I fighting" unanswerable from the match request.
   */
  ghostCode?: string;
}

// Canvas dimensions (kept in sync with PhaserGame). The 3000x3000 rift world is
// scaled uniformly into the canvas, leaving a small margin.

/**
 * Battle-camera tuning. The projection (see {@link ./rift/iso}) fits the WHOLE
 * world diamond into the 900x640 view; the Phaser camera is layered on top to
 * ZOOM IN on the player's champion and FOLLOW it so only a portion of the map
 * uses a focused arena camera. The whole map still lives on the HUD minimap.
 *   - CAMERA_ZOOM: >1 magnifies; ~2.4 shows a champion + immediate surroundings
 *     (nearby turret / minions) without revealing the whole map.
 *   - CAMERA_LERP: follow smoothing (0..1 per axis); small = gentle pan.
 *   - CAMERA_BOUNDS_PADDING: screen px added around the projected diamond so the
 *     camera can keep the champion centred near the map edges.
 */
/**
 * Camera magnification over the projected world. Raised from 2 to 2.8: at 2 the
 * un-rotated world (860x600 logical px) sat far enough back that the lane read
 * as a distant diagram rather than a battlefield. 2.8 puts the viewport at
 * ~587x229 world-screen units, still comfortably INSIDE the world so the
 * zero-padding camera bounds never expose void.
 */
const CAMERA_ZOOM = 2.8;
const CAMERA_LERP = 0.1;

/**
 * RENDER SMOOTHING (judder fix).
 *
 * The simulation advances in FIXED {@link SIMULATION_TICK_SECONDS} steps from an
 * accumulator, but the display does not run at exactly 60Hz - measured on a
 * software-rendered box this scene draws at ~55fps (mean frame 18.1ms, stdev
 * 2.7ms, worst 33.7ms) against a 16.67ms tick. Because the mean frame is LONGER
 * than one tick the accumulator periodically spends TWO ticks in a single frame,
 * so a unit whose screen position was written straight from `unit.pos` advanced
 * double distance on those frames and single on the rest: a rhythmic stutter,
 * which is what read as the world "shaking".
 *
 * The fix is render-only: ease the drawn container toward the simulated point
 * instead of snapping to it. `unit.pos` and every timer are untouched, so
 * determinism is unchanged - this only decouples what is DRAWN from the tick
 * boundary. Time-constant form (not a fixed per-frame factor) so the smoothing
 * behaves identically at any frame rate.
 */
const RENDER_SMOOTH_TAU_MS = 30;

/**
 * Above this screen distance the drawn position SNAPS instead of easing, so a
 * teleport - spawn, respawn, recall, a blink ability - never slides the sprite
 * across the map. Ordinary movement is a few px per frame, well under this.
 */
const RENDER_SNAP_DISTANCE_PX = 72;
/**
 * Screen padding added around the projected world for the camera's scroll
 * bounds. ZERO: the camera clamps exactly at the world edge.
 *
 * This was 220, which let the camera scroll a fifth of a screen PAST the world
 * on every side so the champion could stay perfectly centred near a corner. The
 * cost was visible black void beyond the map edge - tolerable when the world
 * projected larger than the viewport, glaring once the projection was
 * un-rotated (the world now spans 860x600 logical px while the camera viewport
 * at CAMERA_ZOOM is only ~822x320, so the viewport fits INSIDE the world and any
 * padding at all is pure void). Clamping instead stops the camera at the edge
 * and lets the champion sit off-centre there, which is what every lane-pusher
 * does.
 */
const CAMERA_BOUNDS_PADDING = 0;

const NEXUS_HP = 5500;
const NEXUS_TURRET_HP = 2700;
const TURRET_HP = 2000;
const INHIBITOR_HP = 2400;
const TURRET_RANGE = 260;
const TURRET_DAMAGE = 152;
const TURRET_ATTACK_SPEED = 0.83;
const SIMULATION_TICK_SECONDS = 1 / 60;
const MAX_STEPS_PER_RENDER = 12;
const HUD_INTERVAL_SECONDS = 0.1;
const BASIC_PROJECTILE_SPEED = 1650;
const SKILLSHOT_PROJECTILE_SPEED = 1350;
const OBJECTIVE_ATTACK_RANGE = 280;
const OBJECTIVE_LEASH_RANGE = 520;

/** Bounded cosmetic/runtime populations; authoritative impacts are never budgeted. */
const MAX_TRANSIENT_VFX = 96;
const MAX_DAMAGE_TEXTS = 24;
const RESERVED_DAMAGE_TEXT_SLOTS = MAX_DAMAGE_TEXTS;
const MAX_LIVE_MINIONS_PER_SIDE_LANE = 24;
const WAVE_SPAWN_RETRY_SECONDS = 0.75;
const CRITICAL_TEXTURE_TIMEOUT_MS = 2500;
const CHAMPION_DEATH_POSE_MS = 420;

/** The base ability pool every champion starts from, before item and buff bonuses. */
const BASE_RESOURCE_POOL = 300;
/** Fountain top-up, as a fraction of the pool per second. Distinct from the baseline regen rate, which resources.ts owns. */
const FOUNTAIN_RESOURCE_FRACTION = 0.08;

const CHAMPION_POSE_HOLD_MS = {
  attack: 180,
  cast: 280,
  hit: 140,
} as const;

// How far (screen px) each entity's billboard is lifted off its ground point,
// so it reads as "standing" in the dimetric view. Structures are taller; the
// nexus is tallest.
const CHAMPION_HEIGHT_PX = 26;
const MINION_HEIGHT_PX = 14;
// Structures are lifted LESS than before so they don't stack into a vertical
// "wall of towers"; combined with the smaller baked structure sprites this
// keeps champions the focal figures (size-balance tuning pass).
const TURRET_HEIGHT_PX = 20;
const INHIBITOR_HEIGHT_PX = 15;
const NEXUS_HEIGHT_PX = 30;

/**
 * Convert a world coordinate (0..3000) to the FLAT gameplay-plane pixel space.
 *
 * IMPORTANT render model: `unit.pos` and ALL gameplay math (movement, distance,
 * attackRange, moveSpeed, clampX/clampY, aim) live in WORLD units -- 0..WORLD_SIZE
 * on both axes. Only the DRAWING is projected, through the FEAT-001 dimetric
 * projection (see {@link project}).
 *
 * Gameplay used to live in a flat pixel space derived from SCALE, and SCALE was
 * computed from the VIEWPORT. So every range and speed silently depended on the
 * window size: two peers with different window sizes computed different distances
 * from identical inputs, and the divergence would have looked like a netcode bug.
 *
 * World units are also what let this scene call the pure rift/ steps at all. Those
 * are world-space by construction, so a rule shared between the scene and the
 * simulation can have ONE implementation instead of one per coordinate system.
 */
/**
 * Project a flat gameplay-plane pixel to its on-screen dimetric position. This
 * is the single place the flat plane becomes 2.5D: pixel -> world -> screen.
 */
/**
 * Scale a WORLD length into a screen length.
 *
 * Only for lengths drawn at an already-projected point (a circle radius, a stroke width). Positions must go through
 * {@link project} instead — a projection is not a uniform scale, so a position cannot be recovered from a length.
 */
function worldLengthToScreen(world: number): number {
  return Math.max(5, world * projectionScale(DEFAULT_PROJECTION).sx);
}

/**
 * An Entity reduced to what an ability decision needs.
 *
 * `present` uses the champion life phase rather than `!dead`, matching the original ally filter — a respawning champion is
 * not dead but is not a valid heal target either.
 */
function castActorFor(entity: Entity, life: ChampionLifeState | undefined): CastActor {
  return {
    id: entity.unit.id,
    team: entity.unit.team,
    pos: { ...entity.unit.pos },
    hp: entity.unit.hp,
    maxHp: entity.unit.maxHp,
    abilityPower: entity.abilityPower ?? 0,
    // Passed in rather than read off the entity: champion life lives in `world.lives` now, and a module-level helper has
    // no way to reach it. An entity with no life entry is not a champion, and for those `!dead` is the whole question.
    present: life ? isChampionPresent(life) : !entity.unit.dead,
  };
}

function project(p: Vec2): Vec2 {
  return worldToScreen(p, DEFAULT_PROJECTION);
}

/**
 * Depth key for an entity standing at a flat gameplay pixel, lifted by
 * `heightPx` screen pixels. Delegates to the projection's {@link depthFor} on
 * the underlying world coordinate so nearer (lower-on-screen) entities sort on
 * top. Height is converted from screen pixels to world units for the tie-break.
 */
function depthForPixel(p: Vec2, heightPx = 0): number {
  return depthFor(p, heightPx / HEIGHT_SCALE, DEFAULT_PROJECTION);
}

/** Depth band offsets so terrain < shadows < bodies without cross-mixing. */
const DEPTH_TERRAIN = -100000;
const DEPTH_SHADOW_BIAS = -5000;

/**
 * Convenience wrapper returning a single representative fit-scale for cosmetic
 * world-unit -> screen-px sizing (lane/river band widths). The projection now
 * fits X and Y independently, so we use the average of the two axis scales.
 */
function projScale(): number {
  const { sx, sy } = projectionScale(DEFAULT_PROJECTION);
  return (sx + sy) / 2;
}

/** Depth for transient VFX so they render above all entities. */
const VFX_DEPTH = 200000;

/**
 * FOG OF WAR.
 *
 * Drawn as a single RenderTexture covering the projected world, filled with
 * near-black and then ERASED with a soft radial hole at every living ally's
 * position. It sits above units so unexplored ground and anything standing in it
 * is darkened; ally units are inside their own holes so they stay lit. Enemy
 * entities outside every ally's vision are additionally hidden outright, so fog
 * conceals information and not just pixels.
 *
 * Vision radii are in WORLD units (WORLD_SIZE is 3000) and deliberately differ
 * per unit class, so a lone minion wave does not light a lane the way a champion
 * does and warding a structure still matters.
 */
const FOG_DEPTH = VFX_DEPTH - 1;
const FOG_ALPHA = 0.86;
/*
 * Vision radii in WORLD units against a 3000-unit map. The first cut used
 * 620/380/520, which sounded modest but was not: at the projection's horizontal
 * scale a 620-unit radius is a 178px hole on an 860px-wide projected map, and
 * with five champions, both minion waves and ELEVEN ally structures all carving
 * one, the fog was erased edge to edge and appeared not to exist. These values
 * light roughly a tenth of the map width per champion.
 */
const VISION_RADIUS_CHAMPION = 300;
const VISION_RADIUS_MINION = 170;
const VISION_RADIUS_STRUCTURE = 230;

/**
 * Per-champion AI/simulation state for a NON-human champion. Each bot owns its
 * own cooldowns, resource pool, progression and lane assignment so all nine
 * AI champions reason and act independently through the same pure helpers the
 * human uses. The human champion does NOT carry a bot record; it uses the
 * scene's `player*` fields (which the HUD reads).
 */
interface BotState {
  champion: Champion;
  side: MapSide;
  ownedItems: string[];
  currentIntent: AiIntent;
  pendingIntent: AiIntent | null;
  intentReadyAt: number;
  nextDecisionAt: number;
  /** The active map lane this bot walks/pushes. */
  lane: Lane;
  /** Cached lane push waypoints (flat gameplay pixels), enemy-nexus-ward. */
  pushPath: Vec2[];
  /** Current index into {@link pushPath} while marching. */
}

/** A rendered combat entity: pairs pure combat state with its Phaser visuals. */
interface Entity {
  unit: Unit;
  /** AI/simulation state for non-human champions (undefined for the human). */
  bot?: BotState;
  /**
   * The upright billboard container. Positioned every frame at the entity's
   * PROJECTED screen point, lifted up by {@link Entity.heightPx}. Holds the
   * baked sprite image, hp bar and (for champions) the 2-letter label.
   */
  container: Phaser.GameObjects.Container;
  /** Baked sprite billboard (procedural texture). */
  body: Phaser.GameObjects.Image;
  /** Ground-shadow ellipse drawn on the floor plane at the projected point. */
  shadow?: Phaser.GameObjects.Ellipse;
  /** How far (screen px) the billboard is lifted off its ground point. */
  heightPx: number;
  hpBarBg?: Phaser.GameObjects.Rectangle;
  hpBar?: Phaser.GameObjects.Rectangle;
  /** Remaining stun seconds; entity cannot act while > 0. */
  stunned: number;
  effects: EffectState;
  /** For structures: the pure graph node (kind, lane, shields). */
  node?: StructureNode;
  /** For minions: pure rift minion state (lane path progress). */
  rift?: RiftMinion;
  /** For minions: the lane path this minion walks. */
  path?: Vec2[];
  /** For minions/monsters, their bounty type key. */
  minionType?: MinionType;
  /** Champion-only deterministic death/respawn state. */
  /** Champion-only source data and finite pose state. */
  champion?: Champion;
  championPose?: ChampionPose;
  poseLockedUntil?: number;
  posePriority?: number;
  movedThisFrame?: boolean;
  deathVisibleUntil?: number;
  /** Effective champion regeneration and ability power. */
  hpRegen?: number;
  abilityPower?: number;
  /** Neutral epic objective identity. */
  objectiveId?: EpicMonster;
  /** Neutral jungle camp identity. */
  campId?: string;
  campMemberKey?: string;
}


/**
 * The scene's own `PendingWaveSpawn` interface is gone with the field it typed.
 *
 * It duplicated rift/waveSchedule.ts's definition -- the same shape declared twice, which is how a scene copy and a pure
 * copy drift a field apart. `world.waves.pending` is typed by the pure one now, so there is a single definition.
 */

interface ObjectiveRuntime {
  id: EpicMonster;
  entity: Entity | null;
  nextSpawnAt: number;
  permanentlyGone: boolean;
}

interface CampRuntime {
  camp: Camp;
  members: Entity[];
  nextSpawnAt: number;
}

interface TrapRuntime {
  id: string;
  source: Unit;
  point: Vec2;
  radius: number;
  rawDamage: number;
  color: number;
  expiresAt: number;
  slowPercent: number;
  slowDuration: number;
}

interface ScheduledBattleCommand extends QueuedBattleCommand {
  targetTick: number;
}

/**
 * The scene's own four-field `TeamFacts` interface is gone.
 *
 * It shadowed rift/matchFlow.ts's definition under the same name -- the four-field one here, the two-field one there --
 * so assigning the scene's object to the pure type would have type-checked while silently dropping two fields into the
 * snapshot. `epicMonstersKilled` moved INTO the pure type because it is authority; `totalGoldEarned` did not, because
 * `teamGold()` derives it. See `teamGoldEarned` below.
 */

/**
 * The complete arena battle. Renders the three-lane Conquest map or the
 * single-lane Midline Skirmish map by scaling the pure {@link WORLD_SIZE} model into
 * the canvas. All map geometry, structure gating, minion waves, economy,
 * jungle/buffs and epic objectives come from the Phaser-free `rift/` modules and
 * `combat.ts`; this scene only renders and calls them.
 */
export default class BattleScene extends Phaser.Scene {
  private onGameEnd!: (outcome: BattleOutcome) => void;
  private onSceneReady: () => void = () => {};
  private reducedMotion = false;
  private sceneReady = false;
  private shuttingDown = false;
  private criticalTextureReadiness: Promise<unknown>[] = [];
  private readinessTimeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
  private mode: GameMode = 'conquest';
  private rules: MatchModeRules = rulesForMode('conquest');
  private matchKind: MatchKind = DEFAULT_MATCH_KIND;
  private difficulty: Difficulty = DEFAULT_DIFFICULTY;
  private matchId = '';
  private matchSeed = '';
  private playerChampion!: Champion;
  private enemyChampion!: Champion;
  /** The lanes active this match (all three for Conquest, mid only for Midline Skirmish). */
  private lanes: Lane[] = [...LANES];

  private player!: Entity;
  /** The player-facing enemy champion (drives the HUD enemy bar). AI-driven. */
  private enemy!: Entity;
  /** All champion entities (10 total): the human + 9 AI bots. */
  private champions: Entity[] = [];
  private structures: Entity[] = [];
  private minions: Entity[] = [];
  private allEntities: Entity[] = [];
  /** Fog-of-war overlay; null until {@link setupFog} runs (or if unsupported). */
  private fog: Phaser.GameObjects.RenderTexture | null = null;
  /** Screen-space rect the fog texture covers, cached from the projection. */
  private fogRect = { x: 0, y: 0, width: 0, height: 0 };
  /** Baked hole radius in SCREEN px, keyed by the WORLD vision radius. */
  private fogHoleRadiusPx = new Map<number, number>();
  /** Constant-time authoritative entity lookup for targeting and impacts. */
  private entityById = new Map<string, Entity>();
  /** Last acquired target per acting entity; retained until it becomes invalid. */
  /**
   * Passive state, now one plain object rather than three Maps.
   *
   * The three it replaces could never be snapshotted; this shape can. The scene still owns it because BattleScene is
   * the authority for a real match, but the RULES that read and write it live in rift/passives.ts.
   */
  /**
   * The scene's authoritative state, as far as it has moved into WorldState's own shape.
   *
   * This is the container rollback needs. It is an {@link AdoptedWorld} and not a `WorldState` on purpose: the type names
   * only the fields the scene actually keeps here, so a field that has not been migrated yet cannot be read as an empty
   * array — it does not compile. Every slice that lands widens the Pick, and when it names every field the scene's state
   * IS a WorldState and can be snapshotted and rewound.
   *
   * Field names are WorldState's, including the plural `wardenCharges` the scene used to spell singular, so that the
   * final step is a type change and not a rename.
   */
  private world: AdoptedWorld = createAdoptedWorld();
  private passiveCounters = new Map<string, number>();
  private internalCooldowns = new Map<string, number>();
  /** Structure entities keyed by their pure graph id. */
  private structureById = new Map<string, Entity>();
  private allyNexus!: Entity;
  private enemyNexus!: Entity;

  private structureLines: StructureLine[] = [];


  // Items. Gold and progression are no longer per-bot fields: they live in `world.economy` and `world.progression`,
  // keyed by unit id, so the player and every bot are read the same way.
  private ownedItems: string[] = [];
  /**
   * Observations of the human's own decisions, for learning their ghost. Bounded by
   * the recorder itself so a long match cannot grow memory.
   */
  private ghostRecorder = new GhostRecorder<GhostObservation>();
  /**
   * The ghost the bots play, or null for the ordinary AI. Resolved ONCE in create():
   * decoding a code and reading the profile on every decision would put storage access
   * and a base32 decode inside the simulation loop, several times a second per bot.
   */
  private opponentGhost: GhostPolicy | null = null;
  private playerDeaths = 0;

  /**
   * Team gold earned, kept OUT of `world.teamFacts` on purpose.
   *
   * rift/matchFlow.ts says in as many words that gold is not a `TeamFacts` field: `teamGold()` sums it from the economy
   * records instead. Storing a second copy in the snapshot would contradict a decision the pure layer made deliberately,
   * and two copies of a running total is how they end up disagreeing. It stays a scene field until `economy` is adopted,
   * at which point this becomes a call to `teamGold()` and disappears rather than being migrated.
   */

  // Buffs / objectives (ally-team perspective drives HUD + player stats).
  /**
   * The baron buff and the dragon stacks now live in `world.baron` / `world.dragonStacks`, one side table each rather
   * than four scalar fields.
   *
   * `dragonStacks` did not exist in WorldState at all until this slice, which is the more important half of the finding:
   * the field list was INCOMPLETE, not merely unadopted. `dragonStackBonus` turns the count into attack damage, ability
   * power, armour and health for a whole team, so a rollback over a state without it restores every position and hit
   * point correctly and still drifts — the hardest kind of divergence to attribute.
   */
  private objectives: ObjectiveRuntime[] = [];
  /**
   * Both target-lock tables now live in `world.targets`, merged into the one `TargetTable` WorldState has always had.
   *
   * The scene kept two: a `Map` for the per-unit persistent lock and a `Record` for auto-attackers. Merging them is safe
   * because a minion and a turret can never share an id, and it is REQUIRED rather than tidy — adopting only one half
   * would put a table in the snapshot that omits the other half's locks, and a rollback that restored positions but not
   * who had locked on re-picks targets on replay. Better to have no entry than half of them.
   *
   * `resolveAutoAttacks` copies the whole table and rewrites only its own attackers' entries, so passing the merged
   * table through it preserves the minion locks.
   *
   * Absent key and explicit `null` are read identically here (`?? null`), matching `pruneTargets`. The scene DELETES a
   * lapsed lock rather than writing `null`, which is what stops the table growing one null per dead minion; the pure side
   * writes `null` and prunes instead. Both are correct, and mixing them is why this note exists.
   */

  private camps: CampRuntime[] = [];
  private traps: TrapRuntime[] = [];
  private trapGraphics = new Map<string, Phaser.GameObjects.Arc>();

  /**
   * The impact queue is `world.pendingImpacts`; the wave schedule's three fields are `world.waves`.
   *
   * The scene was already assembling a `WaveSchedule` literal at every `scheduleDueWaves` call and taking it apart again
   * afterwards, which is the shape telling you where it wanted to live. It now goes over whole.
   */
  /**
   * The two monotonic counters are `world.nextInsertionOrder` (impacts) and `world.waves.nextOrder` (the schedule), and
   * they stay separate.
   *
   * They were one field. The wave scheduler derives MINION IDENTITY from its order, so every queued impact and every armed
   * trap shifted the id the next minion would get — a replay in which a cast lands differently renumbers every later
   * minion. The pure layer has always kept these separate; the scene did not, and now both sit in the snapshot where a
   * rewind can restore them.
   */

  /** Inhibitors down per side, for super-minion spawning. */
  /**
   * When each inhibitor was destroyed, as a RECORD rather than a Map.
   *
   * 75431b9 moved the pure side to a Record because a Map cannot be snapshotted — JSON flattens it to {} and the rollback
   * core compares by JSON.stringify — but the scene kept its Map and converted at the call boundary with
   * Object.fromEntries. That left the hazard in place in the one place that matters, since this field is the authority.
   */
  private inhibitorKillTimes: Record<string, number> = {};

  private playerOrder: 'move' | 'attack-move' | 'target' | 'stop' = 'stop';
  private attackMoveArmed = false;
  private armedAbility: CooldownKey | null = null;
  private aimPoint: Vec2 | null = null;
  private aimPreview?: Phaser.GameObjects.Graphics;
  private pauseReasons = new Set<'manual' | 'settings' | 'hidden'>();
  /**
   * The recall CHANNEL is `world.recalls`; this string is not.
   *
   * `recallCancellation` names why the last channel broke ("attack", "ability"), and it exists only to be shown in the
   * HUD — no rule reads it and no peer needs to agree about it. Leaving presentation out of the snapshot is as much a part
   * of getting the state right as putting authority in: a rewind that restored a feedback string would be spending
   * snapshot bytes on a caption.
   */
  private recallCancellation = '';
  private learning: LearningState = createLearningState();
  private purchaseFeedbackSequence = 0;
  private lastPurchaseFeedback: { itemId: string; accepted: boolean; reason?: string; sequence: number } | undefined;
  private abilityKeys!: Record<CooldownKey, Phaser.Input.Keyboard.Key>;
  private touchCastHandler?: EventListener;

  // The procedural SpriteFactory field was removed: champions, minions,
  // structures, markers and VFX all draw from pre-generated pixel sheets loaded
  // in `preload`, so nothing in the battle rasterizes SVG at runtime any more.
  // `sprites.ts` itself is retained (it is unit-tested, and `svgArt` still backs
  // the DOM champion art in champion select) but the scene no longer uses it.
  /** Live cosmetic objects only; gameplay impacts are tracked separately above. */
  private transientVfx = new Set<Phaser.GameObjects.GameObject>();
  private damageTexts = new Set<Phaser.GameObjects.Text>();
  private minionSequence = 0;

  /**
   * The frame-time remainder, and NOT part of the world.
   *
   * Deliberately left out of `world`: it is render-loop bookkeeping that says how much real time has arrived since the
   * last fixed step, so restoring it with a snapshot would make a rewind depend on frame pacing. The clock the world
   * runs on is `world.tick` / `world.simTime`.
   */
  private simulationAccumulator = 0;
  private scheduledCommands: ScheduledBattleCommand[] = [];
  private nextHudAt = 0;
  /**
   * Whether the match is over — DERIVED from `world.outcome`, not stored.
   *
   * The boolean it replaces was a lossy copy of a richer state: `MatchOutcome` is `ongoing | decided{winner, reason}`, so
   * a `true` said the match had ended while the winner lived only in the payload the scene emitted on its way out. Now
   * the winner and the reason are in the snapshot, and there is no second source of truth that can disagree with it.
   */
  private get matchEnded(): boolean {
    return isDecided(this.world.outcome);
  }
  /** Guards the cosmetic kill slow-mo so rapid kills cannot stack/strand it. */
  private slowMoActive = false;
  /**
   * Per-frame living-unit snapshot, rebuilt once at the top of {@link update}
   * before the champion/minion/turret loops that call {@link findTarget}. This
   * removes the per-caller allocation churn: with ten champions plus minions and
   * turrets all targeting each frame, rebuilding the living `Unit[]` list and id
   * `Set` per call multiplied badly. Targeting is a per-frame approximation (a
   * unit may die mid-loop), which is acceptable and matches the prior
   * order-dependent behavior; the attack paths still guard on `target.dead`.
   */
  private livingSnapshot: { units: Unit[]; ids: Set<string> } = {
    units: [],
    ids: new Set(),
  };
  private stats = {
    championKills: 0,
    minionKills: 0,
    damageDealt: 0,
  };

  constructor() {
    super('battle');
  }

  init(data: BattleSceneData) {
    this.onGameEnd = data.onGameEnd;
    this.onSceneReady = data.onSceneReady ?? (() => {});
    this.reducedMotion = data.reducedMotion ?? false;
    this.sceneReady = false;
    this.shuttingDown = false;
    this.criticalTextureReadiness = [];
    this.transientVfx.clear();
    this.damageTexts.clear();
    this.minionSequence = 0;
    this.slowMoActive = false;
    this.mode = data.mode ?? 'conquest';
    this.rules = rulesForMode(this.mode);
    this.lanes = activeLanesForMode(this.mode);
    this.matchKind = data.matchKind ?? DEFAULT_MATCH_KIND;
    this.difficulty = data.difficulty ?? DEFAULT_DIFFICULTY;
    this.matchId = data.matchId.trim();
    this.matchSeed = data.matchSeed.trim();
    if (!this.matchId || !this.matchSeed) {
      throw new Error('BattleScene requires a non-empty authoritative match id and seed');
    }
    this.playerChampion =
      getChampionById(data.playerChampionId) ?? getChampionById('ashborne')!;
    // Opt-in, and validated against what the profile actually holds: an unknown or
    // corrupt code resolves to null and the match plays against the AI that has always
    // worked, rather than against nothing.
    this.opponentGhost = (() => {
      try {
        return ghostForOpponent(loadProfile(), data.ghostCode);
      } catch {
        return null;
      }
    })();
    this.enemyChampion =
      getChampionById(data.enemyChampionId) ?? getChampionById('nightveil')!;

    // Reset per-run state so a restart/rematch starts clean.
    this.champions = [];
    this.structures = [];
    this.minions = [];
    this.allEntities = [];
    this.entityById.clear();
    // Two Maps remain, and they hold the passives NOT extracted: nightveil's smoke, aegis, ironhold, reflect and an
    // ability-side stack counter. Only the basic-attack subset moved into PassiveState, so both are reset here.
    this.passiveCounters.clear();
    this.internalCooldowns.clear();
    this.world = createAdoptedWorld();
    this.structureById.clear();
    this.structureLines = [];
    this.ownedItems = [];
    this.playerDeaths = 0;
    this.world.baron.ally = noBaronBuff();
    this.world.baron.enemy = noBaronBuff();
    this.objectives = this.rules.objectives.enabled
      ? [
          { id: 'dragon', entity: null, nextSpawnAt: this.rules.objectives.firstSpawnSeconds, permanentlyGone: false },
          { id: 'herald', entity: null, nextSpawnAt: this.rules.objectives.heraldStartSeconds, permanentlyGone: false },
          { id: 'baron', entity: null, nextSpawnAt: this.rules.objectives.majorSpawnSeconds, permanentlyGone: false },
        ]
      : [];
    this.camps = this.mode === 'conquest'
      ? CAMPS.map((camp) => ({ camp, members: [], nextSpawnAt: 0 }))
      : [];
    this.traps = [];
    for (const marker of this.trapGraphics.values()) marker.destroy();
    this.trapGraphics.clear();
    this.world.pendingImpacts = [];
    this.world.waves.pending = [];
    this.world.waves.nextOrder = 0;
    this.world.waves.spawnedWaves = 0;
    this.inhibitorKillTimes = {};
    this.playerOrder = 'stop';
    this.attackMoveArmed = false;
    this.armedAbility = null;
    this.aimPoint = null;
    this.aimPreview?.clear();
    this.pauseReasons.clear();
    this.recallCancellation = '';
    this.learning = createLearningState();
    this.purchaseFeedbackSequence = 0;
    this.lastPurchaseFeedback = undefined;
    this.simulationAccumulator = 0;
    this.scheduledCommands = [];
    this.nextHudAt = 0;
    this.stats = { championKills: 0, minionKills: 0, damageDealt: 0 };
    const authorityMatchRequest: AuthorityMatchRequest = {
      matchId: this.matchId,
      matchSeed: this.matchSeed,
      mode: this.mode,
      matchKind: this.matchKind,
      difficulty: this.difficulty,
      playerChampionId: this.playerChampion.id,
      enemyChampionId: this.enemyChampion.id,
    };
    battleStore.reset(this.playerChampion.id, this.enemyChampion.id, this.mode, authorityMatchRequest);
    this.scheduledCommands = battleStore
      .consumeImportedReplay(authorityMatchRequest)
      .filter(({ command }) => command.type !== 'pause' && command.type !== 'resume');
  }

  create() {
    this.applyPixelArtFiltering();
    this.cameras.main.setBackgroundColor('#05140c');
    this.input.enabled = false;
    this.drawMap();

    this.buildStructures();

    this.spawnTeams();

    this.aimPreview = this.add.graphics().setDepth(VFX_DEPTH - 1);
    this.setupInput();
    this.setupCamera();
    this.setupFog();
    this.syncVisuals();
    this.pushHud();
    this.nextHudAt = HUD_INTERVAL_SECONDS;
    this.settleCriticalTextures();

    // Read-only observation surface for the browser probe, mirroring ringout's and gridfall's. A production bundle has
    // no Phaser global, so without this a probe cannot reach the scene at all — and reading the WebGL canvas directly
    // returns blank unless preserveDrawingBuffer is set.
    //
    // `space` exists to make the coordinate system checkable from outside. Gameplay moved from a viewport-derived pixel
    // plane to world units, and the whole point of that change is a property no screenshot can show: the same match must
    // compute the same distances at any window size.
    (window as unknown as { __CHAMPS__?: unknown }).__CHAMPS__ = {
      tick: () => this.world.simTime,
      space: () => ({
        worldSize: WORLD_SIZE,
        playerPos: this.player ? { ...this.player.unit.pos } : null,
        playerRange: this.player?.unit.attackRange ?? null,
        playerSpeed: this.player?.unit.moveSpeed ?? null,
        bounds: this.allEntities.reduce(
          (acc, e) => ({
            minX: Math.min(acc.minX, e.unit.pos.x),
            maxX: Math.max(acc.maxX, e.unit.pos.x),
            minY: Math.min(acc.minY, e.unit.pos.y),
            maxY: Math.max(acc.maxY, e.unit.pos.y),
          }),
          { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
        ),
        units: this.allEntities.length,
      }),
      camps: () => this.camps.map((c) => ({ id: c.camp.id, alive: c.members.filter((m) => !m.unit.dead).length, nextSpawnAt: c.nextSpawnAt })),
      // Who each auto-attacker has locked on to, so a probe can prove turrets are still deciding after the shared-rule
      // adoption — a passing unit suite cannot, since it does not drive this scene.
      locks: () => ({ ...this.world.targets }),
      /**
       * Submit a battle command straight into the scene's own funnel.
       *
       * Read-only observation is not enough for one specific check: duskarrow's W is an AIMED ability, and a synthetic
       * PointerEvent arms it (`is-aiming` appears on the HUD) but never commits, because the commit path wants a real
       * pointer interaction. Since processCommand is the single funnel every player order already passes through, driving
       * it directly exercises exactly the same code the UI would, without simulating a mouse.
       */
      command: (command: BattleCommand) => this.processCommand(command),
      /**
       * Every body's health and swing timer.
       *
       * `space()` already reports how MANY units there are; this reports what is happening to them, which is what a probe
       * needs to prove the basic-attack path still lands damage. A unit suite cannot: it does not drive this scene, and
       * the four callers of the attack path (the player, a bot champion, a minion and a camp monster) only meet in a
       * running match.
       */
      bodies: () => this.allEntities.map((e) => ({
        id: e.unit.id,
        kind: e.unit.kind,
        team: e.unit.team,
        hp: Math.round(e.unit.hp),
        maxHp: e.unit.maxHp,
        attackCdRemaining: Number(e.unit.attackCdRemaining.toFixed(3)),
        dead: e.unit.dead,
      })),
      /**
       * Held warden charges and the epic-monster slots, for the one path a probe cannot otherwise see.
       *
       * The spend rule is unit-tested, but a unit test cannot show the SCENE acquiring a charge from a herald kill and
       * then spending it on a structure — that needs a real match past the herald window with a real kill attributed to a
       * real side. Read-only, like every other entry here.
       */
      warden: () => ({
        charges: {
          ally: this.world.wardenCharges.ally ? { ...this.world.wardenCharges.ally } : null,
          enemy: this.world.wardenCharges.enemy ? { ...this.world.wardenCharges.enemy } : null,
        },
        objectives: this.objectives.map((objective) => ({
          id: objective.id,
          alive: Boolean(objective.entity && !objective.entity.unit.dead),
          hp: objective.entity ? Math.round(objective.entity.unit.hp) : null,
          pos: objective.entity ? { ...objective.entity.unit.pos } : null,
          nextSpawnAt: objective.nextSpawnAt,
          permanentlyGone: objective.permanentlyGone,
        })),
      }),
      structureHp: () => this.allEntities
        .filter((e) => e.unit.kind === 'turret' || e.unit.kind === 'nexus')
        .map((e) => ({ id: e.unit.id, hp: Math.round(e.unit.hp) })),
      traps: () => this.traps.map((t) => ({ id: t.id, expiresAt: t.expiresAt, radius: t.radius })),
    };
  }

  /** PhaserGame forwards both the initial preference and live media-query changes. */
  setReducedMotion(reduced: boolean): void {
    if (this.reducedMotion === reduced) return;
    this.reducedMotion = reduced;
    if (!reduced) return;

    this.tweens.timeScale = 1;
    this.slowMoActive = false;
    this.clearTransientVfx();
    for (const champion of this.champions) {
      this.tweens.killTweensOf(champion.body);
      this.tweens.killTweensOf(champion.container);
      if (champion.body.active) champion.body.setPosition(0, 0);
      if (champion.container.active) champion.container.setScale(1);
    }
    this.cameras.main.shakeEffect.reset();
    this.cameras.main.flashEffect.reset();
  }

  /** Texture failures and browser decode stalls fall back to placeholders. */
  private settleCriticalTextures(): void {
    const settled = Promise.allSettled([...this.criticalTextureReadiness]);
    const timeout = new Promise<void>((resolve) => {
      this.readinessTimeoutId = globalThis.setTimeout(resolve, CRITICAL_TEXTURE_TIMEOUT_MS);
    });
    void Promise.race([settled, timeout]).then(() => {
      if (this.readinessTimeoutId !== undefined) {
        globalThis.clearTimeout(this.readinessTimeoutId);
        this.readinessTimeoutId = undefined;
      }
      if (this.shuttingDown || !this.scene.isActive()) return;
      this.sceneReady = true;
      this.input.enabled = true;
      this.syncVisuals();
      this.onSceneReady();
    });
  }

  /**
   * Zoom the battle camera in on the player's champion and follow it, so only a
   * PORTION of the map is visible at a time (the map feels large). The whole
   * map still shows on the HUD minimap (screen-fixed React overlay, computed
   * from full-world fractions, so it is unaffected by this camera transform).
   *
   * The camera is layered ON TOP of the fixed fit-projection: bounds cover the
   * whole projected world diamond (via the pure {@link projectedWorldBounds}
   * helper) with padding so the champion can stay centred near the edges; zoom
   * magnifies; startFollow pans smoothly. Cosmetic shake/flash (see
   * {@link shake} / kill slow-mo / win-lose) are additive to camera scroll and
   * keep working; none of this touches unit.pos or sim timers (determinism
   * unchanged). Called AFTER spawnTeams() so {@link player} exists to follow.
   */
  /**
   * Load the pre-generated pixel-art spritesheets (see `tools/gen_sprites.py`
   * and {@link sheetManifest}). Champions, minions and structures are drawn from
   * these; markers and VFX still come from the procedural SpriteFactory.
   */
  preload() {
    for (const sheet of sheetManifest()) {
      if (this.textures.exists(sheet.key)) continue;
      this.load.spritesheet(sheet.key, sheet.url, {
        frameWidth: sheet.frameWidth,
        frameHeight: sheet.frameHeight,
      });
    }
  }

  /**
   * Sample the generated pixel-art sheets with NEAREST.
   *
   * PhaserGame.tsx sets `render: { antialias: true }` so the Phaser Text layer
   * scales smoothly (a global `pixelArt: true` would nearest-minify oversized
   * glyph textures and shred small Korean labels). But that same flag is what
   * TextureSource reads for its DEFAULT scaleMode, so without this the 54
   * hand-generated sprite sheets were being bilinear-smoothed - the pixel art
   * was quietly blurred. Filtering per-texture keeps both correct.
   */
  private applyPixelArtFiltering() {
    for (const sheet of sheetManifest()) {
      if (this.textures.exists(sheet.key)) {
        this.textures.get(sheet.key).setFilter(Phaser.Textures.FilterMode.NEAREST);
      }
    }
  }

  /**
   * Build the fog-of-war overlay: a RenderTexture spanning the projected world
   * plus a pre-baked soft "vision hole" texture that {@link updateFog} erases
   * with. Baking the hole ONCE and erasing a texture per unit keeps the per-frame
   * cost to a handful of draws instead of re-rasterizing a gradient every frame.
   */
  private setupFog() {
    const bounds = projectedWorldBounds(DEFAULT_PROJECTION, 0);
    this.fogRect = { x: bounds.minX, y: bounds.minY, width: bounds.width, height: bounds.height };

    // One hole texture PER radius, so a minion really does reveal less than a
    // champion. RenderTexture.erase takes a texture key with no scale argument,
    // so the size has to be baked in rather than applied at erase time.
    const { sx } = projectionScale(DEFAULT_PROJECTION);
    for (const world of [VISION_RADIUS_CHAMPION, VISION_RADIUS_MINION, VISION_RADIUS_STRUCTURE]) {
      const r = Math.max(6, Math.round(world * sx));
      this.fogHoleRadiusPx.set(world, r);
      const key = `fog-hole-${world}`;
      if (this.textures.exists(key)) continue;
      // Soft-edged disc: concentric rings stepping alpha down so the fog fades
      // out instead of showing a hard circular cut.
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      const steps = 12;
      for (let i = steps; i >= 1; i--) {
        const t = i / steps;
        g.fillStyle(0xffffff, (1 - t) * 0.18 + 0.03);
        g.fillCircle(r, r, r * t);
      }
      g.fillStyle(0xffffff, 1);
      g.fillCircle(r, r, r * 0.5);
      g.generateTexture(key, r * 2, r * 2);
      g.destroy();
    }

    this.fog = this.add.renderTexture(
      this.fogRect.x,
      this.fogRect.y,
      Math.max(1, Math.ceil(this.fogRect.width)),
      Math.max(1, Math.ceil(this.fogRect.height)),
    );
    this.fog.setOrigin(0, 0);
    this.fog.setDepth(FOG_DEPTH);
  }

  /**
   * Repaint the fog and apply vision to enemies.
   *
   * Ally-side living units carve holes; every enemy entity is then hidden unless
   * it falls inside one of those vision radii. Structures are exempt from being
   * hidden - a turret's location is public knowledge in a lane pusher, and
   * blinking them in and out would make the map unreadable.
   */
  private updateFog() {
    const fog = this.fog;
    if (!fog || !fog.active) return;

    // Collect ally vision sources once; reused for both the holes and the
    // enemy-visibility test so the two can never disagree.
    const sources: { pos: Vec2; world: number; r2: number }[] = [];
    for (const e of this.allEntities) {
      if (e.unit.team !== 'ally' || e.unit.dead) continue;
      const radius =
        e.unit.kind === 'minion' || e.unit.kind === 'monster'
          ? VISION_RADIUS_MINION
          : e.unit.kind === 'turret' || e.unit.kind === 'nexus'
            ? VISION_RADIUS_STRUCTURE
            : VISION_RADIUS_CHAMPION;
      sources.push({ pos: e.unit.pos, world: radius, r2: radius * radius });
    }

    fog.clear();
    fog.fill(0x01060b, FOG_ALPHA);
    for (const s of sources) {
      const r = this.fogHoleRadiusPx.get(s.world);
      if (r === undefined) continue;
      const screen = project(s.pos);
      fog.erase(
        `fog-hole-${s.world}`,
        screen.x - this.fogRect.x - r,
        screen.y - this.fogRect.y - r,
      );
    }

    for (const e of this.allEntities) {
      if (e.unit.team !== 'enemy') continue;
      if (e.unit.kind === 'turret' || e.unit.kind === 'nexus') continue;
      if (e.unit.dead) continue;
      let seen = false;
      for (const s of sources) {
        const dx = e.unit.pos.x - s.pos.x;
        const dy = e.unit.pos.y - s.pos.y;
        if (dx * dx + dy * dy <= s.r2) {
          seen = true;
          break;
        }
      }
      e.container.setVisible(seen);
      e.shadow?.setVisible(seen);
    }
  }

  private setupCamera() {
    const cam = this.cameras.main;
    const bounds = projectedWorldBounds(DEFAULT_PROJECTION, CAMERA_BOUNDS_PADDING);
    cam.setBounds(bounds.minX, bounds.minY, bounds.width, bounds.height);
    cam.setZoom(CAMERA_ZOOM);
    // roundPixels MUST stay false here. `startFollow`'s 2nd argument snaps the
    // camera's scroll to whole integers every frame; combined with the gentle
    // CAMERA_LERP the scroll advances by SUB-pixel amounts per frame, so
    // rounding quantises it and the entire world visibly stair-steps back and
    // forth - the "shaking" this camera used to exhibit. The fractional
    // Scale.FIT resample of the canvas then amplifies it further. lastwar
    // documents the same trap in its render config (`roundPixels: false`).
    cam.startFollow(this.player.container, false, CAMERA_LERP, CAMERA_LERP);
    cam.setFollowOffset(0, 0);
  }

  /**
   * Build both full five-champion teams from the pure {@link composeTeams}
   * composition. The human keeps their chosen champion as {@link player} on the
   * ally side; the enemy's player-facing pick becomes {@link enemy} (AI-driven)
   * so the existing single-enemy HUD bar stays meaningful. Every other champion
   * gets its own {@link BotState} and is driven each tick by the pure AI.
   */
  private spawnTeams() {
    // Deterministic, matchup-derived seed: the same picks + mode always
    // reproduce the same teams (reproducible replays/QA) while different
    // matchups get varied non-picked champions. No Date.now/Math.random here.
    const teamSeed = `${this.playerChampion.id}:${this.enemyChampion.id}:${this.mode}:${this.matchSeed}`;
    const composition = composeTeams(
      CHAMPIONS,
      this.playerChampion.id,
      this.enemyChampion.id,
      this.lanes,
      teamSeed,
    );
    const facing = enemyFacingSlot(composition, this.enemyChampion.id);

    let allyIndex = 0;
    let enemyIndex = 0;
    for (const side of ['ally', 'enemy'] as MapSide[]) {
      const slots = side === 'ally' ? composition.ally : composition.enemy;
      const base = BASE_POSITIONS[side];
      for (const slot of slots) {
        // Fan the fountain spawns slightly so the five champions do not overlap.
        const n = side === 'ally' ? allyIndex++ : enemyIndex++;
        const spawn: Vec2 = {
          x: this.clampX(base.x + (n - 2) * 16),
          y: this.clampY(base.y + (n - 2) * 16),
        };
        const isHuman = slot.isHuman;
        const isFacingEnemy = side === 'enemy' && slot === facing;
        const id = isHuman
          ? 'player'
          : isFacingEnemy
            ? 'enemy'
            : `${side}-bot-${n}`;
        const entity = this.spawnChampion(id, slot.champion, side, spawn);

        if (isHuman) {
          this.player = entity;
        } else {
          if (isFacingEnemy) this.enemy = entity;
          entity.bot = {
            champion: slot.champion,
            side,
            ownedItems: [],
            currentIntent: 'approach',
            pendingIntent: null,
            intentReadyAt: 0,
            nextDecisionAt: 0,
            lane: slot.lane,
            pushPath: laneWaypoints(slot.lane, side),
          };
        }
        this.champions.push(entity);
        this.applyChampionStats(entity, side);
        entity.unit.hp = entity.unit.maxHp;
        if (entity.bot) this.fillResource(entity);
      }
    }
  }

  // ---- Map + structure setup ----------------------------------------------

  /**
   * Draw the battlefield as a 2.5D dimetric terrain. Every geometry point is a
   * world coordinate projected through {@link worldToScreen}; the square world
   * reads as a diamond, lanes/river/jungle/bases are drawn in projected space,
   * and jungle/epic markers are placed as depth-sorted billboards. Gameplay is
   * untouched: this method only paints, using the FEAT-001 projection.
   */
  private drawMap() {
    const g = this.add.graphics();
    g.setDepth(DEPTH_TERRAIN);

    const w = (p: Vec2) => worldToScreen(p, DEFAULT_PROJECTION);

    // Projected ground diamond (the whole world plane).
    const c0 = w({ x: 0, y: 0 });
    const c1 = w({ x: WORLD_SIZE, y: 0 });
    const c2 = w({ x: WORLD_SIZE, y: WORLD_SIZE });
    const c3 = w({ x: 0, y: WORLD_SIZE });
    const diamond = [
      new Phaser.Geom.Point(c0.x, c0.y),
      new Phaser.Geom.Point(c1.x, c1.y),
      new Phaser.Geom.Point(c2.x, c2.y),
      new Phaser.Geom.Point(c3.x, c3.y),
    ];
    const mid = w({ x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 });

    // Base ground fill (deep forest floor).
    g.fillStyle(0x0b2a1a, 1);
    g.fillPoints(diamond, true);

    // Layered vignette: concentric shrinking diamonds, brightest toward the
    // center, so the ground reads as a lit clearing fading to dark edges rather
    // than a flat single-color fill. Drawn cheaply, once, in create().
    const groundTones = [0x0d3020, 0x104027, 0x134a2d, 0x175433];
    const worldCorners: Vec2[] = [
      { x: 0, y: 0 },
      { x: WORLD_SIZE, y: 0 },
      { x: WORLD_SIZE, y: WORLD_SIZE },
      { x: 0, y: WORLD_SIZE },
    ];
    for (let i = 0; i < groundTones.length; i++) {
      const t = (i + 1) / (groundTones.length + 1);
      const ring = worldCorners
        .map((p) => ({
          x: p.x + (WORLD_SIZE / 2 - p.x) * t,
          y: p.y + (WORLD_SIZE / 2 - p.y) * t,
        }))
        .map((p) => w(p))
        .map((s) => new Phaser.Geom.Point(s.x, s.y));
      g.fillStyle(groundTones[i], 0.5);
      g.fillPoints(ring, true);
    }

    // Crisp rim on the world edge.
    g.lineStyle(3, 0x2a6b47, 1);
    g.strokePoints(diamond, true, true);

    // Jungle quadrants (top-left / bottom-right of the diamond): darker greens
    // with a mottled canopy texture of scattered soft blobs so they read as
    // dense jungle distinct from the walkable lanes.
    const jungleTris: Phaser.Geom.Point[][] = [
      [
        new Phaser.Geom.Point(c0.x, c0.y),
        new Phaser.Geom.Point(c1.x, c1.y),
        new Phaser.Geom.Point(mid.x, mid.y),
      ],
      [
        new Phaser.Geom.Point(c2.x, c2.y),
        new Phaser.Geom.Point(c3.x, c3.y),
        new Phaser.Geom.Point(mid.x, mid.y),
      ],
    ];
    g.fillStyle(0x08281a, 0.6);
    for (const tri of jungleTris) g.fillPoints(tri, true);
    // Mottled canopy: deterministic scatter of leafy blobs in the two jungle
    // quadrants (top-left and bottom-right in world space), tinted two greens.
    const mottle: Array<{ qx: [number, number]; qy: [number, number] }> = [
      { qx: [0.06, 0.44], qy: [0.06, 0.44] }, // top-left jungle
      { qx: [0.56, 0.94], qy: [0.56, 0.94] }, // bottom-right jungle
    ];
    let seed = 1337;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (const q of mottle) {
      for (let i = 0; i < 26; i++) {
        const wx = (q.qx[0] + rand() * (q.qx[1] - q.qx[0])) * WORLD_SIZE;
        const wy = (q.qy[0] + rand() * (q.qy[1] - q.qy[0])) * WORLD_SIZE;
        const p = w({ x: wx, y: wy });
        const r = (6 + rand() * 10) * projScale();
        g.fillStyle(rand() > 0.5 ? 0x0f3a24 : 0x18543a, 0.5);
        g.fillEllipse(p.x, p.y, r * 2.2, r);
      }
    }

    // River band along the anti-diagonal: a wide blue base stroke with a
    // lighter highlight ribbon down its center so the water catches light.
    const river = RIVER_ANCHORS.map(w);
    const strokePoly = (pts: Vec2[]) => {
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.strokePath();
    };
    g.lineStyle(Math.max(12, 66 * projScale()), 0x123f63, 0.55);
    strokePoly(river);
    g.lineStyle(Math.max(8, 48 * projScale()), 0x2b7fc0, 0.45);
    strokePoly(river);
    g.lineStyle(Math.max(2, 12 * projScale()), 0x7fd0ff, 0.5);
    strokePoly(river);

    // Lanes: a soft dark border under a lighter walkable path so the traversable
    // surface reads distinctly from the jungle.
    for (const lane of this.lanes) {
      const pts = LANE_WAYPOINTS[lane].map(w);
      g.lineStyle(Math.max(10, 52 * projScale()), 0x14311f, 0.7);
      strokePoly(pts);
      g.lineStyle(Math.max(8, 42 * projScale()), 0x3c8f60, 0.6);
      strokePoly(pts);
      g.lineStyle(Math.max(3, 16 * projScale()), 0x59b07e, 0.4);
      strokePoly(pts);
    }

    // Faint isometric tile grid so the ground reads as a 2.5D floor (drawn over
    // the terrain surfaces, kept very subtle).
    g.lineStyle(1, 0x1c4a30, 0.4);
    const step = WORLD_SIZE / 12;
    for (let i = 1; i < 12; i++) {
      const a = w({ x: i * step, y: 0 });
      const b = w({ x: i * step, y: WORLD_SIZE });
      g.lineBetween(a.x, a.y, b.x, b.y);
      const c = w({ x: 0, y: i * step });
      const d = w({ x: WORLD_SIZE, y: i * step });
      g.lineBetween(c.x, c.y, d.x, d.y);
    }

    // Base zones: a glowing team-tinted pad at each fountain with a bright rim
    // and an inner core so the fountains read as energized platforms.
    for (const side of ['ally', 'enemy'] as MapSide[]) {
      const b = w(BASE_POSITIONS[side]);
      const tint = side === 'ally' ? 0x2f6fe0 : 0xe0512f;
      const rim = side === 'ally' ? 0x8fd7ff : 0xff8a7a;
      g.fillStyle(tint, 0.14);
      g.fillEllipse(b.x, b.y, 150, 76);
      g.fillStyle(tint, 0.26);
      g.fillEllipse(b.x, b.y, 118, 60);
      g.fillStyle(rim, 0.2);
      g.fillEllipse(b.x, b.y, 70, 36);
      g.lineStyle(2.5, rim, 0.85);
      g.strokeEllipse(b.x, b.y, 120, 61);
      g.lineStyle(1.5, rim, 0.5);
      g.strokeEllipse(b.x, b.y, 150, 76);
    }

    // Jungle camp + epic pit markers (Conquest only), as depth-sorted billboards.
    if (this.mode === 'conquest') {
      for (const camp of CAMPS) {
        this.spawnMarker('jungle', camp.pos);
      }
      for (const pit of EPIC_PITS) {
        this.spawnMarker(pit.id, pit.pos);
      }
    }
  }

  /**
   * Place a static projected marker billboard (jungle camp / epic monster) at a
   * world position. Uses the baked marker texture and depth-sorts by its
   * projected ground point so entities in front occlude it correctly.
   */
  private spawnMarker(variant: 'jungle' | 'dragon' | 'baron' | 'herald', worldPos: Vec2) {
    const screen = worldToScreen(worldPos, DEFAULT_PROJECTION);
    // Jungle camps and objectives are drawn from their neutral pixel sheets.
    const key = markerSheetKey(variant);
    const size: SpriteSize = {
      width: MARKER_FRAME.width,
      height: MARKER_FRAME.height,
      footY: Math.round(MARKER_FRAME.height * MARKER_FOOT_FRAC),
    };
    const heightPx = variant === 'jungle' ? 4 : 10;
    if (variant !== 'jungle') {
      const shadow = this.add.ellipse(screen.x, screen.y, size.width * 0.8, size.width * 0.36, 0x000000, 0.32);
      shadow.setDepth(depthFor(worldPos, 0, DEFAULT_PROJECTION) + DEPTH_SHADOW_BIAS);
    }
    const img = this.add.image(screen.x, screen.y - heightPx, key);
    img.setOrigin(0.5, 1 - (size.height - size.footY) / size.height);
    // The backing texture is baked at RASTER_SCALE density; pin the on-screen
    // size to the intrinsic SpriteSize so it renders 1:1 (crisp downsample).
    img.setDisplaySize(size.width, size.height);
    img.setDepth(depthFor(worldPos, heightPx / HEIGHT_SCALE, DEFAULT_PROJECTION));
  }

  private buildStructures() {
    for (const side of ['ally', 'enemy'] as MapSide[]) {
      const team = side;
      const graph = buildStructureGraph(side, this.mode);
      const anchors = STRUCTURES[side];

      for (const node of graph) {
        // Skip lanes that are not active in this mode (Midline Skirmish uses mid only).
        if (node.lane && !this.lanes.includes(node.lane)) continue;

        const pos = this.structurePosition(node, anchors);
        const entity = this.spawnStructure(node, team, pos);
        this.structureById.set(node.id, entity);
        this.structures.push(entity);

        if (node.kind === 'nexus') {
          if (side === 'ally') this.allyNexus = entity;
          else this.enemyNexus = entity;
        }
      }
    }
  }

  private structurePosition(
    node: StructureNode,
    anchors: (typeof STRUCTURES)['ally'],
  ): Vec2 {
    const lane = node.lane;
    switch (node.kind) {
      case 'outerTurret':
        return anchors.outerTurrets[lane!];
      case 'innerTurret':
        return anchors.innerTurrets[lane!];
      case 'inhibitorTurret':
        return anchors.inhibitorTurrets[lane!];
      case 'inhibitor':
        return anchors.inhibitors[lane!];
      case 'nexusTurret':
        return node.id.endsWith('-a') ? anchors.nexusTurrets[0] : anchors.nexusTurrets[1];
      case 'nexus':
      default:
        return anchors.nexus;
    }
  }

  private addEntity(entity: Entity) {
    this.allEntities.push(entity);
    this.entityById.set(entity.unit.id, entity);
  }

  private makeUnit(
    id: string,
    kind: Unit['kind'],
    team: Team,
    pos: Vec2,
    stats: Partial<Unit>,
  ): Unit {
    return {
      id,
      kind,
      team,
      pos: { ...pos },
      hp: stats.maxHp ?? 100,
      maxHp: stats.maxHp ?? 100,
      ad: stats.ad ?? 0,
      armor: stats.armor ?? 0,
      attackRange: stats.attackRange ?? 0,
      attackSpeed: stats.attackSpeed ?? 1,
      moveSpeed: stats.moveSpeed ?? 0,
      attackCdRemaining: 0,
      dead: false,
    };
  }

  private spawnChampion(id: string, champion: Champion, team: MapSide, pos: Vec2): Entity {
    const unit = this.makeUnit(id, 'champion', team, pos, {
      maxHp: champion.stats.hp,
      ad: champion.stats.attackDamage,
      armor: 28,
      attackRange: champion.stats.attackRange,
      attackSpeed: champion.stats.attackSpeed,
      moveSpeed: champion.stats.moveSpeed,
    });
    // NOTE: the old SpriteFactory pose PREWARM was removed here. It rasterized
    // four SVG variants per player-facing champion to warm a cache the battle no
    // longer reads - every pose is a frame of the pre-generated sheet, already
    // resident after `preload`. Keeping it would have burned four rasterizations
    // per champion on textures nothing draws.
    // Champions are drawn from the pre-generated pixel-art sheet. The pose is a
    // FRAME index into that sheet (see frameForPose), so a pose change is a
    // frame swap rather than a freshly rasterized texture.
    const sheetId = resolveChampionSheetId(champion.id, champion.role);
    const key = championSheetKey(sheetId, team);
    const size: SpriteSize = {
      width: CHAMPION_FRAME.width,
      height: CHAMPION_FRAME.height,
      footY: Math.round(CHAMPION_FRAME.height * CHAMPION_FOOT_FRAC),
    };
    const heightPx = CHAMPION_HEIGHT_PX;
    const body = this.makeBillboard(key, size);
    // Only the player-facing picks carry nameplates. Labeling all ten units at
    // the compact camera scale created a noisy wall of initials at each spawn.
    const shortLabel = id === 'player' || id === 'enemy'
      ? champion.id.slice(0, 2).toUpperCase()
      : '';
    const label = this.add.text(0, -size.height - 6, shortLabel, {
      fontFamily: 'Noto Sans KR, sans-serif',
      fontSize: '12px',
      color: '#fff1c9',
      fontStyle: 'bold',
      stroke: '#02070c',
      strokeThickness: 2,
      resolution: 2,
    });
    label.setOrigin(0.5);
    const container = this.add.container(pos.x, pos.y, [body, label]);
    const shadow = this.makeShadow(size.width * 0.7);
    const entity: Entity = {
      unit,
      container,
      body,
      shadow,
      heightPx,
      stunned: 0,
      effects: createEffectState(),
      champion,
      championPose: 'idle',
      poseLockedUntil: 0,
      posePriority: 0,
      movedThisFrame: false,
      hpRegen: champion.stats.hpRegen,
      abilityPower: 0,
    };
    this.attachHpBar(entity, size.height + 12);
    // Champion life goes into `world.lives` rather than onto the entity. An entity with no entry is not a champion, which
    // is what every `lifeFor(...) ? ... : ...` check downstream relies on, so this seeding is what keeps that true.
    this.world.lives[unit.id] = createChampionLifeState();
    this.addEntity(entity);
    return entity;
  }

  /**
   * Build the upright billboard image for a baked sprite. Origin is set so the
   * image's ground-contact point (footY) is the anchor placed on the projected
   * ground; container-relative Y is 0 there.
   */
  private makeBillboard(key: string, size: SpriteSize): Phaser.GameObjects.Image {
    const img = this.add.image(0, 0, key);
    // Anchor the sprite's foot at the container origin (0,0).
    img.setOrigin(0.5, size.footY / size.height);
    // The backing texture is baked at RASTER_SCALE density for crispness; pin
    // the on-screen size to the intrinsic SpriteSize so it renders 1:1 and
    // Phaser downsamples the denser texture at draw time.
    img.setDisplaySize(size.width, size.height);
    img.setPosition(0, 0);
    return img;
  }

  private setChampionPose(
    entity: Entity,
    pose: ChampionPose,
    holdMs = 0,
    priority = 0,
  ): void {
    const champion = entity.champion;
    if (!champion || !entity.body.active) return;
    const lockedUntil = entity.poseLockedUntil ?? 0;
    const currentPriority = entity.posePriority ?? 0;
    if (this.world.simTime < lockedUntil && priority < currentPriority) return;
    // A pose is now a FRAME of the champion's pixel-art sheet, so switching pose
    // costs an index change instead of rasterizing and caching a new texture.
    // The texture itself never changes, so origin/display size stay valid.
    entity.championPose = pose;
    entity.body.setFrame(frameForPose(pose, this.world.simTime));
    entity.poseLockedUntil = holdMs > 0 ? this.world.simTime + holdMs / 1000 : this.world.simTime;
    entity.posePriority = priority;
  }

  private refreshChampionLocomotionPoses(): void {
    for (const champion of this.champions) {
      if (!isChampionPresent(this.lifeFor(champion)!)) continue;
      if (this.world.simTime < (champion.poseLockedUntil ?? 0)) continue;
      this.setChampionPose(champion, champion.movedThisFrame ? 'move' : 'idle');
    }
  }

  /** A soft ground-shadow ellipse laid on the floor plane (its own object). */
  private makeShadow(width: number): Phaser.GameObjects.Ellipse {
    return this.add.ellipse(0, 0, width, width * 0.45, 0x000000, 0.32);
  }

  private spawnStructure(node: StructureNode, team: MapSide, pos: Vec2): Entity {
    const maxHp =
      node.kind === 'nexus'
        ? NEXUS_HP
        : node.kind === 'nexusTurret'
          ? NEXUS_TURRET_HP
          : node.kind === 'inhibitor'
            ? INHIBITOR_HP
            : TURRET_HP;
    const isTurret = node.kind.endsWith('Turret');
    // Combat kind: nexus for the nexus, turret for anything that shoots,
    // 'nexus'-gated inhibitors are modeled as turrets that do not attack.
    const combatKind: Unit['kind'] = node.kind === 'nexus' ? 'nexus' : 'turret';
    const unit = this.makeUnit(node.id, combatKind, team, pos, {
      maxHp,
      ad: isTurret ? TURRET_DAMAGE : 0,
      armor: 40,
      attackRange: isTurret ? TURRET_RANGE : 0,
      attackSpeed: TURRET_ATTACK_SPEED,
      moveSpeed: 0,
    });
    const tier: 'turret' | 'inhibitor' | 'nexus' =
      node.kind === 'nexus' ? 'nexus' : node.kind === 'inhibitor' ? 'inhibitor' : 'turret';
    const heightPx =
      tier === 'nexus' ? NEXUS_HEIGHT_PX : tier === 'inhibitor' ? INHIBITOR_HEIGHT_PX : TURRET_HEIGHT_PX;
    const key = structureSheetKey(tier, team === 'enemy' ? 'enemy' : 'ally');
    const size: SpriteSize = {
      width: STRUCTURE_FRAME.width,
      height: STRUCTURE_FRAME.height,
      footY: Math.round(STRUCTURE_FRAME.height * STRUCTURE_FOOT_FRAC),
    };
    const body = this.makeBillboard(key, size);
    const container = this.add.container(pos.x, pos.y, [body]);
    const shadow = this.makeShadow(size.width * 0.8);
    const entity: Entity = { unit, container, body, shadow, heightPx, stunned: 0, effects: createEffectState(), node };
    this.attachHpBar(entity, size.height + 8);
    this.addEntity(entity);
    return entity;
  }

  private attachHpBar(entity: Entity, offsetY: number) {
    const isChampion = entity.unit.kind === 'champion';
    const width = entity.unit.kind === 'minion' ? 14 : isChampion ? 34 : 24;
    const height = isChampion ? 5 : 4;
    // A thin dark outline frame behind the track gives contrast against any
    // terrain/sprite color so the bar stays readable when zoomed in.
    const outline = this.add.rectangle(0, -offsetY, width + 2, height + 2, 0x000000, 0.85);
    const bg = this.add.rectangle(0, -offsetY, width, height, 0x201512, 0.9);
    const bar = this.add.rectangle(0, -offsetY, width, height, 0x3ad16a);
    bar.setData('width', width);
    entity.container.add([outline, bg, bar]);
    entity.hpBarBg = bg;
    entity.hpBar = bar;
  }

  /**
   * Recompute a champion's Unit stats from level + items + team modifiers. The
   * human champion reads the scene's `player*` progression/items; every AI bot
   * reads its own {@link BotState}. Item/CDR bonuses stay ally-player-only (bots
   * carry no items), matching prior behavior.
   */
  private applyChampionStats(entity: Entity, side: MapSide) {
    const isHuman = entity === this.player;
    const champion = isHuman ? this.playerChampion : entity.bot!.champion;
    const level = this.progressionFor(entity).level;
    const items = isHuman ? this.ownedItems : entity.bot!.ownedItems;
    const team = this.teamModifiers(side);
    const eff = computeEffectiveStats(champion, level, items, team);
    const u = entity.unit;
    const hpFrac = u.maxHp > 0 ? u.hp / u.maxHp : 1;
    u.maxHp = Math.round(eff.hp);
    // Preserve current hp fraction for live champions; freshly spawned/respawned
    // entities are topped up by the caller.
    u.hp = Math.min(u.maxHp, Math.round(u.maxHp * hpFrac));
    u.ad = eff.attackDamage;
    u.armor = eff.armor;
    u.attackSpeed = eff.attackSpeed;
    u.moveSpeed = eff.moveSpeed;
    u.attackRange = eff.attackRange;
    entity.hpRegen = eff.hpRegen;
    entity.abilityPower = eff.abilityPower;
    if (isHuman) {
      this.resourceFor(this.player).max = BASE_RESOURCE_POOL + eff.resource;
    } else {
      this.resourceFor(entity).max = BASE_RESOURCE_POOL + eff.resource;
    }
  }

  /** The current team modifiers for a side (dragon stacks + baron buff). */
  private teamModifiers(side: MapSide): TeamModifiers {
    const stacks = side === 'ally' ? this.world.dragonStacks.ally : this.world.dragonStacks.enemy;
    const baron = side === 'ally' ? this.world.baron.ally : this.world.baron.enemy;
    let mods = dragonStackBonus(stacks);
    if (baron.active) mods = addModifiers(mods, baron.modifiers);
    return mods;
  }

  private setupInput() {
    const kb = this.input.keyboard!;
    // Arena controls: movement is CLICK-only (below); Q/W/E/R are the sole
    // keyboard bindings and cast abilities aimed at the cursor. WASD movement is
    // intentionally NOT bound, so physical W is no longer double-bound.
    this.abilityKeys = {
      Q: kb.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
      W: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      E: kb.addKey(Phaser.Input.Keyboard.KeyCodes.E),
      R: kb.addKey(Phaser.Input.Keyboard.KeyCodes.R),
    };
    (['Q', 'W', 'E', 'R'] as CooldownKey[]).forEach((slot) => {
      this.abilityKeys[slot].on('down', () => {
        battleStore.request({ type: 'cast', slot, aim: this.pointerToGround(this.input.activePointer) });
      });
    });
    kb.addKey(Phaser.Input.Keyboard.KeyCodes.A).on('down', () => {
      if (this.pauseReasons.size > 0 || this.hasModalFocus()) return;
      this.attackMoveArmed = true;
    });
    kb.addKey(Phaser.Input.Keyboard.KeyCodes.S).on('down', () => {
      if (this.pauseReasons.size > 0 || this.hasModalFocus()) return;
      battleStore.request({ type: 'stop' });
    });

    // Touch HUD buttons dispatch this lightweight event. It enters the exact
    // same cast path as the physical keys and uses the last battlefield pointer
    // as the aim point, so mobile players can tap to aim/move, then cast.
    this.touchCastHandler = ((event: CustomEvent<{ slot?: string }>) => {
      const slot = event.detail?.slot;
      if (slot === 'Q' || slot === 'W' || slot === 'E' || slot === 'R') {
        battleStore.request({ type: 'cast', slot, aim: this.pointerToGround(this.input.activePointer) });
      }
    }) as EventListener;
    window.addEventListener('champs:cast-ability', this.touchCastHandler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.shuttingDown = true;
      this.sceneReady = false;
      if (this.readinessTimeoutId !== undefined) {
        globalThis.clearTimeout(this.readinessTimeoutId);
        this.readinessTimeoutId = undefined;
      }
      if (this.touchCastHandler) {
        window.removeEventListener('champs:cast-ability', this.touchCastHandler);
        this.touchCastHandler = undefined;
      }
      this.tweens.timeScale = 1;
      this.slowMoActive = false;
      this.clearTransientVfx();
      this.clearAimPreview();
      this.aimPreview?.destroy();
      this.aimPreview = undefined;
      for (const marker of this.trapGraphics.values()) marker.destroy();
      this.trapGraphics.clear();
      this.traps = [];
      this.scheduledCommands = [];
      this.world.waves.pending = [];
      this.world.pendingImpacts = [];
      this.criticalTextureReadiness = [];
    });

    // Suppress the browser context menu over the canvas so right-click can be
    // used to issue move commands without opening a browser menu.
    this.input.mouse?.disableContextMenu();

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.pauseReasons.size > 0 || this.hasModalFocus()) return;
      const ground = this.pointerToGround(pointer);
      if (this.armedAbility) {
        const slot = this.armedAbility;
        this.clearAimPreview();
        battleStore.request({ type: 'cast', slot, aim: ground });
        return;
      }
      if (this.attackMoveArmed) {
        this.attackMoveArmed = false;
        battleStore.request({ type: 'attack-move-to', point: ground });
        return;
      }

      const clicked = this.entityAtPoint(ground, this.player.unit);
      battleStore.request(clicked
        ? { type: 'target-at', point: ground }
        : { type: 'move-to', point: ground });
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.armedAbility || this.pauseReasons.size > 0) return;
      this.aimPoint = this.pointerToGround(pointer);
      this.syncAimPreview();
    });
  }

  /**
   * Map a pointer's canvas coordinates to the flat gameplay-plane pixel space.
   * The pointer is in projected SCREEN space, so we invert the projection
   * ({@link screenToWorld}) to world units and re-apply {@link toScreen} to get
   * the flat pixel that all gameplay math (movement/aim/ranges) operates in.
   */
  private hasModalFocus(): boolean {
    const active = document.activeElement;
    return Boolean(
      document.querySelector('[aria-modal="true"]') ||
      active instanceof HTMLInputElement ||
      active instanceof HTMLSelectElement ||
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLElement && active.closest('form')),
    );
  }

  private pointerToGround(pointer: Phaser.Input.Pointer): Vec2 {
    return screenToWorld({ x: pointer.worldX, y: pointer.worldY }, DEFAULT_PROJECTION);
  }

  private clientToGround(clientX: number, clientY: number): Vec2 {
    const rect = this.game.canvas.getBoundingClientRect();
    const canvasX = ((clientX - rect.left) / Math.max(1, rect.width)) * this.scale.gameSize.width;
    const canvasY = ((clientY - rect.top) / Math.max(1, rect.height)) * this.scale.gameSize.height;
    const projected = this.cameras.main.getWorldPoint(canvasX, canvasY);
    return screenToWorld(projected, DEFAULT_PROJECTION);
  }

  private clearAimPreview(): void {
    this.armedAbility = null;
    this.aimPoint = null;
    this.aimPreview?.clear();
  }

  private syncAimPreview(): void {
    const graphics = this.aimPreview;
    const slot = this.armedAbility;
    const aim = this.aimPoint;
    if (!graphics || !slot || !aim || !this.player || this.matchEnded) {
      graphics?.clear();
      return;
    }
    const ability = this.abilityBySlot(this.playerChampion, slot);
    const origin = this.player.unit.pos;
    const endpoint = this.resolveCastEndpoint(this.player, ability, aim);
    const color = Phaser.Display.Color.HexStringToColor(this.playerChampion.accentColor).color;
    const points: Phaser.Geom.Point[] = [];
    const radius = ability.range;
    for (let index = 0; index <= 40; index += 1) {
      const angle = (Math.PI * 2 * index) / 40;
      const point = project({ x: origin.x + Math.cos(angle) * radius, y: origin.y + Math.sin(angle) * radius });
      points.push(new Phaser.Geom.Point(point.x, point.y));
    }
    const from = project(origin);
    const to = project(endpoint);
    graphics.clear();
    graphics.lineStyle(2, color, 0.7).strokePoints(points, true, false);
    graphics.lineStyle(4, color, 0.9).lineBetween(from.x, from.y, to.x, to.y);
    graphics.fillStyle(color, 0.3).fillCircle(to.x, to.y, worldLengthToScreen(ability.mechanics?.radius ?? 34));
  }

  private entityAtPoint(point: Vec2, source: Unit): Entity | undefined {
    const livingIds = new Set(
      this.allEntities.filter((entity) => !entity.unit.dead).map((entity) => entity.unit.id),
    );
    let best: Entity | undefined;
    let bestDistance = 90;
    for (const entity of this.allEntities) {
      if (!areHostile(source.team, entity.unit.team) || !this.isEntityDamageable(entity)) continue;
      if (
        (entity.unit.kind === 'turret' || entity.unit.kind === 'nexus') &&
        !isStructureTargetable(entity.unit.id, livingIds, this.mode)
      ) {
        continue;
      }
      const d = distance(point, entity.unit.pos);
      if (d <= bestDistance) {
        best = entity;
        bestDistance = d;
      }
    }
    return best;
  }

  // ---- Main loop -----------------------------------------------------------

  update(_time: number, deltaMs: number) {
    if (this.matchEnded || !this.sceneReady) return;
    this.simulationAccumulator += Math.max(0, deltaMs / 1000);
    this.ingestCommands();
    if (this.pauseReasons.size > 0 || this.matchEnded) {
      this.simulationAccumulator = 0;
      this.syncAimPreview();
      return;
    }

    let steps = 0;
    for (const champion of this.champions) champion.movedThisFrame = false;
    while (
      this.simulationAccumulator + Number.EPSILON >= SIMULATION_TICK_SECONDS &&
      steps < MAX_STEPS_PER_RENDER &&
      !this.matchEnded
    ) {
      this.simulationAccumulator -= SIMULATION_TICK_SECONDS;
      this.stepAuthority();
      steps += 1;
    }
    this.refreshChampionLocomotionPoses();
    this.syncVisuals();
    // Fog runs AFTER syncVisuals so it reads the positions actually drawn this
    // frame, and so its enemy-hiding is the last word on visibility.
    this.updateFog();
    this.syncTrapVisuals();
    this.syncAimPreview();
  }

  private stepAuthority(): void {
    const nextElapsed = (this.world.tick + 1) * SIMULATION_TICK_SECONDS;
    if (nextElapsed > this.rules.hardCapSeconds + Number.EPSILON) return;
    this.world.tick += 1;
    this.world.simTime = Math.min(this.rules.hardCapSeconds, this.world.tick * SIMULATION_TICK_SECONDS);
    const dt = SIMULATION_TICK_SECONDS;
    this.processScheduledCommands();
    if (this.matchEnded || this.pauseReasons.size > 0) return;
    this.tickRecall();

    this.advanceChampionLives();
    this.reviveInhibitors();
    tickCooldowns(this.cooldownsFor(this.player), dt);
    const blueRegen = this.blueBuffRegen();
    this.world.resources[this.player.unit.id] = regenerateResource(this.resourceFor(this.player), dt, blueRegen);
    for (const c of this.champions) {
      if (!c.bot) continue;
      tickCooldowns(this.cooldownsFor(c), dt);
      const botBlueRegen = this.buffsFor(c).buffs.some((buff) => buff.kind === 'blue')
        ? BUFF_EFFECTS.blue.resourceRegenPerSecond : 0;
      this.world.resources[c.unit.id] = regenerateResource(this.resourceFor(c), dt, botBlueRegen);
    }

    this.tickEconomy(dt);
    this.tickBuffsAndObjectives();
    this.tickHeldWardenPolicy();
    this.processPurchases();
    this.maybeSpawnWaves();
    this.processWaveSpawns();
    this.processPendingImpacts();
    this.tickTraps();
    this.refreshLivingSnapshot();

    this.updatePlayerMovement(dt);
    for (const c of this.champions) {
      if (c.bot) this.updateBotChampion(c, dt);
    }
    this.updateMinions(dt);
    this.updateObjectiveMonsters();
    this.updateJungleCamps(dt);
    for (const s of this.structures) {
      if (s.unit.kind === 'turret') this.updateTurret(s);
    }
    this.regenAndTick(dt);
    this.checkWinLose();
    if (!this.matchEnded && this.world.simTime >= this.nextHudAt) {
      this.pushHud();
      this.nextHudAt = this.world.simTime + HUD_INTERVAL_SECONDS;
    }
  }

  private ingestCommands(): void {
    for (const queued of battleStore.consumeQueuedCommands()) {
      const command = queued.command;
      if (command.type === 'aim-start' || command.type === 'aim-update') {
        this.armedAbility = command.slot;
        this.aimPoint = this.clientToGround(command.clientX, command.clientY);
        this.syncAimPreview();
        continue;
      }
      if (command.type === 'aim-cancel') {
        if (!command.slot || this.armedAbility === command.slot) this.clearAimPreview();
        continue;
      }
      if (command.type === 'arm-cast') {
        this.armedAbility = command.slot;
        this.aimPoint = this.pointerToGround(this.input.activePointer);
        this.syncAimPreview();
        continue;
      }

      const canonicalCommand: BattleCommand = command.type === 'aim-commit'
        ? {
            type: 'cast',
            slot: command.slot,
            aim: this.clientToGround(command.clientX, command.clientY),
          }
        : command.type === 'cast' && !command.aim
          ? { type: 'cast', slot: command.slot, aim: this.pointerToGround(this.input.activePointer) }
          : command;
      if (command.type === 'aim-commit') this.clearAimPreview();

      if (canonicalCommand.type === 'pause') {
        battleStore.recordAuthorityCommand({ ...queued, command: canonicalCommand, targetTick: this.world.tick });
        this.pauseReasons.add(canonicalCommand.reason);
        this.simulationAccumulator = 0;
        this.clearAimPreview();
        this.pushHud();
      } else if (canonicalCommand.type === 'resume') {
        battleStore.recordAuthorityCommand({ ...queued, command: canonicalCommand, targetTick: this.world.tick });
        this.pauseReasons.delete(canonicalCommand.reason);
        this.simulationAccumulator = 0;
        this.pushHud();
      } else if (canonicalCommand.type === 'surrender') {
        battleStore.recordAuthorityCommand({ ...queued, command: canonicalCommand, targetTick: this.world.tick });
        this.endAbandoned();
        return;
      } else {
        const backlogTicks = Math.floor(this.simulationAccumulator / SIMULATION_TICK_SECONDS);
        const targetTick = this.world.tick + backlogTicks + 1;
        const scheduled = { ...queued, command: canonicalCommand, targetTick };
        this.scheduledCommands.push(scheduled);
        battleStore.recordAuthorityCommand(scheduled);
      }
    }
    this.scheduledCommands.sort((a, b) => a.targetTick - b.targetTick || a.sequence - b.sequence);
  }

  private processScheduledCommands(): void {
    const due = this.scheduledCommands.filter((queued) => queued.targetTick <= this.world.tick);
    this.scheduledCommands = this.scheduledCommands.filter((queued) => queued.targetTick > this.world.tick);
    for (const queued of due) this.processCommand(queued.command);
  }

  private processCommand(command: BattleCommand): void {
    // Learn the player's style from their orders. Hooked HERE because this is the one
    // place every player action passes through, so nothing is missed and nothing is
    // counted twice - a per-input-handler hook would have to be repeated for the
    // pointer, the keyboard and the on-screen buttons.
    this.recordGhostObservation(command);
    if (this.pauseReasons.size > 0 || this.world.simTime >= this.rules.hardCapSeconds) return;
    if (command.type === 'purchase') {
      this.processPurchase(command.itemId);
    } else if (command.type === 'arm-cast') {
      this.armedAbility = command.slot;
      this.aimPoint = this.pointerToGround(this.input.activePointer);
      this.syncAimPreview();
    } else if (command.type === 'aim-start' || command.type === 'aim-update') {
      this.armedAbility = command.slot;
      this.aimPoint = this.clientToGround(command.clientX, command.clientY);
      this.syncAimPreview();
    } else if (command.type === 'aim-commit') {
      const aim = this.clientToGround(command.clientX, command.clientY);
      this.clearAimPreview();
      this.tryPlayerCastAt(command.slot, aim);
    } else if (command.type === 'aim-cancel') {
      if (!command.slot || this.armedAbility === command.slot) this.clearAimPreview();
    } else if (command.type === 'cast') {
      this.cancelRecall('ability');
      if (command.aim) this.tryPlayerCastAt(command.slot, command.aim);
      else this.tryPlayerCast(command.slot);
    } else if (command.type === 'attack-move') {
      this.cancelRecall('movement');
      this.attackMoveArmed = true;
    } else if (command.type === 'move-to') {
      this.cancelRecall('movement');
      this.attackMoveArmed = false;
      this.playerOrder = 'move';
      this.setPlayerMoveGoal(command.point);
      delete this.world.targets[this.player.unit.id];
    } else if (command.type === 'target-at') {
      this.cancelRecall('movement');
      this.attackMoveArmed = false;
      const target = this.entityAtPoint(command.point, this.player.unit);
      if (target) {
        this.playerOrder = 'target';
        this.setPlayerMoveGoal(null);
        this.world.targets[this.player.unit.id] = target.unit.id;
      } else {
        this.playerOrder = 'move';
        this.setPlayerMoveGoal(command.point);
        delete this.world.targets[this.player.unit.id];
      }
    } else if (command.type === 'attack-move-to') {
      this.cancelRecall('movement');
      this.attackMoveArmed = false;
      this.playerOrder = 'attack-move';
      this.setPlayerMoveGoal(command.point);
      delete this.world.targets[this.player.unit.id];
    } else if (command.type === 'stop') {
      this.cancelRecall('movement');
      this.attackMoveArmed = false;
      this.setPlayerMoveGoal(null);
      this.playerOrder = 'stop';
      delete this.world.targets[this.player.unit.id];
    } else if (command.type === 'recall') {
      this.startRecall();
    } else if (command.type === 'surrender') {
      this.endAbandoned();
    } else if (command.type === 'use-warden') {
      this.useWardenCharge('ally');
    } else if (command.type === 'skip-learning') {
      this.learning = skipCurrentLearningStep(this.learning);
    }
  }

  /**
   * When the player's recall began, or null.
   *
   * A read-through accessor rather than a field, because the channel now lives in `world.recalls` — a `RecallTable`
   * keyed by participant, which is the shape a networked match needs (every champion can recall, not just the local
   * player). The scene still only ever writes the local player's entry; nothing else changed.
   *
   * `?? null` collapses "no entry" and "not recalling", exactly as the pure `advanceRecalls` treats them.
   */
  private get playerRecallStartedAt(): number | null {
    return this.world.recalls[this.player.unit.id] ?? null;
  }

  /**
   * This entity's ability cooldowns, from the one Record the snapshot carries.
   *
   * Created on demand rather than at spawn: `world.cooldowns` is keyed by unit id, and a champion that has never cast has
   * no entry to restore. Lazy creation keeps the two paths (player, bot) identical, which is the point of the gather --
   * the scene used to keep the player's set in a field and every bot's in its own `BotState`, so a rollback would have had
   * to know about both.
   */
  private cooldownsFor(entity: Entity): CooldownState {
    const existing = this.world.cooldowns[entity.unit.id];
    if (existing) return existing;
    const fresh = createCooldownState();
    this.world.cooldowns[entity.unit.id] = fresh;
    return fresh;
  }

  /**
   * This entity's ability resource, from the one Record the snapshot carries.
   *
   * Lazily created like {@link cooldownsFor}, defaulting to the base pool. `max` is rewritten by `applyChampionStats`
   * whenever items or buffs change it, so seeding a default here cannot fix a wrong maximum in place -- it only avoids a
   * missing entry the first time an entity is asked about.
   */
  private resourceFor(entity: Entity): ResourceState {
    const existing = this.world.resources[entity.unit.id];
    if (existing) return existing;
    const fresh = initialResource(BASE_RESOURCE_POOL);
    this.world.resources[entity.unit.id] = fresh;
    return fresh;
  }

  /**
   * This entity's gold, from the one Record the snapshot carries.
   *
   * Seeded `{ gold: STARTING_GOLD, accrual: 0, totalEarned: STARTING_GOLD }` and NOT with `initialGold`, which sets
   * `totalEarned: 0`. The scene has always counted the starting purse as earned — the result screen and the hard-cap
   * score both read it that way — so seeding it at zero here would quietly rewrite every match's reported gold.
   */
  private economyFor(entity: Entity): GoldState {
    const existing = this.world.economy[entity.unit.id];
    if (existing) return existing;
    const fresh: GoldState = { gold: STARTING_GOLD, accrual: 0, totalEarned: STARTING_GOLD };
    this.world.economy[entity.unit.id] = fresh;
    return fresh;
  }

  /**
   * The player's ORDERED move destination, or null when they have none.
   *
   * `world.moveGoals` is keyed by participant because a networked match gives every peer orders; today only the human
   * issues them, so today it holds one entry. Bot destinations are NOT here on purpose -- a bot recomputes
   * `laneAdvanceGoal` from its waypoint path every tick, so it has no ordered goal to store, and inventing one would put
   * a derived value in the snapshot.
   */
  private get playerMoveGoal(): Vec2 | null {
    return this.world.moveGoals[this.player.unit.id] ?? null;
  }

  private setPlayerMoveGoal(goal: Vec2 | null): void {
    this.world.moveGoals[this.player.unit.id] = goal ? { ...goal } : null;
  }

  /** How far along its lane path a bot has marched. Real state: see `WorldState.lanePush`. */
  private lanePushFor(entity: Entity): number {
    return this.world.lanePush[entity.unit.id] ?? 0;
  }

  /**
   * This entity's champion life phase, from the one Record the snapshot carries, or undefined when it has none.
   *
   * Undefined is meaningful and deliberately preserved: minions, structures and monsters have no life phase, and the
   * scene's existing `entity.life ? ... : !entity.unit.dead` checks depended on the absence. A champion is given an entry
   * when it spawns, so "no entry" continues to mean "not a champion" rather than "champion we have not seen yet".
   */
  private lifeFor(entity: Entity): ChampionLifeState | undefined {
    return this.world.lives[entity.unit.id];
  }

  /**
   * This entity's jungle buffs, from the one Record the snapshot carries.
   *
   * Every champion is keyed by unit id, including the human. The old arrangement keyed the player as the literal
   * `'player'` because their buffs lived on a scene field rather than in a record, and the comment there worried that a
   * unit-id key "would collide the day the player's id is reused". Uniqueness of unit ids is already required -- the
   * scene's own `entityById` map depends on it -- so once every champion is in ONE record the special case has nothing
   * left to protect. The key is unchanged in practice: the player's unit id is `player`.
   */
  private buffsFor(entity: Entity): BuffState {
    const existing = this.world.buffs[entity.unit.id];
    if (existing) return existing;
    const fresh = createBuffState();
    this.world.buffs[entity.unit.id] = fresh;
    return fresh;
  }

  /**
   * This entity's level and banked XP, from the one Record the snapshot carries.
   *
   * Level is not a scoreboard number: `statsForLevel` scales health, attack damage, armour and ability power off it, so it
   * has to be restorable with everything else it feeds.
   */
  private progressionFor(entity: Entity): ChampionLevel {
    const existing = this.world.progression[entity.unit.id];
    if (existing) return existing;
    const fresh: ChampionLevel = { level: 1, xp: 0 };
    this.world.progression[entity.unit.id] = fresh;
    return fresh;
  }

  /**
   * Gold earned by a side, DERIVED rather than accumulated.
   *
   * This replaces a running `teamGoldEarned` total the scene kept beside the per-champion ones. It is exactly
   * `teamGold`'s sum because every gain already updated both -- passive income in `tickEconomy` and bounties in
   * `awardBounty` -- so the second total was a copy that could only ever drift. rift/matchFlow.ts said as much when it
   * declined to make gold a `TeamFacts` field.
   */
  private goldEarnedBy(side: MapSide): number {
    return teamGold(
      this.world.economy,
      this.champions.filter((entity) => (entity.bot?.side ?? 'ally') === side).map((entity) => entity.unit.id),
    );
  }

  /** Refill to the current maximum — spawn and respawn. */
  private fillResource(entity: Entity): void {
    const resource = this.resourceFor(entity);
    this.world.resources[entity.unit.id] = { current: resource.max, max: resource.max };
  }

  /** Add and clamp. Used by the fountain, whose rate is a FRACTION of the pool rather than the baseline regen. */
  private addResource(entity: Entity, amount: number): void {
    const resource = this.resourceFor(entity);
    this.world.resources[entity.unit.id] = {
      current: Math.min(resource.max, resource.current + amount),
      max: resource.max,
    };
  }

  /**
   * Pay a cast's cost through the pure `spendResource`, which returns whether it was affordable ALONGSIDE the new state.
   *
   * The caller has already asked `canAfford`, so this cannot refuse in practice; going through the same function anyway
   * keeps one definition of "spend" rather than a check here and a subtraction there, which is where an ability gets cast
   * for free under a race.
   */
  private spend(entity: Entity, cost: number): boolean {
    const { paid, resource } = spendResource(this.resourceFor(entity), cost);
    if (paid) this.world.resources[entity.unit.id] = resource;
    return paid;
  }

  private startRecall() {
    if (!isChampionPresent(this.lifeFor(this.player)!) || this.inBase(this.player.unit, 'ally')) return;
    this.world.recalls[this.player.unit.id] = this.world.simTime;
    this.recallCancellation = '';
    this.playerOrder = 'stop';
    this.setPlayerMoveGoal(null);
  }

  private cancelRecall(reason: string) {
    if (this.playerRecallStartedAt === null) return;
    this.world.recalls[this.player.unit.id] = null;
    this.recallCancellation = reason;
  }

  private tickRecall() {
    const startedAt = this.playerRecallStartedAt;
    // RECALL_SECONDS rather than a literal 6. Both were 6, which is the problem: the same duration written in two files
    // agrees until somebody changes one, and a recall that completes at different times on two peers is a desync.
    if (startedAt === null || this.world.simTime - startedAt < RECALL_SECONDS) return;
    this.player.unit.pos = { ...BASE_POSITIONS.ally };
    this.world.recalls[this.player.unit.id] = null;
  }

  private recordLearning(action: LearningAction) {
    if (this.matchKind === 'tutorial') this.learning = recordLearningAction(this.learning, action);
  }

  private blueBuffRegen(): number {
    return this.buffsFor(this.player).buffs.some((b) => b.kind === 'blue')
      ? BUFF_EFFECTS.blue.resourceRegenPerSecond
      : 0;
  }

  private tickEconomy(dt: number) {
    /**
     * Both branches below now call the SAME extracted step, which is the point of the extraction.
     *
     * This method previously held the accumulate/floor/carry arithmetic twice — once for the player and once inside
     * the bot loop — so the rollback state and the scene could disagree in two places independently. The scene keeps
     * its own storage (`goldAccrual` beside `playerProgress`, and the bot's own fields) because BattleScene is still
     * the authority for a real match; what it no longer keeps is its own copy of the maths.
     */
    this.world.economy[this.player.unit.id] = advanceGold(this.economyFor(this.player), dt);

    for (const entity of this.champions) {
      const bot = entity.bot;
      if (!bot) continue;
      this.world.economy[entity.unit.id] = advanceGold(this.economyFor(entity), dt);
      if (!this.inBase(entity.unit, bot.side) || !isChampionPresent(this.lifeFor(entity)!)) continue;
      const item = recommendPurchase(bot.champion.role, this.economyFor(entity).gold, bot.ownedItems);
      if (!item) continue;
      const purchase = attemptPurchase({
        gold: this.economyFor(entity).gold,
        items: bot.ownedItems,
        inShop: true,
      }, item.id);
      if (!purchase.accepted) continue;
      this.economyFor(entity).gold = purchase.gold;
      bot.ownedItems = purchase.items;
      this.applyChampionStats(entity, bot.side);
    }
  }

  private tickBuffsAndObjectives() {
    /**
     * Buff and tyrant expiry through the extracted record steps, so the scene and the snapshot run the SAME expiry.
     *
     * The player is keyed 'player' rather than by unit id because the human's buffs live on a scene field, not on a bot
     * state — a detail worth naming, since keying it by unit id would collide the day the player's id is reused.
     */
    this.world.buffs = advanceBuffs(this.world.buffs, this.world.simTime);
    const allyWasActive = this.world.baron.ally.active;
    const enemyWasActive = this.world.baron.enemy.active;
    this.world.baron = advanceBaron(this.world.baron, this.world.simTime);
    if (allyWasActive !== this.world.baron.ally.active) this.applyTeamChampionStats('ally');
    if (enemyWasActive !== this.world.baron.enemy.active) this.applyTeamChampionStats('enemy');
    for (const runtime of this.camps) {
      if (runtime.members.length === 0 && this.world.simTime >= runtime.nextSpawnAt) {
        runtime.members = this.spawnCamp(runtime.camp);
      }
    }
    if (!this.rules.objectives.enabled) return;

    for (const runtime of this.objectives) {
      if (
        runtime.id === 'herald' &&
        runtime.entity &&
        this.world.simTime > this.rules.objectives.heraldEndSeconds
      ) {
        runtime.entity.unit.dead = true;
        runtime.entity = null;
        runtime.permanentlyGone = true;
        continue;
      }
      if (runtime.permanentlyGone || runtime.entity || this.world.simTime < runtime.nextSpawnAt) continue;
      if (runtime.id === 'herald' && !isHeraldWindowOpen(this.world.simTime)) {
        if (this.world.simTime > this.rules.objectives.heraldEndSeconds) runtime.permanentlyGone = true;
        continue;
      }
      runtime.entity = this.spawnObjective(runtime.id);
    }
  }

  private processPurchases() {
    // Commands are drained before the simulation tick so paused matches can
    // still resume without advancing authoritative time.
  }

  private processPurchase(id: string) {
    const result = attemptPurchase({
      gold: this.economyFor(this.player).gold,
      items: this.ownedItems,
      inShop: this.inBase(this.player.unit, 'ally'),
    }, id);
    this.lastPurchaseFeedback = {
      itemId: id,
      accepted: result.accepted,
      ...(!result.accepted ? { reason: result.reason } : {}),
      sequence: ++this.purchaseFeedbackSequence,
    };
    if (!result.accepted) return;
    this.economyFor(this.player).gold = result.gold;
    this.ownedItems = result.items;
    this.recordLearning('recall-shop');
    this.applyChampionStats(this.player, 'ally');
  }

  /** Whether a champion is close enough to its fountain to shop. */
  private inBase(u: Unit, side: MapSide): boolean {
    const base = BASE_POSITIONS[side];
    return distance(u.pos, base) <= 220;
  }

  private maybeSpawnWaves() {
    /**
     * Delegates to the extracted scheduler rather than keeping a second copy of the catch-up loop.
     *
     * The scene keeps its own storage — it is still the authority for a real match — but the arithmetic that decides
     * which waves are due, what each lane's composition is, and what insertion order each member gets now lives in
     * one place that a rollback can replay. The inhibitor kill times are handed over as plain data instead of the
     * scene's Map, because a Map is exactly what a snapshot cannot carry.
     */
    // The schedule goes over whole, now that the scene stores it in WorldState's own shape rather than as three loose
    // fields it had to reassemble at every call.
    this.world.waves = scheduleDueWaves(
      this.world.waves,
      this.world.simTime,
      this.lanes,
      { killedAt: this.inhibitorKillTimes },
      (now, killedAt) => isInhibitorAlive(now, killedAt, this.mode),
      this.mode,
    );
  }

  private processWaveSpawns() {
    const partitioned = partitionImpacts(this.world.waves.pending, this.world.simTime);
    this.world.waves.pending = partitioned.pending;
    const liveByBucket = new Map<string, number>();
    for (const minion of this.minions) {
      if (minion.unit.dead || !minion.rift) continue;
      const key = `${minion.rift.team}:${minion.rift.lane}`;
      liveByBucket.set(key, (liveByBucket.get(key) ?? 0) + 1);
    }
    for (const spawn of partitioned.due.sort((a, b) => a.dueAt - b.dueAt || a.insertionOrder - b.insertionOrder)) {
      const key = `${spawn.team}:${spawn.lane}`;
      const live = liveByBucket.get(key) ?? 0;
      // The population cap protects frame time, but scheduled wave members are
      // authoritative. Defer admission instead of deleting actors from the
      // simulation; the 15-minute hard cap bounds the retry queue naturally.
      if (live >= MAX_LIVE_MINIONS_PER_SIDE_LANE) {
        this.world.waves.pending.push({
          ...spawn,
          dueAt: this.world.simTime + WAVE_SPAWN_RETRY_SECONDS,
        });
        continue;
      }
      this.spawnLaneMinion(spawn.type, spawn.team, spawn.lane);
      liveByBucket.set(key, live + 1);
    }
  }

  private spawnLaneMinion(type: MinionType, team: MapSide, lane: Lane) {
    const rift = spawnMinion(type, team, lane);
    const stats = minionStats(type);
    const screenPos = rift.pos;
    const unit = this.makeUnit(
      `minion-${team}-${lane}-${type}-${this.minionSequence++}`,
      'minion',
      team,
      screenPos,
      {
        maxHp: stats.hp,
        ad: stats.ad,
        armor: stats.armor,
        attackRange: stats.attackRange,
        attackSpeed: 1.25,
        moveSpeed: stats.moveSpeed,
      },
    );
    // Minions carry their OWN palette from the sheet (they no longer borrow the
    // team champion's accent) plus a team-coloured rim for the ally/enemy tell.
    const key = minionSheetKey(type, team === 'enemy' ? 'enemy' : 'ally');
    const size: SpriteSize = {
      width: MINION_FRAME.width,
      height: MINION_FRAME.height,
      footY: Math.round(MINION_FRAME.height * MINION_FOOT_FRAC),
    };
    const body = this.makeBillboard(key, size);
    const container = this.add.container(screenPos.x, screenPos.y, [body]);
    const shadow = this.makeShadow(size.width * 0.7);
    const entity: Entity = {
      unit,
      container,
      body,
      shadow,
      heightPx: MINION_HEIGHT_PX,
      stunned: 0,
      effects: createEffectState(),
      rift,
      path: laneWaypoints(lane, team),
      minionType: type,
    };
    this.attachHpBar(entity, size.height + 6);
    this.minions.push(entity);
    this.addEntity(entity);
  }

  // ---- Update helpers ------------------------------------------------------

  private regenAndTick(dt: number) {
    for (const e of this.allEntities) {
      // The single per-tick expiry. Everything else READS effects; see effects.ts for
      // why a mutating query is a rollback hazard.
      expireEffects(e.effects, this.world.simTime);
      const pull = readPull(e.effects, this.world.simTime);
      if (pull && !e.unit.dead) {
        const pullDistance = distance(e.unit.pos, pull.destination);
        if (pullDistance > 1) {
          const travel = Math.min(pullDistance, pull.speed * dt);
          e.unit.pos.x = this.clampX(e.unit.pos.x + ((pull.destination.x - e.unit.pos.x) / pullDistance) * travel);
          e.unit.pos.y = this.clampY(e.unit.pos.y + ((pull.destination.y - e.unit.pos.y) / pullDistance) * travel);
        }
      }
      for (const burn of [...e.effects.burns]) {
        burn.accumulator += burn.rawDamagePerSecond * dt;
        const wholeDamage = Math.floor(burn.accumulator);
        const source = this.entityById.get(burn.sourceId);
        if (source && wholeDamage > 0 && this.isEntityDamageable(e)) {
          burn.accumulator -= wholeDamage;
          this.applyTargetedDamage(source, e, wholeDamage, 0xe8703a, {
            ability: true,
            periodic: true,
          });
        }
      }
      if (e.stunned > 0) e.stunned = Math.max(0, e.stunned - dt);
      advanceAttackCooldown(e.unit, dt);
    }
    if (isChampionPresent(this.lifeFor(this.player)!)) {
      applyHeal(this.player.unit, (this.player.hpRegen ?? 0) * dt);
      if (this.inBase(this.player.unit, 'ally')) {
        applyHeal(this.player.unit, this.player.unit.maxHp * 0.08 * dt);
        this.addResource(this.player, this.resourceFor(this.player).max * FOUNTAIN_RESOURCE_FRACTION * dt);
      }
    }
    // Every AI champion regenerates from effective level/item stats, plus a
    // strong fountain heal when it is home.
    for (const c of this.champions) {
      if (!c.bot || !isChampionPresent(this.lifeFor(c)!)) continue;
      applyHeal(c.unit, (c.hpRegen ?? 0) * dt);
      if (this.inBase(c.unit, c.bot.side)) {
        applyHeal(c.unit, c.unit.maxHp * 0.08 * dt);
        this.addResource(c, this.resourceFor(c).max * FOUNTAIN_RESOURCE_FRACTION * dt);
      }
    }
  }

  private updatePlayerMovement(dt: number) {
    const u = this.player.unit;
    if (!isChampionPresent(this.lifeFor(this.player)!)) return;
    if (this.player.stunned > 0 || this.playerOrder === 'stop') return;

    if (this.playerOrder === 'target') {
      const target = this.findTarget(u, 1600, true);
      if (!target) {
        this.playerOrder = 'stop';
        return;
      }
      if (distance(u.pos, target.pos) <= u.attackRange) this.tryBasicAttack(this.player, target);
      else this.moveUnitToward(u, target.pos, dt);
      return;
    }

    if (this.playerOrder === 'attack-move') {
      const target = this.findTarget(u, 450);
      if (target) {
        if (distance(u.pos, target.pos) <= u.attackRange) this.tryBasicAttack(this.player, target);
        else this.moveUnitToward(u, target.pos, dt);
        return;
      }
    }

    const moveGoal = this.playerMoveGoal;
    if (moveGoal) {
      const d = distance(u.pos, moveGoal);
      if (d < 4) {
        this.setPlayerMoveGoal(null);
        this.playerOrder = 'stop';
      } else {
        this.moveUnitToward(u, moveGoal, dt);
      }
    }
  }

  /**
   * Drive one AI champion for a tick: find its nearest enemy, build a per-bot
   * {@link AiSnapshot}, decide via the pure {@link decideAction}, and apply the
   * intent through the SAME combat/ability/movement paths the human uses. When
   * the bot has no target it marches its assigned lane's waypoints toward the
   * enemy nexus so champions actually push lanes instead of standing still.
   */
  private updateBotChampion(bot: Entity, dt: number) {
    const u = bot.unit;
    const state = bot.bot!;
    if (!isChampionPresent(this.lifeFor(bot)!)) return;
    if (bot.stunned > 0) return;

    const objective = this.objectiveForBot(bot);
    const target = objective?.unit ?? this.findTarget(u, 1200, true);
    const cadence = DIFFICULTY_CONFIG[this.difficulty];

    // Difficulty changes both how quickly a bot can react and how often it may
    // reconsider. Keep executing the accepted intent between decisions so the
    // simulation remains smooth rather than freezing between AI ticks.
    if (state.pendingIntent && this.world.simTime >= state.intentReadyAt) {
      state.currentIntent = state.pendingIntent;
      state.pendingIntent = null;
    }
    if (this.world.simTime >= state.nextDecisionAt) {
      const snapshot = this.buildAiSnapshot(bot, target);
      state.pendingIntent = this.opponentGhost
        ? ghostDecide(snapshot, this.opponentGhost)
        : decideAction(snapshot);
      state.intentReadyAt = this.world.simTime + cadence.reactionDelayMs / 1000;
      state.nextDecisionAt = this.world.simTime + cadence.decisionIntervalMs / 1000;
    }

    const intent = state.currentIntent;
    const homeBase = BASE_POSITIONS[state.side];

    switch (intent) {
      case 'approach': {
        if (target) {
          this.moveUnitToward(u, target.pos, dt);
        } else {
          const goal = this.laneAdvanceGoal(bot, state);
          this.moveUnitToward(u, goal, dt);
          // Advance to the next lane waypoint once this one is reached so the
          // bot keeps marching toward the enemy nexus.
          if (
            this.lanePushFor(bot) < state.pushPath.length - 1 &&
            distance(u.pos, goal) <= 30
          ) {
            this.world.lanePush[bot.unit.id] = this.lanePushFor(bot) + 1;
          }
        }
        break;
      }
      case 'retreat': {
        this.moveUnitToward(u, homeBase, dt);
        break;
      }
      case 'attack': {
        if (target) this.tryBasicAttack(bot, target);
        break;
      }
      case 'castQ':
      case 'castW':
      case 'castE':
      case 'castR': {
        const slot = intent.slice(4) as CooldownKey;
        const ability = this.abilityBySlot(state.champion, slot);
        const aim = ability.mechanics?.targetPolicy === 'aimed-ally'
          ? this.preferredAllyAim(bot, ability)
          : ability.behavior === 'heal' || ability.behavior === 'buff'
            ? { ...u.pos }
            : target?.pos;
        if (aim) this.botCast(bot, slot, aim);
        break;
      }
    }
  }

  private objectiveForBot(bot: Entity): Entity | undefined {
    if (!this.rules.objectives.enabled || bot.unit.hp / bot.unit.maxHp < 0.45) return undefined;
    return this.objectives
      .map((objective) => objective.entity)
      .filter(
        (objective): objective is Entity =>
          objective != null &&
          this.isEntityDamageable(objective) &&
          distance(bot.unit.pos, objective.unit.pos) <= 1800,
      )
      .sort(
        (a, b) =>
          distance(bot.unit.pos, a.unit.pos) - distance(bot.unit.pos, b.unit.pos) ||
          a.unit.id.localeCompare(b.unit.id),
      )[0];
  }

  /**
   * The next lane waypoint a bot should walk toward while pushing. Returns the final waypoint once the lane is fully
   * walked. No per-frame allocation beyond reading the cached path.
   *
   * Takes the ENTITY rather than just its bot state, because how far along the lane it has marched now lives in
   * `world.lanePush` keyed by unit id, not on the bot.
   */
  private laneAdvanceGoal(entity: Entity, state: BotState): Vec2 {
    const path = state.pushPath;
    if (path.length === 0) return BASE_POSITIONS[state.side];
    // (path is authored ally->enemy; laneWaypoints already reversed for enemy).
    return path[Math.min(this.lanePushFor(entity), path.length - 1)];
  }

  /**
   * Resolve the per-side state a snapshot needs, for a bot OR for the human.
   *
   * buildAiSnapshot originally read everything from `entity.bot!`, which threw for the
   * player - and the player's snapshot is exactly what learning a ghost needs. It has
   * to be built the SAME way as a bot's, not approximately: learnGhost scores each
   * snapshot with the base policy, so a snapshot missing context would be measured
   * against a different baseline and the learned biases would describe nothing.
   *
   * The scene already keeps the human's counterparts as separate fields and already
   * resolves them this way elsewhere (`isHuman ? this.ownedItems : entity.bot!.ownedItems`),
   * so this only names that pattern once.
   */
  private sideState(entity: Entity): {
    champion: Champion;
    resource: number;
    maxResource: number;
    cds: CooldownState;
    progress: ChampionLevel;
    /** Held gold, from `world.economy`. Exposed here so no caller has to know which of the two paths it is on. */
    gold: number;
    ownedItems: string[];
    side: MapSide;
  } {
    if (entity === this.player) {
      return {
        champion: this.playerChampion,
        resource: this.resourceFor(entity).current,
        maxResource: this.resourceFor(entity).max,
        cds: this.cooldownsFor(entity),
        progress: this.progressionFor(entity),
        gold: this.economyFor(entity).gold,
        ownedItems: this.ownedItems,
        // The human is always the ally side in a local match.
        side: 'ally',
      };
    }
    const bot = entity.bot!;
    return {
      champion: bot.champion,
      resource: this.resourceFor(entity).current,
      maxResource: this.resourceFor(entity).max,
      cds: this.cooldownsFor(entity),
      progress: this.progressionFor(entity),
      gold: this.economyFor(entity).gold,
      ownedItems: bot.ownedItems,
      side: bot.side,
    };
  }

  private buildAiSnapshot(bot: Entity, target: Unit | undefined): AiSnapshot {
    const u = bot.unit;
    const state = this.sideState(bot);
    const dist = target ? distance(u.pos, target.pos) : Infinity;
    const [q, w, e, r] = state.champion.abilities;
    const nearbyChampions = this.champions.filter(
      (entity) => isChampionPresent(this.lifeFor(entity)!) && distance(entity.unit.pos, u.pos) <= 650,
    );
    const nearbyMinions = this.minions.filter(
      (entity) => !entity.unit.dead && distance(entity.unit.pos, u.pos) <= 600,
    );
    const alliedWave = nearbyMinions.filter((entity) => entity.unit.team === u.team).length;
    const hostileWave = nearbyMinions.filter((entity) => areHostile(u.team, entity.unit.team)).length;
    const waveTotal = Math.max(1, alliedWave + hostileWave);
    const build = recommendBuild(state.champion.role, state.ownedItems, state.gold);
    const nextPurchaseCost = build?.nextPurchasableComponent?.cost ?? build?.remainingCost;
    const objectivePressure = this.objectives.some(
      (objective) =>
        objective.entity != null &&
        !objective.entity.unit.dead &&
        distance(objective.entity.unit.pos, u.pos) <= 1000,
    )
      ? 1
      : 0;
    const turretDanger = this.structures.some(
      (structure) =>
        !structure.unit.dead &&
        areHostile(u.team, structure.unit.team) &&
        structure.node?.kind.endsWith('Turret') &&
        distance(structure.unit.pos, u.pos) <= structure.unit.attackRange,
    )
      ? 1
      : 0;
    return {
      selfHpPct: u.hp / u.maxHp,
      selfResourcePct: state.resource / state.maxResource,
      distanceToTarget: dist,
      hasTarget: !!target,
      attackRange: u.attackRange,
      cooldowns: state.cds,
      abilityRanges: {
        Q: q.range,
        W: w.range,
        E: e.range,
        R: r.range,
      },
      abilityCosts: { Q: q.cost, W: w.cost, E: e.cost, R: r.cost },
      abilityBehaviors: { Q: q.behavior, W: w.behavior, E: e.behavior, R: r.behavior },
      maxResource: state.maxResource,
      targetLowHp: target ? target.hp / target.maxHp < 0.35 : false,
      context: {
        role: state.champion.role,
        turretDanger,
        wavePressure: (alliedWave - hostileWave) / waveTotal,
        objectivePressure,
        nearbyAllies: nearbyChampions.filter((entity) => entity.unit.team === u.team).length,
        nearbyEnemies: nearbyChampions.filter((entity) => areHostile(u.team, entity.unit.team)).length,
        gold: state.gold,
        nextPurchaseCost,
        shopAvailable: this.inBase(u, state.side),
      },
    };
  }

  private updateMinions(dt: number) {
    for (const m of this.minions) {
      const u = m.unit;
      if (u.dead || !m.rift || !m.path) continue;
      const target = this.findTarget(u, 200);
      if (target && distance(u.pos, target.pos) <= u.attackRange) {
        this.tryBasicAttackUnit(m, target);
      } else {
        // Route movement through the tested advanceMinion helper (in world
        // units), then mirror the result onto the screen position.
        const worldPath = laneWaypoints(m.rift.lane, m.rift.team);
        const worldDt = dt; // advanceMinion uses world-unit speeds internally.
        const res = advanceMinion(m.rift, worldPath, worldDt);
        m.rift.pos = res.pos;
        m.rift.waypointIndex = res.waypointIndex;
        m.rift.distanceTravelled = res.distanceTravelled;
        const screen = res.pos;
        u.pos.x = screen.x;
        u.pos.y = screen.y;
      }
    }
  }

  /**
   * One tick of a turret's or objective monster's auto-attack, through the SHARED extracted rule.
   *
   * Both used to have their own copy of "pick a hostile in range, fire if off cooldown, reset", and the pure step in
   * rift/autoAttack.ts was a third. It could not be called from here until gameplay moved to world units, because the
   * step is world-space by construction and this scene computed in viewport-derived pixels.
   *
   * The scene keeps its own storage and its own drawing. What it delegates is the DECISION — which target, and whether
   * to fire — so there is exactly one implementation of the part that has to agree between peers.
   */
  private runAutoAttack(entity: Entity, color: number, drawAs: 'beam' | 'projectile', range: number): void {
    const u = entity.unit;
    if (u.dead) return;

    const attacker: AutoAttacker = {
      id: u.id,
      team: u.team,
      pos: u.pos,
      ad: u.ad,
      attackRange: range,
      attackCdRemaining: u.attackCdRemaining,
      attackSpeed: u.attackSpeed,
      stunned: entity.stunned,
      dead: u.dead,
    };
    const reachable = this.allEntities
      .filter((candidate) => this.isEntityDamageable(candidate) && this.canDamageTarget(u, candidate))
      .map((candidate) => candidate.unit);

    // dt is 0: the scene already advanced this unit's cooldown in regenAndTick, and passing a real dt here would advance
    // it twice. The step is being asked to DECIDE, not to keep time.
    const result = resolveAutoAttacks([attacker], reachable, this.world.targets, 0, BASIC_PROJECTILE_SPEED);
    this.world.targets = result.targets;

    for (const shot of result.shots) {
      const target = reachable.find((candidate) => candidate.id === shot.targetId);
      if (!target) continue;
      const dueAt = this.queueTargetedImpact(entity, target, shot.rawDamage, color, BASIC_PROJECTILE_SPEED);
      const ms = Math.max(1, (dueAt - this.world.simTime) * 1000);
      if (drawAs === 'beam') this.drawBeam(u.pos, target.pos, color, ms);
      else this.drawProjectile(u.pos, target.pos, color, ms);
      resetAttackCooldown(u);
    }
  }

  private updateTurret(turret: Entity) {
    this.runAutoAttack(turret, 0xffcc55, 'beam', turret.unit.attackRange);
  }

  // ---- Combat actions ------------------------------------------------------

  private tryBasicAttack(attacker: Entity, target: Unit) {
    this.tryBasicAttackUnit(attacker, target);
  }

  private tryBasicAttackUnit(attacker: Entity, target: Unit) {
    const u = attacker.unit;
    const targetEntity = this.entityForUnit(target);
    /**
     * Every part of this that two peers must agree on now comes from {@link planBasicAttack}: whether the swing happens,
     * how hard it lands, whether it flies or lands at once, and when the next one is allowed. The scene keeps what does
     * not have to agree — the pose, the projectile line, the damage number — and keeps OWNING the passive state, since it
     * is the authority for a real match. What it no longer owns is the rules.
     *
     * The gates are not re-checked here on purpose. Duplicating even the range test would put the melee/ranged boundary
     * in two places, and a boundary that disagrees by a pixel is exactly the kind of divergence that only shows up in a
     * networked match, several seconds after the tick that caused it.
     */
    const attackerItems = attacker === this.player ? this.ownedItems : attacker.bot?.ownedItems ?? [];
    const attackerBuffs = this.buffsFor(attacker);
    const plan = planBasicAttack(
      {
        id: u.id,
        championId: attacker.champion?.id ?? null,
        pos: u.pos,
        ad: u.ad,
        attackRange: u.attackRange,
        attackCdRemaining: u.attackCdRemaining,
        attackSpeed: u.attackSpeed,
        items: attackerItems,
        hasRedBuff: attackerBuffs?.buffs.some((buff) => buff.kind === 'red') ?? false,
      },
      {
        id: target.id,
        pos: target.pos,
        dead: target.dead,
        damageable: Boolean(targetEntity && this.isEntityDamageable(targetEntity)),
      },
      this.world.simTime,
      this.world.passives,
    );
    // Safe on both arms: a blocked plan returns the SAME state object, so this cannot bank a stack for a whiffed swing.
    this.world.passives = plan.passives;
    if (plan.kind !== 'strike' || !targetEntity) return;

    if (attacker === this.player) {
      this.cancelRecall('attack');
    }
    if (attacker.champion) {
      this.setChampionPose(attacker, 'attack', CHAMPION_POSE_HOLD_MS.attack, 1);
    }
    if (plan.delivery === 'projectile') {
      const dueAt = this.queueTargetedImpact(
        attacker,
        target,
        plan.rawDamage,
        0xf0e6d2,
        BASIC_PROJECTILE_SPEED,
      );
      this.drawProjectile(
        u.pos,
        target.pos,
        0xf0e6d2,
        Math.max(1, (dueAt - this.world.simTime) * 1000),
      );
    } else {
      this.applyTargetedDamage(attacker, targetEntity, plan.rawDamage, 0xf0e6d2);
    }
    u.attackCdRemaining = plan.attackCdRemaining;
  }

  private tryPlayerCast(slot: CooldownKey) {
    if (
      this.matchEnded || this.pauseReasons.size > 0 || this.hasModalFocus() ||
      !isChampionPresent(this.lifeFor(this.player)!) || this.player.stunned > 0
    ) return;
    this.cancelRecall('ability');
    const pointer = this.input.activePointer;
    this.tryPlayerCastAt(slot, this.pointerToGround(pointer));
  }

  private tryPlayerCastAt(slot: CooldownKey, aim: Vec2) {
    if (
      this.matchEnded || this.pauseReasons.size > 0 || this.hasModalFocus() ||
      !isChampionPresent(this.lifeFor(this.player)!) || this.player.stunned > 0
    ) return;
    this.cancelRecall('ability');
    // Aim has already been converted to the flat authoritative plane.
    const playerCds = this.cooldownsFor(this.player);
    this.castAbility(this.player, slot, aim, this.playerChampion, playerCds, () => {
      const cost = this.abilityBySlot(this.playerChampion, slot).cost;
      if (!canAfford(this.resourceFor(this.player), cost) || playerCds[slot] > 0) return false;
      this.spend(this.player, cost);
      return true;
    });
  }

  private aimedAlly(caster: Entity, ability: Ability, aim: Vec2): Entity | undefined {
    return this.champions
      .filter(
        (ally) =>
          ally.unit.team === caster.unit.team &&
          isChampionPresent(this.lifeFor(ally)!) &&
          distance(ally.unit.pos, caster.unit.pos) <= ability.range &&
          distance(ally.unit.pos, aim) <= 90,
      )
      .sort(
        (a, b) =>
          distance(a.unit.pos, aim) - distance(b.unit.pos, aim) ||
          a.unit.id.localeCompare(b.unit.id),
      )[0];
  }

  private preferredAllyAim(caster: Entity, ability: Ability): Vec2 | undefined {
    return this.champions
      .filter(
        (ally) =>
          ally.unit.team === caster.unit.team &&
          isChampionPresent(this.lifeFor(ally)!) &&
          distance(ally.unit.pos, caster.unit.pos) <= ability.range,
      )
      .sort(
        (a, b) =>
          a.unit.hp / Math.max(1, a.unit.maxHp) - b.unit.hp / Math.max(1, b.unit.maxHp) ||
          a.unit.id.localeCompare(b.unit.id),
      )[0]?.unit.pos;
  }

  private triggerCastPassive(caster: Entity, champion: Champion) {
    const side = caster.unit.team;
    const candidates = this.champions
      .filter(
        (ally) => ally.unit.team === side && isChampionPresent(this.lifeFor(ally)!) &&
          distance(ally.unit.pos, caster.unit.pos) <= (champion.id === 'dawnsong' ? 600 : 650),
      )
      .sort(
        (a, b) => a.unit.hp / a.unit.maxHp - b.unit.hp / b.unit.maxHp || a.unit.id.localeCompare(b.unit.id),
      );
    const target = candidates[0];
    if (!target) return;
    if (champion.id === 'dawnsong') {
      const key = `dawnsong-passive:${caster.unit.id}`;
      if ((this.internalCooldowns.get(key) ?? 0) <= this.world.simTime) {
        applyHeal(target.unit, 35);
        this.internalCooldowns.set(key, this.world.simTime + 3);
      }
    } else if (champion.id === 'wardlight') {
      const key = `wardlight-passive:${caster.unit.id}`;
      const count = (this.passiveCounters.get(key) ?? 0) + 1;
      if (count >= 3) {
        applyHeal(target.unit, 45);
        this.passiveCounters.set(key, 0);
      } else this.passiveCounters.set(key, count);
    }
  }

  private botCast(bot: Entity, slot: CooldownKey, aim: Vec2) {
    const state = bot.bot!;
    const cds = this.cooldownsFor(bot);
    this.castAbility(bot, slot, aim, state.champion, cds, () => {
      const cost = this.abilityBySlot(state.champion, slot).cost;
      if (!canAfford(this.resourceFor(bot), cost) || cds[slot] > 0) return false;
      this.spend(bot, cost);
      return true;
    });
  }

  private abilityBySlot(champion: Champion, slot: CooldownKey): Ability {
    const map: Record<CooldownKey, Ability> = {
      Q: champion.abilities[0],
      W: champion.abilities[1],
      E: champion.abilities[2],
      R: champion.abilities[3],
    };
    return map[slot];
  }

  private cooldownFor(caster: Entity, champion: Champion, slot: CooldownKey): number {
    const base = this.abilityBySlot(champion, slot).cooldown;
    const itemIds = caster === this.player ? this.ownedItems : caster.bot?.ownedItems ?? [];
    let cdr = totalModifiers(itemIds).cooldownReduction;
    // One branch, not two: this used to ask about the player's blue buff and then about a bot's, with identical bodies.
    if (this.buffsFor(caster).buffs.some((b) => b.kind === 'blue')) {
      cdr += BUFF_EFFECTS.blue.cooldownReduction;
    }
    return base * (1 - Math.min(0.5, cdr));
  }

  private castAbility(
    caster: Entity,
    slot: CooldownKey,
    aim: Vec2,
    champion: Champion,
    cds: CooldownState,
    spend: () => boolean,
  ) {
    const ability = this.abilityBySlot(champion, slot);
    const origin = { ...caster.unit.pos };
    const aimedAlly = ability.mechanics?.targetPolicy === 'aimed-ally'
      ? this.aimedAlly(caster, ability, aim)
      : undefined;
    const executeTarget = ability.mechanics?.targetPolicy === 'lowest-hp-ratio-hostile'
      ? lowestHpRatioHostile(
          caster.unit,
          this.champions.filter((entity) => this.isEntityDamageable(entity)).map((entity) => entity.unit),
          ability.range,
        )
      : undefined;
    if (ability.mechanics?.targetPolicy === 'aimed-ally' && !aimedAlly) return;
    if (ability.mechanics?.targetPolicy === 'lowest-hp-ratio-hostile' && !executeTarget) return;
    const resolvedAim = aimedAlly?.unit.pos ?? executeTarget?.pos ?? aim;
    const endpoint = this.resolveCastEndpoint(caster, ability, resolvedAim);
    if (executeTarget && distance(endpoint, executeTarget.pos) > 50) return;
    if (!spend()) return;
    if (caster === this.player) this.recordLearning(`cast-${slot}` as LearningAction);
    startCooldown(cds, slot, this.cooldownFor(caster, champion, slot));
    this.triggerCastPassive(caster, champion);
    let effect = resolveAbility(ability);
    if (ability.mechanics?.dash) effect = { ...effect, dashes: true };
    const color = Phaser.Display.Color.HexStringToColor(champion.accentColor).color;

    this.setChampionPose(
      caster,
      `cast${slot}` as ChampionPose,
      slot === 'R' ? 420 : CHAMPION_POSE_HOLD_MS.cast,
      2,
    );
    audio.playChampionCue(champion.id, slot, this.audioOptionsFor(origin));
    this.castFlare(caster, color, slot === 'R');

    /**
     * From here the DECISION is the pure plan's, and this method only performs it.
     *
     * What used to live here was nine `champion.id ===` checks across seven (champion, slot) pairs, interleaved with a
     * pose, a flare, two floating numbers, two pulses and three draw calls. Only the effects have to agree between peers;
     * a colour does not. So the effects moved to rift/abilityEffects.ts and the drawing stayed.
     */
    const plan = planCast({
      championId: champion.id,
      slot,
      ability,
      effect,
      caster: castActorFor(caster, this.lifeFor(caster)),
      everyone: this.champions.map((entity) => castActorFor(entity, this.lifeFor(entity))),
      origin,
      endpoint,
      aimedAllyId: aimedAlly?.unit.id ?? null,
      executeTargetId: executeTarget?.id ?? null,
      now: this.world.simTime,
      hasChronoCore: (caster === this.player ? this.ownedItems : caster.bot?.ownedItems ?? []).includes('chronoCore'),
    });

    // A refusal is an ally-targeted ability with nobody aimed. It must not draw, and it must not have spent a cooldown —
    // the original expressed this as a bare `return` in the middle of the method, which is easy to miss and easy to break.
    if (plan.refused) return;

    for (const op of plan.ops) {
      const target = op.kind === 'dash' || op.kind === 'openDashWindow' || op.kind === 'smokeWindow' || op.kind === 'trap' || op.kind === 'damage'
        ? caster
        : this.champions.find((c) => c.unit.id === op.targetId) ?? caster;
      switch (op.kind) {
        case 'dash':
          caster.unit.pos.x = op.to.x;
          caster.unit.pos.y = op.to.y;
          this.drawDashTrail(origin, caster.unit.pos, color);
          break;
        case 'openDashWindow':
          this.world.passives = openDashWindow(this.world.passives, op.casterId, op.until);
          break;
        case 'smokeWindow':
          this.internalCooldowns.set(`nightveil-smoke:${op.casterId}`, op.until);
          break;
        case 'heal': {
          const healed = applyHeal(target.unit, op.amount);
          this.floatingDamage(target.unit.pos, healed, 0x3ad16a, '+');
          if (target === caster) this.pulse(caster.container, 0x3ad16a);
          break;
        }
        case 'shield':
          applyShield(target.effects, op.key, op.amount, op.expiresAt);
          break;
        case 'armor':
          applyArmor(target.effects, op.key, op.amount, op.expiresAt);
          break;
        case 'movementBuff':
          applyMovementBuff(target.effects, op.key, op.percent, op.expiresAt);
          break;
        case 'cleanseSlows':
          cleanseSlows(target.effects);
          break;
        case 'trap':
          this.traps.push({
            /**
             * Id derived from the caster and the ARM TIME, through the same rule the pure step uses.
             *
             * It used to be `trap-${id}-${this.world.waves.nextOrder++}` — and that counter is also the wave
             * scheduler's `nextOrder`, from which minion identity is derived. So arming a trap shifted the insertion
             * order the next minion would receive, making minion ids depend on how many abilities had been cast. On a
             * replay where a cast lands differently, every later minion id moves.
             */
            id: trapIdFor(caster.unit.id, this.world.simTime),
            source: { ...caster.unit, pos: { ...origin } },
            point: { ...op.point },
            radius: op.radius,
            rawDamage: op.rawDamage,
            color,
            expiresAt: op.expiresAt,
            slowPercent: op.slowPercent,
            slowDuration: op.slowDuration,
          });
          break;
        case 'damage': {
          const dueAt = op.dashes
            ? this.world.simTime
            : projectileImpactTime(this.world.simTime, op.origin, op.endpoint, SKILLSHOT_PROJECTILE_SPEED);
          if (op.area) this.drawAoe(op.endpoint, op.radius, color);
          else if (!op.dashes) {
            this.drawProjectile(op.origin, op.endpoint, color, Math.max(1, (dueAt - this.world.simTime) * 1000));
          }
          this.world.pendingImpacts.push({
            dueAt,
            // The impact queue's OWN counter. Separated from the wave scheduler's in this commit: they are two different
            // monotonic sequences and sharing one made each depend on the other's traffic.
            insertionOrder: this.world.nextInsertionOrder++,
            source: { ...caster.unit, pos: { ...op.origin } },
            ...(op.targetId
              ? { targetId: op.targetId }
              : op.lineWidth
                ? {
                    line: {
                      origin: { ...op.origin },
                      endpoint: { ...op.endpoint },
                      halfWidth: op.lineWidth,
                      subsequentDamageMultiplier: op.piercingDamageMultiplier ?? 1,
                    },
                  }
                : { point: { ...op.endpoint } }),
            radius: op.radius,
            rawDamage: op.rawDamage,
            color,
            stunDuration: op.stunDuration,
            slowPercent: op.slowPercent,
            slowDuration: op.slowDuration,
            pullDuration: op.pullDuration,
            ability: true,
            ultimate: op.ultimate,
            singleTarget: op.targetId ? true : op.lineWidth ? false : !op.area,
            chronoProc: (caster === this.player ? this.ownedItems : caster.bot?.ownedItems ?? []).includes('chronoCore'),
          });
          break;
        }
      }
    }
  }

  private audioOptionsFor(source: Vec2): { pan: number; distance: number } {
    const listener = this.player?.unit.pos ?? source;
    const sourceScreen = project(source);
    const listenerScreen = project(listener);
    return {
      pan: Phaser.Math.Clamp((sourceScreen.x - listenerScreen.x) / 320, -1, 1),
      // Audio distance is intentionally abstract/small; the engine applies
      // inverse attenuation, so raw world pixels would make every remote cue mute.
      distance: Phaser.Math.Clamp(distance(source, listener) / (500), 0, 4),
    };
  }

  private resolveCastEndpoint(caster: Entity, ability: Ability, aim: Vec2): Vec2 {
    const origin = caster.unit.pos;
    const range = ability.range;
    if (ability.behavior === 'dash' || ability.mechanics?.dash) {
      const blockers = this.structures
        .filter((structure) => !structure.unit.dead)
        .map((structure) => ({ id: structure.unit.id, pos: structure.unit.pos, radius: 52 }));
      return resolveDashEndpoint(
        origin,
        aim,
        range,
        { minX: 0, maxX: WORLD_SIZE, minY: 0, maxY: WORLD_SIZE },
        blockers,
        ability.mechanics?.direction === 'away-from-aim',
      );
    }
    const dx = aim.x - origin.x;
    const dy = aim.y - origin.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d <= range) return { x: this.clampX(aim.x), y: this.clampY(aim.y) };
    return {
      x: this.clampX(origin.x + (dx / d) * range),
      y: this.clampY(origin.y + (dy / d) * range),
    };
  }

  private clampX(x: number): number {
    return Phaser.Math.Clamp(x, 0, WORLD_SIZE);
  }

  private clampY(y: number): number {
    return Phaser.Math.Clamp(y, 0, WORLD_SIZE);
  }

  private moveUnitToward(u: Unit, goal: Vec2, dt: number) {
    const d = distance(u.pos, goal);
    if (d < 1) return;
    const entity = this.entityForUnit(u);
    // Pure reads. These used to be activePull/strongestSlow/strongestMovementBuff, each
    // of which expired effects as a side effect - three mutating queries per unit per
    // frame. Expiry now happens once per tick in advanceEffects(); see effects.ts.
    if (entity && readPull(entity.effects, this.world.simTime)) return;
    const smokeMultiplier = entity?.champion?.id === 'nightveil' &&
      (this.internalCooldowns.get(`nightveil-smoke:${u.id}`) ?? 0) > this.world.simTime ? 1.2 : 1;
    const huntingBonus = entity?.champion?.id === 'grimtrail' && this.champions.some(
      (candidate) => areHostile(u.team, candidate.unit.team) && !candidate.unit.dead &&
        candidate.unit.hp / candidate.unit.maxHp < 0.35 && distance(u.pos, candidate.unit.pos) <= 700,
    ) ? 25 : 0;
    const effectState = entity?.effects;
    // The arithmetic itself lives in game/worldStep so a headless rollback step and the
    // scene cannot drift apart. The scene keeps deciding WHAT the modifiers are; the
    // extracted function decides what they do.
    const travel = moveUnitTowardPure(
      u,
      goal,
      dt,
      {
        speedMultiplier: smokeMultiplier,
        flatBonus: huntingBonus,
        buffFraction: effectState ? readMovementBuff(effectState, this.world.simTime) : 0,
        slowFactor: effectState ? readSlow(effectState, this.world.simTime) : 0,
      },
      {
        minX: 0,
        maxX: WORLD_SIZE,
        minY: 0,
        maxY: WORLD_SIZE,
      },
    );
    const champion = this.entityForUnit(u);
    if (champion === this.player && travel > 0) this.recordLearning('move');
    if (champion?.champion?.id === 'duskarrow' && travel > 0) {
      this.world.passives = addTravelled(this.world.passives, u.id, travel);
    }
    if (champion?.champion && travel > 0) champion.movedThisFrame = true;
  }

  private advanceChampionLives() {
    for (const entity of this.champions) {
      const previous = this.lifeFor(entity)!;
      const next = advanceChampionLife(previous, this.world.simTime, this.mode);
      this.world.lives[entity.unit.id] = next;
      if (!isChampionPresent(next)) {
        entity.unit.dead = true;
        const showingDeathPose =
          entity.championPose === 'death' && this.world.simTime < (entity.deathVisibleUntil ?? 0);
        entity.container.setVisible(showingDeathPose);
        entity.shadow?.setVisible(false);
        continue;
      }
      if (!isChampionPresent(previous) && isChampionPresent(next)) {
        const side: MapSide = entity.bot?.side ?? 'ally';
        entity.unit.dead = false;
        entity.unit.hp = entity.unit.maxHp;
        entity.unit.pos = { ...BASE_POSITIONS[side] };
        entity.stunned = 0;
        entity.container.setVisible(true).setAlpha(1);
        entity.shadow?.setVisible(true).setAlpha(0.32);
        if (entity === this.player) this.fillResource(entity);
        if (entity.bot) {
          this.fillResource(entity);
          this.world.lanePush[entity.unit.id] = 0;
          entity.bot.currentIntent = 'approach';
          entity.bot.pendingIntent = null;
          entity.bot.intentReadyAt = this.world.simTime;
          entity.bot.nextDecisionAt = this.world.simTime;
        }
        entity.poseLockedUntil = 0;
        entity.posePriority = 0;
        entity.deathVisibleUntil = undefined;
        this.setChampionPose(entity, 'idle');
        delete this.world.targets[entity.unit.id];
      }
    }
  }

  private reviveInhibitors() {
    for (const [id, killedAt] of Object.entries(this.inhibitorKillTimes)) {
      if (!isInhibitorAlive(this.world.simTime, killedAt, this.mode)) continue;
      const inhibitor = this.structureById.get(id);
      if (inhibitor) {
        inhibitor.unit.dead = false;
        inhibitor.unit.hp = inhibitor.unit.maxHp;
        inhibitor.container.setVisible(true).setAlpha(1);
        inhibitor.shadow?.setVisible(true).setAlpha(0.32);
      }
      delete this.inhibitorKillTimes[id];
    }
  }

  private applyTeamChampionStats(side: MapSide) {
    for (const champion of this.champions) {
      const championSide: MapSide = champion.bot?.side ?? 'ally';
      if (championSide === side) this.applyChampionStats(champion, side);
    }
  }

  /**
   * One tick of every armed trap, through the SHARED extracted step.
   *
   * rift/traps.ts was written FROM this code, which means there were two copies of the same rule and only one of them was
   * in the snapshot. This is the commit that makes there be one. The scene keeps the damage application, the colour and
   * its own richer trap record; what it delegates is which trap catches whom, and when a trap has lapsed.
   *
   * `this.traps.sort(...)` also went away. Array.prototype.sort mutates IN PLACE, so iterating `this.traps.sort(...)`
   * reordered the scene's own field as a side effect of reading it — harmless while the comparator was total, and not
   * something to leave standing.
   */
  private tickTraps(): void {
    if (this.traps.length === 0) return;
    const byId = new Map(this.traps.map((trap) => [trap.id, trap]));
    const bodies = this.allEntities.filter(
      (candidate) => candidate.unit.kind !== 'turret' && candidate.unit.kind !== 'nexus',
    );
    const entityById = new Map(bodies.map((e) => [e.unit.id, e]));

    const result = resolveTraps(
      this.traps.map((trap) => ({
        id: trap.id,
        sourceId: trap.source.id,
        sourceTeam: trap.source.team,
        point: trap.point,
        radius: trap.radius,
        rawDamage: trap.rawDamage,
        expiresAt: trap.expiresAt,
        slowPercent: trap.slowPercent,
        slowDuration: trap.slowDuration,
      })),
      bodies.map((e) => ({ id: e.unit.id, pos: e.unit.pos })),
      this.world.simTime,
      // Judged per TRAP, using that trap's own source — which is why the step takes a callback rather than a flag.
      (trapState, candidate) => {
        const trap = byId.get(trapState.id);
        const entity = entityById.get(candidate.id);
        return Boolean(trap && entity && this.canDamageTarget(trap.source, entity));
      },
    );

    for (const trigger of result.triggers) {
      const trap = byId.get(trigger.trapId);
      const target = entityById.get(trigger.targetId);
      if (!trap || !target) continue;
      this.applyTargetedDamage(trap.source, target, trigger.rawDamage, trap.color, {
        ability: true,
        slowPercent: trigger.slowPercent,
        slowDuration: trigger.slowDuration,
      });
    }
    this.traps = result.traps.map((survivor) => byId.get(survivor.id)).filter((t): t is TrapRuntime => Boolean(t));
  }

  private syncTrapVisuals(): void {
    const activeIds = new Set(this.traps.map((trap) => trap.id));
    for (const [id, marker] of this.trapGraphics) {
      if (activeIds.has(id)) continue;
      marker.destroy();
      this.trapGraphics.delete(id);
    }
    for (const trap of this.traps) {
      const point = project(trap.point);
      let marker = this.trapGraphics.get(trap.id);
      if (!marker) {
        marker = this.add.circle(point.x, point.y, Math.max(8, trap.radius), trap.color, 0.16)
          .setStrokeStyle(2, trap.color, 0.9)
          .setDepth(VFX_DEPTH - 2);
        this.trapGraphics.set(trap.id, marker);
      }
      marker.setPosition(point.x, point.y).setVisible(true);
    }
  }

  private spawnObjective(id: EpicMonster): Entity {
    const profile = monsterStats(id);
    const pit = EPIC_PITS.find((candidate) => candidate.id === id)!;
    const pos = pit.pos;
    const unit = this.makeUnit(`objective-${id}-${Math.round(this.world.simTime * 1000)}`, 'monster', 'neutral', pos, {
      maxHp: profile.hp,
      ad: profile.ad,
      armor: profile.armor,
      attackRange: OBJECTIVE_ATTACK_RANGE,
      attackSpeed: 0.7,
      moveSpeed: 0,
    });
    const key = markerSheetKey(id);
    const size: SpriteSize = {
      width: MARKER_FRAME.width,
      height: MARKER_FRAME.height,
      footY: Math.round(MARKER_FRAME.height * MARKER_FOOT_FRAC),
    };
    const body = this.makeBillboard(key, size);
    const container = this.add.container(pos.x, pos.y, [body]);
    const shadow = this.makeShadow(size.width * 0.9);
    const entity: Entity = {
      unit,
      container,
      body,
      shadow,
      heightPx: 10,
      stunned: 0,
      effects: createEffectState(),
      objectiveId: id,
    };
    this.attachHpBar(entity, size.height + 8);
    this.addEntity(entity);
    return entity;
  }

  private spawnCamp(camp: Camp): Entity[] {
    const center = camp.pos;
    const tintByType: Record<Camp['type'], number> = {
      blue: 0x4f8fff,
      red: 0xe85b45,
      raptors: 0xcf7b45,
      wolves: 0x9eb7c9,
      gromp: 0x69a85b,
      krugs: 0xb99b78,
      scuttle: 0x65d6c4,
    };
    return camp.members.map((member, index) => {
      const angle = camp.members.length === 1 ? 0 : (Math.PI * 2 * index) / camp.members.length;
      const spread = camp.members.length === 1 ? 0 : 42;
      const pos = {
        x: center.x + Math.cos(angle) * spread,
        y: center.y + Math.sin(angle) * spread,
      };
      const unit = this.makeUnit(`camp-${camp.id}-${member.key}`, 'monster', 'neutral', pos, {
        maxHp: member.hp,
        ad: member.ad,
        armor: member.armor,
        attackRange: 160,
        attackSpeed: 0.7,
        moveSpeed: 260,
      });
      const key = markerSheetKey('jungle');
      const size: SpriteSize = {
      width: MARKER_FRAME.width,
      height: MARKER_FRAME.height,
      footY: Math.round(MARKER_FRAME.height * MARKER_FOOT_FRAC),
    };
      const body = this.makeBillboard(key, size);
      body.setTint(tintByType[camp.type]).setScale(member.scale);
      const container = this.add.container(pos.x, pos.y, [body]);
      const shadow = this.makeShadow(size.width * 0.8 * member.scale);
      const entity: Entity = {
        unit,
        container,
        body,
        shadow,
        heightPx: 5,
        stunned: 0,
        effects: createEffectState(),
        campId: camp.id,
        campMemberKey: member.key,
      };
      this.attachHpBar(entity, size.height * member.scale + 7);
      this.addEntity(entity);
      return entity;
    });
  }

  private campMemberHome(runtime: CampRuntime, member: Entity): Vec2 {
    const center = runtime.camp.pos;
    const index = Math.max(0, runtime.camp.members.findIndex((candidate) => candidate.key === member.campMemberKey));
    const angle = runtime.camp.members.length === 1 ? 0 : (Math.PI * 2 * index) / runtime.camp.members.length;
    const spread = runtime.camp.members.length === 1 ? 0 : 42;
    return { x: center.x + Math.cos(angle) * spread, y: center.y + Math.sin(angle) * spread };
  }

  private updateJungleCamps(dt: number) {
    for (const runtime of this.camps) {
      for (const campEntity of runtime.members) {
        if (campEntity.unit.dead || campEntity.stunned > 0) continue;
        const home = this.campMemberHome(runtime, campEntity);
        const target = this.findTarget(campEntity.unit, 420);
        if (target && distance(target.pos, runtime.camp.pos) <= 620) {
          if (distance(campEntity.unit.pos, target.pos) <= campEntity.unit.attackRange) {
            this.tryBasicAttackUnit(campEntity, target);
          } else this.moveUnitToward(campEntity.unit, target.pos, dt);
        } else if (distance(campEntity.unit.pos, home) > 4) {
          this.moveUnitToward(campEntity.unit, home, dt);
          applyHeal(campEntity.unit, campEntity.unit.maxHp * 0.12 * dt);
        } else {
          applyHeal(campEntity.unit, campEntity.unit.maxHp * 0.08 * dt);
        }
      }
    }
  }

  private updateObjectiveMonsters() {
    for (const runtime of this.objectives) {
      const objective = runtime.entity;
      if (!objective) continue;
      this.runAutoAttack(
        objective,
        0xe8b84d,
        'projectile',
        Math.min(OBJECTIVE_ATTACK_RANGE, OBJECTIVE_LEASH_RANGE),
      );
    }
  }

  private queueTargetedImpact(
    source: Entity,
    target: Unit,
    rawDamage: number,
    color: number,
    speed: number,
  ): number {
    const dueAt = projectileImpactTime(this.world.simTime, source.unit.pos, target.pos, speed);
    this.world.pendingImpacts.push({
      dueAt,
      insertionOrder: this.world.nextInsertionOrder++,
      source: { ...source.unit, pos: { ...source.unit.pos } },
      targetId: target.id,
      radius: 0,
      rawDamage,
      color,
      stunDuration: 0,
      ability: false,
      ultimate: false,
      singleTarget: true,
      chronoProc: false,
    });
    return dueAt;
  }

  private processPendingImpacts() {
    const partitioned = partitionImpacts(this.world.pendingImpacts, this.world.simTime);
    this.world.pendingImpacts = partitioned.pending;
    for (const impact of partitioned.due.sort((a, b) => a.dueAt - b.dueAt || a.insertionOrder - b.insertionOrder)) {
      const source = impact.source;

      /**
       * WHO is struck comes from the pure step; applying the damage stays here.
       *
       * The three impact shapes used to be three branches in this method, each with its own copy of the
       * apply-damage call and two of them with their own copy of the chrono-proc rule. The shapes are still distinct in
       * the step — a line carries a per-body falloff that neither of the others has — but the application is now written
       * once.
       */
      const hits = resolveImpactHits(
        {
          targetId: impact.targetId,
          point: impact.point,
          line: impact.line,
          radius: impact.radius,
          singleTarget: impact.singleTarget,
        },
        this.allEntities.map((entity) => ({ id: entity.unit.id, pos: entity.unit.pos })),
        (candidate) => {
          const entity = this.entityById.get(candidate.id);
          return Boolean(entity && this.canDamageTarget(source, entity));
        },
      );

      for (const hit of hits) {
        const target = this.entityById.get(hit.targetId);
        if (!target) continue;
        this.applyTargetedDamage(
          source,
          target,
          impact.rawDamage * hit.damageMultiplier,
          impact.color,
          {
            ability: impact.ability,
            ultimate: impact.ultimate,
            stunDuration: impact.stunDuration,
            slowPercent: impact.slowPercent,
            slowDuration: impact.slowDuration,
            pullDuration: impact.pullDuration,
          },
        );
      }

      if (shouldProcChrono(impact.chronoProc, hits)) {
        const caster = this.entityById.get(source.id);
        const cds = caster ? this.cooldownsFor(caster) : undefined;
        if (cds) tickCooldowns(cds, CHRONO_PROC_SECONDS);
      }
    }
  }

  private canDamageTarget(source: Unit, target: Entity): boolean {
    if (!areHostile(source.team, target.unit.team) || !this.isEntityDamageable(target)) return false;
    if (target.unit.kind !== 'turret' && target.unit.kind !== 'nexus') return true;
    const livingIds = new Set(
      this.structures.filter((structure) => !structure.unit.dead).map((structure) => structure.unit.id),
    );
    return isStructureTargetable(target.unit.id, livingIds, this.mode);
  }

  private isEntityDamageable(entity: Entity): boolean {
    if (entity.unit.dead) return false;
    const life = this.lifeFor(entity);
    return life ? isChampionDamageable(life) : true;
  }

  private applyTargetedDamage(
    source: Entity | Unit,
    target: Entity,
    rawDamage: number,
    color: number,
    options: {
      ability?: boolean;
      ultimate?: boolean;
      stunDuration?: number;
      slowPercent?: number;
      slowDuration?: number;
      pullDuration?: number;
      periodic?: boolean;
    } = {},
  ) {
    const sourceUnit = 'unit' in source ? source.unit : source;
    if (!this.canDamageTarget(sourceUnit, target)) return;
    const hpPctBefore = target.unit.maxHp > 0 ? target.unit.hp / target.unit.maxHp : 0;
    const result = applyDamageWithEffects(target.unit, target.effects, rawDamage, this.world.simTime);
    const sourceEntity = this.entityById.get(sourceUnit.id);
    if (options.ability && !options.periodic && sourceEntity?.champion?.id === 'embermage' && !result.lethal) {
      const burnTotal = 25 + (sourceEntity.abilityPower ?? 0) * 0.1;
      applyBurn(target.effects, sourceUnit.id, burnTotal / 3, this.world.simTime + 3);
    }
    if (
      options.ability && sourceEntity?.champion?.id === 'frostquill' &&
      (options.stunDuration ?? 0) === 0 && !result.lethal
    ) applySlow(target.effects, `frostquill:${sourceUnit.id}`, 0.2, this.world.simTime + 1.5);
    if ((options.slowPercent ?? 0) > 0 && !result.lethal) {
      applySlow(target.effects, `ability:${sourceUnit.id}`, options.slowPercent!, this.world.simTime + (options.slowDuration ?? 0));
    }
    if ((options.pullDuration ?? 0) > 0 && !result.lethal) {
      applyPull(
        target.effects,
        `ability:${sourceUnit.id}`,
        sourceUnit.pos,
        600,
        this.world.simTime + options.pullDuration!,
      );
    }
    const sourceBuffs = sourceEntity ? this.buffsFor(sourceEntity) : undefined;
    if (
      !options.ability && sourceBuffs?.buffs.some((buff) => buff.kind === 'red') && !result.lethal
    ) applySlow(target.effects, `red-buff:${sourceUnit.id}`, 0.2, this.world.simTime + 2);

    const targetItems = target === this.player ? this.ownedItems : target.bot?.ownedItems ?? [];
    const hpPctAfter = target.unit.maxHp > 0 ? target.unit.hp / target.unit.maxHp : 0;
    const aegisKey = `aegis:${target.unit.id}`;
    if (
      targetItems.includes('aegisColossus') && hpPctBefore > 0.3 && hpPctAfter <= 0.3 &&
      (this.internalCooldowns.get(aegisKey) ?? 0) <= this.world.simTime && !result.lethal
    ) {
      applyShield(target.effects, 'aegisColossus', 200, this.world.simTime + 4);
      this.internalCooldowns.set(aegisKey, this.world.simTime + 45);
    }
    const ironholdKey = `ironhold-passive:${target.unit.id}`;
    if (
      target.champion?.id === 'ironhold' && hpPctBefore > 0.35 && hpPctAfter <= 0.35 &&
      (this.internalCooldowns.get(ironholdKey) ?? 0) <= this.world.simTime && !result.lethal
    ) {
      applyArmor(target.effects, ironholdKey, 25, this.world.simTime + 3);
      this.internalCooldowns.set(ironholdKey, this.world.simTime + 12);
    }
    if (target.champion?.id === 'nightveil' && result.dealt > 0) {
      this.internalCooldowns.set(`nightveil-smoke:${target.unit.id}`, 0);
    }
    if (
      !options.ability && target.champion?.id === 'thornwarden' && sourceEntity &&
      sourceEntity.unit.kind === 'champion' && !sourceEntity.unit.dead
    ) {
      const reflectKey = `thorn-reflect:${target.unit.id}:${sourceUnit.id}`;
      if ((this.internalCooldowns.get(reflectKey) ?? 0) <= this.world.simTime) {
        this.internalCooldowns.set(reflectKey, this.world.simTime + 1);
        this.applyTargetedDamage(target, sourceEntity, 12, 0x59b07e, { ability: true, periodic: true });
      }
    }
    if (target === this.player && result.dealt > 0 && areHostile(sourceUnit.team, target.unit.team)) {
      this.cancelRecall('enemy-damage');
    }
    if (sourceUnit.id === this.player.unit.id) {
      this.stats.damageDealt += result.dealt;
      if (!options.ability && result.dealt > 0) this.recordLearning('basic-attack');
    }
    const sourceItems = sourceEntity === this.player ? this.ownedItems : sourceEntity?.bot?.ownedItems ?? [];
    const neutral = target.unit.team === 'neutral';
    if (!options.ability && !neutral && result.dealt > 0 && sourceEntity) {
      const ratio = sourceItems.includes('bloodreaver')
        ? 0.12
        : sourceItems.includes('vampiricEdge') ? 0.08 : 0;
      if (ratio > 0) applyHeal(sourceEntity.unit, result.dealt * ratio);
    }
    this.registerKill(sourceUnit, target.unit, result.lethal);
    this.onDamage(target, target.unit.pos, result.dealt, color, result.lethal, {
      fromPos: sourceUnit.pos,
      ability: options.ability,
      ult: options.ultimate,
      attacker: sourceUnit,
    });
    if (result.dealt > 0 && (options.stunDuration ?? 0) > 0 && !result.lethal) {
      target.stunned = options.stunDuration!;
      this.stunSpin(target, color);
    }
  }

  private registerKill(source: Unit, target: Unit, lethal: boolean) {
    if (!lethal) return;
    const targetEntity = this.entityForUnit(target);
    const sourceEntity = this.entityForUnit(source);
    const sourceSide = source.team === 'ally' || source.team === 'enemy' ? source.team : null;

    const targetLife = targetEntity ? this.lifeFor(targetEntity) : undefined;
    if (targetEntity && targetLife) {
      const level = targetEntity === this.player
        ? this.progressionFor(targetEntity).level
        : this.progressionFor(targetEntity).level;
      this.world.lives[targetEntity.unit.id] = killChampion(targetLife, this.world.simTime, level, this.mode);
      if (targetEntity.champion?.id === 'duskarrow') {
        this.world.passives = {
          counters: { ...this.world.passives.counters, [passiveKeys.duskarrowDistance(target.id)]: 0 },
          deadlines: { ...this.world.passives.deadlines },
        };
      }
      if (targetEntity === this.player) this.playerDeaths += 1;
      // Payout through the pure step, so the tally and the bounty cannot disagree about whether this kill counted.
      const outcome = resolveKill({ victimKind: 'champion', killerSide: sourceSide });
      this.world.teamFacts[sourceSide ?? 'ally'].championKills += outcome.championKillDelta;
      this.awardBounty(sourceEntity, outcome.bounty);
      if (source.id === 'player') this.stats.championKills += 1;
    } else if (target.kind === 'minion') {
      const type = (targetEntity?.minionType ?? 'melee') as MinionType;
      this.awardBounty(
        sourceEntity,
        resolveKill({ victimKind: 'minion', minionType: type, killerSide: sourceSide }).bounty,
      );
      if (source.id === 'player') this.stats.minionKills += 1;
    } else if (target.kind === 'turret' || target.kind === 'nexus') {
      const node = targetEntity?.node;
      /**
       * Classification and payout come from the SAME place on purpose.
       *
       * `unit.kind` says 'turret' for an inhibitor and only the map node tells them apart, so a classification written
       * separately from the payout is how an inhibitor comes to pay a turret's bounty. The respawn timer is independent of
       * attribution, because it is the inhibitor's own consequence rather than a reward — an inhibitor felled by a minion
       * wave still respawns.
       */
      const outcome = resolveKill({
        victimKind: classifyVictim(target.kind, node?.kind),
        killerSide: sourceSide,
      });
      this.awardBounty(sourceEntity, outcome.bounty);
      if (outcome.startsInhibitorRespawn) this.inhibitorKillTimes[target.id] = this.world.simTime;
      if (source.id === 'player' && node?.kind.endsWith('Turret')) this.recordLearning('destroy-turret');
    } else if (target.kind === 'monster' && targetEntity?.campId) {
      const runtime = this.camps.find((candidate) => candidate.camp.id === targetEntity.campId);
      if (runtime) {
        runtime.members = runtime.members.filter((member) => member !== targetEntity && !member.unit.dead);
        if (runtime.members.length === 0) {
          this.awardBounty(sourceEntity, runtime.camp.bounty);
          runtime.nextSpawnAt = this.world.simTime + runtime.camp.respawnSeconds;
          if (runtime.camp.type === 'blue' || runtime.camp.type === 'red') {
            const buffs = sourceEntity ? this.buffsFor(sourceEntity) : undefined;
            if (buffs) applyBuff(buffs, runtime.camp.type, this.world.simTime);
          }
        }
      }
    } else if (target.kind === 'monster' && targetEntity?.objectiveId && sourceSide) {
      const objectiveId = targetEntity.objectiveId;
      this.awardBounty(sourceEntity, monsterStats(objectiveId).bounty);
      this.world.teamFacts[sourceSide].epicMonstersKilled += 1;
      this.world.teamFacts[sourceSide].objectivePoints += objectiveId === 'dragon' ? 1 : objectiveId === 'herald' ? 2 : 3;
      const runtime = this.objectives.find((objective) => objective.id === objectiveId);
      if (runtime) {
        runtime.entity = null;
        if (objectiveId === 'herald') runtime.permanentlyGone = true;
        else runtime.nextSpawnAt = this.world.simTime + this.rules.objectives.respawnSeconds;
      }
      if (objectiveId === 'dragon') {
        if (sourceSide === 'ally') this.world.dragonStacks.ally += 1;
        else this.world.dragonStacks.enemy += 1;
        this.applyTeamChampionStats(sourceSide);
      } else if (objectiveId === 'baron') {
        if (sourceSide === 'ally') this.world.baron.ally = applyBaronBuff(this.world.simTime);
        else this.world.baron.enemy = applyBaronBuff(this.world.simTime);
        this.applyTeamChampionStats(sourceSide);
      } else {
        const reward = heraldReward();
        this.world.wardenCharges[sourceSide] = {
          acquiredAt: this.world.simTime,
          expiresAt: this.world.simTime + reward.durationSeconds,
        };
      }
    }

    if (sourceEntity === this.player) this.applyChampionStats(this.player, 'ally');
    else if (sourceEntity?.bot) this.applyChampionStats(sourceEntity, sourceEntity.bot.side);
  }

  private awardBounty(entity: Entity | undefined, bounty: { gold: number; xp: number }) {
    if (!entity || entity.unit.kind !== 'champion') return;
    const progress = this.progressionFor(entity);
    // Bounty gold counts as EARNED as well as held, which is why the derived team total agrees with the per-champion one.
    const purse = this.economyFor(entity);
    if (bounty.gold > 0) {
      purse.gold += bounty.gold;
      purse.totalEarned += bounty.gold;
    }
    const xp = addXp(progress, bounty.xp);
    if (xp.leveled) {
      if (entity === this.player) this.recordLearning('level-up');
      this.floatingDamage(entity.unit.pos, xp.newLevel, 0xffd45c, 'LV ');
      this.pulse(entity.container, 0xffd45c);
    }
  }

  private wardenTargets(sourceSide: MapSide): Entity[] {
    // Ranking is authority — two peers that order the same three turrets differently batter different buildings from
    // identical input — so the rule lives in wardenSpend.ts and this method only maps ids back to entities.
    const order = wardenTargetOrder(
      this.structures.map((structure) => ({
        id: structure.unit.id,
        team: structure.unit.team,
        pos: structure.unit.pos,
        dead: structure.unit.dead,
      })),
      sourceSide,
      this.mode,
    );
    const byId = new Map(this.structures.map((structure) => [structure.unit.id, structure]));
    return order.flatMap((id) => {
      const entity = byId.get(id);
      return entity ? [entity] : [];
    });
  }

  private tickHeldWardenPolicy(): void {
    // Expiry through the extracted step, deliberately separate from deciding whether to SPEND a charge: a lapse has to
    // happen on ticks where nothing wants to deploy.
    this.world.wardenCharges = advanceWardenCharges(
      { ally: this.world.wardenCharges.ally, enemy: this.world.wardenCharges.enemy },
      this.world.simTime,
    );
    const charge = this.world.wardenCharges.enemy;
    const targets = this.wardenTargets('enemy');
    const target = targets[0];
    const hasSiegePressure = Boolean(target && [...this.champions, ...this.minions].some(
      (entity) =>
        !entity.unit.dead &&
        entity.unit.team === 'enemy' &&
        distance(entity.unit.pos, target.unit.pos) <= 650,
    ));
    if (shouldDeployHeldWarden({
      now: this.world.simTime,
      charge,
      hasValidTarget: targets.length > 0,
      hasSiegePressure,
    })) this.useWardenCharge('enemy', target);
  }

  private useWardenCharge(sourceSide: MapSide, chosenTarget?: Entity) {
    const targets = this.wardenTargets(sourceSide);
    const plan = planWardenSpend({
      charge: this.world.wardenCharges[sourceSide],
      now: this.world.simTime,
      orderedTargetIds: targets.map((entity) => entity.unit.id),
      preferredTargetId: chosenTarget?.unit.id ?? null,
    });
    // `hold` deliberately leaves the charge standing: only time takes one away, so a warden held while every legal
    // structure is shielded is spent on a later tick instead of being thrown away.
    if (plan.kind === 'hold') return;
    if (plan.kind === 'lapsed') {
      this.world.wardenCharges[sourceSide] = null;
      return;
    }
    const target = targets.find((entity) => entity.unit.id === plan.targetId);
    if (!target) return;
    this.world.wardenCharges[sourceSide] = null;
    const source = sourceSide === 'ally' ? this.player.unit : this.enemy.unit;
    const result = applyDamageWithEffects(target.unit, target.effects, plan.rawDamage, this.world.simTime);
    this.registerKill(source, target.unit, result.lethal);
    this.onDamage(target, target.unit.pos, result.dealt, 0xc18cff, result.lethal, {
      fromPos: source.pos,
      ability: true,
      attacker: source,
    });
  }

  // ---- Targeting -----------------------------------------------------------

  /**
   * Rebuild the per-frame {@link livingSnapshot} (living `Unit[]` + id `Set`)
   * from the current entities. Called once per frame from {@link update} so all
   * targeting in that frame shares one snapshot instead of each caller
   * allocating its own.
   */
  private refreshLivingSnapshot() {
    const units: Unit[] = [];
    const ids = new Set<string>();
    for (const e of this.allEntities) {
      if (!e.unit.dead) {
        units.push(e.unit);
        ids.add(e.unit.id);
      }
    }
    this.livingSnapshot = { units, ids };
  }

  private findTarget(u: Unit, maxRange: number, preferStructures = false): Unit | undefined {
    const living = this.livingSnapshot.ids;
    const candidates = this.livingSnapshot.units.filter((candidate) => {
      if (!areHostile(candidate.team, u.team)) return false;
      const entity = this.entityById.get(candidate.id);
      if (!entity || !this.isEntityDamageable(entity)) return false;
      if (candidate.kind === 'turret' || candidate.kind === 'nexus') {
        return isStructureTargetable(candidate.id, living, this.mode);
      }
      return true;
    });
    const currentId = this.world.targets[u.id] ?? null;
    const persistent = persistentEnemy(u, candidates, currentId, maxRange);
    if (currentId && persistent?.id === currentId) return persistent;

    const acquired = nearestTargetableEnemy(
      u,
      candidates,
      this.structureLines,
      living,
      maxRange,
      preferStructures,
    );
    if (acquired) this.world.targets[u.id] = acquired.id;
    else delete this.world.targets[u.id];
    return acquired;
  }

  // ---- Visuals -------------------------------------------------------------

  private canAllocateTransient(damageText = false): boolean {
    if (this.transientVfx.size >= MAX_TRANSIENT_VFX) return false;
    if (damageText) return this.damageTexts.size < MAX_DAMAGE_TEXTS;
    return this.transientVfx.size < MAX_TRANSIENT_VFX - RESERVED_DAMAGE_TEXT_SLOTS;
  }

  private registerTransient<T extends Phaser.GameObjects.GameObject>(
    object: T,
    damageText = false,
  ): T | null {
    if (!this.canAllocateTransient(damageText)) {
      object.destroy();
      return null;
    }
    this.transientVfx.add(object);
    if (damageText && object instanceof Phaser.GameObjects.Text) {
      this.damageTexts.add(object);
    }
    return object;
  }

  private destroyTransient(object: Phaser.GameObjects.GameObject): void {
    this.transientVfx.delete(object);
    if (object instanceof Phaser.GameObjects.Text) this.damageTexts.delete(object);
    this.tweens.killTweensOf(object);
    if (object.active) object.destroy();
  }

  private clearTransientVfx(): void {
    for (const object of [...this.transientVfx]) this.destroyTransient(object);
    this.transientVfx.clear();
    this.damageTexts.clear();
  }

  private syncVisuals() {
    // Frame-rate-independent easing weight for this frame. Derived from the real
    // frame delta so the smoothing constant means the same thing at 30, 55 or
    // 144fps. See RENDER_SMOOTH_TAU_MS for why the drawn position is eased.
    const deltaMs = Phaser.Math.Clamp(this.game.loop.delta, 1, 100);
    const ease = 1 - Math.exp(-deltaMs / RENDER_SMOOTH_TAU_MS);
    for (const e of this.allEntities) {
      // Project the entity's flat ground pixel to its on-screen dimetric point.
      const ground = project(e.unit.pos);
      // Billboard is lifted up by its height so it reads as standing.
      const targetX = ground.x;
      const targetY = ground.y - e.heightPx;
      // Ease toward the simulated point; snap on a teleport-sized jump (and on
      // the first placement, where the container still sits at the origin).
      const dx = targetX - e.container.x;
      const dy = targetY - e.container.y;
      if (Math.abs(dx) + Math.abs(dy) > RENDER_SNAP_DISTANCE_PX) {
        e.container.setPosition(targetX, targetY);
      } else {
        e.container.setPosition(e.container.x + dx * ease, e.container.y + dy * ease);
      }
      // Ground shadow follows the DRAWN position, not the simulated one, so the
      // shadow never detaches from the eased billboard above it.
      if (e.shadow) {
        e.shadow.setPosition(e.container.x, e.container.y + e.heightPx);
        e.shadow.setDepth(depthForPixel(e.unit.pos) + DEPTH_SHADOW_BIAS);
        e.shadow.setVisible(e.container.visible);
      }
      // Depth still sorts by the SIMULATED point: easing the sort key too would
      // let two units flicker past each other around a crossing.
      e.container.setDepth(depthForPixel(e.unit.pos, e.heightPx));
      // Drive the two-frame walk cycle. `setChampionPose` only fires when the
      // pose CHANGES, so without this a walking champion would hold a single
      // RUN frame; re-deriving the frame every render is what animates it.
      if (e.champion && e.championPose === 'move' && e.body.active) {
        e.body.setFrame(frameForPose('move', this.world.simTime));
      }
      if (e.hpBar) {
        const full = e.hpBar.getData('width') as number;
        const pct = Phaser.Math.Clamp(e.unit.hp / e.unit.maxHp, 0, 1);
        e.hpBar.width = full * pct;
        e.hpBar.x = -(full * (1 - pct)) / 2;
        e.hpBar.fillColor = pct > 0.5 ? 0x3ad16a : pct > 0.25 ? 0xf0c000 : 0xd13a3a;
      }
      if (
        e.unit.dead &&
        (e.unit.kind === 'minion' || e.unit.kind === 'monster') &&
        e.container.active
      ) {
        e.shadow?.destroy();
        e.container.destroy();
        this.entityById.delete(e.unit.id);
        delete this.world.targets[e.unit.id];
      }
      if (e.unit.dead && (e.unit.kind === 'turret' || e.unit.kind === 'nexus') && e.container.visible) {
        e.container.setAlpha(0.25);
        e.shadow?.setAlpha(0.12);
      }
    }
    this.minions = this.minions.filter((minion) => minion.container.active);
    this.allEntities = this.allEntities.filter(
      (entity) => entity.container.active || !['minion', 'monster'].includes(entity.unit.kind),
    );
  }

  private floatingDamage(
    rawPos: Vec2,
    amount: number,
    color: number,
    prefix = '',
    importance: HitImportance = 'normal',
  ) {
    if (amount <= 0 || !this.canAllocateTransient(true)) return;
    const pos = project(rawPos);
    const style = popupStyleForHit(importance);
    // Heavy hits get a hot near-white core so they punch through the accent
    // color and read as clearly bigger than chip damage.
    const shown = style.heavy ? 0xfff3c0 : color;
    const jitter = this.reducedMotion ? 0 : (Math.random() * 2 - 1) * style.jitter;
    const text = this.registerTransient(this.add.text(pos.x + jitter, pos.y - 18, `${prefix}${amount}`, {
      fontFamily: 'Noto Sans KR, sans-serif',
      fontSize: `${style.fontSize}px`,
      color: `#${shown.toString(16).padStart(6, '0')}`,
      fontStyle: 'bold',
      stroke: '#101018',
      strokeThickness: style.heavy ? 3 : 2,
      resolution: 2,
    }), true);
    if (!text) return;
    text.setOrigin(0.5);
    text.setDepth(VFX_DEPTH);
    if (this.reducedMotion) {
      text.setScale(1);
      this.time.delayedCall(450, () => this.destroyTransient(text));
      return;
    }
    text.setScale(0.4);
    // Punchy Back.easeOut pop up to the importance-scaled peak, then settle.
    this.tweens.add({
      targets: text,
      scale: style.pop,
      duration: 130,
      ease: 'Back.easeOut',
      yoyo: false,
    });
    this.tweens.add({
      targets: text,
      y: pos.y - (style.heavy ? 56 : 44),
      alpha: 0,
      duration: style.heavy ? 720 : 620,
      delay: 90,
      ease: 'Cubic.easeOut',
      onComplete: () => this.destroyTransient(text),
    });
  }

  private hitFlash(entity: Entity, importance: HitImportance = 'normal') {
    if (this.reducedMotion || !entity.container.active) return;
    const img = entity.body;
    img.setTintFill(0xffffff);
    // Bigger hits flash a touch longer so the impact reads as heavier.
    const dur = importance === 'big' ? 110 : importance === 'chip' ? 55 : 80;
    this.time.delayedCall(dur, () => {
      if (img.active) img.clearTint();
    });
  }

  /**
   * CAMERA SHAKE IS DISABLED, DELIBERATELY.
   *
   * Every shake path used to funnel through here: ability hits above the chip
   * band, structure destruction, and the ultimate-cast bump. It was throttled
   * (SHAKE_MIN_INTERVAL_MS), magnitude-capped (MAX_SHAKE_INTENSITY) and gated on
   * being on-screen, and on that basis it was wrongly ruled out as the cause of
   * the "shaking" reported in play. It was not: in a 5v5 with turrets trading
   * constantly, a gentle-but-frequent bump reads exactly like an unstable
   * camera, and the player asked for it gone outright rather than tuned down.
   *
   * The call sites are kept (they still classify hits for flashes, sparks,
   * knockback and popups) so removing them is a one-line change if a future
   * pass wants an opt-in screenshake setting instead. The pure policy helpers in
   * `juice.ts` (`shakeForHit`, `shouldShake`, `structureDestructionShake`) are
   * likewise left intact and unit-tested; nothing calls them into the camera.
   */
  private tryShake(_spec: ShakeSpec, _worldPos: Vec2, _involvesPlayer: boolean) {
    // Intentionally empty - see the note above. Hit FLASH, spark, knockback and
    // damage popups all still fire; only the camera is left still.
  }

  /**
   * Central hit hook: fires ALL combat juice for one damaging blow. Everything
   * here is cosmetic (tweens / camera / timers / transient VFX) and NEVER writes
   * `unit.pos` or any simulation timer, so it cannot perturb the deterministic
   * `update()` step. `fromPos` (the attacker's flat position) is used only to
   * pick a visual knockback DIRECTION.
   */
  private onDamage(
    target: Entity | undefined,
    pos: Vec2,
    amount: number,
    color: number,
    lethal: boolean,
    opts: { fromPos?: Vec2; ability?: boolean; ult?: boolean; attacker?: Unit } = {},
  ) {
    const fraction = target ? amount / target.unit.maxHp : 0;
    const importance = classifyHit({ fraction, ability: opts.ability, ult: opts.ult, lethal });
    // Does the player's champion feel this hit (as attacker or victim)? Used to
    // decide whether camera shake / kill slow-mo may fire even when off-screen.
    const playerUnit = this.player?.unit;
    const involvesPlayer =
      !!playerUnit &&
      ((target?.unit === playerUnit) || (opts.attacker !== undefined && opts.attacker === playerUnit));

    this.floatingDamage(pos, amount, color, '', importance);
    if (target) {
      if (target.champion) {
        if (lethal) target.deathVisibleUntil = this.world.simTime + CHAMPION_DEATH_POSE_MS / 1000;
        this.setChampionPose(
          target,
          lethal ? 'death' : 'hit',
          lethal ? Number.POSITIVE_INFINITY : CHAMPION_POSE_HOLD_MS.hit,
          lethal ? 4 : 3,
        );
      }
      this.hitFlash(target, importance);
      this.squashStretch(target, importance);
      this.knockback(target, opts.fromPos ?? pos, importance);
    }
    this.impactSparks(pos, color, importance);
    audio.play('hit', this.audioOptionsFor(pos));

    if (lethal) {
      audio.play('death', this.audioOptionsFor(pos));
      if (target) this.deathBurst(target, color);
      // Kill slow-mo is a rare, dramatic beat: only the player's own takedowns
      // or the player's death earn it, never the many bot-vs-bot deaths that
      // happen constantly across a 5v5 map.
      if (target && target.unit.kind === 'champion' && involvesPlayer) this.killSlowMo();
    }

    // Camera shake only for combat the player can perceive, throttled and
    // magnitude-capped via tryShake so constant/off-screen fighting can never
    // turn the camera into a permanent tremor. Chip and normal (autoattack)
    // hits produce a zero-intensity spec and are dropped inside tryShake.
    if (target && (target.unit.kind === 'champion' || lethal)) {
      this.tryShake(shakeForHit(importance, fraction), pos, involvesPlayer);
    }
    if (lethal && target && (target.unit.kind === 'turret' || target.unit.kind === 'nexus')) {
      this.tryShake(structureDestructionShake(), pos, involvesPlayer);
    }
  }

  /**
   * Short-lived burst of small pixel-block sparks at the projected hit point,
   * tinted by the attack color. Bigger/lethal hits throw more sparks. Pinned to
   * {@link VFX_DEPTH}; each spark tweens out then destroys itself.
   */
  private impactSparks(rawPos: Vec2, color: number, importance: HitImportance) {
    const p = project(rawPos);
    if (this.reducedMotion) {
      const feedback = this.vfxImage('impact', color, p.x, p.y - 6, 11);
      if (feedback) this.time.delayedCall(160, () => this.destroyTransient(feedback));
      return;
    }
    // COUNT stays driven by the pure juice math, but available budget can
    // gracefully trim cosmetic shards without touching the damaging impact.
    const desired = sparkCountForHit(importance);
    const available = Math.max(
      0,
      MAX_TRANSIENT_VFX - RESERVED_DAMAGE_TEXT_SLOTS - this.transientVfx.size,
    );
    const count = Math.min(desired, available);
    if (count <= 0) return;
    const spread = importance === 'big' ? 26 : importance === 'ult' ? 22 : 16;
    const size = importance === 'big' ? 12 : importance === 'chip' ? 6 : 9;
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
      const dist = spread * (0.5 + Math.random() * 0.6);
      const spark = this.vfxImage('impact', i % 3 === 0 ? 0xffffff : color, p.x, p.y - 6, size);
      if (!spark) break;
      this.tweens.add({
        targets: spark,
        x: p.x + Math.cos(angle) * dist,
        y: p.y - 6 + Math.sin(angle) * dist * 0.6,
        alpha: 0,
        scaleX: spark.scaleX * 0.2,
        scaleY: spark.scaleY * 0.2,
        duration: 220 + Math.random() * 160,
        ease: 'Cubic.easeOut',
        onComplete: () => this.destroyTransient(spark),
      });
    }
  }

  /**
   * VISUAL-ONLY recoil: nudge the struck billboard's rendered body a few px away
   * from its attacker, then tween it back. Applied to the sprite image's local
   * offset INSIDE the container, so the container position (driven every frame
   * from `unit.pos` in {@link syncVisuals}) is never fought over and the
   * simulation's `unit.pos` is untouched.
   */
  private knockback(target: Entity, rawFrom: Vec2, importance: HitImportance) {
    if (this.reducedMotion || !target.container.active) return;
    const img = target.body;
    const dir = knockbackDir(project(rawFrom), project(target.unit.pos));
    const dist = knockbackForHit(importance);
    // Kill any in-flight recoil so rapid hits do not compound the offset.
    this.tweens.killTweensOf(img);
    const baseX = 0;
    const baseY = 0;
    img.x = baseX + dir.x * dist;
    img.y = baseY + dir.y * dist;
    this.tweens.add({
      targets: img,
      x: baseX,
      y: baseY,
      duration: 220,
      ease: 'Back.easeOut',
    });
  }

  /**
   * Quick squash-and-stretch on the struck sprite: a brief vertical squash that
   * springs back to scale 1. Purely a scale tween on the body image; auto-
   * returns so it can never leave the sprite deformed.
   */
  private squashStretch(target: Entity, importance: HitImportance) {
    if (this.reducedMotion || !target.container.active) return;
    // Applied to the CONTAINER scale (not the body image) so it never collides
    // with the body-image knockback tween; syncVisuals only sets container
    // position/depth, never scale, so this is safe to own here.
    const c = target.container;
    const amt = importance === 'big' ? 0.28 : importance === 'chip' ? 0.1 : 0.18;
    this.tweens.killTweensOf(c);
    this.tweens.add({
      targets: c,
      scaleX: 1 + amt,
      scaleY: 1 - amt,
      duration: 70,
      ease: 'Quad.easeOut',
      yoyo: true,
      onComplete: () => {
        if (c.active) c.setScale(1);
      },
    });
  }

  /**
   * Brief, DETERMINISM-SAFE slow-mo on a champion kill. We slow ONLY the tween
   * and animation timeScales (cosmetic layers) and add a short camera flash;
   * the simulation keeps stepping on the real `deltaMs` in {@link update}, so
   * cooldowns, waves, objectives, economy and win/lose are untouched. A one-shot
   * real-time timer restores the tween timeScale, and re-entrancy is guarded so
   * multiple kills in a row cannot stack or strand the scene slowed.
   */
  private killSlowMo() {
    if (this.reducedMotion || this.slowMoActive) return;
    this.slowMoActive = true;
    this.tweens.timeScale = 0.35;
    this.cameras.main.flash(120, 255, 255, 255, false);
    // Real-time timer: NOT affected by tweens.timeScale, so it always restores.
    this.time.delayedCall(160, () => {
      this.tweens.timeScale = 1;
      this.slowMoActive = false;
    });
  }

  /**
   * Create a transient VFX billboard from a baked SVG texture (rasterized once
   * and cached by kind+color via {@link SpriteFactory.ensureVfx}). Returns the
   * Image already placed at (x, y), centered, pinned to {@link VFX_DEPTH} and
   * scaled to `displayW` on-screen pixels (height follows the texture aspect,
   * or is overridden by `displayH`). Callers tween it and destroy it, exactly
   * as with the old primitive VFX. Kept COSMETIC-ONLY.
   */
  private vfxImage(
    kind: VfxKind,
    color: number,
    x: number,
    y: number,
    displayW: number,
    displayH?: number,
  ): Phaser.GameObjects.Image | null {
    if (!this.canAllocateTransient()) return null;
    // VFX come from a WHITE pixel sheet and are TINTED with the ability colour,
    // so one sheet per kind covers every colour instead of baking a texture per
    // (kind x colour) pair the way the old SVG rasterizer had to.
    const key = vfxSheetKey(kind);
    const size = VFX_FRAME;
    const img = this.registerTransient(this.add.image(x, y, key));
    if (!img) return null;
    img.setTint(color);
    img.setOrigin(0.5, 0.5);
    img.setDisplaySize(displayW, displayH ?? displayW * (size.height / size.width));
    img.setDepth(VFX_DEPTH);
    return img;
  }

  private deathBurst(entity: Entity, color: number) {
    const p = project(entity.unit.pos);
    const burst = this.vfxImage('death', color, p.x, p.y, 26);
    if (!burst) return;
    if (this.reducedMotion) {
      this.time.delayedCall(260, () => this.destroyTransient(burst));
      return;
    }
    this.tweens.add({
      targets: burst,
      scale: burst.scale * 2.2,
      alpha: 0,
      duration: 400,
      ease: 'Cubic.easeOut',
      onComplete: () => this.destroyTransient(burst),
    });
  }

  private entityForUnit(unit: Unit): Entity | undefined {
    return this.entityById.get(unit.id);
  }

  private drawProjectile(rawFrom: Vec2, rawTo: Vec2, color: number, durationMs = 180) {
    const from = project(rawFrom);
    const to = project(rawTo);
    const fy = from.y - CHAMPION_HEIGHT_PX * 0.5;
    const ty = to.y - CHAMPION_HEIGHT_PX * 0.5;
    // A glowing SVG orb-with-trail Image, rotated to face its travel direction
    // (the art points +x), tweened from->to over the same 180ms.
    const bolt = this.vfxImage('projectile', color, this.reducedMotion ? to.x : from.x, this.reducedMotion ? ty : fy, 22);
    if (!bolt) return;
    bolt.setRotation(Math.atan2(ty - fy, to.x - from.x));
    if (this.reducedMotion) {
      this.time.delayedCall(140, () => this.destroyTransient(bolt));
      return;
    }
    this.tweens.add({
      targets: bolt,
      x: to.x,
      y: ty,
      duration: durationMs,
      onComplete: () => this.destroyTransient(bolt),
    });
  }

  private drawBeam(rawFrom: Vec2, rawTo: Vec2, color: number, durationMs = 200) {
    const from = project(rawFrom);
    const to = project(rawTo);
    const fx = from.x;
    const fy = from.y - TURRET_HEIGHT_PX * 0.5;
    const tx = to.x;
    const ty = to.y - CHAMPION_HEIGHT_PX * 0.5;
    // A tapered SVG streak stretched to span from->to, anchored at the source
    // and rotated toward the target, fading over the same ~200ms.
    const len = Math.max(6, Math.hypot(tx - fx, ty - fy));
    const beam = this.vfxImage('beam', color, fx, fy, len, 8);
    if (!beam) return;
    beam.setOrigin(0, 0.5);
    beam.setRotation(Math.atan2(ty - fy, tx - fx));
    if (this.reducedMotion) {
      this.time.delayedCall(Math.min(180, durationMs), () => this.destroyTransient(beam));
      return;
    }
    this.tweens.add({
      targets: beam,
      alpha: 0,
      duration: durationMs,
      onComplete: () => this.destroyTransient(beam),
    });
  }

  /**
   * Draw an ability AoE as a PROJECTED ground ellipse (a dimetric "circle" on
   * the floor plane) so the ability's reach reads correctly in the 2.5D view.
   * `radius` is in flat gameplay pixels; we sample the projected extents to get
   * the on-screen ellipse width/height.
   */
  private drawAoe(rawCenter: Vec2, radius: number, color: number) {
    const center = project(rawCenter);
    // Project the flat-space radius onto screen axes: the dimetric transform
    // squashes Y to ~half, so sample right/down offsets to size the ellipse.
    const right = project({ x: rawCenter.x + radius, y: rawCenter.y });
    const down = project({ x: rawCenter.x, y: rawCenter.y + radius });
    const rx = Math.hypot(right.x - center.x, right.y - center.y);
    const ry = Math.hypot(down.x - center.x, down.y - center.y);
    // Overlay a baked SVG telegraph-ring texture squashed to the SAME rx/ry so
    // the ability reach still reads correctly in the dimetric view. The ring
    // texture is a square viewBox, so display width = 2*rx, height = 2*ry.
    const ring = this.vfxImage(
      'aoeRing',
      color,
      center.x,
      center.y,
      Math.max(6, rx * 2),
      Math.max(4, ry * 2),
    );
    if (!ring) return;
    if (this.reducedMotion) {
      this.time.delayedCall(300, () => this.destroyTransient(ring));
      return;
    }
    this.tweens.add({
      targets: ring,
      alpha: 0,
      scaleX: ring.scaleX * 1.12,
      scaleY: ring.scaleY * 1.12,
      duration: 400,
      onComplete: () => this.destroyTransient(ring),
    });
  }

  private drawDashTrail(rawFrom: Vec2, rawTo: Vec2, color: number) {
    const from = project(rawFrom);
    const to = project(rawTo);
    const fx = from.x;
    const fy = from.y - CHAMPION_HEIGHT_PX * 0.5;
    const tx = to.x;
    const ty = to.y - CHAMPION_HEIGHT_PX * 0.5;
    // A thick SVG streak spanning the dash path, fading over the same ~280ms.
    const len = Math.max(6, Math.hypot(tx - fx, ty - fy));
    const streak = this.vfxImage('beam', color, fx, fy, len, 14);
    if (!streak) return;
    streak.setOrigin(0, 0.5);
    streak.setRotation(Math.atan2(ty - fy, tx - fx));
    streak.setAlpha(0.8);
    if (this.reducedMotion) {
      this.time.delayedCall(180, () => this.destroyTransient(streak));
      return;
    }
    this.tweens.add({
      targets: streak,
      alpha: 0,
      duration: 280,
      onComplete: () => this.destroyTransient(streak),
    });
  }

  private pulse(container: Phaser.GameObjects.Container, color: number) {
    // A soft SVG heal sparkle expanding and fading over the same ~380ms.
    const ring = this.vfxImage('heal', color, container.x, container.y, 36);
    if (!ring) return;
    ring.setAlpha(0.9);
    if (this.reducedMotion) {
      this.time.delayedCall(220, () => this.destroyTransient(ring));
      return;
    }
    this.tweens.add({
      targets: ring,
      scaleX: ring.scaleX * 1.6,
      scaleY: ring.scaleY * 1.6,
      alpha: 0,
      duration: 380,
      onComplete: () => this.destroyTransient(ring),
    });
  }

  private castFlare(caster: Entity, color: number, ultimate: boolean) {
    const p = project(caster.unit.pos);
    const y = p.y - caster.heightPx * 0.5;
    // A radiant SVG burst; ultimates flare larger and add the camera shake.
    const flare = this.vfxImage('castFlare', color, p.x, y, ultimate ? 30 : 22);
    if (!flare) return;
    flare.setAlpha(0.95);
    if (this.reducedMotion) {
      this.time.delayedCall(ultimate ? 280 : 180, () => this.destroyTransient(flare));
      return;
    }
    this.tweens.add({
      targets: flare,
      scaleX: flare.scaleX * (ultimate ? 2.6 : 1.8),
      scaleY: flare.scaleY * (ultimate ? 2.6 : 1.8),
      alpha: 0,
      duration: ultimate ? 500 : 300,
      ease: 'Cubic.easeOut',
      onComplete: () => this.destroyTransient(flare),
    });
    // Ult cast bump: gated/throttled like every other shake so the ten bots
    // ulting around the map cannot rattle the player's camera. Only the
    // player's own ult, or one cast on-screen, gives a subtle bump.
    if (ultimate) {
      this.tryShake(
        { intensity: 0.006, duration: 150 },
        caster.unit.pos,
        caster.unit === this.player?.unit,
      );
    }
  }

  private stunSpin(entity: Entity, color: number) {
    const p = project(entity.unit.pos);
    // SVG orbiting-stars sprite spinning above the entity over the same ~600ms.
    const stars = this.vfxImage('stun', color, p.x, p.y - entity.heightPx - 8, 24);
    if (!stars) return;
    if (this.reducedMotion) {
      this.time.delayedCall(360, () => this.destroyTransient(stars));
      return;
    }
    this.tweens.add({
      targets: stars,
      angle: 360,
      alpha: 0,
      duration: 600,
      onComplete: () => this.destroyTransient(stars),
    });
  }

  // ---- HUD + win/lose ------------------------------------------------------

  private structureStatus(side: MapSide) {
    let turrets = 0;
    let turretsMax = 0;
    let inhibitors = 0;
    let inhibitorsMax = 0;
    for (const s of this.structures) {
      if (s.unit.team !== side || !s.node) continue;
      const kind = s.node.kind;
      if (kind.endsWith('Turret')) {
        turretsMax += 1;
        if (!s.unit.dead) turrets += 1;
      } else if (kind === 'inhibitor') {
        inhibitorsMax += 1;
        // Inhibitors "respawn" per the pure rule; treat as alive if respawned.
        const killedAt = this.inhibitorKillTimes[s.node.id] ?? null;
        if (isInhibitorAlive(this.world.simTime, killedAt) && !s.unit.dead) inhibitors += 1;
      }
    }
    const nexus = side === 'ally' ? this.allyNexus : this.enemyNexus;
    return {
      turrets,
      turretsMax,
      inhibitors,
      inhibitorsMax,
      nexusPct: nexus ? nexus.unit.hp / nexus.unit.maxHp : 1,
    };
  }

  private buildMinimap() {
    const blips = this.allEntities
      .filter((e) => !e.unit.dead && e.container.visible)
      .map((e) => ({
        id: e.unit.id,
        x: Phaser.Math.Clamp(e.unit.pos.x / WORLD_SIZE, 0, 1),
        y: Phaser.Math.Clamp(e.unit.pos.y / WORLD_SIZE, 0, 1),
        kind: e.unit.kind,
        team: e.unit.team as 'ally' | 'enemy',
      }));
    return blips;
  }

  private pushHud() {
    const slots: CooldownKey[] = ['Q', 'W', 'E', 'R'];
    const xpPct = this.xpProgressPct();
    battleStore.set({
      mode: this.mode,
      matchKind: this.matchKind,
      difficulty: this.difficulty,
      lifecycle: this.matchEnded ? 'ended' : this.pauseReasons.size > 0 ? 'paused' : 'running',
      pauseReasons: [...this.pauseReasons],
      playerChampionId: this.playerChampion.id,
      enemyChampionId: this.enemyChampion.id,
      playerHp: Math.round(this.player.unit.hp),
      playerMaxHp: Math.round(this.player.unit.maxHp),
      playerResource: Math.round(this.resourceFor(this.player).current),
      playerMaxResource: Math.round(this.resourceFor(this.player).max),
      enemyHp: Math.round(this.enemy.unit.hp),
      enemyMaxHp: Math.round(this.enemy.unit.maxHp),
      allyNexusPct: this.allyNexus ? this.allyNexus.unit.hp / this.allyNexus.unit.maxHp : 1,
      enemyNexusPct: this.enemyNexus ? this.enemyNexus.unit.hp / this.enemyNexus.unit.maxHp : 1,
      elapsed: this.world.simTime,
      gold: Math.floor(this.economyFor(this.player).gold),
      level: this.progressionFor(this.player).level,
      xpPct,
      xpCapped: this.progressionFor(this.player).level >= 18,
      shopAvailable: this.inBase(this.player.unit, 'ally') && this.pauseReasons.size === 0,
      ownedItems: [...this.ownedItems],
      buffs: [
        ...this.buffsFor(this.player).buffs.map((b) => ({
          kind: b.kind as string,
          remaining: Math.ceil(b.expiresAt - this.world.simTime),
        })),
        ...(this.world.baron.ally.active
          ? [{ kind: 'baron', remaining: Math.ceil(this.world.baron.ally.expiresAt - this.world.simTime) }]
          : []),
      ],
      camps: this.camps.map((runtime) => ({
        id: runtime.camp.id,
        type: runtime.camp.type,
        side: runtime.camp.side,
        alive: runtime.members.length > 0,
        membersAlive: runtime.members.filter((member) => !member.unit.dead).length,
        membersTotal: runtime.camp.members.length,
        respawnsIn: runtime.members.length > 0 ? 0 : Math.max(0, Math.ceil(runtime.nextSpawnAt - this.world.simTime)),
      })),
      objectives: this.buildObjectives(),
      ...(this.armedAbility ? { aimingSlot: this.armedAbility } : {}),
      dragonStacks: this.world.dragonStacks.ally,
      objectivePoints: this.world.teamFacts.ally.objectivePoints,
      wardenChargeSeconds: Math.max(
        0,
        Math.ceil((this.world.wardenCharges.ally?.expiresAt ?? this.world.simTime) - this.world.simTime),
      ),
      playerLife: {
        phase: this.lifeFor(this.player)!.phase,
        deaths: this.playerDeaths,
        respawnSeconds:
          this.lifeFor(this.player)!.phase === 'dead' || this.lifeFor(this.player)!.phase === 'respawning'
            ? Math.round(championLifeTimerRemaining(this.lifeFor(this.player)!, this.world.simTime) * 10) / 10
            : 0,
        invulnerableSeconds:
          this.lifeFor(this.player)!.phase === 'invulnerable'
            ? Math.round(championLifeTimerRemaining(this.lifeFor(this.player)!, this.world.simTime) * 10) / 10
            : 0,
      },
      matchStatus: {
        phase: matchPhaseAt(this.world.simTime, this.mode),
        suddenDeath: matchPhaseAt(this.world.simTime, this.mode) === 'sudden-death',
        hardCapSecondsRemaining: Math.max(0, Math.ceil(this.rules.hardCapSeconds - this.world.simTime)),
      },
      recall: {
        channeling: this.playerRecallStartedAt !== null,
        remaining:
          this.playerRecallStartedAt === null
            ? 0
            : Math.max(
                0,
                Math.round((RECALL_SECONDS - (this.world.simTime - this.playerRecallStartedAt)) * 10) / 10,
              ),
        ...(this.recallCancellation ? { cancellation: this.recallCancellation } : {}),
      },
      ...(this.matchKind === 'tutorial' ? {
        learning: {
          current: currentLearningStep(this.learning)?.id,
          completed: this.learning.completed.length,
          total: LEARNING_STEPS.length,
        },
      } : {}),
      currentTargetId: this.world.targets[this.player.unit.id] ?? undefined,
      ...(this.lastPurchaseFeedback ? { purchaseFeedback: this.lastPurchaseFeedback } : {}),
      allyStructures: this.structureStatus('ally'),
      enemyStructures: this.structureStatus('enemy'),
      minimap: this.buildMinimap(),
      abilities: slots.map((slot) => {
        const total = this.cooldownFor(this.player, this.playerChampion, slot);
        const remaining = this.cooldownsFor(this.player)[slot];
        return {
          slot,
          progress: total <= 0 ? 1 : Math.min(1, Math.max(0, 1 - remaining / total)),
          remaining: Math.ceil(remaining),
          cooldown: total,
          ready: remaining <= 0,
          cost: this.abilityBySlot(this.playerChampion, slot).cost,
        };
      }),
    });
  }

  private buildObjectives() {
    if (!this.rules.objectives.enabled) return [];
    return this.objectives.map((runtime) => ({
      id: runtime.id,
      alive: runtime.entity != null && !runtime.entity.unit.dead,
      spawnsIn:
        runtime.entity != null || runtime.permanentlyGone
          ? 0
          : Math.max(0, Math.ceil(runtime.nextSpawnAt - this.world.simTime)),
    }));
  }

  private xpProgressPct(): number {
    // Approximate progress toward the next level from banked xp.
    const p = this.progressionFor(this.player);
    if (p.level >= 18) return 1;
    // economy.addXp already consumed thresholds; xp holds remainder toward next.
    const need = 280 + (p.level - 1) * 100;
    return Math.min(1, Math.max(0, p.xp / need));
  }

  private checkWinLose() {
    if (this.matchEnded) return;
    const resolution = resolveMatch(
      {
        elapsedSeconds: this.world.simTime,
        ally: this.matchTeamSnapshot('ally'),
        enemy: this.matchTeamSnapshot('enemy'),
      },
      this.mode,
    );
    if (resolution.reason) this.endGame(resolution);
  }

  private matchTeamSnapshot(side: MapSide) {
    const countedKinds = new Set(['outerTurret', 'innerTurret', 'inhibitor']);
    const structures = this.structures.filter(
      (structure) => structure.unit.team === side && structure.node && countedKinds.has(structure.node.kind),
    );
    const nexus = side === 'ally' ? this.allyNexus : this.enemyNexus;
    const facts = this.world.teamFacts[side];
    return {
      nexusHp: nexus?.unit.hp ?? 0,
      nexusMaxHp: nexus?.unit.maxHp ?? NEXUS_HP,
      structuresStanding: structures.filter((structure) => !structure.unit.dead).length,
      structuresTotal: this.mode === 'conquest' ? 9 : 3,
      championKills: facts.championKills,
      objectivePoints: facts.objectivePoints,
      gold: this.goldEarnedBy(side),
    };
  }

  /**
   * Translate one of the scene's own orders into the neutral action shape and record
   * what it expresses, when it expresses anything.
   *
   * Most orders record nothing, which is the design: a ghost learns from choices that
   * reveal a preference, so arming attack-move or cancelling an aim must not count.
   * See ghostRecorder for why a lateral move is also silent.
   */
  private recordGhostObservation(command: BattleCommand): void {
    if (this.matchEnded || !this.player) return;

    let action: PlayerAction;
    if (command.type === 'move-to' || command.type === 'attack-move-to' || command.type === 'target-at') {
      if (!command.point) return;
      action = { kind: 'move', destination: { x: command.point.x, y: command.point.y } };
    } else if (command.type === 'cast' && command.slot) {
      action = { kind: 'cast', abilityId: `${this.playerChampion.id}.${command.slot}` };
    } else {
      return;
    }

    const self = this.player.unit;
    const enemy = this.nearestHostileChampion(self);
    const intent = intentForAction(action, {
      self: { x: self.pos.x, y: self.pos.y },
      nearestEnemy: enemy ? { x: enemy.pos.x, y: enemy.pos.y } : null,
      attackRange: self.attackRange,
    });
    if (!intent) return;

    this.ghostRecorder.record({
      snapshot: this.buildAiSnapshot(this.player, enemy ?? undefined),
      chosen: intent,
    });
  }

  /**
   * Learn from the match just played and store the result.
   *
   * Wrapped because this must never break a finished match: storage can be full or
   * blocked, and a player who has just won should see their result, not an exception
   * from a side feature.
   */
  private persistLearnedGhost(): void {
    try {
      const observations = this.ghostRecorder.observations();
      const outcome = saveLearnedGhost(loadProfile(), observations);
      if (outcome.outcome === 'saved') saveProfile(outcome.profile);
    } catch (err) {
      console.warn('[ghost] could not store the learned ghost', err);
    }
  }

  /** Nearest living hostile champion to a unit, or undefined. */
  private nearestHostileChampion(self: Unit): Unit | undefined {
    let best: Unit | undefined;
    let bestDist = Infinity;
    for (const entity of this.champions) {
      const other = entity.unit;
      if (other === self || other.dead || !areHostile(self.team, other.team)) continue;
      const d = distance(self.pos, other.pos);
      if (d < bestDist) {
        bestDist = d;
        best = other;
      }
    }
    return best;
  }

  private endGame(resolution: MatchResolution) {
    const result = resolution.winner === 'ally' ? 'win' : resolution.winner === 'enemy' ? 'loss' : 'draw';
    this.persistLearnedGhost();
    this.recordLearning('victory-condition');
    // The winner and the reason go INTO the state rather than only into the outcome payload the scene emits.
    /**
     * `?? 'draw'` narrows a type, it does not invent a result: every resolveMatch branch that sets a reason also sets a
     * winner (`winnerFromSnapshot` returns `Exclude<MatchWinner, null>`), and only the ongoing branch returns null for
     * both. Written as a coalesce rather than a non-null assertion so an impossible resolution degrades to a draw instead
     * of crashing a match that has already finished.
     */
    this.world.outcome = {
      kind: 'decided',
      winner: resolution.winner ?? 'draw',
      reason: resolution.reason ?? 'unknown',
    };
    this.pushHud();
    audio.play(result === 'win' ? 'victory' : 'defeat');
    if (!this.reducedMotion) {
      this.cameras.main.flash(300, result === 'win' ? 10 : 80, result === 'win' ? 200 : 20, result === 'win' ? 185 : 30);
    }
    const outcome: BattleOutcome = {
      matchId: this.matchId,
      result,
      mode: this.mode,
      matchKind: this.matchKind,
      difficulty: this.difficulty,
      playerChampionId: this.playerChampion.id,
      enemyChampionId: this.enemyChampion.id,
      deaths: this.playerDeaths,
      totalGoldEarned: Math.floor(this.economyFor(this.player).totalEarned),
      objectives: this.world.teamFacts.ally.epicMonstersKilled,
      objectivePoints: this.world.teamFacts.ally.objectivePoints,
      ownedItems: [...this.ownedItems],
      endReason: resolution.reason!,
      learningRequirementsCompleted: learningRequirementsCompleted(this.learning),
      stats: {
        durationSeconds: Math.min(this.rules.hardCapSeconds, Math.round(this.world.simTime)),
        championKills: this.stats.championKills,
        minionKills: this.stats.minionKills,
        damageDealt: Math.round(this.stats.damageDealt),
        level: this.progressionFor(this.player).level,
        gold: Math.floor(this.economyFor(this.player).gold),
      },
    };
    this.time.delayedCall(400, () => this.onGameEnd(outcome));
  }

  private endAbandoned() {
    if (this.matchEnded) return;
    this.world.outcome = { kind: 'decided', winner: 'draw', reason: 'abandoned' };
    this.pushHud();
    const outcome: BattleOutcome = {
      matchId: this.matchId,
      result: 'abandoned',
      mode: this.mode,
      matchKind: this.matchKind,
      difficulty: this.difficulty,
      playerChampionId: this.playerChampion.id,
      enemyChampionId: this.enemyChampion.id,
      deaths: 0,
      totalGoldEarned: 0,
      objectives: 0,
      objectivePoints: 0,
      ownedItems: [],
      endReason: 'surrendered',
      learningRequirementsCompleted: false,
      stats: {
        durationSeconds: Math.round(this.world.simTime),
        championKills: 0,
        minionKills: 0,
        damageDealt: 0,
        level: 1,
        gold: 0,
      },
    };
    this.onGameEnd(outcome);
  }
}
