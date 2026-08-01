import { getDisplayName } from './document-path.js';
import {
  getEditorKind,
  isImageFormat,
  isMarkdownFormat,
  resolveFormatId,
} from './format-registry.js';

function freezeState(snapshot) {
  return Object.freeze({
    state: snapshot.state || 'idle',
    path: snapshot.path || null,
    document: snapshot.document || null,
    ...(snapshot.error ? { error: snapshot.error } : {}),
  });
}

export function createDocumentViewStateController({
  window,
  adapters = {},
  hooks = {},
} = {}) {
  if (!window) throw new TypeError('Document View State requires a window');

  let state = freezeState({ state: 'idle', path: null, document: null });
  let disposed = false;

  const current = () => state;
  const isCurrentPath = (path) => !state.path || state.path === path;
  const setDocumentChrome = (path, document = null) => {
    const format = resolveFormatId(path, document);
    const isImage = Boolean(path) && isImageFormat(format, { kind: document?.kind });
    const body = window.document?.body;
    body?.classList.toggle('is-image-document', isImage);
    if (path && format) body?.setAttribute('data-document-format', format);
    else body?.removeAttribute('data-document-format');
  };
  const publish = (snapshot) => {
    state = freezeState(snapshot);
    hooks.onStateChange?.(state);
    return state;
  };

  const setEditorDocument = (path, document) => {
    const format = resolveFormatId(path, document);
    const editorKind = getEditorKind(format, { kind: document?.kind });
    if (editorKind === 'none' || isImageFormat(format, { kind: document?.kind })) {
      adapters.getEditorSession?.()?.clearDocument();
      return;
    }
    adapters.getEditorSession?.()?.setDocument({
      path,
      source: document.source,
      markdown: editorKind === 'blocks' || isMarkdownFormat(format, { kind: document?.kind }),
      presentation: editorKind === 'json-props' ? 'json-props' : 'default',
    });
  };

  const handle = (snapshot = {}) => {
    if (disposed) return state;
    if (snapshot.state === 'loading') {
      const editorSession = adapters.getEditorSession?.();
      if (editorSession?.current().path && editorSession.current().path !== snapshot.path) {
        editorSession.clearDocument();
      }
      setDocumentChrome(snapshot.path, null);
      publish({ state: 'loading', path: snapshot.path, document: null });
      hooks.replaceDocument?.({ path: snapshot.path, document: null });
      hooks.resetReadingState?.();
      hooks.closeReadingTools?.();
      hooks.syncViewport?.();
      hooks.applyReadingTools?.();
      hooks.setStatus?.(getDisplayName(snapshot.path), 'Opening…');
      hooks.updateTitle?.(snapshot.path);
      return state;
    }

    if (snapshot.state === 'ready') {
      if (!isCurrentPath(snapshot.path)) return state;
      setDocumentChrome(snapshot.path, snapshot.document);
      publish({ state: 'ready', path: snapshot.path, document: snapshot.document });
      hooks.replaceDocument?.({ path: snapshot.path, document: snapshot.document });
      setEditorDocument(snapshot.path, snapshot.document);
      hooks.updateTitle?.(snapshot.path);
      hooks.updateUrl?.(snapshot.path);
      hooks.applyReadingTools?.();
      hooks.onDocumentReady?.({ path: snapshot.path, document: snapshot.document });
      return state;
    }

    if (snapshot.state === 'failed') {
      if (!isCurrentPath(snapshot.path)) return state;
      setDocumentChrome(snapshot.path, null);
      publish({ state: 'failed', path: snapshot.path, document: null, error: snapshot.error });
      hooks.replaceDocument?.({ path: snapshot.path, document: null });
      hooks.markNavigationDirty?.();
      hooks.updateTitle?.(snapshot.path);
      hooks.updateUrl?.(snapshot.path);
      hooks.applyReadingTools?.();
      hooks.setStatus?.(getDisplayName(snapshot.path), 'Could not open');
      adapters.getEditorSession?.()?.clearDocument();
      return state;
    }

    setDocumentChrome(null, null);
    publish({ state: 'idle', path: null, document: null });
    hooks.replaceDocument?.();
    adapters.getEditorSession?.()?.clearDocument();
    hooks.resetReadingState?.();
    hooks.syncViewport?.();
    hooks.applyReadingTools?.();
    hooks.updateTitle?.();
    hooks.updateUrl?.();
    hooks.handleNavigationScroll?.();
    return state;
  };

  const commitDocument = ({ path, document } = {}) => {
    if (disposed || !path || !document || !isCurrentPath(path)) return state;
    state = freezeState({ ...state, path, document });
    hooks.updateTitle?.(path);
    hooks.updateUrl?.(path);
    return state;
  };

  const updateDocument = ({ path, document } = {}) => {
    if (disposed || !path || !document || !isCurrentPath(path)) return state;
    state = freezeState({ state: 'ready', path, document });
    return state;
  };

  /**
   * Same-path save completion: refresh identity, editor projection, and
   * optional chrome hooks without a full open cycle.
   */
  const applySavedDocument = ({ path, document } = {}) => {
    if (disposed || !path || !document || !isCurrentPath(path)) return state;
    setDocumentChrome(path, document);
    publish({ state: 'ready', path, document });
    setEditorDocument(path, document);
    hooks.onSavedDocument?.({ path, document });
    return state;
  };

  /**
   * Close eligibility: any non-idle identity (including loading/failed) may close
   * unless the dirty-document gate refuses replacement.
   */
  const requestClose = ({ canChangeDocument } = {}) => {
    if (disposed) return { status: 'disposed' };
    const hasDocument = Boolean(state.path)
      || state.state === 'loading'
      || state.state === 'failed'
      || state.state === 'ready';
    if (!hasDocument) return { status: 'empty' };
    if (canChangeDocument === false) return { status: 'blocked' };
    hooks.closeShell?.();
    return { status: 'closed' };
  };

  return Object.freeze({
    current,
    handle,
    commitDocument,
    updateDocument,
    applySavedDocument,
    requestClose,
    dispose() {
      disposed = true;
      setDocumentChrome(null, null);
    },
  });
}
