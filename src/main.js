import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import allThemes from './themes.runtime.json';
import {
  DEFAULT_READING_TOOLS,
  calculateNewZoom,
  getCurrentLineFromAnchors,
  getDisplayName,
  getEstimatedMinutesRemaining,
  getFileKind,
  getLineGutterLeft,
  getLinkAction,
  getMinimapViewportGeometry,
  getPreferredThemeIndex,
  getReadingProgress,
  getScrollEdgeState,
  getStatusMetricParts,
  getThemeTokens,
  getViewportMode,
  getVisibleSourceLineRange,
  getWindowControlPresentation,
  isColorDark,
  normalizeCycleIndex,
  normalizeReadingTools,
} from './core/reader.js';
import { renderMermaidDiagrams } from './mermaid-renderer.js';
import { mountReaderShell } from './reader-shell.js';

let currentZoom = 1;
const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3.0;
const THEME_STORAGE_KEY = 'openmd-theme';
const READING_TOOLS_STORAGE_KEY = 'openmd-reading-tools-v1';
const FONT_PREFERENCES_STORAGE_KEY = 'openmd-font-preferences-v1';
const ALWAYS_ON_TOP_STORAGE_KEY = 'openmd-always-on-top';
const CURATED_THEME_NAMES = ['Paper', 'Github Light', 'Github Dark', 'Ayu Light', 'Ayu Dark'];
const FONT_PRESETS = Object.freeze({
  sans: Object.freeze([
    { name: 'System', value: 'Inter, "Segoe UI", Helvetica, Arial, sans-serif' },
    { name: 'Humanist', value: 'Candara, "Trebuchet MS", "Segoe UI", sans-serif' },
    { name: 'Classic sans', value: '"Gill Sans", "Gill Sans MT", Calibri, Arial, sans-serif' },
  ]),
  mono: Object.freeze([
    { name: 'Cascadia', value: '"Cascadia Code", "Cascadia Mono", "SFMono-Regular", Consolas, monospace' },
    { name: 'Consolas', value: 'Consolas, "Liberation Mono", Menlo, monospace' },
    { name: 'Courier', value: '"Courier New", Courier, monospace' },
  ]),
});
let themes = [];
let currentThemeIndex = -1;
let dragDropUnlisten = null;
let fileOpenRequestUnlisten = null;
let toastTimeoutId = null;
let scrollRafId = null;
let currentFilePath = null;
let isHelpVisible = false;
let focusBeforeHelp = null;
let currentDocument = null;
let readingTools = { ...DEFAULT_READING_TOOLS };
let isReadingToolsOpen = false;
let fontPreferences = { sans: 0, mono: 0 };
let isTypographyOpen = false;
let isAlwaysOnTop = false;
let nativeWindow = null;
let currentSourceLine = 1;
let currentReadingProgress = 0;
let readingUiRafId = null;
let minimapResizeObserver = null;
let isMinimapDragging = false;
let isMinimapDocumentDirty = true;
let minimapCloneRevision = 0;
let minimapContentHeight = 0;
let viewScrollPositions = { rendered: 0, source: 0 };
let windowChromeUnlisteners = [];
let readerShell = null;

const ui = {
  windowFileTitle: null,
  windowMinimizeButton: null,
  windowMaximizeButton: null,
  windowCloseButton: null,
  content: null,
  documentStage: null,
  sourceView: null,
  sourceContent: null,
  lineGutter: null,
  documentMinimap: null,
  minimapDocument: null,
  minimapViewport: null,
  viewport: null,
  readerPage: null,
  emptyStage: null,
  helpStage: null,
  emptyOpenButton: null,
  toolbarOpenButton: null,
  helpToggleButton: null,
  closeHelpButton: null,
  helpTitle: null,
  scrollToTop: null,
  toast: null,
  toolbar: null,
  toolbarActions: null,
  actionsToggleButton: null,
  statusPrimary: null,
  statusContext: null,
  statusMetrics: null,
  readingToolsButton: null,
  readingToolsShell: null,
  readingToolsPanel: null,
  readingToolToggles: [],
  typographyShell: null,
  typographyButton: null,
  typographyPanel: null,
  fontButtons: [],
  alwaysOnTopButton: null,
};

function cacheElements() {
  ui.windowFileTitle = document.getElementById('window-file-title');
  ui.windowMinimizeButton = document.getElementById('window-minimize-button');
  ui.windowMaximizeButton = document.getElementById('window-maximize-button');
  ui.windowCloseButton = document.getElementById('window-close-button');
  ui.content = document.getElementById('content');
  ui.documentStage = document.getElementById('document-stage');
  ui.sourceView = document.getElementById('source-view');
  ui.sourceContent = document.getElementById('source-content');
  ui.lineGutter = document.getElementById('line-gutter');
  ui.documentMinimap = document.getElementById('document-minimap');
  ui.minimapDocument = document.getElementById('minimap-document');
  ui.minimapViewport = document.getElementById('minimap-viewport');
  ui.viewport = document.getElementById('viewport');
  ui.readerPage = document.getElementById('reader-page');
  ui.emptyStage = document.getElementById('empty-stage');
  ui.helpStage = document.getElementById('help-stage');
  ui.emptyOpenButton = document.getElementById('empty-open-button');
  ui.toolbarOpenButton = document.getElementById('toolbar-open-button');
  ui.helpToggleButton = document.getElementById('help-toggle-button');
  ui.closeHelpButton = document.getElementById('close-help-button');
  ui.helpTitle = document.getElementById('help-title');
  ui.scrollToTop = document.getElementById('scroll-to-top');
  ui.toast = document.getElementById('toast');
  ui.toolbar = document.getElementById('app-toolbar');
  ui.toolbarActions = document.getElementById('toolbar-actions');
  ui.actionsToggleButton = document.getElementById('actions-toggle-button');
  ui.statusPrimary = document.getElementById('status-pill');
  ui.statusContext = document.getElementById('status-context');
  ui.statusMetrics = document.getElementById('status-metrics');
  ui.readingToolsButton = document.getElementById('reading-tools-button');
  ui.readingToolsShell = document.getElementById('reading-tools-shell');
  ui.readingToolsPanel = document.getElementById('reading-tools-panel');
  ui.readingToolToggles = [...document.querySelectorAll('[data-reading-tool]')];
  ui.typographyShell = document.getElementById('typography-shell');
  ui.typographyButton = document.getElementById('typography-button');
  ui.typographyPanel = document.getElementById('typography-panel');
  ui.fontButtons = [...document.querySelectorAll('[data-font-kind]')];
  ui.alwaysOnTopButton = document.getElementById('always-on-top-button');
}

function updateWindowTitle(filePath = null) {
  const visibleTitle = isHelpVisible ? 'Help' : filePath ? getDisplayName(filePath) : 'Ready';
  document.title = visibleTitle === 'Ready' ? 'open.md' : `open.md — ${visibleTitle}`;
  if (ui.windowFileTitle) {
    ui.windowFileTitle.textContent = visibleTitle;
    ui.windowFileTitle.title = visibleTitle;
  }
}

async function setupWindowChrome() {
  if (!window.__TAURI_INTERNALS__) return;

  nativeWindow = getCurrentWindow();
  const syncMaximizePresentation = async () => {
    const maximized = await nativeWindow.isMaximized();
    const presentation = getWindowControlPresentation(maximized);
    const icon = ui.windowMaximizeButton?.querySelector('i');
    if (icon) icon.className = presentation.iconClass;
    if (ui.windowMaximizeButton) {
      ui.windowMaximizeButton.setAttribute('aria-label', presentation.label);
      ui.windowMaximizeButton.title = presentation.label;
    }
    document.body.classList.toggle('is-window-maximized', maximized);
  };

  const runWindowAction = async (action, failureMessage, afterAction = null) => {
    try {
      await action();
      await afterAction?.();
    } catch (error) {
      console.error(failureMessage, error);
      showToast(failureMessage, 'error');
    }
  };

  const toggleMaximize = () => runWindowAction(
    () => nativeWindow.toggleMaximize(),
    'Could not resize the window',
    syncMaximizePresentation
  );

  ui.windowMinimizeButton?.addEventListener('click', () => {
    runWindowAction(() => nativeWindow.minimize(), 'Could not minimize the window');
  });
  ui.windowMaximizeButton?.addEventListener('click', toggleMaximize);
  ui.windowCloseButton?.addEventListener('click', () => {
    runWindowAction(() => nativeWindow.close(), 'Could not close the window');
  });
  try {
    await nativeWindow.setAlwaysOnTop(isAlwaysOnTop);
  } catch (error) {
    isAlwaysOnTop = false;
    saveAlwaysOnTopPreference();
    updateAlwaysOnTopControl();
    console.warn('Could not restore the always-on-top preference:', error);
  }
  await syncMaximizePresentation();
  windowChromeUnlisteners.push(await nativeWindow.onResized(syncMaximizePresentation));
}

function updateWindowUrl(filePath = null) {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  if (filePath) {
    url.searchParams.set('file', filePath);
  } else {
    url.searchParams.delete('file');
  }

  window.history.replaceState({}, '', url);
}

function populateThemeSelect() {
  const select = document.getElementById('theme-select');
  if (!select) return;
  select.innerHTML = '';

  const curatedNames = new Set(CURATED_THEME_NAMES.map((name) => name.toLowerCase()));
  const recommendedGroup = document.createElement('optgroup');
  recommendedGroup.label = 'Recommended';
  const catalogGroup = document.createElement('optgroup');
  catalogGroup.label = 'All themes';

  const appendOption = (group, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = themes[index].name;
    if (index === currentThemeIndex) option.selected = true;
    group.appendChild(option);
  };

  for (const themeName of CURATED_THEME_NAMES) {
    const index = themes.findIndex((theme) => theme.name.toLowerCase() === themeName.toLowerCase());
    if (index >= 0) appendOption(recommendedGroup, index);
  }

  for (let i = 0; i < themes.length; i += 1) {
    if (!curatedNames.has(themes[i].name.toLowerCase())) {
      appendOption(catalogGroup, i);
    }
  }

  if (recommendedGroup.children.length > 0) select.appendChild(recommendedGroup);
  if (catalogGroup.children.length > 0) select.appendChild(catalogGroup);
}
function updateThemeCopy() {
  const select = document.getElementById('theme-select');
  if (select && currentThemeIndex >= 0) {
    select.value = String(currentThemeIndex);
    const themeLabel = `Theme: ${themes[currentThemeIndex].name}`;
    select.title = themeLabel;
    select.setAttribute('aria-label', themeLabel);
    select.closest('.theme-field')?.setAttribute('title', themeLabel);
  }
}
function setStatusText(primary, context = '', title = [primary, context].filter(Boolean).join(' · ')) {
  const primaryElement = ui.statusPrimary || document.getElementById('status-pill');
  const contextElement = ui.statusContext || document.getElementById('status-context');
  if (!primaryElement) return;

  primaryElement.textContent = primary;
  primaryElement.title = title;
  if (contextElement) {
    contextElement.textContent = context;
    contextElement.title = title;
  }
}
function updateStatus(filePath = null) {
  if (isHelpVisible) {
    setStatusText('Help', 'F1 to close');
    updateStatusMetrics();
    return;
  }

  if (filePath) {
    const viewLabel = currentDocument && readingTools.source ? 'Source' : getFileKind(filePath);
    setStatusText(getDisplayName(filePath), viewLabel);
    updateStatusMetrics();
    return;
  }

  setStatusText('open.md', 'Ready');
  updateStatusMetrics();
}

function updateStatusMetrics() {
  if (!ui.statusMetrics) return;

  const isAvailable = Boolean(currentDocument && currentFilePath && !isHelpVisible);
  if (!isAvailable) {
    ui.statusMetrics.hidden = true;
    ui.statusMetrics.textContent = '';
    ui.statusMetrics.removeAttribute('aria-label');
    return;
  }

  const metrics = getStatusMetricParts({
    lineCount: currentDocument.lineCount,
    characterCount: currentDocument.characterCount,
    zoomPercent: currentZoom * 100,
    currentLine: currentSourceLine,
    showCurrentLine: readingTools.lineGuide,
    readingProgress: currentReadingProgress,
    readingTimeMinutes: currentDocument.readingTimeMinutes,
    showReadingStats: readingTools.stats,
  });

  ui.statusMetrics.hidden = false;
  ui.statusMetrics.textContent = metrics.visible.join(' · ');
  ui.statusMetrics.title = metrics.accessible.join('. ');
  ui.statusMetrics.setAttribute('aria-label', metrics.accessible.join('. '));
}

function hasLoadedDocument() {
  return Boolean(currentDocument && currentFilePath);
}

function isSourceViewActive() {
  return hasLoadedDocument() && readingTools.source;
}

function loadReadingToolPreferences() {
  try {
    const saved = localStorage.getItem(READING_TOOLS_STORAGE_KEY);
    readingTools = saved ? normalizeReadingTools(JSON.parse(saved)) : { ...DEFAULT_READING_TOOLS };
  } catch (error) {
    console.warn('Could not read saved reading tools:', error);
    readingTools = { ...DEFAULT_READING_TOOLS };
  }
}

function saveReadingToolPreferences() {
  try {
    localStorage.setItem(READING_TOOLS_STORAGE_KEY, JSON.stringify(readingTools));
  } catch (error) {
    console.warn('Could not save reading tools:', error);
  }
}

function updateFontControls() {
  for (const kind of Object.keys(FONT_PRESETS)) {
    const presets = FONT_PRESETS[kind];
    const index = normalizeCycleIndex(fontPreferences[kind], presets.length);
    const current = presets[index];
    const next = presets[(index + 1) % presets.length];
    const button = ui.fontButtons.find((candidate) => candidate.dataset.fontKind === kind);
    const name = document.getElementById(`${kind}-font-name`);
    const kindLabel = kind === 'sans' ? 'Sans' : 'Mono';

    if (name) name.textContent = current.name;
    if (button) {
      const label = `${kindLabel} font: ${current.name}. Activate for ${next.name}`;
      button.setAttribute('aria-label', label);
      button.title = label;
    }
  }
}

function applyFontPreferences({ announceKind = null } = {}) {
  const root = document.documentElement;
  for (const kind of Object.keys(FONT_PRESETS)) {
    const presets = FONT_PRESETS[kind];
    const index = normalizeCycleIndex(fontPreferences[kind], presets.length);
    fontPreferences[kind] = index;
    root.style.setProperty(`--font-${kind}`, presets[index].value);
  }

  updateFontControls();
  isMinimapDocumentDirty = true;
  queueReadingUiUpdate();

  if (announceKind && FONT_PRESETS[announceKind]) {
    const label = announceKind === 'sans' ? 'Sans' : 'Mono';
    showToast(`${label} font: ${FONT_PRESETS[announceKind][fontPreferences[announceKind]].name}`);
  }
}

function loadVisualPreferences() {
  try {
    const savedFonts = JSON.parse(localStorage.getItem(FONT_PREFERENCES_STORAGE_KEY) || '{}');
    fontPreferences = Object.fromEntries(
      Object.keys(FONT_PRESETS).map((kind) => [
        kind,
        normalizeCycleIndex(savedFonts?.[kind], FONT_PRESETS[kind].length),
      ])
    );
  } catch (error) {
    console.warn('Could not read saved font preferences:', error);
    fontPreferences = { sans: 0, mono: 0 };
  }

  try {
    isAlwaysOnTop = localStorage.getItem(ALWAYS_ON_TOP_STORAGE_KEY) === 'true';
  } catch (error) {
    console.warn('Could not read the always-on-top preference:', error);
    isAlwaysOnTop = false;
  }

  applyFontPreferences();
  updateAlwaysOnTopControl();
}

function saveFontPreferences() {
  try {
    localStorage.setItem(FONT_PREFERENCES_STORAGE_KEY, JSON.stringify(fontPreferences));
  } catch (error) {
    console.warn('Could not save font preferences:', error);
  }
}

function cycleFont(kind) {
  const presets = FONT_PRESETS[kind];
  if (!presets) return;

  fontPreferences = {
    ...fontPreferences,
    [kind]: normalizeCycleIndex(fontPreferences[kind] + 1, presets.length),
  };
  saveFontPreferences();
  applyFontPreferences({ announceKind: kind });
}

function setTypographyOpen(nextOpen, { returnFocus = false } = {}) {
  isTypographyOpen = Boolean(nextOpen && !isHelpVisible);
  if (isTypographyOpen) setReadingToolsOpen(false);
  document.body.classList.toggle('is-typography-open', isTypographyOpen);
  ui.typographyButton?.setAttribute('aria-expanded', String(isTypographyOpen));

  if (ui.typographyButton) {
    const label = isTypographyOpen ? 'Close typography options' : 'Open typography options';
    ui.typographyButton.setAttribute('aria-label', label);
    ui.typographyButton.title = label;
  }

  if (ui.typographyPanel) {
    ui.typographyPanel.setAttribute('aria-hidden', String(!isTypographyOpen));
    ui.typographyPanel.toggleAttribute('inert', !isTypographyOpen);
  }

  if (!isTypographyOpen && returnFocus) {
    queueMicrotask(() => ui.typographyButton?.focus());
  }
}

function updateAlwaysOnTopControl() {
  const label = `Always on top: ${isAlwaysOnTop ? 'on' : 'off'}`;
  document.body.classList.toggle('is-always-on-top', isAlwaysOnTop);
  ui.alwaysOnTopButton?.setAttribute('aria-checked', String(isAlwaysOnTop));
  if (ui.alwaysOnTopButton) {
    ui.alwaysOnTopButton.setAttribute('aria-label', label);
    ui.alwaysOnTopButton.title = label;
  }
}

function saveAlwaysOnTopPreference() {
  try {
    localStorage.setItem(ALWAYS_ON_TOP_STORAGE_KEY, String(isAlwaysOnTop));
  } catch (error) {
    console.warn('Could not save the always-on-top preference:', error);
  }
}

async function toggleAlwaysOnTop() {
  if (!nativeWindow) {
    showToast('Always on top is available in the desktop app');
    return;
  }

  const nextValue = !isAlwaysOnTop;
  if (ui.alwaysOnTopButton) ui.alwaysOnTopButton.disabled = true;
  try {
    await nativeWindow.setAlwaysOnTop(nextValue);
    isAlwaysOnTop = nextValue;
    saveAlwaysOnTopPreference();
    updateAlwaysOnTopControl();
    showToast(`Always on top ${nextValue ? 'on' : 'off'}`);
  } catch (error) {
    console.error('Could not change the always-on-top setting:', error);
    showToast('Could not change always on top');
  } finally {
    if (ui.alwaysOnTopButton) ui.alwaysOnTopButton.disabled = false;
  }
}

function setReadingToolsOpen(nextOpen, { returnFocus = false } = {}) {
  const canOpen = hasLoadedDocument() && !isHelpVisible;
  isReadingToolsOpen = Boolean(nextOpen && canOpen);
  if (isReadingToolsOpen) setTypographyOpen(false);
  document.body.classList.toggle('is-reading-tools-open', isReadingToolsOpen);
  ui.readingToolsButton?.setAttribute('aria-expanded', String(isReadingToolsOpen));

  if (ui.readingToolsButton) {
    const label = isReadingToolsOpen ? 'Close reading tools' : 'Open reading tools';
    ui.readingToolsButton.setAttribute('aria-label', label);
    ui.readingToolsButton.title = label;
  }

  if (ui.readingToolsPanel) {
    ui.readingToolsPanel.setAttribute('aria-hidden', String(!isReadingToolsOpen));
    ui.readingToolsPanel.toggleAttribute('inert', !isReadingToolsOpen);
  }

  if (!isReadingToolsOpen && returnFocus) {
    queueMicrotask(() => ui.readingToolsButton?.focus());
  }
}

function updateReadingToolControls() {
  const available = hasLoadedDocument();
  const hasActiveTool = available && Object.values(readingTools).some(Boolean);

  if (ui.readingToolsButton) {
    ui.readingToolsButton.disabled = !available;
    ui.readingToolsButton.classList.toggle('is-active', hasActiveTool);
    if (!available) ui.readingToolsButton.title = 'Open a file to use reading tools';
  }

  ui.readingToolToggles.forEach((toggle) => {
    const tool = toggle.dataset.readingTool;
    toggle.disabled = !available;
    toggle.setAttribute('aria-checked', String(Boolean(readingTools[tool])));
  });

  if (!available) setReadingToolsOpen(false);
}

function applyReadingTools() {
  const available = hasLoadedDocument();
  const sourceActive = available && readingTools.source;
  const lineGuideActive = available && readingTools.lineGuide;
  const minimapActive = available && readingTools.minimap;

  document.body.classList.toggle('is-source-view', sourceActive);
  document.body.classList.toggle('is-line-guide', lineGuideActive);
  document.body.classList.toggle('is-minimap', minimapActive);
  ui.content?.classList.toggle('hidden', sourceActive);
  ui.sourceView?.classList.toggle('hidden', !sourceActive);

  if (ui.lineGutter) {
    ui.lineGutter.hidden = !lineGuideActive;
    if (!lineGuideActive) ui.lineGutter.replaceChildren();
  }

  if (ui.documentMinimap) {
    ui.documentMinimap.hidden = !minimapActive;
    isMinimapDocumentDirty = minimapActive;
    if (!minimapActive) {
      minimapContentHeight = 0;
      ui.minimapDocument?.replaceChildren();
    }
  }

  updateReadingToolControls();
  updateStatus(currentFilePath);
  queueReadingUiUpdate();
}

function setReadingTool(tool, nextValue) {
  if (!Object.hasOwn(DEFAULT_READING_TOOLS, tool) || !hasLoadedDocument()) return;

  const next = Boolean(nextValue);
  if (readingTools[tool] === next) return;

  if (tool === 'source' && ui.readerPage) {
    const previousView = readingTools.source ? 'source' : 'rendered';
    viewScrollPositions[previousView] = ui.readerPage.scrollTop;
  }

  readingTools = { ...readingTools, [tool]: next };
  saveReadingToolPreferences();
  applyReadingTools();

  if (tool === 'source' && ui.readerPage) {
    const nextView = next ? 'source' : 'rendered';
    requestAnimationFrame(() => {
      ui.readerPage?.scrollTo({ top: viewScrollPositions[nextView] || 0, behavior: 'auto' });
      queueReadingUiUpdate();
      (next ? ui.sourceView : ui.content)?.focus({ preventScroll: true });
    });
  }

  const labels = {
    lineGuide: 'Line guide',
    minimap: 'Minimap',
    source: 'Source view',
    stats: 'Reading stats',
  };
  showToast(`${labels[tool]} ${next ? 'on' : 'off'}`);
}

function syncViewportState() {
  const mode = getViewportMode(Boolean(currentFilePath), isHelpVisible);
  const readerMode = currentFilePath ? 'content' : 'empty';
  const sourceActive = readerMode === 'content' && isSourceViewActive();

  if (ui.emptyStage) {
    ui.emptyStage.classList.toggle('hidden', readerMode !== 'empty');
  }

  if (ui.helpStage) {
    ui.helpStage.setAttribute('aria-hidden', String(mode !== 'help'));
    ui.helpStage.toggleAttribute('inert', mode !== 'help');
  }

  if (ui.documentStage) {
    ui.documentStage.classList.toggle('hidden', readerMode !== 'content');
  }

  if (ui.content) {
    ui.content.classList.toggle('hidden', readerMode !== 'content' || sourceActive);
  }

  if (ui.sourceView) {
    ui.sourceView.classList.toggle('hidden', readerMode !== 'content' || !sourceActive);
  }

  if (ui.readerPage) {
    ui.readerPage.setAttribute('aria-hidden', String(mode === 'help'));
    ui.readerPage.toggleAttribute('inert', mode === 'help');
  }

  if (ui.viewport) {
    ui.viewport.setAttribute('data-page', mode === 'help' ? '2' : '1');
  }

  document.body.classList.toggle('is-help-open', mode === 'help');
  ui.helpToggleButton?.setAttribute('aria-expanded', String(mode === 'help'));
  if (ui.helpToggleButton) {
    const helpLabel = mode === 'help' ? 'Close help' : 'Open help';
    ui.helpToggleButton.setAttribute('aria-label', helpLabel);
    ui.helpToggleButton.title = `${helpLabel} (F1)`;
  }
}

function setHelpVisible(nextVisible, { manageFocus = true } = {}) {
  if (nextVisible === isHelpVisible) return;

  if (nextVisible && manageFocus) {
    focusBeforeHelp = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  }

  isHelpVisible = nextVisible;
  if (nextVisible) {
    setReadingToolsOpen(false);
    setTypographyOpen(false);
  }
  syncViewportState();
  updateStatus(currentFilePath);
  updateWindowTitle(currentFilePath);
  setActionsPinned(false);

  if (nextVisible) {
    ui.helpStage?.scrollTo({ top: 0, behavior: 'auto' });
  }
  handleScroll();

  if (!manageFocus) return;

  if (nextVisible) {
    queueMicrotask(() => ui.helpTitle?.focus());
    return;
  }

  const returnTarget = focusBeforeHelp?.isConnected
    ? focusBeforeHelp
    : ui.helpToggleButton;
  focusBeforeHelp = null;
  queueMicrotask(() => returnTarget?.focus());
}

function toggleHelp() {
  setHelpVisible(!isHelpVisible);
}

function setDragState(isActive) {
  document.body.classList.toggle('is-dragging', isActive);
}

async function initThemes() {
  try {
    themes = [...allThemes].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
    let savedThemeName = null;
    try {
      savedThemeName = localStorage.getItem(THEME_STORAGE_KEY);
    } catch (error) {
      console.warn('Could not read the saved theme:', error);
    }
    currentThemeIndex = getPreferredThemeIndex(themes, savedThemeName);

    populateThemeSelect();
    updateThemeCopy();

    if (currentThemeIndex >= 0) {
      applyTheme(themes[currentThemeIndex], { silent: true });
    }
  } catch (error) {
    console.error('Failed to initialize themes:', error);
    showToast('Could not load themes');
  }
}

function applyTheme(theme, { silent = false } = {}) {
  if (!theme) return;

  const root = document.documentElement;
  const tokens = getThemeTokens(theme);
  root.style.setProperty('--bg-color', tokens.background);
  root.style.setProperty('--text-color', tokens.text);
  root.style.setProperty('--border-color', tokens.border);
  root.style.setProperty('--link-color', tokens.link);
  root.style.setProperty('--accent-color', tokens.accent);
  root.style.setProperty('--ui-accent', tokens.accent);
  root.style.setProperty('--accent-foreground', tokens.accentForeground);
  root.style.setProperty('--code-bg', tokens.surface);
  root.style.setProperty('--heading-1', tokens.text);
  root.style.setProperty('--heading-2', tokens.text);
  root.style.setProperty('--heading-3', tokens.text);
  root.style.setProperty('--heading-4', tokens.text);
  root.style.setProperty('--heading-5', tokens.text);
  root.style.setProperty('--quote-color', tokens.quote);
  root.style.setProperty('--panel-bg', tokens.surface);
  root.style.setProperty('--toolbar-bg', tokens.surface);
  root.style.setProperty('--danger-color', tokens.danger);
  root.style.setProperty('--shadow-color', tokens.shadow);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tokens.background);

  const isDark = isColorDark(tokens.background);
  root.style.colorScheme = isDark ? 'dark' : 'light';

  currentThemeIndex = themes.findIndex((item) => item.name === theme.name);

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme.name);
  } catch (error) {
    console.warn('Could not persist the selected theme:', error);
  }
  updateThemeCopy();

  if (!silent) {
    showToast(`Theme: ${theme.name}`);
  }

  if (currentFilePath && ui.content?.querySelector('.mermaid')) {
    readerShell?.refreshAppearance({ diagramTheme: isDark ? 'dark' : 'default' })
      .then(markMinimapDirty)
      .catch((error) => console.error('Could not refresh document appearance:', error));
  }
  isMinimapDocumentDirty = true;
  queueReadingUiUpdate();
}

function showToast(message) {
  let toast = ui.toast || document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.setAttribute('aria-atomic', 'true');
    document.body.appendChild(toast);
    ui.toast = toast;
  }
  toast.textContent = message;
  toast.classList.add('show');

  clearTimeout(toastTimeoutId);
  toastTimeoutId = setTimeout(() => {
    toast.classList.remove('show');
  }, 2000);
}

function cycleTheme(direction = 1) {
  if (themes.length === 0) return;
  currentThemeIndex = (currentThemeIndex + direction + themes.length) % themes.length;
  applyTheme(themes[currentThemeIndex]);
}

function resetDocumentReadingState() {
  isMinimapDocumentDirty = true;
  currentSourceLine = 1;
  currentReadingProgress = 0;
  viewScrollPositions = { rendered: 0, source: 0 };
  isHelpVisible = false;
  focusBeforeHelp = null;
}

function handleDocumentSessionState(snapshot) {
  if (snapshot.state === 'loading') {
    currentFilePath = snapshot.path;
    currentDocument = null;
    resetDocumentReadingState();
    setReadingToolsOpen(false);
    syncViewportState();
    applyReadingTools();
    setStatusText(getDisplayName(snapshot.path), 'Opening…');
    updateWindowTitle(snapshot.path);
    return;
  }

  if (snapshot.state === 'ready') {
    currentFilePath = snapshot.path;
    currentDocument = snapshot.document;
    updateWindowTitle(snapshot.path);
    updateWindowUrl(snapshot.path);
    applyReadingTools();
    return;
  }

  if (snapshot.state === 'failed') {
    currentFilePath = snapshot.path;
    currentDocument = null;
    isMinimapDocumentDirty = true;
    updateWindowTitle(snapshot.path);
    updateWindowUrl(snapshot.path);
    applyReadingTools();
    setStatusText(getDisplayName(snapshot.path), 'Could not open');
    return;
  }

  currentFilePath = null;
  currentDocument = null;
  resetDocumentReadingState();
  syncViewportState();
  applyReadingTools();
  updateWindowTitle();
  updateWindowUrl();
  handleScroll();
}

function activeDiagramTheme() {
  const activeTheme = themes[currentThemeIndex];
  return activeTheme && isColorDark(getThemeTokens(activeTheme).background)
    ? 'dark'
    : 'default';
}

function mountApplicationReaderShell() {
  readerShell = mountReaderShell({
    window,
    adapters: {
      documents: {
        open: (path) => invoke('get_file_content', { path }),
        readImage: (documentPath, relativeSource) => invoke('get_image_bytes', {
          documentPath,
          relativeSource,
        }),
      },
      diagrams: {
        render: renderMermaidDiagrams,
      },
      windows: {
        openDocument: (path) => invoke('open_new_window', { path }),
      },
    },
    hooks: {
      getDiagramTheme: activeDiagramTheme,
      isSourceActive: isSourceViewActive,
      chooseAnotherFile: openFilePicker,
      onDocumentCommitted: ({ path, document: openedDocument }) => {
        currentFilePath = path;
        currentDocument = openedDocument;
        updateWindowTitle(path);
        updateWindowUrl(path);
      },
      onStateChange: handleDocumentSessionState,
      onSettled: handleScroll,
      onWarning: showToast,
      onToast: showToast,
      onDiagnostic: (message, error) => console.error(`${message}:`, error),
    },
  });
}

function handleLinkClick(event) {
  const target = event.target instanceof Element ? event.target.closest('a') : null;
  const hrefAttribute = target?.getAttribute('href');

  if (!target || !hrefAttribute) return;

  const action = getLinkAction(hrefAttribute, currentFilePath, target.href);
  if (action.type === 'anchor') return;

  event.preventDefault();

  if (action.type === 'external') {
    openUrl(action.href).catch((error) => {
      console.error('Failed to open URL:', error);
      showToast('Could not open the external link');
    });
    return;
  }

  if (action.type === 'file') {
    readerShell?.open({
      origin: 'link',
      items: [{ path: action.path, fragment: action.fragment }],
    }).catch((error) => {
      console.error('Could not open the linked document:', error);
      showToast('Could not open the linked document');
    });
    return;
  }

  showToast('This link type is not supported');
}

function setZoom(newZoom) {
  currentZoom = Math.min(Math.max(newZoom, MIN_ZOOM), MAX_ZOOM);
  document.documentElement.style.setProperty('--content-scale', currentZoom.toFixed(2));
  isMinimapDocumentDirty = true;
  updateStatus(currentFilePath);
  queueReadingUiUpdate();
  showToast(`Zoom: ${Math.round(currentZoom * 100)}%`);
}

function handleZoom(event) {
  if (event.ctrlKey) {
    event.preventDefault();
    setZoom(calculateNewZoom(currentZoom, event.deltaY, ZOOM_STEP, MIN_ZOOM, MAX_ZOOM));
  }
}

function getRenderedLineAnchors() {
  if (!ui.content || !ui.documentStage) return [];

  const stageTop = ui.documentStage.getBoundingClientRect().top;
  const seenLines = new Set();
  return [...ui.content.querySelectorAll('.source-line-anchor[data-source-line]')]
    .map((anchor) => {
      let visualTarget = anchor.nextElementSibling;
      while (visualTarget?.classList.contains('source-line-anchor')) {
        visualTarget = visualTarget.nextElementSibling;
      }
      visualTarget ||= anchor;
      const targetRect = visualTarget.getBoundingClientRect();
      const targetStyles = getComputedStyle(visualTarget);
      const targetLineHeight = Number.parseFloat(targetStyles.lineHeight);
      return {
        line: Number.parseInt(anchor.dataset.sourceLine, 10),
        top: targetRect.top - stageTop,
        lineHeight: Number.isFinite(targetLineHeight)
          ? targetLineHeight
          : Math.min(Math.max(targetRect.height, 16), 28),
      };
    })
    .filter((anchor) => {
      if (!Number.isFinite(anchor.line) || anchor.line < 1 || seenLines.has(anchor.line)) return false;
      seenLines.add(anchor.line);
      return true;
    })
    .sort((left, right) => left.top - right.top);
}

function createLineNumber(line, top, isCurrent = false, lineHeight = 20) {
  const label = document.createElement('span');
  label.className = `line-number${isCurrent ? ' is-current' : ''}`;
  label.textContent = String(line);
  label.style.top = `${Math.max(0, top)}px`;
  label.style.height = `${Math.max(1, lineHeight)}px`;
  label.style.lineHeight = `${Math.max(1, lineHeight)}px`;
  return label;
}

function positionLineGutter() {
  if (!ui.lineGutter || !ui.documentStage) return;
  const activeView = isSourceViewActive() ? ui.sourceView : ui.content;
  if (!activeView) return;

  const viewRect = activeView.getBoundingClientRect();
  const stageRect = ui.documentStage.getBoundingClientRect();
  const viewStyles = getComputedStyle(activeView);
  const compact = window.matchMedia?.('(max-width: 460px)').matches;
  const digitWidth = String(currentDocument?.lineCount || 1).length * (compact ? 6 : 7);
  ui.lineGutter.style.width = `${Math.max(compact ? 29 : 34, digitWidth + 8)}px`;
  const gutterRect = ui.lineGutter.getBoundingClientRect();
  const gap = compact ? 8 : 12;
  const left = getLineGutterLeft({
    viewLeft: viewRect.left,
    stageLeft: stageRect.left,
    paddingLeft: Number.parseFloat(viewStyles.paddingLeft) || 0,
    gutterWidth: gutterRect.width || 34,
    gap,
  });
  ui.lineGutter.style.left = `${left}px`;
}

function renderLineGuide() {
  if (!ui.lineGutter || ui.lineGutter.hidden || !ui.readerPage || !currentDocument) return;

  positionLineGutter();
  const { scrollTop, clientHeight } = ui.readerPage;
  const fragment = document.createDocumentFragment();
  let nextCurrentLine = 1;

  if (isSourceViewActive()) {
    const styles = getComputedStyle(ui.sourceView);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 20;
    const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
    const range = getVisibleSourceLineRange({
      scrollTop,
      clientHeight,
      lineHeight,
      paddingTop,
      lineCount: currentDocument.lineCount,
    });
    nextCurrentLine = range.current;

    for (let line = range.first; line <= range.last; line += 1) {
      const top = paddingTop + ((line - 1) * lineHeight);
      fragment.appendChild(createLineNumber(line, top, line === nextCurrentLine, lineHeight));
    }
  } else {
    const anchors = getRenderedLineAnchors();
    const readingOffset = scrollTop + Math.min(48, clientHeight * 0.08);
    nextCurrentLine = getCurrentLineFromAnchors(anchors, readingOffset);
    const visibleStart = scrollTop - 18;
    const visibleEnd = scrollTop + clientHeight + 18;
    let lastVisibleTop = Number.NEGATIVE_INFINITY;
    let currentIsVisible = false;

    for (const anchor of anchors) {
      if (anchor.top < visibleStart || anchor.top > visibleEnd) continue;
      const isCurrent = anchor.line === nextCurrentLine;
      if (!isCurrent && anchor.top - lastVisibleTop < 13) continue;
      fragment.appendChild(createLineNumber(anchor.line, anchor.top, isCurrent, anchor.lineHeight));
      lastVisibleTop = anchor.top;
      currentIsVisible ||= isCurrent;
    }

    if (!currentIsVisible) {
      fragment.appendChild(createLineNumber(nextCurrentLine, readingOffset, true));
    }
  }

  ui.lineGutter.replaceChildren(fragment);
  if (nextCurrentLine !== currentSourceLine) {
    currentSourceLine = nextCurrentLine;
    updateStatusMetrics();
  }
}

function markMinimapDirty() {
  isMinimapDocumentDirty = true;
  queueReadingUiUpdate();
}

function sanitizeMinimapClone(clone) {
  clone.setAttribute('aria-hidden', 'true');
  clone.setAttribute('inert', '');
  clone.classList.remove('hidden');
  clone.querySelectorAll('.copy-code-btn').forEach((button) => button.remove());

  const elements = [clone, ...clone.querySelectorAll('*')];
  const idMap = new Map();
  const prefix = `openmd-minimap-${++minimapCloneRevision}-`;

  elements.forEach((element) => {
    if (element.id) {
      const nextId = `${prefix}${element.id}`;
      idMap.set(element.id, nextId);
      element.id = nextId;
    }
    element.removeAttribute('tabindex');
    element.removeAttribute('autofocus');
    element.removeAttribute('aria-live');
    element.removeAttribute('aria-controls');
    if (element.matches('a')) element.removeAttribute('href');
    if (element.matches('audio, video')) element.removeAttribute('controls');
  });

  if (idMap.size > 0) {
    elements.forEach((element) => {
      [...element.attributes].forEach((attribute) => {
        let nextValue = attribute.value;
        idMap.forEach((nextId, previousId) => {
          nextValue = nextValue.replaceAll(`#${previousId}`, `#${nextId}`);
        });
        if (nextValue !== attribute.value) element.setAttribute(attribute.name, nextValue);
      });
    });
  }
}

function renderMinimapDocument() {
  if (
    !isMinimapDocumentDirty
    || !ui.documentMinimap
    || ui.documentMinimap.hidden
    || !ui.minimapDocument
    || !ui.readerPage
  ) return;

  const activeView = isSourceViewActive() ? ui.sourceView : ui.content;
  if (!activeView) return;
  const trackRect = ui.documentMinimap.getBoundingClientRect();
  const viewRect = activeView.getBoundingClientRect();
  const viewStyles = getComputedStyle(activeView);
  if (trackRect.width <= 0 || trackRect.height <= 0 || viewRect.width <= 0) return;

  const documentWidth = Math.max(1, viewRect.width);
  const documentHeight = Math.max(
    1,
    activeView.scrollHeight,
    viewRect.height,
    ui.readerPage.scrollHeight
  );
  const clone = activeView.cloneNode(true);
  sanitizeMinimapClone(clone);
  clone.style.width = `${documentWidth}px`;
  clone.style.maxWidth = 'none';
  clone.style.minHeight = '0';
  clone.style.margin = '0';

  ui.minimapDocument.style.width = `${documentWidth}px`;
  ui.minimapDocument.style.height = `${documentHeight}px`;
  ui.minimapDocument.style.fontSize = viewStyles.fontSize;
  ui.minimapDocument.style.lineHeight = viewStyles.lineHeight;
  const scale = Math.min(trackRect.width / documentWidth, trackRect.height / documentHeight);
  minimapContentHeight = documentHeight * scale;
  ui.minimapDocument.style.left = `${(trackRect.width - (documentWidth * scale)) / 2}px`;
  ui.minimapDocument.style.transform = `scale(${scale})`;
  ui.minimapDocument.replaceChildren(clone);
  isMinimapDocumentDirty = false;
}

function updateMinimapViewport() {
  if (
    !ui.documentMinimap
    || ui.documentMinimap.hidden
    || !ui.minimapViewport
    || !ui.readerPage
  ) return;

  const geometry = getMinimapViewportGeometry({
    scrollTop: ui.readerPage.scrollTop,
    scrollHeight: ui.readerPage.scrollHeight,
    clientHeight: ui.readerPage.clientHeight,
    trackHeight: ui.documentMinimap.getBoundingClientRect().height,
    contentHeight: minimapContentHeight,
  });
  ui.minimapViewport.style.top = `${geometry.top}px`;
  ui.minimapViewport.style.height = `${geometry.height}px`;
  ui.documentMinimap.setAttribute('aria-valuenow', String(currentReadingProgress));
  ui.documentMinimap.setAttribute('aria-valuetext', `${currentReadingProgress}% through document`);
}

function updateReadingUi() {
  if (!currentDocument || !ui.readerPage || isHelpVisible) return;
  const nextProgress = getReadingProgress(
    ui.readerPage.scrollTop,
    ui.readerPage.scrollHeight,
    ui.readerPage.clientHeight
  );
  const progressChanged = nextProgress !== currentReadingProgress;
  currentReadingProgress = nextProgress;
  renderLineGuide();
  renderMinimapDocument();
  updateMinimapViewport();
  if (progressChanged) updateStatusMetrics();
}

function queueReadingUiUpdate() {
  if (readingUiRafId) return;
  readingUiRafId = requestAnimationFrame(() => {
    readingUiRafId = null;
    updateReadingUi();
  });
}

function scrollFromMinimapPointer(event) {
  if (!ui.documentMinimap || !ui.readerPage) return;
  const rect = ui.documentMinimap.getBoundingClientRect();
  const ratio = Math.min(Math.max((event.clientY - rect.top) / Math.max(1, rect.height), 0), 1);
  const maxScroll = Math.max(0, ui.readerPage.scrollHeight - ui.readerPage.clientHeight);
  ui.readerPage.scrollTo({ top: ratio * maxScroll, behavior: 'auto' });
}

function handleMinimapPointerDown(event) {
  if (event.button !== 0) return;
  isMinimapDragging = true;
  ui.documentMinimap?.setPointerCapture?.(event.pointerId);
  scrollFromMinimapPointer(event);
}

function handleMinimapPointerMove(event) {
  if (isMinimapDragging) scrollFromMinimapPointer(event);
}

function handleMinimapPointerUp(event) {
  isMinimapDragging = false;
  if (ui.documentMinimap?.hasPointerCapture?.(event.pointerId)) {
    ui.documentMinimap.releasePointerCapture(event.pointerId);
  }
}

function handleMinimapKeyboard(event) {
  if (!ui.readerPage) return;
  const maxScroll = Math.max(0, ui.readerPage.scrollHeight - ui.readerPage.clientHeight);
  let nextScroll = null;

  if (event.key === 'Home') nextScroll = 0;
  if (event.key === 'End') nextScroll = maxScroll;
  if (event.key === 'ArrowUp') nextScroll = ui.readerPage.scrollTop - 48;
  if (event.key === 'ArrowDown') nextScroll = ui.readerPage.scrollTop + 48;
  if (event.key === 'PageUp') nextScroll = ui.readerPage.scrollTop - (ui.readerPage.clientHeight * 0.8);
  if (event.key === 'PageDown') nextScroll = ui.readerPage.scrollTop + (ui.readerPage.clientHeight * 0.8);
  if (nextScroll === null) return;

  event.preventDefault();
  ui.readerPage.scrollTo({ top: Math.min(Math.max(nextScroll, 0), maxScroll), behavior: 'auto' });
}

function setupReadingResizeObserver() {
  if (typeof ResizeObserver !== 'function') return;
  minimapResizeObserver = new ResizeObserver(() => {
    isMinimapDocumentDirty = true;
    queueReadingUiUpdate();
  });
  [ui.documentStage, ui.content, ui.sourceView].filter(Boolean).forEach((element) => {
    minimapResizeObserver.observe(element);
  });
}

function getActiveScroller() {
  return isHelpVisible ? ui.helpStage : ui.readerPage;
}

function handleScroll() {
  if (scrollRafId) return;
  scrollRafId = requestAnimationFrame(() => {
    scrollRafId = null;
    const scroller = getActiveScroller();
    if (!scroller) return;
    const { scrollTop, scrollHeight, clientHeight } = scroller;
    const maxScroll = scrollHeight - clientHeight;
    const edges = getScrollEdgeState(scrollTop, scrollHeight, clientHeight);

    document.body.classList.toggle('has-scroll-before', edges.before);
    document.body.classList.toggle('has-scroll-after', edges.after);

    if (ui.scrollToTop && maxScroll > 0 && scrollTop > maxScroll * 0.5) {
      ui.scrollToTop.classList.add('show');
    } else if (ui.scrollToTop) {
      ui.scrollToTop.classList.remove('show');
    }
    if (!isHelpVisible) updateReadingUi();
  });
}

function scrollToTop() {
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  getActiveScroller()?.scrollTo({
    top: 0,
    behavior: reduceMotion ? 'auto' : 'smooth'
  });
}

function setActionsPinned(nextPinned) {
  document.body.classList.toggle('is-actions-pinned', nextPinned);
  ui.actionsToggleButton?.setAttribute('aria-expanded', String(nextPinned));
  if (ui.actionsToggleButton) {
    const label = nextPinned ? 'Hide actions' : 'Show actions';
    ui.actionsToggleButton.setAttribute('aria-label', label);
    ui.actionsToggleButton.title = label;
  }
}

function toggleActions() {
  setActionsPinned(!document.body.classList.contains('is-actions-pinned'));
}

function toggleReadingTools() {
  setReadingToolsOpen(!isReadingToolsOpen);
}

function toggleTypography() {
  setTypographyOpen(!isTypographyOpen);
}

function handleFontCycle(event) {
  cycleFont(event.currentTarget.dataset.fontKind);
}

function handleReadingToolToggle(event) {
  const tool = event.currentTarget.dataset.readingTool;
  setReadingTool(tool, event.currentTarget.getAttribute('aria-checked') !== 'true');
}

function setupActionRevealMode() {
  if (!ui.actionsToggleButton || !window.matchMedia) return;
  const hoverQuery = window.matchMedia('(hover: hover)');
  const syncToggle = () => {
    ui.actionsToggleButton.hidden = hoverQuery.matches;
    if (hoverQuery.matches) setActionsPinned(false);
  };
  syncToggle();
  hoverQuery.addEventListener?.('change', syncToggle);
}

function handleKeyboard(event) {
  if (event.key === 'F1') {
    event.preventDefault();
    toggleHelp();
    return;
  }

  if (event.key === 'Escape' && isHelpVisible) {
    event.preventDefault();
    setHelpVisible(false);
    return;
  }

  if (event.key === 'Escape' && isReadingToolsOpen) {
    event.preventDefault();
    setReadingToolsOpen(false, { returnFocus: true });
    return;
  }

  if (event.key === 'Escape' && isTypographyOpen) {
    event.preventDefault();
    setTypographyOpen(false, { returnFocus: true });
    return;
  }

  if (event.key === 'Escape' && document.body.classList.contains('is-actions-pinned')) {
    event.preventDefault();
    setActionsPinned(false);
    return;
  }

  if (event.ctrlKey && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    openFilePicker();
    return;
  }

  if (event.ctrlKey && (event.key === '=' || event.key === '+')) {
    event.preventDefault();
    setZoom(currentZoom + ZOOM_STEP);
  } else if (event.ctrlKey && event.key === '-') {
    event.preventDefault();
    setZoom(currentZoom - ZOOM_STEP);
  } else if (event.ctrlKey && event.key === '0') {
    event.preventDefault();
    setZoom(1.0);
  }

  const isTypingField = ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target?.tagName)
    || event.target?.isContentEditable;
  if (!isTypingField && (event.key === 't' || event.key === 'T') && !event.metaKey && !event.altKey) {
    event.preventDefault();
    if (event.ctrlKey || event.shiftKey) {
      cycleTheme(-1);
    } else {
      cycleTheme(1);
    }
  }
}

function handleThemeSelection(event) {
  const index = parseInt(event.target.value, 10);
  if (!isNaN(index) && index >= 0 && index < themes.length) {
    applyTheme(themes[index]);
    setReadingToolsOpen(false);
    setActionsPinned(false);
  }
}

function submitNativeOpenFileRequest(value) {
  const items = (Array.isArray(value?.paths) ? value.paths : []).map((path) => ({ path }));
  readerShell?.open({
    origin: 'association',
    items,
    delivery: {
      key: value?.id,
      acknowledge: () => invoke('acknowledge_open_file_request', { id: value?.id }),
    },
  }).catch((error) => {
    console.error('Could not process the file-open request:', error);
    showToast('Could not open the associated file');
  });
}

async function setupFileAssociationEvents() {
  if (!window.__TAURI_INTERNALS__ || getCurrentWindow().label !== 'main') return;

  try {
    fileOpenRequestUnlisten = await listen('open-file-request', (event) => {
      submitNativeOpenFileRequest(event.payload);
    });
    const pendingRequests = await invoke('list_pending_open_file_requests');
    if (Array.isArray(pendingRequests)) pendingRequests.forEach(submitNativeOpenFileRequest);
  } catch (error) {
    console.warn('Native file-open events are unavailable in this runtime:', error);
  }
}

async function openFilePicker() {
  setReadingToolsOpen(false);
  setActionsPinned(false);
  try {
    const selected = await open({
      multiple: true,
      directory: false,
      filters: [
        {
          name: 'Markdown and text',
          extensions: ['md', 'markdown', 'txt'],
        },
      ],
    });

    if (selected === null) {
      return;
    }

    await readerShell?.open({
      origin: 'picker',
      items: (Array.isArray(selected) ? selected : [selected]).map((path) => ({ path })),
    });
  } catch (error) {
    console.error('Open dialog failed:', error);
    showToast('Could not open the file picker');
  }
}

function setupDomDragSafety() {
  window.addEventListener('dragover', (event) => {
    event.preventDefault();
  });

  window.addEventListener('drop', (event) => {
    event.preventDefault();
  });
}

async function setupDragAndDrop() {
  setupDomDragSafety();

  if (!window.__TAURI_INTERNALS__) return;

  try {
    dragDropUnlisten = await getCurrentWebview().onDragDropEvent(async (event) => {
      if (event.payload.type === 'over') {
        setDragState(true);
        return;
      }

      if (event.payload.type === 'drop') {
        setDragState(false);
        await readerShell?.open({
          origin: 'drop',
          items: (event.payload.paths || []).map((path) => ({ path })),
        });
        return;
      }

      setDragState(false);
    });
  } catch (error) {
    console.warn('Drag & drop listener unavailable in this runtime:', error);
  }
}

function registerEvents() {
  window.addEventListener('wheel', handleZoom, { passive: false });
  window.addEventListener('keydown', handleKeyboard);
  window.addEventListener('beforeunload', () => {
    if (typeof dragDropUnlisten === 'function') {
      dragDropUnlisten();
    }
    if (typeof fileOpenRequestUnlisten === 'function') {
      fileOpenRequestUnlisten();
    }
    minimapResizeObserver?.disconnect();
    readerShell?.dispose();
    windowChromeUnlisteners.forEach((unlisten) => unlisten());
    windowChromeUnlisteners = [];
  });
  window.addEventListener('resize', queueReadingUiUpdate, { passive: true });
  window.addEventListener('resize', handleScroll, { passive: true });
  document.addEventListener('click', handleLinkClick);
  document.addEventListener('pointerdown', (event) => {
    if (isReadingToolsOpen && !ui.readingToolsShell?.contains(event.target)) {
      setReadingToolsOpen(false);
    }
    if (isTypographyOpen && !ui.typographyShell?.contains(event.target)) {
      setTypographyOpen(false);
    }
    if (
      document.body.classList.contains('is-actions-pinned')
      && !ui.toolbar?.contains(event.target)
    ) {
      setActionsPinned(false);
    }
  });

  ui.emptyOpenButton?.addEventListener('click', openFilePicker);
  ui.toolbarOpenButton?.addEventListener('click', openFilePicker);
  ui.helpToggleButton?.addEventListener('click', toggleHelp);
  ui.closeHelpButton?.addEventListener('click', () => setHelpVisible(false));
  ui.scrollToTop?.addEventListener('click', scrollToTop);
  ui.readerPage?.addEventListener('scroll', handleScroll, { passive: true });
  ui.helpStage?.addEventListener('scroll', handleScroll, { passive: true });
  ui.actionsToggleButton?.addEventListener('click', toggleActions);
  ui.readingToolsButton?.addEventListener('click', toggleReadingTools);
  ui.typographyButton?.addEventListener('click', toggleTypography);
  ui.alwaysOnTopButton?.addEventListener('click', toggleAlwaysOnTop);
  ui.readingToolToggles.forEach((toggle) => {
    toggle.addEventListener('click', handleReadingToolToggle);
  });
  ui.fontButtons.forEach((button) => {
    button.addEventListener('click', handleFontCycle);
  });
  ui.documentMinimap?.addEventListener('pointerdown', handleMinimapPointerDown);
  ui.documentMinimap?.addEventListener('pointermove', handleMinimapPointerMove);
  ui.documentMinimap?.addEventListener('pointerup', handleMinimapPointerUp);
  ui.documentMinimap?.addEventListener('pointercancel', handleMinimapPointerUp);
  ui.documentMinimap?.addEventListener('keydown', handleMinimapKeyboard);
  document.getElementById('theme-select')?.addEventListener('change', handleThemeSelection);
}

async function init() {
  cacheElements();
  mountApplicationReaderShell();
  loadReadingToolPreferences();
  loadVisualPreferences();
  syncViewportState();
  registerEvents();
  await setupFileAssociationEvents();
  await setupWindowChrome();
  setupActionRevealMode();
  setupReadingResizeObserver();
  await initThemes();
  const queryFilePath = new URLSearchParams(window.location.search).get('file');
  let initialFilePaths = queryFilePath ? [queryFilePath] : [];

  if (initialFilePaths.length === 0 && window.__TAURI_INTERNALS__) {
    try {
      const launchPaths = await invoke('get_initial_file_paths');
      initialFilePaths = Array.isArray(launchPaths) ? launchPaths : [];
    } catch (error) {
      console.warn('Could not inspect the launch file:', error);
    }
  }

  await readerShell.start(initialFilePaths.length > 0 ? {
    origin: 'launch',
    items: initialFilePaths.map((path) => ({ path })),
  } : null);
  await setupDragAndDrop();
}

if (typeof window !== 'undefined' && !window.__VITEST__) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init().catch((error) => console.error('open.md initialization failed:', error));
    });
  } else {
    init().catch((error) => console.error('open.md initialization failed:', error));
  }
}
