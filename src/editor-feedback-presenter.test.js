import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { createEditorFeedbackPresenter } from './editor-feedback-presenter.js';

function fixture() {
  const dom = new JSDOM(`<!doctype html><body>
    <button id="save"><i></i><span id="label"></span></button>
  </body>`);
  const { document } = dom.window;
  const elements = {
    editorSaveButton: document.querySelector('#save'),
    editorSaveLabel: document.querySelector('#label'),
  };
  return {
    dom,
    document,
    elements,
    presenter: createEditorFeedbackPresenter({ window: dom.window, document, elements }),
  };
}

describe('Editor Feedback Presenter', () => {
  it('renders edit, dirty and saved feedback across the complete save state surface', () => {
    const view = fixture();
    const first = view.presenter.render({ mode: 'read', dirty: false, saveState: 'saved' });
    expect(first.modeChanged).toBe(false);
    expect(view.elements.editorSaveButton.hidden).toBe(true);

    const dirty = view.presenter.render({ mode: 'edit', dirty: true, saveState: 'idle' });
    expect(dirty).toMatchObject({ isEditMode: true, modeChanged: true });
    expect(view.document.body.classList.contains('is-edit-mode')).toBe(true);
    expect(view.document.body.classList.contains('has-unsaved-changes')).toBe(true);
    expect(view.elements.editorSaveButton.hidden).toBe(false);
    expect(view.elements.editorSaveButton.disabled).toBe(false);
    expect(view.elements.editorSaveButton.dataset.state).toBe('unsaved');
    expect(view.elements.editorSaveButton.querySelector('i').className).toBe('iconoir-floppy-disk');
    expect(view.elements.editorSaveLabel.textContent).toBe('Unsaved');
    expect(view.elements.editorSaveButton.getAttribute('aria-label')).toBe('Save document');

    view.presenter.render({ mode: 'edit', dirty: false, saveState: 'recovered' });
    expect(view.document.body.classList.contains('has-unsaved-changes')).toBe(false);
    expect(view.elements.editorSaveButton.disabled).toBe(true);
    expect(view.elements.editorSaveButton.dataset.state).toBe('saved');
    expect(view.elements.editorSaveLabel.textContent).toBe('Recovered');
    expect(view.elements.editorSaveButton.querySelector('i').className).toBe('iconoir-check');
  });

  it('renders saving and error feedback with state classes and retry copy', () => {
    const view = fixture();
    view.presenter.render({ mode: 'edit', dirty: true, saveState: 'saving' });
    expect(view.document.body.classList.contains('is-editor-saving')).toBe(true);
    expect(view.elements.editorSaveButton.disabled).toBe(true);
    expect(view.elements.editorSaveButton.dataset.state).toBe('saving');
    expect(view.elements.editorSaveLabel.textContent).toBe('Saving…');
    expect(view.elements.editorSaveButton.querySelector('i').className).toBe('iconoir-refresh');

    view.presenter.render({ mode: 'edit', dirty: true, saveState: 'error', error: 'Disk full' });
    expect(view.document.body.classList.contains('is-editor-saving')).toBe(false);
    expect(view.document.body.classList.contains('has-editor-save-error')).toBe(true);
    expect(view.elements.editorSaveButton.classList.contains('is-error')).toBe(true);
    expect(view.elements.editorSaveButton.dataset.state).toBe('error');
    expect(view.elements.editorSaveLabel.textContent).toBe('Save failed');
    expect(view.elements.editorSaveButton.dataset.tooltip).toContain('Disk full');
    expect(view.elements.editorSaveButton.getAttribute('aria-label')).toContain('Disk full');
    expect(view.elements.editorSaveButton.querySelector('i').className).toBe('iconoir-warning-triangle');
  });

  it('stops rendering after disposal', () => {
    const view = fixture();
    view.presenter.render({ mode: 'edit', dirty: true, saveState: 'idle' });
    view.presenter.dispose();
    const before = view.elements.editorSaveLabel.textContent;
    view.presenter.render({ mode: 'read', dirty: false, saveState: 'saved' });

    expect(view.elements.editorSaveLabel.textContent).toBe(before);
    expect(view.presenter.current().isEditMode).toBe(true);
  });
});
