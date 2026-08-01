import { describe, expect, it } from 'vitest';
import {
  dirnamePath,
  normalizeThemePath,
  resolvePathTheme,
  upsertPathTheme,
} from './path-theme-memory.js';

describe('path-theme-memory', () => {
  it('normalizes windows paths for stable keys', () => {
    expect(normalizeThemePath('X:\\docs\\Project\\')).toBe('x:/docs/Project');
    expect(dirnamePath('X:\\docs\\Project\\readme.md')).toBe('x:/docs/Project');
  });

  it('resolves longest ancestor match for folder and children', () => {
    const entries = {
      'x:/docs': 'Paper',
      'x:/docs/project': 'Ayu Dark',
    };
    expect(resolvePathTheme('x:/docs/project/readme.md', entries)).toBe('Ayu Dark');
    expect(resolvePathTheme('x:/docs/project/sub/a.md', entries)).toBe('Ayu Dark');
    expect(resolvePathTheme('x:/docs/other/note.md', entries)).toBe('Paper');
    expect(resolvePathTheme('x:/elsewhere/a.md', entries)).toBeNull();
  });

  it('upserts by parent directory of the open file', () => {
    const next = upsertPathTheme({}, 'X:\\docs\\project\\readme.md', 'Github Dark');
    expect(next).toEqual({ 'x:/docs/project': 'Github Dark' });
    expect(resolvePathTheme('X:\\docs\\project\\nested\\b.md', next)).toBe('Github Dark');
  });
});
