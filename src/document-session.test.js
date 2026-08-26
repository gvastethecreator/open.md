// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentSession } from './document-session.js';

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

function createSession({ open, readImage, readImageFile, prepare, render, highlight, resources, hooks } = {}) {
  return createDocumentSession({
    window,
    adapters: {
      documents: {
        open: open || vi.fn(async () => payload()),
        readImage: readImage || vi.fn(async () => new Uint8Array()),
        readImageFile: readImageFile || vi.fn(async () => new Uint8Array([1, 2, 3])),
      },
      diagrams: {
        prepare: prepare || vi.fn(async () => null),
        render: render || vi.fn(async () => false),
      },
      syntax: {
        highlight: highlight || vi.fn(async () => false),
      },
      resources: resources || createResources(),
    },
    hooks,
  });
}

beforeEach(() => {
  document.open();
  document.write(indexHtml);
  document.close();
});

describe('document session', () => {
  it('owns rendered/source enrichment and focus for a successful document', async () => {
    const session = createSession({
      open: vi.fn(async () => payload({
        html: '<table><tbody><tr><td>A</td></tr></tbody></table><pre><code>let x = 1;</code></pre>',
        source: '# Title\n`code`',
      })),
    });

    await expect(session.open({ path: 'guide.md' })).resolves.toMatchObject({ status: 'ready' });

    expect(document.querySelector('#source-content .source-markup-token')?.textContent).toBe('#');
    expect(document.querySelector('#content .table-scroll table')).not.toBeNull();
    expect(document.querySelector('#content .copy-code-btn')).not.toBeNull();
    expect(document.activeElement).toBe(document.querySelector('#content'));
    expect(session.current()).toMatchObject({ state: 'ready', path: 'guide.md' });
  });

  it('does not put a copy-code control on a full-document nfo pre', async () => {
    const session = createSession({
      open: vi.fn(async () => payload({
        html: '<pre data-plain-text="true" data-format="nfo"><code>╔═╗</code></pre>',
        source: '╔═╗',
        format: 'nfo',
        kind: 'text',
      })),
    });

    await expect(session.open({ path: 'info.nfo' })).resolves.toMatchObject({ status: 'ready' });
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
    editorControl.tabIndex = -1;
    editorControl.focus();
    onStateChange.mockClear();
    onDocumentCommitted.mockClear();
    current = payload({
      html: '<h1>After</h1><pre><code>saved()</code></pre>',
      source: '# After\n\n```js\nsaved()\n```',
    });

    await expect(session.open({ path: 'guide.md', quiet: true })).resolves.toMatchObject({ status: 'ready' });

    expect(document.querySelector('#content h1')?.textContent).toBe('After');
    expect(document.querySelector('#content .copy-code-btn')).not.toBeNull();
    expect(document.querySelector('#source-content')?.textContent).toContain('# After');
    expect(document.activeElement).toBe(editorControl);
    expect(onStateChange).not.toHaveBeenCalled();
    expect(onDocumentCommitted).not.toHaveBeenCalled();
    expect(session.current()).toMatchObject({ state: 'ready', path: 'guide.md', document: current });
  });

  it('hydrates a relative image through native bytes and Blob resource adapters', async () => {
    const resources = createResources();
    const readImage = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const session = createSession({
      open: vi.fn(async () => payload({ html: '<img src="assets/photo.png" alt="Photo">' })),
      readImage,
      resources,
    });

    await session.open({ path: 'guide.md' });

    expect(readImage).toHaveBeenCalledWith('guide.md', 'assets/photo.png');
    expect(resources.create).toHaveBeenCalledWith(expect.any(Uint8Array), 'image/png');
    expect(document.querySelector('#content img')?.getAttribute('src')).toBe('blob:test-image');
    expect(document.querySelector('#content img')?.hasAttribute('aria-busy')).toBe(false);
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

  it('prepares a diagram replacement through the session without mutating the visible node', async () => {
    const prepared = { theme: 'dark', commit: vi.fn(() => true) };
    const prepare = vi.fn(async () => prepared);
    const session = createSession({
      open: vi.fn(async () => payload({ html: '<div class="mermaid">graph TD; A-->B</div>' })),
      prepare,
    });
    await session.open({ path: 'diagram.md' });
    const visibleBefore = document.querySelector('#content .mermaid')?.innerHTML;

    await expect(session.prepareDiagrams('dark')).resolves.toBe(prepared);

    expect(prepare).toHaveBeenCalledWith(document.querySelector('#content'), {
      reset: true,
      theme: 'dark',
    });
    expect(document.querySelector('#content .mermaid')?.innerHTML).toBe(visibleBefore);
    expect(prepared.commit).not.toHaveBeenCalled();
  });

  it('marks the code-block copy button as copied with check feedback on success', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const session = createDocumentSession({
      window,
      adapters: {
        documents: {
          open: vi.fn(async () => payload({
            html: '<pre><code class="language-javascript">const calm = true;</code></pre>',
          })),
          readImage: vi.fn(async () => new Uint8Array()),
          readImageFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
        },
        diagrams: {
          prepare: vi.fn(async () => null),
          render: vi.fn(async () => false),
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
