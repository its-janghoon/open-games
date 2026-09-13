/**
 * Pre-generated PIXEL-ART SPRITESHEETS.
 *
 * champs used to draw every unit at runtime by rasterizing inline SVG through
 * {@link SpriteFactory} - the only game in this repo with no authored art. The
 * sheets described here are produced by `tools/gen_sprites.py` (Pillow, checked
 * into `public/assets/sprites/`) and loaded by the battle scene, which is what
 * the units on the lane are drawn from now.
 *
 * `SpriteFactory` is deliberately LEFT IN PLACE for markers and VFX: it owns a
 * pose/readiness/cache contract those call sites and its tests depend on, and
 * nothing is gained by pushing procedural one-off VFX through an atlas.
 *
 * Pure module: no Phaser import, so it stays unit-testable.
 */
import type { ChampionPose, SpriteTeam } from './svgArt';

/** Frame order inside every animated sheet, matching gen_sprites.py. */
export const FRAME_IDLE = 0;
export const FRAME_RUN_A = 1;
export const FRAME_RUN_B = 2;
export const FRAME_ATTACK = 3;
export const FRAME_HURT = 4;

/** Emitted frame geometry, per entity class. */
export const CHAMPION_FRAME = { width: 64, height: 56 } as const;
export const MINION_FRAME = { width: 28, height: 24 } as const;
export const STRUCTURE_FRAME = { width: 32, height: 48 } as const;

/**
 * Ground-contact row within a frame, as a fraction of frame height. The art is
 * authored with the body bottom near the lower edge; the billboard is anchored
 * here so a unit stands on the floor instead of floating.
 */
/*
 * Champion bodies are authored with their base near y=34 in the nominal art
 * space and offset down by ART_OY=12, so the feet land at ~46 of a 56px frame.
 * The extra headroom above exists for weapons that swing UP on the ATTACK frame
 * (hammer, flail, lance, missile pod) - without it they clipped the frame top.
 */
export const CHAMPION_FOOT_FRAC = 0.83;
export const MINION_FOOT_FRAC = 0.94;
export const STRUCTURE_FOOT_FRAC = 0.98;

/** Every champion id that has an authored sheet. */
export const SHEET_CHAMPIONS = [
  'ashborne', 'nightveil', 'ironhold', 'embermage', 'dawnsong',
  'thornwarden', 'grimtrail', 'frostquill', 'duskarrow', 'wardlight',
] as const;

/** Role-generic fallbacks for ids with no bespoke sheet. */
export const SHEET_GENERIC_ROLES = [
  'marksman', 'assassin', 'bruiser', 'mage', 'enchanter',
] as const;

export const SHEET_MINIONS = ['melee', 'ranged', 'siege'] as const;
export const SHEET_STRUCTURES = ['turret', 'inhibitor', 'nexus'] as const;

/** Neutral jungle camp + objective markers. Neutral, so no team variant. */
export const SHEET_MARKERS = ['jungle', 'dragon', 'baron', 'herald'] as const;
export const MARKER_FRAME = { width: 32, height: 32 } as const;
export const MARKER_FOOT_FRAC = 0.94;

/**
 * VFX sheets are authored in WHITE and TINTED at runtime with each ability's
 * colour. Baking one sheet per (kind x colour) would multiply out for nothing:
 * the shape carries the meaning, the colour is data the scene already has.
 */
export const SHEET_VFX = [
  'projectile', 'beam', 'aoeRing', 'castFlare',
  'impact', 'heal', 'stun', 'death',
] as const;
export const VFX_FRAME = { width: 24, height: 24 } as const;

export function markerSheetKey(variant: string): string {
  return `sheet-marker-${variant}`;
}

export function vfxSheetKey(kind: string): string {
  return `sheet-vfx-${kind}`;
}

const TEAMS: readonly SpriteTeam[] = ['ally', 'enemy'];

export interface SheetDescriptor {
  key: string;
  url: string;
  frameWidth: number;
  frameHeight: number;
}

/** Texture key for a champion sheet. `id` may be a roster id or `generic-<role>`. */
export function championSheetKey(id: string, team: SpriteTeam): string {
  return `sheet-champion-${id}-${team}`;
}

export function minionSheetKey(type: string, team: SpriteTeam): string {
  return `sheet-minion-${type}-${team}`;
}

export function structureSheetKey(tier: string, team: SpriteTeam): string {
  return `sheet-structure-${tier}-${team}`;
}

/**
 * Resolve a roster id to the sheet id that actually exists, so an unknown or
 * `generic-<role>` identity lands on the role-generic sheet rather than a
 * missing texture.
 */
export function resolveChampionSheetId(
  championId: string | undefined,
  role: string,
): string {
  if (championId && (SHEET_CHAMPIONS as readonly string[]).includes(championId)) {
    return championId;
  }
  return `generic-${(SHEET_GENERIC_ROLES as readonly string[]).includes(role) ? role : 'bruiser'}`;
}

/** The full load manifest - every sheet, both teams. */
export function sheetManifest(): SheetDescriptor[] {
  const out: SheetDescriptor[] = [];
  for (const team of TEAMS) {
    for (const id of SHEET_CHAMPIONS) {
      out.push({
        key: championSheetKey(id, team),
        url: `assets/sprites/champion_${id}_${team}.png`,
        frameWidth: CHAMPION_FRAME.width,
        frameHeight: CHAMPION_FRAME.height,
      });
    }
    for (const role of SHEET_GENERIC_ROLES) {
      out.push({
        key: championSheetKey(`generic-${role}`, team),
        url: `assets/sprites/champion_generic-${role}_${team}.png`,
        frameWidth: CHAMPION_FRAME.width,
        frameHeight: CHAMPION_FRAME.height,
      });
    }
    for (const type of SHEET_MINIONS) {
      out.push({
        key: minionSheetKey(type, team),
        url: `assets/sprites/minion_${type}_${team}.png`,
        frameWidth: MINION_FRAME.width,
        frameHeight: MINION_FRAME.height,
      });
    }
    for (const tier of SHEET_STRUCTURES) {
      out.push({
        key: structureSheetKey(tier, team),
        url: `assets/sprites/structure_${tier}_${team}.png`,
        frameWidth: STRUCTURE_FRAME.width,
        frameHeight: STRUCTURE_FRAME.height,
      });
    }
  }
  // Neutral markers and tintable VFX sit outside the team loop.
  for (const variant of SHEET_MARKERS) {
    out.push({
      key: markerSheetKey(variant),
      url: `assets/sprites/marker_${variant}.png`,
      frameWidth: MARKER_FRAME.width,
      frameHeight: MARKER_FRAME.height,
    });
  }
  for (const kind of SHEET_VFX) {
    out.push({
      key: vfxSheetKey(kind),
      url: `assets/sprites/vfx_${kind}.png`,
      frameWidth: VFX_FRAME.width,
      frameHeight: VFX_FRAME.height,
    });
  }
  return out;
}

/** Cadence of the two-frame walk cycle, in alternations per second. */
export const RUN_CYCLE_HZ = 6;

/**
 * Map a gameplay pose to a frame index.
 *
 * `move` is the only pose that animates: it alternates RUN_A/RUN_B on
 * {@link RUN_CYCLE_HZ} using the scene clock, which is what reads as walking.
 * Casts share the ATTACK frame (the weapon is extended either way) and `death`
 * shares HURT, keeping the sheet at five frames instead of one per pose.
 */
export function frameForPose(pose: ChampionPose | undefined, elapsedSeconds: number): number {
  switch (pose) {
    case 'move': {
      const phase = Math.floor(elapsedSeconds * RUN_CYCLE_HZ) % 2;
      return phase === 0 ? FRAME_RUN_A : FRAME_RUN_B;
    }
    case 'attack':
    case 'castQ':
    case 'castW':
    case 'castE':
    case 'castR':
      return FRAME_ATTACK;
    case 'hit':
    case 'death':
      return FRAME_HURT;
    case 'idle':
    default:
      return FRAME_IDLE;
  }
}
