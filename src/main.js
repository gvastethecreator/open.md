import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import allThemes from './themes.runtime.json';
import {
  calculateNewZoom,
  getDisplayName,
  getEstimatedMinutesRemaining,
  getFileKind,
  getLinkAction,
  getStatusMetricParts,
  getViewportMode,
  getZoomStatusMetric,
} from './core/reader.js';
import { prepareMermaidDiagrams, renderMermaidDiagrams } from './mermaid-renderer.js';
import { createDocumentSaveCoordinator } from './document-save-coordinator.js';
import { createEditorSession } from './editor-session.js';
import { orderNativeOpenRequests } from './open-intent-controller.js';
import { mountReaderShell } from './reader-shell.js';
import {
  DEFAULT_READING_TOOLS,
  FONT_PRESETS,
  createOptionalWebPreferenceStore,
  normalizeFontIndex,
} from './reader-preferences.js';
import { createResponsiveTypography } from './responsive-typography.js';
import { createReadingNavigationController } from './reading-navigation-controller.js';
import { createDocumentModeCoordinator } from './document-mode-coordinator.js';
import { createToastPresenter } from './toast-presenter.js';
import { createThemeCoordinator } from './theme-coordinator.js';
import { createWindowChrome } from './window-chrome.js';

let currentZoom = 1;
const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3.0;
let dragDropUnlisten = null;
let fileOpenRequestUnlisten = null;
let currentFilePath = null;
let isHelpVisible = false;
let focusBeforeHelp = null;
let currentDocument = null;
let readingTools = { ...DEFAULT_READING_TOOLS };
let isReadingToolsOpen = false;
let fontPreferences = { sans: 0, mono: 0 };
let isTypographyOpen = false;
let isAlwaysOnTop = false;
let isAutoSaveEnabled = true;
let windowChrome = null;
let readerShell = null;
let editorSession = null;
let isEditMode = false;
let responsiveTypography = null;
let documentSaveCoordinator = null;
let documentModeCoordinator = null;
let readingNavigation = null;
let toastPresenter = null;
let themeCoordinator = null;
let syntaxHighlighterPromise = null;

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
  autoSaveToggle: null,
  editorView: null,
  editorCanvas: null,
  editModeButton: null,
  editModeLabel: null,
  editorSaveButton: null,
  editorSaveLabel: null,
  editorCommandMenu: null,
  editorBlockMenu: null,
  editorInlineToolbar: null,
  editorCaretEcho: null,
  editorLinkPopover: null,
  editorLinkInput: null,
  editorLinkApply: null,
  editorContextLabel: null,
  editorContextHint: null,
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
  ui.autoSaveToggle = document.getElementById('auto-save-toggle');
  ui.editorView = document.getElementById('editor-view');
  ui.editorCanvas = document.getElementById('editor-canvas');
  ui.editModeButton = document.getElementById('edit-mode-button');
  ui.editModeLabel = document.getElementById('edit-mode-label');
  ui.editorSaveButton = document.getElementById('editor-save-button');
  ui.editorSaveLabel = document.getElementById('editor-save-label');
  ui.editorCommandMenu = document.getElementById('editor-command-menu');
  ui.editorBlockMenu = document.getElementById('editor-block-menu');
  ui.editorInlineToolbar = document.getElementById('editor-inline-toolbar');
  ui.editorCaretEcho = document.getElementById('editor-caret-echo');
  ui.editorLinkPopover = document.getElementById('editor-link-popover');
  ui.editorLinkInput = document.getElementById('editor-link-input');
  ui.editorLinkApply = document.getElementById('editor-link-apply');
  ui.editorContextLabel = document.getElementById('editor-context-label');
  ui.editorContextHint = document.getElementById('editor-context-hint');
}

function updateWindowTitle(filePath = null) {
  const visibleTitle = isHelpVisible ? 'About + Help' : filePath ? getDisplayName(filePath) : 'Ready';
  document.title = visibleTitle === 'Ready' ? 'open.md' : `open.md — ${visibleTitle}`;
  if (ui.windowFileTitle) {
    ui.windowFileTitle.textContent = visibleTitle;
    ui.windowFileTitle.title = visibleTitle;
  }
}

async function setupWindowChrome() {
  if (!window.__TAURI_INTERNALS__) return;
  windowChrome = createWindowChrome({
    document,
    elements: {
      minimize: ui.windowMinimizeButton,
      maximize: ui.windowMaximizeButton,
      close: ui.windowCloseButton,
    },
    nativeWindow: getCurrentWindow(),
    onError: (message, error) => {
      console.error(message, error);
      showToast(message);
    },
  });
  await windowChrome.start();
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
    setStatusText('About + Help', 'F1 to close');
    updateStatusMetrics();
    return;
  }

  if (filePath) {
    if (isEditMode) {
      const editorState = editorSession?.current();
      setStatusText(getDisplayName(filePath), 'Editing');
      updateStatusMetrics();
      return;
    }
    const viewLabel = currentDocument && readingTools.source ? 'Source' : getFileKind(filePath);
    setStatusText(getDisplayName(filePath), viewLabel);
    updateStatusMetrics();
    return;
  }

  setStatusText('open.md', 'Ready');
  updateStatusMetrics();
}

function renderStatusMetricItems(items, accessibleLabel) {
  if (!ui.statusMetrics) return;

  const existingByKind = new Map(
    [...ui.statusMetrics.querySelectorAll('.status-metric')]
      .map((item) => [item.dataset.statusKind, item])
  );
  const nodes = items.map(({ kind, visible }) => {
    const item = existingByKind.get(kind) || document.createElement('span');
    item.className = `status-metric status-metric--${kind}`;
    item.dataset.statusKind = kind;
    if (kind === 'zoom') {
      let icon = item.querySelector('i');
      let value = item.querySelector('.status-metric-value');
      if (!icon) {
        icon = document.createElement('i');
        icon.className = 'iconoir-search';
        icon.setAttribute('aria-hidden', 'true');
        item.append(icon);
      }
      if (!value) {
        value = document.createElement('span');
        value.className = 'status-metric-value';
        item.append(value);
      }
      const changed = value.textContent && value.textContent !== visible;
      value.textContent = visible;
      if (
        changed
        && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        && typeof value.animate === 'function'
      ) {
        value.getAnimations?.().forEach((animation) => animation.cancel());
        value.animate([
          { opacity: 0, filter: 'blur(0.6px)', transform: 'translateY(3px)' },
          { opacity: 1, filter: 'blur(0)', transform: 'translateY(0)' },
        ], {
          duration: 160,
          easing: 'cubic-bezier(0.2, 0, 0, 1)',
        });
      }
    } else {
      item.textContent = visible;
    }
    return item;
  });

  const currentKinds = [...ui.statusMetrics.querySelectorAll('.status-metric')]
    .map((item) => item.dataset.statusKind);
  const nextKinds = items.map(({ kind }) => kind);
  if (
    currentKinds.length !== nextKinds.length
    || currentKinds.some((kind, index) => kind !== nextKinds[index])
  ) {
    ui.statusMetrics.replaceChildren(...nodes);
  }
  ui.statusMetrics.hidden = nodes.length === 0;
  if (nodes.length === 0) {
    ui.statusMetrics.removeAttribute('title');
    ui.statusMetrics.removeAttribute('aria-label');
    return;
  }
  ui.statusMetrics.title = accessibleLabel;
  ui.statusMetrics.setAttribute('aria-label', accessibleLabel);
}

function updateStatusMetrics() {
  if (!ui.statusMetrics) return;

  if (isEditMode && editorSession) {
    const editorState = editorSession.current();
    const { cursor, stats } = editorState;
    const zoom = getZoomStatusMetric(currentZoom * 100);
    const items = cursor
      ? [
          { kind: 'current-line', visible: `Ln ${cursor.line}` },
          ...(zoom ? [zoom] : []),
          { kind: 'column', visible: `Col ${cursor.column}` },
        ]
      : [
          { kind: 'blocks', visible: `${stats.blocks} ${stats.blocks === 1 ? 'block' : 'blocks'}` },
          { kind: 'words', visible: `${stats.words} ${stats.words === 1 ? 'word' : 'words'}` },
          ...(zoom ? [zoom] : []),
        ];
    const accessibleLabel = cursor
      ? `Line ${cursor.line}. Column ${cursor.column}. ${stats.blocks} blocks. ${stats.words} words. ${stats.characters} characters.${zoom ? ` ${zoom.accessible}.` : ''}`
      : `${stats.blocks} blocks. ${stats.words} words. ${stats.characters} characters.${zoom ? ` ${zoom.accessible}.` : ''}`;
    renderStatusMetricItems(items, accessibleLabel);
    return;
  }

  const isAvailable = Boolean(currentDocument && currentFilePath && !isHelpVisible);
  if (!isAvailable) {
    renderStatusMetricItems([], '');
    return;
  }

  const metrics = getStatusMetricParts({
    lineCount: currentDocument.lineCount,
    characterCount: currentDocument.characterCount,
    zoomPercent: currentZoom * 100,
    currentLine: readingNavigation?.snapshot().currentLine || 1,
    showCurrentLine: readingTools.lineGuide,
    readingProgress: readingNavigation?.snapshot().readingProgress || 0,
    readingTimeMinutes: currentDocument.readingTimeMinutes,
    showReadingStats: readingTools.stats,
  });

  renderStatusMetricItems(metrics.items, metrics.accessible.join('. '));
}

function hasLoadedDocument() {
  return Boolean(currentDocument && currentFilePath);
}

function isSourceViewActive() {
  return hasLoadedDocument() && readingTools.source && !isEditMode;
}

function reportPreferenceResult(result) {
  if (result?.status === 'volatile') {
    showToast('Preference applied for this session only');
  }
}

function handlePreferenceSnapshot(snapshot) {
  readingTools = { ...snapshot.readingTools };
  fontPreferences = { ...snapshot.fonts };
  isAlwaysOnTop = snapshot.alwaysOnTop;
  isAutoSaveEnabled = snapshot.autoSave;
  documentSaveCoordinator?.setAutoSaveEnabled(isAutoSaveEnabled, editorSession?.current());
  applyFontPreferences();
  updateAlwaysOnTopControl();
  updateAutoSaveControl();
  applyReadingTools();

  if (snapshot.themeName && themeCoordinator?.current()?.name !== snapshot.themeName) {
    themeCoordinator?.applyName(snapshot.themeName, { silent: true, persist: false });
  }
}

function updateFontControls() {
  for (const kind of Object.keys(FONT_PRESETS)) {
    const presets = FONT_PRESETS[kind];
    const index = normalizeFontIndex(fontPreferences[kind], presets.length);
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

function applyFontPreferences() {
  const root = document.documentElement;
  for (const kind of Object.keys(FONT_PRESETS)) {
    const presets = FONT_PRESETS[kind];
    const index = normalizeFontIndex(fontPreferences[kind], presets.length);
    fontPreferences[kind] = index;
    root.style.setProperty(`--font-${kind}`, presets[index].value);
  }

  updateFontControls();
  readingNavigation?.markDirty();
  responsiveTypography?.schedule();
}

async function cycleFont(kind) {
  const presets = FONT_PRESETS[kind];
  if (!presets) return;

  const nextIndex = normalizeFontIndex(fontPreferences[kind] + 1, presets.length);
  const result = await readerShell.preferences.update({ fonts: { [kind]: nextIndex } });
  reportPreferenceResult(result);
  const label = kind === 'sans' ? 'Sans' : 'Mono';
  showToast(`${label} font: ${FONT_PRESETS[kind][fontPreferences[kind]].name}`);
}

function setTypographyOpen(nextOpen, { returnFocus = false } = {}) {
  isTypographyOpen = Boolean(nextOpen && !isHelpVisible);
  if (isTypographyOpen) setReadingToolsOpen(false);
  document.body.classList.toggle('is-typography-open', isTypographyOpen);
  ui.typographyButton?.setAttribute('aria-expanded', String(isTypographyOpen));

  if (ui.typographyButton) {
    const label = isTypographyOpen ? 'Close appearance options' : 'Open appearance options';
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

function updateAutoSaveControl() {
  ui.autoSaveToggle?.setAttribute('aria-checked', String(isAutoSaveEnabled));
  if (ui.autoSaveToggle) {
    const label = `Auto-save: ${isAutoSaveEnabled ? 'on' : 'off'}`;
    ui.autoSaveToggle.setAttribute('aria-label', label);
    ui.autoSaveToggle.title = label;
  }
}

async function toggleAutoSave() {
  const result = await readerShell.preferences.update({ autoSave: !isAutoSaveEnabled });
  reportPreferenceResult(result);
  documentSaveCoordinator?.setAutoSaveEnabled(isAutoSaveEnabled, editorSession?.current());
  showToast(`Auto-save ${isAutoSaveEnabled ? 'on' : 'off'}`);
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

async function toggleAlwaysOnTop() {
  const nextValue = !isAlwaysOnTop;
  if (ui.alwaysOnTopButton) ui.alwaysOnTopButton.disabled = true;
  try {
    const result = await readerShell.preferences.update({ alwaysOnTop: nextValue });
    if (result.status === 'applied' || result.status === 'volatile') {
      reportPreferenceResult(result);
      showToast(`Always on top ${nextValue ? 'on' : 'off'}`);
    } else if (result.status === 'unavailable') {
      showToast('Always on top is available in the desktop app');
    } else {
      showToast('Could not change always on top');
    }
  } catch (error) {
    console.error('Could not change the always-on-top setting:', error);
    showToast('Could not change always on top');
  } finally {
    if (ui.alwaysOnTopButton) ui.alwaysOnTopButton.disabled = false;
  }
}

function setReadingToolsOpen(nextOpen, { returnFocus = false } = {}) {
  const canOpen = !isHelpVisible;
  isReadingToolsOpen = Boolean(nextOpen && canOpen);
  if (isReadingToolsOpen) setTypographyOpen(false);
  document.body.classList.toggle('is-reading-tools-open', isReadingToolsOpen);
  ui.readingToolsButton?.setAttribute('aria-expanded', String(isReadingToolsOpen));

  if (ui.readingToolsButton) {
    const label = isReadingToolsOpen ? 'Close view options' : 'Open view options';
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
  const hasActiveTool = available && ['lineGuide', 'minimap', 'stats', 'wordWrap']
    .some((tool) => readingTools[tool] !== DEFAULT_READING_TOOLS[tool]);

  if (ui.readingToolsButton) {
    ui.readingToolsButton.classList.toggle('is-active', hasActiveTool);
  }

  ui.readingToolToggles.forEach((toggle) => {
    const tool = toggle.dataset.readingTool;
    toggle.disabled = !available;
    toggle.setAttribute('aria-checked', String(Boolean(readingTools[tool])));
  });
}

function applyReadingTools() {
  const available = hasLoadedDocument();
  const sourceActive = available && readingTools.source && !isEditMode;
  const lineGuideActive = available && readingTools.lineGuide;
  const minimapActive = available && readingTools.minimap;

  document.body.classList.toggle('is-source-view', sourceActive);
  document.body.classList.toggle('is-line-guide', lineGuideActive);
  document.body.classList.toggle('is-minimap', minimapActive);
  document.body.classList.toggle('is-word-wrap', readingTools.wordWrap);
  documentModeCoordinator?.refresh();
  ui.content?.classList.toggle('hidden', sourceActive || isEditMode);
  ui.sourceView?.classList.toggle('hidden', !sourceActive);

  readingNavigation?.refreshTools();
  responsiveTypography?.schedule();
  updateReadingToolControls();
  updateStatus(currentFilePath);
}

async function setReadingTool(tool, nextValue) {
  if (!Object.hasOwn(DEFAULT_READING_TOOLS, tool) || !hasLoadedDocument()) return;

  const next = Boolean(nextValue);
  if (readingTools[tool] === next) return;

  if (tool === 'source' && ui.readerPage) {
    readingNavigation?.captureViewScroll(readingTools.source ? 'source' : 'read');
  }

  const result = await readerShell.preferences.update({ readingTools: { [tool]: next } });
  reportPreferenceResult(result);

  if (tool === 'source' && ui.readerPage) {
    requestAnimationFrame(() => {
      readingNavigation?.restoreViewScroll(next ? 'source' : 'read');
      (next ? ui.sourceView : ui.content)?.focus({ preventScroll: true });
    });
  }

  const labels = {
    lineGuide: 'Line guide',
    minimap: 'Minimap',
    source: 'Source view',
    stats: 'Reading stats',
    wordWrap: 'Word wrap',
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
    const helpLabel = mode === 'help' ? 'Close About and Help' : 'Open About and Help';
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

  if (nextVisible) {
    ui.helpStage?.scrollTo({ top: 0, behavior: 'auto' });
  }
  readingNavigation?.handleScroll();

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
    const savedThemeName = readerShell.preferences.current().themeName;
    themeCoordinator = createThemeCoordinator({
      window,
      document,
      themes: allThemes,
      elements: {
        select: document.getElementById('theme-select'),
        name: document.getElementById('theme-name'),
      },
      hooks: {
        shouldPrepareDiagrams: () => Boolean(currentFilePath && ui.content?.querySelector('.mermaid')),
        prepareDiagrams: (diagramTheme) => readerShell?.prepareAppearance({ diagramTheme }),
        persist: (themeName) => readerShell.preferences.update({ themeName }),
        onPersistResult: reportPreferenceResult,
        notify: showToast,
        beforeTransition: () => documentModeCoordinator?.cancelTransition(),
        onCommit: () => readingNavigation?.markDirty(),
        onError: (message, error) => console.error(`${message}:`, error),
      },
    });
    await themeCoordinator.start(savedThemeName);
  } catch (error) {
    console.error('Failed to initialize themes:', error);
    showToast('Could not load themes');
  }
}

function showToast(message) {
  toastPresenter ??= createToastPresenter({ window, document, element: ui.toast });
  toastPresenter.show(message);
}

function cycleTheme(direction = 1) {
  themeCoordinator?.cycle(direction);
}

function resetDocumentReadingState() {
  readingNavigation?.reset();
  isHelpVisible = false;
  focusBeforeHelp = null;
}

function handleDocumentSessionState(snapshot) {
  if (snapshot.state === 'loading') {
    if (editorSession?.current().path && editorSession.current().path !== snapshot.path) {
      editorSession.clearDocument();
    }
    currentFilePath = snapshot.path;
    currentDocument = null;
    documentSaveCoordinator?.replaceDocument({ path: snapshot.path, document: null });
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
    documentSaveCoordinator?.replaceDocument({ path: snapshot.path, document: snapshot.document });
    editorSession?.setDocument({
      path: snapshot.path,
      source: snapshot.document.source,
      markdown: getFileKind(snapshot.path) === 'Markdown',
    });
    updateWindowTitle(snapshot.path);
    updateWindowUrl(snapshot.path);
    applyReadingTools();
    return;
  }

  if (snapshot.state === 'failed') {
    currentFilePath = snapshot.path;
    currentDocument = null;
    documentSaveCoordinator?.replaceDocument({ path: snapshot.path, document: null });
    readingNavigation?.markDirty();
    updateWindowTitle(snapshot.path);
    updateWindowUrl(snapshot.path);
    applyReadingTools();
    setStatusText(getDisplayName(snapshot.path), 'Could not open');
    editorSession?.clearDocument();
    return;
  }

  currentFilePath = null;
  currentDocument = null;
  documentSaveCoordinator?.replaceDocument();
  editorSession?.clearDocument();
  resetDocumentReadingState();
  syncViewportState();
  applyReadingTools();
  updateWindowTitle();
  updateWindowUrl();
  readingNavigation?.handleScroll();
}

function activeDiagramTheme() {
  return themeCoordinator?.diagramTheme() || 'default';
}

async function highlightDocumentCode(container) {
  if (!container?.querySelector?.('pre code')) return false;
  if (!syntaxHighlighterPromise) {
    syntaxHighlighterPromise = import('./syntax-highlighter.js').catch((error) => {
      syntaxHighlighterPromise = null;
      throw error;
    });
  }
  const { highlightCodeBlocks } = await syntaxHighlighterPromise;
  return highlightCodeBlocks(container);
}

function invokeDocumentCommand(command, args) {
  if (!window.__TAURI_INTERNALS__) {
    return Promise.reject(new Error('Native file access is unavailable in this browser preview.'));
  }

  return invoke(command, args);
}

function getPreviewDocument(path) {
  if (!import.meta.env.DEV) return null;
  const previewDocuments = window.__OPENMD_PREVIEW_DOCUMENTS__;
  const value = previewDocuments && typeof previewDocuments === 'object'
    ? previewDocuments[path]
    : null;
  return value && typeof value.source === 'string' && typeof value.html === 'string'
    ? value
    : null;
}

function openDocumentAdapter(path) {
  const preview = getPreviewDocument(path);
  return preview ? Promise.resolve({ ...preview }) : invokeDocumentCommand('get_file_content', { path });
}

async function saveDocumentAdapter(path, source) {
  const preview = getPreviewDocument(path);
  if (!preview) return invokeDocumentCommand('save_file_content', { path, content: source });
  if (window.__OPENMD_PREVIEW_SAVE_FAILURE__) {
    throw new Error('Preview save failure');
  }
  const previewDelay = Number(window.__OPENMD_PREVIEW_SAVE_DELAY_MS__) || 0;
  if (previewDelay > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, Math.min(previewDelay, 3_000)));
  }
  const escaped = source
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const words = source.trim() ? source.trim().split(/\s+/u).length : 0;
  Object.assign(preview, {
    source,
    html: `<pre>${escaped}</pre>`,
    lineCount: source.split('\n').length,
    characterCount: [...source].length,
    wordCount: words,
    readingTimeMinutes: words === 0 ? 0 : Math.max(1, Math.ceil(words / 220)),
  });
  return { ...preview };
}

function mountApplicationReaderShell() {
  readerShell = mountReaderShell({
    window,
    adapters: {
      documents: {
        open: openDocumentAdapter,
        readImage: (documentPath, relativeSource) => invokeDocumentCommand('get_image_bytes', {
          documentPath,
          relativeSource,
        }),
      },
      diagrams: {
        prepare: prepareMermaidDiagrams,
        render: renderMermaidDiagrams,
      },
      syntax: {
        highlight: highlightDocumentCode,
      },
      windows: {
        openDocument: (path) => invoke('open_new_window', { path }),
        ...(window.__TAURI_INTERNALS__ ? {
          setAlwaysOnTop: (value) => getCurrentWindow().setAlwaysOnTop(value),
        } : {}),
      },
      storage: createOptionalWebPreferenceStore(window),
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
      onSettled: () => readingNavigation?.handleScroll(),
      onWarning: showToast,
      onToast: showToast,
      onPreferencesChange: handlePreferenceSnapshot,
      onDiagnostic: (message, error) => console.error(`${message}:`, error),
    },
  });
}

function handleEditorState(snapshot) {
  const nextEditMode = snapshot.mode === 'edit';
  const modeChanged = nextEditMode !== isEditMode;
  isEditMode = nextEditMode;
  document.body.classList.toggle('is-edit-mode', isEditMode);
  document.body.classList.toggle('has-unsaved-changes', snapshot.dirty);
  document.body.classList.toggle('is-editor-saving', snapshot.saveState === 'saving');
  document.body.classList.toggle('has-editor-save-error', snapshot.saveState === 'error');

  documentModeCoordinator?.refresh();

  if (ui.editorSaveButton) {
    ui.editorSaveButton.hidden = !isEditMode;
    ui.editorSaveButton.disabled = snapshot.saveState === 'saving' || !snapshot.dirty;
    ui.editorSaveButton.classList.toggle('is-error', snapshot.saveState === 'error');
    ui.editorSaveButton.dataset.state = snapshot.saveState === 'error'
      ? 'error'
      : snapshot.saveState === 'saving'
        ? 'saving'
        : snapshot.dirty
          ? 'unsaved'
          : 'saved';
    const icon = ui.editorSaveButton.querySelector('i');
    if (icon) {
      icon.className = snapshot.saveState === 'error'
        ? 'iconoir-warning-triangle'
        : snapshot.saveState === 'saving'
        ? 'iconoir-refresh'
        : snapshot.dirty
          ? 'iconoir-floppy-disk'
          : 'iconoir-check';
    }
  }
  if (ui.editorSaveLabel) {
    ui.editorSaveLabel.textContent = snapshot.saveState === 'saving'
      ? 'Saving…'
      : snapshot.saveState === 'error'
        ? 'Save failed'
        : snapshot.dirty
          ? 'Unsaved'
          : snapshot.saveState === 'recovered'
            ? 'Recovered'
            : 'Saved';
  }
  if (ui.editorSaveButton) {
    ui.editorSaveButton.title = snapshot.saveState === 'error'
      ? `Save failed: ${snapshot.error}. Activate to retry.`
      : snapshot.dirty
        ? 'Unsaved changes · Save now (Ctrl+S)'
        : 'Document saved';
    ui.editorSaveButton.setAttribute('aria-label', snapshot.saveState === 'saving'
      ? 'Saving document'
      : snapshot.saveState === 'error'
        ? `Retry saving document. Last error: ${snapshot.error}`
        : snapshot.dirty
          ? 'Save document'
          : 'Document saved');
  }

  documentSaveCoordinator?.observeEditor(snapshot);
  if (isEditMode) readingNavigation?.markDirty();
  responsiveTypography?.schedule();
  if (modeChanged) applyReadingTools();
  else updateStatus(currentFilePath);
}

function mountApplicationEditor() {
  editorSession = createEditorSession({
    window,
    elements: {
      root: ui.editorView,
      canvas: ui.editorCanvas,
      commandMenu: ui.editorCommandMenu,
      blockMenu: ui.editorBlockMenu,
      inlineToolbar: ui.editorInlineToolbar,
      caretEcho: ui.editorCaretEcho,
      linkPopover: ui.editorLinkPopover,
      linkInput: ui.editorLinkInput,
      linkApply: ui.editorLinkApply,
      contextLabel: ui.editorContextLabel,
      contextHint: ui.editorContextHint,
    },
    adapters: {
      save: saveDocumentAdapter,
    },
    hooks: {
      onStateChange: handleEditorState,
      onCursorChange: () => {
        updateStatusMetrics();
        if (readingTools.lineGuide) readingNavigation?.queueUpdate();
      },
      onSaved: async () => {
        await readerShell?.reload();
      },
      onHistoryRestore: (action) => showToast(action === 'redo' ? 'Redone' : 'Undone'),
      onDraftPreserved: (path) => showToast(`Unsaved draft kept for ${getDisplayName(path)}`),
      onUnavailable: showToast,
      onDiagnostic: (message, error) => console.error(`${message}:`, error),
    },
  });
  handleEditorState(editorSession.current());
}

function mountDocumentSaveCoordinator() {
  documentSaveCoordinator = createDocumentSaveCoordinator({
    window,
    adapters: {
      isEditing: () => Boolean(editorSession?.isEditing()),
      saveEditor: () => editorSession?.save(),
      saveDocument: saveDocumentAdapter,
    },
    hooks: {
      notify: showToast,
      onTaskCommitted: ({ path, document: savedDocument }) => {
        currentDocument = savedDocument;
        editorSession?.setDocument({
          path,
          source: savedDocument.source,
          markdown: getFileKind(path) === 'Markdown',
        });
        if (ui.sourceContent) ui.sourceContent.textContent = savedDocument.source;
        readingNavigation?.markDirty();
        responsiveTypography?.schedule();
        updateStatus(path);
      },
      onDiagnostic: (message, error) => console.error(`${message}:`, error),
    },
  });
  documentSaveCoordinator.setAutoSaveEnabled(isAutoSaveEnabled, editorSession.current());
}

function mountDocumentModeCoordinator() {
  documentModeCoordinator = createDocumentModeCoordinator({
    window,
    document,
    elements: {
      control: ui.editModeButton,
      label: ui.editModeLabel,
      readSurface: ui.content,
      sourceSurface: ui.sourceView,
      editSurface: ui.editorView,
      lineGutter: ui.lineGutter,
      minimap: ui.documentMinimap,
    },
    adapters: {
      getMode: () => isEditMode ? 'edit' : isSourceViewActive() ? 'source' : 'read',
      isAvailable: () => Boolean(editorSession && hasLoadedDocument()),
      enterEdit: () => editorSession?.enter(),
      exitEdit: () => editorSession?.exit(),
      setSource: (active) => setReadingTool('source', active),
    },
    hooks: {
      closeTransientUi: () => {
        setHelpVisible(false);
        setReadingToolsOpen(false);
        setTypographyOpen(false);
      },
      cancelCompetingTransition: () => themeCoordinator?.cancelTransition(),
    },
  });
  documentModeCoordinator.refresh();
}

function mountReadingNavigation() {
  readingNavigation = createReadingNavigationController({
    window,
    document,
    elements: {
      readerPage: ui.readerPage,
      helpStage: ui.helpStage,
      documentStage: ui.documentStage,
      readView: ui.content,
      sourceView: ui.sourceView,
      editView: ui.editorView,
      editorCanvas: ui.editorCanvas,
      lineGutter: ui.lineGutter,
      minimap: ui.documentMinimap,
      minimapDocument: ui.minimapDocument,
      minimapViewport: ui.minimapViewport,
      scrollToTop: ui.scrollToTop,
    },
    adapters: {
      getDocument: () => currentDocument,
      getFilePath: () => currentFilePath,
      getMode: () => isEditMode ? 'edit' : isSourceViewActive() ? 'source' : 'read',
      isHelpVisible: () => isHelpVisible,
      isLineGuideEnabled: () => readingTools.lineGuide,
      isMinimapEnabled: () => readingTools.minimap,
      getEditorCursorLine: () => editorSession?.current().cursor?.line,
    },
    hooks: {
      onMetricsChange: updateStatusMetrics,
    },
  });
  readingNavigation.start();
  readingNavigation.refreshTools();
}

function handleReadTaskToggle(event) {
  const checkbox = event.target instanceof Element
    ? event.target.closest('.markdown-body input[type="checkbox"][data-source-line]')
    : null;
  if (!checkbox || isEditMode || !currentDocument || !currentFilePath) return;

  const sourceLine = Number.parseInt(checkbox.dataset.sourceLine, 10);
  void documentSaveCoordinator?.toggleReadTask({
    checkbox,
    sourceLine,
    checked: checkbox.checked,
  });
}

function handleLinkClick(event) {
  const target = event.target instanceof Element ? event.target.closest('a') : null;
  const hrefAttribute = target?.getAttribute('href');

  if (!target || !hrefAttribute) return;

  if (isEditMode && target.closest('#editor-view')) {
    event.preventDefault();
    return;
  }

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
  readingNavigation?.markDirty();
  updateStatus(currentFilePath);
  showToast(`Zoom: ${Math.round(currentZoom * 100)}%`);
}

function handleZoom(event) {
  if (event.ctrlKey) {
    event.preventDefault();
    setZoom(calculateNewZoom(currentZoom, event.deltaY, ZOOM_STEP, MIN_ZOOM, MAX_ZOOM));
  }
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

  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'e') {
    event.preventDefault();
    documentModeCoordinator?.toggleEdit();
    return;
  }

  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 's' && isEditMode) {
    event.preventDefault();
    documentSaveCoordinator?.saveEditor();
    return;
  }

  if (event.key === 'Escape' && isTypographyOpen) {
    event.preventDefault();
    setTypographyOpen(false, { returnFocus: true });
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
  const index = Number.parseInt(event.target.value, 10);
  if (Number.isInteger(index)) themeCoordinator?.applyIndex(index);
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
  if (!window.__TAURI_INTERNALS__) return;

  const bufferedRequests = [];
  let replayingPendingRequests = true;
  try {
    fileOpenRequestUnlisten = await listen('open-file-request', (event) => {
      if (replayingPendingRequests) bufferedRequests.push(event.payload);
      else submitNativeOpenFileRequest(event.payload);
    });
    const pendingRequests = await invoke('list_pending_open_file_requests');
    const orderedRequests = orderNativeOpenRequests(pendingRequests, bufferedRequests);
    replayingPendingRequests = false;
    orderedRequests.forEach(submitNativeOpenFileRequest);
  } catch (error) {
    replayingPendingRequests = false;
    orderNativeOpenRequests(bufferedRequests).forEach(submitNativeOpenFileRequest);
    console.warn('Native file-open events are unavailable in this runtime:', error);
  }
}

async function openFilePicker() {
  if (editorSession && !editorSession.canChangeDocument()) return;
  setReadingToolsOpen(false);
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
        if (editorSession && !editorSession.canChangeDocument()) return;
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
  window.addEventListener('beforeunload', (event) => {
    if (editorSession?.isDirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
    if (typeof dragDropUnlisten === 'function') {
      dragDropUnlisten();
    }
    if (typeof fileOpenRequestUnlisten === 'function') {
      fileOpenRequestUnlisten();
    }
    readingNavigation?.dispose();
    documentModeCoordinator?.dispose();
    documentSaveCoordinator?.dispose();
    themeCoordinator?.dispose();
    toastPresenter?.dispose();
    responsiveTypography?.dispose();
    readerShell?.dispose();
    editorSession?.dispose();
    windowChrome?.dispose();
  });
  document.addEventListener('click', handleLinkClick);
  document.addEventListener('pointerdown', (event) => {
    if (isReadingToolsOpen && !ui.readingToolsShell?.contains(event.target)) {
      setReadingToolsOpen(false);
    }
    if (isTypographyOpen && !ui.typographyShell?.contains(event.target)) {
      setTypographyOpen(false);
    }
  });

  ui.emptyOpenButton?.addEventListener('click', openFilePicker);
  ui.toolbarOpenButton?.addEventListener('click', openFilePicker);
  ui.helpToggleButton?.addEventListener('click', toggleHelp);
  ui.closeHelpButton?.addEventListener('click', () => setHelpVisible(false));
  ui.content?.addEventListener('change', handleReadTaskToggle);
  ui.readingToolsButton?.addEventListener('click', toggleReadingTools);
  ui.typographyButton?.addEventListener('click', toggleTypography);
  ui.alwaysOnTopButton?.addEventListener('click', toggleAlwaysOnTop);
  ui.autoSaveToggle?.addEventListener('click', toggleAutoSave);
  ui.editModeButton?.addEventListener('click', () => documentModeCoordinator?.cycle());
  ui.editorSaveButton?.addEventListener('click', () => documentSaveCoordinator?.saveEditor());
  ui.readingToolToggles.forEach((toggle) => {
    toggle.addEventListener('click', handleReadingToolToggle);
  });
  ui.fontButtons.forEach((button) => {
    button.addEventListener('click', handleFontCycle);
  });
  document.getElementById('theme-select')?.addEventListener('change', handleThemeSelection);
}

async function init() {
  cacheElements();
  responsiveTypography = createResponsiveTypography({
    window,
    root: document,
    onDiagnostic: (message, error) => console.warn(`${message}:`, error),
  });
  mountApplicationReaderShell();
  mountApplicationEditor();
  mountDocumentSaveCoordinator();
  mountDocumentModeCoordinator();
  mountReadingNavigation();
  const preferenceResult = await readerShell.preferences.load();
  if (preferenceResult.status === 'fallback') {
    console.warn('One or more saved preferences could not be restored:', preferenceResult.warnings);
  }
  syncViewportState();
  registerEvents();
  await setupFileAssociationEvents();
  await setupWindowChrome();
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
