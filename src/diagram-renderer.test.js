// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  importCalls: 0,
  rejectNextImport: false,
  mountAsync: vi.fn(),
}));

let renderDiagrams;
let disposeDiagrams;

function diagram(source, { pending = false, processed = false } = {}) {
  const element = document.createElement('div');
  element.className = 'mermaid';
  element.textContent = source;
  if (pending) element.dataset.mermaidPending = 'true';
  if (processed) element.dataset.processed = 'true';
  document.body.append(element);
  return element;
}

function mountedOk(type) {
  return {
    result: { type, svg: '<svg></svg>', width: 10, height: 10, links: [] },
    error: undefined,
    destroy: vi.fn(),
  };
}

beforeEach(async () => {
  vi.resetModules();
  document.body.replaceChildren();
  testState.importCalls = 0;
  testState.rejectNextImport = false;
  testState.mountAsync.mockReset();
  testState.mountAsync.mockImplementation(async (element, _source, _options) => {
    element.innerHTML = '<svg></svg>';
    return mountedOk('flowchart');
  });
  vi.doMock('pele/lazy', () => {
    testState.importCalls += 1;
    if (testState.rejectNextImport) {
      testState.rejectNextImport = false;
      throw new Error('Pele import failed');
    }
    return { mountAsync: testState.mountAsync };
  });
  ({ renderDiagrams, disposeDiagrams } = await import('./diagram-renderer.js'));
});

describe('diagram renderer', () => {
  it('does not import Pele when no diagram is eligible', async () => {
    diagram('graph TD', { pending: true });
    diagram('graph TD', { processed: true });

    await expect(renderDiagrams(document.body)).resolves.toBe(false);
    await expect(renderDiagrams(document.createElement('div'))).resolves.toBe(false);

    expect(testState.importCalls).toBe(0);
    expect(testState.mountAsync).not.toHaveBeenCalled();
  });

  it('mounts eligible diagrams with fixed options and accessible markers', async () => {
    const pending = diagram('graph TD; C-->D', { pending: true });
    const done = diagram('graph TD; E-->F', { processed: true });
    const flow = diagram('graph TD; A-->B');
    const sequence = diagram('sequenceDiagram\nAlice->>Bob: hi');
    testState.mountAsync
      .mockImplementationOnce(async (element) => {
        element.innerHTML = '<svg></svg>';
        return mountedOk('flowchart');
      })
      .mockImplementationOnce(async (element) => {
        element.innerHTML = '<svg></svg>';
        return mountedOk('sequence');
      });

    await expect(renderDiagrams(document.body)).resolves.toBe(true);

    expect(testState.mountAsync).toHaveBeenCalledTimes(2);
    expect(testState.mountAsync).toHaveBeenNthCalledWith(1, flow, 'graph TD; A-->B', {
      zoom: false,
      images: false,
      linkSchemes: ['http', 'https', 'mailto'],
    });
    expect(testState.mountAsync).toHaveBeenNthCalledWith(2, sequence, 'sequenceDiagram\nAlice->>Bob: hi', {
      zoom: false,
      images: false,
      linkSchemes: ['http', 'https', 'mailto'],
    });
    expect(pending.dataset.processed).toBeUndefined();
    expect(done.dataset.mermaidKind).toBeUndefined();
    expect(flow.dataset.mermaidSource).toBe('graph TD; A-->B');
    expect(flow.dataset.processed).toBe('true');
    expect(flow.dataset.mermaidKind).toBe('flowchart');
    expect(flow.getAttribute('role')).toBe('region');
    expect(flow.getAttribute('aria-label')).toBe('Flowchart 3');
    expect(flow.tabIndex).toBe(0);
    expect(sequence.dataset.mermaidKind).toBe('sequence');
    expect(sequence.getAttribute('aria-label')).toBe('Sequence diagram 4');
  });

  it('stops later mounts when isCurrent turns false', async () => {
    const first = diagram('graph TD; A-->B');
    const second = diagram('pie title Pets\n"Cats" : 2');
    let checks = 0;

    // Current for the first mount (before and after it), stale for the second.
    await expect(renderDiagrams(document.body, { isCurrent: () => (checks += 1) <= 2 })).resolves.toBe(true);

    expect(testState.mountAsync).toHaveBeenCalledTimes(1);
    expect(first.dataset.processed).toBe('true');
    expect(second.dataset.processed).toBeUndefined();
    expect(second.querySelector('svg')).toBeNull();
  });

  it('mounts the remaining diagrams and rejects once when one mount fails', async () => {
    const broken = diagram('flowchart LR\nA -->');
    const intact = diagram('pie title Pets\n"Cats" : 2');
    const failed = { error: new Error('parse'), result: undefined, destroy: vi.fn() };
    testState.mountAsync
      .mockImplementationOnce(async () => failed)
      .mockImplementationOnce(async (element) => {
        element.innerHTML = '<svg></svg>';
        return mountedOk('pie');
      });

    await expect(renderDiagrams(document.body)).rejects.toThrow('1 diagram(s) could not be rendered');

    expect(testState.mountAsync).toHaveBeenCalledTimes(2);
    expect(broken.dataset.processed).toBe('error');
    expect(intact.dataset.processed).toBe('true');
    expect(intact.dataset.mermaidKind).toBe('pie');
    expect(intact.getAttribute('aria-label')).toBe('Pie chart 2');

    const later = diagram('graph TD; A-->B');
    await expect(renderDiagrams(document.body)).resolves.toBe(true);
    expect(testState.mountAsync).toHaveBeenCalledTimes(3);
    expect(testState.mountAsync).toHaveBeenLastCalledWith(later, 'graph TD; A-->B', expect.any(Object));
  });

  it('mounts a diagram once when render calls overlap', async () => {
    const element = diagram('graph TD; A-->B');

    await Promise.all([renderDiagrams(document.body), renderDiagrams(document.body)]);

    expect(testState.mountAsync).toHaveBeenCalledOnce();
    expect(testState.mountAsync).toHaveBeenCalledWith(element, 'graph TD; A-->B', expect.any(Object));
    expect(element.dataset.processed).toBe('true');
  });

  it('numbers diagrams by document position across lazy batches', async () => {
    const first = diagram('graph TD; A-->B');
    const second = diagram('graph TD; C-->D', { pending: true });

    await renderDiagrams(document.body);
    delete second.dataset.mermaidPending;
    await renderDiagrams(document.body);

    expect(first.getAttribute('aria-label')).toBe('Flowchart 1');
    expect(second.getAttribute('aria-label')).toBe('Flowchart 2');
  });

  it('destroys a mount that finishes after the document changed', async () => {
    const element = diagram('graph TD; A-->B');
    const late = mountedOk('flowchart');
    let current = true;
    testState.mountAsync.mockImplementation(async () => {
      current = false;
      return late;
    });

    await expect(renderDiagrams(document.body, { isCurrent: () => current })).resolves.toBe(false);
    disposeDiagrams();

    expect(late.destroy).toHaveBeenCalledOnce();
    expect(element.dataset.processed).toBeUndefined();
  });

  it('retries a failed Pele import on the next call', async () => {
    const element = diagram('graph TD; A-->B');
    testState.rejectNextImport = true;

    await expect(renderDiagrams(document.body)).rejects.toThrow(/mocking a module/);
    await expect(renderDiagrams(document.body)).resolves.toBe(true);

    expect(testState.importCalls).toBe(2);
    expect(element.dataset.processed).toBe('true');
  });

  it('destroys every mount on dispose', async () => {
    diagram('graph TD; A-->B');
    diagram('pie title Pets\n"Cats" : 2');
    const first = mountedOk('flowchart');
    const second = { error: new Error('parse'), destroy: vi.fn() };
    testState.mountAsync
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    await expect(renderDiagrams(document.body)).rejects.toThrow('1 diagram(s) could not be rendered');
    disposeDiagrams();
    disposeDiagrams();

    expect(first.destroy).toHaveBeenCalledOnce();
    expect(second.destroy).toHaveBeenCalledOnce();
  });
});
