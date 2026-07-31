import { orderNativeOpenRequests } from './open-intent-controller.js';

function isNativeRuntime(window) {
  return Boolean(window?.__TAURI_INTERNALS__);
}

export function createDocumentIngressController({
  window,
  document,
  adapters = {},
  hooks = {},
} = {}) {
  if (!window || !document) {
    throw new TypeError('Document Ingress Controller requires window and document');
  }

  const native = isNativeRuntime(window);
  const body = document.body;
  let disposed = false;
  let startPromise = null;
  let associationUnlisten = null;
  let dragDropUnlisten = null;
  const domUnlisteners = [];

  const listenNative = adapters.listen;
  const openFileDialog = adapters.openFileDialog;
  const getCurrentWebview = adapters.getCurrentWebview;
  const listPendingOpenFileRequests = adapters.listPendingOpenFileRequests;

  const listen = (target, type, handler, options) => {
    target?.addEventListener?.(type, handler, options);
    if (target?.removeEventListener) {
      domUnlisteners.push(() => target.removeEventListener(type, handler, options));
    }
  };

  const setDragState = (active) => {
    body?.classList.toggle('is-dragging', Boolean(active));
  };

  const canChangeDocument = () => adapters.canChangeDocument?.() !== false;

  const openDocument = (value) => {
    if (disposed) return Promise.reject(new Error('Document Ingress Controller is disposed'));
    return Promise.resolve().then(() => adapters.openDocument?.(value));
  };

  const submitNativeOpenFileRequest = (value) => {
    const items = (Array.isArray(value?.paths) ? value.paths : []).map((path) => ({ path }));
    return openDocument({
      origin: 'association',
      items,
      delivery: {
        key: value?.id,
        acknowledge: () => adapters.acknowledgeOpenFile?.(value?.id),
      },
    }).catch((error) => {
      hooks.onDiagnostic?.('Could not process the file-open request', error);
      hooks.onToast?.('Could not open the associated file');
      return null;
    });
  };

  const setupFileAssociationEvents = async () => {
    if (!native || disposed) return;
    if (typeof listenNative !== 'function' || typeof listPendingOpenFileRequests !== 'function') {
      hooks.onWarning?.('Native file-open adapters are unavailable in this runtime');
      return;
    }

    const bufferedRequests = [];
    let replayingPendingRequests = true;
    try {
      const unlisten = await listenNative('open-file-request', (event) => {
        if (replayingPendingRequests) bufferedRequests.push(event.payload);
        else void submitNativeOpenFileRequest(event.payload);
      });
      if (disposed) {
        unlisten?.();
        return;
      }
      associationUnlisten = unlisten;
      const pendingRequests = await listPendingOpenFileRequests();
      const orderedRequests = orderNativeOpenRequests(pendingRequests, bufferedRequests);
      replayingPendingRequests = false;
      orderedRequests.forEach((request) => { void submitNativeOpenFileRequest(request); });
    } catch (error) {
      replayingPendingRequests = false;
      orderNativeOpenRequests(bufferedRequests).forEach((request) => {
        void submitNativeOpenFileRequest(request);
      });
      hooks.onWarning?.('Native file-open events are unavailable in this runtime', error);
    }
  };

  const openPicker = async () => {
    if (disposed) return { status: 'disposed' };
    if (!canChangeDocument()) return { status: 'blocked' };
    hooks.closeReadingTools?.();
    if (typeof openFileDialog !== 'function') {
      hooks.onToast?.('Could not open the file picker');
      return { status: 'unavailable' };
    }
    try {
      const selected = await openFileDialog({
        multiple: true,
        directory: false,
        filters: [
          {
            name: 'Markdown and text',
            extensions: ['md', 'markdown', 'txt'],
          },
        ],
      });
      if (selected === null) return { status: 'cancelled' };
      return await openDocument({
        origin: 'picker',
        items: (Array.isArray(selected) ? selected : [selected]).map((path) => ({ path })),
      });
    } catch (error) {
      hooks.onDiagnostic?.('Open dialog failed', error);
      hooks.onToast?.('Could not open the file picker');
      return { status: 'failed', error };
    }
  };

  const setupDomDragSafety = () => {
    listen(window, 'dragover', (event) => event.preventDefault());
    listen(window, 'drop', (event) => event.preventDefault());
  };

  const setupDragAndDrop = async () => {
    if (!native || disposed) return;
    if (typeof getCurrentWebview !== 'function') {
      hooks.onWarning?.('Drag & drop adapter unavailable in this runtime');
      return;
    }

    try {
      const unlisten = await getCurrentWebview()
        .onDragDropEvent(async (event) => {
          if (disposed) return;
          if (event.payload.type === 'over') {
            setDragState(true);
            return;
          }

          if (event.payload.type === 'drop') {
            setDragState(false);
            if (!canChangeDocument()) return;
            try {
              await openDocument({
                origin: 'drop',
                items: (event.payload.paths || []).map((path) => ({ path })),
              });
            } catch (error) {
              hooks.onDiagnostic?.('Could not open dropped files', error);
              hooks.onToast?.('Could not open the dropped file');
            }
            return;
          }

          setDragState(false);
        });
      if (disposed) {
        unlisten?.();
        return;
      }
      dragDropUnlisten = unlisten;
    } catch (error) {
      hooks.onWarning?.('Drag & drop listener unavailable in this runtime', error);
    }
  };

  const start = () => {
    if (disposed) return Promise.reject(new Error('Document Ingress Controller is disposed'));
    if (startPromise) return startPromise;
    startPromise = (async () => {
      setupDomDragSafety();
      await Promise.all([setupFileAssociationEvents(), setupDragAndDrop()]);
    })();
    return startPromise;
  };

  return Object.freeze({
    start,
    openPicker,
    isNative: () => native,
    dispose() {
      if (disposed) return;
      disposed = true;
      domUnlisteners.splice(0).forEach((unlisten) => unlisten());
      associationUnlisten?.();
      dragDropUnlisten?.();
      associationUnlisten = null;
      dragDropUnlisten = null;
      setDragState(false);
    },
  });
}
