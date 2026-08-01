const SHOW_DELAY_MS = 280;
const HIDE_DELAY_MS = 420;
const SCROLL_HOLD_MS = 720;
const VISIBLE_CLASS = 'is-scrollbar-visible';

/**
 * Auto-show thin scrollbars on content scrollports with delayed appear/hide.
 * Class toggles reverse via CSS transitions (no hard cut when cancelled).
 */
export function createScrollbarVisibilityController({
  window,
  document,
  roots = [],
  showDelay = SHOW_DELAY_MS,
  hideDelay = HIDE_DELAY_MS,
  scrollHold = SCROLL_HOLD_MS,
} = {}) {
  if (!window || !document) {
    throw new TypeError('Scrollbar Visibility Controller requires window and document');
  }

  const hosts = [...roots].filter(Boolean);
  const unlisteners = [];
  const stateByHost = new WeakMap();
  let started = false;
  let disposed = false;

  const listen = (target, type, listener, options) => {
    target?.addEventListener?.(type, listener, options);
    if (target?.removeEventListener) {
      unlisteners.push(() => target.removeEventListener(type, listener, options));
    }
  };

  const getState = (host) => {
    let state = stateByHost.get(host);
    if (!state) {
      state = {
        showTimer: null,
        hideTimer: null,
        scrollTimer: null,
        pointerInside: false,
        focusInside: false,
      };
      stateByHost.set(host, state);
    }
    return state;
  };

  const clearTimer = (state, key) => {
    if (state[key] == null) return;
    window.clearTimeout(state[key]);
    state[key] = null;
  };

  const setVisible = (host, visible) => {
    if (disposed || !host?.isConnected) return;
    host.classList.toggle(VISIBLE_CLASS, Boolean(visible));
  };

  const shouldStayVisible = (state) => state.pointerInside || state.focusInside;

  const scheduleShow = (host, { immediate = false } = {}) => {
    if (disposed || !host?.isConnected) return;
    const state = getState(host);
    clearTimer(state, 'hideTimer');
    if (host.classList.contains(VISIBLE_CLASS)) return;
    if (immediate || showDelay <= 0) {
      clearTimer(state, 'showTimer');
      setVisible(host, true);
      return;
    }
    if (state.showTimer != null) return;
    state.showTimer = window.setTimeout(() => {
      state.showTimer = null;
      if (disposed || !host.isConnected) return;
      if (!shouldStayVisible(state) && state.scrollTimer == null) return;
      setVisible(host, true);
    }, showDelay);
  };

  const scheduleHide = (host, { delay = hideDelay } = {}) => {
    if (disposed || !host?.isConnected) return;
    const state = getState(host);
    clearTimer(state, 'showTimer');
    if (shouldStayVisible(state)) return;
    if (!host.classList.contains(VISIBLE_CLASS)) return;
    clearTimer(state, 'hideTimer');
    if (delay <= 0) {
      setVisible(host, false);
      return;
    }
    state.hideTimer = window.setTimeout(() => {
      state.hideTimer = null;
      if (disposed || !host.isConnected) return;
      if (shouldStayVisible(state) || state.scrollTimer != null) return;
      setVisible(host, false);
    }, delay);
  };

  const pulseFromScroll = (host) => {
    if (disposed || !host?.isConnected) return;
    const state = getState(host);
    clearTimer(state, 'hideTimer');
    // Scroll feedback appears promptly; hide still eases out after hold.
    setVisible(host, true);
    clearTimer(state, 'scrollTimer');
    state.scrollTimer = window.setTimeout(() => {
      state.scrollTimer = null;
      if (!shouldStayVisible(state)) scheduleHide(host);
    }, scrollHold);
  };

  const bindHost = (host) => {
    const state = getState(host);

    listen(host, 'pointerenter', () => {
      state.pointerInside = true;
      scheduleShow(host);
    });
    listen(host, 'pointerleave', () => {
      state.pointerInside = false;
      scheduleHide(host);
    });
    listen(host, 'focusin', () => {
      state.focusInside = true;
      scheduleShow(host, { immediate: true });
    });
    listen(host, 'focusout', (event) => {
      if (host.contains(event.relatedTarget)) return;
      state.focusInside = false;
      scheduleHide(host);
    });
    listen(host, 'scroll', () => pulseFromScroll(host), { passive: true });
  };

  const start = () => {
    if (started || disposed) return;
    started = true;
    hosts.forEach(bindHost);
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    hosts.forEach((host) => {
      const state = stateByHost.get(host);
      if (state) {
        clearTimer(state, 'showTimer');
        clearTimer(state, 'hideTimer');
        clearTimer(state, 'scrollTimer');
      }
      host?.classList?.remove(VISIBLE_CLASS);
    });
    while (unlisteners.length) unlisteners.pop()?.();
  };

  return Object.freeze({ start, dispose });
}
