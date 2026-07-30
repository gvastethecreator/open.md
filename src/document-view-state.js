import { getDisplayName, getFileKind } from './core/reader.js';

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
  const publish = (snapshot) => {
    state = freezeState(snapshot);
    hooks.onStateChange?.(state);
    return state;
  };

  const setEditorDocument = (path, document) => {
    adapters.getEditorSession?.()?.setDocument({
      path,
      source: document.source,
      markdown: getFileKind(path) === 'Markdown',
    });
  };

  const handle = (snapshot = {}) => {
    if (disposed) return state;
    if (snapshot.state === 'loading') {
      const editorSession = adapters.getEditorSession?.();
      if (editorSession?.current().path && editorSession.current().path !== snapshot.path) {
        editorSession.clearDocument();
      }
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
      publish({ state: 'ready', path: snapshot.path, document: snapshot.document });
      hooks.replaceDocument?.({ path: snapshot.path, document: snapshot.document });
      setEditorDocument(snapshot.path, snapshot.document);
      hooks.updateTitle?.(snapshot.path);
      hooks.updateUrl?.(snapshot.path);
      hooks.applyReadingTools?.();
      return state;
    }

    if (snapshot.state === 'failed') {
      if (!isCurrentPath(snapshot.path)) return state;
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
    },
  });
}
