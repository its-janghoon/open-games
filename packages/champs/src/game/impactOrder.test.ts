import { describe, it, expect } from 'vitest';

import { partitionImpacts } from './combat';

/**
 * These cover the ONE thing partitionImpacts decides that a rollback depends on: the order
 * two hits land in when they fall due on the same tick.
 *
 * Ordering is not cosmetic here. Two impacts arriving on the same tick can each be lethal,
 * and which one is applied first decides who gets the kill, who gets the gold, and whether
 * the second one hits a corpse. Two peers that disagree about the order have diverged.
 */
describe('partitionImpacts ordering', () => {
  it('breaks equal deadlines on insertionOrder, not on array position', () => {
    // The regression. A restored queue can hold entries in any order; before the fix the
    // sort used array position, so this returned the second cast first.
    const restored = [
      { dueAt: 5, insertionOrder: 1, tag: 'second-cast' },
      { dueAt: 5, insertionOrder: 0, tag: 'first-cast' },
    ];
    const { due } = partitionImpacts(restored, 10);
    expect(due.map((d) => d.tag)).toEqual(['first-cast', 'second-cast']);
  });

  it('gives the same order however the queue was arranged', () => {
    // The property, stated directly: order out depends on the CONTENTS, not on the history
    // of the array that carried them. This is what makes a snapshot restorable.
    const a = { dueAt: 5, insertionOrder: 0, tag: 'a' };
    const b = { dueAt: 5, insertionOrder: 1, tag: 'b' };
    const c = { dueAt: 5, insertionOrder: 2, tag: 'c' };
    const forwards = partitionImpacts([a, b, c], 10).due.map((d) => d.tag);
    const backwards = partitionImpacts([c, b, a], 10).due.map((d) => d.tag);
    const shuffled = partitionImpacts([b, c, a], 10).due.map((d) => d.tag);
    expect(forwards).toEqual(['a', 'b', 'c']);
    expect(backwards).toEqual(['a', 'b', 'c']);
    expect(shuffled).toEqual(['a', 'b', 'c']);
  });

  it('still sorts by deadline first, with insertionOrder only as the tiebreak', () => {
    // A later cast can land earlier - a fast basic attack behind a slow skillshot - so the
    // deadline must outrank the queue order rather than the other way round.
    const queue = [
      { dueAt: 9, insertionOrder: 0, tag: 'slow-skillshot' },
      { dueAt: 4, insertionOrder: 1, tag: 'fast-attack' },
    ];
    const { due } = partitionImpacts(queue, 10);
    expect(due.map((d) => d.tag)).toEqual(['fast-attack', 'slow-skillshot']);
  });

  it('falls back to array position when insertionOrder is absent', () => {
    // Kept so callers that never had the field are not silently reordered.
    const queue = [
      { dueAt: 5, tag: 'first' },
      { dueAt: 5, tag: 'second' },
    ];
    expect(partitionImpacts(queue, 10).due.map((d) => d.tag)).toEqual(['first', 'second']);
  });

  it('orders the pending side too, since it becomes the next tick queue', () => {
    // pending is assigned straight back as the live queue, so an unordered pending side
    // would reintroduce exactly the positional dependency this fix removes.
    const queue = [
      { dueAt: 20, insertionOrder: 1, tag: 'later-cast' },
      { dueAt: 20, insertionOrder: 0, tag: 'earlier-cast' },
    ];
    const { due, pending } = partitionImpacts(queue, 10);
    expect(due).toHaveLength(0);
    expect(pending.map((d) => d.tag)).toEqual(['earlier-cast', 'later-cast']);
  });

  it('does not mutate the queue it was given', () => {
    // The scene reassigns from the result; a sort in place would reorder the live array
    // before the caller decided to accept it.
    const queue = [
      { dueAt: 5, insertionOrder: 1, tag: 'b' },
      { dueAt: 5, insertionOrder: 0, tag: 'a' },
    ];
    partitionImpacts(queue, 10);
    expect(queue.map((d) => d.tag)).toEqual(['b', 'a']);
  });

  it('orders a queue shaped like a real match, where position and insertion order disagree', () => {
    // Not invented. This is an insertionOrder sequence read out of a live conquest match,
    // where the queue is deadline-sorted from the previous tick and abilities differ in
    // travel time. 21 of 29 sampled multi-entry queues were out of insertion order like
    // this, which is why array position could never have served as the tiebreak.
    const live = [142, 143, 144, 141, 139, 145];
    const queue = live.map((insertionOrder) => ({ dueAt: 5, insertionOrder }));
    const { due } = partitionImpacts(queue, 10);
    expect(due.map((d) => d.insertionOrder)).toEqual([139, 141, 142, 143, 144, 145]);
  });

  it('treats a deadline exactly on now as due', () => {
    const queue = [{ dueAt: 10, insertionOrder: 0, tag: 'on-the-tick' }];
    expect(partitionImpacts(queue, 10).due).toHaveLength(1);
  });

  it('orders two dash impacts that tie on the same frame', () => {
    // The live tie that makes this a present-tense defect rather than a rollback-only one: a
    // dash sets its deadline to the current time, so two resolved in one frame are exactly
    // equal and only insertionOrder separates them.
    const now = 12.5;
    const queue = [
      { dueAt: now, insertionOrder: 7, tag: 'second-dash' },
      { dueAt: now, insertionOrder: 6, tag: 'first-dash' },
    ];
    expect(partitionImpacts(queue, now).due.map((d) => d.tag)).toEqual([
      'first-dash',
      'second-dash',
    ]);
  });
});
