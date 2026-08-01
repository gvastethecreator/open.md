import { freezePathThemes } from './path-theme-memory.js';

const STORAGE_KEYS = Object.freeze({
  theme: 'openmd-theme',
  readingTools: 'openmd-reading-tools-v1',
  fonts: 'openmd-font-preferences-v1',
  alwaysOnTop: 'openmd-always-on-top',
  autoSave: 'openmd-auto-save',
  advanced: 'openmd-advanced-preferences-v1',
  pathThemes: 'openmd-path-themes-v1',
});

export const FONT_PRESETS = Object.freeze({
  sans: Object.freeze([
    { name: 'Inter', value: 'Inter, "Segoe UI", Helvetica, Arial, sans-serif' },
    { name: 'Humanist', value: 'Candara, "Trebuchet MS", "Segoe UI", sans-serif' },
    { name: 'Classic sans', value: '"Gill Sans", "Gill Sans MT", Calibri, Arial, sans-serif' },
  ]),
  mono: Object.freeze([
    { name: 'Cascadia', value: '"Cascadia Code", "Cascadia Mono", "SFMono-Regular", Consolas, monospace' },
    { name: 'Consolas', value: 'Consolas, "Liberation Mono", Menlo, monospace' },
    { name: 'Courier', value: '"Courier New", Courier, monospace' },
  ]),
});

export const DEFAULT_READING_TOOLS = Object.freeze({
  lineGuide: false,
  minimap: false,
  source: false,
  stats: false,
  wordWrap: true,
  // Classic (false) is continuous multiline live preview; true enables block tools.
  blockEditor: false,
});

export const DEFAULT_ADVANCED_PREFERENCES = Object.freeze({
  edgeFade: true,
  imageDefaultZoom: 'fit', // 'fit' | '100%'
  imageZoomAnimation: true,
  csvRowCap: 500,
  randomThemeAtStart: false,
  pathRemembersTheme: false,
});

export const DEFAULT_PATH_THEMES = freezePathThemes({ version: 1, entries: {} });

export function normalizeAdvancedPreferences(value) {
  const imageDefaultZoom = value?.imageDefaultZoom === '100%' || value?.imageDefaultZoom === '1:1'
    ? '100%'
    : 'fit';
  const csvRowCapRaw = Math.floor(Number(value?.csvRowCap));
  const csvRowCap = Number.isFinite(csvRowCapRaw)
    ? Math.min(5000, Math.max(50, csvRowCapRaw))
    : DEFAULT_ADVANCED_PREFERENCES.csvRowCap;
  return Object.freeze({
    edgeFade: value?.edgeFade !== false,
    imageDefaultZoom,
    imageZoomAnimation: value?.imageZoomAnimation !== false,
    csvRowCap,
    randomThemeAtStart: Boolean(value?.randomThemeAtStart),
    pathRemembersTheme: Boolean(value?.pathRemembersTheme),
  });
}

function freezeSnapshot(value) {
  return Object.freeze({
    themeName: value.themeName,
    readingTools: Object.freeze({ ...value.readingTools }),
    fonts: Object.freeze({ ...value.fonts }),
    alwaysOnTop: value.alwaysOnTop,
    autoSave: value.autoSave,
    advanced: normalizeAdvancedPreferences(value.advanced),
    pathThemes: freezePathThemes(value.pathThemes),
  });
}

export const DEFAULT_READER_PREFERENCES = freezeSnapshot({
  themeName: null,
  readingTools: DEFAULT_READING_TOOLS,
  fonts: { sans: 0, mono: 0 },
  alwaysOnTop: false,
  autoSave: true,
  advanced: DEFAULT_ADVANCED_PREFERENCES,
  pathThemes: DEFAULT_PATH_THEMES,
});

export function normalizeReadingTools(value) {
  return Object.fromEntries(
    Object.entries(DEFAULT_READING_TOOLS).map(([key, fallback]) => [
      key,
      typeof value?.[key] === 'boolean' ? value[key] : fallback,
    ])
  );
}

export function normalizeFontIndex(value, itemCount) {
  const count = Math.max(0, Math.floor(Number(itemCount) || 0));
  if (count === 0) return 0;
  const index = Math.floor(Number(value));
  return Number.isFinite(index) && index >= 0 && index < count ? index : 0;
}

function normalizeFonts(value) {
  return Object.fromEntries(
    Object.keys(FONT_PRESETS).map((kind) => [
      kind,
      normalizeFontIndex(value?.[kind], FONT_PRESETS[kind].length),
    ])
  );
}

export function createWebPreferenceStore(storage) {
  if (!storage) throw new Error('A web storage implementation is required');
  return Object.freeze({
    get: (key) => storage.getItem(key),
    set: (key, value) => storage.setItem(key, value),
    remove: (key) => storage.removeItem(key),
  });
}

export function createOptionalWebPreferenceStore(window) {
  try {
    return window?.localStorage ? createWebPreferenceStore(window.localStorage) : null;
  } catch {
    return null;
  }
}

export function createMemoryPreferenceStore(initial = {}) {
  const values = new Map(
    Object.entries(initial).map(([key, value]) => [key, String(value)])
  );
  return Object.freeze({
    get: (key) => values.get(key) ?? null,
    set: (key, value) => values.set(key, String(value)),
    remove: (key) => values.delete(key),
    dump: () => Object.fromEntries(values),
  });
}

export function createReaderPreferences({ store, windowPin = null }) {
  if (typeof store?.get !== 'function' || typeof store?.set !== 'function') {
    throw new Error('Reader preferences require a storage adapter');
  }

  let state = DEFAULT_READER_PREFERENCES;
  let disposed = false;
  let pinChain = Promise.resolve();
  let pinUpdateChain = Promise.resolve();
  const listeners = new Set();

  const notify = () => listeners.forEach((listener) => listener(state));
  const applyNativePin = (value) => {
    const operation = pinChain.then(() => windowPin.setAlwaysOnTop(value));
    pinChain = operation.catch(() => undefined);
    return operation;
  };
  const read = (key, fallback, parse, warnings) => {
    try {
      const raw = store.get(key);
      if (raw === null) return fallback;
      return parse(raw);
    } catch (error) {
      warnings.push({ key, error });
      return fallback;
    }
  };
  const write = (key, value, warnings) => {
    try {
      if (value === null && typeof store.remove === 'function') store.remove(key);
      else store.set(key, value);
      return true;
    } catch (error) {
      warnings.push({ key, error });
      return false;
    }
  };

  const load = async () => {
    if (disposed) throw new Error('Reader preferences are disposed');
    const warnings = [];
    const themeName = read(STORAGE_KEYS.theme, null, (raw) => {
      const value = raw.trim();
      if (!value) throw new Error('Saved theme is empty');
      return value;
    }, warnings);
    const readingTools = read(
      STORAGE_KEYS.readingTools,
      { ...DEFAULT_READING_TOOLS },
      (raw) => normalizeReadingTools(JSON.parse(raw)),
      warnings
    );
    const fonts = read(
      STORAGE_KEYS.fonts,
      { ...DEFAULT_READER_PREFERENCES.fonts },
      (raw) => normalizeFonts(JSON.parse(raw)),
      warnings
    );
    let alwaysOnTop = read(STORAGE_KEYS.alwaysOnTop, false, (raw) => {
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      throw new Error('Saved always-on-top value is invalid');
    }, warnings);
    const autoSave = read(STORAGE_KEYS.autoSave, true, (raw) => {
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      throw new Error('Saved auto-save value is invalid');
    }, warnings);
    const advanced = read(
      STORAGE_KEYS.advanced,
      { ...DEFAULT_ADVANCED_PREFERENCES },
      (raw) => normalizeAdvancedPreferences(JSON.parse(raw)),
      warnings
    );
    const pathThemes = read(
      STORAGE_KEYS.pathThemes,
      DEFAULT_PATH_THEMES,
      (raw) => freezePathThemes(JSON.parse(raw)),
      warnings
    );

    if (alwaysOnTop && windowPin) {
      try {
        await applyNativePin(true);
      } catch (error) {
        warnings.push({ key: STORAGE_KEYS.alwaysOnTop, error });
        alwaysOnTop = false;
        write(STORAGE_KEYS.alwaysOnTop, 'false', warnings);
      }
    }

    state = freezeSnapshot({
      themeName,
      readingTools,
      fonts,
      alwaysOnTop,
      autoSave,
      advanced,
      pathThemes,
    });
    notify();
    return {
      status: warnings.length > 0 ? 'fallback' : 'loaded',
      snapshot: state,
      warnings,
    };
  };

  const applyUpdate = async (patch) => {
    const warnings = [];
    const changesAlwaysOnTop = typeof patch.alwaysOnTop === 'boolean'
      && patch.alwaysOnTop !== state.alwaysOnTop;

    if (changesAlwaysOnTop) {
      if (!windowPin) {
        return { status: 'unavailable', snapshot: state, warnings };
      }
      try {
        await applyNativePin(patch.alwaysOnTop);
      } catch (error) {
        return { status: 'failed', snapshot: state, warnings: [{ key: STORAGE_KEYS.alwaysOnTop, error }] };
      }
    }

    const nextThemeName = patch.themeName === null
      ? null
      : typeof patch.themeName === 'string' && patch.themeName.trim()
        ? patch.themeName.trim()
        : state.themeName;
    const nextReadingTools = patch.readingTools
      ? normalizeReadingTools({ ...state.readingTools, ...patch.readingTools })
      : state.readingTools;
    const nextFonts = patch.fonts
      ? normalizeFonts({ ...state.fonts, ...patch.fonts })
      : state.fonts;
    const nextAlwaysOnTop = changesAlwaysOnTop ? patch.alwaysOnTop : state.alwaysOnTop;
    const nextAutoSave = typeof patch.autoSave === 'boolean' ? patch.autoSave : state.autoSave;
    const nextAdvanced = patch.advanced
      ? normalizeAdvancedPreferences({ ...state.advanced, ...patch.advanced })
      : state.advanced;
    const nextPathThemes = patch.pathThemes
      ? freezePathThemes(patch.pathThemes)
      : state.pathThemes;

    state = freezeSnapshot({
      themeName: nextThemeName,
      readingTools: nextReadingTools,
      fonts: nextFonts,
      alwaysOnTop: nextAlwaysOnTop,
      autoSave: nextAutoSave,
      advanced: nextAdvanced,
      pathThemes: nextPathThemes,
    });

    if (Object.hasOwn(patch, 'themeName')) {
      write(STORAGE_KEYS.theme, state.themeName, warnings);
    }
    if (patch.readingTools) {
      write(STORAGE_KEYS.readingTools, JSON.stringify(state.readingTools), warnings);
    }
    if (patch.fonts) {
      write(STORAGE_KEYS.fonts, JSON.stringify(state.fonts), warnings);
    }
    if (changesAlwaysOnTop) {
      write(STORAGE_KEYS.alwaysOnTop, String(state.alwaysOnTop), warnings);
    }
    if (typeof patch.autoSave === 'boolean') {
      write(STORAGE_KEYS.autoSave, String(state.autoSave), warnings);
    }
    if (patch.advanced) {
      write(STORAGE_KEYS.advanced, JSON.stringify(state.advanced), warnings);
    }
    if (patch.pathThemes) {
      write(STORAGE_KEYS.pathThemes, JSON.stringify(state.pathThemes), warnings);
    }

    notify();
    return {
      status: warnings.length > 0 ? 'volatile' : 'applied',
      snapshot: state,
      warnings,
    };
  };

  const update = (patch = {}) => {
    if (disposed) return Promise.reject(new Error('Reader preferences are disposed'));
    if (typeof patch.alwaysOnTop !== 'boolean') return applyUpdate(patch);

    const operation = pinUpdateChain.then(() => {
      if (disposed) throw new Error('Reader preferences are disposed');
      return applyUpdate(patch);
    });
    pinUpdateChain = operation.catch(() => undefined);
    return operation;
  };

  return Object.freeze({
    load,
    update,
    current: () => state,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Preference listener must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  });
}
