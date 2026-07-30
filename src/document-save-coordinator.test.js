import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { createDocumentSaveCoordinator } from './document-save-coordinator.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function payload(source) {
  return { html: `<p>${source}</p>`, source };
}

function fixture({ delay = 8, saveDocument, saveEditor } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <input id="first" type="checkbox"><input id="second" type="checkbox">
  </body></html>`);
  let editing = true;
  const notify = vi.fn();
  const onTaskCommitted = vi.fn();
  const onDiagnostic = vi.fn();
  const coordinator = createDocumentSaveCoordinator({
    window: dom.window,
    autoSaveDelay: delay,
    adapters: {
      isEditing: () => editing,
      saveEditor: saveEditor || vi.fn(async () => ({ status: 'saved' })),
      saveDocument: saveDocument || vi.fn(async (_path, source) => payload(source)),
    },
    hooks: { notify, onTaskCommitted, onDiagnostic },
  });
  return {
    dom,
    coordinator,
    notify,
    onTaskCommitted,
    onDiagnostic,
    setEditing: (value) => { editing = value; },
    first: dom.window.document.querySelector('#first'),
    second: dom.window.document.querySelector('#second'),
  };
}

describe('Document Save Coordinator', () => {
  it('replaces stale autosave timers and respects disabled, saving and error states', async () => {
    const saveEditor = vi.fn(async () => ({ status: 'saved' }));
    const view = fixture({ saveEditor });
    view.coordinator.replaceDocument({ path: 'notes.md', document: payload('# Notes') });

    view.coordinator.observeEditor({ mode: 'edit', dirty: true, saveState: 'idle' });
    view.coordinator.observeEditor({ mode: 'edit', dirty: true, saveState: 'idle' });
    await new Promise((resolve) => view.dom.window.setTimeout(resolve, 20));
    expect(saveEditor).toHaveBeenCalledOnce();

    view.coordinator.setAutoSaveEnabled(false);
    view.coordinator.observeEditor({ mode: 'edit', dirty: true, saveState: 'idle' });
    view.coordinator.setAutoSaveEnabled(true, { mode: 'edit', dirty: true, saveState: 'saving' });
    view.coordinator.observeEditor({ mode: 'edit', dirty: true, saveState: 'error' });
    await new Promise((resolve) => view.dom.window.setTimeout(resolve, 20));
    expect(saveEditor).toHaveBeenCalledOnce();
  });

  it('reports manual success and preserves automatic failure feedback', async () => {
    const saveEditor = vi.fn()
      .mockResolvedValueOnce({ status: 'saved' })
      .mockResolvedValueOnce({ status: 'failed' });
    const view = fixture({ saveEditor });
    await view.coordinator.saveEditor();
    await view.coordinator.saveEditor({ automatic: true });
    expect(view.notify).toHaveBeenNthCalledWith(1, 'Changes saved');
    expect(view.notify).toHaveBeenNthCalledWith(2, 'Could not save. Your changes are still here.');
  });

  it('suppresses stale editor-save results and feedback after document replacement', async () => {
    const pending = deferred();
    const view = fixture({ saveEditor: vi.fn(() => pending.promise) });
    view.coordinator.replaceDocument({ path: 'old.md', document: payload('Old') });
    const saving = view.coordinator.saveEditor();
    await Promise.resolve();

    view.coordinator.replaceDocument({ path: 'new.md', document: payload('New') });
    pending.resolve({ status: 'saved' });

    await expect(saving).resolves.toMatchObject({ status: 'stale' });
    expect(view.notify).not.toHaveBeenCalled();
  });

  it('serializes task saves and rolls back the exact failed checkbox and source', async () => {
    const saveDocument = vi.fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockImplementationOnce(async (_path, source) => payload(source));
    const view = fixture({ saveDocument });
    view.coordinator.replaceDocument({
      path: 'tasks.md',
      document: payload('- [ ] first\n- [ ] second'),
    });
    view.first.checked = true;
    view.second.checked = true;

    const first = view.coordinator.toggleReadTask({ checkbox: view.first, sourceLine: 1, checked: true });
    const second = view.coordinator.toggleReadTask({ checkbox: view.second, sourceLine: 2, checked: true });
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.status).toBe('failed');
    expect(secondResult.status).toBe('saved');
    expect(view.first.checked).toBe(false);
    expect(view.second.checked).toBe(true);
    expect(saveDocument).toHaveBeenNthCalledWith(2, 'tasks.md', '- [ ] first\n- [x] second');
    expect(view.onTaskCommitted).toHaveBeenCalledOnce();
    expect(view.onTaskCommitted.mock.calls[0][0].document.source).toBe('- [ ] first\n- [x] second');
    expect(view.first.disabled).toBe(false);
    expect(view.second.disabled).toBe(false);
  });

  it('invalidates in-flight and queued task commits when the document is replaced', async () => {
    const pending = deferred();
    const saveDocument = vi.fn().mockReturnValueOnce(pending.promise);
    const view = fixture({ saveDocument });
    view.coordinator.replaceDocument({ path: 'old.md', document: payload('- [ ] old\n- [ ] queued') });
    view.first.checked = true;
    view.second.checked = true;
    const first = view.coordinator.toggleReadTask({ checkbox: view.first, sourceLine: 1, checked: true });
    const second = view.coordinator.toggleReadTask({ checkbox: view.second, sourceLine: 2, checked: true });
    await Promise.resolve();

    view.coordinator.replaceDocument({ path: 'new.md', document: payload('- [ ] new') });
    expect(view.first.checked).toBe(false);
    expect(view.second.checked).toBe(false);
    expect(view.first.disabled).toBe(false);
    expect(view.second.disabled).toBe(false);
    pending.resolve(payload('- [x] old\n- [ ] queued'));

    await expect(first).resolves.toMatchObject({ status: 'stale' });
    await expect(second).resolves.toMatchObject({ status: 'stale' });
    expect(saveDocument).toHaveBeenCalledOnce();
    expect(view.onTaskCommitted).not.toHaveBeenCalled();
  });

  it('cancels scheduled and pending work on dispose', async () => {
    const pending = deferred();
    const saveEditor = vi.fn(async () => ({ status: 'saved' }));
    const saveDocument = vi.fn().mockReturnValue(pending.promise);
    const view = fixture({ saveDocument, saveEditor });
    view.coordinator.replaceDocument({ path: 'tasks.md', document: payload('- [ ] task') });
    view.coordinator.observeEditor({ mode: 'edit', dirty: true, saveState: 'idle' });
    view.first.checked = true;
    const task = view.coordinator.toggleReadTask({ checkbox: view.first, sourceLine: 1, checked: true });
    await Promise.resolve();
    view.coordinator.dispose();
    pending.resolve(payload('- [x] task'));
    await expect(task).resolves.toMatchObject({ status: 'stale' });
    await new Promise((resolve) => view.dom.window.setTimeout(resolve, 20));
    expect(saveEditor).not.toHaveBeenCalled();
    expect(view.onTaskCommitted).not.toHaveBeenCalled();
  });
});
