/**
 * Structure gating for the original three-lane arena: the full turret -> inhibitor -> nexus
 * turret -> nexus targeting order per side, plus inhibitor respawn timing.
 *
 * This module deliberately contains NO Phaser (or any DOM) imports so it can be
 * exhaustively unit tested in a plain jsdom/node environment. It extends the
 * simple {@link StructureLine} concept in combat.ts into the complete Rift
 * gating graph so the scene and the tests share one source of truth.
 */

import type { GameMode } from '../battleStore';
import { rulesForMode } from '../../config/matchRules';
import { type Lane, type MapSide, LANES } from './map';

/** The categories of building on the Rift, in the order they must fall. */
export type StructureKind =
  | 'outerTurret'
  | 'innerTurret'
  | 'inhibitorTurret'
  | 'inhibitor'
  | 'nexusTurret'
  | 'nexus';

/** A single structure node in the gating graph. */
export interface StructureNode {
  /** Stable id, e.g. `ally-top-outerTurret` or `enemy-nexus`. */
  id: string;
  side: MapSide;
  kind: StructureKind;
  /** The lane this structure belongs to, or null for shared base buildings. */
  lane: Lane | null;
  /**
   * Ids of structures that shield this one: while ANY of them is alive, this
   * structure cannot be targeted. Empty means always targetable (when alive).
   */
  shieldedBy: string[];
}

/** Build a canonical structure id from its parts. */
export function structureId(side: MapSide, kind: StructureKind, lane?: Lane | null): string {
  return lane ? `${side}-${lane}-${kind}` : `${side}-${kind}`;
}

/** A mode name or explicit lane set used to scope a structure graph. */
export type StructureGraphScope = GameMode | readonly Lane[];

function structureLanes(scope: StructureGraphScope = LANES): Lane[] {
  const configured = typeof scope === 'string'
    ? rulesForMode(scope).structures.activeLanes
    : scope;
  const unique = [...new Set(configured)];
  return unique.length > 0 ? unique : [...LANES];
}

/**
 * Build the ordered structure gating graph for one side. Ordering encodes the
 * arena rule set:
 *   - a lane's INNER turret is shielded while its OUTER turret stands;
 *   - the INHIBITOR TURRET is shielded while the INNER turret stands;
 *   - the INHIBITOR is shielded while its inhibitor turret stands;
 *   - the TWO NEXUS TURRETS are shielded until at least one inhibitor is down;
 *   - the NEXUS is shielded while any nexus turret stands.
 *
 * Structures are returned in the order they can generally be destroyed.
 */
export function buildStructureGraph(
  side: MapSide,
  scope: StructureGraphScope = LANES,
): StructureNode[] {
  const activeLanes = structureLanes(scope);
  const nodes: StructureNode[] = [];

  // Per-lane chain: outer -> inner -> inhibitor turret -> inhibitor.
  for (const lane of activeLanes) {
    const outer = structureId(side, 'outerTurret', lane);
    const inner = structureId(side, 'innerTurret', lane);
    const inhibTurret = structureId(side, 'inhibitorTurret', lane);
    const inhib = structureId(side, 'inhibitor', lane);

    nodes.push({ id: outer, side, kind: 'outerTurret', lane, shieldedBy: [] });
    nodes.push({ id: inner, side, kind: 'innerTurret', lane, shieldedBy: [outer] });
    nodes.push({ id: inhibTurret, side, kind: 'inhibitorTurret', lane, shieldedBy: [inner] });
    nodes.push({ id: inhib, side, kind: 'inhibitor', lane, shieldedBy: [inhibTurret] });
  }

  // The two nexus turrets are shielded until at least ONE inhibitor is down.
  // Model that as being shielded by ALL inhibitors: while every inhibitor still
  // stands the turrets are shielded; once any falls, the shield lifts.
  const inhibitorIds = activeLanes.map((lane) => structureId(side, 'inhibitor', lane));
  const nexusTurretA = structureId(side, 'nexusTurret', null) + '-a';
  const nexusTurretB = structureId(side, 'nexusTurret', null) + '-b';
  nodes.push({ id: nexusTurretA, side, kind: 'nexusTurret', lane: null, shieldedBy: [...inhibitorIds] });
  nodes.push({ id: nexusTurretB, side, kind: 'nexusTurret', lane: null, shieldedBy: [...inhibitorIds] });

  // The nexus is shielded while EITHER nexus turret stands.
  const nexus = structureId(side, 'nexus', null);
  nodes.push({ id: nexus, side, kind: 'nexus', lane: null, shieldedBy: [nexusTurretA, nexusTurretB] });

  return nodes;
}

/** The ids of every structure on a side, in destruction order. */
export function targetableOrder(
  side: MapSide,
  scope: StructureGraphScope = LANES,
): string[] {
  return buildStructureGraph(side, scope).map((n) => n.id);
}

/**
 * Whether the structure `structureId` may currently be targeted, given the set
 * of still-living structure ids. A structure is targetable only when it is
 * itself alive and NONE of its shields are alive.
 *
 * The nexus-turret special case (shielded until ANY inhibitor falls) is handled
 * here: nexus turrets are shielded only while ALL of their inhibitor shields
 * remain alive.
 */
export function isStructureTargetable(
  id: string,
  livingIds: ReadonlySet<string>,
  scope: StructureGraphScope = LANES,
): boolean {
  if (!livingIds.has(id)) return false;

  // Find the node across both sides so callers do not need to pass the side.
  const node =
    buildStructureGraph('ally', scope).find((n) => n.id === id) ??
    buildStructureGraph('enemy', scope).find((n) => n.id === id);
  if (!node) return true;
  if (node.shieldedBy.length === 0) return true;

  if (node.kind === 'nexusTurret') {
    // Shielded only while EVERY inhibitor still stands. Once any inhibitor is
    // destroyed the nexus turrets become targetable.
    const allInhibitorsAlive = node.shieldedBy.every((s) => livingIds.has(s));
    return !allInhibitorsAlive;
  }

  // Default: shielded while ANY shield structure is still alive.
  return !node.shieldedBy.some((s) => livingIds.has(s));
}

// ---------------------------------------------------------------------------
// Inhibitor respawn
// ---------------------------------------------------------------------------

/** Three-lane inhibitor recovery time, sourced from match rules. */
export const INHIBITOR_RESPAWN_SECONDS =
  rulesForMode('conquest').structures.inhibitorRespawnSeconds;

/**
 * The game time (seconds) at which an inhibitor destroyed at `killedAtSeconds`
 * will respawn.
 */
export function inhibitorRespawnAt(
  killedAtSeconds: number,
  mode: GameMode = 'conquest',
): number {
  return killedAtSeconds + rulesForMode(mode).structures.inhibitorRespawnSeconds;
}

/**
 * Whether an inhibitor destroyed at `killedAtSeconds` is currently respawned
 * (alive) at `nowSeconds`. A `killedAtSeconds` of null/undefined means it has
 * never been destroyed and is alive.
 */
export function isInhibitorAlive(
  nowSeconds: number,
  killedAtSeconds: number | null,
  mode: GameMode = 'conquest',
): boolean {
  if (killedAtSeconds == null) return true;
  return nowSeconds >= inhibitorRespawnAt(killedAtSeconds, mode);
}

/**
 * A structure's rollback state.
 *
 * Separate from the scene's Entity because that holds Phaser containers and cannot be rewound. What a rollback needs
 * is only this: how much health is left, and — for an inhibitor — the absolute time it went down.
 */
export interface StructureState {
  hp: number;
  maxHp: number;
  dead: boolean;
  /**
   * When this structure was destroyed, in sim seconds, or null while it stands.
   *
   * ABSOLUTE, never a countdown, and this is load-bearing rather than stylistic: a countdown cannot be rewound
   * without also knowing how many ticks were undone, so a rollback would have to reconstruct information the state
   * does not carry. An absolute stamp is simply true or not true at whatever time the replay lands on.
   */
  killedAt: number | null;
}

/** A structure at full health. */
export function initialStructure(maxHp: number): StructureState {
  return { hp: maxHp, maxHp, dead: false, killedAt: null };
}

/**
 * Bring back every inhibitor whose respawn time has arrived.
 *
 * Pure, returning a new record. The predicate is the existing isInhibitorAlive, so this is not a second
 * implementation of the timing rule — it is the record-level step that rule never had, which is why the scene kept
 * its own Map of kill times instead. A Map is precisely the shape a snapshot cannot carry: the clone contract in
 * worldStep documents that a JSON round-trip turns one into {}, so kill times held that way could never be rewound.
 */
export function reviveStructures(
  structures: Record<string, StructureState>,
  nowSeconds: number,
  mode: GameMode = 'conquest',
): Record<string, StructureState> {
  const next: Record<string, StructureState> = {};
  for (const [id, structure] of Object.entries(structures)) {
    if (structure.killedAt !== null && isInhibitorAlive(nowSeconds, structure.killedAt, mode)) {
      next[id] = { hp: structure.maxHp, maxHp: structure.maxHp, dead: false, killedAt: null };
    } else {
      next[id] = { ...structure };
    }
  }
  return next;
}
