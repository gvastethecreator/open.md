import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_READER_PREFERENCES,
  createMemoryPreferenceStore,
  createOptionalWebPreferenceStore,
  createReaderPreferences,
  createWebPreferenceStore,
} from './reader-preferences.js';

const KEYS = {
  theme: 'openmd-theme',
  tools: 'openmd-reading-tools-v1',
  fonts: 'openmd-font-preferences-v1',
  alwaysOnTop: 'openmd-always-on-top',
  autoSave: 'openmd-auto-save',
};

describe('reader preferences', () => {
  it('loads existing theme, tools, fonts and native window values', async () => {
    const store = createMemoryPreferenceStore({
      [KEYS.theme]: 'Ayu Dark',
      [KEYS.tools]: JSON.stringify({ lineGuide: true, minimap: 'true', source: false, stats: true }),
      [KEYS.fonts]: JSON.stringify({ sans: 2, mono: 1 }),
      [KEYS.alwaysOnTop]: 'true',
      [KEYS.autoSave]: 'false',
    });
    const setAlwaysOnTop = vi.fn(async () => undefined);
    const preferences = createReaderPreferences({ store, windowPin: { setAlwaysOnTop } });

    const result = await preferences.load();

    expect(result.status).toBe('loaded');
    expect(preferences.current()).toMatchObject({
      themeName: 'Ayu Dark',
      readingTools: {
        lineGuide: true,
        minimap: false,
        source: false,
        stats: true,
        wordWrap: true,
      },
      fonts: { sans: 2, mono: 1 },
      alwaysOnTop: true,
      autoSave: false,
      advanced: {
        magicSniff: true,
        imageDefaultZoom: 'fit',
        imageZoomAnimation: true,
        csvRowCap: 500,
      },
    });
    expect(setAlwaysOnTop).toHaveBeenCalledWith(true);
  });

  it('persists and normalizes advanced preferences (F13)', async () => {
    const store = createMemoryPreferenceStore();
    const preferences = createReaderPreferences({ store });
    await preferences.load();
    await preferences.update({
      advanced: {
        imageDefaultZoom: '100%',
        csvRowCap: 99999,
        magicSniff: false,
        textMinimapDefault: true,
      },
    });
    const snapshot = preferences.current().advanced;
    expect(snapshot.imageDefaultZoom).toBe('100%');
    expect(snapshot.csvRowCap).toBe(5000);
    expect(snapshot.magicSniff).toBe(false);
    expect(snapshot.textMinimapDefault).toBe(true);
    expect(store.dump()['openmd-advanced-preferences-v1']).toContain('100%');
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
    await preferences.update({ readingTools: { source: true, stats: true, wordWrap: false } });
    await preferences.update({ fonts: { sans: 1, mono: 2 } });
    await preferences.update({ autoSave: false });

    expect(preferences.current()).toMatchObject({
      themeName: 'Paper',
      readingTools: { source: true, stats: true, wordWrap: false },
      fonts: { sans: 1, mono: 2 },
      autoSave: false,
    });
    expect(store.dump()).toMatchObject({
      [KEYS.theme]: 'Paper',
      [KEYS.tools]: JSON.stringify({
        lineGuide: false,
        minimap: false,
        source: true,
        stats: true,
        wordWrap: false,
      }),
      [KEYS.fonts]: JSON.stringify({ sans: 1, mono: 2 }),
      [KEYS.autoSave]: 'false',
    });
    expect(listener).toHaveBeenCalledTimes(5);
  });

  it('defaults auto-save on and repairs an invalid stored value', async () => {
    const defaults = createReaderPreferences({ store: createMemoryPreferenceStore() });
    await defaults.load();
    expect(defaults.current().autoSave).toBe(true);

    const invalid = createReaderPreferences({
      store: createMemoryPreferenceStore({ [KEYS.autoSave]: 'sometimes' }),
    });
    const result = await invalid.load();
    expect(result.status).toBe('fallback');
    expect(invalid.current().autoSave).toBe(true);
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

  it('serializes rapid native pin changes so the last request wins', async () => {
    let releasePin;
    const firstPin = new Promise((resolve) => { releasePin = resolve; });
    const windowPin = {
      setAlwaysOnTop: vi.fn((value) => value ? firstPin : Promise.resolve()),
    };
    const store = createMemoryPreferenceStore();
    const preferences = createReaderPreferences({ store, windowPin });
    await preferences.load();

    const turnOn = preferences.update({ alwaysOnTop: true });
    await vi.waitFor(() => expect(windowPin.setAlwaysOnTop).toHaveBeenCalledWith(true));
    const turnOff = preferences.update({ alwaysOnTop: false });
    const themeChange = preferences.update({ themeName: 'Paper' });

    await Promise.resolve();
    expect(preferences.current().themeName).toBe('Paper');

    releasePin();
    await Promise.all([turnOn, turnOff, themeChange]);

    expect(windowPin.setAlwaysOnTop.mock.calls.map(([value]) => value)).toEqual([true, false]);
    expect(preferences.current().alwaysOnTop).toBe(false);
    expect(preferences.current().themeName).toBe('Paper');
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

  it('falls back when acquiring Web Storage throws', () => {
    const blockedWindow = {};
    Object.defineProperty(blockedWindow, 'localStorage', {
      get() {
        throw new DOMException('Storage blocked', 'SecurityError');
      },
    });

    expect(createOptionalWebPreferenceStore(blockedWindow)).toBeNull();
  });
});
