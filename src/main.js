import { getDisplayName } from './document-path.js';
import {
  allowsDocumentMode,
  resolveFormatId,
} from './format-registry.js';
import { createPathThemePreferenceCoordinator } from './path-theme-memory.js';
import { createDocumentSaveCoordinator } from './document-save-coordinator.js';
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
import { createScrollbarVisibilityController } from './scrollbar-visibility-controller.js';
import { createStatusPresenter } from './status-presenter.js';
import { createReaderViewportController } from './reader-viewport-controller.js';
import { createEditorFeedbackPresenter } from './editor-feedback-presenter.js';
import { createDocumentContentActions } from './document-content-actions.js';
import { createDocumentViewStateController } from './document-view-state.js';
import { createDocumentIngressController } from './document-ingress-controller.js';
import { createDocumentLinkController } from './document-link-controller.js';
import { createReaderKeyboardController } from './reader-keyboard-controller.js';
import { createApplicationLifecycleController } from './application-lifecycle.js';
import { createReaderZoomController } from './reader-zoom-controller.js';
import { createEmptyStateMotion } from './empty-state-motion.js';
import { createEditorStateCoordinator } from './editor-state-coordinator.js';

const appLoadingScreenModule = import('./app-loading-screen.js');
const themesModule = import('./themes.runtime.json');

let windowChrome = null;
let readerZoom = null;
let readerShell = null;
let runtimeAdapters = null;
let editorSession = null;
let editorStateCoordinator = null;
let responsiveTypography = null;
let documentSaveCoordinator = null;
let documentModeCoordinator = null;
let readingNavigation = null;
let toastPresenter = null;
let themeCoordinator = null;
let pathThemePreferences = null;
let contextMenuController = null;
let tooltipController = null;
let scrollbarVisibility = null;
let statusPresenter = null;
let readerControls = null;
let imageViewState = null;
let readerViewport = null;
let editorFeedback = null;
let documentContentActions = null;
let documentLinkController = null;
let documentViewState = null;
let documentIngress = null;
let readerKeyboard = null;
let applicationLifecycle = null;
let appLoadingScreen = null;
let pendingInitialTheme = Promise.resolve();


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
  ui.optionsDeck = document.getElementById('options-deck');
  ui.advancedOptionsButton = document.getElementById('advanced-options-button');
  ui.advancedBackButton = document.getElementById('advanced-back-button');
  ui.readingToolsHeaderLabel = document.getElementById('reading-tools-header-label');
  ui.advancedToggles = [...document.querySelectorAll('[data-advanced-pref]')];
  ui.imageDefaultZoomSelect = document.getElementById('image-default-zoom');
  ui.csvRowCapInput = document.getElementById('csv-row-cap');
  ui.allowMultipleInstancesToggle = document.getElementById('allow-multiple-instances-toggle');
  ui.fileAssociationButton = document.getElementById('file-association-button');

  ui.themeField = document.querySelector('.appearance-theme-field') || document.querySelector('.theme-field');
  ui.fontButtons = [...document.querySelectorAll('[data-font-kind]')];
  ui.alwaysOnTopButton = document.getElementById('always-on-top-button');
  ui.autoSaveToggle = document.getElementById('auto-save-toggle');
  ui.editorView = document.getElementById('editor-view');
  ui.editorCanvas = document.getElementById('editor-canvas');
  ui.sourceModeButton = document.getElementById('source-mode-button');
  ui.sourceModeLabel = document.getElementById('source-mode-label');
  ui.editModeButton = document.getElementById('edit-mode-button');
  ui.editModeLabel = document.getElementById('edit-mode-label');
  ui.editorSaveButton = document.getElementById('editor-save-button');
  ui.editorSaveLabel = document.getElementById('editor-save-label');
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
    canClose: () => confirmEditorDiscard('Discard unsaved changes and close open.md?'),
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

function isEditing() {
  return editorStateCoordinator?.isEditing() ?? false;
}

function isSourceModeSelected() {
  return Boolean(hasLoadedDocument() && readerControls?.current().readingTools.source);
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
  if (!statusPresenter) return;

  const path = filePath ?? getCurrentFilePath();
  const documentSnapshot = getCurrentDocument();
  if (!path) imageViewState = null;
  const editMode = isEditing();
  statusPresenter.project({
    helpVisible: isHelpVisible(),
    path,
    document: documentSnapshot,
    editMode,
    sourceActive: Boolean(documentSnapshot && readerControls?.current().readingTools.source),
    editorSnapshot: editMode ? editorSession?.current() : null,
    editorSource: editMode ? editorSession?.source?.() : null,
    zoomPercent: readerZoom?.percent?.() ?? 100,
    navigation: readingNavigation?.snapshot(),
    readingTools: readerControls?.current().readingTools,
    imageState: imageViewState,
  });
}

function updateStatusMetrics() {
  updateStatus(getCurrentFilePath());
}

function hasLoadedDocument() {
  return Boolean(getCurrentDocument() && getCurrentFilePath());
}

function isSourceViewActive() {
  return isSourceModeSelected() && !isEditing();
}

function reportPreferenceResult(result) {
  if (result?.status === 'volatile') {
    showToast('Preference applied for this session only');
  }
}

function handlePreferenceSnapshot(snapshot) {
  readerControls?.applySnapshot(snapshot);
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
  const { default: allThemes } = await themesModule;
  try {
    const prefs = readerShell.preferences.current();
    const savedThemeName = prefs.themeName;
    const randomAtStart = Boolean(prefs.advanced?.randomThemeAtStart);
    pathThemePreferences = own(createPathThemePreferenceCoordinator({
      preferences: readerShell.preferences,
      getCurrentPath: getCurrentFilePath,
      getCurrentThemeName: () => themeCoordinator?.current()?.name || null,
      applyTheme: (themeName, options) => themeCoordinator?.applyName(themeName, options),
    }));
    themeCoordinator = own(createThemeCoordinator({
      window,
      document,
      themes: allThemes,
      elements: {
        select: document.getElementById('theme-select'),
      },
      hooks: {
        shouldPrepareDiagrams: () => Boolean(getCurrentFilePath() && ui.content?.querySelector('.mermaid')),
        prepareDiagrams: (diagramTheme, diagramTokens) => readerShell?.prepareAppearance({
          diagramTheme,
          diagramTokens,
        }),
        persist: (themeName) => pathThemePreferences.persistSelection(themeName),
        onPersistResult: reportPreferenceResult,
        notify: showToast,
        beforeTransition: () => documentModeCoordinator?.cancelTransition(),
        onCommit: () => {
          appLoadingScreen?.setTheme(themeCoordinator?.diagramTokens?.());
          readingNavigation?.markDirty();
        },
        onError: (message, error) => console.error(`${message}:`, error),
      },
    }));
    await themeCoordinator.start(savedThemeName, { random: randomAtStart });
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

async function confirmEditorDiscard(message = 'Discard unsaved changes?') {
  if (!editorSession?.isDirty()) return true;
  try {
    const discard = await runtimeAdapters?.dialogs?.confirm?.(message, {
      title: 'open.md',
      kind: 'warning',
      okLabel: 'Discard',
      cancelLabel: 'Keep editing',
    });
    if (discard) editorSession.exit({ force: true });
    return discard === true;
  } catch (error) {
    console.error('Could not confirm discarding unsaved changes:', error);
    showToast('Could not confirm closing. Your changes are still here.');
    return false;
  }
}

async function closeCurrentFile() {
  const canChangeDocument = await confirmEditorDiscard();
  documentViewState?.requestClose({
    canChangeDocument,
  });
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

async function exitEditMode() {
  const path = getCurrentFilePath();
  if (!await confirmEditorDiscard('Discard unsaved changes and return to reading?')) return false;
  // Accepting a dirty-discard exits immediately inside confirmEditorDiscard;
  // report that successful transition instead of attempting a second exit.
  const exited = editorSession
    ? (editorSession.isEditing() ? editorSession.exit({ force: true }) : true)
    : false;
  const refreshPath = documentViewState?.takePendingQuietRefresh?.();
  if (!exited || !path || refreshPath !== path) return exited;

  const refreshed = await readerShell?.reload({ quiet: true });
  if (getCurrentFilePath() === path && refreshed?.status !== 'ready') {
    showToast('Saved, but the reading view could not refresh');
  }
  return exited;
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
      onDocumentReady: ({ path }) => {
        pendingInitialTheme = Promise.resolve(pathThemePreferences?.applyForPath(path))
          .catch((error) => {
            console.error('Could not restore the remembered theme:', error);
            return { status: 'error' };
          });
      },
      setStatus: setStatusText,
      updateTitle: updateWindowTitle,
      updateUrl: updateWindowUrl,
      closeShell: () => readerShell?.close(),
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
  return themeCoordinator?.diagramTokens?.() || null;
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
      onImageStateChange: (next) => {
        imageViewState = next;
        updateStatusMetrics();
      },
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
      optionsDeck: ui.optionsDeck,
      advancedOptionsButton: ui.advancedOptionsButton,
      advancedBackButton: ui.advancedBackButton,
      readingToolsHeaderLabel: ui.readingToolsHeaderLabel,
      advancedToggles: ui.advancedToggles,
      imageDefaultZoomSelect: ui.imageDefaultZoomSelect,
      csvRowCapInput: ui.csvRowCapInput,
      allowMultipleInstancesToggle: ui.allowMultipleInstancesToggle,
      fileAssociationButton: ui.fileAssociationButton,

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
      system: runtimeAdapters?.system,
      isDocumentAvailable: hasLoadedDocument,
      isEditMode: isEditing,
      getDocumentIdentity: getCurrentDocument,
    },
    hooks: {
      isHelpVisible,
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
        // Source/Rendered projection and optional block tools can change while editing.
        if (isEditing()) editorSession?.refreshPresentation?.();
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

function mountApplicationEditor(own) {
  return import('./editor-session.js').then(({ createEditorSession }) => {
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
      contextLabel: ui.editorContextLabel,
      contextHint: ui.editorContextHint,
    },
    adapters: {
      save: (path, source) => runtimeAdapters.documents.save(path, source),
      isSourceMode: isSourceModeSelected,
      getAdvancedPreferences: () => readerControls?.current()?.advanced
        || readerShell?.preferences?.current()?.advanced
        || null,
    },
    hooks: {
      onStateChange: (snapshot) => editorStateCoordinator?.apply(snapshot),
      onCursorChange: () => {
        updateStatusMetrics();
        if (readerControls?.current().readingTools.lineGuide) readingNavigation?.queueUpdate();
      },
      onSaved: async ({ path, result }) => {
        if (result && typeof result.source === 'string') {
          documentViewState?.applySavedDocument({ path, document: result });
          return;
        }
        await readerShell?.reload();
      },
      onHistoryRestore: (action) => showToast(action === 'redo' ? 'Redone' : 'Undone'),
      onDraftPreserved: (path) => showToast(`Unsaved draft kept for ${getDisplayName(path)}`),
      onUnavailable: showToast,
      onDiagnostic: (message, error) => console.error(`${message}:`, error),
    },
  }));
  });
}

function mountEditorStateCoordinator(own) {
  editorStateCoordinator = own(createEditorStateCoordinator({
    adapters: {
      renderFeedback: (application) => editorFeedback?.render(application),
      closeTransientContext: () => contextMenuController?.close({ immediate: true }),
      refreshDocumentMode: () => documentModeCoordinator?.refresh(),
      observeSave: ({ snapshot }) => documentSaveCoordinator?.observeEditor(snapshot),
      markNavigationDirty: () => readingNavigation?.markDirty(),
      scheduleTypography: () => responsiveTypography?.schedule(),
      reapplyReadingTools: applyReadingTools,
      refreshStatus: () => updateStatus(getCurrentFilePath()),
    },
    hooks: {
      onDiagnostic: (message, error) => console.error(`${message}:`, error),
    },
  }));
  if (editorSession) editorStateCoordinator.apply(editorSession.current());
}

function mountDocumentSaveCoordinator(own) {
  documentSaveCoordinator = own(createDocumentSaveCoordinator({
    window,
    adapters: {
      isEditing,
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
  documentSaveCoordinator.setAutoSaveEnabled(readerControls?.current()?.autoSave !== false, editorSession?.current());
}

function mountDocumentModeCoordinator(own) {
  documentModeCoordinator = own(createDocumentModeCoordinator({
    window,
    document,
    elements: {
      sourceControl: ui.sourceModeButton,
      sourceLabel: ui.sourceModeLabel,
      editControl: ui.editModeButton,
      editLabel: ui.editModeLabel,
      readSurface: ui.content,
      sourceSurface: ui.sourceView,
      editSurface: ui.editorView,
      lineGutter: ui.lineGutter,
      minimap: ui.documentMinimap,
    },
    adapters: {
      getMode: () => isEditing()
        ? (isSourceModeSelected() ? 'source-edit' : 'edit')
        : (isSourceViewActive() ? 'source' : 'read'),
      hasDocument: () => Boolean(editorSession && hasLoadedDocument()),
      isAvailable: (mode) => Boolean(
        editorSession
        && hasLoadedDocument()
        && (mode === 'read' || documentAllowsMode(mode))
      ),
      getDocumentIdentity: getCurrentDocument,
      enterEdit: () => editorSession?.enter(),
      exitEdit: exitEditMode,
      setSource: async (active) => {
        if (isEditing() && editorSession?.preparePresentationChange?.() === false) return false;
        return setReadingTool('source', active);
      },
    },
    hooks: {
      closeTransientUi: () => {
        setHelpVisible(false);
        setReadingToolsOpen(false);
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
      getMode: () => isEditing() ? 'edit' : isSourceViewActive() ? 'source' : 'read',
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
      editorView: ui.editorView,
    },
    adapters: {
      isDocumentAvailable: hasLoadedDocument,
      isHelpVisible,
      isEditMode: isEditing,
      isSourceActive: isSourceViewActive,
      getDocument: getCurrentDocument,
      getDocumentPath: getCurrentFilePath,
      getEditorSession: () => editorSession,
      getImageViewer: () => readerShell?.getImageViewer?.(),
      getImageMedia: () => readerShell?.getImageMedia?.(),
      downloadImage: (payload) => runtimeAdapters?.documents?.downloadImage?.(payload),
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

function mountScrollbarVisibility(own) {
  scrollbarVisibility = own(createScrollbarVisibilityController({
    window,
    document,
    roots: [
      document.getElementById('reader-page'),
      document.getElementById('help-stage'),
    ],
  }));
  scrollbarVisibility.start();
}

function mountDocumentLinkController(own) {
  documentLinkController = own(createDocumentLinkController({
    adapters: {
      isEditMode: isEditing,
      getDocumentPath: getCurrentFilePath,
      openExternalUrl: (href) => runtimeAdapters?.windows?.openExternalUrl?.(href),
      openDocument: (value) => readerShell?.open(value),
    },
    hooks: {
      onToast: showToast,
      onDiagnostic: (message, error) => console.error(`${message}:`, error),
    },
  }));
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
      isEditMode: isEditing,
    },
    hooks: {
      toggleHelp,
      closeHelp: () => setHelpVisible(false),
      closeReadingTools: () => setReadingToolsOpen(false, { returnFocus: true }),
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
      canChangeDocument: () => confirmEditorDiscard(),
      acknowledgeOpenFile: (id) => runtimeAdapters.openRequests.acknowledge(id),
      listen: runtimeAdapters.ingress.listen,
      openFileDialog: runtimeAdapters.ingress.openFileDialog,
      getCurrentWebview: runtimeAdapters.ingress.getCurrentWebview,
      listPendingOpenFileRequests: runtimeAdapters.ingress.listPendingOpenFileRequests
        || runtimeAdapters.openRequests.listPending,
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
    { target: document, type: 'click', listener: (event) => documentLinkController?.handleClick(event) },
    { target: ui.emptyOpenButton, type: 'click', listener: openFilePicker },
    { target: ui.toolbarOpenButton, type: 'click', listener: openFilePicker },
    { target: ui.helpToggleButton, type: 'click', listener: toggleHelp },
    { target: ui.closeHelpButton, type: 'click', listener: () => setHelpVisible(false) },
    { target: ui.content, type: 'change', listener: (event) => documentContentActions?.handleReadTaskToggle(event) },
    { target: ui.sourceModeButton, type: 'click', listener: () => documentModeCoordinator?.toggleSource() },
    { target: ui.editModeButton, type: 'click', listener: () => documentModeCoordinator?.toggleEdit() },
    { target: ui.editorSaveButton, type: 'click', listener: () => documentSaveCoordinator?.saveEditor() },
    { target: document.getElementById('theme-select'), type: 'change', listener: handleThemeSelection },
  ];
}

async function startApplication(own) {
  const preferenceResult = await readerShell.preferences.load();
  appLoadingScreen?.setReducedMotion(readerShell.preferences.current().advanced?.reduceMotion);
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
  const { createAppLoadingScreen } = await appLoadingScreenModule;
  let loadingLifecycleReady = false;
  applicationLifecycle = createApplicationLifecycleController({
    window,
    isDirty: () => Boolean(editorSession?.isDirty()),
    hooks: {
      onDiagnostic: (message, error) => console.error(`${message}:`, error),
    },
  });
  await applicationLifecycle.start(async ({ own, listen }) => {
    cacheElements();
    appLoadingScreen = createAppLoadingScreen({ window, document });
    own({
      dispose: () => {
        if (loadingLifecycleReady) appLoadingScreen?.dispose();
      },
    });
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
    mountScrollbarVisibility(own);
    responsiveTypography = own(createResponsiveTypography({
      window,
      root: document,
      onDiagnostic: (message, error) => console.warn(`${message}:`, error),
    }));
    mountApplicationReaderShell(own);
    mountReaderZoom(own);
    mountReaderViewport(own);
    mountReaderControls(own);
    const editorReady = mountApplicationEditor(own);
    mountDocumentSaveCoordinator(own);
    mountDocumentViewState(own);
    mountDocumentModeCoordinator(own);
    mountReadingNavigation(own);
    mountDocumentContentActions(own);
    mountDocumentLinkController(own);
    mountDocumentIngress(own);
    mountContextMenu(own);
    mountReaderKeyboard(own);
    mountEditorStateCoordinator(own);
    syncViewportState();
    for (const binding of applicationEvents()) {
      listen(binding.target, binding.type, binding.listener, binding.options);
    }
    await startApplication(own);
    await editorReady;
    if (editorSession) editorStateCoordinator?.apply(editorSession.current());
    await pendingInitialTheme;
    const emptyLogoShell = document.getElementById('empty-logo-shell');
    if (emptyLogoShell) {
      const emptyStateMotion = own(createEmptyStateMotion({
        window,
        shell: emptyLogoShell,
        openButton: ui.emptyOpenButton,
        isEmpty: () => Boolean(ui.emptyStage && !ui.emptyStage.classList.contains('hidden')),
      }));
      emptyStateMotion.start();
    }
    loadingLifecycleReady = true;
    appLoadingScreen?.complete();
  });
  return Object.freeze({
    dispose: () => applicationLifecycle?.dispose(),
    currentPath: () => getCurrentFilePath(),
    currentDocument: () => getCurrentDocument(),
    zoom: () => readerZoom?.current?.() ?? 1,
  });
}

if (typeof window !== 'undefined' && !window.__VITEST__) {
  const reportStartupFailure = (error) => {
    appLoadingScreen?.fail('Could not load open.md');
    console.error('open.md initialization failed:', error);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      startOpenMdApplication().catch(reportStartupFailure);
    });
  } else {
    startOpenMdApplication().catch(reportStartupFailure);
  }
}
