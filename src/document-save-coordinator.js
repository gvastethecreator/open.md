import { normalizeDocumentPayload, setMarkdownTaskChecked } from './core/reader.js';

export function createDocumentSaveCoordinator({
  window,
  autoSaveDelay = 650,
  adapters = {},
  hooks = {},
}) {
  if (!window || typeof adapters.saveEditor !== 'function' || typeof adapters.saveDocument !== 'function') {
    throw new TypeError('Document Save Coordinator requires window and save adapters');
  }

  let autoSaveEnabled = true;
  let autoSaveTimeoutId = null;
  let latestEditorSnapshot = null;
  let currentPath = null;
  let currentDocument = null;
  let documentRevision = 0;
  let taskTail = Promise.resolve();
  let disposed = false;
  const pendingTasks = new Set();

  const clearAutoSave = () => {
    if (autoSaveTimeoutId !== null) window.clearTimeout(autoSaveTimeoutId);
    autoSaveTimeoutId = null;
  };

  const updateCheckboxLabel = (checkbox, checked) => {
    checkbox?.setAttribute?.('aria-label', checked ? 'Mark task incomplete' : 'Mark task complete');
  };

  const settleTaskUi = (task, { rollback = false } = {}) => {
    if (rollback) task.checkbox.checked = task.previousChecked;
    updateCheckboxLabel(task.checkbox, rollback ? task.previousChecked : task.requestedChecked);
    task.checkbox.disabled = false;
    task.checkbox.removeAttribute?.('aria-busy');
    task.uiSettled = true;
  };

  const invalidatePendingTasks = () => {
    for (const task of pendingTasks) {
      task.invalidated = true;
      settleTaskUi(task, { rollback: true });
    }
    pendingTasks.clear();
  };

  const replaceDocument = ({ path = null, document = null } = {}) => {
    documentRevision += 1;
    currentPath = path;
    currentDocument = document;
    clearAutoSave();
    invalidatePendingTasks();
  };

  const saveEditor = async ({ automatic = false } = {}) => {
    if (disposed || !adapters.isEditing?.()) return { status: 'unavailable' };
    let result;
    try {
      result = await adapters.saveEditor();
    } catch (error) {
      hooks.onDiagnostic?.('Could not save the edited document', error);
      result = { status: 'failed', error };
    }
    if (result?.status === 'failed') {
      hooks.notify?.('Could not save. Your changes are still here.');
    } else if (!automatic && result?.status === 'saved') {
      hooks.notify?.('Changes saved');
    }
    return result;
  };

  const observeEditor = (snapshot) => {
    latestEditorSnapshot = snapshot || null;
    clearAutoSave();
    if (
      disposed
      || !autoSaveEnabled
      || !snapshot
      || snapshot.mode !== 'edit'
      || !snapshot.dirty
      || snapshot.saveState === 'saving'
      || snapshot.saveState === 'error'
    ) return;

    const scheduledRevision = documentRevision;
    autoSaveTimeoutId = window.setTimeout(() => {
      autoSaveTimeoutId = null;
      if (disposed || scheduledRevision !== documentRevision || !autoSaveEnabled) return;
      void saveEditor({ automatic: true });
    }, Math.max(0, Number(autoSaveDelay) || 0));
  };

  const setAutoSaveEnabled = (enabled, snapshot = latestEditorSnapshot) => {
    autoSaveEnabled = Boolean(enabled);
    observeEditor(snapshot);
  };

  const toggleReadTask = ({ checkbox, sourceLine, checked = checkbox?.checked } = {}) => {
    if (disposed || !checkbox || !currentPath || !currentDocument) {
      return Promise.resolve({ status: 'unavailable' });
    }

    const task = {
      checkbox,
      sourceLine,
      requestedChecked: Boolean(checked),
      previousChecked: !Boolean(checked),
      path: currentPath,
      revision: documentRevision,
      invalidated: false,
      uiSettled: false,
    };
    checkbox.disabled = true;
    checkbox.setAttribute?.('aria-busy', 'true');
    pendingTasks.add(task);

    const isStale = () => (
      disposed
      || task.invalidated
      || task.revision !== documentRevision
      || task.path !== currentPath
    );

    const run = async () => {
      if (isStale()) return { status: 'stale' };
      try {
        const update = setMarkdownTaskChecked(currentDocument.source, task.sourceLine, task.requestedChecked);
        if (!update) throw new Error(`Task source line ${task.sourceLine} is no longer available`);
        if (!update.changed) {
          settleTaskUi(task);
          return { status: 'unchanged' };
        }

        const savedPayload = await adapters.saveDocument(task.path, update.source);
        if (isStale()) return { status: 'stale' };
        const savedDocument = normalizeDocumentPayload(savedPayload);
        currentDocument = savedDocument;
        settleTaskUi(task);
        hooks.onTaskCommitted?.({
          path: task.path,
          document: savedDocument,
          checkbox: task.checkbox,
          checked: task.requestedChecked,
        });
        hooks.notify?.(task.requestedChecked ? 'Task completed' : 'Task reopened');
        return { status: 'saved', document: savedDocument };
      } catch (error) {
        if (isStale()) return { status: 'stale' };
        settleTaskUi(task, { rollback: true });
        hooks.onDiagnostic?.('Could not save the task state', error);
        hooks.notify?.('Could not save this task. The previous state was restored.');
        return { status: 'failed', error };
      } finally {
        if (!task.uiSettled) settleTaskUi(task, { rollback: isStale() });
        pendingTasks.delete(task);
      }
    };

    const operation = taskTail.then(run, run);
    taskTail = operation.catch(() => {});
    return operation;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    documentRevision += 1;
    clearAutoSave();
    invalidatePendingTasks();
  };

  return Object.freeze({
    replaceDocument,
    observeEditor,
    setAutoSaveEnabled,
    saveEditor,
    toggleReadTask,
    dispose,
  });
}
