export function createEditorFeedbackPresenter({
  window,
  document,
  elements = {},
} = {}) {
  if (!window || !document) {
    throw new TypeError('Editor Feedback Presenter requires window and document');
  }

  let disposed = false;

  const render = ({ snapshot = {}, isEditing = false } = {}) => {
    if (disposed) return;

    document.body.classList.toggle('is-edit-mode', isEditing);
    document.body.classList.toggle('has-unsaved-changes', Boolean(snapshot.dirty));
    document.body.classList.toggle('is-editor-saving', snapshot.saveState === 'saving');
    document.body.classList.toggle('has-editor-save-error', snapshot.saveState === 'error');

    if (elements.editorSaveButton) {
      const saveState = snapshot.saveState === 'error'
        ? 'error'
        : snapshot.saveState === 'saving'
          ? 'saving'
          : snapshot.dirty
            ? 'unsaved'
            : 'saved';
      const label = snapshot.saveState === 'saving'
        ? 'Saving…'
        : snapshot.saveState === 'error'
          ? 'Save failed'
          : snapshot.dirty
            ? 'Unsaved'
            : snapshot.saveState === 'recovered'
              ? 'Recovered'
              : 'Saved';
      const tooltip = snapshot.saveState === 'error'
        ? `Save failed: ${snapshot.error}. Activate to retry.`
        : snapshot.dirty
          ? 'Unsaved changes · Save now (Ctrl+S)'
          : 'Document saved';
      const accessibleLabel = snapshot.saveState === 'saving'
        ? 'Saving document'
        : snapshot.saveState === 'error'
          ? `Retry saving document. Last error: ${snapshot.error}`
          : snapshot.dirty
            ? 'Save document'
            : 'Document saved';
      const iconClass = snapshot.saveState === 'error'
        ? 'iconoir-warning-triangle'
        : snapshot.saveState === 'saving'
          ? 'iconoir-refresh'
          : snapshot.dirty
            ? 'iconoir-floppy-disk'
            : 'iconoir-check';

      elements.editorSaveButton.hidden = !isEditing;
      elements.editorSaveButton.disabled = snapshot.saveState === 'saving' || !snapshot.dirty;
      elements.editorSaveButton.classList.toggle('is-error', snapshot.saveState === 'error');
      elements.editorSaveButton.dataset.state = saveState;
      elements.editorSaveButton.dataset.tooltip = tooltip;
      elements.editorSaveButton.setAttribute('aria-label', accessibleLabel);
      elements.editorSaveButton.querySelector('i')?.setAttribute('class', iconClass);
      if (elements.editorSaveLabel) elements.editorSaveLabel.textContent = label;
    }

  };

  return Object.freeze({
    render,
    dispose() {
      disposed = true;
    },
  });
}
