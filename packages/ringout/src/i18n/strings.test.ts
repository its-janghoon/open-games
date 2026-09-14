import { describe, it, expect } from 'vitest';

import { EMPTY_TALLY, recordRound } from '../game/tally';
import { LANGUAGES, STRINGS, tr, type Language, type TrKey } from './strings';

const KEYS = Object.keys(STRINGS) as TrKey[];

describe('string table', () => {
  it('carries every key in both languages', () => {
    // A missing Korean string does not crash — it silently shows English to someone who may not read
    // it, which is precisely the failure a type cannot catch. So it is checked as data.
    for (const key of KEYS) {
      for (const language of LANGUAGES) {
        const value = STRINGS[key][language];
        expect(typeof value, `${key}.${language}`).toBe('string');
        expect(value.trim(), `${key}.${language} is empty`).not.toBe('');
      }
    }
  });

  it('never leaves a Korean string identical to its English one by accident', () => {
    // Some entries SHOULD match — a proper noun, a control diagram of latin key names. Those are listed
    // explicitly, so a genuinely untranslated string cannot hide among them.
    const deliberatelyIdentical = new Set<TrKey>([
      'brand.name',
      'title.controlsP1',
      'result.tally',
    ]);
    const identical = KEYS.filter(
      (key) => STRINGS[key].en === STRINGS[key].ko && !deliberatelyIdentical.has(key),
    );
    expect(identical, 'untranslated strings').toEqual([]);
  });

  it('declares the same placeholders in both languages', () => {
    // A placeholder present in one locale and missing in the other renders a sentence with a hole in it
    // for exactly the players reading that locale, which is the kind of bug nobody sees until release.
    const holes = (text: string) => (text.match(/\{(\w+)\}/g) ?? []).sort();
    for (const key of KEYS) {
      expect(holes(STRINGS[key].ko), `${key} placeholders`).toEqual(holes(STRINGS[key].en));
    }
  });

  it('fills placeholders and leaves unknown ones visible', () => {
    expect(tr('result.ko', 'en', { winner: 'Player 1' })).toContain('Player 1');
    expect(tr('result.ko', 'ko', { winner: '1P' })).toContain('1P');
    // Left in place rather than replaced with 'undefined', so a mistake reads as a visible fault instead
    // of as plausible prose.
    expect(tr('result.ko', 'en')).toContain('{winner}');
  });

  it('is Korean-first, matching the rest of the project', () => {
    expect(LANGUAGES[0]).toBe<Language>('ko');
  });
});

describe('round tally', () => {
  const ids = ['p1', 'p2'] as const;

  it('leaves the tally alone while a round is still running', () => {
    // Called every frame by the scene, so 'ongoing' is the common case. Making it an error would move
    // the guard into the caller, where it would eventually be dropped.
    expect(recordRound(EMPTY_TALLY, { kind: 'ongoing' }, ids)).toBe(EMPTY_TALLY);
  });

  it('credits a knockout and a ring-out to the right side', () => {
    expect(recordRound(EMPTY_TALLY, { kind: 'ko', winner: 'p1' }, ids)).toEqual({
      left: 1,
      right: 0,
      rounds: 1,
    });
    expect(recordRound(EMPTY_TALLY, { kind: 'ringout', winner: 'p2' }, ids)).toEqual({
      left: 0,
      right: 1,
      rounds: 1,
    });
  });

  it('counts a draw as a round fought without awarding it', () => {
    // A counter that skipped draws would disagree with the number of fights the players remember.
    expect(recordRound(EMPTY_TALLY, { kind: 'draw' }, ids)).toEqual({
      left: 0,
      right: 0,
      rounds: 1,
    });
  });

  it('awards nothing for an unknown winner rather than guessing', () => {
    expect(recordRound(EMPTY_TALLY, { kind: 'ko', winner: 'someone-else' }, ids)).toEqual({
      left: 0,
      right: 0,
      rounds: 1,
    });
  });

  it('does not mutate the tally it was given', () => {
    // The scene holds one tally across rounds; a reducer that mutated would make a double call award
    // two points, which is exactly what a rematch path invites.
    const before = { ...EMPTY_TALLY };
    recordRound(before, { kind: 'ko', winner: 'p1' }, ids);
    expect(before).toEqual(EMPTY_TALLY);
  });

  it('accumulates across a series', () => {
    let tally = EMPTY_TALLY;
    tally = recordRound(tally, { kind: 'ko', winner: 'p1' }, ids);
    tally = recordRound(tally, { kind: 'ringout', winner: 'p2' }, ids);
    tally = recordRound(tally, { kind: 'draw' }, ids);
    tally = recordRound(tally, { kind: 'ko', winner: 'p1' }, ids);
    expect(tally).toEqual({ left: 2, right: 1, rounds: 4 });
  });
});
