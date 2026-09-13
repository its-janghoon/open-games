/**
 * Pure, Phaser-free SVG ART builders for the battle renderer.
 *
 * The project ships ZERO binary art assets. Instead of drawing chunky pixel
 * blocks (the old approach), each in-canvas entity is now authored as REAL
 * illustrated vector art expressed as an SVG MARKUP STRING. These strings are
 * later rasterized ONCE to a cached Phaser texture by {@link ./sprites}, but
 * the string-building here has NO Phaser dependency at all, so it can be unit
 * tested directly (see svgArt.test.ts).
 *
 * Every builder returns {@link SvgArt}: the SVG string, its intrinsic viewBox
 * dimensions (`viewW`/`viewH`, kept proportional to the previously-baked pixel
 * sizes so on-screen scale is preserved), and `footYFrac` in (0, 1] marking the
 * ground-contact point as a fraction of the height. The caller computes the
 * baked size and `footY = round(footYFrac * height)` from these.
 *
 * COLOR: builders take the same {@link SpritePalette} five-tone ramp the pixel
 * factory used (derived from a champion/team accent by {@link ./palette}), so
 * champions stay distinct by accent and the ally/enemy rim tell survives. Tones
 * are emitted as `#rrggbb` fills/strokes/gradients so the accent visibly drives
 * the art and tinting is wired without any runtime Phaser tint.
 */

import type { Champion, ChampionRole } from '../../data/champions';
import type { MinionType } from '../rift/minions';
import { darken, derivePalette, hexToInt, lighten, type SpritePalette } from './palette';

/** Team a figure belongs to; drives the ally/enemy rim tell. */
export type SpriteTeam = 'ally' | 'enemy';

/** Finite champion animation/pose vocabulary used by generated texture keys. */
export const CHAMPION_POSES = [
  'idle',
  'move',
  'attack',
  'castQ',
  'castW',
  'castE',
  'castR',
  'hit',
  'death',
] as const;

export type ChampionPose = (typeof CHAMPION_POSES)[number];

/** Four authored silhouettes shared by the bounded pose vocabulary. */
export type ChampionArtVariant = 'idle' | 'stride' | 'strike' | 'channel';

export interface ChampionArtOptions {
  /** Canonical roster id. Unknown ids deliberately use role-generic art. */
  championId?: string;
  /** Defaults to idle so legacy callers keep their original call shape. */
  pose?: ChampionPose;
}

/** Collapse nine gameplay states into four intentionally authored art layers. */
export function championArtVariant(pose: ChampionPose): ChampionArtVariant {
  switch (pose) {
    case 'idle':
      return 'idle';
    case 'move':
      return 'stride';
    case 'attack':
    case 'hit':
      return 'strike';
    case 'castQ':
    case 'castW':
    case 'castE':
    case 'castR':
    case 'death':
      return 'channel';
  }
}

/**
 * Rim/outline color per team, kept bright so the ally/enemy tell reads. This is
 * the single source of truth shared by both the battle sprite factory (which
 * bakes tinted textures) and the DOM champion art, so the in-UI figures match
 * exactly what the player sees in battle. Defined here in the pure, Phaser-free
 * module so React components can import it without pulling in Phaser.
 */
export const TEAM_RIM: Record<SpriteTeam, number> = {
  ally: 0x8fd7ff,
  enemy: 0xff8a7a,
};

/** Result of an SVG art builder: markup plus intrinsic geometry. */
export interface SvgArt {
  /** The full `<svg ...>...</svg>` markup string. */
  svg: string;
  /** Intrinsic viewBox width (proportional to the baked texture width). */
  viewW: number;
  /** Intrinsic viewBox height (proportional to the baked texture height). */
  viewH: number;
  /**
   * Ground-contact point as a fraction of the height, in (0, 1]. The caller
   * turns this into `footY = round(footYFrac * pixelHeight)`.
   */
  footYFrac: number;
}

/** Convert a packed `0xRRGGBB` int into a `#rrggbb` string for SVG. */
export function toHex(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}

/**
 * Wrap authored body markup in an `<svg>` with a shared `<defs>` gradient
 * ramp derived from the palette so figures read as softly shaded volumes
 * rather than flat fills. `id` seeds unique gradient ids so multiple textures
 * on one page never collide.
 */
function svgDoc(
  id: string,
  viewW: number,
  viewH: number,
  pal: SpritePalette,
  body: string,
): string {
  const gid = `g-${id}`;
  const base = toHex(pal.base);
  const light = toHex(pal.light);
  const shadow = toHex(pal.shadow);
  const rim = toHex(pal.rim);
  // A soft ground-contact shadow ellipse so billboards read as standing on the
  // floor rather than floating. Sized to the viewBox and anchored at the foot.
  const groundRx = viewW * 0.42;
  const groundRy = Math.max(3, viewH * 0.05);
  const groundCy = viewH - groundRy - 1;
  const ground =
    `<ellipse cx="${(viewW / 2).toFixed(2)}" cy="${groundCy.toFixed(2)}" ` +
    `rx="${groundRx.toFixed(2)}" ry="${groundRy.toFixed(2)}" fill="url(#${gid}-ground)"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewW} ${viewH}" ` +
    `width="${viewW}" height="${viewH}">` +
    `<defs>` +
    // Diagonal body ramp: lit plane -> base -> cast-shadow, for volume.
    `<linearGradient id="${gid}-body" x1="0.15" y1="0" x2="0.85" y2="1">` +
    `<stop offset="0" stop-color="${toHex(lighten(pal.light, 0.18))}"/>` +
    `<stop offset="0.42" stop-color="${light}"/>` +
    `<stop offset="0.68" stop-color="${base}"/>` +
    `<stop offset="1" stop-color="${shadow}"/>` +
    `</linearGradient>` +
    // Bright core glow for orbs/crystals.
    `<radialGradient id="${gid}-core" cx="0.5" cy="0.4" r="0.62">` +
    `<stop offset="0" stop-color="${toHex(lighten(pal.rim, 0.4))}"/>` +
    `<stop offset="0.5" stop-color="${toHex(lighten(pal.base, 0.55))}"/>` +
    `<stop offset="1" stop-color="${base}"/>` +
    `</radialGradient>` +
    // A faint team-rim sheen that can wash a lit edge.
    `<linearGradient id="${gid}-rim" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${rim}" stop-opacity="0.9"/>` +
    `<stop offset="1" stop-color="${rim}" stop-opacity="0"/>` +
    `</linearGradient>` +
    // Soft ground contact shadow (dark center fading out).
    `<radialGradient id="${gid}-ground" cx="0.5" cy="0.5" r="0.5">` +
    `<stop offset="0" stop-color="#000000" stop-opacity="0.42"/>` +
    `<stop offset="1" stop-color="#000000" stop-opacity="0"/>` +
    `</radialGradient>` +
    `</defs>` +
    ground +
    body +
    `</svg>`
  );
}

/** The `url(#..-rim)` team-rim sheen gradient reference. */
function rimFill(id: string): string {
  return `url(#g-${id}-rim)`;
}

/** Convenience: the `url(#..-body)` gradient reference for a builder id. */
function bodyFill(id: string): string {
  return `url(#g-${id}-body)`;
}

/** Convenience: the `url(#..-core)` radial gradient reference. */
function coreFill(id: string): string {
  return `url(#g-${id}-core)`;
}

// ---------------------------------------------------------------------------
// Champion figures (54 x 78 baked). Distinct illustrated silhouette per role.
// ---------------------------------------------------------------------------

// Champions are drawn as the FOCAL figures of the scene, so they are baked a
// touch larger than the supporting structures/minions to keep them prominent
// and readable across the lane map (see the size-balance tuning pass).
const CH_W = 64;
const CH_H = 92;
const CH_FOOT = 90 / CH_H; // ground contact near the very bottom

/**
 * Shared champion body: legs, torso, head + a neutral cloak, all shaded from
 * the palette. The per-role motif (weapon/prop) is layered on top so each of
 * the five roles reads as a different character.
 */
/**
 * TACTICAL-GEOMETRIC CHASSIS + ORDNANCE (design direction C).
 *
 * Champions are NOT humanoid figures. Each ROLE is a bold geometric emblem
 * whose silhouette alone encodes the role, and each roster CHAMPION bolts a
 * distinct oversized WEAPON onto that chassis.
 *
 * This replaced an earlier ball-head / cone-torso humanoid base. That base read
 * as unfinished placeholder art because it imitated realistic human proportions
 * crudely, and because all ten champions shared one skeleton they were
 * separable only by accent color. A deliberate geometric language reads as a
 * STYLE rather than as a stand-in, and - the point that actually decides MOBA
 * fights - a shape+weapon pair stays legible at unit scale in a teamfight where
 * a color swap does not.
 *
 * `shape` is the role silhouette authored in the 54x78 CH_ART space (center
 * x=27, ground contact y~75). `coreY` places the glowing core the unit reads
 * its facing from. Everything stays procedural and palette-driven: ZERO binary
 * assets, original IP.
 */
function chassis(
  id: string,
  pal: SpritePalette,
  shape: string,
  coreY: number,
): string {
  const outline = toHex(pal.outline);
  const rim = toHex(pal.rim);
  const clip = `clip-${id}`;
  return (
    // Clip the lit sheen to the silhouette so an arbitrary shape still reads as
    // a volume without hand-authoring an inset copy of every path.
    `<clipPath id="${clip}"><path d="${shape}"/></clipPath>` +
    // solid chassis plate
    `<path d="${shape}" fill="${bodyFill(id)}" stroke="${outline}" stroke-width="2"/>` +
    // top-lit sheen washing the upper plane
    `<rect x="0" y="0" width="54" height="46" fill="${rimFill(id)}" ` +
    `clip-path="url(#${clip})" opacity="0.5"/>` +
    // team-rim contour so ally/enemy reads before the shape does
    `<path d="${shape}" fill="none" stroke="${rim}" stroke-width="1.2" opacity="0.75"/>` +
    // glowing core: facing + a single bright focal point per unit
    `<circle cx="27" cy="${coreY}" r="4.2" fill="${coreFill(id)}" ` +
    `stroke="${outline}" stroke-width="1.2"/>` +
    `<circle cx="27" cy="${coreY}" r="1.6" fill="${toHex(lighten(pal.rim, 0.55))}"/>`
  );
}

// ---------------------------------------------------------------------------
// Shared ORDNANCE primitives.
//
// Each weapon is authored pointing along +x at the local origin, then placed by
// the caller with a `translate(...) rotate(...)` group. That keeps the maths in
// one place instead of re-deriving rotated path coordinates per champion.
// ---------------------------------------------------------------------------

/** A rocket: tail fins, casing, nose cone, and an optional exhaust plume. */
function rocketAt(
  pal: SpritePalette,
  x: number,
  y: number,
  deg: number,
  len = 18,
  flame = true,
): string {
  const outline = toHex(pal.outline);
  const casing = toHex(lighten(pal.base, 0.5));
  const hot = toHex(lighten(pal.rim, 0.6));
  const h = 3.2;
  const back = -len / 2;
  const front = len / 2;
  return (
    `<g transform="translate(${x} ${y}) rotate(${deg})">` +
    (flame
      ? `<path d="M${back - 1} 0 L${back - 12} -3.6 L${back - 7} 0 L${back - 12} 3.6 Z" ` +
        `fill="${hot}" opacity="0.92"/>`
      : '') +
    `<path d="M${back} ${-h} l-4.5 -4.5 l4.5 1.2 Z" fill="${casing}" stroke="${outline}" stroke-width="0.9"/>` +
    `<path d="M${back} ${h} l-4.5 4.5 l4.5 -1.2 Z" fill="${casing}" stroke="${outline}" stroke-width="0.9"/>` +
    `<rect x="${back}" y="${-h}" width="${len}" height="${h * 2}" rx="1.2" ` +
    `fill="${casing}" stroke="${outline}" stroke-width="1.2"/>` +
    `<path d="M${front} ${-h} L${front + 6.5} 0 L${front} ${h} Z" ` +
    `fill="${hot}" stroke="${outline}" stroke-width="1.1"/>` +
    `</g>`
  );
}

/** A launcher TUBE the rocket flies out of: barrel, muzzle ring, rear bell. */
function launcherAt(
  pal: SpritePalette,
  x: number,
  y: number,
  deg: number,
  len = 26,
): string {
  const outline = toHex(pal.outline);
  const steel = toHex(darken(lighten(pal.base, 0.32), 0.14));
  const rim = toHex(pal.rim);
  const h = 4.2;
  const back = -len / 2;
  const front = len / 2;
  return (
    `<g transform="translate(${x} ${y}) rotate(${deg})">` +
    // rear blast bell
    `<path d="M${back} ${-h} L${back - 5} ${-h - 2.6} L${back - 5} ${h + 2.6} L${back} ${h} Z" ` +
    `fill="${steel}" stroke="${outline}" stroke-width="1.2"/>` +
    // barrel
    `<rect x="${back}" y="${-h}" width="${len}" height="${h * 2}" rx="1.6" ` +
    `fill="${steel}" stroke="${outline}" stroke-width="1.4"/>` +
    // muzzle ring
    `<rect x="${front - 3}" y="${-h - 1.6}" width="4" height="${h * 2 + 3.2}" rx="1" ` +
    `fill="${steel}" stroke="${outline}" stroke-width="1.2"/>` +
    // sight rail + accent stripe
    `<path d="M${back + 4} ${-h} L${front - 5} ${-h}" stroke="${rim}" stroke-width="1.4" opacity="0.9"/>` +
    `<rect x="${back + 5}" y="${-h - 3}" width="5" height="3" fill="${steel}" stroke="${outline}" stroke-width="0.9"/>` +
    `</g>`
  );
}

/** Marksman: upward ARROWHEAD wedge - the longest reach, the sharpest read. */
function marksman(id: string, pal: SpritePalette): string {
  const rim = toHex(pal.rim);
  return (
    chassis(id, pal, 'M27 12 L45 66 L27 54 L9 66 Z', 34) +
    // targeting notch: a role tell, not a weapon (the champion motif brings that)
    `<path d="M27 12 L27 24" stroke="${rim}" stroke-width="1.6" opacity="0.85"/>`
  );
}

/** Assassin: tall DIAMOND - narrow, top-heavy, reads as a dagger point. */
function assassin(id: string, pal: SpritePalette): string {
  const rim = toHex(pal.rim);
  return (
    chassis(id, pal, 'M27 8 L46 40 L27 74 L8 40 Z', 38) +
    `<path d="M18 40 L36 40" stroke="${rim}" stroke-width="1.4" opacity="0.7"/>`
  );
}

/** Bruiser: SHIELD plate - widest, flat-topped, visually the heaviest. */
function bruiser(id: string, pal: SpritePalette): string {
  const rim = toHex(pal.rim);
  return (
    chassis(id, pal, 'M9 14 H45 V44 Q27 76 9 44 Z', 36) +
    // armour ridges
    `<path d="M16 22 L16 46 M38 22 L38 46" stroke="${rim}" stroke-width="1.3" opacity="0.6"/>`
  );
}

/** Mage fallback: HEXAGON - an arcane cell, flat sides, no point. */
function mage(id: string, pal: SpritePalette): string {
  const rim = toHex(pal.rim);
  return (
    chassis(id, pal, 'M27 8 L46 22 L46 54 L27 68 L8 54 L8 22 Z', 36) +
    `<path d="M27 8 L27 20 M8 22 L18 28 M46 22 L36 28" stroke="${rim}" ` +
    `stroke-width="1.2" opacity="0.6"/>`
  );
}

/**
 * Embermage benchmark art. Nine gameplay poses resolve to four authored,
 * cacheable silhouettes so state reads clearly without creating an open-ended
 * texture family. The hexagon chassis is constant; the FLAME CANNON it carries
 * changes stance per variant, which is what makes the pose readable at unit
 * scale. Every layer remains palette/team driven and procedural.
 */
function embermage(id: string, pal: SpritePalette, variant: ChampionArtVariant): string {
  const outline = toHex(pal.outline);
  const hot = toHex(lighten(pal.rim, 0.6));
  const hex = 'M27 8 L46 22 L46 54 L27 68 L8 54 L8 22 Z';
  const body = chassis(id, pal, hex, 36);

  if (variant === 'stride') {
    return (
      `<g data-champion="embermage" data-variant="stride">` +
      body +
      // cannon slung low while moving, muzzle trailing heat
      launcherAt(pal, 30, 56, 24, 22) +
      `<path d="M12 62 C4 66 6 72 0 74" fill="none" stroke="${hot}" ` +
      `stroke-width="1.6" stroke-linecap="round" opacity="0.8"/>` +
      `</g>`
    );
  }

  if (variant === 'strike') {
    return (
      `<g data-champion="embermage" data-variant="strike">` +
      body +
      // cannon punched forward, muzzle blooming
      launcherAt(pal, 34, 32, -8, 26) +
      `<circle cx="50" cy="29" r="7" fill="${coreFill(id)}" stroke="${outline}" stroke-width="1.2"/>` +
      `<path d="M44 21 Q56 17 60 29 Q56 41 44 37" fill="none" stroke="${hot}" ` +
      `stroke-width="2" opacity="0.92"/>` +
      `</g>`
    );
  }

  if (variant === 'channel') {
    return (
      `<g data-champion="embermage" data-variant="channel">` +
      body +
      // cannon raised vertically, charge rings orbiting the chassis
      launcherAt(pal, 41, 30, -74, 24) +
      `<circle cx="27" cy="38" r="21" fill="none" stroke="${hot}" stroke-width="1.5" ` +
      `stroke-dasharray="3 4" opacity="0.85"/>` +
      `<circle cx="27" cy="38" r="14" fill="none" stroke="${toHex(pal.rim)}" ` +
      `stroke-width="1.1" opacity="0.7"/>` +
      `<circle cx="41" cy="17" r="4.4" fill="${hot}"/>` +
      `</g>`
    );
  }

  return (
    `<g data-champion="embermage" data-variant="idle">` +
    body +
    // cannon at rest across the chassis, pilot light lit
    launcherAt(pal, 33, 44, 8, 24) +
    `<circle cx="47" cy="42" r="3.4" fill="${hot}"/>` +
    `</g>`
  );
}

/** Enchanter: a RING/BALL chassis - no point, no edge, reads as support. */
function enchanter(id: string, pal: SpritePalette): string {
  const outline = toHex(pal.outline);
  const halo = toHex(lighten(pal.rim, 0.35));
  return (
    chassis(id, pal, 'M8 40 A19 19 0 1 1 46 40 A19 19 0 1 1 8 40 Z', 40) +
    // concentric support rings
    `<circle cx="27" cy="40" r="13" fill="none" stroke="${halo}" stroke-width="1.4" opacity="0.75"/>` +
    `<circle cx="27" cy="40" r="19" fill="none" stroke="${outline}" stroke-width="1" opacity="0.5"/>`
  );
}

const CHAMPION_BUILDERS: Record<ChampionRole, (id: string, pal: SpritePalette) => string> = {
  marksman,
  assassin,
  bruiser,
  mage,
  enchanter,
};

// ---------------------------------------------------------------------------
// Per-champion signature motifs.
//
// The five role builders above give each ROLE a distinct silhouette, but the
// two roster champions that share a role would otherwise be identical apart
// from their accent color. To make every one of the ten champions read as its
// own character, each roster id contributes a small, deterministic, fully
// palette-driven OVERLAY that is layered on top of the role body (a headpiece,
// a weapon detail, an emblem, etc.). The overlay never replaces the role body,
// so an UNKNOWN or `generic-<role>` id simply renders the plain role art with
// no overlay (the role-generic fallback the sprite factory relies on).
//
// embermage is intentionally NOT in this table: it keeps its bespoke,
// pose-aware treatment authored in {@link embermage} and is dispatched before
// the motif layer is consulted.
//
// Every motif is authored in the same 54x78 CH_ART space as the role bodies,
// stays procedural (ZERO binary assets, original IP), and draws only from the
// palette ramp / team rim so the accent and ally/enemy tell keep driving it.
// ---------------------------------------------------------------------------

/** A signature overlay: pure markup keyed by roster id, drawn over the body. */
type ChampionMotif = (id: string, pal: SpritePalette) => string;

/** ashborne (marksman): a shoulder-fired ROCKET LAUNCHER with a loaded warhead. */
function motifAshborne(_id: string, pal: SpritePalette): string {
  const hot = toHex(lighten(pal.rim, 0.55));
  return (
    `<g data-motif="ashborne">` +
    launcherAt(pal, 27, 34, -20, 26) +
    // warhead sitting in the muzzle, unfired (no plume)
    rocketAt(pal, 41, 29, -20, 8, false) +
    // pilot flare at the blast bell
    `<circle cx="14" cy="40" r="2.6" fill="${hot}" opacity="0.9"/>` +
    `</g>`
  );
}

/** duskarrow (marksman): a twin-barrel coil RAILGUN - reach without a rocket. */
function motifDuskarrow(id: string, pal: SpritePalette): string {
  const outline = toHex(pal.outline);
  const steel = toHex(darken(lighten(pal.base, 0.4), 0.1));
  const arc = toHex(lighten(pal.rim, 0.55));
  return (
    `<g data-motif="duskarrow">` +
    // paired barrels running out to the right
    `<rect x="20" y="28" width="30" height="3.4" rx="1.2" fill="${steel}" stroke="${outline}" stroke-width="1.1"/>` +
    `<rect x="20" y="36" width="30" height="3.4" rx="1.2" fill="${steel}" stroke="${outline}" stroke-width="1.1"/>` +
    // charge coils wrapping both barrels
    `<path d="M26 26 L26 42 M32 26 L32 42 M38 26 L38 42" stroke="${arc}" ` +
    `stroke-width="1.5" opacity="0.9"/>` +
    // breech block + a hot arc jumping the muzzles
    `<rect x="15" y="25" width="7" height="18" rx="1.6" fill="${bodyFill(id)}" ` +
    `stroke="${outline}" stroke-width="1.2"/>` +
    `<path d="M50 30 Q53 34 50 38" fill="none" stroke="${arc}" stroke-width="1.6" opacity="0.95"/>` +
    `</g>`
  );
}

/** nightveil (assassin): a back-mounted NINJA ROCKET, lit and ready to burn. */
function motifNightveil(_id: string, pal: SpritePalette): string {
  const veil = toHex(darken(pal.base, 0.15));
  const glint = toHex(lighten(pal.rim, 0.45));
  return (
    `<g data-motif="nightveil">` +
    // the rocket strapped diagonally across the back, exhaust already burning
    rocketAt(pal, 27, 32, -62, 20, true) +
    // ninja headband knot + trailing tails whipping off the strap
    `<path d="M14 22 L26 26" stroke="${veil}" stroke-width="2.4" stroke-linecap="round"/>` +
    `<path d="M14 22 C8 26 10 33 5 35 M14 23 C9 29 12 35 7 39" fill="none" ` +
    `stroke="${veil}" stroke-width="1.7" stroke-linecap="round" opacity="0.9"/>` +
    // a single veil sigil catching the exhaust light
    `<path d="${starPath(33, 47, 3, 1.2, 4)}" fill="${glint}"/>` +
    `</g>`
  );
}

/** grimtrail (assassin): twin crossed SICKLES - close-range, no ordnance. */
function motifGrimtrail(_id: string, pal: SpritePalette): string {
  const outline = toHex(pal.outline);
  const steel = toHex(lighten(pal.rim, 0.45));
  const grip = toHex(darken(pal.base, 0.32));
  return (
    `<g data-motif="grimtrail">` +
    // left sickle: hooked blade sweeping down-left
    `<path d="M22 30 C10 30 4 40 8 50" fill="none" stroke="${steel}" ` +
    `stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M22 30 L28 26" stroke="${grip}" stroke-width="3" stroke-linecap="round"/>` +
    // right sickle: mirrored, sweeping down-right
    `<path d="M32 30 C44 30 50 40 46 50" fill="none" stroke="${steel}" ` +
    `stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M32 30 L26 26" stroke="${grip}" stroke-width="3" stroke-linecap="round"/>` +
    // inner edge glints
    `<path d="M20 32 C12 33 8 40 10 47 M34 32 C42 33 46 40 44 47" fill="none" ` +
    `stroke="${toHex(lighten(pal.rim, 0.75))}" stroke-width="0.9" opacity="0.8"/>` +
    `<circle cx="27" cy="26" r="2" fill="${grip}" stroke="${outline}" stroke-width="0.8"/>` +
    `</g>`
  );
}

/** ironhold (bruiser): a slab RIOT SHIELD plus a two-handed WARHAMMER. */
function motifIronhold(_id: string, pal: SpritePalette): string {
  const outline = toHex(pal.outline);
  const iron = toHex(lighten(pal.base, 0.42));
  const spark = toHex(lighten(pal.rim, 0.4));
  const shaft = toHex(darken(pal.base, 0.3));
  return (
    `<g data-motif="ironhold">` +
    // slab shield bolted across the left flank
    `<path d="M4 26 L16 22 L16 56 L4 52 Z" fill="${iron}" stroke="${outline}" stroke-width="1.5"/>` +
    `<path d="M10 26 L10 53" stroke="${outline}" stroke-width="1" opacity="0.6"/>` +
    `<circle cx="10" cy="39" r="2.6" fill="${spark}" stroke="${outline}" stroke-width="0.9"/>` +
    // warhammer: shaft up the right side, heavy head on top
    `<path d="M42 60 L46 22" stroke="${shaft}" stroke-width="3" stroke-linecap="round"/>` +
    `<rect x="38" y="12" width="16" height="10" rx="1.8" fill="${iron}" ` +
    `stroke="${outline}" stroke-width="1.4"/>` +
    `<path d="M38 17 L54 17" stroke="${spark}" stroke-width="1.3" opacity="0.85"/>` +
    `</g>`
  );
}

/** thornwarden (bruiser): a spiked FLAIL on a swinging chain. */
function motifThornwarden(_id: string, pal: SpritePalette): string {
  const outline = toHex(pal.outline);
  const iron = toHex(lighten(pal.base, 0.4));
  const vine = toHex(pal.rim);
  return (
    `<g data-motif="thornwarden">` +
    // chain arcing out from the right flank
    `<path d="M34 34 C44 30 48 20 46 14" fill="none" stroke="${outline}" ` +
    `stroke-width="1.6" stroke-dasharray="2.6 2" opacity="0.95"/>` +
    // spiked ball at the end
    `<circle cx="45" cy="11" r="7" fill="${iron}" stroke="${outline}" stroke-width="1.4"/>` +
    `<path d="M45 4 L45 0 M52 11 L54 11 M38 11 L36 11 M50 6 L53 3 M40 6 L37 3 M50 16 L53 19" ` +
    `stroke="${iron}" stroke-width="1.8" stroke-linecap="round"/>` +
    `<circle cx="43" cy="9" r="2" fill="${vine}" opacity="0.9"/>` +
    // bramble creeping up the chassis
    `<path d="M12 58 C20 52 12 42 18 34" fill="none" stroke="${vine}" stroke-width="1.5" opacity="0.85"/>` +
    `</g>`
  );
}

/** frostquill (mage): a long FROST LANCE tipped with a crystal. */
function motifFrostquill(_id: string, pal: SpritePalette): string {
  const outline = toHex(pal.outline);
  const ice = toHex(lighten(pal.rim, 0.5));
  const shaft = toHex(darken(lighten(pal.base, 0.35), 0.12));
  return (
    `<g data-motif="frostquill">` +
    // lance shaft running low-left to high-right across the hexagon
    `<path d="M6 62 L44 16" stroke="${shaft}" stroke-width="2.8" stroke-linecap="round"/>` +
    // crystalline spearhead
    `<path d="M44 16 L52 8 L50 18 Z" fill="${ice}" stroke="${outline}" stroke-width="1.1"/>` +
    `<path d="${starPath(47, 13, 6, 2.4, 6)}" fill="${ice}" stroke="${outline}" stroke-width="0.6"/>` +
    // rime motes shedding off the shaft
    `<path d="${starPath(18, 48, 2.4, 1, 4)}" fill="${ice}"/>` +
    `<path d="${starPath(12, 56, 1.8, 0.7, 4)}" fill="${ice}" opacity="0.8"/>` +
    `</g>`
  );
}

/** dawnsong (enchanter): a twin-prong BEAM EMITTER casting a support ray. */
function motifDawnsong(id: string, pal: SpritePalette): string {
  const outline = toHex(pal.outline);
  const ray = toHex(lighten(pal.rim, 0.55));
  return (
    `<g data-motif="dawnsong">` +
    // emitter fork mounted on the right of the ring
    `<path d="M34 40 L46 40" stroke="${outline}" stroke-width="2.4" stroke-linecap="round"/>` +
    `<path d="M46 32 L46 48" stroke="${ray}" stroke-width="2.6" stroke-linecap="round"/>` +
    `<path d="M46 32 L53 28 M46 48 L53 52" stroke="${ray}" stroke-width="2.2" stroke-linecap="round"/>` +
    // focused beam between the prongs
    `<path d="M47 34 Q52 40 47 46" fill="none" stroke="${toHex(lighten(pal.rim, 0.8))}" ` +
    `stroke-width="1.5" opacity="0.95"/>` +
    `<circle cx="48" cy="40" r="3" fill="${coreFill(id)}" stroke="${outline}" stroke-width="0.8"/>` +
    // upward sunburst rays; tips stop at y=0 because the whole 54x78 figure is
    // uniformly scaled under a fixed viewBox and any y<0 would be clipped.
    `<path d="M27 8 L27 0 M17 12 L13 4 M37 12 L41 4" stroke="${ray}" ` +
    `stroke-width="1.4" stroke-linecap="round"/>` +
    `</g>`
  );
}

/**
 * wardlight (enchanter): the ROCKET-LAUNCHER BALL - the ring chassis with twin
 * missile pods bolted to its flanks and warheads racked and lit.
 */
function motifWardlight(id: string, pal: SpritePalette): string {
  const outline = toHex(pal.outline);
  const lamp = toHex(lighten(pal.rim, 0.45));
  const pod = toHex(darken(lighten(pal.base, 0.36), 0.12));
  return (
    `<g data-motif="wardlight">` +
    // left + right pods clamped onto the ball
    `<rect x="0" y="30" width="12" height="16" rx="2" fill="${pod}" stroke="${outline}" stroke-width="1.3"/>` +
    `<rect x="42" y="30" width="12" height="16" rx="2" fill="${pod}" stroke="${outline}" stroke-width="1.3"/>` +
    // launch tubes: two per pod
    `<circle cx="6" cy="35" r="2.6" fill="${outline}"/><circle cx="6" cy="41" r="2.6" fill="${outline}"/>` +
    `<circle cx="48" cy="35" r="2.6" fill="${outline}"/><circle cx="48" cy="41" r="2.6" fill="${outline}"/>` +
    // a warhead already climbing out of the top-right tube
    rocketAt(pal, 48, 20, -90, 12, true) +
    // ward light in the core so it still reads as a support unit
    `<circle cx="27" cy="40" r="5.5" fill="${coreFill(id)}" stroke="${outline}" stroke-width="1"/>` +
    `<path d="${starPath(27, 40, 4.5, 2, 6)}" fill="none" stroke="${lamp}" stroke-width="1.2" opacity="0.95"/>` +
    `</g>`
  );
}

/**
 * Roster id -> signature overlay. Any id absent here (including unknown ids and
 * the `generic-<role>` sentinel the sprite factory passes) renders the plain
 * role body. embermage is deliberately absent (it owns a bespoke path).
 */
const CHAMPION_MOTIFS: Record<string, ChampionMotif> = {
  ashborne: motifAshborne,
  duskarrow: motifDuskarrow,
  nightveil: motifNightveil,
  grimtrail: motifGrimtrail,
  ironhold: motifIronhold,
  thornwarden: motifThornwarden,
  frostquill: motifFrostquill,
  dawnsong: motifDawnsong,
  wardlight: motifWardlight,
};

/**
 * Intrinsic coordinate space the champion body markup is authored in. The
 * builders below draw with hard-coded coordinates in this 54x78 box; the whole
 * figure is then uniformly scaled up into the (larger) {@link CH_W}x{@link CH_H}
 * baked viewBox via a `<g transform>` so champions read as the focal figures
 * without re-authoring every path coordinate.
 */
const CH_ART_W = 54;
const CH_ART_H = 78;

/**
 * Build the illustrated SVG for a champion. The third argument is additive;
 * callers that only know role/palette retain the generic idle art contract.
 */
export function championArt(
  role: ChampionRole,
  pal: SpritePalette,
  options: ChampionArtOptions = {},
): SvgArt {
  const pose = options.pose ?? 'idle';
  const benchmark = role === 'mage' && options.championId === 'embermage';
  const variant = championArtVariant(pose);
  // A known roster champion (other than the bespoke embermage) selects a
  // signature overlay. Unknown / `generic-<role>` ids resolve to `undefined`
  // here and fall through to the plain role body, preserving the role-generic
  // fallback the sprite factory depends on.
  const motif = options.championId ? CHAMPION_MOTIFS[options.championId] : undefined;
  // Seed the gradient defs id with the champion id when a motif is present so
  // same-role siblings never share texture-local gradient ids on one page and
  // read as distinct characters (embermage keeps its own variant-seeded id).
  const id = benchmark
    ? `ch-embermage-${variant}`
    : motif
      ? `ch-${options.championId}`
      : `ch-${role}`;
  const inner = benchmark
    ? embermage(id, pal, variant)
    : CHAMPION_BUILDERS[role](id, pal) + (motif ? motif(id, pal) : '');
  // Uniformly scale the 54x78-authored figure up into the larger baked box.
  const sx = (CH_W / CH_ART_W).toFixed(4);
  const sy = (CH_H / CH_ART_H).toFixed(4);
  const body = `<g transform="scale(${sx} ${sy})">${inner}</g>`;
  return { svg: svgDoc(id, CH_W, CH_H, pal, body), viewW: CH_W, viewH: CH_H, footYFrac: CH_FOOT };
}

/**
 * Convenience: build the full inline `<svg>` markup string for a champion,
 * tinted exactly like the battle art for the given team. `pose` is optional so
 * existing DOM callers continue to receive the idle figure.
 */
export function championArtSvg(
  champion: Champion,
  team: SpriteTeam = 'ally',
  pose: ChampionPose = 'idle',
): string {
  const pal = derivePalette(hexToInt(champion.accentColor), TEAM_RIM[team]);
  return championArt(champion.role, pal, { championId: champion.id, pose }).svg;
}

// ---------------------------------------------------------------------------
// Minions (proportional to old 42x54 .. 54x72). Small footsoldier pawn.
// ---------------------------------------------------------------------------

/** Build the illustrated SVG for a lane minion. */
export function minionArt(type: MinionType, pal: SpritePalette): SvgArt {
  const id = `mn-${type}`;
  const big = type === 'super' ? 2 : type === 'siege' ? 1 : 0;
  // Baked a touch larger than the old 42x54 so minions stay readable next to
  // the now-more-prominent champions (see the size-balance tuning pass).
  const viewW = 46 + big * 6;
  const viewH = 60 + big * 9;
  const outline = toHex(pal.outline);
  const fill = bodyFill(id);
  const cx = viewW / 2;
  const bw = 20 + big * 5;
  const bh = 24 + big * 6;
  const bx = cx - bw / 2;
  const by = viewH - bh - 4;
  const head = 12 + big * 3;

  const rim = toHex(pal.rim);
  let body =
    // rounded pawn body
    `<path d="M${bx} ${by + bh} Q${bx} ${by} ${cx} ${by} Q${bx + bw} ${by} ${bx + bw} ${by + bh} Z" ` +
    `fill="${fill}" stroke="${outline}" stroke-width="1.4"/>` +
    // lit sheen down the front
    `<path d="M${bx + 3} ${by + bh - 2} Q${bx + 3} ${by + 3} ${cx} ${by + 2} L${cx} ${by + bh - 2} Z" ` +
    `fill="${rimFill(id)}" opacity="0.35"/>` +
    // team-rim edge (thick so ally/enemy reads at small size)
    `<path d="M${bx + 2} ${by + 4} Q${bx + 3} ${by + bh - 4} ${bx + 4} ${by + bh}" fill="none" stroke="${rim}" stroke-width="1.6" opacity="0.9"/>` +
    // a small team-tinted collar band
    `<path d="M${bx + 3} ${by + 6} Q${cx} ${by + 3} ${bx + bw - 3} ${by + 6}" fill="none" stroke="${rim}" stroke-width="1.4" opacity="0.7"/>` +
    // head knob with a rim-lit crown
    `<circle cx="${cx}" cy="${by - head / 2 + 2}" r="${head / 2}" fill="${toHex(lighten(pal.base, 0.2))}" stroke="${outline}" stroke-width="1.2"/>` +
    `<path d="M${cx - head / 2 + 1} ${by - head / 2 + 1} A${head / 2} ${head / 2} 0 0 1 ${cx + head / 2 - 1} ${by - head / 2 + 1}" fill="none" stroke="${rim}" stroke-width="1" opacity="0.6"/>` +
    // little boots
    `<rect x="${cx - bw / 2 + 1}" y="${viewH - 5}" width="${bw / 2 - 1}" height="4" rx="1.5" fill="${outline}"/>` +
    `<rect x="${cx + 1}" y="${viewH - 5}" width="${bw / 2 - 1}" height="4" rx="1.5" fill="${outline}"/>`;

  if (type === 'siege' || type === 'super') {
    // a cannon/spear jutting out so bigger minions read as bigger threats
    const barrel = toHex(lighten(pal.base, 0.4));
    body +=
      `<rect x="${bx + bw - 2}" y="${by + 4}" width="${8 + big * 2}" height="5" rx="2" fill="${barrel}" stroke="${outline}" stroke-width="1"/>`;
  }

  return { svg: svgDoc(id, viewW, viewH, pal, body), viewW, viewH, footYFrac: (viewH - 1) / viewH };
}

// ---------------------------------------------------------------------------
// Structures: turret / inhibitor / nexus, ally & enemy via palette rim.
// ---------------------------------------------------------------------------

/** Build the illustrated SVG for a structure of the given tier. */
export function structureArt(
  tier: 'turret' | 'inhibitor' | 'nexus',
  pal: SpritePalette,
): SvgArt {
  const id = `st-${tier}`;
  const outline = toHex(pal.outline);
  const fill = bodyFill(id);
  const rim = toHex(pal.rim);

  if (tier === 'nexus') {
    // Structures are baked SMALLER than before so they read as landmarks
    // rather than towering over the champions (size-balance tuning pass).
    const viewW = 56;
    const viewH = 74;
    const cx = viewW / 2;
    const body =
      // stone plinth
      `<path d="M12 ${viewH - 4} L${viewW - 12} ${viewH - 4} L${viewW - 18} ${viewH - 16} L18 ${viewH - 16} Z" ` +
      `fill="${toHex(pal.shadow)}" stroke="${outline}" stroke-width="1.6"/>` +
      // large faceted crystal
      `<path d="M${cx} 6 L${cx + 20} 40 L${cx + 12} ${viewH - 18} L${cx - 12} ${viewH - 18} L${cx - 20} 40 Z" ` +
      `fill="${fill}" stroke="${outline}" stroke-width="1.8"/>` +
      // inner facet highlights
      `<path d="M${cx} 6 L${cx} ${viewH - 18}" stroke="${rim}" stroke-width="1.4" opacity="0.8"/>` +
      `<path d="M${cx} 6 L${cx - 20} 40 M${cx} 6 L${cx + 20} 40" stroke="${toHex(lighten(pal.base, 0.4))}" stroke-width="1" opacity="0.7"/>` +
      // glowing core with soft halo
      `<circle cx="${cx}" cy="46" r="12" fill="${coreFill(id)}" opacity="0.35"/>` +
      `<circle cx="${cx}" cy="46" r="7" fill="${coreFill(id)}"/>` +
      // team-rim sheen on the lit crystal facet
      `<path d="M${cx} 6 L${cx - 20} 40 L${cx - 12} ${viewH - 18} L${cx} ${viewH - 18} Z" fill="${rimFill(id)}" opacity="0.28"/>`;
    return { svg: svgDoc(id, viewW, viewH, pal, body), viewW, viewH, footYFrac: (viewH - 1) / viewH };
  }

  if (tier === 'inhibitor') {
    const viewW = 40;
    const viewH = 44;
    const cx = viewW / 2;
    const body =
      // base
      `<path d="M8 ${viewH - 3} L${viewW - 8} ${viewH - 3} L${viewW - 14} ${viewH - 12} L14 ${viewH - 12} Z" ` +
      `fill="${toHex(pal.shadow)}" stroke="${outline}" stroke-width="1.4"/>` +
      // crystal pyramid
      `<path d="M${cx} 6 L${viewW - 12} ${viewH - 12} L12 ${viewH - 12} Z" ` +
      `fill="${fill}" stroke="${outline}" stroke-width="1.6"/>` +
      // facet + glowing core with soft halo
      `<path d="M${cx} 6 L${cx} ${viewH - 12}" stroke="${rim}" stroke-width="1.2" opacity="0.75"/>` +
      `<circle cx="${cx}" cy="30" r="10" fill="${coreFill(id)}" opacity="0.35"/>` +
      `<circle cx="${cx}" cy="30" r="6" fill="${coreFill(id)}"/>`;
    return { svg: svgDoc(id, viewW, viewH, pal, body), viewW, viewH, footYFrac: (viewH - 1) / viewH };
  }

  // Turret: tapered tower with a crenellated glowing head.
  const viewW = 40;
  const viewH = 52;
  const cx = viewW / 2;
  const body =
    // foot
    `<path d="M8 ${viewH - 3} L${viewW - 8} ${viewH - 3} L${viewW - 12} ${viewH - 14} L12 ${viewH - 14} Z" ` +
    `fill="${toHex(pal.shadow)}" stroke="${outline}" stroke-width="1.4"/>` +
    // tapered shaft
    `<path d="M16 ${viewH - 14} L${viewW - 16} ${viewH - 14} L${cx + 8} 20 L${cx - 8} 20 Z" ` +
    `fill="${fill}" stroke="${outline}" stroke-width="1.6"/>` +
    // lit column + team rim
    `<path d="M${cx - 5} 22 L${cx - 6} ${viewH - 15}" stroke="${rim}" stroke-width="1.6" opacity="0.85"/>` +
    // crenellated head
    `<rect x="${cx - 12}" y="8" width="24" height="14" rx="2" fill="${fill}" stroke="${outline}" stroke-width="1.4"/>` +
    `<rect x="${cx - 12}" y="4" width="5" height="6" fill="${fill}" stroke="${outline}" stroke-width="1"/>` +
    `<rect x="${cx - 2.5}" y="4" width="5" height="6" fill="${fill}" stroke="${outline}" stroke-width="1"/>` +
    `<rect x="${cx + 7}" y="4" width="5" height="6" fill="${fill}" stroke="${outline}" stroke-width="1"/>` +
    // team-rim sheen down the lit face of the head
    `<rect x="${cx - 12}" y="8" width="4" height="14" rx="2" fill="${rimFill(id)}" opacity="0.5"/>` +
    // glowing eye with a soft halo
    `<circle cx="${cx}" cy="16" r="7" fill="${coreFill(id)}" opacity="0.4"/>` +
    `<circle cx="${cx}" cy="16" r="4" fill="${coreFill(id)}"/>` +
    `<circle cx="${cx - 1}" cy="15" r="1.2" fill="${toHex(lighten(pal.rim, 0.4))}"/>`;
  return { svg: svgDoc(id, viewW, viewH, pal, body), viewW, viewH, footYFrac: (viewH - 1) / viewH };
}

// ---------------------------------------------------------------------------
// Markers: jungle gem/leaf + original epic beasts.
// ---------------------------------------------------------------------------

/** Fixed accent palette per marker variant (markers are not team-tinted). */
export const MARKER_PALETTES: Record<
  'jungle' | 'dragon' | 'baron' | 'herald',
  { base: number; rim: number }
> = {
  jungle: { base: 0x6fe08a, rim: 0xbfffcf },
  dragon: { base: 0xe8703a, rim: 0xffcaa8 },
  baron: { base: 0x9b6bff, rim: 0xc9b0ff },
  herald: { base: 0x7ad0ff, rim: 0xbfe9ff },
};

/** Build the illustrated SVG for a jungle/epic marker. */
export function markerArt(
  variant: 'jungle' | 'dragon' | 'baron' | 'herald',
  pal: SpritePalette,
): SvgArt {
  const id = `mk-${variant}`;
  const outline = toHex(pal.outline);
  const fill = bodyFill(id);
  const rim = toHex(pal.rim);

  if (variant === 'jungle') {
    const viewW = 24;
    const viewH = 24;
    const body =
      // leaf
      `<path d="M12 4 C20 8 20 18 12 21 C4 18 4 8 12 4 Z" fill="${fill}" stroke="${outline}" stroke-width="1"/>` +
      `<path d="M12 5 L12 20" stroke="${rim}" stroke-width="1" opacity="0.8"/>`;
    return { svg: svgDoc(id, viewW, viewH, pal, body), viewW, viewH, footYFrac: (viewH - 1) / viewH };
  }

  const viewW = 54;
  const viewH = 60;
  let body =
    // hulking body
    `<path d="M8 34 Q6 48 18 50 L40 50 Q50 48 46 34 Q40 26 27 26 Q14 26 8 34 Z" ` +
    `fill="${fill}" stroke="${outline}" stroke-width="1.6"/>` +
    // lit flank
    `<path d="M14 34 Q20 32 26 33" fill="none" stroke="${rim}" stroke-width="1.4" opacity="0.8"/>` +
    // head
    `<path d="M40 18 Q52 18 50 30 L40 32 L36 24 Z" fill="${fill}" stroke="${outline}" stroke-width="1.4"/>` +
    // glowing eye with a soft halo
    `<circle cx="45" cy="24" r="4" fill="${coreFill(id)}" opacity="0.5"/>` +
    `<circle cx="45" cy="24" r="1.8" fill="${toHex(lighten(pal.rim, 0.3))}"/>`;

  if (variant === 'dragon' || variant === 'herald') {
    // sweeping wings
    body +=
      `<path d="M14 30 Q0 18 2 8 Q14 16 22 28 Z" fill="${fill}" stroke="${outline}" stroke-width="1.2" opacity="0.95"/>` +
      `<path d="M30 28 Q40 14 52 10 Q48 24 40 32 Z" fill="${fill}" stroke="${outline}" stroke-width="1.2" opacity="0.9"/>` +
      // horns
      `<path d="M44 18 L48 8 L46 18 Z" fill="${toHex(lighten(pal.base, 0.2))}" stroke="${outline}" stroke-width="1"/>`;
  } else {
    // baron: spine hump + tendrils instead of wings
    body +=
      `<path d="M14 28 Q20 16 27 26" fill="none" stroke="${toHex(lighten(pal.base, 0.25))}" stroke-width="2.4"/>` +
      `<path d="M24 26 Q30 14 37 24" fill="none" stroke="${toHex(lighten(pal.base, 0.25))}" stroke-width="2.4"/>` +
      `<path d="M8 40 Q2 46 4 52" fill="none" stroke="${outline}" stroke-width="2"/>`;
  }

  return { svg: svgDoc(id, viewW, viewH, pal, body), viewW, viewH, footYFrac: (viewH - 1) / viewH };
}

// ---------------------------------------------------------------------------
// Combat / skill VFX. Unlike the figure builders above, VFX are authored as
// small, self-contained SVG textures parameterized ONLY by a single ability
// color (a packed 0xRRGGBB int) so they can be baked once and cached by
// (kind + color) and animated with the existing BattleScene tweens. They do
// not use the champion palette ramp; instead each builder derives a soft
// light/dark ramp from the passed color so the caster's ability tint carries
// through while keeping a glowing, "authored" VFX look.
// ---------------------------------------------------------------------------

/** The set of VFX textures the battle renderer can bake. */
export type VfxKind =
  | 'projectile'
  | 'beam'
  | 'aoeRing'
  | 'castFlare'
  | 'impact'
  | 'heal'
  | 'stun'
  | 'death';

/**
 * Wrap VFX body markup in an `<svg>` with a shared radial "glow" gradient and a
 * tapered streak gradient derived from the ability color. `id` seeds unique ids
 * so multiple VFX textures on one page never collide.
 */
function vfxDoc(
  id: string,
  viewW: number,
  viewH: number,
  color: number,
  body: string,
): string {
  const gid = `v-${id}`;
  const core = toHex(lighten(color, 0.6));
  const mid = toHex(color);
  const edge = toHex(darken(color, 0.35));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewW} ${viewH}" ` +
    `width="${viewW}" height="${viewH}">` +
    `<defs>` +
    `<radialGradient id="${gid}-glow" cx="0.5" cy="0.5" r="0.5">` +
    `<stop offset="0" stop-color="${core}" stop-opacity="1"/>` +
    `<stop offset="0.5" stop-color="${mid}" stop-opacity="0.95"/>` +
    `<stop offset="1" stop-color="${edge}" stop-opacity="0"/>` +
    `</radialGradient>` +
    `<linearGradient id="${gid}-streak" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0" stop-color="${mid}" stop-opacity="0"/>` +
    `<stop offset="0.6" stop-color="${mid}" stop-opacity="0.9"/>` +
    `<stop offset="1" stop-color="${core}" stop-opacity="1"/>` +
    `</linearGradient>` +
    `</defs>` +
    body +
    `</svg>`
  );
}

/**
 * Fold a packed 0xRRGGBB color into a small non-negative integer used to seed
 * per-champion VFX signature flourishes. Pure and deterministic: the same color
 * always yields the same value, so it never perturbs the (kind + color) cache
 * key. The channels are mixed so accents that differ only slightly still tend
 * to land on different buckets.
 */
function colorSignature(color: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return (r * 3 + g * 5 + b * 7) & 0xffff;
}

/** N-pointed star path centered at (cx, cy) with outer/inner radii. */
function starPath(cx: number, cy: number, outer: number, inner: number, points: number): string {
  let d = '';
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / points - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  return `${d}Z`;
}

/**
 * Build a self-contained VFX SVG texture for the given `kind`, tinted by
 * `color` (a packed 0xRRGGBB int). Returns markup + intrinsic view size; the
 * `footYFrac` is a nominal 1 (VFX are centered sprites, not ground-anchored
 * billboards, so the caller positions them by center, not foot).
 */
export function vfxArt(kind: VfxKind, color: number): SvgArt {
  const id = `${kind}-${(color & 0xffffff).toString(16).padStart(6, '0')}`;
  const core = toHex(lighten(color, 0.7));
  const mid = toHex(color);
  const glow = `url(#v-${id}-glow)`;

  switch (kind) {
    case 'projectile': {
      // A glowing orb with a sharp hot core and a soft comet trail.
      const w = 44;
      const h = 24;
      const cy = h / 2;
      const white = toHex(lighten(color, 0.92));
      const body =
        // long tapered trail
        `<path d="M2 ${cy} Q16 ${cy - 6} 30 ${cy} Q16 ${cy + 6} 2 ${cy} Z" fill="${glow}" opacity="0.75"/>` +
        `<path d="M8 ${cy} Q20 ${cy - 2.5} 30 ${cy} Q20 ${cy + 2.5} 8 ${cy} Z" fill="${core}" opacity="0.6"/>` +
        // orb body
        `<circle cx="30" cy="${cy}" r="11" fill="${glow}"/>` +
        `<circle cx="30" cy="${cy}" r="6.5" fill="${mid}"/>` +
        `<circle cx="30" cy="${cy}" r="3.4" fill="${core}"/>` +
        // hot specular pin-point
        `<circle cx="28.5" cy="${cy - 1.5}" r="1.4" fill="${white}"/>`;
      return { svg: vfxDoc(id, w, h, color, body), viewW: w, viewH: h, footYFrac: 1 };
    }
    case 'beam': {
      // A tapered gradient streak (thin at the source, bright at the tip) with
      // a crisp hot centerline and a burst at the impact end.
      const w = 48;
      const h = 14;
      const cy = h / 2;
      const white = toHex(lighten(color, 0.92));
      const body =
        `<path d="M2 ${cy} L46 ${cy - 5} L46 ${cy + 5} Z" fill="url(#v-${id}-streak)"/>` +
        `<rect x="2" y="${cy - 1.4}" width="44" height="2.8" rx="1.4" fill="${core}" opacity="0.9"/>` +
        `<rect x="6" y="${cy - 0.5}" width="40" height="1" rx="0.5" fill="${white}" opacity="0.9"/>` +
        `<circle cx="46" cy="${cy}" r="6" fill="${glow}"/>` +
        `<circle cx="46" cy="${cy}" r="2.4" fill="${white}"/>`;
      return { svg: vfxDoc(id, w, h, color, body), viewW: w, viewH: h, footYFrac: 1 };
    }
    case 'aoeRing': {
      // A telegraph ring meant to be drawn as a ground ellipse: a bright
      // stroked circle with a soft inner fill, in a square viewBox so the
      // caller can squash it to any rx/ry.
      const s = 64;
      const c = s / 2;
      const white = toHex(lighten(color, 0.85));
      // A dashed outer telegraph ring reads as a targeting decal.
      const dash = (2 * Math.PI * (c - 3)) / 24;
      const body =
        `<circle cx="${c}" cy="${c}" r="${c - 3}" fill="${glow}" opacity="0.4"/>` +
        `<circle cx="${c}" cy="${c}" r="${c - 3}" fill="none" stroke="${core}" stroke-width="3.5"/>` +
        `<circle cx="${c}" cy="${c}" r="${c - 3}" fill="none" stroke="${white}" stroke-width="1.4" ` +
        `stroke-dasharray="${dash.toFixed(2)} ${dash.toFixed(2)}" opacity="0.8"/>` +
        `<circle cx="${c}" cy="${c}" r="${c - 11}" fill="none" stroke="${mid}" stroke-width="1.5" opacity="0.65"/>`;
      return { svg: vfxDoc(id, s, s, color, body), viewW: s, viewH: s, footYFrac: 1 };
    }
    case 'castFlare': {
      // A radiant burst: a central glow behind a spiky star. The cast flare is
      // the VFX most tied to a champion's IDENTITY (it fires on every ability),
      // so on top of the accent tint it carries a small SIGNATURE flourish: the
      // burst's point count is seeded DETERMINISTICALLY from the ability color,
      // so each champion's accent yields a subtly different star. This is a pure
      // function of `color`, so the (kind + color) cache key stays intact.
      const s = 48;
      const c = s / 2;
      const white = toHex(lighten(color, 0.9));
      // 6..9 points selected from the color so distinct accents read distinctly.
      const points = 6 + (colorSignature(color) % 4);
      const body =
        `<circle cx="${c}" cy="${c}" r="${c - 2}" fill="${glow}"/>` +
        `<path d="${starPath(c, c, c - 3, (c - 3) * 0.36, points)}" fill="${core}" opacity="0.95"/>` +
        `<path d="${starPath(c, c, (c - 3) * 0.6, (c - 3) * 0.24, points)}" fill="${white}" opacity="0.9"/>` +
        `<circle cx="${c}" cy="${c}" r="4" fill="${white}"/>`;
      return { svg: vfxDoc(id, s, s, color, body), viewW: s, viewH: s, footYFrac: 1 };
    }
    case 'impact': {
      // A spark/shard burst: several tapered shards radiating from the center.
      const s = 32;
      const c = s / 2;
      const white = toHex(lighten(color, 0.9));
      let shards = `<circle cx="${c}" cy="${c}" r="7" fill="${glow}"/>`;
      const spikes = 6;
      for (let i = 0; i < spikes; i += 1) {
        const a = (Math.PI * 2 * i) / spikes;
        const tipX = c + Math.cos(a) * (c - 1);
        const tipY = c + Math.sin(a) * (c - 1);
        const bx1 = c + Math.cos(a + 0.4) * 3;
        const by1 = c + Math.sin(a + 0.4) * 3;
        const bx2 = c + Math.cos(a - 0.4) * 3;
        const by2 = c + Math.sin(a - 0.4) * 3;
        shards +=
          `<path d="M${bx1.toFixed(2)} ${by1.toFixed(2)} L${tipX.toFixed(2)} ${tipY.toFixed(2)} ` +
          `L${bx2.toFixed(2)} ${by2.toFixed(2)} Z" fill="${core}"/>`;
      }
      // hot white flashpoint at the center of the burst
      shards += `<circle cx="${c}" cy="${c}" r="2.6" fill="${white}"/>`;
      return { svg: vfxDoc(id, s, s, color, shards), viewW: s, viewH: s, footYFrac: 1 };
    }
    case 'heal': {
      // A soft plus/cross sparkle with a glow behind it.
      const s = 32;
      const c = s / 2;
      const body =
        `<circle cx="${c}" cy="${c}" r="${c - 2}" fill="${glow}" opacity="0.8"/>` +
        `<rect x="${c - 2.5}" y="4" width="5" height="${s - 8}" rx="2" fill="${core}"/>` +
        `<rect x="4" y="${c - 2.5}" width="${s - 8}" height="5" rx="2" fill="${core}"/>` +
        `<circle cx="${c}" cy="${c}" r="2.5" fill="${toHex(lighten(color, 0.9))}"/>`;
      return { svg: vfxDoc(id, s, s, color, body), viewW: s, viewH: s, footYFrac: 1 };
    }
    case 'stun': {
      // Orbiting stars around an empty center, meant to spin over an entity.
      const s = 40;
      const c = s / 2;
      const orbit = c - 6;
      let stars = '';
      const n = 3;
      for (let i = 0; i < n; i += 1) {
        const a = (Math.PI * 2 * i) / n - Math.PI / 2;
        const sx = c + Math.cos(a) * orbit;
        const sy = c + Math.sin(a) * orbit * 0.5;
        stars += `<path d="${starPath(sx, sy, 5, 2, 5)}" fill="${core}" stroke="${mid}" stroke-width="0.6"/>`;
      }
      return { svg: vfxDoc(id, s, s, color, stars), viewW: s, viewH: s, footYFrac: 1 };
    }
    case 'death': {
      // A shatter/burst ring: a thick broken ring with radiating shards.
      const s = 48;
      const c = s / 2;
      const white = toHex(lighten(color, 0.85));
      let body =
        `<circle cx="${c}" cy="${c}" r="${c - 6}" fill="${glow}" opacity="0.4"/>` +
        `<circle cx="${c}" cy="${c}" r="${c - 6}" fill="none" stroke="${core}" stroke-width="3.4" opacity="0.95"/>` +
        `<circle cx="${c}" cy="${c}" r="${(c - 6) * 0.5}" fill="none" stroke="${white}" stroke-width="1.6" opacity="0.8"/>`;
      const shards = 8;
      for (let i = 0; i < shards; i += 1) {
        const a = (Math.PI * 2 * i) / shards + 0.2;
        const ix = c + Math.cos(a) * (c - 8);
        const iy = c + Math.sin(a) * (c - 8);
        const ox = c + Math.cos(a) * (c - 1);
        const oy = c + Math.sin(a) * (c - 1);
        body += `<path d="M${ix.toFixed(2)} ${iy.toFixed(2)} L${ox.toFixed(2)} ${oy.toFixed(2)}" stroke="${mid}" stroke-width="2.4" stroke-linecap="round"/>`;
      }
      return { svg: vfxDoc(id, s, s, color, body), viewW: s, viewH: s, footYFrac: 1 };
    }
  }
}
