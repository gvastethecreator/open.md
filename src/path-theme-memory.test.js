import { describe, expect, it, vi } from 'vitest';
import {
  createPathThemePreferenceCoordinator,
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

  it('applies only a distinct remembered theme through the coordinator seam', async () => {
    let snapshot = {
      advanced: { pathRemembersTheme: true },
      pathThemes: { entries: { 'x:/docs': 'Paper' } },
    };
    let currentTheme = 'Github Dark';
    const applyTheme = vi.fn(async (themeName) => { currentTheme = themeName; });
    const coordinator = createPathThemePreferenceCoordinator({
      preferences: { current: () => snapshot, update: vi.fn() },
      getCurrentThemeName: () => currentTheme,
      applyTheme,
    });

    await expect(coordinator.applyForPath('X:\\docs\\guide.md')).resolves.toEqual({
      status: 'applied',
      themeName: 'Paper',
    });
    expect(applyTheme).toHaveBeenCalledWith('Paper', { silent: true, persist: false });
    await expect(coordinator.applyForPath('X:\\docs\\guide.md')).resolves.toEqual({
      status: 'unchanged',
      themeName: 'Paper',
    });
    expect(applyTheme).toHaveBeenCalledOnce();

    snapshot = { advanced: { pathRemembersTheme: false }, pathThemes: { entries: {} } };
    await expect(coordinator.applyForPath('X:\\docs\\guide.md')).resolves.toEqual({
      status: 'ignored',
    });
    expect(applyTheme).toHaveBeenCalledOnce();
  });

  it('owns global versus path persistence and forwards volatile results', async () => {
    let snapshot = {
      advanced: { pathRemembersTheme: true },
      pathThemes: { entries: { 'x:/other': 'Ayu Dark' } },
    };
    const update = vi.fn(async () => ({ status: 'volatile' }));
    const coordinator = createPathThemePreferenceCoordinator({
      preferences: { current: () => snapshot, update },
      getCurrentPath: () => 'X:\\docs\\guide.md',
    });

    await expect(coordinator.persistSelection('Paper')).resolves.toEqual({ status: 'volatile' });
    expect(update).toHaveBeenLastCalledWith({
      themeName: 'Paper',
      pathThemes: {
        version: 1,
        entries: { 'x:/other': 'Ayu Dark', 'x:/docs': 'Paper' },
      },
    });

    snapshot = { advanced: { pathRemembersTheme: false }, pathThemes: { entries: {} } };
    await coordinator.persistSelection('Github Light');
    expect(update).toHaveBeenLastCalledWith({ themeName: 'Github Light' });

    coordinator.dispose();
    await expect(coordinator.persistSelection('Ayu Dark')).resolves.toEqual({ status: 'disposed' });
    expect(update).toHaveBeenCalledTimes(2);
  });
});
