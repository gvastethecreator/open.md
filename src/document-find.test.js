import { describe, expect, it } from 'vitest';
import { findTextMatches } from './document-find.js';

describe('document find', () => {
  it('finds literal case-insensitive text with exact Unicode offsets', () => {
    expect(findTextMatches('A [b]. a [B].', '[b].')).toEqual([{ start: 2, end: 6 }, { start: 9, end: 13 }]);
    expect(findTextMatches('😀 Écho éCHO', 'écho')).toEqual([{ start: 3, end: 7 }, { start: 8, end: 12 }]);
    expect(findTextMatches('unchanged', '')).toEqual([]);
    expect(findTextMatches('unchanged', 'missing')).toEqual([]);
  });
});
