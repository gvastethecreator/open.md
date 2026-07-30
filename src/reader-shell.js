import { createDocumentSession } from './document-session.js';
import { createOpenIntentController } from './open-intent-controller.js';
import {
  createMemoryPreferenceStore,
  createReaderPreferences,
} from './reader-preferences.js';

export function mountReaderShell({ window, adapters, hooks = {} }) {
  if (!window?.document) throw new Error('Reader shell requires a window with a document');

  const documentSession = createDocumentSession({ window, adapters, hooks });
  const openIntents = createOpenIntentController({
    session: documentSession,
    openWindow: adapters.windows?.openDocument,
    onFeedback: hooks.onToast,
    onDiagnostic: hooks.onDiagnostic,
  });
  const preferences = createReaderPreferences({
    store: adapters.storage || createMemoryPreferenceStore(),
    windowPin: typeof adapters.windows?.setAlwaysOnTop === 'function'
      ? { setAlwaysOnTop: adapters.windows.setAlwaysOnTop }
      : null,
  });
  const unsubscribePreferences = preferences.subscribe((snapshot) => {
    hooks.onPreferencesChange?.(snapshot);
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
    preferences,
    prepareAppearance({ diagramTheme = 'default', diagramTokens = null } = {}) {
      if (disposed) return Promise.resolve(null);
      return documentSession.prepareDiagrams(diagramTheme, diagramTokens);
    },
    refreshAppearance({ diagramTheme = 'default', diagramTokens = null } = {}) {
      if (disposed) return Promise.resolve(false);
      return documentSession.refreshDiagrams(diagramTheme, diagramTokens);
    },
    reload() {
      if (disposed) return Promise.resolve({ status: 'disposed' });
      const current = documentSession.current();
      if (!current?.path) return Promise.resolve({ status: 'idle', path: null });
      return documentSession.open({ path: current.path });
    },
    currentDocument: () => documentSession.current(),
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribePreferences();
      preferences.dispose();
      openIntents.dispose();
      documentSession.dispose();
    },
  });
}
