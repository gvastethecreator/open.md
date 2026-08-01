/**
 * Path → theme memory: longest-prefix directory match (folder + descendants).
 */

export function normalizeThemePath(path) {
  if (typeof path !== 'string') return null;
  let value = path.trim().replace(/\\/g, '/');
  if (!value) return null;
  // Collapse duplicate separators without touching protocol-like prefixes.
  value = value.replace(/\/{2,}/g, '/');
  if (value.length > 1 && value.endsWith('/')) {
    // Keep drive roots as "c:/" ; strip trailing slash elsewhere.
    if (!/^[a-zA-Z]:\/$/.test(value)) value = value.slice(0, -1);
  }
  if (/^[a-zA-Z]:\//.test(value)) {
    value = value[0].toLowerCase() + value.slice(1);
  } else if (/^[a-zA-Z]:$/.test(value)) {
    value = `${value.toLowerCase()}/`;
  }
  return value;
}

export function dirnamePath(filePath) {
  const normalized = normalizeThemePath(filePath);
  if (!normalized) return null;
  if (/^[a-z]:\/$/i.test(normalized) || normalized === '/') return normalized;
  const index = normalized.lastIndexOf('/');
  if (index < 0) return normalized;
  if (index === 0) return '/';
  const parent = normalized.slice(0, index);
  if (/^[a-z]:$/i.test(parent)) return `${parent}/`;
  return parent || '/';
}

export function parentDir(dirPath) {
  const dir = normalizeThemePath(dirPath);
  if (!dir || dir === '/' || /^[a-z]:\/$/i.test(dir)) return null;
  const index = dir.lastIndexOf('/');
  if (index < 0) return null;
  if (index === 0) return '/';
  const parent = dir.slice(0, index);
  if (/^[a-z]:$/i.test(parent)) return `${parent}/`;
  return parent || null;
}

export function normalizePathThemeEntries(value) {
  const source = value && typeof value === 'object'
    ? (value.entries && typeof value.entries === 'object' ? value.entries : value)
    : {};
  const entries = {};
  for (const [rawPath, rawTheme] of Object.entries(source)) {
    const path = normalizeThemePath(rawPath);
    const theme = typeof rawTheme === 'string' ? rawTheme.trim() : '';
    if (path && theme) entries[path] = theme;
  }
  return Object.freeze(entries);
}

export function freezePathThemes(value) {
  return Object.freeze({
    version: 1,
    entries: normalizePathThemeEntries(value),
  });
}

/**
 * Resolve theme for a file: longest matching ancestor directory wins.
 * @returns {string | null}
 */
export function resolvePathTheme(filePath, entries) {
  const map = normalizePathThemeEntries(entries);
  let dir = dirnamePath(filePath);
  while (dir) {
    if (Object.hasOwn(map, dir)) return map[dir];
    dir = parentDir(dir);
  }
  return null;
}

/**
 * Remember theme for the file's parent directory.
 * @returns {Record<string, string>} next entries map
 */
export function upsertPathTheme(entries, filePath, themeName) {
  const dir = dirnamePath(filePath);
  const theme = typeof themeName === 'string' ? themeName.trim() : '';
  if (!dir || !theme) return normalizePathThemeEntries(entries);
  return Object.freeze({
    ...normalizePathThemeEntries(entries),
    [dir]: theme,
  });
}

/**
 * Coordinates per-path theme recall and persistence without exposing the
 * preference schema to the composition root.
 */
export function createPathThemePreferenceCoordinator({
  preferences,
  getCurrentPath = () => null,
  getCurrentThemeName = () => null,
  applyTheme = () => undefined,
} = {}) {
  if (
    typeof preferences?.current !== 'function'
    || typeof preferences?.update !== 'function'
  ) {
    throw new TypeError('Path Theme Preference Coordinator requires preferences');
  }

  let disposed = false;

  const applyForPath = async (path = getCurrentPath()) => {
    if (disposed) return { status: 'disposed' };
    const snapshot = preferences.current();
    if (!snapshot?.advanced?.pathRemembersTheme || !path) {
      return { status: 'ignored' };
    }
    const themeName = resolvePathTheme(path, snapshot.pathThemes?.entries);
    if (!themeName) return { status: 'missing' };
    if (getCurrentThemeName() === themeName) {
      return { status: 'unchanged', themeName };
    }
    await applyTheme(themeName, { silent: true, persist: false });
    return { status: 'applied', themeName };
  };

  const persistSelection = (themeName, path = getCurrentPath()) => {
    if (disposed) return Promise.resolve({ status: 'disposed' });
    const snapshot = preferences.current();
    const normalizedTheme = typeof themeName === 'string' ? themeName.trim() : '';
    if (!normalizedTheme) return Promise.resolve({ status: 'ignored' });

    if (snapshot?.advanced?.pathRemembersTheme && path) {
      const entries = upsertPathTheme(snapshot.pathThemes?.entries, path, normalizedTheme);
      return preferences.update({
        themeName: normalizedTheme,
        pathThemes: { version: 1, entries },
      });
    }
    return preferences.update({ themeName: normalizedTheme });
  };

  return Object.freeze({
    applyForPath,
    persistSelection,
    dispose() {
      disposed = true;
    },
  });
}
