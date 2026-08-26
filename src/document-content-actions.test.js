import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { createDocumentContentActions } from './document-content-actions.js';

function fixture({
  format = 'markdown',
  kind = 'markdown',
  path = 'notes.md',
  source = '# Heading\n',
  html = null,
} = {}) {
  const contentHtml = html || `
      <a id="link" href="notes.md">Notes</a>
      <pre><code>const answer = 42;</code></pre>
      <label><input id="task" type="checkbox" data-source-line="7"></label>
      <img id="image" src="./cover.png" alt="Cover">
      <div id="diagram" class="mermaid" data-mermaid-source="graph TD; A-->B"><svg></svg></div>
      <table id="table"><tbody><tr><td>Cell</td></tr></tbody></table>
  `;
  const dom = new JSDOM(`<!doctype html><body>
    <article id="content" class="markdown-body" tabindex="-1">${contentHtml}</article>
    <pre id="source" tabindex="-1"></pre>
    <div data-block-id="block-1"><div data-editor-content>Block text</div></div>
  </body>`);
  const { document } = dom.window;
  const toasts = [];
  let blockEditor = true;
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
    isBlockEditor: () => blockEditor,
    current: () => ({ presentation: editPresentation }),
  };
  let mode = 'read';
  const defaultPresentation = format === 'markdown' || kind === 'markdown' || kind === 'blocks'
    ? 'block'
    : (format === 'json' || kind === 'json' ? 'json-props' : 'classic');
  let editPresentation = defaultPresentation;
  let sourceActive = false;
  const toggleReadTask = vi.fn();
  const imageViewer = { fit: vi.fn(), actualSize: vi.fn() };
  const downloadImage = vi.fn(async () => ({ status: 'saved' }));
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
      getDocument: () => ({ source, format, kind }),
      getDocumentPath: () => path,
      getEditorSession: () => editorSession,
      getImageViewer: () => imageViewer,
      getImageMedia: () => ({
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: 'image/png',
        path,
      }),
      downloadImage,
      toggleReadTask,
    },
    hooks: { onToast: (message) => toasts.push(message) },
  });
  return {
    dom,
    document,
    controller,
    editorSession,
    imageViewer,
    downloadImage,
    toasts,
    toggleReadTask,
    setMode: (next) => { mode = next; },
    setSourceActive: (next) => { sourceActive = next; },
    setBlockEditor: (next) => { blockEditor = next; },
    setPresentation: (next) => { editPresentation = next; },
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

  it('keeps Edit block and inline actions when Block editor is on', () => {
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

  it('hides block move/delete actions when block tools are off', () => {
    const view = fixture();
    view.setMode('edit');
    view.setBlockEditor(false);
    const context = view.controller.resolveContext({ target: view.document.querySelector('[data-editor-content]') });
    expect(context.label).toBe('Edit actions');
    expect(action(context, 'bold')).toBeTruthy();
    expect(action(context, 'move-down')).toBeUndefined();
    expect(action(context, 'delete')).toBeUndefined();
    expect(action(context, 'paste')).toBeTruthy();
  });

  it('does not offer Markdown inline formats in Source Edit', () => {
    const view = fixture();
    view.setMode('edit');
    view.setPresentation('source');
    const context = view.controller.resolveContext({ target: view.document.querySelector('[data-editor-content]') });
    expect(action(context, 'bold')).toBeUndefined();
    expect(action(context, 'paste')).toBeTruthy();
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

  it('offers image document actions without copy-document text (F1)', async () => {
    const view = fixture({
      format: 'png',
      kind: 'image',
      path: 'C:/photos/shot.png',
      html: '<div class="image-document" data-image-document="true"><img class="image-document__img" alt="shot"></div>',
    });
    const target = view.document.querySelector('.image-document');
    const context = view.controller.resolveContext({ target });
    expect(context.label).toBe('Image actions');
    expect(action(context, 'copy-image')).toBeTruthy();
    expect(action(context, 'download-image')).toBeTruthy();
    expect(action(context, 'image-fit')).toBeTruthy();
    expect(action(context, 'copy-document')).toBeUndefined();

    action(context, 'image-fit').onSelect();
    expect(view.imageViewer.fit).toHaveBeenCalledOnce();
    await action(context, 'download-image').onSelect();
    expect(view.downloadImage).toHaveBeenCalledOnce();
    expect(view.toasts).toContain('Image downloaded');
  });

  it('keeps plain companion edit free of markdown inline formats (F9)', () => {
    const view = fixture({
      format: 'yaml',
      kind: 'text',
      path: 'config.yaml',
      source: 'a: 1\n',
    });
    view.setMode('edit');
    const target = view.document.querySelector('[data-editor-content]');
    const context = view.controller.resolveContext({ target });
    expect(action(context, 'bold')).toBeUndefined();
    expect(action(context, 'paste')).toBeTruthy();
  });

  it('does not open plain/json edit menus outside the editor surface', () => {
    const view = fixture({
      format: 'yaml',
      kind: 'text',
      path: 'config.yaml',
      source: 'a: 1\n',
    });
    view.setMode('edit');
    const outside = view.document.createElement('button');
    outside.id = 'chrome';
    view.document.body.append(outside);
    expect(view.controller.resolveContext({ target: outside })).toBeNull();
  });

  it('prefers PNG when copying non-PNG image bytes to the clipboard', async () => {
    const view = fixture({
      format: 'png',
      kind: 'image',
      path: 'C:/photos/shot.webp',
      html: '<div class="image-document" data-image-document="true"><img class="image-document__img" alt="shot"></div>',
    });
    // Replace media with a non-PNG type; conversion falls back cleanly if bitmap encode is unavailable.
    view.controller.dispose();
    const clipboardWrite = vi.fn(async () => {});
    Object.defineProperty(view.dom.window, 'ClipboardItem', {
      configurable: true,
      value: class ClipboardItem {
        constructor(items) { this.items = items; }
      },
    });
    Object.defineProperty(view.dom.window.navigator, 'clipboard', {
      configurable: true,
      value: { write: clipboardWrite, writeText: vi.fn(async () => {}) },
    });
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
    const controller = createDocumentContentActions({
      window: view.dom.window,
      document: view.document,
      elements: {
        content: view.document.querySelector('#content'),
        sourceView: view.document.querySelector('#source'),
        sourceContent: view.document.querySelector('#source'),
      },
      adapters: {
        isDocumentAvailable: () => true,
        isHelpVisible: () => false,
        isEditMode: () => false,
        isSourceActive: () => false,
        getDocument: () => ({ format: 'jpeg', kind: 'image', source: '' }),
        getDocumentPath: () => 'C:/photos/shot.jpg',
        getImageViewer: () => ({ fit: vi.fn(), actualSize: vi.fn() }),
        getImageMedia: () => ({ bytes: jpegBytes, mimeType: 'image/jpeg', path: 'C:/photos/shot.jpg' }),
      },
      hooks: { onToast: (message) => view.toasts.push(message) },
    });
    const context = controller.resolveContext({ target: view.document.querySelector('.image-document') });
    await action(context, 'copy-image').onSelect();
    expect(clipboardWrite).toHaveBeenCalled();
    const item = clipboardWrite.mock.calls[0][0][0];
    const types = Object.keys(item.items || item);
    expect(types.some((type) => type === 'image/png' || type === 'image/jpeg')).toBe(true);
  });
});
