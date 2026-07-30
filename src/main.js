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
  getThemeTokens,
  getStatusMetricParts,
  getZoomStatusMetric,
} from './core/reader.js';
import { createDocumentSaveCoordinator } from './document-save-coordinator.js';
import { createEditorSession } from './editor-session.js';
import { orderNativeOpenRequests } from './open-intent-controller.js';
import { mountReaderShell } from './reader-shell.js';
import { createReaderControls } from './reader-controls.js';
import { createApplicationRuntimeAdapters } from './application-runtime-adapters.js';
import { createResponsiveTypography } from './responsive-typography.js';
import { createReadingNavigationController } from './reading-navigation-controller.js';
import { createDocumentModeCoordinator } from './document-mode-coordinator.js';
import { createToastPresenter } from './toast-presenter.js';
import { createThemeCoordinator } from './theme-coordinator.js';
import { createWindowChrome } from './window-chrome.js';
import { createContextMenuController } from './context-menu-controller.js';
import { createTooltipController } from './tooltip-controller.js';
import { createStatusPresenter } from './status-presenter.js';
import { createReaderViewportController } from './reader-viewport-controller.js';
import { createEditorFeedbackPresenter } from './editor-feedback-presenter.js';

let currentZoom = 1;
const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3.0;
let dragDropUnlisten = null;
let fileOpenRequestUnlisten = null;
let currentFilePath = null;
let currentDocument = null;
let windowChrome = null;
let readerShell = null;
let runtimeAdapters = null;
let editorSession = null;
let isEditMode = false;
let responsiveTypography = null;
let documentSaveCoordinator = null;
let documentModeCoordinator = null;
let readingNavigation = null;
let toastPresenter = null;
let themeCoordinator = null;
let contextMenuController = null;
let tooltipController = null;
let statusPresenter = null;
let readerControls = null;
let readerViewport = null;
let editorFeedback = null;

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
  const visibleTitle = isHelpVisible() ? 'About + Help' : filePath ? getDisplayName(filePath) : 'Ready';
  document.title = visibleTitle === 'Ready' ? 'open.md' : `open.md — ${visibleTitle}`;
  if (ui.windowFileTitle) {
    ui.windowFileTitle.textContent = visibleTitle;
    ui.windowFileTitle.dataset.tooltip = visibleTitle;
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
  statusPresenter?.setIdentity({ primary, context, title });
}

function isHelpVisible() {
  return readerViewport?.isHelpVisible() ?? false;
}

function updateStatus(filePath = null) {
  if (isHelpVisible()) {
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
    const viewLabel = currentDocument && readerControls?.current().readingTools.source ? 'Source' : getFileKind(filePath);
    setStatusText(getDisplayName(filePath), viewLabel);
    updateStatusMetrics();
    return;
  }

  setStatusText('open.md', 'Ready');
  updateStatusMetrics();
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
    statusPresenter?.renderMetrics(items, accessibleLabel);
    return;
  }

  const isAvailable = Boolean(currentDocument && currentFilePath && !isHelpVisible());
  if (!isAvailable) {
    statusPresenter?.renderMetrics([], '');
    return;
  }

  const metrics = getStatusMetricParts({
    lineCount: currentDocument.lineCount,
    characterCount: currentDocument.characterCount,
    zoomPercent: currentZoom * 100,
    currentLine: readingNavigation?.snapshot().currentLine || 1,
    showCurrentLine: readerControls?.current().readingTools.lineGuide,
    readingProgress: readingNavigation?.snapshot().readingProgress || 0,
    readingTimeMinutes: currentDocument.readingTimeMinutes,
    showReadingStats: readerControls?.current().readingTools.stats,
  });

  statusPresenter?.renderMetrics(metrics.items, metrics.accessible.join('. '));
}

function hasLoadedDocument() {
  return Boolean(currentDocument && currentFilePath);
}

function isSourceViewActive() {
  return hasLoadedDocument() && readerControls?.current().readingTools.source && !isEditMode;
}

function reportPreferenceResult(result) {
  if (result?.status === 'volatile') {
    showToast('Preference applied for this session only');
  }
}

function handlePreferenceSnapshot(snapshot) {
  readerControls?.applySnapshot(snapshot);
}

function setTypographyOpen(nextOpen, { returnFocus = false } = {}) {
  readerControls?.setTypographyOpen(nextOpen, { returnFocus });
}

function setReadingToolsOpen(nextOpen, { returnFocus = false } = {}) {
  readerControls?.setReadingToolsOpen(nextOpen, { returnFocus });
}

function applyReadingTools() {
  readerControls?.refresh();
  updateStatus(currentFilePath);
}

async function setReadingTool(tool, nextValue) {
  return readerControls?.setReadingTool(tool, nextValue);
}

function syncViewportState() {
  readerViewport?.sync({
    hasFilePath: Boolean(currentFilePath),
    sourceActive: isSourceViewActive(),
  });
}

function setHelpVisible(nextVisible, { manageFocus = true } = {}) {
  readerViewport?.setHelpVisible(nextVisible, { manageFocus });
}

function toggleHelp() {
  readerViewport?.toggleHelp();
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
        prepareDiagrams: (diagramTheme, diagramTokens) => readerShell?.prepareAppearance({
          diagramTheme,
          diagramTokens,
        }),
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
  readerViewport?.reset();
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

function activeDiagramTokens() {
  const theme = themeCoordinator?.current();
  return theme ? getThemeTokens(theme) : null;
}

function mountApplicationReaderShell() {
  runtimeAdapters = createApplicationRuntimeAdapters({ window });
  readerShell = mountReaderShell({
    window,
    adapters: runtimeAdapters,
    hooks: {
      getDiagramTheme: activeDiagramTheme,
      getDiagramTokens: activeDiagramTokens,
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

function mountReaderViewport() {
  readerViewport = createReaderViewportController({
    window,
    document,
    elements: {
      viewport: ui.viewport,
      readerPage: ui.readerPage,
      content: ui.content,
      sourceView: ui.sourceView,
      helpStage: ui.helpStage,
      helpTitle: ui.helpTitle,
      documentStage: ui.documentStage,
      emptyStage: ui.emptyStage,
      helpToggleButton: ui.helpToggleButton,
    },
    hooks: {
      closeTransientUi: () => readerControls?.closeTransient(),
      onHelpChanged: () => {
        updateStatus(currentFilePath);
        updateWindowTitle(currentFilePath);
        readingNavigation?.handleScroll();
      },
    },
  });
  readerViewport.sync({
    hasFilePath: Boolean(currentFilePath),
    sourceActive: isSourceViewActive(),
  });
}

function mountReaderControls() {
  readerControls = createReaderControls({
    window,
    document,
    elements: {
      readingToolsButton: ui.readingToolsButton,
      readingToolsShell: ui.readingToolsShell,
      readingToolsPanel: ui.readingToolsPanel,
      typographyButton: ui.typographyButton,
      typographyShell: ui.typographyShell,
      typographyPanel: ui.typographyPanel,
      alwaysOnTopButton: ui.alwaysOnTopButton,
      autoSaveToggle: ui.autoSaveToggle,
      fontButtons: ui.fontButtons,
      readingToolToggles: ui.readingToolToggles,
      content: ui.content,
      sourceView: ui.sourceView,
    },
    adapters: {
      preferences: readerShell.preferences,
      isDocumentAvailable: hasLoadedDocument,
      isEditMode: () => isEditMode,
    },
    hooks: {
      isHelpVisible,
      captureViewScroll: (mode) => readingNavigation?.captureViewScroll(mode),
      restoreViewScroll: (mode) => readingNavigation?.restoreViewScroll(mode),
      onReadingToolsApplied: ({ sourceActive }) => {
        readerViewport?.sync({
          hasFilePath: Boolean(currentFilePath),
          sourceActive,
        });
        documentModeCoordinator?.refresh();
        readingNavigation?.refreshTools();
        responsiveTypography?.schedule();
        updateStatus(currentFilePath);
      },
      onFontsApplied: () => {
        readingNavigation?.markDirty();
        responsiveTypography?.schedule();
      },
      onAutoSaveApplied: (enabled) => {
        documentSaveCoordinator?.setAutoSaveEnabled(enabled, editorSession?.current());
      },
      onThemeName: (themeName) => {
        if (themeName && themeCoordinator?.current()?.name !== themeName) {
          themeCoordinator?.applyName(themeName, { silent: true, persist: false });
        }
      },
      onPreferenceResult: reportPreferenceResult,
      onToast: showToast,
      onDiagnostic: (message, error) => console.error(`${message}:`, error),
    },
  });
  readerControls.start();
}

function handleEditorState(snapshot) {
  const nextEditMode = snapshot.mode === 'edit';
  const feedback = editorFeedback?.render(snapshot) || {
    isEditMode: nextEditMode,
    modeChanged: nextEditMode !== isEditMode,
  };
  const modeChanged = feedback.modeChanged;
  if (modeChanged) contextMenuController?.close({ immediate: true });
  isEditMode = feedback.isEditMode;

  documentModeCoordinator?.refresh();

  documentSaveCoordinator?.observeEditor(snapshot);
  if (isEditMode) readingNavigation?.markDirty();
  responsiveTypography?.schedule();
  if (modeChanged) applyReadingTools();
  else updateStatus(currentFilePath);
}

function mountApplicationEditor() {
  editorFeedback = createEditorFeedbackPresenter({
    window,
    document,
    elements: {
      editorSaveButton: ui.editorSaveButton,
      editorSaveLabel: ui.editorSaveLabel,
    },
  });
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
      save: (path, source) => runtimeAdapters.documents.save(path, source),
    },
    hooks: {
      onStateChange: handleEditorState,
      onCursorChange: () => {
        updateStatusMetrics();
        if (readerControls?.current().readingTools.lineGuide) readingNavigation?.queueUpdate();
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
      saveDocument: (path, source) => runtimeAdapters.documents.save(path, source),
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
  documentSaveCoordinator.setAutoSaveEnabled(readerControls?.current().autoSave !== false, editorSession.current());
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
      isHelpVisible,
      isLineGuideEnabled: () => readerControls?.current().readingTools.lineGuide,
      isMinimapEnabled: () => readerControls?.current().readingTools.minimap,
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

function selectedTextWithin(root) {
  const selection = window.getSelection();
  if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) return '';
  const range = selection.getRangeAt(0);
  return root.contains(range.commonAncestorContainer) ? selection.toString() : '';
}

function selectContents(element) {
  if (!element) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  element.focus?.({ preventScroll: true });
}

async function writeClipboardText(value, successMessage) {
  const text = String(value ?? '');
  try {
    if (typeof navigator.clipboard?.writeText === 'function') {
      await navigator.clipboard.writeText(text);
    } else {
      const active = document.activeElement;
      const selection = window.getSelection();
      const ranges = selection
        ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange())
        : [];
      const helper = document.createElement('textarea');
      helper.className = 'clipboard-helper';
      helper.value = text;
      helper.setAttribute('aria-hidden', 'true');
      document.body.append(helper);
      helper.select();
      const copied = document.execCommand?.('copy');
      helper.remove();
      selection?.removeAllRanges();
      ranges.forEach((range) => selection?.addRange(range));
      active?.focus?.({ preventScroll: true });
      if (!copied) throw new Error('Clipboard access is unavailable');
    }
    showToast(successMessage);
    return true;
  } catch (error) {
    console.error('Could not write to the clipboard:', error);
    showToast('Could not copy to the clipboard');
    return false;
  }
}

async function pasteClipboardText() {
  try {
    if (typeof navigator.clipboard?.readText !== 'function') {
      throw new Error('Clipboard reading is unavailable');
    }
    const text = await navigator.clipboard.readText();
    if (!document.execCommand?.('insertText', false, text)) {
      throw new Error('The active editor did not accept pasted text');
    }
    showToast('Pasted');
  } catch (error) {
    console.error('Could not paste from the clipboard:', error);
    showToast('Could not paste from the clipboard');
  }
}

function editContextItems(target) {
  const context = editorSession?.contextFor(target);
  if (!context) return null;
  const wrapper = target.closest('[data-block-id]');
  const blockText = wrapper?.querySelector('[data-editor-content]')?.innerText || '';
  const items = [];

  if (context.hasSelection) {
    items.push(
      {
        id: 'copy-selection',
        label: 'Copy selection',
        icon: 'iconoir-copy',
        shortcut: 'Ctrl+C',
        onSelect: () => writeClipboardText(context.selectionText, 'Selection copied'),
      },
      {
        id: 'cut-selection',
        label: 'Cut selection',
        icon: 'iconoir-edit-pencil',
        shortcut: 'Ctrl+X',
        onSelect: () => {
          if (!document.execCommand?.('cut')) showToast('Could not cut the selection');
        },
      },
      { type: 'separator' },
      { id: 'bold', label: 'Bold', icon: 'iconoir-bold', onSelect: () => editorSession.applyInlineCommand('bold') },
      { id: 'italic', label: 'Italic', icon: 'iconoir-italic', onSelect: () => editorSession.applyInlineCommand('italic') },
      { id: 'strike', label: 'Strikethrough', icon: 'iconoir-text', onSelect: () => editorSession.applyInlineCommand('strike') },
      { id: 'inline-code', label: 'Inline code', icon: 'iconoir-code', onSelect: () => editorSession.applyInlineCommand('code') },
      { id: 'link', label: 'Add link', icon: 'iconoir-link', shortcut: 'Ctrl+K', onSelect: () => editorSession.openLinkFromSelection() },
    );
  } else {
    items.push({
      id: 'copy-block',
      label: 'Copy block',
      icon: 'iconoir-copy',
      onSelect: () => writeClipboardText(blockText, 'Block copied'),
    });
  }

  items.push(
    {
      id: 'paste',
      label: 'Paste text',
      icon: 'iconoir-page-down',
      shortcut: 'Ctrl+V',
      onSelect: pasteClipboardText,
    },
    { type: 'separator' },
    {
      id: 'move-up',
      label: 'Move block up',
      icon: 'iconoir-arrow-up',
      shortcut: 'Alt+Shift+↑',
      disabled: !context.canMoveUp,
      onSelect: () => editorSession.performBlockAction(context.blockId, 'move-up'),
    },
    {
      id: 'move-down',
      label: 'Move block down',
      icon: 'iconoir-arrow-down',
      shortcut: 'Alt+Shift+↓',
      disabled: !context.canMoveDown,
      onSelect: () => editorSession.performBlockAction(context.blockId, 'move-down'),
    },
    {
      id: 'duplicate',
      label: 'Duplicate block',
      icon: 'iconoir-copy',
      onSelect: () => editorSession.performBlockAction(context.blockId, 'duplicate'),
    },
    {
      id: 'delete',
      label: 'Delete block',
      icon: 'iconoir-trash',
      danger: true,
      disabled: !context.canDelete,
      onSelect: () => editorSession.performBlockAction(context.blockId, 'delete'),
    },
  );

  return {
    label: `${context.blockType} block actions`,
    context,
    items,
  };
}

function readContextItems(target) {
  if (!ui.content?.contains(target)) return null;
  const selectedText = selectedTextWithin(ui.content);
  const link = target.closest('a[href]');
  const code = target.closest('pre')?.querySelector('code');
  const checkbox = target.closest('input[type="checkbox"][data-source-line]');
  const image = target.closest('img');
  const diagram = target.closest('.mermaid[data-mermaid-source]');
  const table = target.closest('table');
  const items = [];

  if (selectedText) {
    items.push({
      id: 'copy-selection',
      label: 'Copy selection',
      icon: 'iconoir-copy',
      shortcut: 'Ctrl+C',
      onSelect: () => writeClipboardText(selectedText, 'Selection copied'),
    });
  }
  if (link) {
    if (items.length) items.push({ type: 'separator' });
    items.push(
      { id: 'open-link', label: 'Open link', icon: 'iconoir-link', onSelect: () => link.click() },
      { id: 'copy-link', label: 'Copy link', icon: 'iconoir-copy', onSelect: () => writeClipboardText(link.href, 'Link copied') },
    );
  } else if (code) {
    if (items.length) items.push({ type: 'separator' });
    items.push({ id: 'copy-code', label: 'Copy code', icon: 'iconoir-code', onSelect: () => writeClipboardText(code.innerText, 'Code copied') });
  } else if (checkbox) {
    if (items.length) items.push({ type: 'separator' });
    items.push({
      id: 'toggle-task',
      label: checkbox.checked ? 'Mark task incomplete' : 'Mark task complete',
      icon: 'iconoir-check-square',
      onSelect: () => checkbox.click(),
    });
  } else if (diagram) {
    if (items.length) items.push({ type: 'separator' });
    items.push(
      {
        id: 'copy-diagram-source',
        label: 'Copy diagram source',
        icon: 'iconoir-code',
        onSelect: () => writeClipboardText(diagram.dataset.mermaidSource, 'Diagram source copied'),
      },
      {
        id: 'copy-diagram-svg',
        label: 'Copy diagram SVG',
        icon: 'iconoir-copy',
        onSelect: () => writeClipboardText(diagram.querySelector('svg')?.outerHTML || '', 'Diagram SVG copied'),
      },
    );
  } else if (table) {
    if (items.length) items.push({ type: 'separator' });
    items.push({
      id: 'copy-table',
      label: 'Copy table',
      icon: 'iconoir-copy',
      onSelect: () => writeClipboardText(table.innerText, 'Table copied'),
    });
  } else if (image) {
    const source = image.dataset.documentSource || image.getAttribute('src');
    if (items.length) items.push({ type: 'separator' });
    if (source) items.push({ id: 'copy-image-source', label: 'Copy image source', icon: 'iconoir-copy', onSelect: () => writeClipboardText(source, 'Image source copied') });
    if (image.alt) items.push({ id: 'copy-image-description', label: 'Copy image description', icon: 'iconoir-text', onSelect: () => writeClipboardText(image.alt, 'Image description copied') });
  }

  if (items.length) items.push({ type: 'separator' });
  items.push(
    { id: 'copy-document', label: 'Copy document', icon: 'iconoir-copy', onSelect: () => writeClipboardText(ui.content.innerText, 'Document copied') },
    { id: 'select-document', label: 'Select all', icon: 'iconoir-page', shortcut: 'Ctrl+A', onSelect: () => selectContents(ui.content) },
  );
  return { label: 'Reading actions', items };
}

function sourceContextItems(target) {
  if (!ui.sourceView?.contains(target)) return null;
  const selectedText = selectedTextWithin(ui.sourceView);
  return {
    label: 'Source actions',
    items: [
      ...(selectedText ? [{ id: 'copy-selection', label: 'Copy selection', icon: 'iconoir-copy', shortcut: 'Ctrl+C', onSelect: () => writeClipboardText(selectedText, 'Selection copied') }, { type: 'separator' }] : []),
      { id: 'copy-source', label: 'Copy source', icon: 'iconoir-code', onSelect: () => writeClipboardText(currentDocument?.source || ui.sourceContent?.textContent || '', 'Source copied') },
      { id: 'select-source', label: 'Select all', icon: 'iconoir-page', shortcut: 'Ctrl+A', onSelect: () => selectContents(ui.sourceContent) },
    ],
  };
}

function resolveDocumentContextMenu({ target }) {
  if (!(target instanceof Element) || isHelpVisible() || !hasLoadedDocument()) return null;
  if (isEditMode) return editContextItems(target);
  if (isSourceViewActive()) return sourceContextItems(target);
  return readContextItems(target);
}

function mountContextMenu() {
  contextMenuController = createContextMenuController({
    window,
    document,
    resolveContext: resolveDocumentContextMenu,
    hooks: {
      onDiagnostic: (message, error) => console.error(`${message}:`, error),
    },
  });
  contextMenuController.start();
}

function mountTooltips() {
  tooltipController = createTooltipController({
    window,
    document,
    hooks: {
      onDiagnostic: (message, error) => console.error(`${message}:`, error),
    },
  });
  tooltipController.start();
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

function handleKeyboard(event) {
  if (event.key === 'F1') {
    event.preventDefault();
    toggleHelp();
    return;
  }

  if (event.key === 'Escape' && isHelpVisible()) {
    event.preventDefault();
    setHelpVisible(false);
    return;
  }

  if (event.key === 'Escape' && readerControls?.isReadingToolsOpen()) {
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

  if (event.key === 'Escape' && readerControls?.isTypographyOpen()) {
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
    contextMenuController?.dispose();
    tooltipController?.dispose();
    statusPresenter?.dispose();
    readerControls?.dispose();
    readerViewport?.dispose();
    editorFeedback?.dispose();
    responsiveTypography?.dispose();
    readerShell?.dispose();
    editorSession?.dispose();
    windowChrome?.dispose();
  });
  document.addEventListener('click', handleLinkClick);

  ui.emptyOpenButton?.addEventListener('click', openFilePicker);
  ui.toolbarOpenButton?.addEventListener('click', openFilePicker);
  ui.helpToggleButton?.addEventListener('click', toggleHelp);
  ui.closeHelpButton?.addEventListener('click', () => setHelpVisible(false));
  ui.content?.addEventListener('change', handleReadTaskToggle);
  ui.editModeButton?.addEventListener('click', () => documentModeCoordinator?.cycle());
  ui.editorSaveButton?.addEventListener('click', () => documentSaveCoordinator?.saveEditor());
  document.getElementById('theme-select')?.addEventListener('change', handleThemeSelection);
}

async function init() {
  cacheElements();
  statusPresenter = createStatusPresenter({
    window,
    document,
    elements: {
      primary: ui.statusPrimary,
      context: ui.statusContext,
      metrics: ui.statusMetrics,
    },
  });
  mountTooltips();
  responsiveTypography = createResponsiveTypography({
    window,
    root: document,
    onDiagnostic: (message, error) => console.warn(`${message}:`, error),
  });
  mountApplicationReaderShell();
  mountReaderViewport();
  mountReaderControls();
  mountApplicationEditor();
  mountDocumentSaveCoordinator();
  mountDocumentModeCoordinator();
  mountReadingNavigation();
  mountContextMenu();
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
