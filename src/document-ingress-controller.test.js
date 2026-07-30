// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentIngressController } from './document-ingress-controller.js';

function fixture({ native = false, pendingRequests = [] } = {}) {
  document.body.innerHTML = '<button id="open"></button>';
  if (native) window.__TAURI_INTERNALS__ = {};
  else delete window.__TAURI_INTERNALS__;

  const openDocument = vi.fn(async (value) => {
    await value.delivery?.acknowledge?.();
    return { status: 'completed' };
  });
  const openFileDialog = vi.fn(async () => ['picked.md']);
  const hooks = {
    closeReadingTools: vi.fn(),
    onToast: vi.fn(),
    onWarning: vi.fn(),
    onDiagnostic: vi.fn(),
  };
  let associationHandler = null;
  let dragHandler = null;
  const associationUnlisten = vi.fn();
  const dragUnlisten = vi.fn();
  const acknowledgeOpenFile = vi.fn(async () => undefined);
  const listen = vi.fn(async (_event, handler) => {
    associationHandler = handler;
    return associationUnlisten;
  });
  const getCurrentWebview = vi.fn(() => ({
    onDragDropEvent: vi.fn(async (handler) => {
      dragHandler = handler;
      return dragUnlisten;
    }),
  }));
  let canChange = true;
  const controller = createDocumentIngressController({
    window,
    document,
    adapters: {
      openDocument,
      openFileDialog,
      listen,
      listPendingOpenFileRequests: vi.fn(async () => pendingRequests),
      getCurrentWebview,
      acknowledgeOpenFile,
      canChangeDocument: () => canChange,
    },
    hooks,
  });
  return {
    controller,
    openDocument,
    openFileDialog,
    hooks,
    get associationHandler() { return associationHandler; },
    get dragHandler() { return dragHandler; },
    associationUnlisten,
    dragUnlisten,
    acknowledgeOpenFile,
    setCanChange: (value) => { canChange = value; },
  };
}

beforeEach(() => {
  document.body.className = '';
});

describe('Document Ingress Controller', () => {
  it('keeps browser preview usable and guards picker replacement', async () => {
    const view = fixture();
    await view.controller.start();
    await view.controller.openPicker();

    expect(view.openFileDialog).toHaveBeenCalledOnce();
    expect(view.openDocument).toHaveBeenCalledWith({
      origin: 'picker',
      items: [{ path: 'picked.md' }],
    });
    expect(view.hooks.closeReadingTools).toHaveBeenCalledOnce();

    view.setCanChange(false);
    await expect(view.controller.openPicker()).resolves.toEqual({ status: 'blocked' });
    expect(view.openFileDialog).toHaveBeenCalledOnce();

    const dragover = new Event('dragover', { cancelable: true });
    window.dispatchEvent(dragover);
    expect(dragover.defaultPrevented).toBe(true);
    view.controller.dispose();
    const drop = new Event('drop', { cancelable: true });
    window.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(false);
  });

  it('replays native association events in order and acknowledges each delivery', async () => {
    const view = fixture({ native: true, pendingRequests: [{ id: 2, paths: ['pending.md'] }] });
    const pending = view.controller.start();
    await vi.waitFor(() => expect(view.associationHandler).toBeTypeOf('function'));
    await view.associationHandler({ payload: { id: 1, paths: ['buffered.md'] } });
    await pending;
    await vi.waitFor(() => expect(view.openDocument).toHaveBeenCalledTimes(2));

    expect(view.openDocument.mock.calls.map(([value]) => value.items[0].path)).toEqual([
      'buffered.md',
      'pending.md',
    ]);
    expect(view.controller.isNative()).toBe(true);
    view.controller.dispose();
    expect(view.associationUnlisten).toHaveBeenCalledOnce();
    expect(view.dragUnlisten).toHaveBeenCalledOnce();
    expect(view.acknowledgeOpenFile).toHaveBeenCalledWith(1);
    expect(view.acknowledgeOpenFile).toHaveBeenCalledWith(2);
  });

  it('keeps drag state, drop guards and teardown inside the ingress owner', async () => {
    const view = fixture({ native: true });
    await view.controller.start();
    await vi.waitFor(() => expect(view.dragHandler).toBeTypeOf('function'));

    await view.dragHandler({ payload: { type: 'over' } });
    expect(document.body.classList.contains('is-dragging')).toBe(true);
    view.setCanChange(false);
    await view.dragHandler({ payload: { type: 'drop', paths: ['blocked.md'] } });
    expect(view.openDocument).not.toHaveBeenCalledWith(expect.objectContaining({ origin: 'drop' }));

    view.setCanChange(true);
    await view.dragHandler({ payload: { type: 'drop', paths: ['dropped.md'] } });
    expect(view.openDocument).toHaveBeenCalledWith({
      origin: 'drop',
      items: [{ path: 'dropped.md' }],
    });
    expect(document.body.classList.contains('is-dragging')).toBe(false);
  });

  it('falls back to buffered association requests when pending replay fails', async () => {
    const view = fixture({ native: true });
    const pendingFailure = vi.fn(async () => { throw new Error('not ready'); });
    const controller = createDocumentIngressController({
      window,
      document,
      adapters: {
        listen: async (_event, handler) => {
          await Promise.resolve();
          void handler({ payload: { id: 4, paths: ['buffered.md'] } });
          return view.associationUnlisten;
        },
        listPendingOpenFileRequests: pendingFailure,
        openDocument: view.openDocument,
        getCurrentWebview: () => ({ onDragDropEvent: async () => view.dragUnlisten }),
      },
      hooks: view.hooks,
    });
    await controller.start();
    await vi.waitFor(() => expect(view.openDocument).toHaveBeenCalled());
    expect(view.hooks.onWarning).toHaveBeenCalledWith(
      'Native file-open events are unavailable in this runtime',
      expect.any(Error)
    );
  });
});
