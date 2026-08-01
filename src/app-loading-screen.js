const LOADING_SCREEN_ID = 'app-loading-screen';
const BOOTSTRAP_KEY = '__openMdLoadingBootstrap';
const PREVIEW_STORAGE_KEY = 'openmd-theme-preview-v1';
const DEFAULT_FRAMES = Object.freeze(['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']);
const DEFAULT_FPS = 14;
const FALLBACK_THEME = Object.freeze({
  background: '#f6f8fa',
  text: '#1f2328',
  accent: '#0969da',
});
const HEX_COLOR = /^#[\da-f]{3,8}$/i;

function safeColor(value, fallback) {
  return typeof value === 'string' && HEX_COLOR.test(value.trim())
    ? value.trim()
    : fallback;
}

function normalizeTheme(theme = {}) {
  return {
    background: safeColor(theme.background, FALLBACK_THEME.background),
    text: safeColor(theme.text || theme.foreground, FALLBACK_THEME.text),
    accent: safeColor(theme.accent, FALLBACK_THEME.accent),
  };
}

function readThemePreview(window) {
  try {
    const raw = window.localStorage?.getItem(PREVIEW_STORAGE_KEY);
    return raw ? normalizeTheme(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeThemePreview(window, theme) {
  try {
    window.localStorage?.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(theme));
  } catch {
    // Theme preview is a visual cache; the preference authority remains intact.
  }
}

function prefersReducedMotion(window) {
  let systemReduced = false;
  try {
    systemReduced = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  } catch {
    systemReduced = false;
  }
  let appReduced = false;
  try {
    const raw = window.localStorage?.getItem('openmd-advanced-preferences-v1');
    appReduced = Boolean(JSON.parse(raw || '{}')?.reduceMotion);
  } catch {
    appReduced = false;
  }
  return systemReduced || appReduced;
}

function noOpLoadingScreen() {
  return Object.freeze({
    setTheme: (theme) => theme,
    setReducedMotion: () => {},
    complete: () => {},
    fail: () => {},
    dispose: () => {},
  });
}

/**
 * Adopts the first-paint loader from index.html and owns its theme/reveal
 * lifecycle until the application has committed its initial surface.
 */
export function createAppLoadingScreen({ window, document } = {}) {
  if (!window || !document) {
    throw new TypeError('App Loading Screen requires window and document');
  }

  const screen = document.getElementById(LOADING_SCREEN_ID);
  if (!screen) return noOpLoadingScreen();

  const spinner = screen.querySelector('[data-loading-spinner]');
  const bootstrap = screen[BOOTSTRAP_KEY];
  const frames = [...(screen.dataset.loadingFrames || '')];
  const frameList = frames.length > 0 ? frames : [...DEFAULT_FRAMES];
  const fpsValue = Number(screen.dataset.loadingFps);
  const fps = Number.isFinite(fpsValue) && fpsValue > 0 ? fpsValue : DEFAULT_FPS;

  let fallbackTimer = null;
  let reducedMotion = prefersReducedMotion(window);
  let disposed = false;
  let completeStarted = false;
  let transitionListener = null;

  const setFrame = (index) => {
    if (spinner) spinner.textContent = frameList[index % frameList.length];
  };

  const stopFallback = () => {
    if (fallbackTimer === null) return;
    window.clearInterval(fallbackTimer);
    fallbackTimer = null;
  };

  const startFallback = () => {
    if (bootstrap || fallbackTimer !== null || reducedMotion || !spinner) return;
    let index = 0;
    setFrame(index);
    fallbackTimer = window.setInterval(() => {
      index = (index + 1) % frameList.length;
      setFrame(index);
    }, 1000 / fps);
  };

  const stopMotion = () => {
    stopFallback();
    bootstrap?.stop?.();
  };

  const finish = () => {
    if (disposed) return;
    stopMotion();
    if (transitionListener) {
      screen.removeEventListener('transitionend', transitionListener);
      transitionListener = null;
    }
    screen.classList.remove('is-exiting');
    screen.hidden = true;
    screen.setAttribute('aria-hidden', 'true');
    screen.removeAttribute('aria-busy');
    document.body?.classList.remove('is-app-loading', 'is-app-revealing');
  };

  const setTheme = (theme = {}) => {
    const normalized = normalizeTheme(theme);
    screen.style.setProperty('--app-loading-background', normalized.background);
    screen.style.setProperty('--app-loading-foreground', normalized.text);
    screen.style.setProperty('--app-loading-accent', normalized.accent);
    document.documentElement?.style.setProperty('--bg-color', normalized.background);
    document.documentElement?.style.setProperty('--text-color', normalized.text);
    document.documentElement?.style.setProperty('--accent-color', normalized.accent);
    document.documentElement?.style.setProperty('--ui-accent', normalized.accent);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', normalized.background);
    writeThemePreview(window, normalized);
    return normalized;
  };

  const setReducedMotion = (nextReduced) => {
    reducedMotion = Boolean(nextReduced) || prefersReducedMotion(window);
    bootstrap?.setReducedMotion?.(reducedMotion);
    if (reducedMotion) {
      stopFallback();
      setFrame(0);
    } else {
      startFallback();
    }
  };

  const complete = () => {
    if (disposed || completeStarted || screen.hidden) return;
    completeStarted = true;
    if (reducedMotion) {
      finish();
      return;
    }

    document.body?.classList.add('is-app-revealing');
    screen.classList.add('is-exiting');
    transitionListener = (event) => {
      if (event.target === screen && event.propertyName === 'opacity') finish();
    };
    screen.addEventListener('transitionend', transitionListener);
  };

  const fail = (message = 'Could not load open.md') => {
    if (disposed) return;
    stopMotion();
    document.body?.classList.remove('is-app-revealing');
    screen.classList.remove('is-exiting');
    screen.classList.add('is-error');
    screen.removeAttribute('aria-busy');
    screen.setAttribute('aria-label', String(message));
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    stopMotion();
    if (transitionListener) screen.removeEventListener('transitionend', transitionListener);
    screen.hidden = true;
    screen.setAttribute('aria-hidden', 'true');
    document.body?.classList.remove('is-app-loading', 'is-app-revealing');
  };

  setTheme(readThemePreview(window) || FALLBACK_THEME);
  setReducedMotion(reducedMotion);

  return Object.freeze({ setTheme, setReducedMotion, complete, fail, dispose });
}
