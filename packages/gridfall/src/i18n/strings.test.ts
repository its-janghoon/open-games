import { describe, it, expect } from 'vitest';

import { LANGUAGES, resolveLanguage, STRINGS, tr, type TrKey } from './strings';

const KEYS = Object.keys(STRINGS) as TrKey[];

/**
 * The same three data tests Ringout's table carries, deliberately duplicated rather than shared.
 *
 * Sharing them would need a helper package importing both tables, which couples two games so that one's new key
 * can break the other's suite. Three short tests per game is the cheaper trade, and the reason each exists is
 * the same in both places.
 */
describe('string table', () => {
  it('carries every key in both languages', () => {
    // A missing Korean string does not crash — it silently shows English to someone who may not read it, which
    // is exactly the failure a type cannot catch.
    for (const key of KEYS) {
      for (const language of LANGUAGES) {
        const value = STRINGS[key][language];
        expect(typeof value, `${key}.${language}`).toBe('string');
        expect(value.trim(), `${key}.${language} is empty`).not.toBe('');
      }
    }
  });

  it('never leaves a Korean string identical to its English one by accident', () => {
    // Entries that SHOULD match are listed, so a genuinely untranslated string cannot hide among them. The
    // control diagrams are latin key names in both languages; the brand is a proper noun.
    const deliberatelyIdentical = new Set<TrKey>(['brand.name']);
    // Compared as plain strings: TypeScript narrows each entry to its literal type and can prove the two unions
    // never overlap, so a direct === is a compile error rather than a check.
    const identical = KEYS.filter(
      (key) =>
        String(STRINGS[key].en) === String(STRINGS[key].ko) && !deliberatelyIdentical.has(key),
    );
    expect(identical, 'untranslated strings').toEqual([]);
  });

  it('declares the same placeholders in both languages', () => {
    // A placeholder present in one locale and missing in the other renders a sentence with a hole in it for
    // exactly the players reading that locale.
    const holes = (text: string) => (text.match(/\{(\w+)\}/g) ?? []).sort();
    for (const key of KEYS) {
      expect(holes(STRINGS[key].ko), `${key} placeholders`).toEqual(holes(STRINGS[key].en));
    }
  });

  it('fills placeholders and leaves unknown ones visible', () => {
    expect(tr('net.desync', 'en', { tick: 412 })).toContain('412');
    expect(tr('net.desync', 'ko', { tick: 412 })).toContain('412');
    // Left visible rather than replaced with 'undefined', so a mistake reads as an obvious fault.
    expect(tr('net.desync', 'en')).toContain('{tick}');
  });

  it('is Korean-first', () => {
    expect(LANGUAGES[0]).toBe('ko');
  });

  it('picks English only for an en tag, and Korean for everything else', () => {
    // The tag is passed in rather than read from navigator, because the first version of this test asserted the
    // Korean default and failed with 'en' — vitest's environment reports en-US, so the test was measuring the
    // runner's locale rather than the function.
    expect(resolveLanguage('en-US')).toBe('en');
    expect(resolveLanguage('EN')).toBe('en');
    expect(resolveLanguage('ko-KR')).toBe('ko');
    expect(resolveLanguage('ja-JP'), 'anything unrecognised lands on Korean').toBe('ko');
    expect(resolveLanguage('')).toBe('ko');
  });
});
