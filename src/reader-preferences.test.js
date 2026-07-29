import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_READER_PREFERENCES,
  createMemoryPreferenceStore,
  createReaderPreferences,
  createWebPreferenceStore,
} from './reader-preferences.js';

const KEYS = {
  theme: 'openmd-theme',
  tools: 'openmd-reading-tools-v1',
  fonts: 'openmd-font-preferences-v1',
  alwaysOnTop: 'openmd-always-on-top',
};

describe('reader preferences', () => {
  it('loads existing theme, tools, fonts and native window values', async () => {
    const store = createMemoryPreferenceStore({
      [KEYS.theme]: 'Ayu Dark',
      [KEYS.tools]: JSON.stringify({ lineGuide: true, minimap: 'true', source: false, stats: true }),
      [KEYS.fonts]: JSON.stringify({ sans: 2, mono: 1 }),
      [KEYS.alwaysOnTop]: 'true',
    });
    const setAlwaysOnTop = vi.fn(async () => undefined);
    const preferences = createReaderPreferences({ store, windowPin: { setAlwaysOnTop } });

    const result = await preferences.load();

    expect(result.status).toBe('loaded');
    expect(preferences.current()).toEqual({
      themeName: 'Ayu Dark',
      readingTools: { lineGuide: true, minimap: false, source: false, stats: true },
      fonts: { sans: 2, mono: 1 },
      alwaysOnTop: true,
    });
    expect(setAlwaysOnTop).toHaveBeenCalledWith(true);
  });

  it('falls back safely when persisted JSON or storage access is corrupt', async () => {
    const store = createMemoryPreferenceStore({
      [KEYS.theme]: '',
      [KEYS.tools]: '{broken',
      [KEYS.fonts]: JSON.stringify({ sans: 999, mono: -1 }),
      [KEYS.alwaysOnTop]: 'not-a-boolean',
    });
    const preferences = createReaderPreferences({ store });

    const result = await preferences.load();

    expect(result.status).toBe('fallback');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(preferences.current()).toEqual(DEFAULT_READER_PREFERENCES);
  });

  it('applies, notifies and saves compatible theme, tool and font values', async () => {
    const store = createMemoryPreferenceStore();
    const preferences = createReaderPreferences({ store });
    const listener = vi.fn();
    preferences.subscribe(listener);
    await preferences.load();

    await preferences.update({ themeName: 'Paper' });
    await preferences.update({ readingTools: { source: true, stats: true } });
    await preferences.update({ fonts: { sans: 1, mono: 2 } });

    expect(preferences.current()).toMatchObject({
      themeName: 'Paper',
      readingTools: { source: true, stats: true },
      fonts: { sans: 1, mono: 2 },
    });
    expect(store.dump()).toMatchObject({
      [KEYS.theme]: 'Paper',
      [KEYS.tools]: JSON.stringify({ lineGuide: false, minimap: false, source: true, stats: true }),
      [KEYS.fonts]: JSON.stringify({ sans: 1, mono: 2 }),
    });
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('rolls back an always-on-top change when the native adapter fails', async () => {
    const store = createMemoryPreferenceStore({ [KEYS.alwaysOnTop]: 'false' });
    const setAlwaysOnTop = vi.fn(async () => {
      throw new Error('Native failure');
    });
    const preferences = createReaderPreferences({ store, windowPin: { setAlwaysOnTop } });
    await preferences.load();

    const result = await preferences.update({ alwaysOnTop: true });

    expect(result.status).toBe('failed');
    expect(preferences.current().alwaysOnTop).toBe(false);
    expect(store.dump()[KEYS.alwaysOnTop]).toBe('false');
  });

  it('repairs a saved native pin when restoration fails', async () => {
    const store = createMemoryPreferenceStore({ [KEYS.alwaysOnTop]: 'true' });
    const preferences = createReaderPreferences({
      store,
      windowPin: {
        setAlwaysOnTop: vi.fn(async () => {
          throw new Error('Restore failed');
        }),
      },
    });

    const result = await preferences.load();

    expect(result.status).toBe('fallback');
    expect(preferences.current().alwaysOnTop).toBe(false);
    expect(store.dump()[KEYS.alwaysOnTop]).toBe('false');
  });

  it('adapts Web Storage and keeps changes in memory when persistence is unavailable', async () => {
    const values = new Map();
    const webStorage = {
      getItem: vi.fn((key) => values.get(key) ?? null),
      setItem: vi.fn((key, value) => values.set(key, value)),
      removeItem: vi.fn((key) => values.delete(key)),
    };
    const available = createReaderPreferences({ store: createWebPreferenceStore(webStorage) });
    await available.load();
    await available.update({ themeName: 'Paper' });
    expect(webStorage.setItem).toHaveBeenCalledWith(KEYS.theme, 'Paper');

    const unavailable = createReaderPreferences({
      store: {
        get: () => { throw new Error('Storage blocked'); },
        set: () => { throw new Error('Storage blocked'); },
      },
    });
    expect((await unavailable.load()).status).toBe('fallback');
    const result = await unavailable.update({ themeName: 'Ayu Light' });
    expect(result.status).toBe('volatile');
    expect(unavailable.current().themeName).toBe('Ayu Light');
  });
});
