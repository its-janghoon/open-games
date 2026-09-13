/** Authoritative Arc Guardian movement, combat, charge, input, and viewport tuning. */
export const MOVEMENT = {
  MAX_HP: 100,
  MOVE_SPEED: 200,
  MOVE_ACCEL: 2600,
  MOVE_FRICTION: 2400,
  BODY_WIDTH: 24,
  BODY_HEIGHT: 32,
  BODY_OFFSET_X: 4,
  BODY_OFFSET_Y: 0,
  MAX_H_SPEED: 640,
  MAX_V_SPEED: 640,
} as const;

export const HERO_COMBAT = {
  INVULN_MS: 800,
  HIT_KNOCKBACK: 240,
  HURT_MS: 260,
  DAMAGE_FEEDBACK_MS: 120,
  DAMAGE_OUTLINE_WIDTH: 2,
} as const;

export const SLASH = {
  DAMAGE: 34,
  REACH: 48,
  HALF_WIDTH: 22,
  COOLDOWN_MS: 300,
  AIM_EPSILON: 1,
  HIT_STOP_NORMAL_MS: 35,
  HIT_STOP_CRITICAL_MS: 60,
  HIT_STOP_KILL_MS: 90,
  VISUAL_MS: 100,
} as const;

export const BLADE_FX = {
  TEXTURE_SIZE: 24,
  TARGET_LENGTH: SLASH.REACH,
  CROSS_SCALE: (SLASH.HALF_WIDTH * 2) / 24,
} as const;

export const AIR = {
  ACCEL: 900,
  MAX_INPUT_SPEED: 220,
  DRAG: 0.5,
  SWING_STEER_ACCEL: 520,
  FLING_SPEED_THRESHOLD: 205,
} as const;

export const GRAPPLE = {
  RANGE: 4000,
  MAX_LENGTH: 4000,
  MIN_LENGTH: 24,
  HOOK_TRAVEL_SPEED: 1400,
  REEL_IN_SPEED: 190,
  REEL_OUT_SPEED: 160,
  CONSTRAINT_STIFFNESS: 1,
  SWING_DAMPING: 0.12,
  PULL_ACCEL: 520,
  RELEASE_VELOCITY_KEEP: 1,
  RELEASE_RADIAL_BOOST: 70,
  WIRE_THICKNESS: 1,
  WIRE_COLOR: 0xdfe6ef,
  /** Aim-preview ring: where the hook would anchor for the current aim. */
  PREVIEW_COLOR: 0x9fd8ff,
  /** Brighter ring when the aim would snap to an enemy cooling NODE. */
  PREVIEW_NODE_COLOR: 0x59e6ff,
  PREVIEW_RADIUS: 6,
  ANCHOR_RADIUS: 2,
  NODE_ANCHOR_SNAP_DIST: 34,
  NODE_PULL_ACCEL: 1150,
  NODE_MIN_LENGTH: 40,
  NODE_REEL_SPEED: 320,
} as const;

export const DASH = { IMPULSE: 480, DURATION_MS: 150, COOLDOWN_MS: 420 } as const;

export const GAS = {
  MAX: 100,
  START: 100,
  COST_GRAPPLE_FIRE: 8,
  COST_REEL_PER_SEC: 14,
  COST_SWING_PER_SEC: 4,
  COST_DASH: 18,
  REGEN_GROUNDED_PER_SEC: 55,
  REGEN_AIRBORNE_PER_SEC: 26,
  REGEN_DELAY_MS: 350,
} as const;

export const CAMERA = {
  LERP_X: 0.12,
  LERP_Y: 0.12,
  DEADZONE_W: 140,
  DEADZONE_H: 100,
  CENTER_BIAS: 0.4,
  CENTER_BIAS_MAX: 190,
} as const;

export const ARENA = { WIDTH: 1280, HEIGHT: 1280, CENTER_X: 640, CENTER_Y: 640 } as const;

export const INPUT = {
  GAMEPAD_DEFAULT_DEADZONE: 0.18,
  GAMEPAD_MIN_DEADZONE: 0.1,
  GAMEPAD_MAX_DEADZONE: 0.35,
  BROWSER_BLOCKED_KEYS: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '] as readonly string[],
} as const;

export const HERO_FRAMES = {
  IDLE: 0,
  RUN_A: 1,
  RUN_B: 2,
  TETHER_FIRE: 3,
  SWING: 4,
  SLASH: 5,
  HURT: 6,
} as const;

export const HERO_ANIMS = {
  IDLE: 'hero_idle',
  RUN: 'hero_run',
  DASH: 'hero_dash',
  SWING: 'hero_swing',
  SLASH: 'hero_slash',
  HURT: 'hero_hurt',
} as const;
