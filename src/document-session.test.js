// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentSession } from './document-session.js';
import { createApplicationRuntimeAdapters } from './application-runtime-adapters.js';
import { highlightCodeBlocks, highlightDocument } from './syntax-highlighter.js';
import { ImageResourcePool } from './image-resources.js';

const indexHtml = readFileSync('index.html', 'utf8');

function payload({ html = '<h1>Title</h1>', source = '# Title' } = {}) {
  return {
    html,
    source,
    lineCount: source.split('\n').length,
    characterCount: source.length,
    wordCount: source.trim() ? source.trim().split(/\s+/).length : 0,
    readingTimeMinutes: 1,
  };
}

function createResources() {
  return {
    create: vi.fn(() => 'blob:test-image'),
    revoke: vi.fn(),
    clear: vi.fn(),
  };
}

function sessionElements() {
  return {
    content: document.getElementById('content'),
    sourceContent: document.getElementById('source-content'),
    sourceView: document.getElementById('source-view'),
    readerPage: document.getElementById('reader-page'),
  };
}

function createSession({ open, readImage, readImageFile, render, dispose, highlight, resources, hooks, syntax, clipboard } = {}) {
  return createDocumentSession({
    window,
    elements: sessionElements(),
    adapters: {
      documents: {
        open: open || vi.fn(async () => payload()),
        readImage: readImage || vi.fn(async () => new Uint8Array()),
        readImageFile: readImageFile || vi.fn(async () => new Uint8Array([1, 2, 3])),
      },
      diagrams: {
        render: render || vi.fn(async () => false),
        dispose: dispose || vi.fn(),
      },
      syntax: {
        highlight: highlight || vi.fn(async () => false),
        ...syntax,
      },
      clipboard,
      resources: resources || createResources(),
    },
    hooks,
  });
}

beforeEach(() => {
  window.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; }
    observe(target) { queueMicrotask(() => this.callback([{ target, isIntersecting: true }])); }
    unobserve() {}
    disconnect() {}
  };
  document.open();
  document.write(indexHtml);
  document.close();
});

describe('document session', () => {
  it.each(['replace', 'dispose'])('does not apply delayed syntax after document %s', async (ending) => {
    let release;
    let started;
    const loading = new Promise((resolve) => { started = resolve; });
    const highlight = vi.fn(highlightCodeBlocks);
    const fullHighlight = vi.fn(highlightDocument);
    const runtime = createApplicationRuntimeAdapters({
      window,
      syntaxLoader: () => {
        started();
        return new Promise((resolve) => { release = () => resolve({ highlightCodeBlocks: highlight, highlightDocument: fullHighlight }); });
      },
    });
    const session = createSession({
      syntax: runtime.syntax,
      open: async (path) => payload({
        html: path === 'new.md' ? '<h1>New</h1>' : '<pre><code class="language-json">{"old":true}</code></pre>',
        source: '{invalid',
      }),
    });
    const opening = session.open({ path: ending === 'replace' ? 'old.md' : 'old.json' });
    await loading;
    if (ending === 'replace') await session.open({ path: 'new.md' });
    else session.dispose();
    const before = document.querySelector('#content').innerHTML;
    release();
    await expect(opening).resolves.toMatchObject({ status: 'ready' });
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(document.querySelector('#content').innerHTML).toBe(before);
    expect(highlight).not.toHaveBeenCalled();
    expect(fullHighlight).not.toHaveBeenCalled();
    session.dispose();
  });

  it('highlights companion content once and still colors a subsequent edited document', async () => {
    let source = '{"before":';
    const highlight = vi.fn(highlightCodeBlocks);
    const fullHighlight = vi.fn(highlightDocument);
    const session = createSession({
      open: async () => payload({ source }),
      syntax: { highlight, highlightDocument: fullHighlight },
    });
    await session.open({ path: 'broken.json' });
    expect(highlight).not.toHaveBeenCalled();
    expect(fullHighlight).toHaveBeenCalledOnce();
    await fullHighlight.mock.results[0].value;
    const code = document.querySelector('#content code');
    expect(code.textContent).toBe(source);
    expect(code.querySelector('.syntax-property')).not.toBeNull();
    source = '{"after":';
    await session.open({ path: 'broken.json', quiet: true });
    expect(fullHighlight).toHaveBeenCalledTimes(2);
    await fullHighlight.mock.results[1].value;
    expect(document.querySelector('#content code').textContent).toBe(source);
    expect(document.querySelector('#content .syntax-property').textContent).toContain('after');
    session.dispose();
  });

  it.each(['clear', 'dispose'])('ignores pending clipboard completion after %s', async (ending) => {
    let complete;
    const onToast = vi.fn();
    const onDiagnostic = vi.fn();
    const writeText = vi.fn(() => new Promise((resolve, reject) => {
      complete = () => ending === 'clear' ? resolve() : reject(new Error('Clipboard unavailable'));
    }));
    const session = createSession({
      open: async () => payload({ html: '<pre><code>copy me</code></pre>' }),
      clipboard: { writeText }, hooks: { onToast, onDiagnostic },
    });
    await session.open({ path: 'code.md' });
    const button = document.querySelector('#content .copy-code-btn');
    button.click();
    session[ending]();
    complete();
    await Promise.resolve();
    expect(onToast).not.toHaveBeenCalled();
    expect(onDiagnostic).not.toHaveBeenCalled();
    expect(button.getAttribute('aria-label')).toBe('Copy code block');
    button.click();
    expect(writeText).toHaveBeenCalledOnce();
  });
  it('requires an injected content element instead of looking up #content', () => {
    expect(() => createDocumentSession({
      window,
      adapters: { documents: { open: vi.fn() } },
    })).toThrow('Reader shell requires #content');
  });

  it('owns rendered/source enrichment and focus for a successful document', async () => {
    const session = createSession({
      open: vi.fn(async () => payload({
        html: '<table><tbody><tr><td>A</td></tr></tbody></table><pre><code>let x = 1;</code></pre>',
        source: '# Title\n`code`',
      })),
    });

    await expect(session.open({ path: 'guide.md' })).resolves.toMatchObject({ status: 'ready' });

    session.ensureSourceView();
    expect(document.querySelector('#source-content .source-markup-token')?.textContent).toBe('#');
    expect(document.querySelector('#content .table-scroll table')).not.toBeNull();
    expect(document.querySelector('#content .copy-code-btn')).not.toBeNull();
    expect(document.activeElement).toBe(document.querySelector('#content'));
    expect(session.current()).toMatchObject({ state: 'ready', path: 'guide.md' });
  });

  it.each(['nfo', 'log', 'txt'])('does not put a copy-code control on a full-document %s pre', async (format) => {
    const session = createSession({
      open: vi.fn(async () => payload({
        html: `<pre data-plain-text="true" data-format="${format}"><code>╔═╗</code></pre>`,
        source: '╔═╗',
        format: 'nfo',
        kind: 'text',
      })),
    });

    await expect(session.open({ path: `info.${format}` })).resolves.toMatchObject({ status: 'ready' });
    expect(document.querySelector('#content .copy-code-btn')).toBeNull();
    expect(document.querySelector('#content pre[data-plain-text="true"]')).not.toBeNull();
  });

  it('quietly refreshes a saved read projection without publishing or stealing editor focus', async () => {
    let current = payload({ html: '<h1>Before</h1>', source: '# Before' });
    const onStateChange = vi.fn();
    const onDocumentCommitted = vi.fn();
    const session = createSession({
      open: vi.fn(async () => current),
      hooks: { onStateChange, onDocumentCommitted },
    });

    await session.open({ path: 'guide.md' });
    const editorControl = document.querySelector('#editor-canvas');
    const editorView = document.querySelector('#editor-view');
    editorView.hidden = false;
    editorView.inert = false;
    editorControl.tabIndex = -1;
    editorControl.focus();
    onStateChange.mockClear();
    onDocumentCommitted.mockClear();
    current = payload({
      html: '<h1>After</h1><pre><code>saved()</code></pre>',
      source: '# After\n\n```js\nsaved()\n```',
    });

    await expect(session.open({ path: 'guide.md', quiet: true })).resolves.toMatchObject({ status: 'ready' });
    session.ensureSourceView();

    expect(document.querySelector('#content h1')?.textContent).toBe('After');
    expect(document.querySelector('#content .copy-code-btn')).not.toBeNull();
    expect(document.querySelector('#source-content')?.textContent).toContain('# After');
    expect(document.activeElement).toBe(editorControl);
    expect(onStateChange).not.toHaveBeenCalled();
    expect(onDocumentCommitted).not.toHaveBeenCalled();
    expect(session.current()).toMatchObject({ state: 'ready', path: 'guide.md', document: current });
  });

  it('builds hidden Source token DOM only when Source is opened', async () => {
    const onSettled = vi.fn(() => {
      expect(document.querySelector('#source-content .source-markup-token')).toBeNull();
    });
    const session = createSession({
      open: vi.fn(async () => payload({
        html: '<h1>Title</h1>',
        source: '# Title\n`code`',
      })),
      hooks: { onSettled },
    });

    await session.open({ path: 'guide.md' });

    expect(onSettled).toHaveBeenCalledOnce();
    expect(document.querySelector('#content h1')?.textContent).toBe('Title');
    expect(document.querySelector('#source-content .source-markup-token')).toBeNull();
    session.ensureSourceView();
    expect(document.querySelector('#source-content .source-markup-token')?.textContent).toBe('#');
    expect(document.querySelector('#source-content').textContent).toBe('# Title\n`code`');
  });

  it('settles Read paint before image bytes resolve', async () => {
    let resolveImage;
    const readImage = vi.fn(() => new Promise((resolve) => { resolveImage = resolve; }));
    const onSettled = vi.fn();
    const session = createSession({
      open: vi.fn(async () => payload({ html: '<p>Hello</p><img src="assets/photo.png" alt="Photo">' })),
      readImage,
      hooks: { onSettled },
    });
    const opening = session.open({ path: 'guide.md' });
    await Promise.resolve();
    expect(onSettled).toHaveBeenCalled();
    expect(document.querySelector('#content p')?.textContent).toBe('Hello');
    await opening;
    await vi.waitFor(() => expect(readImage).toHaveBeenCalledOnce());
    resolveImage(new Uint8Array([1, 2, 3]));
  });

  it('hydrates a relative image through native bytes and Blob resource adapters', async () => {
    const resources = createResources();
    resources.get = vi.fn(() => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }));
    const readImage = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const session = createSession({
      open: vi.fn(async () => payload({ html: '<img src="assets/photo.png" alt="Photo">' })),
      readImage,
      resources,
    });

    await session.open({ path: 'guide.md' });

    expect(readImage).toHaveBeenCalledWith('guide.md', 'assets/photo.png');
    await vi.waitFor(() => expect(resources.create).toHaveBeenCalledWith(expect.any(Uint8Array), 'image/png'));
    expect(document.querySelector('#content img')?.getAttribute('src')).toBe('blob:test-image');
    expect(document.querySelector('#content img')?.hasAttribute('aria-busy')).toBe(false);
    const image = document.querySelector('#content img');
    expect(session.getImageMedia(image)).toEqual({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png', path: 'assets/photo.png' });
    session.clear();
    expect(session.getImageMedia(image)).toBeNull();
  });

  it('opens and enriches text even when image decoding never settles', async () => {
    const decode = vi.fn(() => new Promise(() => {}));
    const highlight = vi.fn(async () => false);
    const render = vi.fn(async () => false);
    const session = createSession({
      open: async () => payload({ html: '<p>Readable</p><img src="photo.png"><pre><code>code</code></pre><div class="mermaid">graph TD</div>' }),
      highlight,
      render,
      hooks: {
        onDocumentCommitted: () => { document.querySelector('#content img').decode = decode; },
      },
    });

    await expect(session.open({ path: 'images.md' })).resolves.toMatchObject({ status: 'ready' });
    expect(document.querySelector('#content p').textContent).toBe('Readable');
    expect(decode).toHaveBeenCalledOnce();
    expect(highlight).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledOnce();
    session.dispose();
  });

  it('shares viewport observation for queued images and diagrams and disconnects stale work', async () => {
    let intersect;
    const disconnect = vi.fn();
    const observe = vi.fn();
    window.IntersectionObserver = class {
      constructor(callback, options) {
        intersect = callback;
        expect(options.rootMargin).toBe(`${window.innerHeight}px 0px`);
      }
      observe = observe;
      unobserve = vi.fn();
      disconnect = disconnect;
    };
    const readImage = vi.fn(async () => new Uint8Array([1]));
    const render = vi.fn(async () => true);
    const session = createSession({
      open: async () => payload({ html: '<img src="photo.png"><div class="mermaid">graph TD</div>' }),
      readImage,
      render,
    });
    await session.open({ path: 'queued.md' });
    const image = document.querySelector('#content img');
    const diagram = document.querySelector('#content .mermaid');
    expect(observe).toHaveBeenCalledTimes(2);
    expect(image.hasAttribute('src')).toBe(false);
    expect(readImage).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(diagram.dataset.mermaidPending).toBe('true');

    intersect([{ target: image, isIntersecting: true }, { target: diagram, isIntersecting: true }]);
    await vi.waitFor(() => expect(image.getAttribute('src')).toBe('blob:test-image'));
    expect(readImage).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledWith(document.querySelector('#content'), {
      isCurrent: expect.any(Function),
    });
    expect(diagram.dataset.mermaidPending).toBeUndefined();
    session.clear();
    expect(disconnect).toHaveBeenCalledOnce();
    intersect([{ target: image, isIntersecting: true }, { target: diagram, isIntersecting: true }]);
    expect(readImage).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledOnce();
  });

  it('hydrates editor previews through the shared pool and releases only editor-owned URLs', async () => {
    let nextUrl = 0;
    const resources = new ImageResourcePool({ createObjectURL: () => `blob:preview-${++nextUrl}`, revokeObjectURL: vi.fn() });
    const readImage = vi.fn(async () => new Uint8Array([1]));
    const session = createSession({
      open: async () => payload({ html: '<img src="photo.png">' }),
      readImage,
      resources,
    });
    await session.open({ path: 'guide.md' });
    await vi.waitFor(() => expect(document.querySelector('#content img').getAttribute('src')).toBe('blob:preview-1'));
    const root = document.createElement('div');
    root.innerHTML = '<img data-document-source="photo.png"><img data-document-source="other.jpg"><img data-document-source="https://example.com/blocked.png">';
    document.body.append(root);
    session.hydrateImagePreviews(root);
    expect(root.querySelector('img').getAttribute('src')).toBe('blob:preview-1');
    await vi.waitFor(() => expect(root.querySelectorAll('img[src]')).toHaveLength(2));
    expect(readImage).toHaveBeenCalledTimes(2);
    expect(root.querySelector('.image-error')).not.toBeNull();
    expect(resources.size).toBe(2);
    session.hydrateImagePreviews(root);
    expect(readImage).toHaveBeenCalledTimes(2);
    session.hydrateImagePreviews(null);
    expect(resources.size).toBe(1);
    expect(resources.get('blob:preview-1')).not.toBeNull();
    let resolveLate;
    readImage.mockImplementationOnce(() => new Promise((resolve) => { resolveLate = resolve; }));
    root.innerHTML = '<img data-document-source="late.jpg">';
    session.hydrateImagePreviews(root);
    session.hydrateImagePreviews(null);
    resolveLate(new Uint8Array([1]));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(resources.size).toBe(1);
    expect(root.querySelector('img').hasAttribute('src')).toBe(false);
    session.clear();
    expect(resources.size).toBe(0);
  });

  it('opens a standalone image companion with the pan/zoom viewer shell', async () => {
    const resources = createResources();
    const readImageFile = vi.fn(async () => new Uint8Array([137, 80, 78, 71]));
    const session = createSession({
      open: vi.fn(async () => ({
        html: '<div class="image-document" data-image-document="true" role="img" aria-label="photo.png"></div>',
        source: '',
        kind: 'image',
        lineCount: 1,
        characterCount: 0,
        wordCount: 0,
        readingTimeMinutes: 0,
      })),
      readImageFile,
      resources,
    });

    await expect(session.open({ path: 'C:\\pics\\photo.png' })).resolves.toMatchObject({
      status: 'ready',
      path: 'C:\\pics\\photo.png',
    });

    expect(readImageFile).toHaveBeenCalledWith('C:\\pics\\photo.png');
    expect(resources.create).toHaveBeenCalledWith(expect.any(Uint8Array), 'image/png');
    expect(document.querySelector('#content .image-document')).not.toBeNull();
    expect(document.querySelector('#content .image-document__img')?.getAttribute('src')).toBe('blob:test-image');
    expect(session.current()).toMatchObject({ state: 'ready', path: 'C:\\pics\\photo.png' });
  });

  it('applies changed CSV and image preferences without reopening for unrelated settings', async () => {
    const open = vi.fn(async (path) => path.endsWith('.png')
      ? { ...payload({ html: '<div data-image-document="true"></div>', source: '' }), kind: 'image' }
      : payload({ source: 'heading\nfirst\nsecond' }));
    const session = createSession({ open });
    let advanced = { csvRowCap: 2, imageDefaultZoom: 'fit', imageZoomAnimation: true };
    session.applyPreferences({ advanced });
    await session.open({ path: 'rows.csv' });
    expect(document.querySelectorAll('#content tbody tr')).toHaveLength(1);
    advanced = { ...advanced, csvRowCap: 3 };
    await session.applyPreferences({ advanced });
    expect(document.querySelectorAll('#content tbody tr')).toHaveLength(2);
    await session.applyPreferences({ advanced: { ...advanced, edgeFade: false } });
    expect(open).toHaveBeenCalledTimes(2);

    await session.open({ path: 'photo.png' });
    const image = document.querySelector('#content img');
    Object.defineProperty(image, 'naturalWidth', { value: 800 });
    Object.defineProperty(image, 'naturalHeight', { value: 600 });
    image.dispatchEvent(new Event('load'));
    expect(session.getImageViewer().getScale()).toBeLessThan(1);
    session.applyPreferences({ advanced: { ...advanced, imageDefaultZoom: '100%', imageZoomAnimation: false } });
    expect(session.getImageViewer().getScale()).toBe(1);
    session.getImageViewer().fit();
    expect(image.style.transition).toBe('none');
    expect(open).toHaveBeenCalledTimes(3);
    session.dispose();
  });

  it('keeps the document ready and reports one warning when Mermaid fails', async () => {
    const onWarning = vi.fn();
    const session = createSession({
      open: vi.fn(async () => payload({ html: '<div class="mermaid">graph TD</div>' })),
      render: vi.fn(async () => {
        throw new Error('Mermaid unavailable');
      }),
      hooks: { onWarning },
    });

    await expect(session.open({ path: 'diagram.md' })).resolves.toMatchObject({ status: 'ready' });
    expect(onWarning).toHaveBeenCalledOnce();
    expect(onWarning).toHaveBeenCalledWith('One or more diagrams could not be rendered');
    expect(document.querySelector('#content .mermaid')?.textContent).toBe('graph TD');
  });

  it('disposes diagram mounts before the read surface is replaced', async () => {
    const seen = [];
    const dispose = vi.fn(() => {
      seen.push(document.querySelector('#content .mermaid')?.textContent ?? null);
    });
    const session = createSession({
      open: vi.fn(async (path) => payload({
        html: path === 'second.md' ? '<p>Next</p>' : '<div class="mermaid">graph TD</div>',
      })),
      dispose,
    });

    await session.open({ path: 'first.md' });
    await session.open({ path: 'second.md' });

    expect(seen).toContain('graph TD');
    expect(document.querySelector('#content .mermaid')).toBeNull();
    expect(document.querySelector('#content p')?.textContent).toBe('Next');
    session.dispose();
  });

  it('marks the code-block copy button as copied with check feedback on success', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const session = createDocumentSession({
      window,
      elements: sessionElements(),
      adapters: {
        documents: {
          open: vi.fn(async () => payload({
            html: '<pre><code class="language-javascript">const calm = true;</code></pre>',
          })),
          readImage: vi.fn(async () => new Uint8Array()),
          readImageFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
        },
        diagrams: {
          render: vi.fn(async () => false),
          dispose: vi.fn(),
        },
        syntax: {
          highlight: vi.fn(async () => false),
        },
        resources: createResources(),
        clipboard: { writeText },
      },
    });

    await session.open({ path: 'code.md' });
    const buttons = document.querySelectorAll('#content .copy-code-btn');
    expect(buttons).toHaveLength(1);
    const button = buttons[0];
    expect(button.getAttribute('aria-label')).toBe('Copy code block');
    const icon = button.querySelector('i');
    expect(icon?.className).toContain('iconoir-copy');

    button.click();
    await writeText.mock.results[0].value;

    expect(writeText).toHaveBeenCalled();
    expect(String(writeText.mock.calls[0][0])).toContain('const calm');
    expect(button.classList.contains('is-copied')).toBe(true);
    expect(button.classList.contains('is-copy-error')).toBe(false);
    expect(button.getAttribute('aria-label')).toBe('Code copied');
    expect(button.dataset.tooltip).toBe('Copied');
    expect(icon?.className).toContain('iconoir-check');

    // Second click while success is active must not leave mixed error classes.
    button.click();
    await writeText.mock.results[1].value;
    expect(button.classList.contains('is-copied')).toBe(true);
    expect(button.classList.contains('is-copy-error')).toBe(false);

    await vi.advanceTimersByTimeAsync(2000);
    expect(button.classList.contains('is-copied')).toBe(false);
    expect(button.getAttribute('aria-label')).toBe('Copy code block');
    expect(button.dataset.tooltip).toBe('Copy code');
    expect(icon?.className).toContain('iconoir-copy');

    // No double inject on re-open enrichment path: still one button.
    expect(document.querySelectorAll('#content .copy-code-btn')).toHaveLength(1);
    const schedule = vi.spyOn(window, 'setTimeout');
    const cancel = vi.spyOn(window, 'clearTimeout');
    button.click();
    await writeText.mock.results[2].value;
    const resetIndex = schedule.mock.calls.findIndex(([, delay]) => delay === 2000);
    expect(resetIndex).toBeGreaterThanOrEqual(0);
    const resetTimer = schedule.mock.results[resetIndex].value;
    session.clear();
    expect(cancel).toHaveBeenCalledWith(resetTimer);
    schedule.mockRestore();
    cancel.mockRestore();
    vi.useRealTimers();
  });

  it('runs deferred syntax enrichment and preserves readable code when it fails', async () => {
    const onWarning = vi.fn();
    const onDiagnostic = vi.fn();
    const highlight = vi.fn(async (content) => {
      expect(content.querySelector('.copy-code-btn')).not.toBeNull();
      throw new Error('Syntax chunk unavailable');
    });
    const session = createSession({
      open: vi.fn(async () => payload({
        html: '<pre><code class="language-javascript">const calm = true;</code></pre>',
      })),
      highlight,
      hooks: { onWarning, onDiagnostic },
    });

    await expect(session.open({ path: 'code.md' })).resolves.toMatchObject({ status: 'ready' });
    expect(highlight).toHaveBeenCalledOnce();
    expect(onWarning).toHaveBeenCalledWith('Code remains readable without syntax colors');
    expect(onDiagnostic).toHaveBeenCalledWith('Syntax highlighting error', expect.any(Error));
    expect(document.querySelector('#content code')?.textContent).toBe('const calm = true;');
  });

  it('clears document resources on replacement, failure and disposal', async () => {
    const resources = createResources();
    const open = vi.fn(async (path) => {
      if (path === 'broken.md') throw new Error('No access');
      return payload({ html: `<p>${path}</p>` });
    });
    const session = createSession({ open, resources });

    await session.open({ path: 'first.md' });
    await session.open({ path: 'second.md' });
    await session.open({ path: 'broken.md' });
    session.dispose();

    expect(resources.clear).toHaveBeenCalledTimes(5);
    expect(document.querySelector('#content .error p')?.textContent).toContain('No access');
  });
});
