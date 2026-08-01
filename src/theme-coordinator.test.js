import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { createThemeCoordinator, getThemePreviewColors } from './theme-coordinator.js';

const THEMES = [
  { name: 'Light', background: '#ffffff', foreground: '#111111', color_05: '#0969da' },
  { name: 'Dark', background: '#111827', foreground: '#f9fafb', color_05: '#7dd3fc' },
];

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture({ reduced = false, viewTransitions = false } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head><meta name="theme-color"></head><body>
    <label class="theme-field"><select id="theme-select"></select></label><span id="theme-name"></span>
  </body></html>`);
  dom.window.matchMedia = () => ({ matches: reduced });
  dom.window.requestAnimationFrame = (callback) => dom.window.setTimeout(() => callback(16), 0);
  dom.window.cancelAnimationFrame = (id) => dom.window.clearTimeout(id);
  const transitions = [];
  if (viewTransitions) {
    dom.window.document.startViewTransition = vi.fn((commit) => {
      commit();
      const transition = {
        ready: Promise.resolve(),
        finished: Promise.resolve(),
        skipTransition: vi.fn(),
      };
      transitions.push(transition);
      return transition;
    });
  }
  return {
    dom,
    transitions,
    elements: {
      select: dom.window.document.querySelector('#theme-select'),
      name: dom.window.document.querySelector('#theme-name'),
    },
  };
}

describe('Theme Coordinator', () => {
  it('exposes three signature preview colors for theme pills', () => {
    expect(getThemePreviewColors(THEMES[0])).toEqual({
      background: '#ffffff',
      foreground: '#111111',
      accent: '#0969da',
    });
    expect(getThemePreviewColors({ name: 'Bare', background: '#000', foreground: '#fff' })).toEqual({
      background: '#000',
      foreground: '#fff',
      accent: '#fff',
    });
  });

  it('renders a three-segment color pill and sun/moon tone icon for each theme option', async () => {
    const { dom, elements } = fixture();
    const coordinator = createThemeCoordinator({
      window: dom.window,
      document: dom.window.document,
      themes: THEMES,
      elements,
      curatedNames: ['Light'],
    });

    await coordinator.start('Light');
    const options = [...elements.select.querySelectorAll('option')];
    expect(options).toHaveLength(2);
    // Coordinator sorts themes by name, so option values index the sorted list.
    const sortedThemes = [...THEMES].sort((left, right) => (
      left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
    ));

    for (const option of options) {
      const theme = sortedThemes[Number(option.value)];
      const pill = option.querySelector('.theme-color-pill');
      const segments = [...option.querySelectorAll('.theme-color-pill__segment')];
      const label = option.querySelector('.theme-option-label');
      const tone = option.querySelector('.theme-tone-icon');
      const expectedTone = theme.name === 'Dark' ? 'dark' : 'light';
      expect(theme).toBeTruthy();
      expect(label?.textContent).toBe(theme.name);
      expect(option.textContent).toContain(theme.name);
      expect(pill?.getAttribute('aria-hidden')).toBe('true');
      expect(segments).toHaveLength(3);
      expect(option.dataset.tone).toBe(expectedTone);
      expect(tone?.dataset.tone).toBe(expectedTone);
      expect(tone?.getAttribute('aria-hidden')).toBe('true');
      expect(tone?.classList.contains(expectedTone === 'dark' ? 'ti-moon' : 'ti-sun')).toBe(true);
      const colors = getThemePreviewColors(theme);
      expect(segments.map((segment) => segment.dataset.color)).toEqual([
        colors.background,
        colors.foreground,
        colors.accent,
      ]);
      for (const segment of segments) {
        expect(segment.style.backgroundColor).toBeTruthy();
      }
    }
  });

  it('coalesces rapid requests and never commits stale prepared diagrams', async () => {
    const { dom, elements } = fixture();
    const first = deferred();
    const second = deferred();
    const lightCommit = vi.fn();
    const darkCommit = vi.fn();
    const prepareDiagrams = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const onCommit = vi.fn();
    const coordinator = createThemeCoordinator({
      window: dom.window,
      document: dom.window.document,
      themes: THEMES,
      elements,
      hooks: { prepareDiagrams, shouldPrepareDiagrams: () => true, onCommit },
    });

    const light = coordinator.applyName('Light', { silent: true, persist: false });
    await Promise.resolve();
    expect(prepareDiagrams).toHaveBeenCalledWith('default', expect.objectContaining({
      background: '#ffffff',
      text: expect.any(String),
      accent: expect.any(String),
    }));
    const dark = coordinator.applyName('Dark', { silent: true, persist: false });
    first.resolve({ commit: lightCommit });
    await Promise.resolve();
    await Promise.resolve();
    expect(lightCommit).not.toHaveBeenCalled();
    second.resolve({ commit: darkCommit });
    await Promise.all([light, dark]);

    expect(darkCommit).toHaveBeenCalledOnce();
    expect(dom.window.document.documentElement.dataset.themeName).toBe('Dark');
    expect(elements.name.textContent).toBe('Dark');
    expect(onCommit).toHaveBeenLastCalledWith(THEMES[1]);
  });

  it('commits through one view transition and reports persistence and feedback', async () => {
    const { dom, elements, transitions } = fixture({ viewTransitions: true });
    const notify = vi.fn();
    const persist = vi.fn(async () => ({ status: 'saved' }));
    const onPersistResult = vi.fn();
    const beforeTransition = vi.fn();
    const coordinator = createThemeCoordinator({
      window: dom.window,
      document: dom.window.document,
      themes: THEMES,
      elements,
      hooks: { notify, persist, onPersistResult, beforeTransition },
    });

    await coordinator.applyName('Dark');
    expect(dom.window.document.startViewTransition).toHaveBeenCalledOnce();
    expect(beforeTransition).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith('Theme: Dark');
    expect(persist).toHaveBeenCalledWith('Dark');
    expect(onPersistResult).toHaveBeenCalledWith({ status: 'saved' });
    expect(transitions[0].skipTransition).not.toHaveBeenCalled();
    expect(dom.window.document.documentElement.classList.contains('is-theme-wiping')).toBe(false);
  });

  it('recovers after preparation failure and disposes an active transition', async () => {
    const { dom, elements, transitions } = fixture({ viewTransitions: true });
    const onError = vi.fn();
    const prepareDiagrams = vi.fn()
      .mockRejectedValueOnce(new Error('diagram failed'))
      .mockResolvedValueOnce(null);
    const coordinator = createThemeCoordinator({
      window: dom.window,
      document: dom.window.document,
      themes: THEMES,
      elements,
      hooks: { prepareDiagrams, shouldPrepareDiagrams: () => true, onError },
    });

    await coordinator.applyName('Light');
    await coordinator.applyName('Dark');
    expect(onError).toHaveBeenCalledOnce();
    expect(coordinator.current().name).toBe('Dark');

    const active = deferred();
    dom.window.document.startViewTransition = vi.fn((commit) => {
      commit();
      const transition = { ready: active.promise, finished: active.promise, skipTransition: vi.fn() };
      transitions.push(transition);
      return transition;
    });
    const pending = coordinator.applyName('Light', { persist: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    coordinator.dispose();
    expect(transitions.at(-1).skipTransition).toHaveBeenCalledOnce();
    active.resolve();
    await pending;
  });

  it('keeps confirmed theme state, copy and persistence atomic when preparation fails', async () => {
    const { dom, elements } = fixture();
    const persist = vi.fn(async () => ({ status: 'saved' }));
    const onError = vi.fn();
    const prepareDiagrams = vi.fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('diagram failed'))
      .mockResolvedValueOnce(null);
    const coordinator = createThemeCoordinator({
      window: dom.window,
      document: dom.window.document,
      themes: THEMES,
      elements,
      hooks: { prepareDiagrams, shouldPrepareDiagrams: () => true, persist, onError },
    });

    await coordinator.start('Light');
    expect(coordinator.current().name).toBe('Light');
    expect(dom.window.document.documentElement.dataset.themeName).toBe('Light');

    await coordinator.applyName('Dark');
    expect(onError).toHaveBeenCalledOnce();
    expect(coordinator.current().name).toBe('Light');
    expect(coordinator.diagramTheme()).toBe('default');
    expect(dom.window.document.documentElement.dataset.themeName).toBe('Light');
    expect(elements.name.textContent).toBe('Light');
    expect(elements.select.value).toBe('1');
    expect(persist).not.toHaveBeenCalled();

    await coordinator.applyName('Dark');
    expect(coordinator.current().name).toBe('Dark');
    expect(elements.name.textContent).toBe('Dark');
    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith('Dark');
  });

  it('exposes diagram tokens for the confirmed theme only', async () => {
    const { dom, elements } = fixture();
    const coordinator = createThemeCoordinator({
      window: dom.window,
      document: dom.window.document,
      themes: THEMES,
      elements,
    });

    expect(coordinator.diagramTokens()).toBeNull();
    await coordinator.start('Dark');
    const tokens = coordinator.diagramTokens();
    expect(tokens).toMatchObject({ background: '#111827' });
    expect(coordinator.diagramTheme()).toBe('dark');
  });
});
