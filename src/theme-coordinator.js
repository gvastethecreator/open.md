import {
  getPreferredThemeIndex,
  getThemeTokens,
  isColorDark,
} from './core/reader.js';

const DEFAULT_CURATED_NAMES = ['Paper', 'Github Light', 'Github Dark', 'Ayu Light', 'Ayu Dark'];

function applyThemeTokens(document, theme, preparedDiagrams) {
  const root = document.documentElement;
  const tokens = getThemeTokens(theme);
  const diagramsCommitted = preparedDiagrams?.commit?.();
  if (diagramsCommitted === false) throw new Error('Prepared diagrams became stale before theme commit');
  const properties = {
    '--bg-color': tokens.background,
    '--text-color': tokens.text,
    '--border-color': tokens.border,
    '--link-color': tokens.link,
    '--accent-color': tokens.accent,
    '--ui-accent': tokens.accent,
    '--accent-foreground': tokens.accentForeground,
    '--code-bg': tokens.surface,
    '--code-block-bg': tokens.codeBackground,
    '--code-block-text': tokens.codeText,
    '--syntax-comment': tokens.syntaxComment,
    '--syntax-keyword': tokens.syntaxKeyword,
    '--syntax-string': tokens.syntaxString,
    '--syntax-number': tokens.syntaxNumber,
    '--syntax-title': tokens.syntaxTitle,
    '--syntax-property': tokens.syntaxProperty,
    '--syntax-meta': tokens.syntaxMeta,
    '--syntax-addition': tokens.syntaxAddition,
    '--syntax-deletion': tokens.syntaxDeletion,
    '--heading-1': tokens.text,
    '--heading-2': tokens.text,
    '--heading-3': tokens.text,
    '--heading-4': tokens.text,
    '--heading-5': tokens.text,
    '--quote-color': tokens.quote,
    '--panel-bg': tokens.surface,
    '--toolbar-bg': tokens.surface,
    '--danger-color': tokens.danger,
    '--shadow-color': tokens.shadow,
  };
  Object.entries(properties).forEach(([name, value]) => root.style.setProperty(name, value));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tokens.background);
  const dark = isColorDark(tokens.background);
  root.style.colorScheme = dark ? 'dark' : 'light';
  root.dataset.themeName = theme.name;
  root.dataset.themeTone = dark ? 'dark' : 'light';
}

export function createThemeCoordinator({
  window,
  document,
  themes: availableThemes,
  elements = {},
  curatedNames = DEFAULT_CURATED_NAMES,
  hooks = {},
}) {
  if (!window || !document || !Array.isArray(availableThemes)) {
    throw new TypeError('Theme Coordinator requires window, document and themes');
  }

  const themes = [...availableThemes]
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
  let currentIndex = -1;
  let requestedIndex = -1;
  let revision = 0;
  let pendingRequest = null;
  let drainPromise = null;
  let activeTransition = null;
  let disposed = false;

  const updateCopy = () => {
    const theme = themes[currentIndex];
    if (!theme) {
      if (elements.select) elements.select.value = '';
      if (elements.name) elements.name.textContent = '';
      return;
    }
    const label = 'Theme: ' + theme.name;
    if (elements.select) {
      elements.select.value = String(currentIndex);
      elements.select.title = label;
      elements.select.setAttribute('aria-label', label);
      elements.select.closest('.theme-field')?.setAttribute('title', label);
    }
    if (elements.name) elements.name.textContent = theme.name;
  };

  const populate = () => {
    if (!elements.select) return;
    elements.select.replaceChildren();
    const curated = new Set(curatedNames.map((name) => name.toLowerCase()));
    const recommended = document.createElement('optgroup');
    recommended.label = 'Recommended';
    const catalog = document.createElement('optgroup');
    catalog.label = 'All themes';
    const append = (group, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = themes[index].name;
      option.selected = index === currentIndex;
      group.appendChild(option);
    };
    curatedNames.forEach((name) => {
      const index = themes.findIndex((theme) => theme.name.toLowerCase() === name.toLowerCase());
      if (index >= 0) append(recommended, index);
    });
    themes.forEach((theme, index) => {
      if (!curated.has(theme.name.toLowerCase())) append(catalog, index);
    });
    if (recommended.children.length > 0) elements.select.appendChild(recommended);
    if (catalog.children.length > 0) elements.select.appendChild(catalog);
  };

  const settleFallback = () => new Promise((resolve) => {
    let frameId = null;
    const timeoutId = window.setTimeout(() => {
      if (frameId !== null) window.cancelAnimationFrame?.(frameId);
      resolve();
    }, 64);
    frameId = window.requestAnimationFrame?.(() => {
      window.clearTimeout(timeoutId);
      resolve();
    }) ?? null;
  });

  const commitRequest = async ({ index, theme, silent, persist, requestRevision }) => {
    const tokens = getThemeTokens(theme);
    const diagramTheme = isColorDark(tokens.background) ? 'dark' : 'default';
    const prepared = hooks.shouldPrepareDiagrams?.()
      ? await hooks.prepareDiagrams?.(diagramTheme)
      : null;
    if (disposed || requestRevision !== revision) return false;

    const root = document.documentElement;
    let committed = false;
    let commitFailure = null;
    const commit = () => {
      if (committed || disposed || requestRevision !== revision) return;
      try {
        applyThemeTokens(document, theme, prepared);
        currentIndex = index;
        requestedIndex = index;
        updateCopy();
        committed = true;
        try {
          hooks.onCommit?.(theme);
        } catch (error) {
          hooks.onError?.('Could not finish the selected theme', error);
        }
        if (persist) {
          Promise.resolve()
            .then(() => hooks.persist?.(theme.name))
            .then((result) => hooks.onPersistResult?.(result))
            .catch((error) => hooks.onError?.('Could not persist the selected theme', error));
        }
        if (!silent) {
          try {
            hooks.notify?.('Theme: ' + theme.name);
          } catch (error) {
            hooks.onError?.('Could not announce the selected theme', error);
          }
        }
      } catch (error) {
        commitFailure = error;
        throw error;
      }
    };
    const canWipe = !silent
      && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      && typeof document.startViewTransition === 'function';

    if (!canWipe) {
      root.classList.add('is-theme-changing');
      try {
        commit();
        await settleFallback();
      } finally {
        root.classList.remove('is-theme-changing');
      }
      return committed;
    }

    hooks.beforeTransition?.();
    root.classList.add('is-theme-changing', 'is-theme-wiping');
    let transition;
    try {
      transition = document.startViewTransition(commit);
    } catch (error) {
      try {
        if (!commitFailure) commit();
      } finally {
        root.classList.remove('is-theme-changing', 'is-theme-wiping');
      }
      if (commitFailure) throw commitFailure;
      if (!committed) throw error;
      return true;
    }
    activeTransition = transition;
    try {
      await transition.ready;
    } catch {
      // A newer request or disposal may intentionally skip the visual transition.
    } finally {
      root.classList.remove('is-theme-changing');
    }
    try {
      await transition.finished;
    } catch {
      // The committed theme remains valid when its visual transition is skipped.
    } finally {
      if (activeTransition === transition) activeTransition = null;
      root.classList.remove('is-theme-wiping');
    }
    if (commitFailure) throw commitFailure;
    return committed;
  };

  const drain = async () => {
    while (!disposed && pendingRequest) {
      const request = pendingRequest;
      pendingRequest = null;
      try {
        await commitRequest(request);
      } catch (error) {
        if (request.requestRevision === revision) {
          requestedIndex = currentIndex;
          updateCopy();
        }
        hooks.onError?.('Could not apply the selected theme', error);
      }
    }
  };

  const scheduleDrain = () => {
    if (drainPromise) return drainPromise;
    drainPromise = Promise.resolve()
      .then(drain)
      .finally(() => {
        drainPromise = null;
        if (!disposed && pendingRequest) scheduleDrain();
      });
    return drainPromise;
  };

  const applyIndex = (index, { silent = false, persist = true } = {}) => {
    if (disposed || !Number.isInteger(index) || !themes[index]) return Promise.resolve(false);
    const theme = themes[index];
    const requestRevision = ++revision;
    requestedIndex = index;
    pendingRequest = { index, theme, silent, persist, requestRevision };
    activeTransition?.skipTransition?.();
    return scheduleDrain();
  };

  const applyName = (name, options) => {
    const index = themes.findIndex((theme) => theme.name === name);
    return applyIndex(index, options);
  };

  const start = (savedThemeName = null) => {
    const initialIndex = getPreferredThemeIndex(themes, savedThemeName);
    populate();
    return initialIndex >= 0
      ? applyIndex(initialIndex, { silent: true, persist: false })
      : Promise.resolve(false);
  };

  const cycle = (direction = 1) => {
    if (themes.length === 0 || disposed) return Promise.resolve(false);
    const baseIndex = requestedIndex >= 0 ? requestedIndex : currentIndex;
    const nextIndex = (baseIndex + direction + themes.length) % themes.length;
    return applyIndex(nextIndex);
  };

  const current = () => themes[currentIndex] || null;
  const diagramTheme = () => {
    const theme = current();
    return theme && isColorDark(getThemeTokens(theme).background) ? 'dark' : 'default';
  };

  const cancelTransition = () => {
    activeTransition?.skipTransition?.();
    activeTransition = null;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    revision += 1;
    pendingRequest = null;
    cancelTransition();
    document.documentElement.classList.remove('is-theme-changing', 'is-theme-wiping');
  };

  return Object.freeze({
    start,
    applyIndex,
    applyName,
    cycle,
    current,
    diagramTheme,
    cancelTransition,
    dispose,
  });
}
