// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppLoadingScreen } from './app-loading-screen.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const originalMatchMedia = window.matchMedia;
const originalLocalStorage = window.localStorage;
const localStorage = new Map();

const storageAdapter = {
  getItem: (key) => localStorage.get(key) ?? null,
  setItem: (key, value) => localStorage.set(key, String(value)),
  removeItem: (key) => localStorage.delete(key),
  clear: () => localStorage.clear(),
};

function setMatchMedia(matches) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  });
}

function mountLoadingScreen({ bootstrap = null, frames = FRAMES.join('') } = {}) {
  document.body.className = 'is-app-loading';
  document.body.innerHTML = `
    <div
      id="app-loading-screen"
      role="status"
      aria-busy="true"
      data-loading-frames="${frames}"
      data-loading-fps="14"
      aria-label="Loading open.md"
    >
      <span data-loading-spinner>⠋</span>
    </div>
  `;
  const screen = document.getElementById('app-loading-screen');
  if (bootstrap) screen.__openMdLoadingBootstrap = bootstrap;
  return { screen, spinner: screen.querySelector('[data-loading-spinner]') };
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storageAdapter,
  });
});

afterEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
  storageAdapter.clear();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: originalLocalStorage,
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: originalMatchMedia,
  });
  vi.useRealTimers();
});

describe('App Loading Screen', () => {
  it('cycles through the Braille Orbital Swarm at the declared 14 fps', () => {
    vi.useFakeTimers();
    setMatchMedia(false);
    const { spinner } = mountLoadingScreen();
    const loadingScreen = createAppLoadingScreen({ window, document });

    for (const frame of FRAMES) {
      expect(spinner.textContent).toBe(frame);
      vi.advanceTimersByTime(72);
    }

    loadingScreen.dispose();
  });

  it('applies theme tokens, reveals after opacity transition, and stops bootstrap motion', () => {
    setMatchMedia(false);
    const stop = vi.fn();
    const setReducedMotion = vi.fn();
    const { screen } = mountLoadingScreen({
      bootstrap: Object.freeze({ stop, setReducedMotion }),
    });
    const loadingScreen = createAppLoadingScreen({ window, document });

    expect(setReducedMotion).toHaveBeenCalledWith(false);
    expect(loadingScreen.setTheme({ background: '#090300', text: '#f4f1de', accent: '#ffcc00' })).toEqual({
      background: '#090300',
      text: '#f4f1de',
      accent: '#ffcc00',
    });
    expect(screen.style.getPropertyValue('--app-loading-background')).toBe('#090300');
    expect(JSON.parse(window.localStorage.getItem('openmd-theme-preview-v1'))).toEqual({
      background: '#090300',
      text: '#f4f1de',
      accent: '#ffcc00',
    });

    loadingScreen.complete();
    expect(screen.classList.contains('is-exiting')).toBe(true);
    expect(document.body.classList.contains('is-app-revealing')).toBe(true);
    const transitionEnd = new Event('transitionend');
    Object.defineProperty(transitionEnd, 'propertyName', { value: 'opacity' });
    screen.dispatchEvent(transitionEnd);

    expect(screen.hidden).toBe(true);
    expect(screen.getAttribute('aria-hidden')).toBe('true');
    expect(screen.hasAttribute('aria-busy')).toBe(false);
    expect(document.body.classList.contains('is-app-loading')).toBe(false);
    expect(document.body.classList.contains('is-app-revealing')).toBe(false);
    expect(stop).toHaveBeenCalled();
  });

  it('finishes immediately for reduced motion and exposes startup failures', () => {
    setMatchMedia(false);
    window.localStorage.setItem('openmd-advanced-preferences-v1', JSON.stringify({ reduceMotion: true }));
    const { screen } = mountLoadingScreen();
    const loadingScreen = createAppLoadingScreen({ window, document });

    loadingScreen.complete();
    expect(screen.hidden).toBe(true);
    expect(screen.classList.contains('is-exiting')).toBe(false);

    const failureFixture = mountLoadingScreen();
    const failedLoadingScreen = createAppLoadingScreen({ window, document });
    document.body.classList.add('is-app-revealing');
    failedLoadingScreen.fail('Could not load open.md');
    expect(failureFixture.screen.classList.contains('is-error')).toBe(true);
    expect(failureFixture.screen.getAttribute('aria-label')).toBe('Could not load open.md');
    expect(failureFixture.screen.hasAttribute('aria-busy')).toBe(false);
    expect(failureFixture.screen.querySelector('[data-loading-label]')).toBeNull();
    expect(document.body.classList.contains('is-app-loading')).toBe(true);
    expect(document.body.classList.contains('is-app-revealing')).toBe(false);
    failedLoadingScreen.dispose();
    expect(failureFixture.screen.hidden).toBe(true);
    expect(document.body.classList.contains('is-app-loading')).toBe(false);
    expect(document.body.classList.contains('is-app-revealing')).toBe(false);
  });

  it('does not override the operating-system reduced-motion preference', () => {
    setMatchMedia(true);
    const setReducedMotion = vi.fn();
    const { screen } = mountLoadingScreen({
      bootstrap: Object.freeze({ setReducedMotion }),
    });
    const loadingScreen = createAppLoadingScreen({ window, document });

    loadingScreen.setReducedMotion(false);
    loadingScreen.complete();

    expect(setReducedMotion).toHaveBeenLastCalledWith(true);
    expect(screen.hidden).toBe(true);
    expect(document.body.classList.contains('is-app-revealing')).toBe(false);
  });
});
