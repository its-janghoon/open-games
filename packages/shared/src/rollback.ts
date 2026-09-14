/**
 * Input-only rollback netcode, as a reusable core.
 *
 * The shape of the problem: two players on a local network cannot both know the
 * other's input for the current tick, because the input has not arrived yet. Waiting
 * for it adds a round trip to every frame, which is what makes lockstep feel heavy.
 * Rollback instead PREDICTS the remote input, keeps simulating, and when the real
 * input arrives for an earlier tick, rewinds to just before that tick and replays
 * forward with the truth. The player sees a small correction instead of a stall.
 *
 * Two properties make it work, and both are the caller's responsibility rather than
 * this file's:
 *
 *   1. The simulation must be DETERMINISTIC. Same state plus same inputs must give
 *      the same next state, every time, on every machine. Rollback on a
 *      nondeterministic simulation does not fail loudly - it silently desyncs, and
 *      the two players slowly come to disagree about who is alive.
 *   2. State must be SNAPSHOTTABLE and restorable. Rewinding means restoring an
 *      earlier state exactly, so a state holding references to render objects,
 *      timers, or anything outside the simulation cannot be rewound.
 *
 * Only INPUTS travel. That is the whole reason this is affordable on a phone over
 * a local network: a tick's input is a handful of bytes, where a world snapshot is
 * kilobytes, so bandwidth stays flat as the world grows.
 *
 * Snapshots are kept every `snapshotInterval` ticks rather than every tick, because
 * a snapshot per tick costs memory proportional to the rollback window times the
 * world size. The cost of the interval is that a rollback re-simulates from the
 * nearest earlier snapshot, so the interval trades memory against how much work a
 * correction does.
 */

/** A deterministic simulation this core can rewind and replay. */
export interface Simulation<State, Input> {
  /** A fresh state at tick 0. Called once. */
  initial(): State;
  /**
   * Advance one fixed step. MUST be pure with respect to the arguments: no clock, no
   * Math.random, no iteration over unordered collections whose order can differ.
   */
  step(state: State, inputs: ReadonlyMap<string, Input>, tick: number): State;
  /**
   * A restorable copy. Deep enough that mutating the returned value cannot affect the
   * original, or a rollback will restore a state that has already drifted.
   */
  clone(state: State): State;
  /** What a participant is assumed to be doing when their input has not arrived. */
  predict(participantId: string, lastKnown: Input | undefined, tick: number): Input;
}

export interface RollbackOptions {
  /** Participant ids, fixed for the session. Order is irrelevant - inputs are keyed. */
  participants: readonly string[];
  /** Ticks between snapshots. Larger saves memory and makes each rollback do more work. */
  snapshotInterval?: number;
  /**
   * How far back a late input may reach. An input older than this is REFUSED rather
   * than applied, because there is no snapshot left to rewind to and applying it to
   * the wrong base would desync both sides quietly.
   */
  maxRollbackTicks?: number;
}

export const DEFAULT_SNAPSHOT_INTERVAL = 8;
export const DEFAULT_MAX_ROLLBACK_TICKS = 120;

/** Why an input was not accepted. Named so a caller can react rather than guess. */
export type InputRejection = 'too-old' | 'unknown-participant' | 'future-tick';

export interface ApplyResult {
  accepted: boolean;
  rejection?: InputRejection;
  /** How many ticks were re-simulated. 0 when the input needed no correction. */
  resimulated: number;
}

interface Snapshot<State> {
  tick: number;
  state: State;
}

export class RollbackSession<State, Input> {
  private readonly sim: Simulation<State, Input>;
  private readonly participants: readonly string[];
  private readonly snapshotInterval: number;
  private readonly maxRollbackTicks: number;

  /** Confirmed inputs: participant -> tick -> input. Absent means not yet received. */
  private readonly confirmed = new Map<string, Map<number, Input>>();
  /** The input actually USED at each tick, real or predicted, for exact replay. */
  private readonly used = new Map<number, Map<string, Input>>();
  private snapshots: Snapshot<State>[] = [];
  private state: State;
  private currentTick = 0;

  constructor(sim: Simulation<State, Input>, options: RollbackOptions) {
    this.sim = sim;
    this.participants = [...options.participants];
    this.snapshotInterval = Math.max(1, options.snapshotInterval ?? DEFAULT_SNAPSHOT_INTERVAL);
    this.maxRollbackTicks = Math.max(1, options.maxRollbackTicks ?? DEFAULT_MAX_ROLLBACK_TICKS);
    for (const id of this.participants) this.confirmed.set(id, new Map());
    this.state = sim.initial();
    this.snapshots.push({ tick: 0, state: sim.clone(this.state) });
  }

  get tick(): number {
    return this.currentTick;
  }

  /** The live state. Treat as read-only: mutating it corrupts every future rollback. */
  peek(): State {
    return this.state;
  }

  /** Record a local input. Local inputs are always for the tick about to run. */
  setLocalInput(participantId: string, input: Input): boolean {
    const store = this.confirmed.get(participantId);
    if (!store) return false;
    store.set(this.currentTick, input);
    return true;
  }

  /**
   * Advance one tick, predicting any input that has not arrived.
   *
   * The inputs used are RECORDED, not just applied. A replay has to reproduce the
   * original run exactly up to the corrected tick, and that means replaying the same
   * predictions - recomputing them would risk a different guess and a different
   * outcome for ticks that were never wrong.
   */
  advance(): void {
    const inputs = new Map<string, Input>();
    for (const id of this.participants) {
      const store = this.confirmed.get(id)!;
      const real = store.get(this.currentTick);
      inputs.set(id, real ?? this.sim.predict(id, this.lastKnownBefore(id, this.currentTick), this.currentTick));
    }
    this.used.set(this.currentTick, inputs);

    this.state = this.sim.step(this.state, inputs, this.currentTick);
    this.currentTick += 1;
    if (this.currentTick % this.snapshotInterval === 0) {
      this.snapshots.push({ tick: this.currentTick, state: this.sim.clone(this.state) });
      this.pruneSnapshots();
    }
  }

  /** Advance until the given tick is reached. A tick already passed is a no-op. */
  advanceTo(tick: number): void {
    while (this.currentTick < tick) this.advance();
  }

  /**
   * Apply a confirmed remote input for a tick that may already have been simulated.
   *
   * Returns what happened. A rollback occurs only when the tick was already simulated
   * AND the input differs from what was used - an input that merely confirms a correct
   * prediction costs nothing, which is the common case on a local network and the
   * reason this is cheap in practice.
   */
  applyRemoteInput(participantId: string, tick: number, input: Input): ApplyResult {
    const store = this.confirmed.get(participantId);
    if (!store) return { accepted: false, rejection: 'unknown-participant', resimulated: 0 };
    if (tick > this.currentTick) return { accepted: false, rejection: 'future-tick', resimulated: 0 };
    if (this.currentTick - tick > this.maxRollbackTicks) {
      return { accepted: false, rejection: 'too-old', resimulated: 0 };
    }

    const oldest = this.snapshots[0]?.tick ?? 0;
    if (tick < oldest) return { accepted: false, rejection: 'too-old', resimulated: 0 };

    store.set(tick, input);

    // Not yet simulated: nothing to correct, the input will simply be used.
    if (tick === this.currentTick) return { accepted: true, resimulated: 0 };

    const usedInput = this.used.get(tick)?.get(participantId);
    if (usedInput !== undefined && this.sameInput(usedInput, input)) {
      return { accepted: true, resimulated: 0 };
    }

    return { accepted: true, resimulated: this.rollbackTo(tick) };
  }

  /**
   * Rewind to the newest snapshot at or before `tick` and replay to the head.
   *
   * Replay uses confirmed inputs where they exist and the ORIGINALLY USED prediction
   * otherwise, so ticks that were never wrong come out identical.
   */
  private rollbackTo(tick: number): number {
    let base = this.snapshots[0];
    for (const snapshot of this.snapshots) {
      if (snapshot.tick <= tick) base = snapshot;
      else break;
    }

    const head = this.currentTick;
    this.state = this.sim.clone(base.state);
    this.currentTick = base.tick;
    // Snapshots after the base describe a future that no longer happened.
    this.snapshots = this.snapshots.filter((snapshot) => snapshot.tick <= base.tick);

    let resimulated = 0;
    while (this.currentTick < head) {
      const at = this.currentTick;
      const inputs = new Map<string, Input>();
      for (const id of this.participants) {
        const real = this.confirmed.get(id)!.get(at);
        const previouslyUsed = this.used.get(at)?.get(id);
        inputs.set(
          id,
          real ?? previouslyUsed ?? this.sim.predict(id, this.lastKnownBefore(id, at), at),
        );
      }
      this.used.set(at, inputs);
      this.state = this.sim.step(this.state, inputs, at);
      this.currentTick += 1;
      resimulated += 1;
      if (this.currentTick % this.snapshotInterval === 0) {
        this.snapshots.push({ tick: this.currentTick, state: this.sim.clone(this.state) });
      }
    }
    this.pruneSnapshots();
    return resimulated;
  }

  /** The newest confirmed input for a participant strictly before a tick. */
  private lastKnownBefore(participantId: string, tick: number): Input | undefined {
    const store = this.confirmed.get(participantId);
    if (!store) return undefined;
    let best: Input | undefined;
    let bestTick = -1;
    for (const [at, input] of store) {
      if (at < tick && at > bestTick) {
        bestTick = at;
        best = input;
      }
    }
    return best;
  }

  /**
   * Compare inputs structurally. Inputs are small plain values by design, so JSON is
   * adequate and avoids requiring every caller to supply an equality function - but
   * it is also why an Input must not contain a Map, a Set, or a class instance.
   */
  private sameInput(a: Input, b: Input): boolean {
    if (a === b) return true;
    return JSON.stringify(a) === JSON.stringify(b);
  }

  /** Drop snapshots and input history that can no longer be rolled back to. */
  private pruneSnapshots(): void {
    const horizon = this.currentTick - this.maxRollbackTicks;
    if (horizon <= 0) return;
    // Keep the newest snapshot at or before the horizon, so a rollback exactly at the
    // limit still has a base to restore from.
    let keepFrom = 0;
    for (let i = 0; i < this.snapshots.length; i += 1) {
      if (this.snapshots[i].tick <= horizon) keepFrom = i;
      else break;
    }
    if (keepFrom > 0) this.snapshots = this.snapshots.slice(keepFrom);

    for (const tick of [...this.used.keys()]) {
      if (tick < this.snapshots[0].tick) this.used.delete(tick);
    }
    for (const store of this.confirmed.values()) {
      for (const tick of [...store.keys()]) {
        if (tick < this.snapshots[0].tick) store.delete(tick);
      }
    }
  }

  /** Diagnostics, for a test or an on-screen netcode readout. */
  stats(): { tick: number; snapshots: number; oldestSnapshot: number; trackedTicks: number } {
    return {
      tick: this.currentTick,
      snapshots: this.snapshots.length,
      oldestSnapshot: this.snapshots[0]?.tick ?? 0,
      trackedTicks: this.used.size,
    };
  }
}
