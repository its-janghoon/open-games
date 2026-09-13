import Phaser from 'phaser';
import {
  CHAMPIONS,
  getChampionById,
  type Champion,
  type Ability,
} from '../../data/champions';
import {
  advanceAttackCooldown,
  abilityDamage,
  applyHeal,
  areHostile,
  canBasicAttack,
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
import {
  lowestHpRatioHostile,
  resolveDashEndpoint,
  targetsIntersectingLine,
} from '../abilitySemantics';
import { shouldDeployHeldWarden, type WardenCharge } from '../wardenPolicy';
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
import {
  DIFFICULTY_CONFIG,
  type Difficulty,
  type MatchKind,
} from '../tutorial/config';
import { audio } from '../audio';
import {
  activePull,
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
  strongestMovementBuff,
  strongestSlow,
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
  nextWaveNumberAt,
  laneWaveComposition,
  type Minion as RiftMinion,
  type MinionType,
} from '../rift/minions';
import {
  createProgress,
  addGold,
  addXp,
  passiveGold,
  minionBounty,
  structureBounty,
  CHAMPION_TAKEDOWN_BOUNTY,
  STARTING_GOLD,
  type ProgressState,
} from '../rift/economy';
import { composeTeams, enemyFacingSlot } from '../rift/teams';
import {
  computeEffectiveStats,
  recommendBuild,
  recommendPurchase,
} from '../rift/loadout';
import { totalModifiers } from '../../data/items';
import {
  createBuffState,
  expireBuffs,
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
  expireBaronBuff,
  heraldReward,
  monsterStats,
  noBaronBuff,
  isHeraldWindowOpen,
  type TeamModifiers,
  type BaronBuffState,
} from '../rift/objectives';
import type { EpicMonster } from '../rift/economy';
import { attemptPurchase } from '../inventory';
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
}

// Canvas dimensions (kept in sync with PhaserGame). The 3000x3000 rift world is
// scaled uniformly into the canvas, leaving a small margin.
const VIEW_W = 900;
const VIEW_H = 640;
const MARGIN = 20;
const SCALE = Math.min(VIEW_W - MARGIN * 2, VIEW_H - MARGIN * 2) / WORLD_SIZE;
const OFF_X = (VIEW_W - WORLD_SIZE * SCALE) / 2;
const OFF_Y = (VIEW_H - WORLD_SIZE * SCALE) / 2;

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
const RESOURCE_REGEN = 8; // per second
const SIMULATION_TICK_SECONDS = 1 / 60;
const MAX_STEPS_PER_RENDER = 12;
const HUD_INTERVAL_SECONDS = 0.1;
const BASIC_PROJECTILE_SPEED = 1650 * SCALE;
const SKILLSHOT_PROJECTILE_SPEED = 1350 * SCALE;
const OBJECTIVE_ATTACK_RANGE = 280 * SCALE;
const OBJECTIVE_LEASH_RANGE = 520 * SCALE;

/** Bounded cosmetic/runtime populations; authoritative impacts are never budgeted. */
const MAX_TRANSIENT_VFX = 96;
const MAX_DAMAGE_TEXTS = 24;
const RESERVED_DAMAGE_TEXT_SLOTS = MAX_DAMAGE_TEXTS;
const MAX_LIVE_MINIONS_PER_SIDE_LANE = 24;
const WAVE_SPAWN_RETRY_SECONDS = 0.75;
const CRITICAL_TEXTURE_TIMEOUT_MS = 2500;
const CHAMPION_DEATH_POSE_MS = 420;

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
 * attackRange*SCALE, moveSpeed*SCALE, clampX/clampY, aim) live in this flat
 * top-down pixel space, exactly as before the 2.5D overhaul. Only the DRAWING
 * is projected: the flat pixel is converted back to world units and run through
 * the FEAT-001 dimetric projection (see {@link project}). Keeping gameplay on
 * the flat plane means combat ranges/speeds are byte-for-byte unchanged.
 */
function toScreen(p: Vec2): Vec2 {
  return { x: OFF_X + p.x * SCALE, y: OFF_Y + p.y * SCALE };
}

/** Inverse of {@link toScreen}: flat gameplay pixel -> world units (0..3000). */
function pixelToWorld(p: Vec2): Vec2 {
  return { x: (p.x - OFF_X) / SCALE, y: (p.y - OFF_Y) / SCALE };
}

/**
 * Project a flat gameplay-plane pixel to its on-screen dimetric position. This
 * is the single place the flat plane becomes 2.5D: pixel -> world -> screen.
 */
function project(p: Vec2): Vec2 {
  return worldToScreen(pixelToWorld(p), DEFAULT_PROJECTION);
}

/**
 * Depth key for an entity standing at a flat gameplay pixel, lifted by
 * `heightPx` screen pixels. Delegates to the projection's {@link depthFor} on
 * the underlying world coordinate so nearer (lower-on-screen) entities sort on
 * top. Height is converted from screen pixels to world units for the tie-break.
 */
function depthForPixel(p: Vec2, heightPx = 0): number {
  return depthFor(pixelToWorld(p), heightPx / HEIGHT_SCALE, DEFAULT_PROJECTION);
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
  cds: CooldownState;
  resource: number;
  maxResource: number;
  progress: ProgressState;
  ownedItems: string[];
  buffs: BuffState;
  goldAccrual: number;
  totalGoldEarned: number;
  currentIntent: AiIntent;
  pendingIntent: AiIntent | null;
  intentReadyAt: number;
  nextDecisionAt: number;
  /** The active map lane this bot walks/pushes. */
  lane: Lane;
  /** Cached lane push waypoints (flat gameplay pixels), enemy-nexus-ward. */
  pushPath: Vec2[];
  /** Current index into {@link pushPath} while marching. */
  pushIndex: number;
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
  life?: ChampionLifeState;
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

interface PendingImpact {
  dueAt: number;
  insertionOrder: number;
  source: Unit;
  targetId?: string;
  point?: Vec2;
  line?: {
    origin: Vec2;
    endpoint: Vec2;
    halfWidth: number;
    subsequentDamageMultiplier: number;
  };
  radius: number;
  rawDamage: number;
  color: number;
  stunDuration: number;
  slowPercent?: number;
  slowDuration?: number;
  pullDuration?: number;
  ability: boolean;
  ultimate: boolean;
  singleTarget: boolean;
  chronoProc: boolean;
}

interface PendingWaveSpawn {
  dueAt: number;
  insertionOrder: number;
  type: MinionType;
  team: MapSide;
  lane: Lane;
}

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

interface TeamFacts {
  championKills: number;
  epicMonstersKilled: number;
  objectivePoints: number;
  totalGoldEarned: number;
}

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
  private targetByEntityId = new Map<string, string>();
  private sunfireHitAt = new Map<string, number>();
  private passiveCounters = new Map<string, number>();
  private internalCooldowns = new Map<string, number>();
  /** Structure entities keyed by their pure graph id. */
  private structureById = new Map<string, Entity>();
  private allyNexus!: Entity;
  private enemyNexus!: Entity;

  private structureLines: StructureLine[] = [];

  private playerCds: CooldownState = createCooldownState();
  private playerResource = 0;
  private playerMaxResource = 300;

  // Economy / progression. Each AI bot carries its own ProgressState; this is
  // the human player's.
  private playerProgress: ProgressState = createProgress();
  private ownedItems: string[] = [];
  private goldAccrual = 0;
  private playerTotalGoldEarned = STARTING_GOLD;
  private playerDeaths = 0;

  private teamFacts: Record<MapSide, TeamFacts> = {
    ally: { championKills: 0, epicMonstersKilled: 0, objectivePoints: 0, totalGoldEarned: STARTING_GOLD * 5 },
    enemy: { championKills: 0, epicMonstersKilled: 0, objectivePoints: 0, totalGoldEarned: STARTING_GOLD * 5 },
  };

  // Buffs / objectives (ally-team perspective drives HUD + player stats).
  private playerBuffs: BuffState = createBuffState();
  private allyBaron: BaronBuffState = noBaronBuff();
  private enemyBaron: BaronBuffState = noBaronBuff();
  private allyDragonStacks = 0;
  private enemyDragonStacks = 0;
  private objectives: ObjectiveRuntime[] = [];
  private camps: CampRuntime[] = [];
  private traps: TrapRuntime[] = [];
  private trapGraphics = new Map<string, Phaser.GameObjects.Arc>();
  private pendingImpacts: PendingImpact[] = [];
  private pendingWaveSpawns: PendingWaveSpawn[] = [];
  private authorityInsertionOrder = 0;

  // Wave scheduling.
  private spawnedWaves = 0;
  /** Inhibitors down per side, for super-minion spawning. */
  private inhibitorKillTimes = new Map<string, number>();

  private moveTarget: Vec2 | null = null;
  private playerOrder: 'move' | 'attack-move' | 'target' | 'stop' = 'stop';
  private attackMoveArmed = false;
  private armedAbility: CooldownKey | null = null;
  private aimPoint: Vec2 | null = null;
  private aimPreview?: Phaser.GameObjects.Graphics;
  private pauseReasons = new Set<'manual' | 'settings' | 'hidden'>();
  private recallStartedAt: number | null = null;
  private recallCancellation = '';
  private learning: LearningState = createLearningState();
  private wardenCharge: Record<MapSide, WardenCharge | null> = { ally: null, enemy: null };
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

  private elapsed = 0;
  private simulationTick = 0;
  private simulationAccumulator = 0;
  private scheduledCommands: ScheduledBattleCommand[] = [];
  private nextHudAt = 0;
  private ended = false;
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
    this.enemyChampion =
      getChampionById(data.enemyChampionId) ?? getChampionById('nightveil')!;

    // Reset per-run state so a restart/rematch starts clean.
    this.champions = [];
    this.structures = [];
    this.minions = [];
    this.allEntities = [];
    this.entityById.clear();
    this.targetByEntityId.clear();
    this.sunfireHitAt.clear();
    this.passiveCounters.clear();
    this.internalCooldowns.clear();
    this.structureById.clear();
    this.structureLines = [];
    this.playerCds = createCooldownState();
    this.playerResource = this.playerMaxResource;
    this.playerProgress = createProgress(STARTING_GOLD);
    this.ownedItems = [];
    this.goldAccrual = 0;
    this.playerTotalGoldEarned = STARTING_GOLD;
    this.playerDeaths = 0;
    this.teamFacts = {
      ally: { championKills: 0, epicMonstersKilled: 0, objectivePoints: 0, totalGoldEarned: STARTING_GOLD * 5 },
      enemy: { championKills: 0, epicMonstersKilled: 0, objectivePoints: 0, totalGoldEarned: STARTING_GOLD * 5 },
    };
    this.playerBuffs = createBuffState();
    this.allyBaron = noBaronBuff();
    this.enemyBaron = noBaronBuff();
    this.allyDragonStacks = 0;
    this.enemyDragonStacks = 0;
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
    this.pendingImpacts = [];
    this.pendingWaveSpawns = [];
    this.authorityInsertionOrder = 0;
    this.spawnedWaves = 0;
    this.inhibitorKillTimes.clear();
    this.moveTarget = null;
    this.playerOrder = 'stop';
    this.attackMoveArmed = false;
    this.armedAbility = null;
    this.aimPoint = null;
    this.aimPreview?.clear();
    this.pauseReasons.clear();
    this.recallStartedAt = null;
    this.recallCancellation = '';
    this.learning = createLearningState();
    this.wardenCharge = { ally: null, enemy: null };
    this.purchaseFeedbackSequence = 0;
    this.lastPurchaseFeedback = undefined;
    this.elapsed = 0;
    this.simulationTick = 0;
    this.simulationAccumulator = 0;
    this.scheduledCommands = [];
    this.nextHudAt = 0;
    this.ended = false;
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
      const base = toScreen(BASE_POSITIONS[side]);
      for (const slot of slots) {
        // Fan the fountain spawns slightly so the five champions do not overlap.
        const n = side === 'ally' ? allyIndex++ : enemyIndex++;
        const spawn: Vec2 = {
          x: this.clampX(base.x + (n - 2) * 16 * SCALE),
          y: this.clampY(base.y + (n - 2) * 16 * SCALE),
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
            cds: createCooldownState(),
            resource: 300,
            maxResource: 300,
            progress: createProgress(STARTING_GOLD),
            ownedItems: [],
            buffs: createBuffState(),
            goldAccrual: 0,
            totalGoldEarned: STARTING_GOLD,
            currentIntent: 'approach',
            pendingIntent: null,
            intentReadyAt: 0,
            nextDecisionAt: 0,
            lane: slot.lane,
            pushPath: laneWaypoints(slot.lane, side).map(toScreen),
            pushIndex: 0,
          };
        }
        this.champions.push(entity);
        this.applyChampionStats(entity, side);
        entity.unit.hp = entity.unit.maxHp;
        if (entity.bot) entity.bot.resource = entity.bot.maxResource;
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
        return toScreen(anchors.outerTurrets[lane!]);
      case 'innerTurret':
        return toScreen(anchors.innerTurrets[lane!]);
      case 'inhibitorTurret':
        return toScreen(anchors.inhibitorTurrets[lane!]);
      case 'inhibitor':
        return toScreen(anchors.inhibitors[lane!]);
      case 'nexusTurret':
        return toScreen(node.id.endsWith('-a') ? anchors.nexusTurrets[0] : anchors.nexusTurrets[1]);
      case 'nexus':
      default:
        return toScreen(anchors.nexus);
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
      attackRange: champion.stats.attackRange * SCALE,
      attackSpeed: champion.stats.attackSpeed,
      moveSpeed: champion.stats.moveSpeed * SCALE,
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
      life: createChampionLifeState(),
      champion,
      championPose: 'idle',
      poseLockedUntil: 0,
      posePriority: 0,
      movedThisFrame: false,
      hpRegen: champion.stats.hpRegen,
      abilityPower: 0,
    };
    this.attachHpBar(entity, size.height + 12);
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
    if (this.elapsed < lockedUntil && priority < currentPriority) return;
    // A pose is now a FRAME of the champion's pixel-art sheet, so switching pose
    // costs an index change instead of rasterizing and caching a new texture.
    // The texture itself never changes, so origin/display size stay valid.
    entity.championPose = pose;
    entity.body.setFrame(frameForPose(pose, this.elapsed));
    entity.poseLockedUntil = holdMs > 0 ? this.elapsed + holdMs / 1000 : this.elapsed;
    entity.posePriority = priority;
  }

  private refreshChampionLocomotionPoses(): void {
    for (const champion of this.champions) {
      if (!isChampionPresent(champion.life!)) continue;
      if (this.elapsed < (champion.poseLockedUntil ?? 0)) continue;
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
      attackRange: isTurret ? TURRET_RANGE * SCALE : 0,
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
    const level = isHuman ? this.playerProgress.level : entity.bot!.progress.level;
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
    u.moveSpeed = eff.moveSpeed * SCALE;
    u.attackRange = eff.attackRange * SCALE;
    entity.hpRegen = eff.hpRegen;
    entity.abilityPower = eff.abilityPower;
    if (isHuman) {
      this.playerMaxResource = 300 + eff.resource;
    } else {
      entity.bot!.maxResource = 300 + eff.resource;
    }
  }

  /** The current team modifiers for a side (dragon stacks + baron buff). */
  private teamModifiers(side: MapSide): TeamModifiers {
    const stacks = side === 'ally' ? this.allyDragonStacks : this.enemyDragonStacks;
    const baron = side === 'ally' ? this.allyBaron : this.enemyBaron;
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
      this.pendingWaveSpawns = [];
      this.pendingImpacts = [];
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
    const world = screenToWorld({ x: pointer.worldX, y: pointer.worldY }, DEFAULT_PROJECTION);
    return toScreen(world);
  }

  private clientToGround(clientX: number, clientY: number): Vec2 {
    const rect = this.game.canvas.getBoundingClientRect();
    const canvasX = ((clientX - rect.left) / Math.max(1, rect.width)) * this.scale.gameSize.width;
    const canvasY = ((clientY - rect.top) / Math.max(1, rect.height)) * this.scale.gameSize.height;
    const projected = this.cameras.main.getWorldPoint(canvasX, canvasY);
    return toScreen(screenToWorld(projected, DEFAULT_PROJECTION));
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
    if (!graphics || !slot || !aim || !this.player || this.ended) {
      graphics?.clear();
      return;
    }
    const ability = this.abilityBySlot(this.playerChampion, slot);
    const origin = this.player.unit.pos;
    const endpoint = this.resolveCastEndpoint(this.player, ability, aim);
    const color = Phaser.Display.Color.HexStringToColor(this.playerChampion.accentColor).color;
    const points: Phaser.Geom.Point[] = [];
    const radius = ability.range * SCALE;
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
    graphics.fillStyle(color, 0.3).fillCircle(to.x, to.y, Math.max(5, (ability.mechanics?.radius ?? 34) * SCALE));
  }

  private entityAtPoint(point: Vec2, source: Unit): Entity | undefined {
    const livingIds = new Set(
      this.allEntities.filter((entity) => !entity.unit.dead).map((entity) => entity.unit.id),
    );
    let best: Entity | undefined;
    let bestDistance = 90 * SCALE;
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
    if (this.ended || !this.sceneReady) return;
    this.simulationAccumulator += Math.max(0, deltaMs / 1000);
    this.ingestCommands();
    if (this.pauseReasons.size > 0 || this.ended) {
      this.simulationAccumulator = 0;
      this.syncAimPreview();
      return;
    }

    let steps = 0;
    for (const champion of this.champions) champion.movedThisFrame = false;
    while (
      this.simulationAccumulator + Number.EPSILON >= SIMULATION_TICK_SECONDS &&
      steps < MAX_STEPS_PER_RENDER &&
      !this.ended
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
    const nextElapsed = (this.simulationTick + 1) * SIMULATION_TICK_SECONDS;
    if (nextElapsed > this.rules.hardCapSeconds + Number.EPSILON) return;
    this.simulationTick += 1;
    this.elapsed = Math.min(this.rules.hardCapSeconds, this.simulationTick * SIMULATION_TICK_SECONDS);
    const dt = SIMULATION_TICK_SECONDS;
    this.processScheduledCommands();
    if (this.ended || this.pauseReasons.size > 0) return;
    this.tickRecall();

    this.advanceChampionLives();
    this.reviveInhibitors();
    tickCooldowns(this.playerCds, dt);
    const blueRegen = this.blueBuffRegen();
    this.playerResource = Math.min(this.playerMaxResource, this.playerResource + (RESOURCE_REGEN + blueRegen) * dt);
    for (const c of this.champions) {
      if (!c.bot) continue;
      tickCooldowns(c.bot.cds, dt);
      const botBlueRegen = c.bot.buffs.buffs.some((buff) => buff.kind === 'blue')
        ? BUFF_EFFECTS.blue.resourceRegenPerSecond : 0;
      c.bot.resource = Math.min(c.bot.maxResource, c.bot.resource + (RESOURCE_REGEN + botBlueRegen) * dt);
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
    if (!this.ended && this.elapsed >= this.nextHudAt) {
      this.pushHud();
      this.nextHudAt = this.elapsed + HUD_INTERVAL_SECONDS;
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
        battleStore.recordAuthorityCommand({ ...queued, command: canonicalCommand, targetTick: this.simulationTick });
        this.pauseReasons.add(canonicalCommand.reason);
        this.simulationAccumulator = 0;
        this.clearAimPreview();
        this.pushHud();
      } else if (canonicalCommand.type === 'resume') {
        battleStore.recordAuthorityCommand({ ...queued, command: canonicalCommand, targetTick: this.simulationTick });
        this.pauseReasons.delete(canonicalCommand.reason);
        this.simulationAccumulator = 0;
        this.pushHud();
      } else if (canonicalCommand.type === 'surrender') {
        battleStore.recordAuthorityCommand({ ...queued, command: canonicalCommand, targetTick: this.simulationTick });
        this.endAbandoned();
        return;
      } else {
        const backlogTicks = Math.floor(this.simulationAccumulator / SIMULATION_TICK_SECONDS);
        const targetTick = this.simulationTick + backlogTicks + 1;
        const scheduled = { ...queued, command: canonicalCommand, targetTick };
        this.scheduledCommands.push(scheduled);
        battleStore.recordAuthorityCommand(scheduled);
      }
    }
    this.scheduledCommands.sort((a, b) => a.targetTick - b.targetTick || a.sequence - b.sequence);
  }

  private processScheduledCommands(): void {
    const due = this.scheduledCommands.filter((queued) => queued.targetTick <= this.simulationTick);
    this.scheduledCommands = this.scheduledCommands.filter((queued) => queued.targetTick > this.simulationTick);
    for (const queued of due) this.processCommand(queued.command);
  }

  private processCommand(command: BattleCommand): void {
    if (this.pauseReasons.size > 0 || this.elapsed >= this.rules.hardCapSeconds) return;
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
      this.moveTarget = { ...command.point };
      this.targetByEntityId.delete(this.player.unit.id);
    } else if (command.type === 'target-at') {
      this.cancelRecall('movement');
      this.attackMoveArmed = false;
      const target = this.entityAtPoint(command.point, this.player.unit);
      if (target) {
        this.playerOrder = 'target';
        this.moveTarget = null;
        this.targetByEntityId.set(this.player.unit.id, target.unit.id);
      } else {
        this.playerOrder = 'move';
        this.moveTarget = { ...command.point };
        this.targetByEntityId.delete(this.player.unit.id);
      }
    } else if (command.type === 'attack-move-to') {
      this.cancelRecall('movement');
      this.attackMoveArmed = false;
      this.playerOrder = 'attack-move';
      this.moveTarget = { ...command.point };
      this.targetByEntityId.delete(this.player.unit.id);
    } else if (command.type === 'stop') {
      this.cancelRecall('movement');
      this.attackMoveArmed = false;
      this.moveTarget = null;
      this.playerOrder = 'stop';
      this.targetByEntityId.delete(this.player.unit.id);
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

  private startRecall() {
    if (!isChampionPresent(this.player.life!) || this.inBase(this.player.unit, 'ally')) return;
    this.recallStartedAt = this.elapsed;
    this.recallCancellation = '';
    this.playerOrder = 'stop';
    this.moveTarget = null;
  }

  private cancelRecall(reason: string) {
    if (this.recallStartedAt === null) return;
    this.recallStartedAt = null;
    this.recallCancellation = reason;
  }

  private tickRecall() {
    if (this.recallStartedAt === null || this.elapsed - this.recallStartedAt < 6) return;
    this.player.unit.pos = { ...toScreen(BASE_POSITIONS.ally) };
    this.recallStartedAt = null;
  }

  private recordLearning(action: LearningAction) {
    if (this.matchKind === 'tutorial') this.learning = recordLearningAction(this.learning, action);
  }

  private blueBuffRegen(): number {
    return this.playerBuffs.buffs.some((b) => b.kind === 'blue')
      ? BUFF_EFFECTS.blue.resourceRegenPerSecond
      : 0;
  }

  private tickEconomy(dt: number) {
    this.goldAccrual += passiveGold(dt);
    if (this.goldAccrual >= 1) {
      const whole = Math.floor(this.goldAccrual);
      addGold(this.playerProgress, whole);
      this.playerTotalGoldEarned += whole;
      this.teamFacts.ally.totalGoldEarned += whole;
      this.goldAccrual -= whole;
    }

    for (const entity of this.champions) {
      const bot = entity.bot;
      if (!bot) continue;
      bot.goldAccrual += passiveGold(dt);
      if (bot.goldAccrual >= 1) {
        const whole = Math.floor(bot.goldAccrual);
        addGold(bot.progress, whole);
        bot.totalGoldEarned += whole;
        this.teamFacts[bot.side].totalGoldEarned += whole;
        bot.goldAccrual -= whole;
      }
      if (!this.inBase(entity.unit, bot.side) || !isChampionPresent(entity.life!)) continue;
      const item = recommendPurchase(bot.champion.role, bot.progress.gold, bot.ownedItems);
      if (!item) continue;
      const purchase = attemptPurchase({
        gold: bot.progress.gold,
        items: bot.ownedItems,
        inShop: true,
      }, item.id);
      if (!purchase.accepted) continue;
      bot.progress.gold = purchase.gold;
      bot.ownedItems = purchase.items;
      this.applyChampionStats(entity, bot.side);
    }
  }

  private tickBuffsAndObjectives() {
    expireBuffs(this.playerBuffs, this.elapsed);
    for (const champion of this.champions) {
      if (champion.bot) expireBuffs(champion.bot.buffs, this.elapsed);
    }
    const allyWasActive = this.allyBaron.active;
    const enemyWasActive = this.enemyBaron.active;
    this.allyBaron = expireBaronBuff(this.allyBaron, this.elapsed);
    this.enemyBaron = expireBaronBuff(this.enemyBaron, this.elapsed);
    if (allyWasActive !== this.allyBaron.active) this.applyTeamChampionStats('ally');
    if (enemyWasActive !== this.enemyBaron.active) this.applyTeamChampionStats('enemy');
    for (const runtime of this.camps) {
      if (runtime.members.length === 0 && this.elapsed >= runtime.nextSpawnAt) {
        runtime.members = this.spawnCamp(runtime.camp);
      }
    }
    if (!this.rules.objectives.enabled) return;

    for (const runtime of this.objectives) {
      if (
        runtime.id === 'herald' &&
        runtime.entity &&
        this.elapsed > this.rules.objectives.heraldEndSeconds
      ) {
        runtime.entity.unit.dead = true;
        runtime.entity = null;
        runtime.permanentlyGone = true;
        continue;
      }
      if (runtime.permanentlyGone || runtime.entity || this.elapsed < runtime.nextSpawnAt) continue;
      if (runtime.id === 'herald' && !isHeraldWindowOpen(this.elapsed)) {
        if (this.elapsed > this.rules.objectives.heraldEndSeconds) runtime.permanentlyGone = true;
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
      gold: this.playerProgress.gold,
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
    this.playerProgress.gold = result.gold;
    this.ownedItems = result.items;
    this.recordLearning('recall-shop');
    this.applyChampionStats(this.player, 'ally');
  }

  /** Whether a champion is close enough to its fountain to shop. */
  private inBase(u: Unit, side: MapSide): boolean {
    const base = toScreen(BASE_POSITIONS[side]);
    return distance(u.pos, base) <= 220 * SCALE;
  }

  private maybeSpawnWaves() {
    const wanted = nextWaveNumberAt(this.elapsed, this.mode);
    while (this.spawnedWaves < wanted) {
      this.spawnedWaves += 1;
      this.spawnWave(this.spawnedWaves);
    }
  }

  private spawnWave(waveNumber: number) {
    for (const team of ['ally', 'enemy'] as MapSide[]) {
      for (const lane of this.lanes) {
        // Super minions spawn when the enemy inhibitor for that lane is down.
        const enemySide: MapSide = team === 'ally' ? 'enemy' : 'ally';
        const inhibId = `${enemySide}-${lane}-inhibitor`;
        const killedAt = this.inhibitorKillTimes.get(inhibId) ?? null;
        const inhibitorsDown = isInhibitorAlive(this.elapsed, killedAt, this.mode) ? 0 : 1;
        const comp = laneWaveComposition(waveNumber, inhibitorsDown);
        comp.forEach((type, i) => {
          this.pendingWaveSpawns.push({
            dueAt: this.elapsed + (i * this.rules.waves.unitStaggerMilliseconds) / 1000,
            insertionOrder: this.authorityInsertionOrder++,
            type,
            team,
            lane,
          });
        });
      }
    }
  }

  private processWaveSpawns() {
    const partitioned = partitionImpacts(this.pendingWaveSpawns, this.elapsed);
    this.pendingWaveSpawns = partitioned.pending;
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
        this.pendingWaveSpawns.push({
          ...spawn,
          dueAt: this.elapsed + WAVE_SPAWN_RETRY_SECONDS,
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
    const screenPos = toScreen(rift.pos);
    const unit = this.makeUnit(
      `minion-${team}-${lane}-${type}-${this.minionSequence++}`,
      'minion',
      team,
      screenPos,
      {
        maxHp: stats.hp,
        ad: stats.ad,
        armor: stats.armor,
        attackRange: stats.attackRange * SCALE,
        attackSpeed: 1.25,
        moveSpeed: stats.moveSpeed * SCALE,
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
      path: laneWaypoints(lane, team).map(toScreen),
      minionType: type,
    };
    this.attachHpBar(entity, size.height + 6);
    this.minions.push(entity);
    this.addEntity(entity);
  }

  // ---- Update helpers ------------------------------------------------------

  private regenAndTick(dt: number) {
    for (const e of this.allEntities) {
      expireEffects(e.effects, this.elapsed);
      const pull = activePull(e.effects, this.elapsed);
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
    if (isChampionPresent(this.player.life!)) {
      applyHeal(this.player.unit, (this.player.hpRegen ?? 0) * dt);
      if (this.inBase(this.player.unit, 'ally')) {
        applyHeal(this.player.unit, this.player.unit.maxHp * 0.08 * dt);
        this.playerResource = Math.min(this.playerMaxResource, this.playerResource + this.playerMaxResource * 0.08 * dt);
      }
    }
    // Every AI champion regenerates from effective level/item stats, plus a
    // strong fountain heal when it is home.
    for (const c of this.champions) {
      if (!c.bot || !isChampionPresent(c.life!)) continue;
      applyHeal(c.unit, (c.hpRegen ?? 0) * dt);
      if (this.inBase(c.unit, c.bot.side)) {
        applyHeal(c.unit, c.unit.maxHp * 0.08 * dt);
        c.bot.resource = Math.min(c.bot.maxResource, c.bot.resource + c.bot.maxResource * 0.08 * dt);
      }
    }
  }

  private updatePlayerMovement(dt: number) {
    const u = this.player.unit;
    if (!isChampionPresent(this.player.life!)) return;
    if (this.player.stunned > 0 || this.playerOrder === 'stop') return;

    if (this.playerOrder === 'target') {
      const target = this.findTarget(u, 1600 * SCALE, true);
      if (!target) {
        this.playerOrder = 'stop';
        return;
      }
      if (distance(u.pos, target.pos) <= u.attackRange) this.tryBasicAttack(this.player, target);
      else this.moveUnitToward(u, target.pos, dt);
      return;
    }

    if (this.playerOrder === 'attack-move') {
      const target = this.findTarget(u, 450 * SCALE);
      if (target) {
        if (distance(u.pos, target.pos) <= u.attackRange) this.tryBasicAttack(this.player, target);
        else this.moveUnitToward(u, target.pos, dt);
        return;
      }
    }

    if (this.moveTarget) {
      const d = distance(u.pos, this.moveTarget);
      if (d < 4) {
        this.moveTarget = null;
        this.playerOrder = 'stop';
      } else {
        this.moveUnitToward(u, this.moveTarget, dt);
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
    if (!isChampionPresent(bot.life!)) return;
    if (bot.stunned > 0) return;

    const objective = this.objectiveForBot(bot);
    const target = objective?.unit ?? this.findTarget(u, 1200 * SCALE, true);
    const cadence = DIFFICULTY_CONFIG[this.difficulty];

    // Difficulty changes both how quickly a bot can react and how often it may
    // reconsider. Keep executing the accepted intent between decisions so the
    // simulation remains smooth rather than freezing between AI ticks.
    if (state.pendingIntent && this.elapsed >= state.intentReadyAt) {
      state.currentIntent = state.pendingIntent;
      state.pendingIntent = null;
    }
    if (this.elapsed >= state.nextDecisionAt) {
      state.pendingIntent = decideAction(this.buildAiSnapshot(bot, target));
      state.intentReadyAt = this.elapsed + cadence.reactionDelayMs / 1000;
      state.nextDecisionAt = this.elapsed + cadence.decisionIntervalMs / 1000;
    }

    const intent = state.currentIntent;
    const homeBase = toScreen(BASE_POSITIONS[state.side]);

    switch (intent) {
      case 'approach': {
        if (target) {
          this.moveUnitToward(u, target.pos, dt);
        } else {
          const goal = this.laneAdvanceGoal(state);
          this.moveUnitToward(u, goal, dt);
          // Advance to the next lane waypoint once this one is reached so the
          // bot keeps marching toward the enemy nexus.
          if (
            state.pushIndex < state.pushPath.length - 1 &&
            distance(u.pos, goal) <= 30 * SCALE
          ) {
            state.pushIndex += 1;
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
          distance(bot.unit.pos, objective.unit.pos) <= 1800 * SCALE,
      )
      .sort(
        (a, b) =>
          distance(bot.unit.pos, a.unit.pos) - distance(bot.unit.pos, b.unit.pos) ||
          a.unit.id.localeCompare(b.unit.id),
      )[0];
  }

  /**
   * The next lane waypoint a bot should walk toward while pushing. Advances the
   * bot's cached push index as it reaches each waypoint so it marches down its
   * lane toward the enemy nexus. Returns the final waypoint once the lane is
   * fully walked. No per-frame allocation beyond reading the cached path.
   */
  private laneAdvanceGoal(state: BotState): Vec2 {
    const path = state.pushPath;
    if (path.length === 0) return toScreen(BASE_POSITIONS[state.side]);
    // (path is authored ally->enemy; laneWaypoints already reversed for enemy).
    return path[Math.min(state.pushIndex, path.length - 1)];
  }

  private buildAiSnapshot(bot: Entity, target: Unit | undefined): AiSnapshot {
    const u = bot.unit;
    const state = bot.bot!;
    const dist = target ? distance(u.pos, target.pos) : Infinity;
    const [q, w, e, r] = state.champion.abilities;
    const nearbyChampions = this.champions.filter(
      (entity) => isChampionPresent(entity.life!) && distance(entity.unit.pos, u.pos) <= 650 * SCALE,
    );
    const nearbyMinions = this.minions.filter(
      (entity) => !entity.unit.dead && distance(entity.unit.pos, u.pos) <= 600 * SCALE,
    );
    const alliedWave = nearbyMinions.filter((entity) => entity.unit.team === u.team).length;
    const hostileWave = nearbyMinions.filter((entity) => areHostile(u.team, entity.unit.team)).length;
    const waveTotal = Math.max(1, alliedWave + hostileWave);
    const build = recommendBuild(state.champion.role, state.ownedItems, state.progress.gold);
    const nextPurchaseCost = build?.nextPurchasableComponent?.cost ?? build?.remainingCost;
    const objectivePressure = this.objectives.some(
      (objective) =>
        objective.entity != null &&
        !objective.entity.unit.dead &&
        distance(objective.entity.unit.pos, u.pos) <= 1000 * SCALE,
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
        Q: q.range * SCALE,
        W: w.range * SCALE,
        E: e.range * SCALE,
        R: r.range * SCALE,
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
        gold: state.progress.gold,
        nextPurchaseCost,
        shopAvailable: this.inBase(u, state.side),
      },
    };
  }

  private updateMinions(dt: number) {
    for (const m of this.minions) {
      const u = m.unit;
      if (u.dead || !m.rift || !m.path) continue;
      const target = this.findTarget(u, 200 * SCALE);
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
        const screen = toScreen(res.pos);
        u.pos.x = screen.x;
        u.pos.y = screen.y;
      }
    }
  }

  private updateTurret(turret: Entity) {
    const u = turret.unit;
    if (u.dead) return;
    const target = this.findTarget(u, u.attackRange);
    if (target && canBasicAttack(u)) {
      const dueAt = this.queueTargetedImpact(
        turret,
        target,
        u.ad,
        0xffcc55,
        BASIC_PROJECTILE_SPEED,
      );
      this.drawBeam(u.pos, target.pos, 0xffcc55, Math.max(1, (dueAt - this.elapsed) * 1000));
      resetAttackCooldown(u);
    }
  }

  // ---- Combat actions ------------------------------------------------------

  private tryBasicAttack(attacker: Entity, target: Unit) {
    this.tryBasicAttackUnit(attacker, target);
  }

  private tryBasicAttackUnit(attacker: Entity, target: Unit) {
    const u = attacker.unit;
    if (!canBasicAttack(u) || target.dead) return;
    if (distance(u.pos, target.pos) > u.attackRange) return;
    const targetEntity = this.entityForUnit(target);
    if (!targetEntity || !this.isEntityDamageable(targetEntity)) return;
    let ad = u.ad;
    if (attacker.champion?.id === 'duskarrow') {
      const key = `duskarrow-distance:${u.id}`;
      if ((this.passiveCounters.get(key) ?? 0) >= 300) ad += 18;
      this.passiveCounters.set(key, 0);
    }
    if (attacker.champion?.id === 'nightveil') {
      const key = `nightveil-dash:${u.id}`;
      if ((this.internalCooldowns.get(key) ?? 0) > this.elapsed) {
        ad += 40;
        this.internalCooldowns.set(key, 0);
      }
    }
    if (attacker.champion?.id === 'ashborne') {
      const key = `ashborne:${u.id}:${target.id}`;
      const expiryKey = `${key}:expires`;
      const prior = (this.internalCooldowns.get(expiryKey) ?? 0) > this.elapsed
        ? this.passiveCounters.get(key) ?? 0 : 0;
      const count = prior + 1;
      this.internalCooldowns.set(expiryKey, this.elapsed + 4);
      if (count >= 3) {
        ad += 15;
        this.passiveCounters.set(key, 0);
      } else this.passiveCounters.set(key, count);
    }
    const attackerItems = attacker === this.player ? this.ownedItems : attacker.bot?.ownedItems ?? [];
    if (attacker === this.player) {
      this.cancelRecall('attack');
    }
    if (
      attackerItems.includes('sunfireGreatblade') &&
      this.elapsed - (this.sunfireHitAt.get(`${u.id}:${target.id}`) ?? Number.NEGATIVE_INFINITY) >= 1
    ) {
      ad += 15;
      this.sunfireHitAt.set(`${u.id}:${target.id}`, this.elapsed);
    }
    const attackerBuffs = attacker === this.player ? this.playerBuffs : attacker.bot?.buffs;
    if (attackerBuffs?.buffs.some((buff) => buff.kind === 'red')) {
      ad += BUFF_EFFECTS.red.bonusDamage;
    }
    if (attacker.champion) {
      this.setChampionPose(attacker, 'attack', CHAMPION_POSE_HOLD_MS.attack, 1);
    }
    if (u.attackRange > 220 * SCALE) {
      const dueAt = this.queueTargetedImpact(
        attacker,
        target,
        ad,
        0xf0e6d2,
        BASIC_PROJECTILE_SPEED,
      );
      this.drawProjectile(
        u.pos,
        target.pos,
        0xf0e6d2,
        Math.max(1, (dueAt - this.elapsed) * 1000),
      );
    } else {
      this.applyTargetedDamage(attacker, targetEntity, ad, 0xf0e6d2);
    }
    resetAttackCooldown(u);
  }

  private tryPlayerCast(slot: CooldownKey) {
    if (
      this.ended || this.pauseReasons.size > 0 || this.hasModalFocus() ||
      !isChampionPresent(this.player.life!) || this.player.stunned > 0
    ) return;
    this.cancelRecall('ability');
    const pointer = this.input.activePointer;
    this.tryPlayerCastAt(slot, this.pointerToGround(pointer));
  }

  private tryPlayerCastAt(slot: CooldownKey, aim: Vec2) {
    if (
      this.ended || this.pauseReasons.size > 0 || this.hasModalFocus() ||
      !isChampionPresent(this.player.life!) || this.player.stunned > 0
    ) return;
    this.cancelRecall('ability');
    // Aim has already been converted to the flat authoritative plane.
    this.castAbility(this.player, slot, aim, this.playerChampion, this.playerCds, () => {
      const cost = this.abilityBySlot(this.playerChampion, slot).cost;
      if (this.playerResource < cost || this.playerCds[slot] > 0) return false;
      this.playerResource -= cost;
      return true;
    });
  }

  private aimedAlly(caster: Entity, ability: Ability, aim: Vec2): Entity | undefined {
    return this.champions
      .filter(
        (ally) =>
          ally.unit.team === caster.unit.team &&
          isChampionPresent(ally.life!) &&
          distance(ally.unit.pos, caster.unit.pos) <= ability.range * SCALE &&
          distance(ally.unit.pos, aim) <= 90 * SCALE,
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
          isChampionPresent(ally.life!) &&
          distance(ally.unit.pos, caster.unit.pos) <= ability.range * SCALE,
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
        (ally) => ally.unit.team === side && isChampionPresent(ally.life!) &&
          distance(ally.unit.pos, caster.unit.pos) <= (champion.id === 'dawnsong' ? 600 : 650) * SCALE,
      )
      .sort(
        (a, b) => a.unit.hp / a.unit.maxHp - b.unit.hp / b.unit.maxHp || a.unit.id.localeCompare(b.unit.id),
      );
    const target = candidates[0];
    if (!target) return;
    if (champion.id === 'dawnsong') {
      const key = `dawnsong-passive:${caster.unit.id}`;
      if ((this.internalCooldowns.get(key) ?? 0) <= this.elapsed) {
        applyHeal(target.unit, 35);
        this.internalCooldowns.set(key, this.elapsed + 3);
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
    this.castAbility(bot, slot, aim, state.champion, state.cds, () => {
      const cost = this.abilityBySlot(state.champion, slot).cost;
      if (state.resource < cost || state.cds[slot] > 0) return false;
      state.resource -= cost;
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
    if (caster === this.player && this.playerBuffs.buffs.some((b) => b.kind === 'blue')) {
      cdr += BUFF_EFFECTS.blue.cooldownReduction;
    } else if (caster.bot?.buffs.buffs.some((buff) => buff.kind === 'blue')) {
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
          ability.range * SCALE,
        )
      : undefined;
    if (ability.mechanics?.targetPolicy === 'aimed-ally' && !aimedAlly) return;
    if (ability.mechanics?.targetPolicy === 'lowest-hp-ratio-hostile' && !executeTarget) return;
    const resolvedAim = aimedAlly?.unit.pos ?? executeTarget?.pos ?? aim;
    const endpoint = this.resolveCastEndpoint(caster, ability, resolvedAim);
    if (executeTarget && distance(endpoint, executeTarget.pos) > 50 * SCALE) return;
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

    if (effect.dashes) {
      caster.unit.pos.x = endpoint.x;
      caster.unit.pos.y = endpoint.y;
      if (champion.id === 'nightveil') this.internalCooldowns.set(`nightveil-dash:${caster.unit.id}`, this.elapsed + 3);
      this.drawDashTrail(origin, caster.unit.pos, color);
    }
    const alliesInRange = this.champions
      .filter(
        (ally) => ally.unit.team === caster.unit.team && isChampionPresent(ally.life!) &&
          distance(ally.unit.pos, caster.unit.pos) <= ability.range * SCALE,
      )
      .sort(
        (a, b) => a.unit.hp / a.unit.maxHp - b.unit.hp / b.unit.maxHp || a.unit.id.localeCompare(b.unit.id),
      );
    if ((champion.id === 'dawnsong' || champion.id === 'wardlight') && slot === 'W') {
      const target = aimedAlly;
      if (!target) return;
      const healed = applyHeal(target.unit, (ability.mechanics?.healing ?? 180) + (caster.abilityPower ?? 0) * (ability.mechanics?.apRatio ?? 0.4));
      this.floatingDamage(target.unit.pos, healed, 0x3ad16a, '+');
      effect = { ...effect, heal: 0 };
    } else if (champion.id === 'dawnsong' && slot === 'R') {
      for (const ally of alliesInRange) {
        applyHeal(ally.unit, (ability.mechanics?.healing ?? 180) + (caster.abilityPower ?? 0) * (ability.mechanics?.apRatio ?? 0.4));
        applyArmor(ally.effects, `dawnsong-R:${caster.unit.id}`, ability.mechanics?.armor ?? 20, this.elapsed + (ability.mechanics?.duration ?? 4));
      }
      effect = { ...effect, heal: 0 };
    }
    if (champion.id === 'dawnsong' && slot === 'E') {
      const target = aimedAlly;
      if (!target) return;
      applyShield(target.effects, `dawnsong-E:${caster.unit.id}`, ability.mechanics?.shield ?? 140, this.elapsed + (ability.mechanics?.duration ?? 3));
    } else if (champion.id === 'wardlight' && slot === 'R') {
      for (const ally of alliesInRange) {
        applyShield(ally.effects, `wardlight-R:${caster.unit.id}`, ability.mechanics?.shield ?? 160, this.elapsed + (ability.mechanics?.duration ?? 4));
        applyMovementBuff(ally.effects, `wardlight-R:${caster.unit.id}`, ability.mechanics?.movementPercent ?? 0.15, this.elapsed + (ability.mechanics?.duration ?? 4));
      }
    } else if (champion.id === 'thornwarden' && slot === 'W') {
      applyArmor(caster.effects, `thornwarden-W:${caster.unit.id}`, ability.mechanics?.armor ?? 30, this.elapsed + (ability.mechanics?.duration ?? 3));
      cleanseSlows(caster.effects);
    }

    if (effect.heal > 0) {
      const healed = applyHeal(caster.unit, effect.heal);
      this.floatingDamage(caster.unit.pos, healed, 0x3ad16a, '+');
      this.pulse(caster.container, 0x3ad16a);
    }
    if (effect.buffDuration > 0 && effect.damage === 0 && effect.heal === 0) {
      if (champion.id === 'nightveil' && slot === 'W') {
        this.internalCooldowns.set(`nightveil-smoke:${caster.unit.id}`, this.elapsed + 3);
      }
      if (champion.id === 'ironhold' && slot === 'W') {
        applyShield(caster.effects, 'ironhold-W', caster.unit.maxHp * 0.12, this.elapsed + 3);
      }
      this.pulse(caster.container, color);
    }

    if (champion.id === 'duskarrow' && slot === 'W') {
      this.traps.push({
        id: `trap-${caster.unit.id}-${this.authorityInsertionOrder++}`,
        source: { ...caster.unit, pos: { ...origin } },
        point: { ...endpoint },
        radius: (ability.mechanics?.radius ?? 90) * SCALE,
        rawDamage: abilityDamage(ability.damage, caster.abilityPower ?? 0),
        color,
        expiresAt: this.elapsed + (ability.mechanics?.trapDuration ?? 4),
        slowPercent: ability.mechanics?.slowPercent ?? 0.3,
        slowDuration: ability.mechanics?.duration ?? 2,
      });
      return;
    }

    if (effect.damage > 0) {
      const itemIds = caster === this.player ? this.ownedItems : caster.bot?.ownedItems ?? [];
      const hitRadius = effect.area ? (ability.mechanics?.radius ?? effect.radius) * SCALE : effect.dashes ? 40 : 34;
      const damage = abilityDamage(effect.damage, caster.abilityPower ?? 0);
      const dueAt = effect.dashes
        ? this.elapsed
        : projectileImpactTime(this.elapsed, origin, endpoint, SKILLSHOT_PROJECTILE_SPEED);
      if (effect.area) this.drawAoe(endpoint, hitRadius, color);
      else if (!effect.dashes) {
        this.drawProjectile(origin, endpoint, color, Math.max(1, (dueAt - this.elapsed) * 1000));
      }

      this.pendingImpacts.push({
        dueAt,
        insertionOrder: this.authorityInsertionOrder++,
        source: { ...caster.unit, pos: { ...origin } },
        ...(executeTarget
          ? { targetId: executeTarget.id }
          : ability.mechanics?.lineWidth
            ? {
                line: {
                  origin: { ...origin },
                  endpoint: { ...endpoint },
                  halfWidth: ability.mechanics.lineWidth * SCALE,
                  subsequentDamageMultiplier: ability.mechanics.piercingDamageMultiplier ?? 1,
                },
              }
            : { point: { ...endpoint } }),
        radius: hitRadius,
        rawDamage: damage,
        color,
        stunDuration: effect.stunDuration,
        slowPercent: ability.mechanics?.slowPercent,
        slowDuration: ability.mechanics?.duration,
        pullDuration: ability.mechanics?.pullDuration,
        ability: true,
        ultimate: slot === 'R',
        singleTarget: executeTarget ? true : ability.mechanics?.lineWidth ? false : !effect.area,
        chronoProc: itemIds.includes('chronoCore'),
      });
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
      distance: Phaser.Math.Clamp(distance(source, listener) / (500 * SCALE), 0, 4),
    };
  }

  private resolveCastEndpoint(caster: Entity, ability: Ability, aim: Vec2): Vec2 {
    const origin = caster.unit.pos;
    const range = ability.range * SCALE;
    if (ability.behavior === 'dash' || ability.mechanics?.dash) {
      const blockers = this.structures
        .filter((structure) => !structure.unit.dead)
        .map((structure) => ({ id: structure.unit.id, pos: structure.unit.pos, radius: 52 * SCALE }));
      return resolveDashEndpoint(
        origin,
        aim,
        range,
        { minX: OFF_X, maxX: OFF_X + WORLD_SIZE * SCALE, minY: OFF_Y, maxY: OFF_Y + WORLD_SIZE * SCALE },
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
    return Phaser.Math.Clamp(x, OFF_X, OFF_X + WORLD_SIZE * SCALE);
  }

  private clampY(y: number): number {
    return Phaser.Math.Clamp(y, OFF_Y, OFF_Y + WORLD_SIZE * SCALE);
  }

  private moveUnitToward(u: Unit, goal: Vec2, dt: number) {
    const d = distance(u.pos, goal);
    if (d < 1) return;
    const entity = this.entityForUnit(u);
    if (entity && activePull(entity.effects, this.elapsed)) return;
    const smokeMultiplier = entity?.champion?.id === 'nightveil' &&
      (this.internalCooldowns.get(`nightveil-smoke:${u.id}`) ?? 0) > this.elapsed ? 1.2 : 1;
    const huntingBonus = entity?.champion?.id === 'grimtrail' && this.champions.some(
      (candidate) => areHostile(u.team, candidate.unit.team) && !candidate.unit.dead &&
        candidate.unit.hp / candidate.unit.maxHp < 0.35 && distance(u.pos, candidate.unit.pos) <= 700 * SCALE,
    ) ? 25 * SCALE : 0;
    const effectState = entity?.effects;
    const travel = Math.min(
      d,
      (u.moveSpeed * smokeMultiplier * (1 + (effectState ? strongestMovementBuff(effectState, this.elapsed) : 0)) + huntingBonus) *
        (1 - (effectState ? strongestSlow(effectState, this.elapsed) : 0)) * dt,
    );
    u.pos.x = this.clampX(u.pos.x + ((goal.x - u.pos.x) / d) * travel);
    u.pos.y = this.clampY(u.pos.y + ((goal.y - u.pos.y) / d) * travel);
    const champion = this.entityForUnit(u);
    if (champion === this.player && travel > 0) this.recordLearning('move');
    if (champion?.champion?.id === 'duskarrow' && travel > 0) {
      const key = `duskarrow-distance:${u.id}`;
      this.passiveCounters.set(key, (this.passiveCounters.get(key) ?? 0) + travel / SCALE);
    }
    if (champion?.champion && travel > 0) champion.movedThisFrame = true;
  }

  private advanceChampionLives() {
    for (const entity of this.champions) {
      const previous = entity.life!;
      const next = advanceChampionLife(previous, this.elapsed, this.mode);
      entity.life = next;
      if (!isChampionPresent(next)) {
        entity.unit.dead = true;
        const showingDeathPose =
          entity.championPose === 'death' && this.elapsed < (entity.deathVisibleUntil ?? 0);
        entity.container.setVisible(showingDeathPose);
        entity.shadow?.setVisible(false);
        continue;
      }
      if (!isChampionPresent(previous) && isChampionPresent(next)) {
        const side: MapSide = entity.bot?.side ?? 'ally';
        entity.unit.dead = false;
        entity.unit.hp = entity.unit.maxHp;
        entity.unit.pos = { ...toScreen(BASE_POSITIONS[side]) };
        entity.stunned = 0;
        entity.container.setVisible(true).setAlpha(1);
        entity.shadow?.setVisible(true).setAlpha(0.32);
        if (entity === this.player) this.playerResource = this.playerMaxResource;
        if (entity.bot) {
          entity.bot.resource = entity.bot.maxResource;
          entity.bot.pushIndex = 0;
          entity.bot.currentIntent = 'approach';
          entity.bot.pendingIntent = null;
          entity.bot.intentReadyAt = this.elapsed;
          entity.bot.nextDecisionAt = this.elapsed;
        }
        entity.poseLockedUntil = 0;
        entity.posePriority = 0;
        entity.deathVisibleUntil = undefined;
        this.setChampionPose(entity, 'idle');
        this.targetByEntityId.delete(entity.unit.id);
      }
    }
  }

  private reviveInhibitors() {
    for (const [id, killedAt] of [...this.inhibitorKillTimes]) {
      if (!isInhibitorAlive(this.elapsed, killedAt, this.mode)) continue;
      const inhibitor = this.structureById.get(id);
      if (inhibitor) {
        inhibitor.unit.dead = false;
        inhibitor.unit.hp = inhibitor.unit.maxHp;
        inhibitor.container.setVisible(true).setAlpha(1);
        inhibitor.shadow?.setVisible(true).setAlpha(0.32);
      }
      this.inhibitorKillTimes.delete(id);
    }
  }

  private applyTeamChampionStats(side: MapSide) {
    for (const champion of this.champions) {
      const championSide: MapSide = champion.bot?.side ?? 'ally';
      if (championSide === side) this.applyChampionStats(champion, side);
    }
  }

  private tickTraps(): void {
    const active: TrapRuntime[] = [];
    for (const trap of this.traps.sort((a, b) => a.id.localeCompare(b.id))) {
      if (trap.expiresAt <= this.elapsed) continue;
      const target = this.allEntities
        .filter(
          (candidate) =>
            candidate.unit.kind !== 'turret' &&
            candidate.unit.kind !== 'nexus' &&
            this.canDamageTarget(trap.source, candidate) &&
            distance(candidate.unit.pos, trap.point) <= trap.radius,
        )
        .sort((a, b) => distance(a.unit.pos, trap.point) - distance(b.unit.pos, trap.point) || a.unit.id.localeCompare(b.unit.id))[0];
      if (!target) {
        active.push(trap);
        continue;
      }
      this.applyTargetedDamage(trap.source, target, trap.rawDamage, trap.color, {
        ability: true,
        slowPercent: trap.slowPercent,
        slowDuration: trap.slowDuration,
      });
    }
    this.traps = active;
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
    const pos = toScreen(pit.pos);
    const unit = this.makeUnit(`objective-${id}-${Math.round(this.elapsed * 1000)}`, 'monster', 'neutral', pos, {
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
    const center = toScreen(camp.pos);
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
      const spread = camp.members.length === 1 ? 0 : 42 * SCALE;
      const pos = {
        x: center.x + Math.cos(angle) * spread,
        y: center.y + Math.sin(angle) * spread,
      };
      const unit = this.makeUnit(`camp-${camp.id}-${member.key}`, 'monster', 'neutral', pos, {
        maxHp: member.hp,
        ad: member.ad,
        armor: member.armor,
        attackRange: 160 * SCALE,
        attackSpeed: 0.7,
        moveSpeed: 260 * SCALE,
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
    const center = toScreen(runtime.camp.pos);
    const index = Math.max(0, runtime.camp.members.findIndex((candidate) => candidate.key === member.campMemberKey));
    const angle = runtime.camp.members.length === 1 ? 0 : (Math.PI * 2 * index) / runtime.camp.members.length;
    const spread = runtime.camp.members.length === 1 ? 0 : 42 * SCALE;
    return { x: center.x + Math.cos(angle) * spread, y: center.y + Math.sin(angle) * spread };
  }

  private updateJungleCamps(dt: number) {
    for (const runtime of this.camps) {
      for (const campEntity of runtime.members) {
        if (campEntity.unit.dead || campEntity.stunned > 0) continue;
        const home = this.campMemberHome(runtime, campEntity);
        const target = this.findTarget(campEntity.unit, 420 * SCALE);
        if (target && distance(target.pos, toScreen(runtime.camp.pos)) <= 620 * SCALE) {
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
      if (!objective || objective.unit.dead || objective.stunned > 0) continue;
      const target = this.findTarget(
        objective.unit,
        Math.min(OBJECTIVE_ATTACK_RANGE, OBJECTIVE_LEASH_RANGE),
      );
      if (target && canBasicAttack(objective.unit)) {
        const dueAt = this.queueTargetedImpact(
          objective,
          target,
          objective.unit.ad,
          0xe8b84d,
          BASIC_PROJECTILE_SPEED,
        );
        this.drawProjectile(
          objective.unit.pos,
          target.pos,
          0xe8b84d,
          Math.max(1, (dueAt - this.elapsed) * 1000),
        );
        resetAttackCooldown(objective.unit);
      }
    }
  }

  private queueTargetedImpact(
    source: Entity,
    target: Unit,
    rawDamage: number,
    color: number,
    speed: number,
  ): number {
    const dueAt = projectileImpactTime(this.elapsed, source.unit.pos, target.pos, speed);
    this.pendingImpacts.push({
      dueAt,
      insertionOrder: this.authorityInsertionOrder++,
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
    const partitioned = partitionImpacts(this.pendingImpacts, this.elapsed);
    this.pendingImpacts = partitioned.pending;
    for (const impact of partitioned.due.sort((a, b) => a.dueAt - b.dueAt || a.insertionOrder - b.insertionOrder)) {
      const source = impact.source;
      if (impact.targetId) {
        const target = this.entityById.get(impact.targetId);
        if (target && this.canDamageTarget(source, target)) {
          this.applyTargetedDamage(source, target, impact.rawDamage, impact.color, {
            ability: impact.ability,
            ultimate: impact.ultimate,
            stunDuration: impact.stunDuration,
            slowPercent: impact.slowPercent,
            slowDuration: impact.slowDuration,
            pullDuration: impact.pullDuration,
          });
        }
        continue;
      }
      if (impact.line) {
        const line = impact.line;
        const struck = targetsIntersectingLine(
          line.origin,
          line.endpoint,
          line.halfWidth,
          this.allEntities
            .filter((target) => this.canDamageTarget(source, target))
            .map((entity) => ({ id: entity.unit.id, pos: entity.unit.pos, entity })),
        );
        struck.forEach(({ entity }, index) => {
          this.applyTargetedDamage(
            source,
            entity,
            impact.rawDamage * (index === 0 ? 1 : line.subsequentDamageMultiplier),
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
        });
        if (impact.chronoProc && struck.length > 0) {
          const caster = this.entityById.get(source.id);
          const cds = caster === this.player ? this.playerCds : caster?.bot?.cds;
          if (cds) tickCooldowns(cds, 0.5);
        }
        continue;
      }
      if (!impact.point) continue;
      const targets = this.allEntities
        .filter(
          (target) =>
            this.canDamageTarget(source, target) &&
            distance(target.unit.pos, impact.point!) <= impact.radius,
        )
        .sort(
          (a, b) =>
            distance(a.unit.pos, impact.point!) - distance(b.unit.pos, impact.point!) ||
            a.unit.id.localeCompare(b.unit.id),
        );
      const struck = impact.singleTarget ? targets.slice(0, 1) : targets;
      for (const target of struck) {
        this.applyTargetedDamage(source, target, impact.rawDamage, impact.color, {
          ability: impact.ability,
          ultimate: impact.ultimate,
          stunDuration: impact.stunDuration,
          slowPercent: impact.slowPercent,
          slowDuration: impact.slowDuration,
          pullDuration: impact.pullDuration,
        });
      }
      if (impact.chronoProc && struck.length > 0) {
        const caster = this.entityById.get(source.id);
        const cds = caster === this.player ? this.playerCds : caster?.bot?.cds;
        if (cds) tickCooldowns(cds, 0.5);
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
    return entity.life ? isChampionDamageable(entity.life) : true;
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
    const result = applyDamageWithEffects(target.unit, target.effects, rawDamage, this.elapsed);
    const sourceEntity = this.entityById.get(sourceUnit.id);
    if (options.ability && !options.periodic && sourceEntity?.champion?.id === 'embermage' && !result.lethal) {
      const burnTotal = 25 + (sourceEntity.abilityPower ?? 0) * 0.1;
      applyBurn(target.effects, sourceUnit.id, burnTotal / 3, this.elapsed + 3);
    }
    if (
      options.ability && sourceEntity?.champion?.id === 'frostquill' &&
      (options.stunDuration ?? 0) === 0 && !result.lethal
    ) applySlow(target.effects, `frostquill:${sourceUnit.id}`, 0.2, this.elapsed + 1.5);
    if ((options.slowPercent ?? 0) > 0 && !result.lethal) {
      applySlow(target.effects, `ability:${sourceUnit.id}`, options.slowPercent!, this.elapsed + (options.slowDuration ?? 0));
    }
    if ((options.pullDuration ?? 0) > 0 && !result.lethal) {
      applyPull(
        target.effects,
        `ability:${sourceUnit.id}`,
        sourceUnit.pos,
        600 * SCALE,
        this.elapsed + options.pullDuration!,
      );
    }
    const sourceBuffs = sourceEntity === this.player ? this.playerBuffs : sourceEntity?.bot?.buffs;
    if (
      !options.ability && sourceBuffs?.buffs.some((buff) => buff.kind === 'red') && !result.lethal
    ) applySlow(target.effects, `red-buff:${sourceUnit.id}`, 0.2, this.elapsed + 2);

    const targetItems = target === this.player ? this.ownedItems : target.bot?.ownedItems ?? [];
    const hpPctAfter = target.unit.maxHp > 0 ? target.unit.hp / target.unit.maxHp : 0;
    const aegisKey = `aegis:${target.unit.id}`;
    if (
      targetItems.includes('aegisColossus') && hpPctBefore > 0.3 && hpPctAfter <= 0.3 &&
      (this.internalCooldowns.get(aegisKey) ?? 0) <= this.elapsed && !result.lethal
    ) {
      applyShield(target.effects, 'aegisColossus', 200, this.elapsed + 4);
      this.internalCooldowns.set(aegisKey, this.elapsed + 45);
    }
    const ironholdKey = `ironhold-passive:${target.unit.id}`;
    if (
      target.champion?.id === 'ironhold' && hpPctBefore > 0.35 && hpPctAfter <= 0.35 &&
      (this.internalCooldowns.get(ironholdKey) ?? 0) <= this.elapsed && !result.lethal
    ) {
      applyArmor(target.effects, ironholdKey, 25, this.elapsed + 3);
      this.internalCooldowns.set(ironholdKey, this.elapsed + 12);
    }
    if (target.champion?.id === 'nightveil' && result.dealt > 0) {
      this.internalCooldowns.set(`nightveil-smoke:${target.unit.id}`, 0);
    }
    if (
      !options.ability && target.champion?.id === 'thornwarden' && sourceEntity &&
      sourceEntity.unit.kind === 'champion' && !sourceEntity.unit.dead
    ) {
      const reflectKey = `thorn-reflect:${target.unit.id}:${sourceUnit.id}`;
      if ((this.internalCooldowns.get(reflectKey) ?? 0) <= this.elapsed) {
        this.internalCooldowns.set(reflectKey, this.elapsed + 1);
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

    if (targetEntity?.life) {
      const level = targetEntity === this.player
        ? this.playerProgress.level
        : targetEntity.bot?.progress.level ?? 1;
      targetEntity.life = killChampion(targetEntity.life, this.elapsed, level, this.mode);
      if (targetEntity.champion?.id === 'duskarrow') this.passiveCounters.set(`duskarrow-distance:${target.id}`, 0);
      if (targetEntity === this.player) this.playerDeaths += 1;
      if (sourceSide) {
        this.teamFacts[sourceSide].championKills += 1;
        this.awardBounty(sourceEntity, CHAMPION_TAKEDOWN_BOUNTY);
      }
      if (source.id === 'player') this.stats.championKills += 1;
    } else if (target.kind === 'minion') {
      const type = (targetEntity?.minionType ?? 'melee') as MinionType;
      this.awardBounty(sourceEntity, minionBounty(type));
      if (source.id === 'player') this.stats.minionKills += 1;
    } else if (target.kind === 'turret' || target.kind === 'nexus') {
      const node = targetEntity?.node;
      const bountyKind = node?.kind === 'inhibitor'
        ? 'inhibitor'
        : node?.kind === 'nexus'
          ? 'nexus'
          : 'turret';
      this.awardBounty(sourceEntity, structureBounty(bountyKind));
      if (node?.kind === 'inhibitor') this.inhibitorKillTimes.set(target.id, this.elapsed);
      if (source.id === 'player' && node?.kind.endsWith('Turret')) this.recordLearning('destroy-turret');
    } else if (target.kind === 'monster' && targetEntity?.campId) {
      const runtime = this.camps.find((candidate) => candidate.camp.id === targetEntity.campId);
      if (runtime) {
        runtime.members = runtime.members.filter((member) => member !== targetEntity && !member.unit.dead);
        if (runtime.members.length === 0) {
          this.awardBounty(sourceEntity, runtime.camp.bounty);
          runtime.nextSpawnAt = this.elapsed + runtime.camp.respawnSeconds;
          if (runtime.camp.type === 'blue' || runtime.camp.type === 'red') {
            const buffs = sourceEntity === this.player ? this.playerBuffs : sourceEntity?.bot?.buffs;
            if (buffs) applyBuff(buffs, runtime.camp.type, this.elapsed);
          }
        }
      }
    } else if (target.kind === 'monster' && targetEntity?.objectiveId && sourceSide) {
      const objectiveId = targetEntity.objectiveId;
      this.awardBounty(sourceEntity, monsterStats(objectiveId).bounty);
      this.teamFacts[sourceSide].epicMonstersKilled += 1;
      this.teamFacts[sourceSide].objectivePoints += objectiveId === 'dragon' ? 1 : objectiveId === 'herald' ? 2 : 3;
      const runtime = this.objectives.find((objective) => objective.id === objectiveId);
      if (runtime) {
        runtime.entity = null;
        if (objectiveId === 'herald') runtime.permanentlyGone = true;
        else runtime.nextSpawnAt = this.elapsed + this.rules.objectives.respawnSeconds;
      }
      if (objectiveId === 'dragon') {
        if (sourceSide === 'ally') this.allyDragonStacks += 1;
        else this.enemyDragonStacks += 1;
        this.applyTeamChampionStats(sourceSide);
      } else if (objectiveId === 'baron') {
        if (sourceSide === 'ally') this.allyBaron = applyBaronBuff(this.elapsed);
        else this.enemyBaron = applyBaronBuff(this.elapsed);
        this.applyTeamChampionStats(sourceSide);
      } else {
        const reward = heraldReward();
        this.wardenCharge[sourceSide] = {
          acquiredAt: this.elapsed,
          expiresAt: this.elapsed + reward.durationSeconds,
        };
      }
    }

    if (sourceEntity === this.player) this.applyChampionStats(this.player, 'ally');
    else if (sourceEntity?.bot) this.applyChampionStats(sourceEntity, sourceEntity.bot.side);
  }

  private awardBounty(entity: Entity | undefined, bounty: { gold: number; xp: number }) {
    if (!entity || entity.unit.kind !== 'champion') return;
    const progress = entity === this.player ? this.playerProgress : entity.bot?.progress;
    if (!progress) return;
    addGold(progress, bounty.gold);
    const xp = addXp(progress, bounty.xp);
    const side: MapSide = entity.bot?.side ?? 'ally';
    this.teamFacts[side].totalGoldEarned += bounty.gold;
    if (entity === this.player) this.playerTotalGoldEarned += bounty.gold;
    else if (entity.bot) entity.bot.totalGoldEarned += bounty.gold;
    if (xp.leveled) {
      if (entity === this.player) this.recordLearning('level-up');
      this.floatingDamage(entity.unit.pos, xp.newLevel, 0xffd45c, 'LV ');
      this.pulse(entity.container, 0xffd45c);
    }
  }

  private wardenTargets(sourceSide: MapSide): Entity[] {
    const livingIds = new Set(
      this.structures.filter((structure) => !structure.unit.dead).map((structure) => structure.unit.id),
    );
    return this.structures
      .filter(
        (structure) =>
          structure.unit.team !== sourceSide &&
          !structure.unit.dead &&
          isStructureTargetable(structure.unit.id, livingIds, this.mode),
      )
      .sort(
        (a, b) =>
          distance(a.unit.pos, toScreen(BASE_POSITIONS[sourceSide])) -
            distance(b.unit.pos, toScreen(BASE_POSITIONS[sourceSide])) ||
          a.unit.id.localeCompare(b.unit.id),
      );
  }

  private tickHeldWardenPolicy(): void {
    for (const side of ['ally', 'enemy'] as MapSide[]) {
      const charge = this.wardenCharge[side];
      if (charge && this.elapsed >= charge.expiresAt) this.wardenCharge[side] = null;
    }
    const charge = this.wardenCharge.enemy;
    const targets = this.wardenTargets('enemy');
    const target = targets[0];
    const hasSiegePressure = Boolean(target && [...this.champions, ...this.minions].some(
      (entity) =>
        !entity.unit.dead &&
        entity.unit.team === 'enemy' &&
        distance(entity.unit.pos, target.unit.pos) <= 650 * SCALE,
    ));
    if (shouldDeployHeldWarden({
      now: this.elapsed,
      charge,
      hasValidTarget: targets.length > 0,
      hasSiegePressure,
    })) this.useWardenCharge('enemy', target);
  }

  private useWardenCharge(sourceSide: MapSide, chosenTarget?: Entity) {
    const charge = this.wardenCharge[sourceSide];
    if (!charge || charge.expiresAt <= this.elapsed) {
      this.wardenCharge[sourceSide] = null;
      return;
    }
    const source = sourceSide === 'ally' ? this.player.unit : this.enemy.unit;
    const reward = heraldReward();
    const targets = this.wardenTargets(sourceSide);
    const target = chosenTarget && targets.includes(chosenTarget) ? chosenTarget : targets[0];
    if (!target) return;
    this.wardenCharge[sourceSide] = null;
    const result = applyDamageWithEffects(target.unit, target.effects, reward.structureDamage, this.elapsed);
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
    const currentId = this.targetByEntityId.get(u.id) ?? null;
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
    if (acquired) this.targetByEntityId.set(u.id, acquired.id);
    else this.targetByEntityId.delete(u.id);
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
        e.body.setFrame(frameForPose('move', this.elapsed));
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
        this.targetByEntityId.delete(e.unit.id);
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
        if (lethal) target.deathVisibleUntil = this.elapsed + CHAMPION_DEATH_POSE_MS / 1000;
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
        const killedAt = this.inhibitorKillTimes.get(s.node.id) ?? null;
        if (isInhibitorAlive(this.elapsed, killedAt) && !s.unit.dead) inhibitors += 1;
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
        x: Phaser.Math.Clamp((e.unit.pos.x - OFF_X) / (WORLD_SIZE * SCALE), 0, 1),
        y: Phaser.Math.Clamp((e.unit.pos.y - OFF_Y) / (WORLD_SIZE * SCALE), 0, 1),
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
      lifecycle: this.ended ? 'ended' : this.pauseReasons.size > 0 ? 'paused' : 'running',
      pauseReasons: [...this.pauseReasons],
      playerChampionId: this.playerChampion.id,
      enemyChampionId: this.enemyChampion.id,
      playerHp: Math.round(this.player.unit.hp),
      playerMaxHp: Math.round(this.player.unit.maxHp),
      playerResource: Math.round(this.playerResource),
      playerMaxResource: Math.round(this.playerMaxResource),
      enemyHp: Math.round(this.enemy.unit.hp),
      enemyMaxHp: Math.round(this.enemy.unit.maxHp),
      allyNexusPct: this.allyNexus ? this.allyNexus.unit.hp / this.allyNexus.unit.maxHp : 1,
      enemyNexusPct: this.enemyNexus ? this.enemyNexus.unit.hp / this.enemyNexus.unit.maxHp : 1,
      elapsed: this.elapsed,
      gold: Math.floor(this.playerProgress.gold),
      level: this.playerProgress.level,
      xpPct,
      xpCapped: this.playerProgress.level >= 18,
      shopAvailable: this.inBase(this.player.unit, 'ally') && this.pauseReasons.size === 0,
      ownedItems: [...this.ownedItems],
      buffs: [
        ...this.playerBuffs.buffs.map((b) => ({
          kind: b.kind as string,
          remaining: Math.ceil(b.expiresAt - this.elapsed),
        })),
        ...(this.allyBaron.active
          ? [{ kind: 'baron', remaining: Math.ceil(this.allyBaron.expiresAt - this.elapsed) }]
          : []),
      ],
      camps: this.camps.map((runtime) => ({
        id: runtime.camp.id,
        type: runtime.camp.type,
        side: runtime.camp.side,
        alive: runtime.members.length > 0,
        membersAlive: runtime.members.filter((member) => !member.unit.dead).length,
        membersTotal: runtime.camp.members.length,
        respawnsIn: runtime.members.length > 0 ? 0 : Math.max(0, Math.ceil(runtime.nextSpawnAt - this.elapsed)),
      })),
      objectives: this.buildObjectives(),
      ...(this.armedAbility ? { aimingSlot: this.armedAbility } : {}),
      dragonStacks: this.allyDragonStacks,
      objectivePoints: this.teamFacts.ally.objectivePoints,
      wardenChargeSeconds: Math.max(
        0,
        Math.ceil((this.wardenCharge.ally?.expiresAt ?? this.elapsed) - this.elapsed),
      ),
      playerLife: {
        phase: this.player.life!.phase,
        deaths: this.playerDeaths,
        respawnSeconds:
          this.player.life!.phase === 'dead' || this.player.life!.phase === 'respawning'
            ? Math.round(championLifeTimerRemaining(this.player.life!, this.elapsed) * 10) / 10
            : 0,
        invulnerableSeconds:
          this.player.life!.phase === 'invulnerable'
            ? Math.round(championLifeTimerRemaining(this.player.life!, this.elapsed) * 10) / 10
            : 0,
      },
      matchStatus: {
        phase: matchPhaseAt(this.elapsed, this.mode),
        suddenDeath: matchPhaseAt(this.elapsed, this.mode) === 'sudden-death',
        hardCapSecondsRemaining: Math.max(0, Math.ceil(this.rules.hardCapSeconds - this.elapsed)),
      },
      recall: {
        channeling: this.recallStartedAt !== null,
        remaining: this.recallStartedAt === null ? 0 : Math.max(0, Math.round((6 - (this.elapsed - this.recallStartedAt)) * 10) / 10),
        ...(this.recallCancellation ? { cancellation: this.recallCancellation } : {}),
      },
      ...(this.matchKind === 'tutorial' ? {
        learning: {
          current: currentLearningStep(this.learning)?.id,
          completed: this.learning.completed.length,
          total: LEARNING_STEPS.length,
        },
      } : {}),
      currentTargetId: this.targetByEntityId.get(this.player.unit.id),
      ...(this.lastPurchaseFeedback ? { purchaseFeedback: this.lastPurchaseFeedback } : {}),
      allyStructures: this.structureStatus('ally'),
      enemyStructures: this.structureStatus('enemy'),
      minimap: this.buildMinimap(),
      abilities: slots.map((slot) => {
        const total = this.cooldownFor(this.player, this.playerChampion, slot);
        const remaining = this.playerCds[slot];
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
          : Math.max(0, Math.ceil(runtime.nextSpawnAt - this.elapsed)),
    }));
  }

  private xpProgressPct(): number {
    // Approximate progress toward the next level from banked xp.
    const p = this.playerProgress;
    if (p.level >= 18) return 1;
    // economy.addXp already consumed thresholds; xp holds remainder toward next.
    const need = 280 + (p.level - 1) * 100;
    return Math.min(1, Math.max(0, p.xp / need));
  }

  private checkWinLose() {
    if (this.ended) return;
    const resolution = resolveMatch(
      {
        elapsedSeconds: this.elapsed,
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
    const facts = this.teamFacts[side];
    return {
      nexusHp: nexus?.unit.hp ?? 0,
      nexusMaxHp: nexus?.unit.maxHp ?? NEXUS_HP,
      structuresStanding: structures.filter((structure) => !structure.unit.dead).length,
      structuresTotal: this.mode === 'conquest' ? 9 : 3,
      championKills: facts.championKills,
      objectivePoints: facts.objectivePoints,
      gold: facts.totalGoldEarned,
    };
  }

  private endGame(resolution: MatchResolution) {
    const result = resolution.winner === 'ally' ? 'win' : resolution.winner === 'enemy' ? 'loss' : 'draw';
    this.recordLearning('victory-condition');
    this.ended = true;
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
      totalGoldEarned: Math.floor(this.playerTotalGoldEarned),
      objectives: this.teamFacts.ally.epicMonstersKilled,
      objectivePoints: this.teamFacts.ally.objectivePoints,
      ownedItems: [...this.ownedItems],
      endReason: resolution.reason!,
      learningRequirementsCompleted: learningRequirementsCompleted(this.learning),
      stats: {
        durationSeconds: Math.min(this.rules.hardCapSeconds, Math.round(this.elapsed)),
        championKills: this.stats.championKills,
        minionKills: this.stats.minionKills,
        damageDealt: Math.round(this.stats.damageDealt),
        level: this.playerProgress.level,
        gold: Math.floor(this.playerProgress.gold),
      },
    };
    this.time.delayedCall(400, () => this.onGameEnd(outcome));
  }

  private endAbandoned() {
    if (this.ended) return;
    this.ended = true;
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
        durationSeconds: Math.round(this.elapsed),
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
