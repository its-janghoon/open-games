/**
 * Jungle simulation for the original three-lane arena: neutral camps with respawn timers and
 * bounties, plus the Blue and Red buffs granted by the two buff camps.
 *
 * This module deliberately contains NO Phaser (or any DOM) imports so it can be
 * exhaustively unit tested in a plain jsdom/node environment. Camp positions
 * are drawn from {@link ./map} anchors and bounties from {@link ./economy}.
 */

import { type MapSide, type Vec2, JUNGLE_CAMPS } from './map';
import { type Bounty, type JungleCampKind, jungleCampBounty } from './economy';

/** The camp archetypes we model (a representative Rift set). */
export type CampType =
  | 'blue'
  | 'red'
  | 'raptors'
  | 'wolves'
  | 'gromp'
  | 'krugs'
  | 'scuttle';

export interface CampMember {
  key: string;
  hp: number;
  ad: number;
  armor: number;
  scale: number;
}

/** A neutral jungle camp instance and its deterministic pack composition. */
export interface Camp {
  id: string;
  type: CampType;
  side: MapSide;
  pos: Vec2;
  respawnSeconds: number;
  bounty: Bounty;
  members: readonly CampMember[];
}

/** Respawn cooldown per camp type, in seconds. */
export const CAMP_RESPAWN_SECONDS: Record<CampType, number> = {
  blue: 300,
  red: 300,
  raptors: 135,
  wolves: 135,
  gromp: 135,
  krugs: 135,
  scuttle: 150,
};

/** Bounty per camp type. Scuttle (a neutral objective) grants a modest reward. */
const SCUTTLE_BOUNTY: Bounty = { gold: 55, xp: 55 };

function campBountyFor(type: CampType): Bounty {
  if (type === 'scuttle') return SCUTTLE_BOUNTY;
  return jungleCampBounty(type as JungleCampKind);
}

/** Stable actor packs. Pack bounty and buff are awarded only after the final member falls. */
export const CAMP_PACKS: Record<CampType, readonly CampMember[]> = {
  blue: [{ key: 'blue-sentinel', hp: 2600, ad: 120, armor: 25, scale: 1.45 }],
  red: [{ key: 'red-bramble', hp: 2600, ad: 120, armor: 25, scale: 1.45 }],
  gromp: [{ key: 'gromp', hp: 1500, ad: 85, armor: 15, scale: 1.1 }],
  wolves: [
    { key: 'greater-wolf', hp: 900, ad: 70, armor: 15, scale: 1 },
    { key: 'wolf-a', hp: 450, ad: 40, armor: 10, scale: 0.72 },
    { key: 'wolf-b', hp: 450, ad: 40, armor: 10, scale: 0.72 },
  ],
  raptors: [
    { key: 'crimson-raptor', hp: 850, ad: 65, armor: 15, scale: 1 },
    { key: 'raptor-a', hp: 300, ad: 32, armor: 8, scale: 0.62 },
    { key: 'raptor-b', hp: 300, ad: 32, armor: 8, scale: 0.62 },
    { key: 'raptor-c', hp: 300, ad: 32, armor: 8, scale: 0.62 },
  ],
  krugs: [
    { key: 'ancient-krug', hp: 1200, ad: 80, armor: 20, scale: 1.15 },
    { key: 'krug', hp: 650, ad: 50, armor: 15, scale: 0.82 },
  ],
  scuttle: [{ key: 'river-scuttle', hp: 1100, ad: 40, armor: 10, scale: 0.8 }],
};

/** Derive the camp type from a map anchor id like `ally-blue`. */
function typeFromAnchorId(id: string): CampType {
  const suffix = id.split('-').slice(1).join('-');
  return suffix as CampType;
}

/**
 * The full set of jungle camps, built from the map anchors. Each camp carries
 * its respawn timer and bounty so systems and tests share one source of truth.
 * A scuttle crab is added on the river for each side.
 */
export const CAMPS: readonly Camp[] = [
  ...JUNGLE_CAMPS.map((anchor) => {
    const type = typeFromAnchorId(anchor.id);
    return {
      id: anchor.id,
      type,
      side: anchor.side,
      pos: { x: anchor.pos.x, y: anchor.pos.y },
      respawnSeconds: CAMP_RESPAWN_SECONDS[type],
      bounty: campBountyFor(type),
      members: CAMP_PACKS[type],
    } satisfies Camp;
  }),
  {
    id: 'ally-scuttle',
    type: 'scuttle',
    side: 'ally',
    pos: { x: 1980, y: 1980 },
    respawnSeconds: CAMP_RESPAWN_SECONDS.scuttle,
    bounty: campBountyFor('scuttle'),
    members: CAMP_PACKS.scuttle,
  },
  {
    id: 'enemy-scuttle',
    type: 'scuttle',
    side: 'enemy',
    pos: { x: 1020, y: 1020 },
    respawnSeconds: CAMP_RESPAWN_SECONDS.scuttle,
    bounty: campBountyFor('scuttle'),
    members: CAMP_PACKS.scuttle,
  },
];

/** The game time (seconds) at which a camp killed at `killedAtSeconds` respawns. */
export function campRespawnAt(camp: Camp, killedAtSeconds: number): number {
  return killedAtSeconds + camp.respawnSeconds;
}

/**
 * Whether `camp` is alive at `nowSeconds`. `lastKilledAt` of null/undefined
 * means the camp has never been killed (alive). Otherwise it is alive once the
 * respawn time has been reached.
 */
export function isCampAlive(
  camp: Camp,
  nowSeconds: number,
  lastKilledAt: number | null,
): boolean {
  if (lastKilledAt == null) return true;
  return nowSeconds >= campRespawnAt(camp, lastKilledAt);
}

// ---------------------------------------------------------------------------
// Buffs
// ---------------------------------------------------------------------------

/** The buff kinds granted by the two buff camps. */
export type BuffKind = 'blue' | 'red';

/** How long a buff lasts once picked up, in seconds. */
export const BUFF_DURATION_SECONDS = 120;

/**
 * Numeric effect of each buff kind. Blue buff models cooldown reduction and
 * resource (mana) regeneration; Red buff models bonus on-hit damage and a slow
 * applied to the target. These feed into champion stats numerically.
 */
export interface BuffEffect {
  /** Fractional cooldown reduction, 0..1 (blue only). */
  cooldownReduction: number;
  /** Mana/resource regen per second (blue only). */
  resourceRegenPerSecond: number;
  /** Flat bonus damage on basic attacks (red only). */
  bonusDamage: number;
  /** Fractional movement slow applied to the target on hit, 0..1 (red only). */
  slowPercent: number;
}

/** Effect payloads for the two buff kinds. */
export const BUFF_EFFECTS: Record<BuffKind, BuffEffect> = {
  blue: {
    cooldownReduction: 0.1,
    resourceRegenPerSecond: 5,
    bonusDamage: 0,
    slowPercent: 0,
  },
  red: {
    cooldownReduction: 0,
    resourceRegenPerSecond: 0,
    bonusDamage: 15,
    slowPercent: 0.2,
  },
};

/** A single active buff on a champion. */
export interface ActiveBuff {
  kind: BuffKind;
  /** Game time (seconds) at which this buff expires. */
  expiresAt: number;
}

/** A small record of the buffs currently held by an entity. */
export interface BuffState {
  buffs: ActiveBuff[];
}

/** A fresh, empty buff state. */
export function createBuffState(): BuffState {
  return { buffs: [] };
}

/**
 * Apply a buff of `kind` at `nowSeconds`, expiring after
 * {@link BUFF_DURATION_SECONDS}. Re-applying the same kind refreshes its timer
 * rather than stacking. Mutates and returns the state.
 */
export function applyBuff(state: BuffState, kind: BuffKind, nowSeconds: number): BuffState {
  const expiresAt = nowSeconds + BUFF_DURATION_SECONDS;
  const existing = state.buffs.find((b) => b.kind === kind);
  if (existing) {
    existing.expiresAt = expiresAt;
  } else {
    state.buffs.push({ kind, expiresAt });
  }
  return state;
}

/**
 * Remove any buffs that have expired by `nowSeconds`. Mutates and returns the
 * state.
 */
/**
 * Drop every buff that has lapsed, as a NEW state.
 *
 * This used to assign back into `state.buffs` and return the same object, and no caller used the return value — all three
 * relied on the mutation. That is the hazard fixed in efea604 for effect queries: a function that looks like a read
 * rewrites the world, so the world depends on how many times it was called rather than only on its inputs. A replay that
 * expires once where the original expired twice then diverges, and nothing about the call sites hints at it.
 *
 * Now that buffs are snapshot state, a mutating expire would also reach backwards through a shared reference into a
 * restored snapshot. Returning a new state makes that impossible rather than merely unlikely.
 */
export function expireBuffs(state: BuffState, nowSeconds: number): BuffState {
  return { buffs: state.buffs.filter((b) => b.expiresAt > nowSeconds) };
}

/** Whether a buff of `kind` is currently active at `nowSeconds`. */
export function hasBuff(state: BuffState, kind: BuffKind, nowSeconds: number): boolean {
  return state.buffs.some((b) => b.kind === kind && b.expiresAt > nowSeconds);
}
