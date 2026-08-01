import { describe, expect, it, vi } from 'vitest';
import { createDocumentViewStateController } from './document-view-state.js';

function payload(title = 'Title') {
  return {
    html: `<h1>${title}</h1>`,
    source: `# ${title}`,
    lineCount: 1,
    characterCount: title.length + 2,
    wordCount: 1,
    readingTimeMinutes: 1,
  };
}

function fixture() {
  const editorSession = {
    current: vi.fn(() => ({ path: 'first.md' })),
    clearDocument: vi.fn(),
    setDocument: vi.fn(),
  };
  const calls = [];
  const hooks = {
    replaceDocument: vi.fn((value) => calls.push(['replace', value?.path || null])),
    resetReadingState: vi.fn(() => calls.push(['reset'])),
    closeReadingTools: vi.fn(() => calls.push(['close-tools'])),
    syncViewport: vi.fn(() => calls.push(['sync-viewport'])),
    applyReadingTools: vi.fn(() => calls.push(['apply-tools'])),
    setStatus: vi.fn((primary, context) => calls.push(['status', primary, context])),
    updateTitle: vi.fn((path) => calls.push(['title', path || null])),
    updateUrl: vi.fn((path) => calls.push(['url', path || null])),
    markNavigationDirty: vi.fn(() => calls.push(['dirty'])),
    handleNavigationScroll: vi.fn(() => calls.push(['scroll'])),
    onStateChange: vi.fn(),
  };
  const controller = createDocumentViewStateController({
    window: {},
    adapters: { getEditorSession: () => editorSession },
    hooks,
  });
  return { controller, editorSession, hooks, calls };
}

describe('Document View State', () => {
  it('fans loading and ready through one coherent identity transition', () => {
    const view = fixture();
    view.controller.handle({ state: 'loading', path: 'second.md', document: null });

    expect(view.controller.current()).toMatchObject({ state: 'loading', path: 'second.md', document: null });
    expect(view.editorSession.clearDocument).toHaveBeenCalledOnce();
    expect(view.hooks.replaceDocument).toHaveBeenCalledWith({ path: 'second.md', document: null });
    expect(view.hooks.setStatus).toHaveBeenCalledWith('second.md', 'Opening…');

    const document = payload('Second');
    view.controller.commitDocument({ path: 'second.md', document });
    view.controller.handle({ state: 'ready', path: 'second.md', document });

    expect(view.controller.current()).toMatchObject({ state: 'ready', path: 'second.md', document });
    expect(view.editorSession.setDocument).toHaveBeenCalledWith({
      path: 'second.md',
      source: '# Second',
      markdown: true,
      presentation: 'default',
    });
    expect(view.hooks.updateUrl).toHaveBeenCalledWith('second.md');
    expect(view.hooks.applyReadingTools).toHaveBeenCalled();
  });

  it('rejects stale completion for a replaced path and projects failure', () => {
    const view = fixture();
    view.controller.handle({ state: 'loading', path: 'first.md' });
    view.controller.handle({ state: 'loading', path: 'second.md' });
    view.controller.handle({ state: 'ready', path: 'first.md', document: payload('Stale') });
    expect(view.controller.current().path).toBe('second.md');
    expect(view.editorSession.setDocument).not.toHaveBeenCalled();

    const error = new Error('Disk unavailable');
    view.controller.handle({ state: 'failed', path: 'second.md', error });
    expect(view.controller.current()).toMatchObject({ state: 'failed', path: 'second.md', document: null, error });
    expect(view.hooks.markNavigationDirty).toHaveBeenCalledOnce();
    expect(view.hooks.setStatus).toHaveBeenLastCalledWith('second.md', 'Could not open');
    expect(view.editorSession.clearDocument).toHaveBeenCalledTimes(2);
  });

  it('clears all downstream state on idle and ignores updates after disposal', () => {
    const view = fixture();
    view.controller.handle({ state: 'loading', path: 'first.md' });
    view.controller.handle({ state: 'idle', path: null, document: null });

    expect(view.controller.current()).toEqual({ state: 'idle', path: null, document: null });
    expect(view.hooks.replaceDocument).toHaveBeenLastCalledWith();
    expect(view.hooks.handleNavigationScroll).toHaveBeenCalledOnce();

    view.controller.dispose();
    view.controller.handle({ state: 'loading', path: 'ignored.md' });
    expect(view.controller.current()).toEqual({ state: 'idle', path: null, document: null });
  });

  it('owns close eligibility for empty, dirty, and ready documents', () => {
    const view = fixture();
    const closeShell = vi.fn();
    view.hooks.closeShell = closeShell;

    expect(view.controller.requestClose({ canChangeDocument: true })).toEqual({ status: 'empty' });
    expect(closeShell).not.toHaveBeenCalled();

    view.controller.handle({ state: 'loading', path: 'notes.md' });
    expect(view.controller.requestClose({ canChangeDocument: false })).toEqual({ status: 'blocked' });
    expect(closeShell).not.toHaveBeenCalled();

    expect(view.controller.requestClose({ canChangeDocument: true })).toEqual({ status: 'closed' });
    expect(closeShell).toHaveBeenCalledOnce();
  });

  it('applies same-path save completion through one projection seam', () => {
    const view = fixture();
    const onSavedDocument = vi.fn();
    view.hooks.onSavedDocument = onSavedDocument;
    const controller = createDocumentViewStateController({
      window: {},
      adapters: { getEditorSession: () => view.editorSession },
      hooks: view.hooks,
    });
    controller.handle({ state: 'loading', path: 'notes.md' });
    controller.handle({ state: 'ready', path: 'notes.md', document: payload('Notes') });
    view.editorSession.setDocument.mockClear();

    const saved = payload('Saved');
    controller.applySavedDocument({ path: 'notes.md', document: saved });
    expect(controller.current()).toMatchObject({ state: 'ready', path: 'notes.md', document: saved });
    expect(view.editorSession.setDocument).toHaveBeenCalledWith({
      path: 'notes.md',
      source: '# Saved',
      markdown: true,
      presentation: 'default',
    });
    expect(onSavedDocument).toHaveBeenCalledWith({ path: 'notes.md', document: saved });

    controller.applySavedDocument({ path: 'other.md', document: payload('Other') });
    expect(controller.current().path).toBe('notes.md');
  });
});
