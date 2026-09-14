import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { wrapTextLines } from './wrap-text.ts';

const byLength = (s: string) => s.length;

describe('wrapTextLines', () => {
  it('returns no lines for empty or whitespace', () => {
    assert.deepEqual(wrapTextLines('', 10, byLength), []);
    assert.deepEqual(wrapTextLines('   ', 10, byLength), []);
  });

  it('returns no lines when maxWidth is not positive', () => {
    assert.deepEqual(wrapTextLines('hello', 0, byLength), []);
    assert.deepEqual(wrapTextLines('hello', -1, byLength), []);
  });

  it('keeps a short phrase on one line', () => {
    assert.deepEqual(wrapTextLines('Ada Lovelace', 20, byLength), ['Ada Lovelace']);
  });

  it('wraps on spaces before breaking words', () => {
    assert.deepEqual(wrapTextLines('Ada Lovelace', 8, byLength), ['Ada', 'Lovelace']);
  });

  it('splits a long token with no spaces', () => {
    assert.deepEqual(wrapTextLines('Supercalifragilistic', 8, byLength), [
      'Supercal',
      'ifragili',
      'stic',
    ]);
  });

  it('wraps on spaces first, then splits a leftover long word', () => {
    assert.deepEqual(wrapTextLines('hi Supercalifragilistic', 10, byLength), [
      'hi',
      'Supercalif',
      'ragilistic',
    ]);
  });

  it('emits a character even when it is wider than maxWidth', () => {
    const measure = (s: string) => s.length * 10;
    assert.deepEqual(wrapTextLines('ab', 5, measure), ['a', 'b']);
  });

  it('caps lines and ellipsizes the last one', () => {
    assert.deepEqual(wrapTextLines('abcdefghijklmnopqrstuvwxyz', 5, byLength, 2), [
      'abcde',
      'fghi…',
    ]);
  });
});
