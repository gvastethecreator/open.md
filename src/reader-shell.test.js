// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { mountReaderShell } from './reader-shell.js';

const indexHtml = readFileSync('index.html', 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function payload(title) {
  return {
    html: `<h1>${title}</h1>`,
    source: `# ${title}`,
    lineCount: 1,
    characterCount: title.length + 2,
    wordCount: 1,
    readingTimeMinutes: 1,
  };
}

function renderFixture() {
  document.open();
  document.write(indexHtml);
  document.close();
}

function createAdapters(openDocument) {
  return {
    documents: {
      open: openDocument,
      readImage: async () => new Uint8Array(),
    },
    diagrams: {
      prepare: async () => null,
      render: async () => false,
    },
  };
}

describe('reader shell', () => {
  it('keeps a stale document load from replacing the latest DOM', async () => {
    renderFixture();
    const first = deferred();
    const second = deferred();
    const shell = mountReaderShell({
      window,
      adapters: createAdapters((path) => path === 'first.md' ? first.promise : second.promise),
    });
    await shell.start();

    const firstOpen = shell.open({ origin: 'link', items: [{ path: 'first.md' }] });
    const secondOpen = shell.open({ origin: 'link', items: [{ path: 'second.md' }] });
    second.resolve(payload('Second'));

    await expect(secondOpen).resolves.toMatchObject({
      status: 'completed',
      openedHere: ['second.md'],
    });
    expect(document.querySelector('#content h1')?.textContent).toBe('Second');

    first.resolve(payload('First'));
    await expect(firstOpen).resolves.toMatchObject({ status: 'superseded' });
    expect(document.querySelector('#content h1')?.textContent).toBe('Second');

    shell.dispose();
  });

  it('renders dependency failures through the public shell seam', async () => {
    renderFixture();
    const shell = mountReaderShell({
      window,
      adapters: createAdapters(async () => {
        throw new Error('Disk unavailable');
      }),
    });
    await shell.start();

    await expect(
      shell.open({ origin: 'picker', items: [{ path: 'broken.md' }] })
    ).resolves.toMatchObject({
      status: 'partial',
      failures: [{ path: 'broken.md' }],
    });

    expect(document.querySelector('#content .error h1')?.textContent).toBe('Could not open the file');
    expect(document.querySelector('#content .error p')?.textContent).toContain('Disk unavailable');
    expect(document.querySelector('#content')?.hasAttribute('aria-busy')).toBe(false);

    shell.dispose();
  });

  it('reloads the active document through the same session seam after a save', async () => {
    renderFixture();
    let title = 'Before';
    const openDocument = vi.fn(async () => payload(title));
    const shell = mountReaderShell({ window, adapters: createAdapters(openDocument) });
    await shell.start({ origin: 'launch', items: [{ path: 'sample.md' }] });
    title = 'After';

    await expect(shell.reload()).resolves.toMatchObject({ status: 'ready', path: 'sample.md' });
    expect(openDocument).toHaveBeenCalledTimes(2);
    expect(document.querySelector('#content h1')?.textContent).toBe('After');

    shell.dispose();
  });

  it('exposes prepared appearance updates without committing them', async () => {
    renderFixture();
    const prepared = { theme: 'dark', commit: vi.fn(() => true) };
    const adapters = createAdapters(async () => ({
      ...payload('Diagram'),
      html: '<div class="mermaid">graph TD; A-->B</div>',
    }));
    adapters.diagrams.prepare = vi.fn(async () => prepared);
    const shell = mountReaderShell({ window, adapters });
    await shell.start({ origin: 'launch', items: [{ path: 'diagram.md' }] });

    const diagramTokens = { accent: '#62c6c8', background: '#111820' };
    await expect(shell.prepareAppearance({ diagramTheme: 'dark', diagramTokens })).resolves.toBe(prepared);
    expect(adapters.diagrams.prepare).toHaveBeenCalledWith(document.querySelector('#content'), {
      reset: true,
      theme: 'dark',
      tokens: diagramTokens,
    });
    expect(prepared.commit).not.toHaveBeenCalled();

    shell.dispose();
  });

  it('closes the active document back to an idle empty shell', async () => {
    renderFixture();
    const shell = mountReaderShell({
      window,
      adapters: createAdapters(async () => payload('Closeable')),
    });
    await shell.start({ origin: 'launch', items: [{ path: 'close-me.md' }] });
    expect(shell.currentDocument()).toMatchObject({ state: 'ready', path: 'close-me.md' });
    expect(document.querySelector('#content h1')?.textContent).toBe('Closeable');

    expect(shell.close()).toMatchObject({ status: 'closed', path: 'close-me.md' });
    expect(shell.currentDocument()).toMatchObject({ state: 'idle', path: null, document: null });
    expect(document.querySelector('#content')?.textContent).toBe('');
    expect(shell.close()).toMatchObject({ status: 'idle', path: null });

    shell.dispose();
  });
});
