import { describe, it, expect } from 'vitest';
import {
  currentObjective,
  tutorialComplete,
  OBJECTIVES,
  WARMTH_ADVISORY,
  LOW_WARMTH_ADVISORY_RATIO,
  type ObjectiveView,
} from './ObjectiveSystem';
import { STRINGS } from '../i18n/strings';

/**
 * Pure-logic tests for the new-player ObjectiveSystem (FEAT-003). No Phaser: the
 * whole state machine is a deterministic function of a plain view, so every
 * scenario is a hand-built view. Covers the ordered core-loop progression, the
 * low-warmth advisory priority, and completion (null).
 */

/** A brand-new hold: level-1 Furnace, nothing else, fully warm, no army/battle. */
function freshView(): ObjectiveView {
  return {
    furnaceLevel: 1,
    levels: { furnace: 1 },
    warmthRatio: 1,
    armySize: 0,
    battleFought: false,
  };
}

describe('ObjectiveSystem.currentObjective', () => {
  it('points a brand-new hold at upgrading the Furnace first', () => {
    const obj = currentObjective(freshView());
    expect(obj?.id).toBe('furnace_1');
    expect(obj?.target).toBe('furnace');
  });

  it('advances to the Hunters\u2019 Hut once the Furnace hits Lv.2', () => {
    const obj = currentObjective({ ...freshView(), furnaceLevel: 2, levels: { furnace: 2 } });
    expect(obj?.id).toBe('hunters_hut');
    expect(obj?.target).toBe('hunters_hut');
  });

  it('advances to the Sawmill once the Hunters\u2019 Hut is built', () => {
    const obj = currentObjective({
      furnaceLevel: 2,
      levels: { furnace: 2, hunters_hut: 1 },
      warmthRatio: 1,
      armySize: 0,
      battleFought: false,
    });
    expect(obj?.id).toBe('sawmill');
    expect(obj?.target).toBe('sawmill');
  });

  it('asks for a second Furnace level after the raw producers are up', () => {
    const obj = currentObjective({
      furnaceLevel: 2,
      levels: { furnace: 2, hunters_hut: 1, sawmill: 1 },
      warmthRatio: 1,
      armySize: 0,
      battleFought: false,
    });
    expect(obj?.id).toBe('furnace_2');
    expect(obj?.target).toBe('furnace');
  });

  it('points at the War Camp once the Furnace is Lv.3', () => {
    const obj = currentObjective({
      furnaceLevel: 3,
      levels: { furnace: 3, hunters_hut: 1, sawmill: 1 },
      warmthRatio: 1,
      armySize: 0,
      battleFought: false,
    });
    expect(obj?.id).toBe('war_camp');
    expect(obj?.target).toBe('war_camp');
  });

  it('asks the player to train once the War Camp is built', () => {
    const obj = currentObjective({
      furnaceLevel: 3,
      levels: { furnace: 3, hunters_hut: 1, sawmill: 1, war_camp: 1 },
      warmthRatio: 1,
      armySize: 0,
      battleFought: false,
    });
    expect(obj?.id).toBe('train');
  });

  it('asks the player to march to battle once troops are trained', () => {
    const obj = currentObjective({
      furnaceLevel: 3,
      levels: { furnace: 3, hunters_hut: 1, sawmill: 1, war_camp: 1 },
      warmthRatio: 1,
      armySize: 5,
      battleFought: false,
    });
    expect(obj?.id).toBe('battle');
  });

  it('returns null when every ordered objective is complete (warm hold)', () => {
    const obj = currentObjective({
      furnaceLevel: 3,
      levels: { furnace: 3, hunters_hut: 1, sawmill: 1, war_camp: 1 },
      warmthRatio: 1,
      armySize: 5,
      battleFought: true,
    });
    expect(obj).toBeNull();
  });

  it('follows the objectives in strict order as the view progresses', () => {
    const seen: string[] = [];
    // Drive through by satisfying each objective's predicate one at a time.
    const steps: ObjectiveView[] = [
      { furnaceLevel: 1, levels: { furnace: 1 }, warmthRatio: 1, armySize: 0, battleFought: false },
      { furnaceLevel: 2, levels: { furnace: 2 }, warmthRatio: 1, armySize: 0, battleFought: false },
      { furnaceLevel: 2, levels: { furnace: 2, hunters_hut: 1 }, warmthRatio: 1, armySize: 0, battleFought: false },
      { furnaceLevel: 2, levels: { furnace: 2, hunters_hut: 1, sawmill: 1 }, warmthRatio: 1, armySize: 0, battleFought: false },
      { furnaceLevel: 3, levels: { furnace: 3, hunters_hut: 1, sawmill: 1 }, warmthRatio: 1, armySize: 0, battleFought: false },
      { furnaceLevel: 3, levels: { furnace: 3, hunters_hut: 1, sawmill: 1, war_camp: 1 }, warmthRatio: 1, armySize: 0, battleFought: false },
      { furnaceLevel: 3, levels: { furnace: 3, hunters_hut: 1, sawmill: 1, war_camp: 1 }, warmthRatio: 1, armySize: 3, battleFought: false },
    ];
    for (const s of steps) seen.push(currentObjective(s)!.id);
    expect(seen).toEqual([
      'furnace_1',
      'hunters_hut',
      'sawmill',
      'furnace_2',
      'war_camp',
      'train',
      'battle',
    ]);
  });
});

describe('ObjectiveSystem low-warmth advisory', () => {
  it('takes priority over the ordered list when warmth is low', () => {
    // A Sawmill stands, so the hold CAN make fuel and the ordinary keep-it-stocked
    // advice is followable. Without one it is stranded instead and gets different
    // advice - see stranded.test.ts - because telling a hold with no timber to
    // stock timber is advice it cannot act on.
    const obj = currentObjective({
      ...freshView(),
      levels: { ...freshView().levels, sawmill: 1 },
      warmthRatio: 0.2,
    });
    expect(obj?.id).toBe('warmth');
    expect(obj?.target).toBe('furnace');
    expect(obj).toBe(WARMTH_ADVISORY);
  });

  it('surfaces for a returning player (completed tutorial) when warmth is low', () => {
    const done: ObjectiveView = {
      furnaceLevel: 4,
      levels: { furnace: 4, hunters_hut: 2, sawmill: 2, war_camp: 2 },
      warmthRatio: 0.3,
      armySize: 20,
      battleFought: true,
    };
    expect(currentObjective(done)?.id).toBe('warmth');
  });

  it('does NOT fire when warmth is just above the advisory threshold', () => {
    const obj = currentObjective({ ...freshView(), warmthRatio: LOW_WARMTH_ADVISORY_RATIO + 0.01 });
    expect(obj?.id).toBe('furnace_1');
  });

  it('fires exactly AT the advisory threshold (inclusive)', () => {
    const obj = currentObjective({
      ...freshView(),
      levels: { ...freshView().levels, sawmill: 1 },
      warmthRatio: LOW_WARMTH_ADVISORY_RATIO,
    });
    expect(obj?.id).toBe('warmth');
  });
});

describe('ObjectiveSystem.tutorialComplete', () => {
  it('is false for a fresh hold', () => {
    expect(tutorialComplete(freshView())).toBe(false);
  });

  it('is true once every ordered objective is satisfied (regardless of warmth)', () => {
    const done: ObjectiveView = {
      furnaceLevel: 3,
      levels: { furnace: 3, hunters_hut: 1, sawmill: 1, war_camp: 1 },
      warmthRatio: 0.1, // even freezing, the ORDERED tutorial itself is done
      armySize: 5,
      battleFought: true,
    };
    expect(tutorialComplete(done)).toBe(true);
  });
});

describe('ObjectiveSystem determinism + string wiring', () => {
  it('is pure: the same view yields the same objective', () => {
    const v = freshView();
    expect(currentObjective(v)?.id).toBe(currentObjective(v)?.id);
  });

  it('every objective label + instruction key exists in the string table', () => {
    for (const obj of [...OBJECTIVES, WARMTH_ADVISORY]) {
      expect(STRINGS[obj.label], `label missing: ${obj.label}`).toBeTruthy();
      expect(STRINGS[obj.instruction], `instruction missing: ${obj.instruction}`).toBeTruthy();
    }
  });

  it('every objective has a stable, unique id', () => {
    const ids = [...OBJECTIVES, WARMTH_ADVISORY].map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
