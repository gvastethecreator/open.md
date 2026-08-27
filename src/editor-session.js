import { createEditorDocumentModel } from './editor-document.js';
import { createEditorClassicSurface } from './editor-classic-surface.js';
import { shouldReduceMotion } from './reader-preferences.js';
import { createJsonPropertyEditor } from './json-property-editor.js';
import { parseJsonPropertyModel } from './json-property-model.js';

const MAX_EDITABLE_CHARACTERS = 2 * 1024 * 1024;
const MAX_EDITABLE_LINES = 20_000;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function createEditorSession({ window, elements, adapters, hooks = {} }) {
  const { document } = window;
  const {
    root,
    canvas,
    contextLabel,
    contextHint,
  } = elements;

  if (!root || !canvas) {
    throw new Error('Editor session requires its document canvas');
  }
  if (typeof adapters?.save !== 'function') {
    throw new Error('Editor session requires a save adapter');
  }

  let activeDocument = null;
  const documentModel = createEditorDocumentModel();
  let documentSnapshot = documentModel.snapshot();
  const unsubscribeDocumentModel = documentModel.subscribe((nextSnapshot) => {
    documentSnapshot = nextSnapshot;
  });
  let savedSource = '';
  let mode = 'read';
  let saveState = 'idle';
  let saveError = '';
  let classicSurface = null;
  let jsonPropertyEditor = null;
  let editPresentation = 'rendered';
  let disposed = false;
  const drafts = new Map();

  const isSourceSelected = () => editPresentation === 'source';
  const isSourcePresentation = () => mode === 'edit' && isSourceSelected();
  const isMarkdown = () => activeDocument?.markdown !== false && !isSourceSelected();
  const wantsJsonProps = () => !isSourceSelected() && activeDocument?.presentation === 'json-props';
  const isJsonProps = () => mode === 'edit' && wantsJsonProps() && Boolean(jsonPropertyEditor);
  const isClassic = () => mode === 'edit' && !isJsonProps();
  const flushJsonProps = () => {
    if (!isJsonProps()) return { ok: true, skipped: true };
    return jsonPropertyEditor.flushPending?.() || { ok: true, skipped: true };
  };
  const source = () => (
    isJsonProps()
      ? jsonPropertyEditor.source()
      : documentSnapshot.source
  );
  const dirty = () => {
    if (mode !== 'edit') return false;
    if (isJsonProps() && jsonPropertyEditor.hasPendingChanges?.()) return true;
    return source() !== savedSource;
  };
  const snapshot = () => Object.freeze({
    mode,
    path: activeDocument?.path || null,
    dirty: dirty(),
    saveState,
    error: saveError,
    stats: documentSnapshot.stats,
    cursor: documentSnapshot.cursor,
    presentation: isSourcePresentation()
      ? 'source'
      : isJsonProps() ? 'json-props' : 'classic',
  });
  const notify = () => hooks.onStateChange?.(snapshot());

  const reportJsonFlushFailure = (result) => {
    if (!result || result.ok !== false) return false;
    saveState = 'error';
    saveError = result.error || 'Fix invalid JSON values before continuing';
    notify();
    hooks.onUnavailable?.(saveError);
    return true;
  };

  const preparePresentationChange = () => {
    if (!isJsonProps()) return true;
    const flushed = flushJsonProps();
    return !reportJsonFlushFailure(flushed);
  };

  const disposeJsonPropertyEditor = () => {
    jsonPropertyEditor?.dispose?.();
    jsonPropertyEditor = null;
    root.classList.remove('is-json-props-presentation');
  };

  const setCursor = (nextCursor) => {
    if (!documentModel.setCursor(nextCursor)) return;
    hooks.onCursorChange?.(documentSnapshot.cursor);
  };

  const restoreHistory = (action) => {
    const result = action === 'redo'
      ? documentModel.redo()
      : documentModel.undo();
    if (!result.changed) return false;
    if (isClassic() && classicSurface?.isMounted?.()) {
      const line = Math.max(0, (result.cursor?.line || 1) - 1);
      const caret = Math.max(0, (result.cursor?.column || 1) - 1);
      classicSurface.render({ source: source(), focusLine: line, caret });
    }
    notify();
    hooks.onHistoryRestore?.(action);
    return true;
  };

  const updateContextChrome = () => {
    const markdown = isMarkdown();
    if (contextLabel) {
      contextLabel.textContent = isSourcePresentation()
        ? 'Source editor'
        : wantsJsonProps()
          ? 'JSON properties'
          : markdown
            ? 'Live preview'
            : 'Plain-text editor';
    }
    if (!contextHint) return;
    contextHint.replaceChildren();
    if (isSourcePresentation()) {
      contextHint.textContent = 'Edit raw source directly';
    } else if (wantsJsonProps()) {
      contextHint.textContent = 'Edit top-level keys · nested values as JSON';
    } else if (markdown) {
      contextHint.textContent = 'Active line is Markdown · other lines are preview';
    } else {
      contextHint.textContent = 'Each line saves as text';
    }
  };

  function applyPresentationChrome() {
    const jsonMode = isJsonProps();
    root.classList.toggle('is-source-presentation', isSourcePresentation());
    root.classList.remove('is-block-presentation');
    root.classList.toggle('is-classic-presentation', isClassic());
    root.classList.toggle('is-json-props-presentation', jsonMode);
    if (mode === 'edit' && jsonMode) {
      canvas.contentEditable = 'false';
      canvas.removeAttribute('role');
      canvas.removeAttribute('aria-multiline');
      canvas.setAttribute('aria-label', 'JSON property editor');
      canvas.classList.remove('is-classic-surface');
    } else if (mode === 'edit') {
      canvas.contentEditable = 'true';
      canvas.setAttribute('role', 'textbox');
      canvas.setAttribute('aria-multiline', 'true');
      canvas.setAttribute('aria-label', isSourcePresentation() ? 'Source editor' : 'Document editor');
      canvas.classList.add('is-classic-surface');
    } else {
      canvas.contentEditable = 'false';
      canvas.removeAttribute('role');
      canvas.removeAttribute('aria-multiline');
      canvas.removeAttribute('aria-label');
      canvas.classList.remove('is-classic-surface');
    }
  }

  function render() {
    if (isJsonProps()) {
      if (classicSurface?.isMounted?.()) classicSurface.unmount();
      applyPresentationChrome();
      root.classList.toggle('is-empty-document', source().length === 0);
      return;
    }

    applyPresentationChrome();
    if (!classicSurface?.isMounted?.()) classicSurface?.mount?.();
    else classicSurface?.render?.({ source: source(), focusLine: classicSurface.activeLine?.() ?? 0 });
    root.classList.toggle('is-empty-document', source().length === 0);
  }

  const mountJsonProperties = (initialSource) => {
    const parsed = parseJsonPropertyModel(initialSource);
    if (!parsed.ok) return parsed;
    activeDocument = { ...activeDocument, presentation: 'json-props' };
    jsonPropertyEditor = createJsonPropertyEditor({
      window,
      root: canvas,
      onChange: ({ source: nextSource }) => {
        documentModel.applySource(nextSource);
        saveState = 'idle';
        saveError = '';
        notify();
      },
      onDiagnostic: hooks.onDiagnostic,
    });
    if (classicSurface?.isMounted?.()) classicSurface.unmount();
    jsonPropertyEditor.load(initialSource);
    applyPresentationChrome();
    updateContextChrome();
    root.hidden = false;
    root.removeAttribute('inert');
    notify();
    queueMicrotask(() => {
      canvas.querySelector('[data-json-value]')?.focus?.({ preventScroll: true });
    });
    return { ok: true };
  };

  const enter = () => {
    if (disposed || !activeDocument) return false;
    const draft = drafts.get(activeDocument.path);
    const initialSource = draft?.source ?? activeDocument.source;
    const lineCount = initialSource.split('\n').length;
    if (initialSource.length > MAX_EDITABLE_CHARACTERS || lineCount > MAX_EDITABLE_LINES) {
      hooks.onUnavailable?.(
        'This document is too large for live-preview editing. Source view is still available.'
      );
      return false;
    }

    disposeJsonPropertyEditor();
    editPresentation = adapters.isSourceMode?.() ? 'source' : 'rendered';

    let useJsonProps = wantsJsonProps();
    if (useJsonProps) {
      const parsed = parseJsonPropertyModel(initialSource);
      if (!parsed.ok) {
        useJsonProps = false;
        if (parsed.reason === 'invalid') {
          hooks.onUnavailable?.('Invalid JSON — editing as plain text');
        } else if (parsed.reason === 'too-large') {
          hooks.onUnavailable?.('Large JSON — editing as plain text');
        }
      }
    }

    documentModel.load(initialSource, {
      markdown: Boolean(activeDocument.markdown) && !useJsonProps && !isSourceSelected(),
    });
    savedSource = activeDocument.source;
    mode = 'edit';
    saveState = draft ? 'recovered' : 'idle';
    saveError = '';

    if (useJsonProps) {
      mountJsonProperties(initialSource);
      return true;
    }

    if (wantsJsonProps() && !useJsonProps) {
      activeDocument = { ...activeDocument, presentation: 'default', markdown: false };
    }

    render();
    applyPresentationChrome();
    updateContextChrome();
    root.hidden = false;
    root.removeAttribute('inert');
    notify();
    canvas.focus({ preventScroll: true });
    return true;
  };

  const exit = ({ force = false } = {}) => {
    if (mode !== 'edit') return true;
    flushJsonProps();
    if (dirty() && !force) return false;
    if (classicSurface?.isMounted?.()) classicSurface.unmount();
    disposeJsonPropertyEditor();
    mode = 'read';
    saveState = 'idle';
    saveError = '';
    applyPresentationChrome();
    root.hidden = true;
    root.setAttribute('inert', '');
    notify();
    return true;
  };

  const refreshPresentation = () => {
    if (disposed || mode !== 'edit') return;
    const nextEditPresentation = adapters.isSourceMode?.() ? 'source' : 'rendered';
    const presentationChanged = nextEditPresentation !== editPresentation;
    if (isJsonProps() && !presentationChanged) {
      applyPresentationChrome();
      updateContextChrome();
      notify();
      return true;
    }
    if (!presentationChanged) {
      if (classicSurface?.isMounted?.()) classicSurface.commitFromDom?.();
      updateContextChrome();
      notify();
      return true;
    }
    if (isJsonProps()) {
      if (!preparePresentationChange()) return false;
    } else if (classicSurface?.isMounted?.()) {
      classicSurface.commitFromDom?.();
    }
    const committedSource = source();
    editPresentation = nextEditPresentation;
    disposeJsonPropertyEditor();
    documentModel.load(committedSource, {
      markdown: Boolean(activeDocument?.markdown) && !isSourceSelected(),
    });
    if (!isSourceSelected() && activeDocument?.presentation === 'json-props') {
      const result = mountJsonProperties(source());
      if (result.ok) return true;
      activeDocument = { ...activeDocument, presentation: 'default', markdown: false };
      const unavailableMessage = result.reason === 'invalid'
        ? 'Invalid JSON — editing as plain text'
        : 'Large JSON — editing as plain text';
      const fallbackPath = activeDocument.path;
      window.setTimeout(() => {
        if (
          !disposed
          && mode === 'edit'
          && !isSourceSelected()
          && activeDocument?.path === fallbackPath
        ) hooks.onUnavailable?.(unavailableMessage);
      }, 0);
    }
    render();
    updateContextChrome();
    notify();
    if (isClassic()) {
      queueMicrotask(() => {
        classicSurface?.render?.({ source: source(), focusLine: 0, caret: 0 });
        canvas.focus({ preventScroll: true });
      });
    }
    return true;
  };

  const save = async () => {
    if (disposed || mode !== 'edit' || !activeDocument || saveState === 'saving') {
      return { status: 'unavailable' };
    }
    if (isJsonProps()) {
      const flushed = flushJsonProps();
      if (reportJsonFlushFailure(flushed)) {
        return { status: 'unavailable', error: flushed.error };
      }
      documentModel.applySource(source());
    } else if (isClassic()) {
      classicSurface?.commitFromDom?.();
    }
    const savingDocument = activeDocument;
    const savingPath = savingDocument.path;
    const nextSource = source();
    if (nextSource === savedSource) return { status: 'unchanged', source: nextSource };
    saveState = 'saving';
    saveError = '';
    notify();
    try {
      const result = await adapters.save(savingPath, nextSource);
      if (disposed || activeDocument !== savingDocument) return { status: 'stale' };
      savedSource = nextSource;
      drafts.delete(savingPath);
      saveState = 'saved';
      notify();
      await hooks.onSaved?.({ path: savingPath, source: nextSource, result });
      return { status: 'saved', source: nextSource, result };
    } catch (error) {
      if (disposed || activeDocument !== savingDocument) return { status: 'stale' };
      saveState = 'error';
      saveError = errorMessage(error);
      drafts.set(savingPath, { source: nextSource, savedSource });
      notify();
      hooks.onDiagnostic?.('Could not save the document', error);
      return { status: 'failed', error };
    }
  };

  const setDocument = ({
    path,
    source: nextSource,
    markdown = true,
    presentation = 'default',
  }) => {
    const normalizedSource = String(nextSource ?? '');
    const sameActiveEditor = mode === 'edit' && activeDocument?.path === path;
    if (activeDocument?.path && activeDocument.path !== path) {
      flushJsonProps();
      if (dirty()) {
        drafts.set(activeDocument.path, { source: source(), savedSource });
        hooks.onDraftPreserved?.(activeDocument.path);
      }
    }
    activeDocument = {
      path,
      source: normalizedSource,
      markdown: Boolean(markdown),
      presentation: presentation === 'json-props' ? 'json-props' : 'default',
    };
    updateContextChrome();
    if (sameActiveEditor) {
      savedSource = normalizedSource;
      if (isJsonProps()) {
        jsonPropertyEditor?.load(normalizedSource);
      }
      saveState = source() === normalizedSource ? 'saved' : 'idle';
      saveError = '';
      notify();
    } else if (mode === 'edit') enter();
    else notify();
  };

  const clearDocument = () => {
    flushJsonProps();
    if (dirty() && activeDocument?.path) {
      drafts.set(activeDocument.path, { source: source(), savedSource });
    }
    activeDocument = null;
    exit({ force: true });
    documentModel.load('');
    savedSource = '';
    notify();
  };

  const canChangeDocument = () => {
    flushJsonProps();
    return !dirty();
  };

  const resolveReduceMotion = () => shouldReduceMotion(
    window,
    adapters.getAdvancedPreferences?.() || null,
  );

  const activeLineBand = elements.activeLineBand
    || document.getElementById('editor-active-line-band');

  classicSurface = createEditorClassicSurface({
    window,
    canvas,
    adapters: {
      isMarkdown: () => isMarkdown(),
      highlightSource: () => isSourcePresentation() && activeDocument?.markdown !== false,
      getSource: () => source(),
      applySource: (next, options) => documentModel.applySource(next, options),
      restoreHistory,
      setCursor,
      shouldReduceMotion: resolveReduceMotion,
      getAriaLabel: () => isSourcePresentation() ? 'Source editor' : 'Document editor',
      getActiveLineBand: () => activeLineBand,
      getBandHost: () => root,
    },
    hooks: {
      onChange: () => {
        saveState = 'idle';
        saveError = '';
        notify();
      },
    },
  });

  root.hidden = true;
  root.setAttribute('inert', '');

  return Object.freeze({
    setDocument,
    clearDocument,
    enter,
    exit,
    preparePresentationChange,
    refreshPresentation,
    toggle() {
      return mode === 'edit' ? exit() : enter();
    },
    save,
    canChangeDocument,
    isEditing: () => mode === 'edit',
    isDirty: dirty,
    current: snapshot,
    source,
    jsonPropertyActions: Object.freeze({
      duplicate: (path) => jsonPropertyEditor?.duplicate?.(path),
      remove: (path) => jsonPropertyEditor?.remove?.(path),
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      if (classicSurface?.isMounted?.()) classicSurface.unmount();
      disposeJsonPropertyEditor();
      classicSurface?.dispose?.();
      unsubscribeDocumentModel();
      documentModel.dispose();
    },
  });
}
