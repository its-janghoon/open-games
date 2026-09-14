import type { AiIntent } from './ai';
import type { MatchCommand } from '../online/protocol';
import { CHAMPIONS } from '../data/champions';

/**
 * Translate a player's commands into the intent vocabulary the AI policy speaks.
 *
 * This exists because the two sides of a ghost do not share a language. ai.ts reasons
 * in seven intents; a player emits move/cast/purchase/surrender with coordinates. To
 * learn from a human at all, their input has to be read as the intent it expresses -
 * and that reading is a judgement, so it lives here as a pure function with its own
 * tests rather than buried in the battle loop where nothing could check it.
 *
 * The mapping is deliberately LOSSY and returns null often. A ghost learns from
 * decisions that reveal a preference; a command that reveals nothing must contribute
 * nothing, or the model fills up with noise that averages every player back toward
 * the same middle. Three cases return null on purpose:
 *
 *   - Buying an item and surrendering are not combat intents.
 *   - A move with no enemy to be near or far from expresses no preference about
 *     fighting.
 *   - A LATERAL move - one that changes position without meaningfully changing the
 *     distance to the nearest enemy - is dodging, pathing round terrain, or picking up
 *     a rune. Reading it as approach or retreat would invent an opinion the player did
 *     not express.
 */

/** How much closer or farther a move must get before it counts as intent. */
export const LATERAL_TOLERANCE = 40;

/** Within this multiple of attack range, a move onto the target reads as attacking. */
export const ATTACK_COMMIT_RANGE = 1.1;

export interface Point {
  x: number;
  y: number;
}

export interface CommandContext {
  /** Where the player's champion is when the command is issued. */
  self: Point;
  /** Nearest enemy position, or null when there is nothing to fight. */
  nearestEnemy: Point | null;
  /** The player's basic-attack range, for deciding when a move is a commit. */
  attackRange: number;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Slot for a cast command's abilityId, or null when it names no active ability.
 *
 * This function DEFINES the id convention, which is worth stating plainly: the
 * protocol in online/protocol.ts declares `abilityId: string` but nothing in the
 * codebase constructs a CastCommand yet - the wire format was designed ahead of the
 * input layer that will use it. Rather than guess at a format nobody produces, the
 * convention is fixed here as `<championId>.<slot>`, with a bare slot accepted for
 * the common case where the caster is unambiguous.
 *
 * The champion is validated rather than ignored, so a typo in either half is a
 * refusal instead of a silently wrong slot - which is exactly what an earlier
 * version did, matching on an `id` field that Ability does not have and therefore
 * returning the first ability in the table for every input.
 */
export function slotForAbility(abilityId: string): 'Q' | 'W' | 'E' | 'R' | null {
  const isSlot = (value: string): value is 'Q' | 'W' | 'E' | 'R' =>
    value === 'Q' || value === 'W' || value === 'E' || value === 'R';

  const raw = abilityId.trim();
  if (isSlot(raw.toUpperCase()) && raw.length === 1) return raw.toUpperCase() as 'Q' | 'W' | 'E' | 'R';

  const dot = raw.lastIndexOf('.');
  if (dot === -1) return null;
  const championId = raw.slice(0, dot);
  const slot = raw.slice(dot + 1).toUpperCase();
  if (!isSlot(slot)) return null;

  const champion = CHAMPIONS.find((c) => c.id === championId);
  if (!champion) return null;
  return champion.abilities.some((ability) => ability.slot === slot) ? slot : null;
}

/**
 * The intent a command expresses, or null when it expresses none.
 *
 * A cast maps to its slot rather than to a generic "use ability", because which
 * ability a player reaches for is most of what distinguishes them.
 */
export function intentForCommand(
  command: MatchCommand,
  context: CommandContext,
): AiIntent | null {
  if (command.type === 'purchase' || command.type === 'surrender') return null;

  if (command.type === 'cast') {
    const slot = slotForAbility(command.abilityId);
    if (!slot) return null;
    return (`cast${slot}` as AiIntent);
  }

  // move
  const enemy = context.nearestEnemy;
  if (!enemy) return null;
  const before = dist(context.self, enemy);
  const after = dist(command.destination, enemy);

  // Moving onto a target you can already reach is committing to the fight, not
  // repositioning - the player is closing the last few units to swing.
  if (after <= context.attackRange * ATTACK_COMMIT_RANGE && before <= context.attackRange * 2) {
    return 'attack';
  }

  const delta = before - after;
  if (Math.abs(delta) < LATERAL_TOLERANCE) return null;
  return delta > 0 ? 'approach' : 'retreat';
}

/**
 * A bounded recorder.
 *
 * Capped on purpose: a long match issues thousands of commands, and an unbounded
 * buffer is a memory leak that only shows up in the matches people care about most.
 * When the cap is reached the OLDEST observations are dropped, because recent play is
 * the better description of how someone plays now - they learn during a match.
 */
export const MAX_OBSERVATIONS = 512;

export class GhostRecorder<T> {
  private buffer: T[] = [];

  constructor(private readonly cap: number = MAX_OBSERVATIONS) {}

  record(observation: T): void {
    this.buffer.push(observation);
    if (this.buffer.length > this.cap) this.buffer.splice(0, this.buffer.length - this.cap);
  }

  get size(): number {
    return this.buffer.length;
  }

  /** The recorded observations, oldest first. */
  observations(): readonly T[] {
    return this.buffer;
  }

  reset(): void {
    this.buffer = [];
  }
}
