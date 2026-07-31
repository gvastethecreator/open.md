import allThemes from './themes.runtime.json';
import {
  getDisplayName,
  getLinkAction,
  getThemeTokens,
} from './core/reader.js';
import {
  allowsDocumentMode,
  getFormatLabel,
  resolveFormatId,
} from './format-registry.js';
import { createDocumentSaveCoordinator } from './document-save-coordinator.js';
import { createEditorSession } from './editor-session.js';
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
import { createDocumentContentActions } from './document-content-actions.js';
import { createDocumentViewStateController } from './document-view-state.js';
import { createDocumentIngressController } from './document-ingress-controller.js';
import { createReaderKeyboardController } from './reader-keyboard-controller.js';
import { createApplicationLifecycleController } from './application-lifecycle.js';
import { createReaderZoomController } from './reader-zoom-controller.js';

let windowChrome = null;
let readerZoom = null;
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
let documentContentActions = null;
let documentViewState = null;
let documentIngress = null;
let readerKeyboard = null;
let applicationLifecycle = null;

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
  themeField: null,
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
  ui.basicOptionsPanel = document.getElementById('basic-options-panel');
  ui.advancedOptionsPanel = document.getElementById('advanced-options-panel');
  ui.advancedOptionsButton = document.getElementById('advanced-options-button');
  ui.advancedBackButton = document.getElementById('advanced-back-button');
  ui.readingToolsHeaderLabel = document.getElementById('reading-tools-header-label');
  ui.advancedToggles = [...document.querySelectorAll('[data-advanced-pref]')];
  ui.imageDefaultZoomSelect = document.getElementById('image-default-zoom');
  ui.csvRowCapInput = document.getElementById('csv-row-cap');
  ui.formatDetectionStatus = document.getElementById('format-detection-status');
  ui.typographyShell = document.getElementById('typography-shell');
  ui.typographyButton = document.getElementById('typography-button');
  ui.typographyPanel = document.getElementById('typography-panel');
  ui.themeField = document.querySelector('.appearance-theme-field') || document.querySelector('.theme-field');
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
  ui.editorBlockToolbar = document.getElementById('editor-block-toolbar');
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

async function setupWindowChrome(own) {
  const nativeWindow = runtimeAdapters?.windows?.getNativeWindow?.();
  if (!nativeWindow) return;
  windowChrome = own(createWindowChrome({
    document,
    elements: {
      minimize: ui.windowMinimizeButton,
      maximize: ui.windowMaximizeButton,
      close: ui.windowCloseButton,
    },
    nativeWindow,
    onError: (message, error) => {
      console.error(message, error);
      showToast(message);
    },
  }));
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

function getCurrentFilePath() {
  return documentViewState?.current().path || null;
}

function getCurrentDocument() {
  return documentViewState?.current().document || null;
}

function currentFormatId() {
  return resolveFormatId(getCurrentFilePath(), getCurrentDocument());
}

function documentAllowsMode(mode) {
  const path = getCurrentFilePath();
  const documentSnapshot = getCurrentDocument();
  if (!path || !documentSnapshot) return false;
  return allowsDocumentMode(currentFormatId(), mode, { kind: documentSnapshot.kind, path });
}

function updateStatus(filePath = null) {
  if (isHelpVisible()) {
    setStatusText('About + Help', 'F1 to close');
    updateStatusMetrics();
    return;
  }

  if (filePath) {
    if (isEditMode) {
      setStatusText(getDisplayName(filePath), 'Editing');
      updateStatusMetrics();
      return;
    }
    const formatLabel = getFormatLabel(currentFormatId(), {
      kind: getCurrentDocument()?.kind,
      path: filePath,
    });
    const viewLabel = getCurrentDocument() && readerControls?.current().readingTools.source
      ? 'Source'
      : formatLabel;
    setStatusText(getDisplayName(filePath), viewLabel);
    updateStatusMetrics();
    return;
  }

  setStatusText('open.md', 'Ready');
  updateStatusMetrics();
}

function updateStatusMetrics() {
  if (!ui.statusMetrics || !statusPresenter) return;

  if (isEditMode && editorSession) {
    const editorState = editorSession.current();
    statusPresenter.renderEditorMetrics({
      cursor: editorState.cursor,
      stats: editorState.stats,
      zoomPercent: readerZoom?.percent?.() ?? 100,
    });
    return;
  }

  const isAvailable = Boolean(getCurrentDocument() && getCurrentFilePath() && !isHelpVisible());
  if (!isAvailable) {
    statusPresenter.renderMetrics([], '');
    return;
  }

  statusPresenter.renderDocumentMetrics({
    lineCount: getCurrentDocument().lineCount,
    characterCount: getCurrentDocument().characterCount,
    zoomPercent: readerZoom?.percent?.() ?? 100,
    currentLine: readingNavigation?.snapshot().currentLine || 1,
    showCurrentLine: readerControls?.current().readingTools.lineGuide,
    readingProgress: readingNavigation?.snapshot().readingProgress || 0,
    readingTimeMinutes: getCurrentDocument().readingTimeMinutes,
    showReadingStats: readerControls?.current().readingTools.stats,
  });
}

function hasLoadedDocument() {
  return Boolean(getCurrentDocument() && getCurrentFilePath());
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
  updateStatus(getCurrentFilePath());
}

async function setReadingTool(tool, nextValue) {
  return readerControls?.setReadingTool(tool, nextValue);
}

function syncViewportState() {
  readerViewport?.sync({
    hasFilePath: Boolean(getCurrentFilePath()),
    sourceActive: isSourceViewActive(),
  });
}

function setHelpVisible(nextVisible, { manageFocus = true } = {}) {
  readerViewport?.setHelpVisible(nextVisible, { manageFocus });
}

function toggleHelp() {
  readerViewport?.toggleHelp();
}

async function initThemes(own) {
  try {
    const savedThemeName = readerShell.preferences.current().themeName;
    themeCoordinator = own(createThemeCoordinator({
      window,
      document,
      themes: allThemes,
      elements: {
        select: document.getElementById('theme-select'),
        name: document.getElementById('theme-name'),
      },
      hooks: {
        shouldPrepareDiagrams: () => Boolean(getCurrentFilePath() && ui.content?.querySelector('.mermaid')),
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
    }));
    await themeCoordinator.start(savedThemeName);
  } catch (error) {
    themeCoordinator = null;
    console.error('Failed to initialize themes:', error);
    showToast('Could not load themes');
  }
}

function showToast(message) {
  toastPresenter?.show(message);
}

function cycleTheme(direction = 1) {
  themeCoordinator?.cycle(direction);
}

function closeCurrentFile() {
  const path = getCurrentFilePath();
  const viewState = documentViewState?.current?.();
  const hasDocument = Boolean(path)
    || viewState?.state === 'loading'
    || viewState?.state === 'failed'
    || viewState?.state === 'ready';
  if (!hasDocument) return;
  // Same dirty gate as open/replace: confirm discard, then clear the shell.
  if (editorSession && editorSession.canChangeDocument() === false) return;
  readerShell?.close();
}

function resetDocumentReadingState() {
  readingNavigation?.reset();
  readerViewport?.reset();
}

function handleDocumentSessionState(snapshot) {
  documentViewState?.handle(snapshot);
}

function commitDocumentViewState(value) {
  documentViewState?.commitDocument(value);
}

function mountDocumentViewState(own) {
  documentViewState = own(createDocumentViewStateController({
    window,
    adapters: {
      getEditorSession: () => editorSession,
    },
    hooks: {
      replaceDocument: (value) => value
        ? documentSaveCoordinator?.replaceDocument(value)
        : documentSaveCoordinator?.replaceDocument(),
      resetReadingState: resetDocumentReadingState,
      closeReadingTools: () => setReadingToolsOpen(false),
      syncViewport: syncViewportState,
      applyReadingTools,
      applyFormatPreferences: (format) => {
        if (!format || format === 'markdown' || format === 'image' || ['png', 'jpeg', 'gif', 'webp', 'bmp', 'avif'].includes(format)) {
          return;
        }
        const advanced = readerShell?.preferences?.current?.()?.advanced;
        if (!advanced || !readerControls) return;
        // Soft defaults for text companions only when tools still match global defaults.
        const tools = readerControls.current().readingTools;
        const patch = {};
        if (tools.wordWrap === true && advanced.textWordWrapDefault === false) patch.wordWrap = false;
        if (tools.minimap === false && advanced.textMinimapDefault) patch.minimap = true;
        if (tools.lineGuide === false && advanced.textLineGuideDefault) patch.lineGuide = true;
        if (Object.keys(patch).length === 0) return;
        void readerShell.preferences.update({ readingTools: patch });
      },
      setStatus: setStatusText,
      updateTitle: updateWindowTitle,
      updateUrl: updateWindowUrl,
      markNavigationDirty: () => readingNavigation?.markDirty(),
      handleNavigationScroll: () => readingNavigation?.handleScroll(),
      onSavedDocument: ({ path, document: savedDocument }) => {
        if (ui.sourceContent) ui.sourceContent.textContent = savedDocument.source;
        readingNavigation?.markDirty();
        responsiveTypography?.schedule();
        updateStatus(path);
      },
    },
  }));
}

function activeDiagramTheme() {
  return themeCoordinator?.diagramTheme() || 'default';
}

function activeDiagramTokens() {
  const theme = themeCoordinator?.current();
  return theme ? getThemeTokens(theme) : null;
}

function mountApplicationReaderShell(own) {
  runtimeAdapters = createApplicationRuntimeAdapters({ window });
  readerShell = own(mountReaderShell({
    window,
    adapters: runtimeAdapters,
    hooks: {
      getDiagramTheme: activeDiagramTheme,
      getDiagramTokens: activeDiagramTokens,
      isSourceActive: isSourceViewActive,
      chooseAnotherFile: openFilePicker,
      onDocumentCommitted: commitDocumentViewState,
      onStateChange: handleDocumentSessionState,
      onSettled: () => readingNavigation?.handleScroll(),
      onWarning: showToast,
      onToast: showToast,
      onPreferencesChange: handlePreferenceSnapshot,
      getPreferences: () => readerShell?.preferences?.current?.(),
      onDiagnostic: (message, error) => console.error(`${message}:`, error),
    },
  }));
}

function mountReaderViewport(own) {
  readerViewport = own(createReaderViewportController({
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
        updateStatus(getCurrentFilePath());
        updateWindowTitle(getCurrentFilePath());
        readingNavigation?.handleScroll();
      },
    },
  }));
  readerViewport.sync({
    hasFilePath: Boolean(getCurrentFilePath()),
    sourceActive: isSourceViewActive(),
  });
}

function mountReaderControls(own) {
  readerControls = own(createReaderControls({
    window,
    document,
    elements: {
      readingToolsButton: ui.readingToolsButton,
      readingToolsShell: ui.readingToolsShell,
      readingToolsPanel: ui.readingToolsPanel,
      basicOptionsPanel: ui.basicOptionsPanel,
      advancedOptionsPanel: ui.advancedOptionsPanel,
      advancedOptionsButton: ui.advancedOptionsButton,
      advancedBackButton: ui.advancedBackButton,
      readingToolsHeaderLabel: ui.readingToolsHeaderLabel,
      advancedToggles: ui.advancedToggles,
      imageDefaultZoomSelect: ui.imageDefaultZoomSelect,
      csvRowCapInput: ui.csvRowCapInput,
      formatDetectionStatus: ui.formatDetectionStatus,
      typographyButton: ui.typographyButton,
      typographyShell: ui.typographyShell,
      typographyPanel: ui.typographyPanel,
      themeField: ui.themeField,
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
      getDocumentIdentity: getCurrentDocument,
    },
    hooks: {
      isHelpVisible,
      getDocumentFormat: () => getCurrentDocument()?.format || null,
      captureScrollPosition: () => readingNavigation?.captureScrollPosition(),
      restoreScrollPosition: (position) => readingNavigation?.restoreScrollPosition(position),
      onReadingToolsApplied: ({ sourceActive }) => {
        readerViewport?.sync({
          hasFilePath: Boolean(getCurrentFilePath()),
          sourceActive,
        });
        documentModeCoordinator?.refresh();
        readingNavigation?.refreshTools();
        responsiveTypography?.schedule();
        updateStatus(getCurrentFilePath());
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
      cycleTheme,
      onPreferenceResult: reportPreferenceResult,
      onToast: showToast,
      onDiagnostic: (message, error) => console.error(`${message}:`, error),
    },
  }));
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
  else updateStatus(getCurrentFilePath());
}

function mountApplicationEditor(own) {
  editorFeedback = own(createEditorFeedbackPresenter({
    window,
    document,
    elements: {
      editorSaveButton: ui.editorSaveButton,
      editorSaveLabel: ui.editorSaveLabel,
    },
  }));
  editorSession = own(createEditorSession({
    window,
    elements: {
      root: ui.editorView,
      canvas: ui.editorCanvas,
      commandMenu: ui.editorCommandMenu,
      blockMenu: ui.editorBlockMenu,
      blockToolbar: ui.editorBlockToolbar,
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
  }));
  handleEditorState(editorSession.current());
}

function mountDocumentSaveCoordinator(own) {
  documentSaveCoordinator = own(createDocumentSaveCoordinator({
    window,
    adapters: {
      isEditing: () => Boolean(editorSession?.isEditing()),
      saveEditor: () => editorSession?.save(),
      saveDocument: (path, source) => runtimeAdapters.documents.save(path, source),
    },
    hooks: {
      notify: showToast,
      onTaskCommitted: ({ path, document: savedDocument }) => {
        documentViewState?.applySavedDocument({ path, document: savedDocument });
      },
      onDiagnostic: (message, error) => console.error(`${message}:`, error),
    },
  }));
  documentSaveCoordinator.setAutoSaveEnabled(readerControls?.current().autoSave !== false, editorSession.current());
}

function mountDocumentModeCoordinator(own) {
  documentModeCoordinator = own(createDocumentModeCoordinator({
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
      isAvailable: () => Boolean(editorSession && hasLoadedDocument() && documentAllowsMode('edit')),
      getDocumentIdentity: getCurrentDocument,
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
      captureScrollPosition: () => readingNavigation?.captureScrollPosition(),
      restoreScrollPosition: (position, options) => (
        readingNavigation?.restoreScrollPosition(position, options)
      ),
      prepareNavigationMorph: () => readingNavigation?.prepareModeMorph(),
      animateNavigationMorph: () => readingNavigation?.animateModeMorph(),
      finishNavigationMorph: () => readingNavigation?.finishModeMorph(),
      syncNavigationChrome: () => readingNavigation?.refresh({ force: true }),
      onToast: showToast,
    },
  }));
  documentModeCoordinator.refresh();
}

function mountReadingNavigation(own) {
  readingNavigation = own(createReadingNavigationController({
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
      getDocument: getCurrentDocument,
      getFilePath: getCurrentFilePath,
      getMode: () => isEditMode ? 'edit' : isSourceViewActive() ? 'source' : 'read',
      isHelpVisible,
      isLineGuideEnabled: () => readerControls?.current().readingTools.lineGuide,
      isMinimapEnabled: () => readerControls?.current().readingTools.minimap,
      getEditorCursorLine: () => editorSession?.current().cursor?.line,
    },
    hooks: {
      onMetricsChange: updateStatusMetrics,
    },
  }));
  readingNavigation.start();
  readingNavigation.refreshTools();
}

function mountDocumentContentActions(own) {
  documentContentActions = own(createDocumentContentActions({
    window,
    document,
    elements: {
      content: ui.content,
      sourceView: ui.sourceView,
      sourceContent: ui.sourceContent,
    },
    adapters: {
      isDocumentAvailable: hasLoadedDocument,
      isHelpVisible,
      isEditMode: () => isEditMode,
      isSourceActive: isSourceViewActive,
      getDocument: getCurrentDocument,
      getEditorSession: () => editorSession,
      toggleReadTask: (payload) => documentSaveCoordinator?.toggleReadTask(payload),
    },
    hooks: { onToast: showToast },
  }));
}

function mountContextMenu(own) {
  contextMenuController = own(createContextMenuController({
    window,
    document,
    resolveContext: ({ target }) => documentContentActions?.resolveContext({ target }),
    hooks: {
      onDiagnostic: (message, error) => console.error(`${message}:`, error),
    },
  }));
  contextMenuController.start();
}

function mountTooltips(own) {
  tooltipController = own(createTooltipController({
    window,
    document,
    hooks: {
      onDiagnostic: (message, error) => console.error(`${message}:`, error),
    },
  }));
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

  const action = getLinkAction(hrefAttribute, getCurrentFilePath(), target.href);
  if (action.type === 'anchor') return;

  event.preventDefault();

  if (action.type === 'external') {
    Promise.resolve(runtimeAdapters?.windows?.openExternalUrl?.(action.href)).catch((error) => {
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

function mountReaderZoom(own) {
  readerZoom = own(createReaderZoomController({
    window,
    document,
    hooks: {
      onZoomChange: () => {
        readingNavigation?.markDirty();
        updateStatus(getCurrentFilePath());
      },
      onToast: showToast,
    },
  }));
}

function mountReaderKeyboard(own) {
  readerKeyboard = own(createReaderKeyboardController({
    window,
    adapters: {
      isHelpVisible,
      isReadingToolsOpen: () => readerControls?.isReadingToolsOpen(),
      isTypographyOpen: () => readerControls?.isTypographyOpen(),
      isEditMode: () => isEditMode,
    },
    hooks: {
      toggleHelp,
      closeHelp: () => setHelpVisible(false),
      closeReadingTools: () => setReadingToolsOpen(false, { returnFocus: true }),
      closeTypography: () => setTypographyOpen(false, { returnFocus: true }),
      toggleEdit: () => {
        if (!documentAllowsMode('edit')) {
          showToast('This document opens read-only');
          return;
        }
        documentModeCoordinator?.toggleEdit();
      },
      saveEditor: () => documentSaveCoordinator?.saveEditor(),
      openFile: openFilePicker,
      closeFile: closeCurrentFile,
      zoomIn: () => readerZoom?.zoomIn(),
      zoomOut: () => readerZoom?.zoomOut(),
      resetZoom: () => readerZoom?.reset(),
      cycleTheme,
    },
  }));
  readerKeyboard.start();
}

function handleThemeSelection(event) {
  const index = Number.parseInt(event.target.value, 10);
  if (Number.isInteger(index)) themeCoordinator?.applyIndex(index);
}

function mountDocumentIngress(own) {
  documentIngress = own(createDocumentIngressController({
    window,
    document,
    adapters: {
      openDocument: (value) => readerShell?.open(value),
      canChangeDocument: () => !editorSession || editorSession.canChangeDocument(),
      acknowledgeOpenFile: (id) => runtimeAdapters.openRequests.acknowledge(id),
    },
    hooks: {
      closeReadingTools: () => setReadingToolsOpen(false),
      onToast: showToast,
      onWarning: (message, error) => console.warn(`${message}:`, error),
      onDiagnostic: (message, error) => console.error(`${message}:`, error),
    },
  }));
}

function openFilePicker() {
  return documentIngress?.openPicker();
}

function applicationEvents() {
  return [
    { target: window, type: 'wheel', listener: (event) => readerZoom?.handleWheel(event), options: { passive: false } },
    { target: document, type: 'click', listener: handleLinkClick },
    { target: ui.emptyOpenButton, type: 'click', listener: openFilePicker },
    { target: ui.toolbarOpenButton, type: 'click', listener: openFilePicker },
    { target: ui.helpToggleButton, type: 'click', listener: toggleHelp },
    { target: ui.closeHelpButton, type: 'click', listener: () => setHelpVisible(false) },
    { target: ui.content, type: 'change', listener: (event) => documentContentActions?.handleReadTaskToggle(event) },
    { target: ui.editModeButton, type: 'click', listener: () => documentModeCoordinator?.cycle() },
    { target: ui.editorSaveButton, type: 'click', listener: () => documentSaveCoordinator?.saveEditor() },
    { target: document.getElementById('theme-select'), type: 'change', listener: handleThemeSelection },
  ];
}

async function startApplication(own) {
  const preferenceResult = await readerShell.preferences.load();
  if (preferenceResult.status === 'fallback') {
    console.warn('One or more saved preferences could not be restored:', preferenceResult.warnings);
  }
  await documentIngress?.start();
  await setupWindowChrome(own);
  await initThemes(own);
  const queryFilePath = new URLSearchParams(window.location.search).get('file');
  let initialFilePaths = queryFilePath ? [queryFilePath] : [];

  if (initialFilePaths.length === 0) {
    initialFilePaths = await runtimeAdapters.openRequests.getInitialFilePaths();
  }

  await readerShell.start(initialFilePaths.length > 0 ? {
    origin: 'launch',
    items: initialFilePaths.map((path) => ({ path })),
  } : null);
}

/**
 * Executable application composition seam. Tests may import and await this
 * without relying on DOMContentLoaded auto-start.
 */
export async function startOpenMdApplication() {
  applicationLifecycle = createApplicationLifecycleController({
    window,
    isDirty: () => Boolean(editorSession?.isDirty()),
    hooks: {
      onDiagnostic: (message, error) => console.error(`${message}:`, error),
    },
  });
  await applicationLifecycle.start(async ({ own, listen }) => {
    cacheElements();
    statusPresenter = own(createStatusPresenter({
      window,
      document,
      elements: {
        primary: ui.statusPrimary,
        context: ui.statusContext,
        metrics: ui.statusMetrics,
      },
    }));
    toastPresenter = own(createToastPresenter({ window, document, element: ui.toast }));
    mountTooltips(own);
    responsiveTypography = own(createResponsiveTypography({
      window,
      root: document,
      onDiagnostic: (message, error) => console.warn(`${message}:`, error),
    }));
    mountApplicationReaderShell(own);
    mountReaderZoom(own);
    mountReaderViewport(own);
    mountReaderControls(own);
    mountApplicationEditor(own);
    mountDocumentSaveCoordinator(own);
    mountDocumentViewState(own);
    mountDocumentModeCoordinator(own);
    mountReadingNavigation(own);
    mountDocumentContentActions(own);
    mountDocumentIngress(own);
    mountContextMenu(own);
    mountReaderKeyboard(own);
    syncViewportState();
    for (const binding of applicationEvents()) {
      listen(binding.target, binding.type, binding.listener, binding.options);
    }
    await startApplication(own);
  });
  return Object.freeze({
    dispose: () => applicationLifecycle?.dispose(),
    currentPath: () => getCurrentFilePath(),
    currentDocument: () => getCurrentDocument(),
    zoom: () => readerZoom?.current?.() ?? 1,
  });
}

if (typeof window !== 'undefined' && !window.__VITEST__) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      startOpenMdApplication().catch((error) => console.error('open.md initialization failed:', error));
    });
  } else {
    startOpenMdApplication().catch((error) => console.error('open.md initialization failed:', error));
  }
}
