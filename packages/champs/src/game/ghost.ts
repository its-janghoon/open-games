import { scoreAiIntents, type AiIntent, type AiSnapshot } from './ai';

/**
 * Ghosts: a shareable record of how someone PLAYS, not of what they did.
 *
 * The obvious implementation is a replay - store the input stream, play it back.
 * It is also the wrong one here. A replay reproduces one match and nothing else: the
 * moment the world diverges by a single tick, a random roll, or a different champion
 * pick, the recording is describing a game that no longer exists and the ghost walks
 * into a wall. What a player actually wants from "fight my friend's ghost" is an
 * opponent that makes the KIND of decisions their friend makes, in a match their
 * friend never played.
 *
 * So a ghost is a policy, and it is built on the policy the game already has rather
 * than beside it. ai.ts scores seven intents each decision; a ghost is a small bias
 * over those scores. That has three properties worth the constraint:
 *
 *   - It composes. The bias rides on top of scoreAiIntents, so every improvement to
 *     the base AI improves every ghost, and a ghost can never produce an action the
 *     base policy considers impossible (a cast on cooldown stays impossible).
 *   - It generalises. Biases are about preference, not position, so they transfer to
 *     a different champion, lane and match length.
 *   - It is TINY. Seven biases plus three thresholds fit in twelve bytes, which is
 *     what makes a pasteable code possible at all.
 *
 * The honest limit, stated because it shapes expectations: this captures style
 * (aggressive, cautious, ability-hungry, tower-shy), not skill. It does not learn
 * combos, timing windows, or map awareness, and a ghost of an excellent player is a
 * ghost of their PREFERENCES rather than an excellent opponent.
 */

/** Every intent the base policy scores, in a fixed order the code depends on. */
export const GHOST_INTENTS: readonly AiIntent[] = [
  'approach',
  'attack',
  'castQ',
  'castW',
  'castE',
  'castR',
  'retreat',
] as const;

/** Current wire format. A decoder refuses anything else rather than guessing. */
export const GHOST_VERSION = 1;

/** Bias range. Kept small on purpose: a ghost tilts the policy, it does not replace it. */
export const BIAS_MIN = -60;
export const BIAS_MAX = 60;

export interface GhostPolicy {
  version: number;
  /** Score offset per intent, in the same units scoreAiIntents produces. */
  bias: Record<AiIntent, number>;
  /** Hp fraction below which this player tends to disengage, 0..1. */
  retreatHp: number;
  /** Preferred engagement distance as a multiple of attack range, 0.5..3. */
  engageRange: number;
  /** How readily abilities are spent, 0..1. */
  abilityEagerness: number;
}

/** A neutral ghost: identical to the base AI. Useful as a baseline and a fallback. */
export function neutralGhost(): GhostPolicy {
  return {
    version: GHOST_VERSION,
    bias: Object.fromEntries(GHOST_INTENTS.map((i) => [i, 0])) as Record<AiIntent, number>,
    retreatHp: 0.3,
    engageRange: 1,
    abilityEagerness: 0.5,
  };
}

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

/* -------------------------------------------------------------------------- */
/* Learning                                                                    */
/* -------------------------------------------------------------------------- */

/** One observed decision: what the player could have done, and what they did. */
export interface GhostObservation {
  snapshot: AiSnapshot;
  chosen: AiIntent;
}

/**
 * Learn a ghost from observed decisions.
 *
 * The measure is DISAGREEMENT with the base policy, not raw frequency, and that
 * distinction is the whole method. Counting how often a player pressed attack would
 * mostly record how often attacking was the only sensible move - every player looks
 * identical by that measure. What distinguishes them is the choice they make when the
 * base policy would have chosen otherwise: taking the fight at 30% hp, or backing off
 * from a winnable trade. So a bias accrues only when the player's choice differs from
 * the policy's, scaled by how strongly the policy disagreed.
 *
 * Fewer than MIN_OBSERVATIONS decisions returns a neutral ghost rather than a
 * confident one: a code learned from four decisions would be noise wearing a
 * player's name.
 */
export const MIN_OBSERVATIONS = 24;

export function learnGhost(observations: readonly GhostObservation[]): GhostPolicy {
  const ghost = neutralGhost();
  if (observations.length < MIN_OBSERVATIONS) return ghost;

  const totals = Object.fromEntries(GHOST_INTENTS.map((i) => [i, 0])) as Record<AiIntent, number>;
  let retreatHpSum = 0;
  let retreatHpCount = 0;
  let engageSum = 0;
  let engageCount = 0;
  let casts = 0;
  let castOpportunities = 0;

  for (const { snapshot, chosen } of observations) {
    const scores = scoreAiIntents(snapshot);
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const intent of GHOST_INTENTS) {
      const score = scores[intent];
      if (Number.isFinite(score) && score > bestScore) bestScore = score;
    }
    const chosenScore = scores[chosen];
    if (Number.isFinite(chosenScore) && Number.isFinite(bestScore)) {
      // Positive when the player picked something the policy rated below its own
      // choice. Zero when they agreed, so agreement teaches nothing.
      totals[chosen] += bestScore - chosenScore;
    }

    if (chosen === 'retreat') {
      retreatHpSum += snapshot.selfHpPct;
      retreatHpCount += 1;
    }
    if (chosen === 'attack' || chosen === 'approach') {
      if (snapshot.attackRange > 0) {
        engageSum += snapshot.distanceToTarget / snapshot.attackRange;
        engageCount += 1;
      }
    }
    const couldCast = (['castQ', 'castW', 'castE', 'castR'] as const).some((intent) =>
      Number.isFinite(scores[intent]),
    );
    if (couldCast) {
      castOpportunities += 1;
      if (chosen.startsWith('cast')) casts += 1;
    }
  }

  // Normalise by observation count so a long match and a short one produce
  // comparable ghosts, then clamp: a ghost tilts the policy, it does not replace it.
  for (const intent of GHOST_INTENTS) {
    ghost.bias[intent] = clamp(Math.round(totals[intent] / observations.length), BIAS_MIN, BIAS_MAX);
  }
  if (retreatHpCount > 0) ghost.retreatHp = clamp(retreatHpSum / retreatHpCount, 0, 1);
  if (engageCount > 0) ghost.engageRange = clamp(engageSum / engageCount, 0.5, 3);
  if (castOpportunities > 0) ghost.abilityEagerness = clamp(casts / castOpportunities, 0, 1);

  return ghost;
}

/* -------------------------------------------------------------------------- */
/* Acting                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Decide an action for a ghost.
 *
 * The bias is ADDED to the base score, never substituted for it, so an action the
 * base policy ruled out - a cast on cooldown scores -Infinity - stays ruled out no
 * matter how much a ghost prefers it. That is the property that keeps a shared code
 * from producing an illegal or absurd opponent, including a code someone hand-edited.
 */
export function ghostDecide(snapshot: AiSnapshot, ghost: GhostPolicy): AiIntent {
  const scores = scoreAiIntents(snapshot);
  let best: AiIntent = GHOST_INTENTS[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const intent of GHOST_INTENTS) {
    const base = scores[intent];
    if (!Number.isFinite(base)) continue; // impossible stays impossible
    let score = base + (ghost.bias[intent] ?? 0);
    if (intent === 'retreat' && snapshot.selfHpPct <= ghost.retreatHp) score += 25;
    if (intent.startsWith('cast')) score += (ghost.abilityEagerness - 0.5) * 30;
    if (score > bestScore) {
      bestScore = score;
      best = intent;
    }
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* Codes                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Crockford base32: no I, L, O or U, so a code read aloud or typed from a screenshot
 * does not turn into a different code. Decoding folds the excluded letters back onto
 * the digits people mistake them for.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const DECODE_FIXUPS: Record<string, string> = { I: '1', L: '1', O: '0', U: 'V' };

/** Bytes: [version, 7 biases, retreatHp, engageRange, eagerness, checksum]. */
const PAYLOAD_BYTES = 1 + GHOST_INTENTS.length + 3;

function checksum(bytes: readonly number[]): number {
  // Fletcher-style, one byte. Enough to reject a typo or a truncated paste, and not
  // pretending to be a signature - a ghost code is not a credential.
  let a = 0;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 255;
    b = (b + a) % 255;
  }
  return (a ^ b) & 0xff;
}

function toBase32(bytes: readonly number[]): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(code: string): number[] | null {
  const cleaned = code
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .split('')
    .map((c) => DECODE_FIXUPS[c] ?? c)
    .join('');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of cleaned) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return out;
}

/** Encode a ghost as a short, pasteable code. */
export function encodeGhost(ghost: GhostPolicy): string {
  const bytes = [
    ghost.version & 0xff,
    ...GHOST_INTENTS.map((intent) => clamp(Math.round(ghost.bias[intent] ?? 0), BIAS_MIN, BIAS_MAX) + 128),
    Math.round(clamp(ghost.retreatHp, 0, 1) * 200),
    Math.round(clamp(ghost.engageRange, 0.5, 3) * 80),
    Math.round(clamp(ghost.abilityEagerness, 0, 1) * 200),
  ];
  const code = toBase32([...bytes, checksum(bytes)]);
  // Grouped in fours: a 24-character run is hard to read back to someone.
  return code.replace(/(.{4})(?=.)/g, '$1-');
}

export type GhostDecodeError =
  | 'malformed'
  | 'wrong-length'
  | 'bad-checksum'
  | 'unsupported-version';

export type GhostDecodeResult =
  | { ok: true; ghost: GhostPolicy }
  | { ok: false; error: GhostDecodeError };

/**
 * Decode a ghost code.
 *
 * Refuses rather than repairs. Every failure mode a pasted string actually has -
 * a dropped character, a swapped digit, a code from a future version, random text -
 * returns a named error, because the alternative is a ghost that silently plays like
 * nobody and a player who thinks the feature is broken.
 */
export function decodeGhost(code: string): GhostDecodeResult {
  const bytes = fromBase32(code);
  if (bytes === null) return { ok: false, error: 'malformed' };
  if (bytes.length < PAYLOAD_BYTES + 1) return { ok: false, error: 'wrong-length' };

  const payload = bytes.slice(0, PAYLOAD_BYTES);
  const sum = bytes[PAYLOAD_BYTES];
  if (checksum(payload) !== sum) return { ok: false, error: 'bad-checksum' };
  if (payload[0] !== GHOST_VERSION) return { ok: false, error: 'unsupported-version' };

  const bias = {} as Record<AiIntent, number>;
  GHOST_INTENTS.forEach((intent, i) => {
    bias[intent] = clamp(payload[1 + i] - 128, BIAS_MIN, BIAS_MAX);
  });
  const base = 1 + GHOST_INTENTS.length;
  return {
    ok: true,
    ghost: {
      version: payload[0],
      bias,
      retreatHp: clamp(payload[base] / 200, 0, 1),
      engageRange: clamp(payload[base + 1] / 80, 0.5, 3),
      abilityEagerness: clamp(payload[base + 2] / 200, 0, 1),
    },
  };
}
