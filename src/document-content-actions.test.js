import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { createDocumentContentActions } from './document-content-actions.js';

function fixture() {
  const dom = new JSDOM(`<!doctype html><body>
    <article id="content" class="markdown-body" tabindex="-1">
      <a id="link" href="notes.md">Notes</a>
      <pre><code>const answer = 42;</code></pre>
      <label><input id="task" type="checkbox" data-source-line="7"></label>
      <img id="image" src="./cover.png" alt="Cover">
      <div id="diagram" class="mermaid" data-mermaid-source="graph TD; A-->B"><svg></svg></div>
      <table id="table"><tbody><tr><td>Cell</td></tr></tbody></table>
    </article>
    <pre id="source" tabindex="-1"></pre>
    <div data-block-id="block-1"><div data-editor-content>Block text</div></div>
  </body>`);
  const { document } = dom.window;
  const toasts = [];
  const editorSession = {
    contextFor: vi.fn(() => ({
      hasSelection: true,
      selectionText: 'selected',
      blockId: 'block-1',
      blockType: 'paragraph',
      canMoveUp: false,
      canMoveDown: true,
      canDelete: true,
    })),
    applyInlineCommand: vi.fn(),
    openLinkFromSelection: vi.fn(),
    performBlockAction: vi.fn(),
  };
  let mode = 'read';
  let sourceActive = false;
  const toggleReadTask = vi.fn();
  const controller = createDocumentContentActions({
    window: dom.window,
    document,
    elements: {
      content: document.querySelector('#content'),
      sourceView: document.querySelector('#source'),
      sourceContent: document.querySelector('#source'),
    },
    adapters: {
      isDocumentAvailable: () => true,
      isHelpVisible: () => false,
      isEditMode: () => mode === 'edit',
      isSourceActive: () => sourceActive,
      getDocument: () => ({ source: '# Heading\n' }),
      getEditorSession: () => editorSession,
      toggleReadTask,
    },
    hooks: { onToast: (message) => toasts.push(message) },
  });
  return {
    dom,
    document,
    controller,
    editorSession,
    toasts,
    toggleReadTask,
    setMode: (next) => { mode = next; },
    setSourceActive: (next) => { sourceActive = next; },
  };
}

function action(context, id) {
  return context.items.find((item) => item.id === id);
}

describe('Document Content Actions', () => {
  it('keeps Read context actions and clipboard feedback', async () => {
    const view = fixture();
    const clipboard = { writeText: vi.fn(async () => {}) };
    Object.defineProperty(view.dom.window.navigator, 'clipboard', { configurable: true, value: clipboard });

    const context = view.controller.resolveContext({ target: view.document.querySelector('#link') });
    expect(context.label).toBe('Reading actions');
    expect(action(context, 'open-link')).toBeTruthy();
    await action(context, 'copy-link').onSelect();

    expect(clipboard.writeText).toHaveBeenCalledWith('notes.md');
    expect(view.toasts).toContain('Link copied');
  });

  it('keeps Source actions and task mutation behind injected adapters', async () => {
    const view = fixture();
    view.document.execCommand = vi.fn(() => true);
    view.setSourceActive(true);
    const sourceContext = view.controller.resolveContext({ target: view.document.querySelector('#source') });
    await action(sourceContext, 'copy-source').onSelect();
    expect(view.toasts).toContain('Source copied');

    view.setSourceActive(false);
    view.controller.handleReadTaskToggle({ target: view.document.querySelector('#task') });
    expect(view.toggleReadTask).toHaveBeenCalledWith(expect.objectContaining({ sourceLine: 7, checked: false }));
  });

  it('keeps Edit block and inline actions', () => {
    const view = fixture();
    view.setMode('edit');
    const context = view.controller.resolveContext({ target: view.document.querySelector('[data-editor-content]') });

    action(context, 'bold').onSelect();
    action(context, 'move-down').onSelect();
    action(context, 'delete').onSelect();

    expect(view.editorSession.applyInlineCommand).toHaveBeenCalledWith('bold');
    expect(view.editorSession.performBlockAction).toHaveBeenCalledWith('block-1', 'move-down');
    expect(view.editorSession.performBlockAction).toHaveBeenCalledWith('block-1', 'delete');
  });

  it('restores focus after a failed clipboard fallback and reports the error', async () => {
    const view = fixture();
    const copyTarget = view.document.querySelector('#link');
    copyTarget.focus();
    Object.defineProperty(view.dom.window.navigator, 'clipboard', { configurable: true, value: undefined });
    view.document.execCommand = vi.fn(() => false);

    const context = view.controller.resolveContext({ target: copyTarget });
    await action(context, 'copy-link').onSelect();

    expect(view.document.activeElement).toBe(copyTarget);
    expect(view.toasts).toContain('Could not copy to the clipboard');
  });

  it('stops resolving and handling actions after disposal', () => {
    const view = fixture();
    view.controller.dispose();
    expect(view.controller.resolveContext({ target: view.document.querySelector('#link') })).toBeNull();
    view.controller.handleReadTaskToggle({ target: view.document.querySelector('#task') });
    expect(view.toggleReadTask).not.toHaveBeenCalled();
  });
});
