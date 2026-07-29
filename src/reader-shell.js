import { createDocumentSession } from './document-session.js';
import { createOpenIntentController } from './open-intent-controller.js';

export function mountReaderShell({ window, adapters, hooks = {} }) {
  if (!window?.document) throw new Error('Reader shell requires a window with a document');

  const documentSession = createDocumentSession({ window, adapters, hooks });
  const openIntents = createOpenIntentController({
    session: documentSession,
    openWindow: adapters.windows?.openDocument,
    onFeedback: hooks.onToast,
    onDiagnostic: hooks.onDiagnostic,
  });
  let disposed = false;

  return Object.freeze({
    start(initialIntent) {
      if (disposed) throw new Error('Reader shell is disposed');
      return openIntents.start(initialIntent);
    },
    open(intent) {
      if (disposed) throw new Error('Reader shell is disposed');
      return openIntents.submit(intent);
    },
    refreshAppearance({ diagramTheme = 'default' } = {}) {
      if (disposed) return Promise.resolve(false);
      return documentSession.refreshDiagrams(diagramTheme);
    },
    currentDocument: () => documentSession.current(),
    dispose() {
      if (disposed) return;
      disposed = true;
      openIntents.dispose();
      documentSession.dispose();
    },
  });
}
