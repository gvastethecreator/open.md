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
  const select = dom.window.document.querySelector('#theme-select');
  const selectButton = dom.window.document.createElement('button');
  selectButton.type = 'button';
  selectButton.appendChild(dom.window.document.createElement('selectedcontent'));
  select.appendChild(selectButton);
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
      select,
      name: dom.window.document.querySelector('#theme-name'),
    },
  };
}

describe('Theme Coordinator', () => {
  it('uses the OS appearance on first run and keeps a saved theme', async () => {
    const { dom, elements } = fixture();
    dom.window.matchMedia = (query) => ({ matches: query === '(prefers-color-scheme: dark)' });
    const themes = [
      { ...THEMES[0], name: 'Github Light' },
      { ...THEMES[1], name: 'Github Dark' },
    ];
    const coordinator = createThemeCoordinator({ window: dom.window, document: dom.window.document, themes, elements });
    await coordinator.start();
    expect(coordinator.current().name).toBe('Github Dark');
    expect(elements.select.selectedOptions[0].textContent).toBe('Github Dark');
    await coordinator.start('Github Light');
    expect(coordinator.current().name).toBe('Github Light');
    expect(elements.select.querySelectorAll('option')).toHaveLength(1);
    elements.select.dispatchEvent(new dom.window.Event('focus'));
    expect(elements.select.querySelectorAll('option')).toHaveLength(2);
    expect(elements.select.selectedOptions[0].textContent).toBe('Github Light');
    coordinator.dispose();
    dom.window.close();
  });

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
    expect(elements.select.querySelectorAll('option')).toHaveLength(1);
    expect(elements.select.selectedOptions[0].textContent).toBe('Light');
    coordinator.ensureCatalog();
    expect(elements.select.querySelector(':scope > button selectedcontent')).not.toBeNull();
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

  it('applies the latest theme without a diagram prepare hook', async () => {
    const { dom, elements } = fixture();
    const onCommit = vi.fn();
    const coordinator = createThemeCoordinator({
      window: dom.window,
      document: dom.window.document,
      themes: THEMES,
      elements,
      hooks: { onCommit },
    });

    await coordinator.applyName('Light', { silent: true, persist: false });
    await coordinator.applyName('Dark', { silent: true, persist: false });

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

  it('skips an active theme transition when the coordinator is disposed', async () => {
    const { dom, elements, transitions } = fixture({ viewTransitions: true });
    const coordinator = createThemeCoordinator({
      window: dom.window,
      document: dom.window.document,
      themes: THEMES,
      elements,
    });

    await coordinator.applyName('Dark', { persist: false });
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
  });
});
