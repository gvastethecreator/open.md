import { getDisplayName, getFileKind } from './core/reader.js';
import { getEditorKind, isImageFormat, isMarkdownFormat } from './format-registry.js';

function freezeState(snapshot) {
  return Object.freeze({
    state: snapshot.state || 'idle',
    path: snapshot.path || null,
    document: snapshot.document || null,
    ...(snapshot.error ? { error: snapshot.error } : {}),
  });
}

function resolveFormat(path, document) {
  if (document?.format) return document.format;
  if (document?.kind === 'image') return 'image';
  if (document?.kind === 'markdown') return 'markdown';
  if (document?.kind === 'text') return 'text';
  if (path && getFileKind(path) === 'Image') return 'image';
  if (path && getFileKind(path) === 'Markdown') return 'markdown';
  return 'text';
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
    const format = resolveFormat(path, document);
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
    const format = resolveFormat(path, document);
    const editorKind = getEditorKind(format, { kind: document?.kind });
    if (editorKind === 'none' || isImageFormat(format, { kind: document?.kind })) {
      adapters.getEditorSession?.()?.clearDocument();
      return;
    }
    adapters.getEditorSession?.()?.setDocument({
      path,
      source: document.source,
      markdown: editorKind === 'blocks' || isMarkdownFormat(format, { kind: document?.kind }),
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
      hooks.applyFormatPreferences?.(resolveFormat(snapshot.path, snapshot.document));
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

  return Object.freeze({
    current,
    handle,
    commitDocument,
    updateDocument,
    dispose() {
      disposed = true;
      setDocumentChrome(null, null);
    },
  });
}
