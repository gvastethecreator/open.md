import { createDocumentSession } from './document-session.js';

function firstIntentItem(intent) {
  return intent?.items?.find((candidate) => (
    candidate && typeof candidate.path === 'string' && candidate.path.trim() !== ''
  ));
}

export function mountReaderShell({ window, adapters, hooks = {} }) {
  if (!window?.document) throw new Error('Reader shell requires a window with a document');

  const documentSession = createDocumentSession({ window, adapters, hooks });
  let disposed = false;

  return Object.freeze({
    open(intent) {
      if (disposed) throw new Error('Reader shell is disposed');
      const item = firstIntentItem(intent);
      if (!item) {
        documentSession.clear();
        return Promise.resolve({ status: 'idle', path: null });
      }
      return documentSession.open(item);
    },
    refreshAppearance({ diagramTheme = 'default' } = {}) {
      if (disposed) return Promise.resolve(false);
      return documentSession.refreshDiagrams(diagramTheme);
    },
    currentDocument: () => documentSession.current(),
    dispose() {
      if (disposed) return;
      disposed = true;
      documentSession.dispose();
    },
  });
}
