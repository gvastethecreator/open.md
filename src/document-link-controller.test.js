// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createDocumentLinkController } from './document-link-controller.js';

function clickEvent(anchor) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'target', { value: anchor });
  return event;
}

describe('Document Link Controller', () => {
  it('leaves anchor links alone and blocks edit-surface anchors', () => {
    document.body.innerHTML = `
      <div id="editor-view"><a href="#section">in edit</a></div>
      <a id="read-anchor" href="#section">in read</a>
    `;
    const openDocument = vi.fn();
    const controller = createDocumentLinkController({
      adapters: {
        isEditMode: () => true,
        getDocumentPath: () => 'C:/docs/guide.md',
        openDocument,
      },
    });

    const editLink = document.querySelector('#editor-view a');
    const editEvent = clickEvent(editLink);
    controller.handleClick(editEvent);
    expect(editEvent.defaultPrevented).toBe(true);
    expect(openDocument).not.toHaveBeenCalled();

    const readEvent = clickEvent(document.querySelector('#read-anchor'));
    controller.handleClick(readEvent);
    expect(readEvent.defaultPrevented).toBe(false);
  });

  it('opens external URLs and relative supported documents', async () => {
    document.body.innerHTML = `
      <a id="external" href="https://example.com/docs">external</a>
      <a id="relative" href="../api/reference.md#usage">relative</a>
      <a id="blocked" href="javascript:alert(1)">blocked</a>
    `;
    const openExternalUrl = vi.fn(async () => {});
    const openDocument = vi.fn(async () => {});
    const onToast = vi.fn();
    const controller = createDocumentLinkController({
      adapters: {
        isEditMode: () => false,
        getDocumentPath: () => 'C:/docs/guide/intro.md',
        openExternalUrl,
        openDocument,
      },
      hooks: { onToast },
    });

    const external = document.querySelector('#external');
    external.href = 'https://example.com/docs';
    const externalEvent = clickEvent(external);
    controller.handleClick(externalEvent);
    expect(externalEvent.defaultPrevented).toBe(true);
    await Promise.resolve();
    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/docs');

    const relative = document.querySelector('#relative');
    // Keep the relative attribute; absolute href is only a fallback for protocol-relative links.
    const relativeEvent = clickEvent(relative);
    controller.handleClick(relativeEvent);
    await Promise.resolve();
    expect(openDocument).toHaveBeenCalledWith({
      origin: 'link',
      items: [{ path: 'C:/docs/api/reference.md', fragment: '#usage' }],
    });

    const blockedEvent = clickEvent(document.querySelector('#blocked'));
    controller.handleClick(blockedEvent);
    expect(onToast).toHaveBeenCalledWith('This link type is not supported');
  });

  it('ignores clicks after dispose', () => {
    document.body.innerHTML = '<a id="external" href="https://example.com">x</a>';
    const openExternalUrl = vi.fn(async () => {});
    const controller = createDocumentLinkController({
      adapters: {
        getDocumentPath: () => 'C:/docs/guide.md',
        openExternalUrl,
      },
    });
    controller.dispose();
    const event = clickEvent(document.querySelector('#external'));
    controller.handleClick(event);
    expect(event.defaultPrevented).toBe(false);
    expect(openExternalUrl).not.toHaveBeenCalled();
  });
});
